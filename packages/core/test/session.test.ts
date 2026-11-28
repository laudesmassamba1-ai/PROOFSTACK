import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { detectLoginWall } from "../src/page-scan.js";
import { CookieJar, discoverLoginForm, signIn } from "../src/session.js";

/**
 * The sign-in engine against servers that behave like real products.
 *
 * A real HTTP server is used rather than a stubbed `fetch`: the things that break in
 * production are the things this engine must get right — redirects, `Set-Cookie` on a 302,
 * a CSRF token that has to come back, a body that says "invalid credentials" with a 200.
 */

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server | null = null;

async function serve(handler: Handler): Promise<string> {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      (request as IncomingMessage & { body?: string }).body = Buffer.concat(chunks).toString();
      handler(request, response);
    });
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

const LOGIN_PAGE = `<!doctype html>
<html><body>
  <form method="post" action="/session">
    <input type="hidden" name="_token" value="tok_abc123" />
    <input type="text" name="user[email]" placeholder="E-mail" />
    <input type="password" name="user[password]" />
    <button type="submit">Sign in</button>
  </form>
</body></html>`;

describe("login form discovery", () => {
  it("finds the action, the field names and the CSRF token of a real form", () => {
    const form = discoverLoginForm(LOGIN_PAGE, "https://app.example/login");
    expect(form?.action).toBe("https://app.example/session");
    expect(form?.method).toBe("POST");
    expect(form?.emailField?.name).toBe("user[email]");
    expect(form?.passwordField.name).toBe("user[password]");
    expect(form?.hidden.map((field) => field.name)).toContain("_token");
  });

  it("returns null when the page has no password field", () => {
    expect(discoverLoginForm("<form><input name=q /></form>", "https://x.example/")).toBeNull();
  });
});

describe("login wall detection", () => {
  it("follows a protected URL to the form and names its fields", async () => {
    const base = await serve((request, response) => {
      if (request.url === "/dashboard") {
        response.writeHead(302, { location: "/login" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(LOGIN_PAGE);
    });
    const wall = await detectLoginWall(`${base}/dashboard`, { allowPrivate: true });
    expect(wall.detected).toBe(true);
    expect(wall.loginUrl).toBe(`${base}/login`);
    expect(wall.emailField).toBe("user[email]");
    expect(wall.passwordField).toBe("user[password]");
  });

  it("follows a sign-in link from a public homepage", async () => {
    const base = await serve((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        request.url === "/login" ? LOGIN_PAGE : '<a href="/login">Se connecter</a><h1>Public</h1>'
      );
    });
    const wall = await detectLoginWall(`${base}/`, { allowPrivate: true });
    expect(wall.detected).toBe(true);
    expect(wall.loginUrl).toBe(`${base}/login`);
  });

  it("probes /login when the menu hides the link from HTML", async () => {
    const base = await serve((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        request.url === "/login" ? LOGIN_PAGE : "<h1>Public</h1><script>openLogin()</script>"
      );
    });
    const wall = await detectLoginWall(base, { allowPrivate: true });
    expect(wall.detected).toBe(true);
    expect(wall.loginUrl).toBe(`${base}/login`);
  });

  it("reports a 401 as a wall even without a readable form", async () => {
    const base = await serve((_request, response) => {
      response.writeHead(401, { "content-type": "text/html" });
      response.end("<h1>Authentication required</h1>");
    });
    const wall = await detectLoginWall(base, { allowPrivate: true });
    expect(wall.detected).toBe(true);
    expect(wall.reason).toContain("401");
  });

  it("does not invent a wall on a public page", async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>Public catalogue</h1>");
    });
    const wall = await detectLoginWall(base, { allowPrivate: true });
    expect(wall.detected).toBe(false);
  });
});
describe("cookie jar", () => {
  const jar = new CookieJar();
  const response = new Response(null, {
    headers: [
      ["set-cookie", "sid=1; Path=/; HttpOnly"],
      ["set-cookie", "scoped=2; Path=/app"],
      ["set-cookie", "gone=3; Max-Age=0"],
    ],
  });

  it("honours path scoping", () => {
    jar.ingest(response, new URL("https://app.example/login"));
    expect(jar.header(new URL("https://app.example/dashboard"))).toBe("sid=1");
    expect(jar.header(new URL("https://app.example/app/orders"))).toContain("scoped=2");
  });

  it("drops an expired cookie", () => {
    expect(jar.header(new URL("https://app.example/"))).not.toContain("gone");
  });

  it("refuses a Secure cookie over http and a foreign domain", () => {
    const secureJar = new CookieJar();
    secureJar.ingest(
      new Response(null, { headers: [["set-cookie", "s=1; Secure; Path=/"]] }),
      new URL("https://app.example/")
    );
    expect(secureJar.header(new URL("http://app.example/"))).toBeNull();
    expect(secureJar.header(new URL("https://evil.example/"))).toBeNull();
    expect(secureJar.header(new URL("https://app.example/"))).toBe("s=1");
  });
});

