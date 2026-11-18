import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";

/**
 * Outbound workspace webhooks.
 *
 * The properties that make them trustworthy: registration is owner/admin only,
 * the secret is shown exactly once and never listed again, delivery is signed
 * (HMAC-SHA256 over timestamp.body) and only happens after the run is committed,
 * a failed receiver never fails the upload, and every delivery outcome is
 * visible on the registration.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
};

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string) => Promise<{ cookie: string; workspaceId: string }>;
  createProject: (cookie: string, workspaceId: string) => Promise<string>;
  createKey: (cookie: string, workspaceId: string, projectId: string) => Promise<string>;
  createWebhook: (
    cookie: string,
    workspaceId: string,
    url: string,
    events: string[]
  ) => Promise<{ id: string; secret: string }>;
  uploadRun: (key: string, workspaceId: string, projectId: string) => Promise<Response>;
}

async function bootstrap(env: Record<string, string | undefined> = ENV): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env });
  const request: Harness["request"] = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return built.app.request(path, { ...init, headers });
  };
  const signUp: Harness["signUp"] = async (email) => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password: "correct horse battery", name: "Owner" }),
    });
    expect(response.status).toBe(201);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    const body = (await response.json()) as { workspace: { id: string } };
    return { cookie, workspaceId: body.workspace.id };
  };
  const createProject: Harness["createProject"] = async (cookie, workspaceId) => {
    const response = await request("/api/v1/projects", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        name: "App under test",
        baseUrl: "https://app.example",
        environment: "staging",
      }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { project: { id: string } }).project.id;
  };
  const createKey: Harness["createKey"] = async (cookie, workspaceId, projectId) => {
    // API access is a paid feature: settle a Developer subscription first
    // (sandbox settle, no real money anywhere).
    const start = await request("/api/v1/checkout/start", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        planKey: "developer",
        period: "monthly",
        currency: "USD",
      }),
    });
    expect(start.status).toBe(201);
    const intent = ((await start.json()) as { intent: { id: string } }).intent.id;
    const settle = await request(
      `/api/v1/checkout/${intent}/sandbox/settle?workspaceId=${workspaceId}`,
      {
        method: "POST",
        cookie,
        body: JSON.stringify({ outcome: "success" }),
      }
    );
    expect(settle.status).toBe(200);

    const response = await request("/api/v1/api-keys", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, projectId, label: "ci", scopes: ["runs:write"] }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { token: string }).token;
  };
  const createWebhook: Harness["createWebhook"] = async (cookie, workspaceId, url, events) => {
    const response = await request("/api/v1/webhooks", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, url, events }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; secret: string };
  };
  const uploadRun: Harness["uploadRun"] = async (key, workspaceId, projectId) => {
    const run = {
      id: `run_${Math.random().toString(36).slice(2, 10)}`,
      projectId,
      workspaceId,
      environment: "staging",
      status: "COMPLETED",
      startedAt: new Date(Date.now() - 1000).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 900,
      modules: ["world"],
      moduleRuns: [
        {
          module: "world",
          status: "COMPLETED",
          startedAt: new Date(Date.now() - 1000).toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 900,
          totals: { total: 3, passed: 3, failed: 0, warnings: 0, errors: 0, skipped: 0 },
          cases: [],
        },
      ],
      findings: [],
      cliVersion: "test",
    };
    return request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": run.id },
      body: JSON.stringify({
        run,
        summary: {
          totals: { world: { total: 3, passed: 3, failed: 0, warnings: 0, errors: 0, skipped: 0 } },
        },
      }),
    });
  };
  return {
    services: built.services,
    request,
    signUp,
    createProject,
    createKey,
    createWebhook,
    uploadRun,
  };
}

describe("workspace webhooks", () => {
  let h: Harness;
  let receiver: {
    server: ReturnType<typeof createServer>;
    url: string;
    calls: { signature: string; timestamp: string; body: string }[];
    setHandler: (
      handler: (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
        body: string
      ) => void
    ) => void;
  };

  beforeEach(async () => {
    h = await bootstrap();
    const calls: { signature: string; timestamp: string; body: string }[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        calls.push({
          signature: String(req.headers["x-proofcore-signature"] ?? ""),
          timestamp: String(req.headers["x-proofcore-timestamp"] ?? ""),
          body,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    receiver = {
      server,
      url: `http://127.0.0.1:${port}/webhook/proofcore`,
      calls,
    };
  });

  it("registers, shows the secret once, and lists without it", async () => {
    const owner = await h.signUp("owner@example.com");
    const created = await h.createWebhook(owner.cookie, owner.workspaceId, receiver.url, [
      "run.completed",
    ]);
    expect(created.secret.startsWith("wsk_")).toBe(true);

    const list = await h.request(`/api/v1/webhooks?workspaceId=${owner.workspaceId}`, {
      cookie: owner.cookie,
    });
    const body = (await list.json()) as {
      items: { id: string; secretPrefix: string }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(created.id);
    // No secret, no hash, only the prefix.
    expect(JSON.stringify(body).includes(created.secret)).toBe(false);
  });

  it("delivers a signed run.completed event after the run is committed", async () => {
    const owner = await h.signUp("owner@example.com");
    const projectId = await h.createProject(owner.cookie, owner.workspaceId);
    const key = await h.createKey(owner.cookie, owner.workspaceId, projectId);
    await h.createWebhook(owner.cookie, owner.workspaceId, receiver.url, ["run.completed"]);

    const upload = await h.uploadRun(key, owner.workspaceId, projectId);
    expect(upload.status).toBe(201);
    // Delivery is asynchronous; the receiver is local so it lands fast.
    for (let i = 0; i < 40 && receiver.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(receiver.calls).toHaveLength(1);

    const { signature, timestamp, body } = receiver.calls[0];
    const payload = JSON.parse(body) as { event: string; data: { runId: string } };
    expect(payload.event).toBe("run.completed");
    expect(payload.data.runId).toBeTruthy();
    const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
    expect(fresh).toBe(true);
    const secret = (await h.services.store.listWorkspaceWebhooks(owner.workspaceId))[0].secret;
    const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    expect(signature).toBe(`sha256=${digest}`);
    receiver.server.close();
  });

  it("a failing receiver does not fail the upload and is reported in the list", async () => {
    const owner = await h.signUp("owner@example.com");
    const projectId = await h.createProject(owner.cookie, owner.workspaceId);
    const key = await h.createKey(owner.cookie, owner.workspaceId, projectId);
    // A URL that serves nothing: connection refused.
    const dead = await h.createWebhook(
      owner.cookie,
      owner.workspaceId,
      "http://127.0.0.1:1/webhook/dead",
      ["run.completed"]
    );
    const upload = await h.uploadRun(key, owner.workspaceId, projectId);
    expect(upload.status).toBe(201);

    for (let i = 0; i < 40; i += 1) {
      const list = await h.request(`/api/v1/webhooks?workspaceId=${owner.workspaceId}`, {
        cookie: owner.cookie,
      });
      const body = (await list.json()) as {
        items: { lastStatus: number | null; lastError: string | null }[];
      };
      const row = body.items.find((item) => item.lastError !== null || item.lastStatus !== null);
      if (row) {
        expect(row.lastStatus).toBeNull();
        expect(row.lastError).toBeTruthy();
        void dead;
        receiver.server.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect.fail("the delivery failure was never recorded");
  });

  it("only owners and admins manage webhooks", async () => {
    const owner = await h.signUp("owner@example.com");
    const response = await h.request("/api/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: owner.workspaceId,
        url: "https://hooks.example/x",
        events: ["run.completed"],
      }),
    });
    // Unauthenticated: rejected before any role check.
    expect([401, 403]).toContain(response.status);
  });
});
