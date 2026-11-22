/**
 * What a crawl knows that a single page cannot.
 *
 * A one-page scan can say "this page has no CSP". It cannot say "12 of your 25 pages have
 * the same title", "the footer link to /mentions returns 404", "the login page takes 4 s to
 * answer", or "your source maps are published". Those are the findings a senior engineer
 * looks for first, and they need more than one request.
 *
 * Two rules keep the output honest:
 *
 *   - **A finding names the pages it affects.** "3 broken links" is not actionable; listing
 *     the three is.
 *   - **The score is computed, not felt.** See `scoreOf`: a Wilson lower bound on the
 *     weighted pass rate, times a coverage factor. That way a site with 2 measured controls
 *     cannot score 100, and an interval of 3 pages cannot outrank a crawl of 40.
 */

import type { CrawlResult } from "./crawl.js";
import type { ScanFinding, ScanModule, ScanStatus } from "./page-scan.js";

/** "1 page sends" / "3 pages send": a report people read cannot be ungrammatical. */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export interface SiteFinding {
  module: ScanModule;
  id: string;
  status: ScanStatus;
  /** The fact, with counts. */
  observed: string;
  why: string;
  /** Pages the finding is about: the evidence, not a count. */
  pages: string[];
}

/** A finding whose fix is one line, for the site-level controls. */
export interface SiteCheckInput {
  crawl: CrawlResult;
  /** Per-page findings already measured by the page scan, by URL. */
  pages: { url: string; findings: ScanFinding[] }[];
  /** Extra probes already fetched (a random path, /.git/HEAD, …). */
  probes?: { url: string; status: number; body?: string }[];
}

const SLOW_PAGE_MS = 1500;
const HEAVY_PAGE_BYTES = 400_000;

