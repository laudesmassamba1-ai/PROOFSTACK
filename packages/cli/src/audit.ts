/**
Colour + output helpers local to this module: the audit command must work with
NO_COLOR, non-TTY and Windows exactly like the rest of the CLI.
*/

export interface AuditFlags {
  json: boolean;
  color: boolean;
}

const enabled = (flags: AuditFlags): boolean => flags.color;

const green = (f: AuditFlags, t: string) => (enabled(f) ? `\u001B[32m${t}\u001B[0m` : t);
const red = (f: AuditFlags, t: string) => (enabled(f) ? `\u001B[31m${t}\u001B[0m` : t);
const yellow = (f: AuditFlags, t: string) => (enabled(f) ? `\u001B[33m${t}\u001B[0m` : t);
const dim = (f: AuditFlags, t: string) => (enabled(f) ? `\u001B[2m${t}\u001B[0m` : t);
const bold = (f: AuditFlags, t: string) => (enabled(f) ? `\u001B[1m${t}\u001B[0m` : t);

/**
 * FAIL and CLEAN audits: real HTTP checks against a real URL.
 *
 * The same guarantees as everywhere else in PROOFCORE: every check reports the
 * exact observed value, nothing is invented, and a passing check is reported as
 * a pass. Exit codes follow the CLI contract: 0 when no check failed,
 * 1 when at least one FAILED, 2 on harness error.
 */

export type AuditKind = "fail" | "clean";

export interface AuditCheck {
  id: string;
  status: "PASS" | "WARN" | "FAIL";
  observed: string;
  why: string;
}

export interface AuditResult {
  kind: AuditKind;
  url: string;
  finalUrl: string;
  status: number;
  elapsedMs: number;
  score: number;
  grade?: string;
  checks: AuditCheck[];
}

const USER_AGENT = "PROOFCORE-Audit/0.2 (+real checks; respects robots intent)";

async function fetchTarget(url: string): Promise<{ response: Response; text: string; ms: number }> {
  const started = Date.now();
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  return { response, text, ms: Date.now() - started };
}

