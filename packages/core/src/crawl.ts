/**
 * Crawling a site, the way a person with a browser would.
 *
 * A one-page scan answers "what does this URL return". It cannot answer the questions that
 * actually cost money: which links are broken, which pages disagree about their title, how
 * heavy the site is, whether the login wall hides half of it. Those need more than one
 * request, and doing it by hand is how a "scan" ends up being three random pages.
 *
 * The rules this crawler keeps:
 *
 *   - **Same origin by default.** A scan must not wander onto other people's sites.
 *   - **Bounded.** Pages, depth, concurrency, bytes and time all have a ceiling, so a crawl
 *     of a 50 000-page site finishes in bounded time and cannot be used to flood a host.
 *   - **Polite.** `robots.txt` is honoured for our user agent, including `Crawl-delay`, and
 *     a `Disallow: /` stops the crawl with an explanation rather than being ignored.
 *   - **Honest about what it did not read.** A page that timed out, was blocked by robots, or
 *     was skipped by a limit is reported as such, never counted as passing.
 */

export interface CrawlPage {
  url: string;
  /** Final URL after redirects. */
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: number;
  durationMs: number;
  depth: number;
  html: string;
  /**
   * Response headers, kept so the page can be measured without a second request.
   * `set-cookie` is reduced to its flags: a cookie value is a session, not evidence.
   */
  headers?: Record<string, string>;
  title: string | null;
  /** Same-origin links found in the page, absolute. */
  links: string[];
  /** External links found in the page, absolute and deduplicated. */
  externalLinks: string[];
  assets: { kind: "script" | "style" | "image" | "font"; url: string }[];
  /** True when the page answered with an error or could not be read at all. */
  error: string | null;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  /** Pages fetched at the same time. Kept low on purpose: a scan is a guest. */
  concurrency?: number;
  timeoutMs?: number;
  maxBytesPerPage?: number;
  /** Follow links outside the start origin. Off by default. */
  allowExternal?: boolean;
  /** Extra URLs to read before following links (a sitemap, a known path). */
  seedUrls?: string[];
  /** Only URLs matching this path prefix are crawled. */
  pathPrefix?: string;
  /** URLs matching any of these patterns are skipped (logout, delete, …). */
  exclude?: RegExp[];
  /** Read `robots.txt` and `sitemap.xml`. On by default. */
  respectRobots?: boolean;
  /** Fetch injection, for tests. */
  fetchImpl?: typeof fetch;
  /** Headers for every request: the session cookie of a signed-in crawl. */
  headers?: Record<string, string>;
  /** `Cookie` header supplier, so a session jar can drive the whole crawl. */
  cookieHeader?: (url: string) => string | null;
  /** SSRF guard, injected so the CLI can allow a local target and the API cannot. */
  guard?: (url: URL) => void;
  onPage?: (page: CrawlPage, discovered: number) => void;
}

export interface CrawlResult {
  startUrl: string;
  origin: string;
  pages: CrawlPage[];
  /** URLs discovered but not read, with the reason. */
  skipped: { url: string; reason: string }[];
  robots: { found: boolean; disallowed: string[]; crawlDelayMs: number | null } | null;
  sitemap: { found: boolean; urls: number } | null;
  /** True when at least one limit was hit: the report must say the crawl was partial. */
  truncated: boolean;
  truncatedBy: "pages" | "depth" | null;
  durationMs: number;
  requests: number;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; PROOFCORE-Scan/1.1; +https://proofstack.dev/docs/scanner)";
const SKIP_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
  "ico",
  "pdf",
  "zip",
  "gz",
  "tar",
  "mp4",
  "mp3",
  "wav",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "css",
  "js",
  "map",
  "json",
  "xml",
  "txt",
  "csv",
]);

/** Paths that mutate or end a session: a crawler must never follow them. */
const NEVER_FOLLOW = [
  /\/logout\b/i,
  /\/signout\b/i,
  /\/deconnexion\b/i,
  /\/delete\b/i,
  /\/remove\b/i,
  /\/unsubscribe\b/i,
  /\/cancel\b/i,
  /\?.*(?:logout|delete|destroy)=/i,
];