export function buildSiteFindings(input: SiteCheckInput): SiteFinding[] {
  const { crawl } = input;
  const ok = crawl.pages.filter((page) => page.error === null);
  const findings: SiteFinding[] = [];
  const push = (
    module: ScanModule,
    id: string,
    status: ScanStatus,
    observed: string,
    why: string,
    pages: string[] = []
  ) => findings.push({ module, id, status, observed, why, pages });

  // ------------------------------------------------------------- reachability
  const broken = crawl.pages.filter((page) => page.status >= 400 || page.status === 0);
  push(
    "flow",
    "broken_links",
    broken.length === 0 ? (ok.length === 0 ? "SKIPPED" : "PASS") : "FAIL",
    broken.length === 0
      ? ok.length === 0
        ? "no page could be read, so no link could be followed"
        : `no broken link among ${plural(crawl.pages.length, "1 page", `${crawl.pages.length} pages`)}`
      : `${broken.length} of ${crawl.pages.length} pages answer an error: ${broken
          .slice(0, 5)
          .map(
            (page) =>
              `${new URL(page.url).pathname} ${page.status === 0 ? "unreachable" : page.status}`
          )
          .join(", ")}`,
    "A link that returns 404 or 500 is a customer who leaves, and a crawler that stops following.",
    broken.map((page) => page.url)
  );

  const redirects = crawl.pages.filter(
    (page) => page.error === null && normalize(page.finalUrl) !== normalize(page.url)
  );
  push(
    "clean",
    "redirects",
    redirects.length === 0 ? "PASS" : redirects.length > ok.length / 2 ? "WARN" : "PASS",
    redirects.length === 0
      ? "no crawled page redirected"
      : `${redirects.length} of ${ok.length} pages land on another URL`,
    "A redirect costs a round trip and hides the canonical address; a chain of them costs several.",
    redirects.slice(0, 10).map((page) => `${page.url} → ${page.finalUrl}`)
  );

  // ------------------------------------------------------------------ titles
  const titled = ok.filter((page) => page.title !== null);
  const byTitle = groupBy(titled, (page) => (page.title ?? "").toLowerCase());
  const duplicates = [...byTitle.entries()].filter(([, pages]) => pages.length > 1);
  push(
    "clean",
    "duplicate_titles",
    titled.length < 2 ? "SKIPPED" : duplicates.length === 0 ? "PASS" : "WARN",
    titled.length < 2
      ? `only ${titled.length} titled page read: nothing to compare`
      : duplicates.length === 0
        ? `all ${titled.length} titled pages are distinct`
        : `${duplicates.reduce((sum, [, pages]) => sum + pages.length, 0)} pages share ${
            duplicates.length === 1 ? "one title" : `${duplicates.length} titles`
          }: “${duplicates[0]?.[0] ?? ""}” on ${duplicates[0]?.[1].length ?? 0}`,
    "Two pages with one title are two pages a search engine picks one of, and a customer cannot tell apart in a tab.",
    duplicates.flatMap(([, pages]) => pages.map((page) => page.url))
  );

  const untitled = ok.filter((page) => page.title === null);
  push(
    "clean",
    "missing_titles",
    ok.length === 0
      ? "SKIPPED"
      : untitled.length === 0
        ? "PASS"
        : untitled.length > ok.length / 2
          ? "FAIL"
          : "WARN",
    ok.length === 0
      ? "no page could be read"
      : untitled.length === 0
        ? `all ${ok.length} ${plural(ok.length, "page has", "pages have")} a title`
        : `${untitled.length} of ${ok.length} ${plural(ok.length, "page has", "pages have")} no <title>`,
    "The title is the tab, the bookmark and the search result: without it the page has no name.",
    untitled.map((page) => page.url)
  );

  // ------------------------------------------------------------------ weight
  const heavy = ok.filter((page) => page.bytes > HEAVY_PAGE_BYTES);
  push(
    "clean",
    "heavy_pages",
    ok.length === 0 ? "SKIPPED" : heavy.length === 0 ? "PASS" : "WARN",
    ok.length === 0
      ? "no page read"
      : heavy.length === 0
        ? `heaviest page is ${Math.round(Math.max(...ok.map((page) => page.bytes)) / 1024)} kB of HTML`
        : `${heavy.length} ${plural(heavy.length, "page", "pages")} above ${HEAVY_PAGE_BYTES / 1000} kB of HTML (heaviest ${Math.round(
            Math.max(...heavy.map((page) => page.bytes)) / 1024
          )} kB)`,
    "The HTML has to arrive before anything is drawn; on a mobile network the wait is visible.",
    heavy.map((page) => page.url)
  );

  // ------------------------------------------------------------------- speed
  const slow = ok.filter((page) => page.durationMs > SLOW_PAGE_MS);
  push(
    "clean",
    "slow_pages",
    ok.length === 0 ? "SKIPPED" : slow.length === 0 ? "PASS" : "WARN",
    ok.length === 0
      ? "no page read"
      : slow.length === 0
        ? `slowest page answered in ${Math.max(...ok.map((page) => page.durationMs))} ms`
        : `${slow.length} ${plural(slow.length, "page", "pages")} took over ${SLOW_PAGE_MS} ms (slowest ${Math.max(
            ...slow.map((page) => page.durationMs)
          )} ms)`,
    "Server time is the floor of every perceived speed; above it, no front-end trick helps.",
    slow.map((page) => page.url)
  );

  // --------------------------------------------------------- per-page services
  const withFindings = input.pages.filter((page) => page.findings.length > 0);
  const insecurePages = withFindings.filter((page) =>
    page.findings.some((finding) => finding.id === "tls" && finding.status === "FAIL")
  );
  push(
    "fail",
    "pages_without_tls",
    withFindings.length === 0 ? "SKIPPED" : insecurePages.length === 0 ? "PASS" : "FAIL",
    withFindings.length === 0
      ? "no page was measured"
      : insecurePages.length === 0
        ? `${withFindings.length} ${plural(withFindings.length, "page", "pages")} served over https`
        : `${insecurePages.length} ${plural(insecurePages.length, "page", "pages")} served over http`,
    "One page over http is enough to leak a session cookie or a password typed on it.",
    insecurePages.map((page) => page.url)
  );

  const noHsts = withFindings.filter((page) =>
    page.findings.some((finding) => finding.id === "hsts" && finding.status === "FAIL")
  );
  push(
    "fail",
    "pages_without_hsts",
    withFindings.length === 0 ? "SKIPPED" : noHsts.length === 0 ? "PASS" : "WARN",
    withFindings.length === 0
      ? "no page was measured"
      : noHsts.length === 0
        ? "every measured page sends HSTS"
        : `${noHsts.length} of ${withFindings.length} pages ${
            noHsts.length === 1 ? "sends" : "send"
          } no Strict-Transport-Security`,
    "HSTS is per-response: one page without it reopens the downgrade the others closed.",
    noHsts.map((page) => page.url)
  );

  // --------------------------------------------------------------- discovery
  push(
    "exit",
    "sitemap",
    crawl.sitemap?.found ? "PASS" : "WARN",
    crawl.sitemap?.found
      ? `sitemap.xml declares ${crawl.sitemap.urls} URL(s)`
      : "no sitemap.xml at the origin root",
    "A sitemap is how a search engine and a customer's export find the pages that are not linked.",
    []
  );

  push(
    "exit",
    "robots",
    crawl.robots?.found ? "PASS" : "WARN",
    crawl.robots?.found
      ? crawl.robots.disallowed.length === 0
        ? "robots.txt present, no path disallowed"
        : `robots.txt disallows ${crawl.robots.disallowed.length} path(s)`
      : "no robots.txt at the origin root",
    "robots.txt is where a site says what a machine may read; its absence is a policy left to guesswork.",
    []
  );

  // ------------------------------------------------------------ static assets
  const sourceMaps = crawl.pages.flatMap((page) =>
    page.assets
      .filter((asset) => asset.url.endsWith(".map"))
      .map((asset) => ({ page: page.url, asset: asset.url }))
  );
  push(
    "fail",
    "source_maps_exposed",
    sourceMaps.length === 0 ? "PASS" : "WARN",
    sourceMaps.length === 0
      ? "no .map file referenced by the crawled pages"
      : `${sourceMaps.length} source ${plural(sourceMaps.length, "map", "maps")} referenced from ${
          new Set(sourceMaps.map((item) => item.page)).size
        } pages`,
    "A published source map returns your original code, comments included, to anyone who opens devtools.",
    [...new Set(sourceMaps.map((item) => item.asset))].slice(0, 10)
  );

  const insecureAssets = crawl.pages.flatMap((page) =>
    page.assets
      .filter((asset) => asset.url.startsWith("http://"))
      .map((asset) => ({ page: page.url, asset: asset.url }))
  );
  push(
    "fail",
    "mixed_content_site",
    insecureAssets.length === 0 ? "PASS" : "FAIL",
    insecureAssets.length === 0
      ? "every referenced asset is https"
      : `${insecureAssets.length} ${plural(insecureAssets.length, "asset", "assets")} loaded over http across ${
          new Set(insecureAssets.map((item) => item.page)).size
        } pages`,
    "A script or an image over http is blocked by the browser or downgrades the protection of the page.",
    [...new Set(insecureAssets.map((item) => item.asset))].slice(0, 10)
  );

  // ----------------------------------------------------------- crawl coverage
  push(
    "clean",
    "crawl_coverage",
    crawl.pages.length === 0 ? "SKIPPED" : crawl.truncated ? "WARN" : "PASS",
    crawl.pages.length === 0
      ? "no page was read"
      : crawl.truncated
        ? `${crawl.pages.length} pages read, crawl stopped by the ${
            crawl.truncatedBy === "depth" ? "depth limit" : "page limit"
          }`
        : `${crawl.pages.length} pages read, no limit reached`,
    "A verdict about a site is only worth the pages it covers; the rest is reported as not read.",
    []
  );

  return findings;
}

