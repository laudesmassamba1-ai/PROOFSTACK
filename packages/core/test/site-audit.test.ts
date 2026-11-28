import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { auditSite } from "../src/site-audit.js";

/**
 * The whole engine against a site that behaves like a real one: a login form with a CSRF
 * token, a private area that redirects to the login when there is no session, a broken
 * link, and two pages that share a title.
 *
 * This is the test that would have caught the original complaint: "it cannot sign in, and
 * it only reads one page".
 */

let server: Server | null = null;
let port = 0;
let hits: Record<string, number> = {};

const LOGIN_FORM = `<!doctype html><html><head><title>Sign in</title></head><body>
  <form method="post" action="/login">
    <input type="hidden" name="_csrf" value="csrf-123" />
    <input name="email" type="email" />
    <input name="password" type="password" />
    <button>Sign in</button>
  </form></body></html>`;

const app = (body: string, title = "Settings") =>
  `<!doctype html><html lang="en"><head><title>${title}</title>
   <meta name="viewport" content="width=device-width, initial-scale=1"></head>
   <body><main><h1>Settings</h1>${body}
   <a href="/dashboard">Dashboard</a> <a href="/missing">Missing</a>
   <a href="/logout">Log out</a></main></body></html>`;

async function serve(): Promise<string> {
  hits = {};
  server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    hits[requested] = (hits[requested] ?? 0) + 1;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = Buffer.concat(chunks).toString();
      const signedIn = (request.headers.cookie ?? "").includes("sid=ok");
      const send = (status: number, html: string, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
        response.end(html);
      };

      if (url.pathname === "/robots.txt") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("User-agent: *\nDisallow: /logout\n");
        return;
      }
      if (url.pathname === "/sitemap.xml") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (url.pathname === "/login" && request.method === "GET") {
        send(200, LOGIN_FORM);
        return;
      }
      if (url.pathname === "/login" && request.method === "POST") {
        const form = new URLSearchParams(body);
        if (form.get("_csrf") !== "csrf-123") {
          send(419, "<p>Token mismatch</p>");
          return;
        }
        if (form.get("password") !== "correct horse") {
          send(200, `${LOGIN_FORM}<p>Invalid credentials</p>`);
          return;
        }
        response.writeHead(302, {
          location: "/dashboard",
          "set-cookie": "sid=ok; Path=/; HttpOnly",
        });
        response.end();
        return;
      }
      // Everything below requires a session.
      if (!signedIn) {
        response.writeHead(302, { location: "/login" });
        response.end();
        return;
      }
      if (url.pathname === "/logout") {
        send(200, "<p>Bye</p>");
        return;
      }
      if (url.pathname === "/dashboard") {
        send(200, app('<p>Dashboard</p><a href="/settings">Settings</a>', "Dashboard"));
        return;
      }
      if (url.pathname === "/settings") {
        // Same title as /dashboard on purpose: the crawl must notice.
        // Deliberately the same title as /dashboard: the crawl must notice.
        send(200, app("<p>Settings</p>", "Dashboard"));
        return;
      }
      if (url.pathname === "/missing") {
        send(404, "<h1>Not found</h1>");
        return;
      }
      send(404, "<h1>Not found</h1>");
    });
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

