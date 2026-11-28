/**
 * A browser renderer for the deployed Worker.
 *
 * The Worker has Cloudflare's `browser` binding (declared in wrangler.toml). This adapter
 * turns the existing `browsePage` reader into the `PageRenderer` the scanner consumes, so
 * a single-page application is rendered and crawled on Cloudflare exactly as it is on the
 * local Node server. No new infrastructure, no new secret: the binding is the same one the
 * interactive browser and the assistant already use.
 *
 * `browsePage` returns visible text and links, not the full DOM, so the scanner's markup
 * checks still read the server HTML. The renderer's job here is to supply the *links* the
 * crawl needs to discover the site's pages; the report says what was actually measured.
 */
import type { PageRenderer } from "@proofcore/core";
import { browsePage } from "./browser-render.js";

export function workerRenderer(
  binding: unknown,
  env: Record<string, string | undefined>
): PageRenderer {
  return {
    async render(input) {
      const page = await browsePage({
        url: new URL(input.url),
        env,
        ...(binding === undefined ? {} : { browserBinding: binding }),
      });
      if (page.basis !== "rendered_dom") return null;
      // Rebuild a minimal DOM from what the browser actually observed. The scanner reads
      // links, forms and text from it; nothing here is invented beyond the observed facts.
      const links = (page.links ?? [])
        .map((link) => `<a href="${escapeAttribute(link.href)}">${escapeText(link.text)}</a>`)
        .join("\n");
      const headings = (page.headings ?? [])
        .map((heading) => `<h2>${escapeText(heading)}</h2>`)
        .join("\n");
      const html = `<!doctype html><html><head><title>${escapeText(page.title ?? "")}</title></head><body><main>${headings}${links}<p>${escapeText(page.text)}</p></main></body></html>`;
      return {
        html,
        finalUrl: page.finalUrl,
        status: page.status ?? 200,
        basis: "rendered_dom",
      };
    },
  };
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
