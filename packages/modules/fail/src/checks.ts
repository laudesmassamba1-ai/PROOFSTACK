/**
 * FAIL — the security posture a page exposes over HTTP.
 *
 * Every check here is passive: it reads the one response the scan already fetched, plus the
 * visible text. Nothing probes for a vulnerability, injects a payload, or tests a login for
 * weaknesses. That boundary is the product: a FAIL report says "your headers and transport
 * are configured this way", never "you are exploitable".
 *
 * The rules that keep it honest:
 *
 *   - **A check that cannot be judged is `SKIPPED`, not `PASS`.** No cookie on the response
 *     means the flags cannot be read, so the line says so.
 *   - **`WARN` is a real finding.** A missing referrer policy weakens privacy; it is not the
 *     same exposure as a missing HSTS, and the status says which is which.
 *   - **The control registry owns the explanation.** The `why` sentence travels with the
 *     finding, so a report never depends on a model to explain a header.
 */

export type ScanStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface FailFinding {
  module: "fail";
  id: string;
  status: ScanStatus;
  /** What was observed, in one line. Never a judgement: the raw fact. */
  observed: string;
  /** Why it matters, in one sentence. */
  why: string;
}

export interface FailInput {
  /** The HTML body, already decoded. */
  html: string;
  /** The response headers, so a header check reads exactly what the server sent. */
  headers: Headers;
  /** The final address after redirects: it decides whether transport is secure. */
  url: URL;
  /** The visible text, for checks that read page content rather than headers. */
  text: string;
}

function finding(id: string, status: ScanStatus, observed: string, why: string): FailFinding {
  return { module: "fail", id, status, observed, why };
}

/** The directives of a CSP, lower-cased, with their source lists. */
function cspDirectives(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

const STRONG_REFERRER = new Set([
  "no-referrer",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
]);

/** One cookie is a flag set, not a string to grep: SameSite=None is only safe with Secure. */
function cookieProblems(cookie: string): string[] {
  const problems: string[] = [];
  if (!/;\s*secure(?:;|$)/i.test(cookie)) problems.push("Secure");
  if (!/;\s*httponly(?:;|$)/i.test(cookie)) problems.push("HttpOnly");
  const sameSite = cookie
    .match(/;\s*samesite\s*=\s*([^;]+)/i)?.[1]
    ?.trim()
    .toLowerCase();
  if (!sameSite) problems.push("SameSite");
  else if (!["lax", "strict", "none"].includes(sameSite)) problems.push("SameSite value");
  return problems;
}

function attrValue(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, "i"));
  return match ? (match[2] ?? match[3] ?? "") : null;
}

/** Cross-origin scripts and stylesheets that cannot be verified by an integrity digest. */
function externalSubresources(
  html: string,
  url: URL
): { reference: string; hasIntegrity: boolean }[] {
  const found: { reference: string; hasIntegrity: boolean }[] = [];
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag);
    if (!isScript && (attrValue(tag, "rel") ?? "").toLowerCase() !== "stylesheet") continue;
    const source = attrValue(tag, isScript ? "src" : "href");
    if (!source || /^(?:data|blob):/i.test(source)) continue;
    let resolved: URL;
    try {
      resolved = new URL(source, url);
    } catch {
      continue;
    }
    if (resolved.origin === url.origin) continue;
    found.push({
      reference: source,
      hasIntegrity: (attrValue(tag, "integrity") ?? "").trim().length > 0,
    });
  }
  return found;
}