function normalize(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return url;
  }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const bucket = map.get(key(item));
    if (bucket) bucket.push(item);
    else map.set(key(item), [item]);
  }
  return map;
}

/** One module's score, with the numbers it came from. */
export interface ModuleScore {
  module: ScanModule;
  /** Controls with a verdict: PASSED, WARNING or FAILED weigh in. */
  measured: number;
  passed: number;
  warnings: number;
  failed: number;
  /** Not judged: skipped, not applicable, blocked by a limit. */
  unmeasured: number;
  /** 0–1. Severity-weighted pass rate, before the interval. */
  rate: number;
  /** 0–1. Wilson lower bound at 95 %, so a small sample cannot score high. */
  lower: number;
  /** 0–100, rounded: `lower × 100`. What the UI shows. */
  score: number;
  /** 0–1. Measured over measured+unmeasured. */
  coverage: number;
  verdict: "pass" | "warnings" | "fail" | "not_measured";
}

/**
 * Scores a set of findings, per module.
 *
 * The formula, in the open because a score nobody can recompute is a slogan:
 *
 *   1. Every control carries a weight from its `risk` in the registry (high 3, medium 2,
 *      low 1). A failure costs its full weight, a warning half of it.
 *   2. `rate = 1 - cost / totalWeight` over the controls that were actually judged.
 *   3. `lower` is the Wilson score interval at 95 % on (passed weight, total weight),
 *      which punishes a high rate measured on three controls.
 *   4. `score = round(100 × lower)`, and a module with nothing judged scores 0 with the
 *      verdict `not_measured` — never 100.
 *
 * A failed control therefore lowers the score more than a missing one, and a site with a
 * small, well-measured surface cannot claim a perfect score.
 */
