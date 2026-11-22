/**
 * Auditing a site, not a URL.
 *
 * This is the engine the CLI, the API and the assistant all call. It does four things in
 * order, and each one is allowed to say "no further":
 *
 *   1. **Sign in**, if credentials were given. A refused login is reported, and the audit
 *      then covers the public surface with the login failure stated in the report — never a
 *      public scan labelled "signed in".
 *   2. **Measure the named page**, in full: every control, every probe. This is the page the
 *      user asked about, so it gets the deepest reading.
 *   3. **Crawl** from it, and measure the other pages with the same control set in light mode
 *      (one request each), so the site-level facts are computed on real pages.
 *   4. **Score**. Severity-weighted, Wilson-bounded, coverage-weighted — the maths lives in
 *      `site-scan.ts` and can be recomputed by hand.
 *
 * The result says what it read, what it could not read, and why. Nothing is filled in.
 */

import { controlFor } from "./controls.js";
import type { CrawlOptions, CrawlPage, CrawlResult } from "./crawl.js";
import { crawlSite } from "./crawl.js";
import {
  assertScannableUrl,
  type ScanFinding,
  type ScanOptions,
  type ScanResult,
  scanPage,
} from "./page-scan.js";
import { type SignInOptions, type SignInReport, signIn } from "./session.js";
import {
  buildSiteFindings,
  type ModuleScore,
  type SiteFinding,
  scoreFindings,
  siteScore,
} from "./site-scan.js";

export interface SiteAuditOptions {
  url: string;
  /** Present only when the product is behind a login. */
  login?: Omit<SignInOptions, "fetchImpl" | "timeoutMs">;
  crawl?: {
    maxPages?: number;
    maxDepth?: number;
    pathPrefix?: string;
    allowExternal?: boolean;
    exclude?: RegExp[];
  };
  /** How many crawled pages get the control set beyond the named one. */
  maxMeasuredPages?: number;
  fetchImpl?: typeof fetch;
  allowPrivate?: boolean;
  timeoutMs?: number;
  /** Progress, in order, for a streamed UI. Never contains a secret. */
  onProgress?: (event: {
    step: "login" | "scan" | "crawl" | "measure" | "score";
    message: string;
    page?: string;
    done?: number;
    total?: number;
  }) => void;
}

export interface MeasuredPage {
  url: string;
  finalUrl: string;
  status: number;
  title: string | null;
  bytes: number;
  durationMs: number;
  depth: number;
  findings: ScanFinding[];
  /** False when the page was crawled but not measured with the control set. */
  measured: boolean;
  error: string | null;
}

export interface SiteAuditResult {
  scan: ScanResult;
  login: SignInReport | null;
  site: {
    pages: MeasuredPage[];
    skipped: { url: string; reason: string }[];
    robots: CrawlResult["robots"];
    sitemap: CrawlResult["sitemap"];
    truncated: boolean;
    truncatedBy: CrawlResult["truncatedBy"];
    requests: number;
    durationMs: number;
    /** Site-level findings, the ones a single page cannot produce. */
    findings: SiteFinding[];
  };
  scores: ModuleScore[];
  score: { score: number; coverage: number; provisional: boolean };
  /** Controls that got a verdict, site-wide. */
  measuredControls: number;
}

/** A control's risk, taken from the registry so the score and the text cannot disagree. */
function riskOf(module: string, id: string): "low" | "medium" | "high" | undefined {
  return controlFor(module as never, id)?.risk;
}

