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
  const hsts = headers.get("strict-transport-security");
  findings.push(
    finding(
      "hsts",
      hsts ? "PASS" : "FAIL",
      hsts ?? "absent",
      "HSTS prevents a protocol downgrade from being followed."
    )
  );
  findings.push(
    finding(
      "csp",
      csp ? "PASS" : "FAIL",
      csp ? csp.slice(0, 90) : "absent",
      "A Content-Security-Policy limits the impact of an injected script."
    )
  );
  const frame = headers.get("x-frame-options");
  findings.push(
    finding(
      "frame_ancestors",
      frame || (csp && /frame-ancestors/i.test(csp)) ? "PASS" : "WARN",
      frame ?? (csp && /frame-ancestors/i.test(csp) ? "csp frame-ancestors" : "absent"),
      "Without it the page can be embedded in someone else's frame (clickjacking)."
    )
  );
  findings.push(
    finding(
      "referrer_policy",
      headers.get("referrer-policy") ? "PASS" : "WARN",
      headers.get("referrer-policy") ?? "absent",
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
  const cookies = headers.get("set-cookie") ?? "";
  if (!cookies) {
    findings.push(
      finding(
        "cookie_flags",
        "SKIPPED",
        "no cookie set on this response",
        "Judged only when a cookie is issued."
      )
    );
  } else {
    const missing: string[] = [];
    if (!/;\s*secure/i.test(cookies)) missing.push("Secure");
    if (!/;\s*httponly/i.test(cookies)) missing.push("HttpOnly");
    if (!/;\s*samesite/i.test(cookies)) missing.push("SameSite");
    findings.push(
      finding(
        "cookie_flags",
        missing.length > 0 ? "FAIL" : "PASS",
        missing.length > 0 ? `missing ${missing.join(", ")}` : "Secure, HttpOnly, SameSite",
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
      !frame && !(csp && /frame-ancestors/i.test(csp)) ? "WARN" : "PASS",
      frame ?? "absent",
      "Repeated as its own line because browsers honour either header."
    )
  );

  return findings;
}