/** The scanned URL must be absolute http(s). */
export function parseAuditTarget(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not an absolute URL (example: https://app.example/).`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  return parsed;
}

function push(
  checks: AuditCheck[],
  id: string,
  ok: boolean,
  observed: string,
  why: string,
  warnOnly = false
): void {
  checks.push({ id, status: ok ? "PASS" : warnOnly ? "WARN" : "FAIL", observed, why });
}

export async function runFailAudit(url: string): Promise<AuditResult> {
  const { response, text, ms } = await fetchTarget(url);
  const headers = response.headers;
  const checks: AuditCheck[] = [];
  const csp = headers.get("content-security-policy");
  const hsts = headers.get("strict-transport-security");
  const frame = headers.get("x-frame-options") ?? headers.get("content-security-policy");
  const referrer = headers.get("referrer-policy");
  const permissions = headers.get("permissions-policy");
  const poweredBy = headers.get("x-powered-by");
  const cookies = headers.get("set-cookie");

  push(
    checks,
    "tls_https",
    url.startsWith("https://"),
    url.startsWith("https://") ? "https" : "http",
    "Credentials and data must travel over TLS."
  );
  push(checks, "hsts", Boolean(hsts), hsts ?? "absent", "HSTS prevents protocol downgrade.");
  push(
    checks,
    "csp",
    Boolean(csp),
    csp ? csp.slice(0, 80) : "absent",
    "A Content-Security-Policy limits XSS impact."
  );
  push(
    checks,
    "frame_options",
    Boolean(frame),
    frame ?? "absent",
    "Clickjacking protection.",
    true
  );
  push(
    checks,
    "referrer_policy",
    Boolean(referrer),
    referrer ?? "absent",
    "Referrer control limits data leakage.",
    true
  );
  push(
    checks,
    "permissions_policy",
    Boolean(permissions),
    permissions ?? "absent",
    "Limits browser feature access.",
    true
  );
  push(
    checks,
    "server_banner",
    !poweredBy,
    poweredBy ?? headers.get("server") ?? "none",
    "Version banners help attackers.",
    true
  );
  if (cookies) {
    const lower = cookies.toLowerCase();
    push(
      checks,
      "cookie_secure",
      lower.includes("secure"),
      lower.includes("secure") ? "Secure" : "missing Secure",
      "Session cookies need Secure."
    );
    push(
      checks,
      "cookie_httponly",
      lower.includes("httponly"),
      lower.includes("httponly") ? "HttpOnly" : "missing HttpOnly",
      "HttpOnly blocks script theft of cookies."
    );
  }
  const mixed =
    url.startsWith("https://") && /http:\/\/[^"'\s>]+/.test(text.replace(/https:\/\//g, ""));
  push(
    checks,
    "mixed_content",
    !mixed,
    mixed ? "http:// resources found" : "none",
    "Mixed content breaks TLS guarantees.",
    true
  );
  const verboseError = /(\bstack trace\b|at .+:\d+:\d+|Exception in thread)/i.test(text);
  push(
    checks,
    "error_disclosure",
    !verboseError,
    verboseError ? "stack traces visible" : "clean",
    "Verbose errors leak internals.",
    true
  );

  const failed = checks.filter((check) => check.status === "FAIL").length;
  const warned = checks.filter((check) => check.status === "WARN").length;
  const score = Math.round((100 * (checks.length - failed - 0.5 * warned)) / checks.length);
  return {
    kind: "fail",
    url,
    finalUrl: response.url,
    status: response.status,
    elapsedMs: ms,
    score,
    checks,
  };
}

export async function runCleanAudit(url: string): Promise<AuditResult> {
  const { response, text: html, ms } = await fetchTarget(url);
  const checks: AuditCheck[] = [];
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const lang = /<html[^>]+lang=["'][a-z-]{2,8}["']/i.test(html);
  const title = /<title>[^<]{3,120}<\/title>/i.test(html);
  const description = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(html);
  const images = [...html.matchAll(/<img\b[^>]*>/gi)];
  const withAlt = images.filter((tag) => tag[0] !== undefined && /alt=/.test(tag[0]));
  const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)];
  const labelsInForms = forms.filter(
    (form) => form[0] !== undefined && /<label|aria-label/i.test(form[0])
  );
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  const headingOrderOk = headings.every((level, index) => {
    const previous = headings[index - 1];
    return index === 0 || previous === undefined || level - previous <= 1;
  });
  const semantics = /<(main|header|footer|nav|article|section)\b/i.test(html);
  const inlineStyles = (html.match(/style=["']/g) ?? []).length;
  const scriptCount = (html.match(/<script\b/g) ?? []).length;

  push(
    checks,
    "viewport_meta",
    viewport,
    viewport ? "present" : "absent",
    "Without it mobile rendering breaks."
  );
  push(
    checks,
    "html_lang",
    lang,
    lang ? "present" : "absent",
    "Screen readers and translation need it."
  );
  push(checks, "title", title, title ? "present" : "absent", "Tabs, bookmarks and SEO rely on it.");
  push(
    checks,
    "meta_description",
    description,
    description ? "present" : "absent",
    "Search result quality.",
    true
  );
  push(
    checks,
    "img_alt",
    images.length === 0 || withAlt.length / images.length >= 0.9,
    `${withAlt.length}/${images.length} images with alt`,
    "Alt text is core accessibility."
  );
  push(
    checks,
    "form_labels",
    forms.length === 0 || labelsInForms.length === forms.length,
    `${labelsInForms.length}/${forms.length} forms labelled`,
    "Inputs need accessible names."
  );
  push(
    checks,
    "heading_order",
    headings.length === 0 || headingOrderOk,
    `${headings.length} headings`,
    "Heading hierarchy guides navigation.",
    true
  );
  push(
    checks,
    "semantic_landmarks",
    semantics,
    semantics ? "present" : "absent",
    "Landmark elements structure the page."
  );
  push(
    checks,
    "inline_styles",
    inlineStyles <= 10,
    `${inlineStyles} inline styles`,
    "Inline styles hurt consistency.",
    true
  );
  push(
    checks,
    "html_weight",
    html.length <= 150_000,
    `${Math.round(html.length / 1024)} kB`,
    "Heavy documents delay first paint."
  );
  push(
    checks,
    "scripts",
    scriptCount <= 15,
    `${scriptCount} script tags`,
    "Too many scripts delay interactivity.",
    true
  );
  push(checks, "response_time", ms <= 1500, `${ms} ms`, "Slow HTML delays everything else.");

  const failed = checks.filter((check) => check.status === "FAIL").length;
  const warned = checks.filter((check) => check.status === "WARN").length;
  const score = Math.round((100 * (checks.length - failed - 0.5 * warned)) / checks.length);
  return {
    kind: "clean",
    url,
    finalUrl: response.url,
    status: response.status,
    elapsedMs: ms,
    score,
    grade: score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "E",
    checks,
  };
}

export function renderAudit(result: AuditResult, flags: AuditFlags): void {
  const w = (text: string): void => stdout_write(text);
  const failed = result.checks.filter((check) => check.status === "FAIL");
  const warned = result.checks.filter((check) => check.status === "WARN");
  w("");
  w(bold(flags, `${result.kind.toUpperCase()} · ${result.url}`));
  w(
    dim(
      flags,
      `HTTP ${result.status} · ${result.elapsedMs} ms · score ${result.score}/100${result.grade ? ` (${result.grade})` : ""}`
    )
  );
  w("");
  for (const check of result.checks) {
    const glyph =
      check.status === "PASS"
        ? green(flags, "✓")
        : check.status === "WARN"
          ? yellow(flags, "!")
          : red(flags, "×");
    w(`  ${glyph} ${check.id.padEnd(20)} ${check.status.padEnd(5)} ${check.observed}`);
    if (check.status !== "PASS") w(dim(flags, `      ${check.why}`));
  }
  w("");
  w(
    dim(
      flags,
      `${failed.length} fail · ${warned.length} warn · ${result.checks.length - failed.length - warned.length} pass`
    )
  );
}

// Small indirection so renderAudit stays testable without importing globals oddly.
function stdout_write(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function printAuditHelp(flags: AuditFlags): void {
  const w = (text: string): void => {
    stdout_write(text);
  };
  w(bold(flags, "audit"));
  w("  proofcore audit fail  <url>   Security & defect scan (headers, cookies, disclosure)");
  w("  proofcore audit clean <url>   UI quality audit with a score and a grade");
  w("");
  w("Exit codes: 0 no failure · 1 at least one FAILED check · 2 harness error");
  w(
    dim(
      flags,
      "These audits run real HTTP requests against the URL you give them. Nothing is simulated."
    )
  );
}
