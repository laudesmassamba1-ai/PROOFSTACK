import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { detectLoginWall, isClientShell, type PageRenderer, scanPage } from "../src/page-scan.js";
import { auditSite } from "../src/site-audit.js";

/**
 * A single-page application serves one empty HTML shell for every route. Its links and
 * login form exist only after JavaScript runs. A scan that reads only the response finds
 * one page and no login; a scan with a renderer reads the DOM a visitor actually sees.
 *
 * These tests use a fake renderer so the contract is deterministic: the real Chromium is
 * injected by the Node server, exactly like the interactive browser.
 */

let server: Server | null = null;

const SHELL = `<!doctype html><html lang="en"><head><title>App</title>
<script type="module" src="/app.js"></script></head>
<body><div id="root"></div></body></html>`;

const RENDERED = `<!doctype html><html lang="en"><head><title>App</title></head>
<body><main><h1>Dashboard</h1>
<a href="/settings">Settings</a><a href="/login">Sign in</a>
<form action="/login" method="post"><input name="email" type="email">
<input name="password" type="password"><button>Sign in</button></form>
</main></body></html>`;

async function serve(): Promise<string> {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(SHELL);
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
});

const renderer = (
  html: string,
  calls: string[],
  finalUrl?: (inputUrl: string) => string
): PageRenderer => ({
  async render(input) {
    calls.push(input.url);
    return {
      html,
      finalUrl: finalUrl ? finalUrl(input.url) : input.url,
      status: 200,
      basis: "rendered_dom",
    };
  },
});

describe("browser rendering for client-side sites", () => {
  it("recognises a shell that needs a browser", () => {
    expect(isClientShell(SHELL)).toBe(true);
    expect(isClientShell(RENDERED)).toBe(false);
  });

  it("measures the rendered DOM instead of the empty shell", async () => {
    const base = await serve();
    const calls: string[] = [];
    const result = await scanPage(`${base}/`, {
      allowPrivate: true,
      renderer: renderer(RENDERED, calls),
    });
    expect(calls).toHaveLength(1);
    expect(result.clientRendered).toBe(false);
    const dom = result.findings.find((item) => item.id === "rendered_dom");
    expect(dom?.status).toBe("PASS");
    expect(dom?.observed).toContain("JavaScript-rendered");
    // The rendered form is a real journey entry point, not an empty page.
    expect(result.findings.some((item) => item.module === "flow")).toBe(true);
  });

  it("crawls the links that only exist in the rendered DOM", async () => {
    const base = await serve();
    const calls: string[] = [];
    const result = await auditSite({
      url: `${base}/`,
      allowPrivate: true,
      crawl: { maxPages: 10, maxDepth: 2 },
      renderer: renderer(RENDERED, calls),
    });
    const paths = result.site.pages.map((page) => new URL(page.url).pathname);
    expect(paths).toContain("/settings");
    expect(paths).toContain("/login");
    expect(calls.length).toBeGreaterThan(1);
  });

  it("detects a login wall whose link only exists in the rendered DOM", async () => {
    const base = await serve();
    const calls: string[] = [];
    const wall = await detectLoginWall(`${base}/`, {
      allowPrivate: true,
      timeoutMs: 10_000,
      renderer: renderer(RENDERED, calls, (url) => `${url.replace(/\/$/, "")}/login`),
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(wall.detected).toBe(true);
    expect(wall.loginUrl).toContain("/login");
  });

  it("keeps the server response when no renderer is available", async () => {
    const base = await serve();
    const result = await scanPage(`${base}/`, { allowPrivate: true });
    expect(result.clientRendered).toBe(true);
    const dom = result.findings.find((item) => item.id === "rendered_dom");
    expect(dom?.status).toBe("SKIPPED");
  });
});