describe("signing in to a real server", () => {
  it("posts the discovered form, echoes the CSRF token, follows the redirect and verifies", async () => {
    const seen: { token?: string; email?: string; cookie?: string } = {};
    const base = await serve((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/login") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(LOGIN_PAGE);
        return;
      }
      if (url.pathname === "/session" && request.method === "POST") {
        const body = new URLSearchParams((request as IncomingMessage & { body: string }).body);
        seen.token = body.get("_token") ?? undefined;
        seen.email = body.get("user[email]") ?? undefined;
        if (body.get("_token") !== "tok_abc123") {
          response.writeHead(419, { "content-type": "text/html" });
          response.end("<p>Token mismatch</p>");
          return;
        }
        response.writeHead(302, { location: "/app", "set-cookie": "sid=s3cret; Path=/; HttpOnly" });
        response.end();
        return;
      }
      if (url.pathname === "/app") {
        seen.cookie = request.headers.cookie;
        if (!(request.headers.cookie ?? "").includes("sid=s3cret")) {
          response.writeHead(302, { location: "/login" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<h1>Dashboard</h1><a href='/logout'>Log out</a>");
        return;
      }
      // The verification pass re-reads the login page: signed in, it must answer the app.
      response.writeHead(404);
      response.end("nope");
    });

    const result = await signIn({
      loginPageUrl: `${base}/login`,
      email: "qa@example.com",
      password: "correct horse",
    });

    expect(seen.token).toBe("tok_abc123");
    expect(seen.email).toBe("qa@example.com");
    expect(seen.cookie).toContain("sid=s3cret");
    expect(result.report.ok).toBe(true);
    expect(result.report.method).toBe("form");
    expect(result.report.csrf).toBe(true);
    expect(result.report.emailField).toBe("user[email]");
    expect(result.report.cookies).toEqual(["sid"]);
    expect(result.report.reason).toBeNull();
  });

  it("refuses to call a rejected password a success, even with a fresh cookie", async () => {
    const base = await serve((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/login") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(LOGIN_PAGE);
        return;
      }
      // A real pattern: 200 with a pre-session cookie and an error message.
      response.writeHead(200, {
        "content-type": "text/html",
        "set-cookie": "attempt=1; Path=/",
      });
      response.end(LOGIN_PAGE.replace("</form>", "</form><p>Invalid credentials</p>"));
    });

    const result = await signIn({
      loginPageUrl: `${base}/login`,
      email: "qa@example.com",
      password: "wrong",
    });
    expect(result.report.ok).toBe(false);
    expect(result.report.reason).toContain("refused the credentials");
    expect(result.report.reason).toContain("Invalid credentials");
  });

  it("reports a second factor instead of pretending to be signed in", async () => {
    const base = await serve((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/login") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(LOGIN_PAGE);
        return;
      }
      response.writeHead(200, { "content-type": "text/html", "set-cookie": "pending=1; Path=/" });
      response.end("<p>Enter the verification code from your authenticator app</p>");
    });

    const result = await signIn({
      loginPageUrl: `${base}/login`,
      email: "qa@example.com",
      password: "correct horse",
    });
    expect(result.report.ok).toBe(false);
    expect(result.report.mfaRequired).toBe(true);
    expect(result.report.reason).toContain("second factor");
  });

  it("signs in through a JSON endpoint and keeps the bearer token out of the report", async () => {
    const base = await serve((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/login" && request.method === "POST") {
        const body = JSON.parse((request as IncomingMessage & { body: string }).body) as {
          email: string;
          password: string;
        };
        if (body.password !== "correct horse") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "Invalid credentials" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { access_token: "tok_live_0123456789" } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>Dashboard</h1><a href='/logout'>Log out</a>");
    });

    const result = await signIn({
      loginUrl: `${base}/api/login`,
      email: "qa@example.com",
      password: "correct horse",
    });
    expect(result.report.ok).toBe(true);
    expect(result.report.method).toBe("bearer");
    expect(result.authorization).toBe("Bearer tok_live_0123456789");
    // The token must never be printed as part of the report.
    expect(JSON.stringify(result.report)).not.toContain("tok_live_0123456789");
  });

  it("says what to do when the site needs JavaScript to sign in", async () => {
    const base = await serve((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/login") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(LOGIN_PAGE);
        return;
      }
      // Accepted, but every page is the same shell with the form again.
      response.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=1; Path=/" });
      response.end(LOGIN_PAGE);
    });

    const result = await signIn({
      loginPageUrl: `${base}/login`,
      email: "qa@example.com",
      password: "correct horse",
    });
    expect(result.report.ok).toBe(false);
    expect(result.report.reason).toContain("still shows a login form");
    expect(result.report.reason).toContain("session cookie");
  });

  it("needs no network for a page with no form: it explains the two overrides", async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>Sign in</h1><script src='/app.js'></script>");
    });
    const result = await signIn({
      loginPageUrl: `${base}/login`,
      email: "qa@example.com",
      password: "correct horse",
    });
    expect(result.report.ok).toBe(false);
    expect(result.report.reason).toContain("--login-url");
  });
});
