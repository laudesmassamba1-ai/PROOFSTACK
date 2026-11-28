import { describe, expect, it } from "vitest";
import { workerRenderer } from "../src/worker-renderer.js";

/**
 * The Worker renderer must not invent a DOM. It rebuilds a minimal document from what
 * `browsePage` actually observed: title, headings, links and visible text. The scanner
 * then reads those links to crawl a single-page application.
 */

const renderedHtml = `<!doctype html><html><head><title>LauriaX World</title></head>
<body><main><h1>Bienvenue</h1><a href="/login">Connexion</a><a href="/signup">Inscription</a></main></body></html>`;

function response(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

describe("Worker renderer", () => {
  it("turns an observed browser page into a document the scanner can crawl", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/browser-rendering/content")) return response(renderedHtml);
      if (target.includes("/browser-rendering/screenshot")) return response("png");
      return response(renderedHtml);
    }) as unknown as typeof fetch;

    const renderer = workerRenderer(undefined, {
      CF_ACCOUNT_ID: "account",
      CF_BROWSER_TOKEN: "token",
    });
    // The renderer uses the module's own fetch; inject it through the global for this test.
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const view = await renderer.render({ url: "https://lauriax.com/" });
      expect(view).not.toBeNull();
      expect(view?.basis).toBe("rendered_dom");
      expect(view?.html).toContain('href="https://lauriax.com/login"');
      expect(view?.html).toContain("Connexion");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns null when no browser rendered the page", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => response("shell")) as unknown as typeof fetch;
    try {
      const renderer = workerRenderer(undefined, {});
      expect(await renderer.render({ url: "https://example.com/" })).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