/** Where a form containing a password field sends the credentials. */
function passwordFormDestinations(html: string, url: URL): URL[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
    .filter((match) => /<input\b[^>]*\btype\s*=\s*["']?password/i.test(match[2] ?? ""))
    .map((match) => {
      const action = attrValue(`<form ${match[1] ?? ""}>`, "action");
      try {
        return new URL(action ?? url.href, url);
      } catch {
        return null;
      }
    })
    .filter((item): item is URL => item !== null);
}

export function failFindings(input: FailInput): FailFinding[] {
  const { html, headers, url, text } = input;
  const findings: FailFinding[] = [];
  const secure = url.protocol === "https:";
  const csp = headers.get("content-security-policy");

  findings.push(
    finding(
      "tls",
      secure ? "PASS" : "FAIL",
      secure ? "https" : "served over http",
      "Credentials and data must travel over TLS."
    )
  );
  // Presence is not policy: max-age=0 disables HSTS, and a short window expires before
  // the next visit. The browser's protection is exactly the declared max-age.
  const hsts = headers.get("strict-transport-security");
  const hstsMaxAge = hsts ? Number(hsts.match(/max-age\s*=\s*(\d+)/i)?.[1] ?? NaN) : NaN;
  const hstsStatus: ScanStatus = !hsts
    ? "FAIL"
    : !Number.isFinite(hstsMaxAge) || hstsMaxAge <= 0
      ? "FAIL"
      : hstsMaxAge < 15_552_000
        ? "WARN"
        : "PASS";
  const hstsObserved = !hsts
    ? "absent"
    : !Number.isFinite(hstsMaxAge)
      ? "no max-age"
      : hstsMaxAge <= 0
        ? "max-age=0 (HSTS disabled)"
        : `max-age=${hstsMaxAge}s${hstsMaxAge < 15_552_000 ? " (< 6 months)" : ""}`;
  findings.push(
    finding(
      "hsts",
      hstsStatus,
      hstsObserved,
      "HSTS prevents a protocol downgrade from being followed."
    )
  );
  // A CSP that does not constrain scripts is a comment, not a control: read the policy
  // instead of counting its header. `unsafe-inline` and wildcards are reported, because
  // they are exactly where an injected script gets to run.
  const cspMap = csp ? cspDirectives(csp) : new Map<string, string[]>();
  const scriptPolicy = cspMap.get("script-src") ?? cspMap.get("default-src");
  const weakScripts = (scriptPolicy ?? []).filter((source) => {
    const value = source.toLowerCase();
    return (
      value === "'unsafe-inline'" ||
      value === "'unsafe-eval'" ||
      value === "*" ||
      value === "http:" ||
      value === "data:"
    );
  });
  const cspStatus: ScanStatus = !csp
    ? "FAIL"
    : !scriptPolicy
      ? "FAIL"
      : weakScripts.length > 0
        ? "WARN"
        : "PASS";
  findings.push(
    finding(
      "csp",
      cspStatus,
      !csp
        ? "absent"
        : !scriptPolicy
          ? "present but no default-src or script-src"
          : weakScripts.length > 0
            ? `weak script sources: ${weakScripts.join(", ")}`
            : csp.slice(0, 90),
      "A Content-Security-Policy limits the impact of an injected script."
    )
  );
  // Two headers can forbid framing; neither is judged by its name alone. An obsolete
  // `ALLOW-FROM` and a wildcard `frame-ancestors *` leave the page embeddable.
  const frame = headers.get("x-frame-options")?.trim().toLowerCase() ?? null;
  const frameDirective = cspMap.get("frame-ancestors") ?? [];
  const frameFromCsp = frameDirective.length > 0 ? frameDirective.join(" ") : null;
  const xfoValid = frame === "deny" || frame === "sameorigin";
  const cspFrameValid = frameDirective.length > 0 && !frameDirective.includes("*");
  const frameStatus: ScanStatus = xfoValid || cspFrameValid ? "PASS" : "WARN";
  const frameObserved =
    [
      frame ? `x-frame-options: ${frame}${xfoValid ? "" : " (ineffective)"}` : null,
      frameFromCsp ? `csp: frame-ancestors ${frameFromCsp}` : null,
    ]
      .filter(Boolean)
      .join("; ") || "absent";
  findings.push(
    finding(
      "frame_ancestors",
      frameStatus,
      frameObserved,
      "Without it the page can be embedded in someone else's frame (clickjacking)."
    )
  );
  // The browser takes the last policy in a comma-separated list, so judging the first
  // token would pass a page that actually sends `unsafe-url` last.
  const referrerHeader = headers.get("referrer-policy");
  const referrer = referrerHeader?.split(",").at(-1)?.trim().toLowerCase() ?? null;
  const referrerStatus: ScanStatus = !referrer
    ? "WARN"
    : referrer === "unsafe-url"
      ? "FAIL"
      : STRONG_REFERRER.has(referrer)
        ? "PASS"
        : "WARN";
  findings.push(
    finding(
      "referrer_policy",
      referrerStatus,
      referrer ?? "absent",
      "Controls how much of the URL leaks to third parties."
    )
  );
  findings.push(
    finding(
      "permissions_policy",
      headers.get("permissions-policy") ? "PASS" : "WARN",
      headers.get("permissions-policy") ?? "absent",
      "Limits which powerful browser features embedded content may use."
    )
  );
  // `unsafe-none` is the default; a page that sends it has not isolated its browsing
  // context. `same-origin-allow-popups` keeps OAuth popups working and is accepted.
  const coop = headers.get("cross-origin-opener-policy")?.trim().toLowerCase() ?? null;
  findings.push(
    finding(
      "coop",
      coop === "same-origin" || coop === "same-origin-allow-popups" ? "PASS" : "WARN",
      coop ?? "absent",
      "Isolates the page from a cross-origin opener, which closes an XS-Leak channel."
    )
  );
  const passwordTargets = passwordFormDestinations(html, url);
  const passwordOverHttp = passwordTargets.filter((target) => target.protocol === "http:");
  const passwordForeign = passwordTargets.filter(
    (target) => target.protocol === "https:" && target.origin !== url.origin
  );
  findings.push(
    finding(
      "password_form_action",
      passwordOverHttp.length > 0
        ? "FAIL"
        : passwordForeign.length > 0
          ? "WARN"
          : passwordTargets.length > 0
            ? "PASS"
            : "SKIPPED",
      passwordOverHttp.length > 0
        ? `password form posts to ${passwordOverHttp[0]?.origin}`
        : passwordForeign.length > 0
          ? `password form posts to ${passwordForeign[0]?.origin}`
          : passwordTargets.length > 0
            ? `posts to ${passwordTargets[0]?.origin}`
            : "no password form",
      "A password sent over http, or to another origin, leaves the account exposed."
    )
  );
  const poweredBy = headers.get("x-powered-by");
  findings.push(
    finding(
      "stack_disclosure",
      poweredBy ? "WARN" : "PASS",
      poweredBy ?? "no x-powered-by",
      "Naming your stack tells an attacker what to try first."
    )
  );
  const server = headers.get("server");
  findings.push(
    finding(
      "server_banner",
      server && /\d/.test(server) ? "WARN" : "PASS",
      server ?? "no server header",
      "A version number in the banner is free reconnaissance."
    )
  );
  const headerList = headers as Headers & { getSetCookie?: () => string[] };
  const cookieList =
    typeof headerList.getSetCookie === "function"
      ? headerList.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];
  if (cookieList.length === 0) {
    findings.push(
      finding(
        "cookie_flags",
        "SKIPPED",
        "no cookie set on this response",
        "Judged only when a cookie is issued."
      )
    );
  } else {
    // Every cookie is judged on its own flags: one hardened cookie must not hide a
    // second one that is readable by scripts.
    const problems = [...new Set(cookieList.flatMap((cookie) => cookieProblems(cookie)))];
    const prefix = cookieList.length > 1 ? `${cookieList.length} cookies; ` : "";
    findings.push(
      finding(
        "cookie_flags",
        problems.length > 0 ? "FAIL" : "PASS",
        problems.length > 0
          ? `${prefix}missing ${problems.join(", ")}`
          : "Secure, HttpOnly, SameSite",
        "A session cookie without these flags is readable or sendable by an attacker."
      )
    );
  }
  const mixed = secure
    ? [...html.matchAll(/["'(](http:\/\/[^"')\s>]+)/gi)].map((m) => m[1] ?? "")
    : [];
  const mixedExternal = mixed.filter((value) => {
    try {
      return new URL(value).host !== url.host;
    } catch {
      return false;
    }
  });
  findings.push(
    finding(
      "mixed_content",
      !secure ? "SKIPPED" : mixedExternal.length > 0 ? "FAIL" : "PASS",
      !secure
        ? "page is not https"
        : mixedExternal.length > 0
          ? `${mixedExternal.length} http:// resource(s)`
          : "none",
      "An http resource on an https page is blocked or downgrades the protection."
    )
  );
  const external = externalSubresources(html, url);
  const withoutIntegrity = external.filter((resource) => !resource.hasIntegrity);
  findings.push(
    finding(
      "sri",
      external.length === 0 ? "SKIPPED" : withoutIntegrity.length > 0 ? "WARN" : "PASS",
      external.length === 0
        ? "no cross-origin script or stylesheet"
        : withoutIntegrity.length > 0
          ? `${withoutIntegrity.length} of ${external.length} without integrity: ${withoutIntegrity[0]?.reference}`
          : `${external.length} cross-origin resource(s) with integrity`,
      "An integrity digest stops a compromised CDN from changing the code you load."
    )
  );
  const secretPatterns = [
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}/,
    /\bAIza[0-9A-Za-z_-]{35}\b/,
  ];
  const exposedSecret = secretPatterns.find((pattern) => pattern.test(html));
  findings.push(
    finding(
      "secrets_in_html",
      exposedSecret ? "FAIL" : "PASS",
      exposedSecret ? "a key-like string appears in the document" : "none found",
      "A key in the HTML is a key handed to everyone who visits."
    )
  );
  findings.push(
    finding(
      "error_disclosure",
      /\b(?:stack trace|traceback|Warning: [A-Za-z_]+\(\)|on line \d+|SQLSTATE|at .*\.php:\d+)/i.test(
        text
      )
        ? "WARN"
        : "PASS",
      "scanned the visible text",
      "Stack traces and SQL errors in a page reveal paths and schemas."
    )
  );
  findings.push(
    finding(
      "clickjacking_frame_headers",
      frameStatus,
      frameObserved,
      "Repeated as its own line because browsers honour either header."
    )
  );

  return findings;
}
