import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { crawlSite, normalizeUrl, parseRobots, readLinks, readTitle } from "../src/crawl.js";

/**
 * The crawler against a real multi-page server.
 *
 * The behaviours that matter are the ones a one-page scan cannot have: depth, dedupe,
 * robots, the never-follow list, and honest reporting when a limit stopped the crawl.
 */

let server: Server | null = null;

const SITE: Record<string, string> = {
  "/": `<html><head><title>Home</title></head><body>
        <a href="/about">About</a> <a href="/pricing">Pricing</a> <a href="/about#team">Team</a>
        <a href="/broken">Broken</a> <a href="/logout">Log out</a>
        <a href="https://elsewhere.example/x">Elsewhere</a>
      </body></html>`,
  "/about": `<html><head><title>About</title></head><body>
        <a href="/">Home</a> <a href="/deep/page">Deep</a></body></html>`,
  "/pricing": `<html><head><title>Pricing</title></head><body>
        <a href="/about">About</a> <img src="/logo.png" /></body></html>`,
  "/deep/page": `<html><head><title>Deep</title></head><body>nothing here</body></html>`,
};

async function serveSite(): Promise<string> {
  let port = 0;
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /private\nCrawl-delay: 0\n");
      return;
    }
    if (url.pathname === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<?xml version="1.0"?><urlset>
        <url><loc>http://127.0.0.1:${port}/about</loc></url>
      </urlset>`);
      return;
    }
    if (url.pathname === "/private") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><title>Private</title></html>");
      return;
    }
    const html = SITE[url.pathname];
    if (html) {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "sid=secret-value; Path=/; HttpOnly; Secure; SameSite=Lax",
      });
      response.end(html);
      return;
    }
    response.writeHead(404, { "content-type": "text/html" });
    response.end("<html><title>Not found</title></html>");
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  port = address.port;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
});

describe("parsing", () => {
  it("reads robots for our agent and ignores rules aimed at others", () => {
    const robots = parseRobots(
      [
        "User-agent: Googlebot",
        "Disallow: /google",
        "",
        "User-agent: *",
        "Disallow: /admin",
        "Crawl-delay: 2",
      ].join("\n")
    );
    expect(robots.disallow).toEqual(["/admin"]);
    expect(robots.crawlDelayMs).toBe(2000);
  });

  it("normalises fragments, query order and trailing slashes", () => {
    expect(normalizeUrl("https://x.example/a/?b=2&a=1#frag")).toBe("https://x.example/a?a=1&b=2");
    expect(normalizeUrl("https://x.example/")).toBe("https://x.example/");
  });

  it("splits internal and external links and drops non-http schemes", () => {
    const { internal, external } = readLinks(
      `<a href="/a">a</a><a href="#x">x</a><a href="mailto:a@b.c">m</a><a href="https://other.example/z">z</a>`,
      "https://site.example/page",
      "https://site.example"
    );
    expect(internal).toEqual(["https://site.example/a"]);
    expect(external).toEqual(["https://other.example/z"]);
  });

  it("collapses whitespace in titles", () => {
    expect(readTitle("<title>\n  A   page \n</title>")).toBe("A page");
    expect(readTitle("<html></html>")).toBeNull();
  });
});

describe("crawling a real site", () => {
  it("follows internal links, dedupes fragments, and stops at the depth limit", async () => {
    const base = await serveSite();
    const result = await crawlSite(base, { maxDepth: 1, maxPages: 10 });
    const paths = result.pages.map((page) => new URL(page.url).pathname).sort();
    expect(paths).toContain("/");
    expect(paths).toContain("/about");
    expect(paths).toContain("/pricing");
    expect(paths).toContain("/broken");
    // Depth 1 means the homepage's children are read but not their children.
    expect(paths).not.toContain("/deep/page");
    // The fragment link is the same page.
    expect(paths.filter((path) => path === "/about")).toHaveLength(1);
  });

  it("never follows a logout link and honours robots.txt", async () => {
    const base = await serveSite();
    const result = await crawlSite(base, { maxDepth: 2, maxPages: 20 });
    const paths = result.pages.map((page) => new URL(page.url).pathname);
    expect(paths).not.toContain("/logout");
    expect(paths).not.toContain("/private");
  });

  it("records a broken page as an error instead of dropping it", async () => {
    const base = await serveSite();
    const result = await crawlSite(base, { maxDepth: 1, maxPages: 10 });
    const broken = result.pages.find((page) => new URL(page.url).pathname === "/broken");
    expect(broken?.status).toBe(404);
    expect(broken?.error).toBe("HTTP 404");
  });

  it("reports the page limit instead of pretending the crawl was complete", async () => {
    const base = await serveSite();
    const result = await crawlSite(base, { maxDepth: 5, maxPages: 2 });
    expect(result.pages).toHaveLength(2);
    // Reaching the limit is what must be visible: a caller that sees `truncated` knows the
    // report covers part of the site, and the UI can say so instead of implying otherwise.
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("pages");
  });

  it("uses the sitemap as seeds and reports it", async () => {
    const base = await serveSite();
    const result = await crawlSite(base, { maxDepth: 0, maxPages: 5 });
    expect(result.sitemap?.found).toBe(true);
    expect(result.robots?.found).toBe(true);
    expect(result.robots?.disallowed).toContain("/private");
  });

  it("does not fetch sitemap seeds outside the origin or path prefix", async () => {
    const base = await serveSite();
    const requested: string[] = [];
    const result = await crawlSite(base, {
      maxDepth: 0,
      maxPages: 10,
      pathPrefix: "/",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requested.push(String(input));
        if (String(input) === `${base}/sitemap.xml`) {
          return new Response(
            `<urlset><url><loc>${base}/guide</loc></url><url><loc>${base}/about</loc></url><url><loc>https://external.example/steal</loc></url></urlset>`,
            { status: 200, headers: { "content-type": "application/xml" } }
          );
        }
        return fetch(input, init);
      }) as typeof fetch,
    });

    expect(result.pages.map((page) => page.url)).toContain(`${base}/`);
    expect(result.pages.some((page) => page.url.endsWith("/about"))).toBe(false);
    expect(requested).not.toContain(`${base}/about`);
    expect(requested).not.toContain("https://external.example/steal");
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { url: `${base}/about`, reason: "outside path prefix" },
        { url: "https://external.example/steal", reason: "outside crawl origin" },
      ])
    );
    expect(result.truncated).toBe(true);
  });

  it("applies origin and path-prefix boundaries to explicit seeds", async () => {
    const base = await serveSite();
    const requested: string[] = [];
    const result = await crawlSite(base, {
      maxDepth: 0,
      maxPages: 10,
      pathPrefix: "/docs",
      seedUrls: [`${base}/about`, "https://external.example/page"],
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requested.push(String(input));
        return fetch(input, init);
      }) as typeof fetch,
    });

    // The start URL is outside /docs, so it is skipped too: a prefix is a boundary,
    // not a hint. Nothing outside it may be fetched.
    expect(result.pages).toHaveLength(0);
    expect(requested).not.toContain(`${base}/about`);
    expect(requested).not.toContain("https://external.example/page");
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { url: `${base}/about`, reason: "outside path prefix" },
        { url: "https://external.example/page", reason: "outside crawl origin" },
      ])
    );
    expect(result.truncated).toBe(true);
  });

  it("sends the session cookie of a signed-in crawl", async () => {
    const base = await serveSite();
    const seen: string[] = [];
    await crawlSite(base, {
      maxDepth: 0,
      maxPages: 1,
      cookieHeader: () => "sid=abc; theme=dark",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("cookie") ?? "");
        return fetch(input as string, init);
      }) as typeof fetch,
    });
    // robots.txt and the sitemap are public; every page request carries the session.
    expect(seen.some((header) => header.includes("sid=abc"))).toBe(true);
  });

  it("keeps response headers but reduces a session cookie to its flags", async () => {
    const base = await serveSite();
    const result = await crawlSite(base, { maxDepth: 0, maxPages: 1 });
    const page = result.pages[0];
    expect(page?.headers?.["content-type"]).toContain("text/html");
    // The session value is never copied into a report-visible document.
    expect(page?.headers?.["set-cookie"]).toBe("cookie issued; httponly; secure; samesite=lax");
    expect(JSON.stringify(page?.headers)).not.toContain("secret-value");
  });

  it("counts every request it makes, so the cost is visible", async () => {
    const base = await serveSite();
    const result = await crawlSite(base, { maxDepth: 1, maxPages: 5 });
    // robots + sitemap + pages
    expect(result.requests).toBeGreaterThan(result.pages.length);
  });
});