export async function auditSite(options: SiteAuditOptions): Promise<SiteAuditResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const guard = (url: URL): void => {
    assertScannableUrl(url.toString(), { allowPrivate: options.allowPrivate });
  };
  const start = new URL(options.url);
  guard(start);

  // --------------------------------------------------------------------- login
  let loginReport: SignInReport | null = null;
  let cookieHeader: ((url: string) => string | null) | undefined;
  let authorization: string | null = null;
  if (options.login) {
    options.onProgress?.({ step: "login", message: "signing in" });
    const attempt = await signIn({
      ...options.login,
      fetchImpl: doFetch,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
    loginReport = attempt.report;
    if (attempt.report.ok) {
      cookieHeader = (url: string) => attempt.jar.header(new URL(url));
      authorization = attempt.authorization;
      options.onProgress?.({
        step: "login",
        message: `signed in with the ${attempt.report.method} flow`,
      });
    } else {
      // The crawl still runs, on the public surface, and the report carries the reason. A
      // caller that needs a session must check `login.ok`; the engine never pretends.
      options.onProgress?.({
        step: "login",
        message: `login refused: ${attempt.report.reason ?? "unknown reason"}`,
      });
    }
  }

  /** Headers for a request to `url`: the session cookie and the bearer token, when present. */
  const headersFor = (url: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (authorization !== null) headers.authorization = authorization;
    const cookie = cookieHeader?.(url) ?? null;
    if (cookie !== null && cookie.length > 0) headers.cookie = cookie;
    return headers;
  };

  // ------------------------------------------------- measure the named page first
  options.onProgress?.({ step: "scan", message: "measuring the page" });
  const scanOptions: ScanOptions = {
    fetchImpl: doFetch,
    allowPrivate: options.allowPrivate,
    headers: headersFor(start.toString()),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const scan = await scanPage(start.toString(), scanOptions);

  // --------------------------------------------------------------------- crawl
  const crawlOptions: CrawlOptions = {
    fetchImpl: doFetch,
    guard,
    timeoutMs: options.timeoutMs ?? 12_000,
    headers: authorization === null ? {} : { authorization },
    ...(cookieHeader === undefined ? {} : { cookieHeader }),
    ...(options.crawl?.maxPages === undefined ? {} : { maxPages: options.crawl.maxPages }),
    ...(options.crawl?.maxDepth === undefined ? {} : { maxDepth: options.crawl.maxDepth }),
    ...(options.crawl?.pathPrefix === undefined ? {} : { pathPrefix: options.crawl.pathPrefix }),
    ...(options.crawl?.allowExternal === undefined
      ? {}
      : { allowExternal: options.crawl.allowExternal }),
    ...(options.crawl?.exclude === undefined ? {} : { exclude: options.crawl.exclude }),
    onPage: (page, discovered) => {
      options.onProgress?.({
        step: "crawl",
        message: `read ${new URL(page.url).pathname} (${page.status})`,
        page: page.url,
        done: discovered,
      });
    },
  };
  options.onProgress?.({ step: "crawl", message: "reading the site" });
  const crawl = await crawlSite(start.toString(), crawlOptions);

  // ------------------------------------------------------- measure the rest
  const others: CrawlPage[] = crawl.pages.filter(
    (page) =>
      page.error === null &&
      normalize(page.finalUrl) !== normalize(scan.finalUrl) &&
      normalize(page.url) !== normalize(start.toString())
  );
  const budget = Math.max(0, Math.min(options.maxMeasuredPages ?? 9, others.length));
  const toMeasure = others.slice(0, budget);

  options.onProgress?.({
    step: "measure",
    message: `measuring ${toMeasure.length} more page(s)`,
    done: 0,
    total: toMeasure.length,
  });

  const measured: MeasuredPage[] = [
    {
      url: start.toString(),
      finalUrl: scan.finalUrl,
      status: scan.status,
      title: readTitleOf(scan),
      bytes: scan.bytes,
      durationMs: scan.durationMs,
      depth: 0,
      findings: scan.findings,
      measured: true,
      error: null,
    },
  ];

  for (const [index, page] of toMeasure.entries()) {
    try {
      const pageScan = await scanPage(page.finalUrl, {
        fetchImpl: doFetch,
        allowPrivate: options.allowPrivate,
        // One request per page: the crawl already paid for the site-level facts.
        light: true,
        headers: headersFor(page.finalUrl),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      measured.push({
        url: page.url,
        finalUrl: page.finalUrl,
        status: page.status,
        title: page.title,
        bytes: page.bytes,
        durationMs: page.durationMs,
        depth: page.depth,
        findings: pageScan.findings,
        measured: true,
        error: null,
      });
    } catch (error) {
      measured.push({
        url: page.url,
        finalUrl: page.finalUrl,
        status: page.status,
        title: page.title,
        bytes: page.bytes,
        durationMs: page.durationMs,
        depth: page.depth,
        findings: [],
        measured: false,
        error: error instanceof Error ? error.message : "could not be measured",
      });
    }
    options.onProgress?.({
      step: "measure",
      message: `measured ${new URL(page.url).pathname}`,
      page: page.url,
      done: index + 1,
      total: toMeasure.length,
    });
  }

  // Pages that were crawled but not measured stay in the report, marked as such.
  for (const page of crawl.pages) {
    if (measured.some((entry) => normalize(entry.url) === normalize(page.url))) continue;
    if (normalize(page.url) === normalize(start.toString())) continue;
    measured.push({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      title: page.title,
      bytes: page.bytes,
      durationMs: page.durationMs,
      depth: page.depth,
      findings: [],
      measured: false,
      error: page.error ?? "not measured: the measurement budget was reached",
    });
  }

  // --------------------------------------------------------- site-level checks
  const siteFindings = buildSiteFindings({
    crawl,
    pages: measured
      .filter((entry) => entry.measured)
      .map((entry) => ({ url: entry.url, findings: entry.findings })),
  });

  // -------------------------------------------------------------------- score
  options.onProgress?.({ step: "score", message: "scoring" });
  const weighted = [
    ...scan.findings.map((finding) => ({
      module: finding.module,
      status: finding.status,
      risk: riskOf(finding.module, finding.id),
    })),
    ...siteFindings.map((finding) => ({
      module: finding.module,
      status: finding.status,
      risk: riskOf(finding.module, finding.id),
    })),
  ];
  const scores = scoreFindings(weighted);

  // One truth for the score: the module cards in the UI read `scan.modules`, so they are
  // rebuilt from the site-aware scores instead of the page-only summary, which would show
  // a different number for the same module.
  const moduleSummaries = scores.map((score) => ({
    module: score.module,
    passed: score.passed,
    warnings: score.warnings,
    failed: score.failed,
    skipped: score.unmeasured,
    score: score.score,
    verdict: score.verdict,
  }));

  // The scan's own findings become the report's findings, with the site-level ones appended:
  // the payload carries evidence, and every entry names the number it is about.
  const mergedFindings: ScanFinding[] = [
    ...scan.findings,
    ...siteFindings.map((finding) => ({
      module: finding.module,
      id: finding.id,
      status: finding.status,
      observed: finding.observed,
      why: finding.why,
    })),
  ];

  return {
    scan: { ...scan, findings: mergedFindings, modules: moduleSummaries },
    login: loginReport,
    site: {
      pages: measured,
      skipped: crawl.skipped,
      robots: crawl.robots,
      sitemap: crawl.sitemap,
      truncated: crawl.truncated,
      truncatedBy: crawl.truncatedBy,
      requests: crawl.requests,
      durationMs: crawl.durationMs,
      findings: siteFindings,
    },
    scores,
    score: siteScore(scores),
    measuredControls: weighted.filter(
      (finding) =>
        finding.status === "PASS" || finding.status === "WARN" || finding.status === "FAIL"
    ).length,
  };
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

function readTitleOf(scan: ScanResult): string | null {
  const finding = scan.findings.find((item) => item.module === "clean" && item.id === "title");
  if (!finding) return null;
  return finding.status === "FAIL" ? null : finding.observed;
}