describe("auditing a site behind a login", () => {
  it("signs in, crawls the private area, and finds the site-level defects", async () => {
    const base = await serve();
    const result = await auditSite({
      url: `${base}/dashboard`,
      allowPrivate: true,
      crawl: { maxPages: 10, maxDepth: 2 },
      login: {
        loginPageUrl: `${base}/login`,
        verifyUrl: `${base}/dashboard`,
        email: "qa@example.com",
        password: "correct horse",
      },
    });

    // 1. The session is real, proven by a page that requires it.
    expect(result.login?.ok).toBe(true);
    expect(result.login?.csrf).toBe(true);
    expect(result.login?.method).toBe("form");

    // 2. The crawler reached the private pages and never followed /logout.
    const paths = result.site.pages.map((page) => new URL(page.url).pathname);
    expect(paths).toContain("/dashboard");
    expect(paths).toContain("/settings");
    expect(paths).not.toContain("/logout");

    // 3. A real defect, named with its URL rather than counted.
    const broken = result.site.findings.find((finding) => finding.id === "broken_links");
    expect(broken?.status).toBe("FAIL");
    expect(broken?.pages.some((url) => url.endsWith("/missing"))).toBe(true);

    // 4. Two pages with one title are reported together.
    const duplicates = result.site.findings.find((finding) => finding.id === "duplicate_titles");
    expect(duplicates?.status).toBe("WARN");
    expect(duplicates?.pages).toHaveLength(2);

    // 5. The score is computed, bounded, and says how much it covered.
    expect(result.measuredControls).toBeGreaterThan(10);
    expect(result.score.score).toBeGreaterThan(0);
    expect(result.score.score).toBeLessThan(100);
    expect(result.scores.some((score) => score.verdict === "fail")).toBe(true);
  });

  it("carries a supplied session cookie through the whole crawl", async () => {
    const base = await serve();
    const result = await auditSite({
      url: `${base}/dashboard`,
      allowPrivate: true,
      crawl: { maxPages: 10, maxDepth: 2 },
      headers: { cookie: "sid=ok" },
    });
    const paths = result.site.pages.map((page) => new URL(page.url).pathname);
    expect(paths).toContain("/dashboard");
    expect(paths).toContain("/settings");
    expect(result.login).toBeNull();
  });

  it("refuses to call the scan signed in when the password is wrong, and says why", async () => {
    const base = await serve();
    const result = await auditSite({
      url: `${base}/dashboard`,
      allowPrivate: true,
      crawl: { maxPages: 3, maxDepth: 1 },
      login: {
        loginPageUrl: `${base}/login`,
        email: "qa@example.com",
        password: "wrong",
      },
    });

    expect(result.login?.ok).toBe(false);
    expect(result.login?.reason).toContain("refused the credentials");
    // The audit still ran, on the public surface, and the report shows the login page.
    expect(result.scan.findings.length).toBeGreaterThan(5);
    // And it must not claim the private area was seen.
    expect(result.site.pages.every((page) => !page.url.endsWith("/settings"))).toBe(true);
  });

  it("measures every answered page — including a 404 — from the crawl document", async () => {
    const base = await serve();
    const result = await auditSite({
      url: `${base}/dashboard`,
      allowPrivate: true,
      crawl: { maxPages: 10, maxDepth: 2 },
      login: {
        loginPageUrl: `${base}/login`,
        verifyUrl: `${base}/dashboard`,
        email: "qa@example.com",
        password: "correct horse",
      },
    });

    // Every discovered page that answered was measured. The 404 is a real observation,
    // not a page silently dropped from the audit.
    expect(result.site.pages.length).toBeGreaterThan(2);
    expect(result.site.pages.every((page) => page.measured)).toBe(true);
    const missing = result.site.pages.find((page) => new URL(page.url).pathname === "/missing");
    expect(missing?.status).toBe(404);
    expect(missing?.measured).toBe(true);

    // The measurement reused the crawl document: subpages are fetched once, not twice.
    // The start page is the exception: it is read once for the named scan and once by the
    // crawl, and the login check fetches its verify URL on purpose.
    for (const page of result.site.pages) {
      const path = new URL(page.url).pathname;
      if (path === "/dashboard") continue;
      expect(hits[path], `${path} was fetched ${hits[path]} times`).toBe(1);
    }
  });

  it("mirrors the production shape: no sitemap is a finding, not a crash", async () => {
    const base = await serve();
    const result = await auditSite({
      url: `${base}/login`,
      allowPrivate: true,
      crawl: { maxPages: 4, maxDepth: 1 },
    });
    const sitemap = result.site.findings.find((finding) => finding.id === "sitemap");
    expect(sitemap?.status).toBe("WARN");
    expect(sitemap?.observed).toContain("no sitemap.xml");
  });
});
