import { describe, expect, it } from "vitest";
import { failFindings } from "../src/checks.js";

/**
 * FAIL module tests.
 *
 * The point of these assertions is honesty rather than coverage: a missing header must be a
 * failure, a check that cannot be read must be skipped, and a page over http must never look
 * protected because its headers happen to be good.
 */

const PAGE = `<!doctype html><html lang="fr"><head><title>Boutique</title></head>
<body><main><h1>Boutique</h1></main></body></html>`;

function run(
  html: string,
  headers: Record<string, string> = {},
  options: { url?: string; text?: string } = {}
) {
  const response = new Response(html, { headers });
  return failFindings({
    html,
    headers: response.headers,
    url: new URL(options.url ?? "https://shop.example/"),
    text: options.text ?? "Boutique",
  });
}

const statusOf = (findings: ReturnType<typeof run>, id: string) =>
  findings.find((item) => item.id === id)?.status;

describe("FAIL", () => {
  it("fails every header that is absent instead of staying silent", () => {
    const findings = run(PAGE);
    for (const id of ["hsts", "csp"]) {
      expect(statusOf(findings, id), id).toBe("FAIL");
    }
    for (const id of ["referrer_policy", "permissions_policy"]) {
      expect(statusOf(findings, id), id).toBe("WARN");
    }
    expect(statusOf(findings, "tls")).toBe("PASS");
  });

  it("recognises the headers a hardened site sends", () => {
    const findings = run(PAGE, {
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=()",
    });
    for (const id of ["hsts", "csp", "frame_ancestors", "referrer_policy", "permissions_policy"]) {
      expect(statusOf(findings, id), id).toBe("PASS");
    }
  });

  it("skips cookie flags when no cookie was issued, and names the missing flags", () => {
    expect(statusOf(run(PAGE), "cookie_flags")).toBe("SKIPPED");
    expect(run(PAGE).find((item) => item.id === "cookie_flags")?.observed).toContain("no cookie");

    const insecure = run(PAGE, { "set-cookie": "session=abc; Path=/" });
    expect(statusOf(insecure, "cookie_flags")).toBe("FAIL");
    expect(insecure.find((item) => item.id === "cookie_flags")?.observed).toBe(
      "missing Secure, HttpOnly, SameSite"
    );

    const secure = run(PAGE, {
      "set-cookie": "session=abc; Path=/; Secure; HttpOnly; SameSite=Lax",
    });
    expect(statusOf(secure, "cookie_flags")).toBe("PASS");
  });

  it("fails transport over http and refuses to judge mixed content it cannot see", () => {
    const findings = run(PAGE, {}, { url: "http://shop.example/" });
    expect(statusOf(findings, "tls")).toBe("FAIL");
    expect(statusOf(findings, "mixed_content")).toBe("SKIPPED");
  });

  it("finds an http resource on an https page", () => {
    const html = `${PAGE}<img src="http://cdn.example/a.png">`;
    expect(statusOf(run(html), "mixed_content")).toBe("FAIL");
  });

  it("flags a key-like string in the document, without printing the value", () => {
    const html = `${PAGE}<script>const key = "sk_live_abcdefghijklmnop1234";</script>`;
    const finding = run(html).find((item) => item.id === "secrets_in_html");
    expect(finding?.status).toBe("FAIL");
    expect(finding?.observed).not.toContain("abcdefghijklmnop");
  });

  it("treats a stack trace in the visible text as a warning", () => {
    const findings = run(PAGE, {}, { text: "SQLSTATE[42S02]: base table not found" });
    expect(statusOf(findings, "error_disclosure")).toBe("WARN");
  });

  it("reports a version banner as reconnaissance and keeps the duplicate frame line", () => {
    const findings = run(PAGE, { server: "nginx/1.25.3" });
    expect(statusOf(findings, "server_banner")).toBe("WARN");
    expect(statusOf(findings, "clickjacking_frame_headers")).toBe("WARN");
    expect(findings.filter((item) => item.id === "clickjacking_frame_headers")).toHaveLength(1);
  });

  it("judges the HSTS window, not just the header name", () => {
    expect(statusOf(run(PAGE, { "strict-transport-security": "max-age=86400" }), "hsts")).toBe(
      "WARN"
    );
    expect(statusOf(run(PAGE, { "strict-transport-security": "max-age=0" }), "hsts")).toBe("FAIL");
    expect(statusOf(run(PAGE, { "strict-transport-security": "max-age=31536000" }), "hsts")).toBe(
      "PASS"
    );
  });

  it("reads the CSP directives instead of counting the header", () => {
    expect(
      statusOf(run(PAGE, { "content-security-policy": "default-src * 'unsafe-inline'" }), "csp")
    ).toBe("WARN");
    expect(statusOf(run(PAGE, { "content-security-policy": "img-src 'self'" }), "csp")).toBe(
      "FAIL"
    );
    expect(
      statusOf(run(PAGE, { "content-security-policy": "script-src 'UNSAFE-INLINE'" }), "csp")
    ).toBe("WARN");
  });

  it("refuses SameSite=None without Secure and reads every cookie", () => {
    const one = run(PAGE, {
      "set-cookie": "session=abc; Path=/; HttpOnly; SameSite=None",
    }).find((item) => item.id === "cookie_flags");
    expect(one?.status).toBe("FAIL");
    expect(one?.observed).toBe("missing Secure");

    const headers = new Headers();
    headers.append("set-cookie", "a=1; Path=/; Secure; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "b=2; Path=/");
    const findings = failFindings({
      html: PAGE,
      headers,
      url: new URL("https://shop.example/"),
      text: "Boutique",
    });
    const both = findings.find((item) => item.id === "cookie_flags");
    expect(both?.status).toBe("FAIL");
    expect(both?.observed).toBe("2 cookies; missing Secure, HttpOnly, SameSite");
  });

  it("flags an unsafe referrer policy and an absent opener policy", () => {
    expect(statusOf(run(PAGE, { "referrer-policy": "unsafe-url" }), "referrer_policy")).toBe(
      "FAIL"
    );
    expect(statusOf(run(PAGE), "coop")).toBe("WARN");
    expect(statusOf(run(PAGE, { "cross-origin-opener-policy": "same-origin" }), "coop")).toBe(
      "PASS"
    );
  });

  it("wants an integrity digest on cross-origin code, and skips when there is none", () => {
    expect(statusOf(run(PAGE), "sri")).toBe("SKIPPED");
    const unprotected = `${PAGE}<script src="https://cdn.example/lib.js"></script>`;
    expect(statusOf(run(unprotected), "sri")).toBe("WARN");
    const protectedHtml = `${PAGE}<script src="https://cdn.example/lib.js" integrity="sha384-abc"></script>`;
    expect(statusOf(run(protectedHtml), "sri")).toBe("PASS");
    const empty = `${PAGE}<script src="https://cdn.example/lib.js" integrity=""></script>`;
    expect(statusOf(run(empty), "sri")).toBe("WARN");
  });

  it("fails a password form that posts over http", () => {
    const html = `${PAGE}<form action="http://shop.example/login"><input type="password" name="p"></form>`;
    const finding = run(html).find((item) => item.id === "password_form_action");
    expect(finding?.status).toBe("FAIL");
    expect(finding?.observed).toContain("http://shop.example");
  });

  it("only ever emits findings attributed to fail", () => {
    expect(new Set(run(PAGE).map((item) => item.module))).toEqual(new Set(["fail"]));
  });
});
