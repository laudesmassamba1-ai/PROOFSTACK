import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ServeHandle, serveLocal } from "../src/local-bridge.js";
import { loadStoredSession } from "../src/ui.js";

/**
 * The local bridge.
 *
 * A real HTTP server, real cookies, real SSE frames — and a stand-in model on the other
 * end, so the assertions are about what actually crossed the wire. The security tests are
 * the point: no token, wrong origin, wrong content type, and a refused write.
 */

let root: string;
let home: string;
let handle: ServeHandle | undefined;
let model: Server;
let modelUrl = "";
let replies: unknown[] = [];

function modelReply(call?: { name: string; args: unknown }) {
  const message = call
    ? {
        content: "",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          },
        ],
      }
    : { content: "finished" };
  return { choices: [{ message }], usage: {} };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "proofcore-bridge-"));
  home = await mkdtemp(join(tmpdir(), "proofcore-bridge-home-"));
  process.env.PROOFCORE_CONFIG_HOME = home;
  await writeFile(join(root, "read-me.txt"), "the answer is 42\n", "utf8");

  model = createServer((request, response) => {
    request.on("data", () => undefined);
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(replies.shift() ?? modelReply()));
    });
  });
  await new Promise<void>((resolvePromise) => model.listen(0, "127.0.0.1", () => resolvePromise()));
  const address = model.address() as { port: number };
  modelUrl = `http://127.0.0.1:${address.port}`;
  replies = [];
});

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  model.close();
  delete process.env.PROOFCORE_CONFIG_HOME;
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

async function start(options: Partial<Parameters<typeof serveLocal>[0]> = {}) {
  handle = await serveLocal({
    root,
    provider: { baseUrl: modelUrl, model: "test-model", apiKey: "k" },
    sync: false,
    port: 0,
    ...options,
  });
  const cookie = `pc_local=${handle.token}`;
  return { base: `http://127.0.0.1:${handle.port}`, cookie, token: handle.token };
}

describe("local bridge security", () => {
  it("answers health without a token and refuses everything else", async () => {
    const { base } = await start();
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);

    // The page needs the token; a bare visit must not render a console that can touch the disk.
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(401);
    const state = await fetch(`${base}/api/state`);
    expect(state.status).toBe(401);
  });

  it("exchanges the one-time token for an HttpOnly cookie", async () => {
    const { base, token } = await start();
    const response = await fetch(`${base}/?t=${token}`, { redirect: "manual" });
    expect(response.status).toBe(302);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("refuses a page on another origin", async () => {
    const { base, cookie } = await start();
    const response = await fetch(`${base}/api/state`, {
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("refuses a post without a JSON content type", async () => {
    const { base, cookie } = await start();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { cookie, "content-type": "text/plain" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(response.status).toBe(415);
  });

  it("rejects a wrong token instead of comparing loosely", async () => {
    const { base } = await start();
    const response = await fetch(`${base}/api/state`, {
      headers: { cookie: `pc_local=${"x".repeat(32)}` },
    });
    expect(response.status).toBe(401);
  });
});

describe("local bridge native window", () => {
  it("serves the built web app and protects HTML routes with the run cookie", async () => {
    const web = await mkdtemp(join(tmpdir(), "proofcore-web-"));
    await mkdir(join(web, "assets"), { recursive: true });
    await writeFile(join(web, "index.html"), "<html>PROOFCORE</html>", "utf8");
    await writeFile(join(web, "assets", "app.js"), "console.log('app')\n", "utf8");
    try {
      const { base, cookie, token } = await start({ webRoot: web });
      const exchange = await fetch(`${base}/?t=${token}`, { redirect: "manual" });
      expect(exchange.status).toBe(302);
      expect(exchange.headers.get("location")).toBe("/app");

      const app = await fetch(`${base}/app`, { headers: { cookie } });
      expect(app.status).toBe(200);
      expect(await app.text()).toContain("PROOFCORE");

      const asset = await fetch(`${base}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("console.log");

      const agent = await fetch(`${base}/agent`, { headers: { cookie } });
      expect(agent.status).toBe(200);
      expect(await agent.text()).toContain("agent local");

      const anonymous = await fetch(`${base}/app`);
      expect(anonymous.status).toBe(401);
    } finally {
      await rm(web, { recursive: true, force: true });
    }
  });

  it("proxies the site API and keeps the site cookie in the local session", async () => {
    const web = await mkdtemp(join(tmpdir(), "proofcore-web-"));
    await writeFile(join(web, "index.html"), "<html>PROOFCORE</html>", "utf8");
    const cloud = createServer((request, response) => {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (request.url === "/api/auth/sign-in/email") {
        response.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "ps_session=cloud-token; Path=/; HttpOnly; Secure; SameSite=None",
        });
        response.end(JSON.stringify({ user: { email: "a@b.test" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ user: { email: "a@b.test" }, workspaces: [] }));
    });
    await new Promise<void>((resolvePromise) =>
      cloud.listen(0, "127.0.0.1", () => resolvePromise())
    );
    const cloudUrl = `http://127.0.0.1:${(cloud.address() as { port: number }).port}`;
    try {
      const { base, cookie } = await start({ webRoot: web, cloudApiUrl: cloudUrl });
      const health = await fetch(`${base}/health`);
      expect(await health.json()).toEqual({ status: "ok" });

      const login = await fetch(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.test", password: "secret" }),
      });
      expect(login.status).toBe(200);
      const setCookie = login.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("ps_session=cloud-token");
      expect(setCookie).not.toContain("Secure");

      const saved = await loadStoredSession(cloudUrl);
      expect(saved?.cookie).toBe("ps_session=cloud-token");
      expect(saved?.email).toBe("a@b.test");

      const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ user: { email: "a@b.test" } });
    } finally {
      cloud.close();
      await rm(web, { recursive: true, force: true });
    }
  });
});

describe("local bridge turns", () => {
  it("streams the tool call and the answer over SSE", async () => {
    const { base, cookie } = await start();
    replies = [modelReply({ name: "read_file", args: { path: "read-me.txt" } }), modelReply()];

    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ message: "what is the answer?" }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("event: assistant_text");
    expect(body).toContain("event: tool_call");
    expect(body).toContain("the answer is 42");
    expect(body).toContain("event: done");
  });

  it("asks for approval and does not write when the answer is no", async () => {
    const { base, cookie } = await start();
    replies = [
      modelReply({ name: "write_file", args: { path: "written.txt", content: "x", apply: true } }),
      modelReply(),
    ];
    const controller = new AbortController();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ message: "write it" }),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let approvalId = "";
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const match = /event: approval\ndata: (.+)\n\n/.exec(text);
      if (match?.[1] && !approvalId) {
        approvalId = (JSON.parse(match[1]) as { id: string }).id;
        await fetch(`${base}/api/approve`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ id: approvalId, allow: false }),
        });
      }
    }
    expect(approvalId).not.toBe("");
    expect(text).toContain("event: result");
    await expect(readFile(join(root, "written.txt"), "utf8")).rejects.toThrow();
  });
});

describe("sync", () => {
  it("reports honestly that a turn cannot be synced without a signed-in account", async () => {
    const { base, cookie } = await start({ sync: true });
    replies = [modelReply()];
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    const body = await response.text();
    // No stored session here: the frame must say so rather than pretend it synced.
    expect(body).toContain("not signed in");
  });
});