export function scoreFindings(
  findings: { module: ScanModule; status: ScanStatus; risk?: "low" | "medium" | "high" }[],
  modules: readonly ScanModule[] = ["fail", "clean", "flow", "world", "exit"]
): ModuleScore[] {
  return modules.map((module) => {
    const own = findings.filter((finding) => finding.module === module);
    const weightOf = (risk: "low" | "medium" | "high" | undefined): number =>
      risk === "high" ? 3 : risk === "low" ? 1 : 2;

    let total = 0;
    let cost = 0;
    let passed = 0;
    let warnings = 0;
    let failed = 0;
    let unmeasured = 0;
    let judgedWeight = 0;

    for (const finding of own) {
      const weight = weightOf(finding.risk);
      if (finding.status === "PASS") {
        passed += 1;
        judgedWeight += weight;
        total += weight;
      } else if (finding.status === "WARN") {
        warnings += 1;
        cost += weight * 0.5;
        judgedWeight += weight;
        total += weight;
      } else if (finding.status === "FAIL") {
        failed += 1;
        cost += weight;
        judgedWeight += weight;
        total += weight;
      } else {
        unmeasured += 1;
      }
    }

    const measured = passed + warnings + failed;
    const rate = total === 0 ? 0 : Math.max(0, 1 - cost / total);
    // The interval is computed on the *weighted pass rate*, not on "count of PASS only":
    // a warning is half a pass, and a module made of warnings must land between 0 and 100
    // instead of collapsing to 0 as if everything had failed.
    const lower = total === 0 ? 0 : wilsonLower(rate * judgedWeight, judgedWeight);
    const score = Math.round(lower * 100);
    const coverage = own.length === 0 ? 0 : measured / (measured + unmeasured);
    const verdict: ModuleScore["verdict"] =
      measured === 0 ? "not_measured" : failed > 0 ? "fail" : warnings > 0 ? "warnings" : "pass";

    return {
      module,
      measured,
      passed,
      warnings,
      failed,
      unmeasured,
      rate: Number(rate.toFixed(4)),
      lower: Number(lower.toFixed(4)),
      score,
      coverage: Number(coverage.toFixed(4)),
      verdict,
    };
  });
}

/**
 * Wilson score interval, lower bound, at 95 %.
 *
 * Chosen over `passes / total` because it answers the question a customer actually asks:
 * "how much can I trust this number?" Three controls with two passes give 0.67 raw and 0.21
 * here — the honest reading of a sample that small.
 */
export function wilsonLower(passes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = Math.min(1, Math.max(0, passes / total));
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (centre - margin) / denominator);
}

/** The site-wide score: coverage-weighted, so a shallow crawl cannot look perfect. */
export function siteScore(scores: ModuleScore[]): {
  score: number;
  coverage: number;
  provisional: boolean;
} {
  const judged = scores.filter((score) => score.verdict !== "not_measured");
  if (judged.length === 0) return { score: 0, coverage: 0, provisional: true };
  const coverage = judged.reduce((sum, score) => sum + score.coverage, 0) / judged.length;
  const mean = judged.reduce((sum, score) => sum + score.score, 0) / judged.length;
  // A site measured on 40 % of its controls cannot be presented as fully verified: the score
  // is discounted by coverage, and the caller is told the number is provisional.
  const discounted = mean * (0.5 + 0.5 * coverage);
  return {
    score: Math.round(discounted),
    coverage: Number(coverage.toFixed(4)),
    provisional: coverage < 0.75,
  };
}