export async function crawlSite(
  startUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const startedAt = Date.now();
  const maxPages = options.maxPages ?? 25;
  const maxDepth = options.maxDepth ?? 3;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 10));
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytesPerPage ?? 1_500_000;

  const start = new URL(startUrl);
  const guard = options.guard ?? (() => undefined);
  guard(start);
  const origin = start.origin;

  let requests = 0;
  const fetchPage = async (
    url: string,
    depth: number
  ): Promise<{ page: CrawlPage; response: Response }> => {
    const target = new URL(url);
    guard(target);
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...options.headers,
    };
    const cookie = options.cookieHeader?.(url) ?? null;
    if (cookie) headers.cookie = cookie;

    const began = Date.now();
    requests += 1;
    let response: Response;
    try {
      response = await doFetch(url, {
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return {
        page: {
          url,
          finalUrl: url,
          status: 0,
          contentType: "",
          bytes: 0,
          durationMs: Date.now() - began,
          depth,
          html: "",
          headers: {},
          title: null,
          links: [],
          externalLinks: [],
          assets: [],
          error: error instanceof Error ? error.message : "request failed",
        },
        response: new Response(null, { status: 0 }),
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const { text, bytes } = await readCapped(response, maxBytes);
    const isHtml = /text\/html|application\/xhtml/i.test(contentType);
    const page: CrawlPage = {
      url,
      finalUrl: response.url || url,
      status: response.status,
      contentType,
      bytes,
      durationMs: Date.now() - began,
      depth,
      html: isHtml ? text : "",
      headers: responseHeaders(response.headers),
      title: isHtml ? readTitle(text) : null,
      links: [],
      externalLinks: [],
      assets: isHtml ? readAssets(text, response.url || url) : [],
      error: response.status >= 400 ? `HTTP ${response.status}` : null,
    };
    if (isHtml) {
      const { internal, external } = readLinks(text, response.url || url, origin);
      page.links = internal;
      page.externalLinks = external;
    }
    return { page, response };
  };

  // ------------------------------------------------------------------ robots.txt
  let robots: CrawlResult["robots"] = null;
  const disallowed: string[] = [];
  let crawlDelayMs: number | null = null;
  if (options.respectRobots !== false) {
    try {
      requests += 1;
      const response = await doFetch(`${origin}/robots.txt`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        const text = await response.text();
        const parsed = parseRobots(text);
        disallowed.push(...parsed.disallow);
        crawlDelayMs = parsed.crawlDelayMs;
        robots = { found: true, disallowed: parsed.disallow, crawlDelayMs };
      } else {
        robots = { found: false, disallowed: [], crawlDelayMs: null };
      }
    } catch {
      robots = { found: false, disallowed: [], crawlDelayMs: null };
    }
  }

  // -------------------------------------------------------------------- sitemap
  let sitemap: CrawlResult["sitemap"] = null;
  const seeds = new Set<string>([start.toString(), ...(options.seedUrls ?? [])]);
  try {
    requests += 1;
    const response = await doFetch(`${origin}/sitemap.xml`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      const text = await response.text();
      const urls = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
        .map((match) => match[1] ?? "")
        .filter((value) => {
          // A sitemap is user input: one broken <loc> must not abort the whole crawl.
          const parsed = safeUrl(value);
          return parsed !== null && (parsed.protocol === "https:" || parsed.protocol === "http:");
        });
      sitemap = { found: true, urls: urls.length };
      // A sitemap is the site's own list of pages: better seeds than guesswork.
      for (const url of urls.slice(0, maxPages * 2)) seeds.add(url);
    } else {
      sitemap = { found: false, urls: 0 };
    }
  } catch {
    sitemap = { found: false, urls: 0 };
  }

  // ---------------------------------------------------------------------- crawl
  const pages: CrawlPage[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const seen = new Set<string>();
  // `maxDepth` counts link hops from the start URL. Extra seeds (a sitemap, an explicit list)
  // are pages the site itself declared: they are read for measurement, but they do not
  // expand the frontier, or a sitemap of 200 URLs would turn into 200 crawls.
  const frontier: { url: string; depth: number }[] = [];
  for (const seed of seeds) {
    frontier.push({
      url: seed,
      depth: normalizeUrl(seed) === normalizeUrl(start.toString()) ? 0 : maxDepth,
    });
  }
  let truncatedBy: CrawlResult["truncatedBy"] = null;

  const allowedByRobots = (url: string): boolean => {
    if (options.respectRobots === false) return true;
    const parsed = safeUrl(url);
    if (!parsed) return false;
    const path = parsed.pathname;
    if (disallowed.includes("/")) return false;
    return !disallowed.some((rule) => rule.length > 0 && path.startsWith(rule));
  };

  while (frontier.length > 0 && pages.length < maxPages) {
    const batch = frontier.splice(0, concurrency);
    const results = await Promise.all(
      batch.map(async (item) => {
        const key = normalizeUrl(item.url);
        if (seen.has(key)) return null;
        seen.add(key);
        if (!allowedByRobots(item.url)) {
          skipped.push({ url: item.url, reason: "disallowed by robots.txt" });
          return null;
        }
        if (shouldSkip(item.url, options.exclude)) {
          skipped.push({ url: item.url, reason: "excluded by pattern" });
          return null;
        }
        const fetched = await fetchPage(item.url, item.depth);
        return fetched.page;
      })
    );

    for (const page of results) {
      if (!page) continue;
      if (pages.length >= maxPages) {
        truncatedBy = truncatedBy ?? "pages";
        skipped.push({ url: page.url, reason: "page limit reached" });
        continue;
      }
      pages.push(page);
      options.onPage?.(page, pages.length);

      if (page.error !== null) continue;
      if (page.depth + 1 > maxDepth) {
        // Only call it a depth truncation when links were dropped for that reason.
        if (page.links.length > 0 && truncatedBy === null) truncatedBy = "depth";
        continue;
      }
      for (const link of page.links) {
        if (seen.has(normalizeUrl(link))) continue;
        if (options.pathPrefix && !(safeUrl(link)?.pathname ?? "").startsWith(options.pathPrefix)) {
          continue;
        }
        frontier.push({ url: link, depth: page.depth + 1 });
      }
      if (options.allowExternal) {
        for (const link of page.externalLinks) {
          if (seen.has(normalizeUrl(link))) continue;
          frontier.push({ url: link, depth: page.depth + 1 });
        }
      }
    }

    if (crawlDelayMs !== null && frontier.length > 0) {
      await delay(crawlDelayMs);
    }
  }

  // A frontier left over is the page limit, and it is the more useful reason to report:
  // it tells the caller to raise `maxPages`, not to widen the depth.
  if (frontier.length > 0) truncatedBy = "pages";

  return {
    startUrl: start.toString(),
    origin,
    pages,
    skipped,
    robots,
    sitemap,
    truncated: truncatedBy !== null || skipped.length > 0,
    truncatedBy,
    durationMs: Date.now() - startedAt,
    requests,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10_000)));
}

/** Query order and fragments do not make a new page; trailing slashes usually do not either. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.searchParams.sort();
    const trailing = url.pathname.length > 1 && url.pathname.endsWith("/");
    const path = trailing ? url.pathname.slice(0, -1) : url.pathname;
    return `${url.origin}${path}${url.search}`;
  } catch {
    return raw;
  }
}

function shouldSkip(url: string, exclude: RegExp[] | undefined): boolean {
  const parsed = safeUrl(url);
  if (!parsed) return true;
  const extension = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
  if (SKIP_EXTENSIONS.has(extension)) return true;
  if (NEVER_FOLLOW.some((pattern) => pattern.test(parsed.pathname + parsed.search))) return true;
  return (exclude ?? []).some((pattern) => pattern.test(url));
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Extracts links, splitting same-origin from external, and resolving relative URLs. */
export function readLinks(
  html: string,
  pageUrl: string,
  origin: string
): { internal: string[]; external: string[] } {
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const href = attributeOf(match[1] ?? "", "href");
    if (!href) continue;
    const trimmed = href.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("#") ||
      /^(?:mailto|tel|javascript|data|sms|whatsapp):/i.test(trimmed)
    ) {
      continue;
    }
    const resolved = safeUrl(new URL(trimmed, pageUrl).toString());
    if (!resolved) continue;
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    const target = `${resolved.origin}${resolved.pathname}${resolved.search}`;
    if (resolved.origin === origin) internal.add(target);
    else external.add(target);
  }
  return { internal: [...internal], external: [...external] };
}

