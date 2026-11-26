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

  it("only ever emits findings attributed to fail", () => {
    expect(new Set(run(PAGE).map((item) => item.module))).toEqual(new Set(["fail"]));
  });
});
