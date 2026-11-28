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
  type PageRenderer,
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
  /**
   * Headers supplied by the caller, typically a session cookie copied from a browser.
   * They are sent to the named page and to every crawled page, so a caller that cannot
   * submit a login form can still audit the whole authenticated surface. Never stored.
   */
  headers?: Record<string, string>;
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
  /** Browser renderer for JavaScript-rendered sites, forwarded to the scan and the crawl. */
  renderer?: PageRenderer;
  allowPrivate?: boolean;
  timeoutMs?: number;
  /**
   * The token the site owner published. Forwarded to the page scans so a verified owner
   * gets the exact observations, not the redacted shapes.
   */
  ownershipToken?: string;
  /**
   * Progress, in order, for a streamed UI. Never contains a secret.
   *
   * `step` and the counts are the contract; `message` is an English fallback for library
   * callers. A surface that shows progress to people writes its own sentence from the
   * structured fields, which is why the French app never prints these English strings.
   */
  onProgress?: (event: {
    step: "login" | "scan" | "crawl" | "measure" | "score";
    message: string;
    page?: string;
    done?: number;
    total?: number;
    status?: number;
    ok?: boolean;
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
  /** Where the sign-in actually landed: a private home the public page cannot link to. */
  let signedInLanding: string | null = null;
  const suppliedHeaders = options.headers ?? {};
  const suppliedCookie = Object.entries(suppliedHeaders).find(
    ([name]) => name.toLowerCase() === "cookie"
  )?.[1];
  if (options.login) {
    options.onProgress?.({ step: "login", message: "signing in" });
    // A JavaScript form (Firebase, Supabase, a custom fetch) has no HTTP action. When the
    // renderer can drive a browser, let it sign in and carry its session into the crawl;
    // otherwise the HTTP ladder reports exactly why it could not establish a session.
    if (options.renderer?.signIn) {
      try {
        const browserAttempt = await options.renderer.signIn({
          // `url` is the field every caller already fills (the API maps `login.url` to it);
          // `loginPageUrl`/`loginUrl` are the finer-grained overrides.
          url:
            options.login.loginPageUrl ??
            options.login.loginUrl ??
            (options.login as { url?: string }).url ??
            start.toString(),
          email: options.login.email,
          password: options.login.password,
          ...(options.login.emailField === undefined
            ? {}
            : { emailField: options.login.emailField }),
          ...(options.login.passwordField === undefined
            ? {}
            : { passwordField: options.login.passwordField }),
          timeoutMs: options.timeoutMs ?? 15_000,
        });
        if (browserAttempt.ok && browserAttempt.landedOn) {
          signedInLanding = browserAttempt.landedOn;
        }
        loginReport = {
          ok: browserAttempt.ok,
          landedOn: browserAttempt.landedOn,
          status: null,
          method: "form",
          emailField: options.login.emailField ?? null,
          passwordField: options.login.passwordField ?? null,
          csrf: false,
          cookies: browserAttempt.cookie
            ? browserAttempt.cookie.split(";").map((c) => c.split("=")[0] ?? "")
            : [],
          reason: browserAttempt.reason,
          mfaRequired: false,
          requests: 0,
        };
        if (browserAttempt.ok && browserAttempt.cookie) {
          const pasted = browserAttempt.cookie;
          cookieHeader = (url: string) => {
            const target = new URL(url);
            // A browser-storage session cannot be replayed as an HTTP cookie. Never send
            // a Firebase token to a different host; only the same-origin cookie is safe.
            return target.origin === start.origin ? pasted : null;
          };
        }
        options.onProgress?.({
          step: "login",
          message: browserAttempt.ok
            ? "signed in with the browser-rendered form"
            : `login refused: ${browserAttempt.reason ?? "unknown reason"}`,
          ok: browserAttempt.ok,
        });
      } catch (error) {
        loginReport = {
          ok: false,
          landedOn: null,
          status: null,
          method: "none",
          emailField: null,
          passwordField: null,
          csrf: false,
          cookies: [],
          reason: `browser sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
          mfaRequired: false,
          requests: 0,
        };
      }
    } else {
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
          ok: true,
          ...(attempt.report.status === null ? {} : { status: attempt.report.status }),
        });
      } else {
        // The crawl still runs, on the public surface, and the report carries the reason. A
        // caller that needs a session must check `login.ok`; the engine never pretends.
        options.onProgress?.({
          step: "login",
          message: `login refused: ${attempt.report.reason ?? "unknown reason"}`,
          ok: false,
          ...(attempt.report.status === null ? {} : { status: attempt.report.status }),
        });
      }
    }
  }

  /** Headers for a request to `url`: the session cookie and the bearer token, when present. */
  const headersFor = (url: string): Record<string, string> => {
    const headers: Record<string, string> = { ...suppliedHeaders };
    if (authorization !== null) headers.authorization = authorization;
    // A fresh session from a successful form login wins over a stale pasted cookie.
    const cookie = cookieHeader?.(url) ?? suppliedCookie ?? null;
    if (cookie !== null && cookie.length > 0) headers.cookie = cookie;
    return headers;
  };

  // ------------------------------------------------- measure the named page first
  options.onProgress?.({ step: "scan", message: "measuring the page" });
  const scanOptions: ScanOptions = {
    fetchImpl: doFetch,
    allowPrivate: options.allowPrivate,
    // A local target is the caller's machine; a remote one is proven by its token.
    ownershipHint: options.allowPrivate ? "local" : "remote",
    ...(options.ownershipToken === undefined ? {} : { ownershipToken: options.ownershipToken }),
    headers: headersFor(start.toString()),
    ...(options.renderer === undefined ? {} : { renderer: options.renderer }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const scan = await scanPage(start.toString(), scanOptions);

  // --------------------------------------------------------------------- crawl
  const crawlOptions: CrawlOptions = {
    fetchImpl: doFetch,
    guard,
    timeoutMs: options.timeoutMs ?? 12_000,
    headers: headersFor(start.toString()),
    ...(options.renderer === undefined ? {} : { renderer: options.renderer }),
    // A signed-in landing page is a seed, not a link from the public home: without it a
    // private application is invisible to the crawl even though the session is valid.
    ...(signedInLanding === null ? {} : { seedUrls: [signedInLanding], expandSeeds: true }),
    ...(cookieHeader === undefined && suppliedCookie === undefined
      ? {}
      : { cookieHeader: (url: string) => cookieHeader?.(url) ?? suppliedCookie ?? null }),
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
        status: page.status,
      });
    },
  };
  options.onProgress?.({ step: "crawl", message: "reading the site" });
  const crawl = await crawlSite(start.toString(), crawlOptions);

  // ------------------------------------------------------- measure the rest
  const others: CrawlPage[] = crawl.pages.filter(
    (page) =>
      // A page that never answered has no document to measure; it stays in the report as
      // an error with the network reason. Every page that did answer is measured — a 404
      // is still a response, with headers and a body, and it is part of the surface.
      page.status !== 0 &&
      normalize(page.finalUrl) !== normalize(scan.finalUrl) &&
      normalize(page.url) !== normalize(start.toString())
  );
  // Measure every crawled page by default. The crawl already paid for the document, so a
  // measurement is analysis, not another request; leaving half the site unmeasured would
  // make the structure report describe a site nobody scanned. The caller may still cap it.
  const budget =
    options.maxMeasuredPages === undefined
      ? others.length
      : Math.max(0, Math.min(options.maxMeasuredPages, others.length));
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

  // Bounded parallelism: five light measurements at a time — a crawl of twenty
  // pages finishes in about the duration of four, not twenty. Results land in
  // crawl order regardless of completion order.
  const CONCURRENCY = 5;
  const results: MeasuredPage[] = new Array(toMeasure.length);
  let cursor = 0;
  let completed = 0;
  const worker = async (): Promise<void> => {
    while (cursor < toMeasure.length) {
      const index = cursor;
      cursor += 1;
      const page = toMeasure[index];
      if (!page) break;
      try {
        const pageScan = await scanPage(page.finalUrl, {
          fetchImpl: doFetch,
          allowPrivate: options.allowPrivate,
          ownershipHint: options.allowPrivate ? "local" : "remote",
          ...(options.renderer === undefined ? {} : { renderer: options.renderer }),
          // One request per page: the crawl already read this document and its headers.
          light: true,
          document: {
            html: page.html,
            headers: new Headers(page.headers ?? {}),
            url: page.finalUrl,
            status: page.status,
            bytes: page.bytes,
            durationMs: page.durationMs,
            contentType: page.contentType,
          },
        });
        results[index] = {
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
        };
      } catch (error) {
        results[index] = {
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
        };
      }
      completed += 1;
      options.onProgress?.({
        step: "measure",
        message: `measured ${new URL(page.url).pathname}`,
        page: page.url,
        done: completed,
        total: toMeasure.length,
        status: page.status,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toMeasure.length) }, worker));
  measured.push(...results.filter((entry): entry is MeasuredPage => entry !== undefined));

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
      // Name the real reason. "Budget reached" on a page that was never in the budget hides
      // whether the fix is a bigger crawl or a bigger measurement cap.
      error:
        page.status === 0
          ? (page.error ?? "unreachable")
          : `not measured: the measurement budget covered ${budget} of ${others.length} pages`,
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
