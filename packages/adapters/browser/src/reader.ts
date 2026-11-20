import { ProofCoreError } from "@proofcore/core";
import { normalizeBrowserUrl } from "./session.js";

/**
 * Reading a page without a browser.
 *
 * Not every fetch deserves a Chromium: a changelog, a JSON API, an RSS feed or a README is
 * fully present in the response, and starting a browser to read it would cost a process and
 * several seconds for nothing. This reader is explicit about what it is: the *server's*
 * markup. It never claims the page rendered, and `basis` says `server_html`.
 *
 * When the answer depends on JavaScript, `browser_open` is the tool — not a bigger regex.
 */

export interface ReadablePage {
  basis: "server_html";
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  description: string | null;
  text: string;
  markdown: string;
  headings: string[];
  links: { text: string; href: string }[];
  bytes: number;
  durationMs: number;
  truncated: boolean;
}

export interface FetchReadableOptions {
  url: string;
  headers?: Record<string, string>;
  maxChars?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_CHARS = 20_000;
const MAX_BYTES = 4_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = "PROOFCORE-reader/2.0 (+https://proofcore.dev)";

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/** Visible text: scripts, styles, comments and tags removed, line structure kept. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A small Markdown rendering: headings, paragraphs, lists, code, links and emphasis.
 *
 * The point is not a perfect converter. It is that a model reads structure — a list stays a
 * list, a heading stays a heading, and a link keeps its URL — instead of one long paragraph
 * in which every relationship has been flattened away.
 */
export function htmlToMarkdown(html: string): string {
  let value = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  value = value.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, body: string) => {
    const code = decodeEntities(body.replace(/<[^>]+>/g, ""))
      .replace(/\n+$/, "")
      .replace(/^\n+/, "");
    return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
  });
  value = value.replace(
    /<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_match, body: string) => `\`${decodeEntities(body.replace(/<[^>]+>/g, ""))}\``
  );
  value = value.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_match, level: string, body: string) => {
      const text = htmlToText(body).replace(/\n+/g, " ");
      return `\n\n${"#".repeat(Number(level))} ${text}\n\n`;
    }
  );
  value = value.replace(
    /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, body: string) => {
      const text = htmlToText(body).replace(/\n+/g, " ").trim();
      if (!text) return "";
      if (href.startsWith("#")) return text;
      return `[${text}](${href})`;
    }
  );
  value = value.replace(
    /<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_match, _tag: string, body: string) => {
      const text = htmlToText(body).replace(/\n+/g, " ").trim();
      return text ? `**${text}**` : "";
    }
  );
  value = value.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, body: string) => {
    const text = htmlToText(body).replace(/\n+/g, " ").trim();
    return text ? `_${text}_` : "";
  });
  value = value.replace(/<img\s[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_match, alt: string) => {
    return alt ? `![${alt}]` : "";
  });
  value = value.replace(/<li[^>]*>/gi, "\n- ");
  value = value.replace(/<br\s*\/?>/gi, "\n");
  value = value.replace(/<\/(p|div|section|article|blockquote|tr|ul|ol)>/gi, "\n\n");
  value = value.replace(/<[^>]+>/g, " ");
  return decodeEntities(value)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1] ? htmlToText(match[1]).replace(/\n+/g, " ").trim() : "";
  if (title) return title.slice(0, 200);
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const fallback = heading?.[1] ? htmlToText(heading[1]).replace(/\n+/g, " ").trim() : "";
  return fallback ? fallback.slice(0, 200) : null;
}

export function extractDescription(html: string): string | null {
  const match =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html) ??
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html);
  const text = match?.[1] ? decodeEntities(match[1]).trim() : "";
  return text ? text.slice(0, 400) : null;
}

export function extractHeadings(html: string, limit = 30): string[] {
  const headings: string[] = [];
  for (const match of html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = htmlToText(match[2] ?? "")
      .replace(/\n+/g, " ")
      .trim();
    if (text) headings.push(text.slice(0, 160));
    if (headings.length >= limit) break;
  }
  return headings;
}

export function extractLinks(
  html: string,
  base: string,
  limit = 80
): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = htmlToText(match[2] ?? "")
      .replace(/\n+/g, " ")
      .trim();
    if (!text) continue;
    try {
      const href = new URL(match[1] ?? "", base).toString();
      if (href.startsWith("javascript:") || seen.has(href)) continue;
      seen.add(href);
      links.push({ text: text.slice(0, 120), href });
    } catch {
      // A malformed href is not worth failing the read.
    }
    if (links.length >= limit) break;
  }
  return links;
}

/** Fetches a URL and returns a readable, structured representation of the response. */
export async function fetchReadable(options: FetchReadableOptions): Promise<ReadablePage> {
  const target = normalizeBrowserUrl(options.url);
  if (!/^https?:/i.test(target)) {
    throw new ProofCoreError({
      message: "The reader only fetches http(s) URLs; use browser_open for file: and data:.",
      category: "VALIDATION",
      code: "unsupported_scheme",
    });
  }
  const started = Date.now();
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8,*/*;q=0.5",
    ...options.headers,
  };
  const response = await doFetch(target, {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new ProofCoreError({
      message: `Could not reach ${target}: ${error instanceof Error ? error.message : "network error"}`,
      category: "NETWORK",
      code: "fetch_failed",
    });
  });

  const raw = Buffer.from(await response.arrayBuffer());
  const capped = raw.subarray(0, MAX_BYTES);
  const body = capped.toString("utf8");
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const isHtml = /html|xhtml/i.test(contentType) || /^\s*</.test(body.slice(0, 200));
  const isJson = /json/i.test(contentType);
  const maxChars = Math.min(options.maxChars ?? DEFAULT_MAX_CHARS, 200_000);

  const text = isHtml ? htmlToText(body) : isJson ? prettyJson(body) : body;
  const finalUrl = response.url || target;
  return {
    basis: "server_html",
    url: target,
    finalUrl,
    status: response.status,
    contentType,
    title: isHtml ? extractTitle(body) : null,
    description: isHtml ? extractDescription(body) : null,
    text: text.slice(0, maxChars),
    markdown: (isHtml ? htmlToMarkdown(body) : text).slice(0, maxChars),
    headings: isHtml ? extractHeadings(body) : [],
    links: isHtml ? extractLinks(body, finalUrl) : [],
    bytes: raw.byteLength,
    durationMs: Date.now() - started,
    truncated: text.length > maxChars,
  };
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
