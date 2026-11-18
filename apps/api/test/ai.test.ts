import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";

/**
 * In-app AI experience.
 *
 * These tests run a real local OpenAI-compatible upstream so the whole loop is
 * exercised: profile storage (encrypted), conversation persistence, the tool
 * loop against workspace data, and the effort parameter reaching the upstream.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
  AI_KEYS_SECRET: "0123456789abcdef0123456789abcdef", // >= 32 chars
};

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string) => Promise<{ cookie: string; workspaceId: string }>;
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
  return { services: built.services, request, signUp };
}

// ------------------------------------------------------- fake upstream

interface UpstreamState {
  requests: { body: string }[];
  respond: (attempt: number, body: Record<string, unknown>) => Response | Promise<Response>;
}

function startUpstream(state: UpstreamState): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        state.requests.push({ body: raw });
        Promise.resolve(
          state.respond(state.requests.length, JSON.parse(raw) as Record<string, unknown>)
        ).then((response) => {
          res.writeHead(response.status, { "content-type": "application/json" });
          res.end(JSON.stringify(response.body ?? {}));
        });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}/v1`);
      afterEach(() => server.close());
    });
  });
}

let harness: Harness;
let upstreamBase: string;
const upstreamState: UpstreamState = {
  requests: [],
  respond: () => ({ status: 500, body: {} }),
};

beforeAll(async () => {
  upstreamBase = await startUpstream(upstreamState);
});

beforeEach(async () => {
  upstreamState.requests = [];
  harness = await bootstrap();
});

describe("ai profile", () => {
  it("stores the key encrypted and never returns it", async () => {
    const { request, signUp } = harness;
    const { cookie } = await signUp("ai-key@example.com");
    const put = await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-secret-value-123",
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { configured: boolean; keyFingerprint: string };
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-secret-value-123");
    expect(body.keyFingerprint).toMatch(/^[0-9a-f]{8}$/);

    const stored = await harness.services.store.getAiProfile(
      (
        (await request("/api/auth/session", { cookie }).then((r) => r.json())) as {
          user: { id: string };
        }
      ).user.id
    );
    expect(stored?.apiKeyEncrypted).toMatch(/^v1\./);
    expect(stored?.apiKeyEncrypted).not.toContain("sk-secret-value-123");

    const get = await request("/api/v1/ai/profile", { cookie });
    expect(JSON.stringify(await get.json())).not.toContain("sk-secret-value-123");
  });

  it("refuses key storage without AI_KEYS_SECRET instead of storing plaintext", async () => {
    const weak = await bootstrap({ ...ENV, AI_KEYS_SECRET: undefined });
    const { cookie } = await weak.signUp("ai-nosecret@example.com");
    const put = await weak.request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({ baseUrl: upstreamBase, model: "m", apiKey: "sk-secret-value-123" }),
    });
    expect(put.status).toBe(503);
    expect(
      await weak.services.store.getAiProfile(
        (
          (await weak.request("/api/auth/session", { cookie }).then((r) => r.json())) as {
            user: { id: string };
          }
        ).user.id
      )
    ).toBeNull();
  });
});

describe("ai chat", () => {
  it("persists conversations and feeds workspace data through tools", async () => {
    const { request, signUp } = harness;
    const { cookie, workspaceId } = await signUp("ai-chat@example.com");
    const project = await request("/api/v1/projects", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        name: "Shop",
        baseUrl: "https://shop.example",
        environment: "staging",
      }),
    });
    expect(project.status).toBe(201);

    await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-chat-key-456",
      }),
    });

    // Turn 1: model calls workspace_overview, then answers.
    upstreamState.respond = (attempt, body) => {
      const parsed = body as { messages: { role: string; content: string }[] };
      if (attempt === 1) {
        return {
          status: 200,
          body: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "workspace_overview", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      // Second call must contain the tool result with the project name.
      const toolMessage = parsed.messages.find((message) => message.role === "tool");
      if (!toolMessage?.content.includes("Shop")) {
        return { status: 500, body: {} };
      }
      return {
        status: 200,
        body: {
          choices: [
            { message: { role: "assistant", content: "Your workspace has 1 project: **Shop**." } },
          ],
        },
      };
    };

    const chat = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, message: "What projects do I have?", effort: "deep" }),
    });
    expect(chat.status).toBe(200);
    const body = (await chat.json()) as {
      conversationId: string;
      message: string;
      trace: { tool: string }[];
      effort: string;
    };
    expect(body.message).toContain("Shop");
    expect(body.trace).toHaveLength(1);
    expect(body.effort).toBe("deep");

    // Persisted: list + reload.
    const list = await request(`/api/v1/ai/conversations?workspaceId=${workspaceId}`, { cookie });
    const items = ((await list.json()) as { items: { id: string; title: string }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("What projects do I have?");

    const loaded = await request(`/api/v1/ai/conversations/${body.conversationId}`, { cookie });
    const loadedBody = (await loaded.json()) as { messages: unknown[] };
    expect(loadedBody.messages).toHaveLength(2);
    expect(JSON.stringify(loadedBody.messages[1])).toContain("**Shop**");

    // The effort reached the upstream.
    const firstBody = JSON.parse(upstreamState.requests[0]?.body ?? "{}") as {
      max_tokens?: number;
    };
    expect(firstBody.max_tokens).toBe(1600); // deep
  });

  it("maps an upstream 401 to ai_invalid_key and never invents an answer", async () => {
    const { request, signUp } = harness;
    const { cookie, workspaceId } = await signUp("ai-401@example.com");
    await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-bad-key-789",
      }),
    });
    upstreamState.respond = () => ({ status: 401, body: { error: { message: "bad key" } } });
    const chat = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, message: "hello", effort: "quick" }),
    });
    expect(chat.status).toBe(401);
    const body = (await chat.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ai_invalid_key");
  });

  it("treats unknown conversation ids as 404", async () => {
    const { request, signUp } = harness;
    const { cookie } = await signUp("ai-404@example.com");
    const response = await request("/api/v1/ai/conversations/aic_missing", { cookie });
    expect(response.status).toBe(404);
  });
});

describe("insights", () => {
  it("aggregates runs per day, severities and module rates from real rows", async () => {
    const { request, signUp, services } = harness;
    const { cookie, workspaceId } = await signUp("insights@example.com");
    const projectResponse = await request("/api/v1/projects", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        name: "InsightApp",
        baseUrl: "https://insight.example",
        environment: "staging",
      }),
    });
    const projectId = ((await projectResponse.json()) as { project: { id: string } }).project.id;
    const key = await (async () => {
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
      const intent = ((await start.json()) as { intent: { id: string } }).intent.id;
      await request(`/api/v1/checkout/${intent}/sandbox/settle?workspaceId=${workspaceId}`, {
        method: "POST",
        cookie,
        body: JSON.stringify({ outcome: "success" }),
      });
      const keyResponse = await request("/api/v1/api-keys", {
        method: "POST",
        cookie,
        body: JSON.stringify({ workspaceId, projectId, label: "ci", scopes: ["runs:write"] }),
      });
      return ((await keyResponse.json()) as { token: string }).token;
    })();

    const today = new Date().toISOString();
    const upload = await request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": "run_insight_1" },
      body: JSON.stringify({
        run: {
          id: "run_insight_1",
          projectId,
          workspaceId,
          environment: "staging",
          status: "COMPLETED",
          startedAt: today,
          endedAt: today,
          durationMs: 700,
          modules: ["world"],
          moduleRuns: [
            {
              module: "world",
              status: "COMPLETED",
              startedAt: today,
              endedAt: today,
              durationMs: 700,
              totals: { total: 4, passed: 3, failed: 1, warnings: 0, errors: 0, skipped: 0 },
              cases: [],
            },
          ],
          findings: [
            {
              id: "find_insight_1",
              module: "world",
              status: "FAILED",
              severity: "HIGH",
              title: "Locale mismatch",
              testCaseId: "world.locale.date",
              detail: "Date format mismatch for ar-EG",
              fingerprint: "world.locale.date:ar-EG",
              reproduction: {
                summary: "Run the world module",
                command: "proofcore test --module world",
              },
              startedAt: today,
              endedAt: today,
              durationMs: 120,
            },
          ],
          cliVersion: "test",
        },
        summary: {
          totals: { world: { total: 4, passed: 3, failed: 1, warnings: 0, errors: 0, skipped: 0 } },
        },
      }),
    });
    expect([200, 201]).toContain(upload.status);

    const insights = await request(`/api/v1/insights?workspaceId=${workspaceId}`, { cookie });
    expect(insights.status).toBe(200);
    const body = (await insights.json()) as {
      runsPerDay: { total: number; passed: number; failed: number }[];
      severityCounts: { severity: string; count: number }[];
      moduleTotals: { module: string; passed: number; failed: number }[];
    };
    expect(body.runsPerDay).toHaveLength(1);
    expect(body.runsPerDay[0]?.passed).toBe(3);
    expect(body.runsPerDay[0]?.failed).toBe(1);
    expect(body.severityCounts).toEqual([{ severity: "HIGH", count: 1 }]);
    expect(body.moduleTotals.find((entry) => entry.module === "world")?.total).toBe(4);
    void services;
  });
});