function readAssets(
  html: string,
  pageUrl: string
): { kind: "script" | "style" | "image" | "font"; url: string }[] {
  const assets: { kind: "script" | "style" | "image" | "font"; url: string }[] = [];
  const push = (kind: "script" | "style" | "image" | "font", raw: string | null) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("data:")) return;
    try {
      assets.push({ kind, url: new URL(trimmed, pageUrl).toString() });
    } catch {
      // A malformed URL is a finding elsewhere, not a crash here.
    }
  };
  for (const match of html.matchAll(/<script\b([^>]*)>/gi))
    push("script", attributeOf(match[1] ?? "", "src"));
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const rel = (attributeOf(attrs, "rel") ?? "").toLowerCase();
    if (rel.includes("stylesheet")) push("style", attributeOf(attrs, "href"));
    if (rel.includes("preload") && /font/i.test(attributeOf(attrs, "as") ?? "")) {
      push("font", attributeOf(attrs, "href"));
    }
  }
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    push("image", attributeOf(attrs, "src") ?? attributeOf(attrs, "data-src"));
  }
  const unique = new Map(assets.map((asset) => [`${asset.kind}:${asset.url}`, asset]));
  return [...unique.values()];
}

export function readTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const text = (match[1] ?? "").replace(/\s+/g, " ").trim();
  return text.length === 0 ? null : text;
}

