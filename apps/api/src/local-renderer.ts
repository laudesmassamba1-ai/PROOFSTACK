/**
 * A browser renderer for the scanner, on the Node server only.
 *
 * The Worker has Cloudflare's Browser Rendering binding; this server has the machine's
 * Chromium. A page scan that only reads the HTTP response sees an empty shell for every
 * single-page application, finds no link, and reports a "site" of one page. This renderer
 * drives the same Chromium the interactive browser uses, waits for the application to draw
 * itself, and returns the real DOM — same-origin iframes included, because that is where
 * some sites put their entire interface.
 *
 * Node-only on purpose: it imports the CDP adapter through `node:child_process`. The Worker
 * entry never imports this file; `node.ts` injects it into the services, exactly like the
 * local scenario runner. A deployment without a renderer keeps measuring server HTML and
 * says so — nothing is faked.
 */
import { browsers } from "@proofcore/adapter-browser";
import type { PageRenderer } from "@proofcore/core";

/** Collect the top document and every same-origin iframe into one HTML string. */
const RENDERED_DOM_SCRIPT = `(() => {
  const parts = [document.documentElement.outerHTML];
  for (const frame of Array.from(document.querySelectorAll('iframe'))) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement) parts.push(doc.documentElement.outerHTML);
    } catch {
      // A cross-origin frame is not ours to read; the report must not claim it.
    }
  }
  return {
    html: parts.join('\\n'),
    url: location.href,
    readyState: document.readyState,
  };
})()`;

const SETTLE_MS = 1_200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The renderer injected into the scanner by the local Node server. */
export const localRenderer: PageRenderer = {
  async render(input) {
    const opened = await browsers.open({
      url: input.url,
      headless: true,
      timeoutMs: input.timeoutMs ?? 20_000,
    });
    try {
      // Give React/Vue/etc. a beat to mount. The interactive browser uses the same settle
      // idea; a fixed short wait keeps a crawl bounded without pretending the page is done.
      await delay(SETTLE_MS);
      const raw = (await opened.page.evaluateScript(RENDERED_DOM_SCRIPT)) as {
        html?: string;
        url?: string;
        readyState?: string;
      };
      const html = typeof raw.html === "string" ? raw.html : "";
      if (!html) return null;
      return {
        html,
        finalUrl: typeof raw.url === "string" && raw.url ? raw.url : input.url,
        status: 200,
        basis: "rendered_dom",
      };
    } finally {
      // A tab per page: leaving it open would leak sessions across crawled pages.
      await browsers.close(opened.id).catch(() => undefined);
    }
  },
};
