import { ProofCoreError } from "@proofcore/core";

/**
 * The app's browser.
 *
 * A Worker cannot run a browser: there is no Chromium in the isolate, and fetching HTML
 * gives the server's markup, not the page the user would see. Two very different things are
 * routinely confused, and the confusion is expensive — a single-page app's fetched HTML is
 * an empty shell, so "the page has no heading" is an artefact of the method, not a finding.
 *
 * So there are exactly two bases, and the caller always knows which one it got:
 *
 * - `rendered_dom`: a real headless browser ran the page (Cloudflare Browser Rendering),
 *   JavaScript included. Costs a rendered request and needs an API token.
 * - `server_html`: only the server response was fetched. Honest, cheap, and marked as such.
 *
 * The screenshot is capped before it reaches the client: a chat transcript is not a place to
 * push a 2 MB PNG.
 */

export type RenderBasis = "rendered_dom" | "server_html";

export interface BrowsedPage {
  basis: RenderBasis;
  url: string;
  finalUrl: string;
  status: number | null;
  title: string | null;
  /** Visible text, for the model. Always the truncated plain text, never markup. */
  text: string;
  /** `data:image/png;base64,…` when a browser actually rendered the page. */
  screenshot?: string;
  bytes?: number;
  durationMs: number;
  /** Why the rendered path was not used, when it was not. */
  note?: string;
  headings?: string[];
  links?: { href: string; text: string }[];
}

const MAX_TEXT_CHARS = 12_000;
const MAX_SCREENSHOT_BYTES = 300_000;
const RENDER_TIMEOUT_MS = 22_000;

interface BrowserCredentials {
  accountId: string;
  token: string;
}

/** Reads the Cloudflare Browser Rendering credentials, or reports that they are absent. */
export function browserCredentials(
  env: Record<string, string | undefined>
): BrowserCredentials | null {
  const accountId = env.CF_ACCOUNT_ID?.trim();
  const token = env.CF_BROWSER_TOKEN?.trim();
  if (!accountId || !token) return null;
  return { accountId, token };
}

function endpoint(credentials: BrowserCredentials, action: "screenshot" | "content"): string {
  return `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/browser-rendering/${action}`;
}

/** Strips tags, scripts and styles: what a reader would see, not what the server sent. */
export function toPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1] ? toPlainText(match[1]).trim() : "";
  return title || null;
}

export function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  for (const match of html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = toPlainText(match[2] ?? "").trim();
    if (text) headings.push(text.slice(0, 120));
    if (headings.length >= 20) break;
  }
  return headings;
}

export function extractLinks(html: string, base: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = [];
  for (const match of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = toPlainText(match[2] ?? "").trim();
    if (!text) continue;
    try {
      links.push({ href: new URL(match[1] ?? "", base).toString(), text: text.slice(0, 80) });
    } catch {
      // A malformed href is not worth failing the whole read.
    }
    if (links.length >= 30) break;
  }
  return links;
}

export interface BrowseOptions {
  url: URL;
  env: Record<string, string | undefined>;
  /**
   * The Worker `browser` binding, when the deployment has one.
   *
   * Preferred over the REST API: it is the account's own compute, needs no API token, and
   * cannot be a stale credential. It is passed as `unknown` so this module stays usable
   * from Node (tests, CLI) where the binding does not exist.
   */
  browserBinding?: unknown;
  /** Injected for tests: the module otherwise uses the global fetch. */
  fetchImpl?: typeof fetch;
}

export async function browsePage(options: BrowseOptions): Promise<BrowsedPage> {
  const started = Date.now();
  const doFetch = options.fetchImpl ?? fetch;

  if (options.browserBinding) {
    const rendered = await renderWithBinding(options.browserBinding, options.url, started);
    if (rendered) return rendered;
    const fallback = await fetchServerHtml(options.url, doFetch, started);
    return {
      ...fallback,
      note: "the browser binding failed; this is the server response, JavaScript not executed",
    };
  }

  const credentials = browserCredentials(options.env);

  if (credentials) {
    const rendered = await renderWithBrowser(options.url, credentials, doFetch, started);
    if (rendered) return rendered;
    // A renderer that fails must not turn into a silent downgrade: the caller gets the
    // honest server HTML, with the reason attached.
    const fallback = await fetchServerHtml(options.url, doFetch, started);
    return {
      ...fallback,
      note: "the browser renderer failed; this is the server response, JavaScript not executed",
    };
  }

  const fallback = await fetchServerHtml(options.url, doFetch, started);
  return {
    ...fallback,
    note: "no browser configured (CF_ACCOUNT_ID + CF_BROWSER_TOKEN): server response only, JavaScript not executed",
  };
}

/**
 * Renders through the deployed `browser` binding.
 *
 * Same output shape as the REST path, so the caller does not care which one answered; only
 * `basis` and `note` differ, and only when the render did not happen.
 */