function attributeOf(html: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(html);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Copies the response headers a measurement needs, without the secret in `set-cookie`.
 *
 * The cookie checks only read the flags (Secure, HttpOnly, SameSite), so the attributes are
 * kept and the value — a live session for a signed-in crawl — never leaves the fetch.
 */
function responseHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") kept[key] = value;
  });
  const cookies = headers.get("set-cookie");
  if (cookies) {
    const flags = new Set<string>();
    for (const match of cookies.matchAll(/;\s*(secure|httponly|samesite=[^;,\s]+)/gi)) {
      if (match[1]) flags.add(match[1].toLowerCase());
    }
    kept["set-cookie"] = `cookie issued${[...flags].map((flag) => `; ${flag}`).join("")}`;
  }
  return kept;
}

async function readCapped(
  response: Response,
  maxBytes: number
): Promise<{ text: string; bytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return { text, bytes: text.length };
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes >= maxBytes) await reader.cancel().catch(() => undefined);
  return { text: new TextDecoder().decode(merged), bytes };
}

/**
 * Reads the subset of `robots.txt` that matters here: what we may not fetch, and how fast.
 *
 * Groups are matched on our user agent (with the `*` group as the fallback), which is what
 * the protocol says; a naive implementation that appends every `Disallow` would crawl
 * nothing on sites that disallow paths for other bots.
 */
export function parseRobots(text: string): { disallow: string[]; crawlDelayMs: number | null } {
  const disallow: string[] = [];
  let crawlDelayMs: number | null = null;
  let appliesToUs = false;
  let inAgentBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase() ?? "";
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      inAgentBlock = agent === "*" || agent.includes("proofcore");
      if (inAgentBlock) appliesToUs = true;
      continue;
    }
    if (!appliesToUs || !inAgentBlock) continue;
    if (key === "disallow" && value.length > 0) disallow.push(value);
    if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) crawlDelayMs = Math.round(seconds * 1000);
    }
  }
  return { disallow: [...new Set(disallow)], crawlDelayMs };
}
