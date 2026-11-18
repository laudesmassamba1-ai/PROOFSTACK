import { describe, expect, it } from "vitest";
import {
  browsePage,
  browserCredentials,
  describeBrowsedPage,
  extractHeadings,
  extractLinks,
  extractTitle,
  toPlainText,
} from "../src/browser-render.js";

/**
 * The in-app browser.
 *
 * Two things matter: the two bases are never confused, and the model never receives a
 * screenshot it cannot read. Both are asserted here with an injected fetch, so the
 * Cloudflare endpoints are exercised as a contract rather than mocked away.
 */

const html = `<!doctype html><html><head><title>PROOFCORE — Quality</title>
<style>body{color:red}</style></head>
<body><h1>Reliability</h1><h2>Modules</h2>
<script>console.log("tracking")</script>
<p>We test <b>five</b> modules.</p>
<ul><li>WORLD</li><li>FLOW</li></ul>
<a href="/pricing">Pricing</a><a href="https://example.com/docs">Docs</a>
</body></html>`;

function response(body: string, init: { status?: number; contentType?: string } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/html" },
  });
}

describe("html extraction", () => {
  it("keeps what a reader sees and drops scripts and styles", () => {
    const text = toPlainText(html);
    expect(text).toContain("five");
    expect(text).toContain("WORLD");
    // A tracking script is not page content; a model that echoes it looks broken.
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("body{color:red}");
  });

  it("reads the title, headings and absolute links", () => {
    expect(extractTitle(html)).toBe("PROOFCORE — Quality");
    expect(extractHeadings(html)).toEqual(["Reliability", "Modules"]);
    const links = extractLinks(html, "https://proofcore.dev/");
    expect(links.map((link) => link.href)).toContain("https://proofcore.dev/pricing");
    expect(links.map((link) => link.href)).toContain("https://example.com/docs");
  });

  it("returns null rather than an empty title", () => {
    expect(extractTitle("<html><body>no title</body></html>")).toBeNull();
  });
});

describe("credentials", () => {
  it("needs both values, not one", () => {
    expect(browserCredentials({})).toBeNull();
    expect(browserCredentials({ CF_ACCOUNT_ID: "abc" })).toBeNull();
    expect(browserCredentials({ CF_BROWSER_TOKEN: "tok" })).toBeNull();
    expect(browserCredentials({ CF_ACCOUNT_ID: "abc", CF_BROWSER_TOKEN: "tok" })).toEqual({
      accountId: "abc",
      token: "tok",
    });
  });
});

describe("browsePage", () => {
  it("reports server_html when no renderer is configured", async () => {
    const page = await browsePage({
      url: new URL("https://example.com/page"),
      env: {},
      fetchImpl: (async () => response(html)) as unknown as typeof fetch,
    });
    expect(page.basis).toBe("server_html");
    expect(page.note).toContain("JavaScript not executed");
    expect(page.screenshot).toBeUndefined();
    expect(page.title).toBe("PROOFCORE — Quality");
  });

  it("renders through the browser and returns a viewable screenshot", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const calls: string[] = [];
    const page = await browsePage({
      url: new URL("https://example.com/spa"),
      env: { CF_ACCOUNT_ID: "acc", CF_BROWSER_TOKEN: "tok" },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/screenshot")) {
          return new Response(png, { headers: { "content-type": "image/png" } });
        }
        return response(
          "<html><head><title>SPA</title></head><body><h1>Hydrated</h1></body></html>"
        );
      }) as unknown as typeof fetch,
    });
    expect(page.basis).toBe("rendered_dom");
    expect(page.screenshot?.startsWith("data:image/png;base64,")).toBe(true);
    expect(page.headings).toEqual(["Hydrated"]);
    // Both endpoints are hit, and with the account in the path.
    expect(calls.some((call) => call.includes("/accounts/acc/browser-rendering/content"))).toBe(
      true
    );
    expect(calls.some((call) => call.includes("/accounts/acc/browser-rendering/screenshot"))).toBe(
      true
    );
  });

  it("drops an oversized screenshot instead of flooding the response", async () => {
    const big = Buffer.alloc(400_000, 1);
    const page = await browsePage({
      url: new URL("https://example.com/big"),
      env: { CF_ACCOUNT_ID: "acc", CF_BROWSER_TOKEN: "tok" },
      fetchImpl: (async (input: RequestInfo | URL) =>
        String(input).endsWith("/screenshot")
          ? new Response(big, { headers: { "content-type": "image/png" } })
          : response("<html><title>Big</title></html>")) as unknown as typeof fetch,
    });
    expect(page.screenshot).toBeUndefined();
    expect(page.note).toContain("larger than 300 KB");
    expect(page.text).toBeDefined();
  });

  it("falls back to the server response and says so when the renderer fails", async () => {
    const page = await browsePage({
      url: new URL("https://example.com/down"),
      env: { CF_ACCOUNT_ID: "acc", CF_BROWSER_TOKEN: "tok" },
      fetchImpl: (async (input: RequestInfo | URL) =>
        String(input).includes("browser-rendering")
          ? new Response("boom", { status: 500 })
          : response(html)) as unknown as typeof fetch,
    });
    expect(page.basis).toBe("server_html");
    expect(page.note).toContain("browser renderer failed");
  });

  it("reports the HTTP status instead of pretending the page was fine", async () => {
    const page = await browsePage({
      url: new URL("https://example.com/missing"),
      env: {},
      fetchImpl: (async () =>
        response("<html><title>404</title></html>", { status: 404 })) as unknown as typeof fetch,
    });
    expect(page.status).toBe(404);
  });
});

describe("model-facing description", () => {
  it("never includes the screenshot data", async () => {
    const page = await browsePage({
      url: new URL("https://example.com/x"),
      env: { CF_ACCOUNT_ID: "acc", CF_BROWSER_TOKEN: "tok" },
      fetchImpl: (async (input: RequestInfo | URL) =>
        String(input).endsWith("/screenshot")
          ? new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
              headers: { "content-type": "image/png" },
            })
          : response(html)) as unknown as typeof fetch,
    });
    const description = describeBrowsedPage(page);
    expect(description).toContain("basis: rendered_dom");
    expect(description).not.toContain("base64");
    expect(description.length).toBeLessThan(20_000);
  });
});