async function renderWithBinding(
  binding: unknown,
  url: URL,
  started: number
): Promise<BrowsedPage | null> {
  let browser: Awaited<ReturnType<typeof launchPuppeteer>> | undefined;
  try {
    const puppeteer = await import("@cloudflare/puppeteer");
    browser = await puppeteer.default.launch(binding as never);
    const page = await browser.newPage();
    const response = await page.goto(url.toString(), {
      waitUntil: "networkidle2",
      timeout: RENDER_TIMEOUT_MS,
    });
    const html = await page.content();
    const title = await page.title();
    const buffer = Buffer.from(
      await page.screenshot({ type: "png", fullPage: false, encoding: "binary" })
    );
    const screenshot =
      buffer.byteLength <= MAX_SCREENSHOT_BYTES
        ? `data:image/png;base64,${buffer.toString("base64")}`
        : undefined;
    return {
      basis: "rendered_dom",
      url: url.toString(),
      finalUrl: page.url(),
      status: response?.status() ?? null,
      title: title || extractTitle(html),
      text: toPlainText(html).slice(0, MAX_TEXT_CHARS),
      ...(screenshot ? { screenshot } : {}),
      bytes: buffer.byteLength,
      durationMs: Date.now() - started,
      headings: extractHeadings(html),
      links: extractLinks(html, page.url()),
      ...(screenshot ? {} : { note: "screenshot larger than 300 KB: text returned only" }),
    };
  } catch {
    return null;
  } finally {
    // A live browser session costs money and holds a slot: always close it.
    await browser?.close().catch(() => undefined);
  }
}

async function launchPuppeteer() {
  const puppeteer = await import("@cloudflare/puppeteer");
  return puppeteer.default.launch({} as never);
}

async function renderWithBrowser(
  url: URL,
  credentials: BrowserCredentials,
  doFetch: typeof fetch,
  started: number
): Promise<BrowsedPage | null> {
  try {
    const body = JSON.stringify({ url: url.toString() });
    const headers = {
      authorization: `Bearer ${credentials.token}`,
      "content-type": "application/json",
    };
    const [shot, content] = await Promise.all([
      doFetch(endpoint(credentials, "screenshot"), {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      }),
      doFetch(endpoint(credentials, "content"), {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      }),
    ]);

    if (!shot.ok || !content.ok) return null;
    const html = await content.text();
    const image = Buffer.from(await shot.arrayBuffer());
    // Over the cap: keep the text, drop the image rather than blow up the response.
    const screenshot =
      image.byteLength <= MAX_SCREENSHOT_BYTES
        ? `data:image/png;base64,${image.toString("base64")}`
        : undefined;
    const text = toPlainText(html).slice(0, MAX_TEXT_CHARS);
    return {
      basis: "rendered_dom",
      url: url.toString(),
      finalUrl: url.toString(),
      status: 200,
      title: extractTitle(html),
      text,
      ...(screenshot ? { screenshot } : {}),
      bytes: image.byteLength,
      durationMs: Date.now() - started,
      headings: extractHeadings(html),
      links: extractLinks(html, url.toString()),
      ...(screenshot ? {} : { note: "screenshot larger than 300 KB: text returned only" }),
    };
  } catch {
    return null;
  }
}

async function fetchServerHtml(
  url: URL,
  doFetch: typeof fetch,
  started: number
): Promise<BrowsedPage> {
  const response = await doFetch(url.toString(), {
    redirect: "follow",
    headers: { "user-agent": "PROOFCORE-browser/1.0 (+https://proofcore.dev)" },
    signal: AbortSignal.timeout(15_000),
  }).catch((error: unknown) => {
    throw new ProofCoreError({
      message: `Could not reach ${url.hostname}: ${error instanceof Error ? error.message : "network error"}`,
      category: "NETWORK",
      code: "browse_failed",
    });
  });

  const html = await response.text();
  return {
    basis: "server_html",
    url: url.toString(),
    finalUrl: response.url || url.toString(),
    status: response.status,
    title: extractTitle(html),
    text: toPlainText(html).slice(0, MAX_TEXT_CHARS),
    durationMs: Date.now() - started,
    headings: extractHeadings(html),
    links: extractLinks(html, response.url || url.toString()),
  };
}

/**
 * The tool result as the model receives it.
 *
 * The screenshot is deliberately absent: a model that cannot see an image should not be
 * handed one, and a base64 blob would spend the whole turn's context on pixels.
 */
export function describeBrowsedPage(page: BrowsedPage): string {
  const lines = [
    `basis: ${page.basis}${page.note ? ` (${page.note})` : ""}`,
    `url: ${page.finalUrl}`,
    `status: ${page.status ?? "unknown"}`,
    `title: ${page.title ?? "(none)"}`,
    page.headings?.length
      ? `headings: ${page.headings.slice(0, 10).join(" | ")}`
      : "headings: (none found)",
    page.screenshot
      ? `screenshot: taken (${Math.round((page.bytes ?? 0) / 1024)} KB)`
      : "screenshot: not available",
    "",
    page.text,
  ];
  return lines.join("\n");
}
