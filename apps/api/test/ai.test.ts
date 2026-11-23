import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";
import type { ProjectKnowledge } from "../src/project-knowledge.js";

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
  /** Every call with its path and headers, so wire formats can be asserted. */
  calls: { method: string; url: string; headers: Record<string, string>; body: string }[];
  respond: (attempt: number, body: Record<string, unknown>) => Response | Promise<Response>;
}

function startUpstream(state: UpstreamState): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      // The connect flow reads the provider catalogue before it stores a model, so the
      // fake upstream behaves like a provider: a real model list on GET /models.
      state.calls.push({
        method: req.method ?? "GET",
        url: req.url ?? "",
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [key, String(value ?? "")])
        ),
        body: "",
      });
      if (req.method === "GET" && (req.url ?? "").endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "test-model" }, { id: "test-model-mini" }, { id: "whisper-large-v3" }],
          })
        );
        return;
      }
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        state.requests.push({ body: raw });
        const last = state.calls.at(-1);
        if (last) last.body = raw;
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
  calls: [],
  respond: () => ({ status: 500, body: {} }),
};

beforeAll(async () => {
  upstreamBase = await startUpstream(upstreamState);
});

beforeEach(async () => {
  upstreamState.requests = [];
  upstreamState.calls = [];
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
        providerId: "custom",
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

  it("chooses the model itself when the user only supplies a provider and a key", async () => {
    const { request, signUp } = harness;
    const { cookie } = await signUp("ai-auto-model@example.com");
    const put = await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        apiKey: "sk-auto-key-1234",
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as {
      model: string;
      modelWasChosen: boolean;
      chatModels: string[];
      providerKind: string;
    };
    // Picked from the fake catalogue, and it is not the non-chat entry.
    expect(body.model).toBe("test-model");
    expect(body.modelWasChosen).toBe(true);
    expect(body.chatModels).not.toContain("whisper-large-v3");
    expect(body.providerKind).toBe("openai");
  });

  it("replaces a retired model id instead of storing a conversation that cannot work", async () => {
    const { request, signUp } = harness;
    const { cookie } = await signUp("ai-retired@example.com");
    const put = await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "llama-3.3-70b-versatile",
        apiKey: "sk-retired-key-1234",
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { model: string; modelWasChosen: boolean };
    expect(body.model).toBe("test-model");
    expect(body.modelWasChosen).toBe(true);
  });

  it("refuses an unknown provider id rather than guessing where to send the key", async () => {
    const { request, signUp } = harness;
    const { cookie } = await signUp("ai-bad-provider@example.com");
    const put = await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({ providerId: "grop", apiKey: "sk-typo-key-1234" }),
    });
    expect(put.status).toBe(400);
    const body = (await put.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unknown_provider");
  });

  it("refuses key storage without AI_KEYS_SECRET instead of storing plaintext", async () => {
    const weak = await bootstrap({ ...ENV, AI_KEYS_SECRET: undefined });
    const { cookie } = await weak.signUp("ai-nosecret@example.com");
    const put = await weak.request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "m",
        apiKey: "sk-secret-value-123",
      }),
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

describe("account relay for the local agent", () => {
  it("uses the saved key and model without ever returning the key", async () => {
    const { request, signUp } = harness;
    const { cookie } = await signUp("ai-relay@example.com");
    const put = await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-relay-secret-9876",
      }),
    });
    expect(put.status).toBe(200);

    upstreamState.respond = () => ({
      status: 200,
      body: { choices: [{ message: { role: "assistant", content: "relayed answer" } }] },
    });
    const response = await request("/api/v1/ai/relay/chat/completions", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        // The client tries another model; the server must use the saved one.
        model: "attacker-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    expect(body.choices[0]?.message.content).toBe("relayed answer");
    expect(JSON.stringify(body)).not.toContain("sk-relay-secret-9876");

    const call = upstreamState.calls.find((entry) => entry.method === "POST");
    expect(call?.headers.authorization).toBe("Bearer sk-relay-secret-9876");
    expect(JSON.parse(call?.body ?? "{}").model).toBe("test-model");
  });

  it("refuses a relay without an account session", async () => {
    const response = await harness.request("/api/v1/ai/relay/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    });
    expect(response.status).toBe(401);
  });

  it("denies the relay with the plan required when the AI-audit quota is exhausted", async () => {
    const { request, signUp, services } = harness;
    const { cookie, workspaceId } = await signUp("ai-relay-quota@example.com");
    await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-relay-secret-9876",
      }),
    });

    // Fill the counter through the real meter — the same rows the billing page and the
    // scan gate read. The limit is read from the plan, not written here: the free tier is
    // a commercial decision, and a hard-coded number would break on every revision.
    const snapshot = await services.meter.snapshot(workspaceId);
    const rawLimit = snapshot.entitlements.entitlements.monthly_ai_audits;
    const limit = typeof rawLimit === "number" ? rawLimit : 0;
    for (let i = 0; i < limit; i += 1) {
      const metered = await services.meter.meter({
        workspaceId,
        kind: "ai_audit",
        subjectId: `seed_relay_${i}`,
        quantity: 1,
      });
      expect(metered.reason).toBe("recorded");
    }

    upstreamState.respond = () => ({
      status: 200,
      body: { choices: [{ message: { role: "assistant", content: "should not happen" } }] },
    });
    const response = await request("/api/v1/ai/relay/chat/completions", {
      method: "POST",
      cookie,
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { code: string; details: { limit: number; used: number; requiredPlanKey?: string } };
    };
    expect(body.error.code).toBe("quota_exhausted");
    expect(body.error.details).toMatchObject({
      limit,
      used: limit,
      requiredPlanKey: "developer",
    });

    // The gate sits BEFORE the proxy: an exhausted workspace must not spend a
    // provider call, so nothing reached the fake upstream.
    expect(upstreamState.requests).toHaveLength(0);
  });

  it("requires a saved profile instead of inventing a provider", async () => {
    const { request, signUp } = harness;
    const { cookie } = await signUp("ai-relay-empty@example.com");
    const response = await request("/api/v1/ai/relay/chat/completions", {
      method: "POST",
      cookie,
      body: JSON.stringify({ messages: [] }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ai_not_configured");
  });
});

describe("anthropic wire format", () => {
  it("posts to /messages with x-api-key, a top-level system prompt and input_schema tools", async () => {
    const { request, signUp } = harness;
    const { cookie, workspaceId } = await signUp("ai-anthropic@example.com");
    upstreamState.respond = () => ({
      status: 200,
      body: { content: [{ type: "text", text: "Bonjour." }] },
    });

    const put = await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-ant-api03-test",
      }),
    });
    expect(put.status).toBe(200);

    // Force the anthropic family on the stored profile: this is what the "Anthropic
    // (Claude)" provider stores, and it is the branch this test exists to prove.
    const session = (await request("/api/auth/session", { cookie }).then((r) => r.json())) as {
      user: { id: string };
    };
    await harness.services.db
      .prepare("UPDATE ai_profiles SET provider_kind = 'anthropic' WHERE user_id = ?")
      .bind(session.user.id)
      .run();

    upstreamState.calls = [];
    const chat = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, message: "Bonjour", effort: "quick" }),
    });
    expect(chat.status).toBe(200);
    expect(((await chat.json()) as { message: string }).message).toBe("Bonjour.");

    const call = upstreamState.calls.find((entry) => entry.method === "POST");
    expect(call?.url).toBe("/v1/messages");
    expect(call?.headers["x-api-key"]).toBe("sk-ant-api03-test");
    expect(call?.headers["anthropic-version"]).toBe("2023-06-01");
    const payload = JSON.parse(call?.body ?? "{}") as {
      system?: string;
      max_tokens?: number;
      tools?: { name: string; input_schema?: unknown }[];
      messages: { role: string; content: unknown }[];
    };
    // The system prompt travels at the top level, never as a message.
    expect(payload.system).toContain("PROOFCORE assistant");
    expect(payload.messages.some((message) => message.role === "system")).toBe(false);
    expect(payload.tools?.[0]?.name).toBe("workspace_overview");
    expect(payload.tools?.[0]).toHaveProperty("input_schema");
    expect(payload.max_tokens).toBe(500);
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
        providerId: "custom",
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
        providerId: "custom",
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

  it("reads uploaded project code through a tenant-scoped tool", async () => {
    const { request, signUp, services } = harness;
    const { cookie, workspaceId } = await signUp("ai-code@example.com");
    const created = await request("/api/v1/projects", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        name: "Code project",
        baseUrl: "https://code.example",
        environment: "staging",
      }),
    });
    expect(created.status).toBe(201);
    const project = ((await created.json()) as { project: { id: string } }).project;

    const now = "2026-11-23T10:00:00.000Z";
    services.projectKnowledge = {
      listSources: async () => [
        {
          id: "src_test",
          workspaceId,
          projectId: project.id,
          name: "uploaded-repo",
          kind: "folder" as const,
          ref: null,
          fileCount: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      listFiles: async () => [
        {
          id: "fil_test",
          path: "src/index.ts",
          language: "typescript",
          size: 26,
          sha256: "a".repeat(64),
        },
      ],
      readFile: async () => ({
        path: "src/index.ts",
        content: "export const answer = 42;\n",
      }),
      metrics: async () => ({
        sources: 1,
        files: 1,
        audits: 0,
        averageScore: null,
        findingsBySeverity: [],
        scoreTrend: [],
      }),
      listAudits: async () => [],
    } as unknown as ProjectKnowledge;

    await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-code-key-1234",
      }),
    });

    upstreamState.respond = (attempt) => {
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
                      id: "call_code",
                      type: "function",
                      function: {
                        name: "project_code",
                        arguments: JSON.stringify({
                          projectId: project.id,
                          sourceId: "src_test",
                          path: "src/index.ts",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      // The trace assertion below proves the tool ran; the fake model's prose is not
      // evidence, so it does not decide whether the test passes.
      return {
        status: 200,
        body: {
          choices: [
            {
              message: {
                role: "assistant",
                content: "The uploaded source contains src/index.ts.",
              },
            },
          ],
        },
      };
    };

    const chat = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        message: "What is in my uploaded source?",
        effort: "quick",
      }),
    });
    expect(chat.status).toBe(200);
    const body = (await chat.json()) as { message: string; trace: { tool: string }[] };
    expect(body.message, JSON.stringify(body.trace)).toContain("src/index.ts");
    expect(body.trace.some((item) => item.tool === "project_code")).toBe(true);
  });
});

describe("ai memory and sub-agents", () => {
  /** A workspace with a stored key, ready to chat. */
  async function ready(email: string): Promise<{ cookie: string; workspaceId: string }> {
    const session = await harness.signUp(email);
    await harness.request("/api/v1/ai/profile", {
      method: "PUT",
      cookie: session.cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-memory-key-123",
      }),
    });
    return session;
  }

  /** A provider that answers everything with one sentence. */
  function answer(text: string): void {
    upstreamState.respond = () => ({
      status: 200,
      body: { choices: [{ message: { role: "assistant", content: text } }] },
    });
  }

  it("advertises at least two sub-agents per level, and more as effort rises", async () => {
    const { request } = harness;
    const { cookie } = await harness.signUp("ai-effort@example.com");
    const response = await request("/api/v1/ai/effort", { cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      efforts: { id: string; subagents: number; lenses: { id: string }[] }[];
    };
    for (const level of body.efforts) {
      expect(level.subagents, level.id).toBeGreaterThanOrEqual(2);
      // The advertised panel is the one that will actually run.
      expect(level.lenses).toHaveLength(level.subagents);
    }
    const counts = body.efforts.map((level) => level.subagents);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts.at(-1)).toBeGreaterThan(counts[0] ?? 0);
  });

  it("writes a remembered fact and gives it to a brand-new conversation and model", async () => {
    const { request } = harness;
    const { cookie, workspaceId } = await ready("ai-memory@example.com");

    // Turn 1: the model decides the workspace charges in XOF and remembers it.
    upstreamState.respond = (attempt) => {
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
                      id: "call_mem",
                      type: "function",
                      function: {
                        name: "remember",
                        arguments: JSON.stringify({
                          kind: "convention",
                          text: "All amounts are stored in XOF, never as floats.",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      return {
        status: 200,
        body: { choices: [{ message: { role: "assistant", content: "Noted." } }] },
      };
    };

    const first = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, message: "We charge in XOF.", effort: "quick" }),
    });
    expect(first.status).toBe(200);

    const stored = await request(`/api/v1/ai/memory?workspaceId=${workspaceId}`, { cookie });
    const memory = (await stored.json()) as {
      facts: { kind: string; text: string; source: string }[];
    };
    expect(memory.facts).toHaveLength(1);
    expect(memory.facts[0]?.kind).toBe("convention");
    expect(memory.facts[0]?.source).toBe("assistant");

    // A different model, a new conversation: the fact must already be in the prompt.
    const fresh = `conv_${Math.random().toString(36).slice(2)}`;
    upstreamState.requests = [];
    answer("Understood.");
    const second = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        conversationId: undefined,
        message: "Which currency do we use?",
        effort: "quick",
      }),
    });
    expect(second.status).toBe(200);
    void fresh;
    const systemPrompt = JSON.parse(upstreamState.requests[0]?.body ?? "{}") as {
      messages: { role: string; content: string }[];
    };
    const system = systemPrompt.messages.find((message) => message.role === "system");
    expect(system?.content).toContain("XOF, never as floats");
  });

  it("curates memory itself: the assistant decides what to keep, nobody asks it to", async () => {
    const { request } = harness;
    const { cookie, workspaceId } = await ready("ai-curator@example.com");

    // Two different calls hit the same fake provider: the answer, then the curator.
    // Telling them apart by their system prompt is the point — the curator is a separate
    // pass with a narrow job, not the answer model introspecting.
    upstreamState.respond = (_n, body) => {
      const messages = (body as { messages?: { role: string; content: string }[] }).messages ?? [];
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      if (system.includes("long-term memory")) {
        return {
          status: 200,
          body: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    facts: [
                      {
                        kind: "convention",
                        text: "Every money amount in this product is stored in XOF, never as a float.",
                      },
                      // Out of contract: below the length floor, must be dropped.
                      { kind: "convention", text: "short" },
                    ],
                  }),
                },
              },
            ],
          },
        };
      }
      return {
        status: 200,
        body: { choices: [{ message: { role: "assistant", content: "Noted." } }] },
      };
    };

    const turn = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        message: "We invoice in XOF everywhere. Keep that in mind.",
        effort: "quick",
      }),
    });
    expect(turn.status).toBe(200);
    const payload = (await turn.json()) as {
      memory: { facts: number; added: { kind: string; text: string; created: boolean }[] };
    };
    expect(payload.memory.added).toHaveLength(1);
    expect(payload.memory.added[0]?.kind).toBe("convention");

    // The curator is told what to do even on an OpenAI-shaped provider: the system
    // prompt used to be dropped for that dialect, so the pass ran blind.
    const curator = JSON.parse(upstreamState.requests.at(-1)?.body ?? "{}") as {
      messages: { role: string; content: string }[];
    };
    expect(curator.messages.find((message) => message.role === "system")?.content).toContain(
      "long-term memory"
    );

    const list = await request(`/api/v1/ai/memory?workspaceId=${workspaceId}`, { cookie });
    const facts = ((await list.json()) as { facts: { text: string; source: string }[] }).facts;
    expect(facts.map((fact) => fact.source)).toEqual(["assistant"]);
    expect(facts[0]?.text).toContain("XOF, never as a float");
  });

  it("lets the user add and forget a fact, and refuses a viewer", async () => {
    const { request } = harness;
    const { cookie, workspaceId } = await ready("ai-memory-user@example.com");

    const created = await request("/api/v1/ai/memory", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        kind: "stack",
        text: "The checkout lives in apps/store.",
      }),
    });
    expect(created.status).toBe(201);
    const fact = ((await created.json()) as { fact: { id: string; source: string } }).fact;
    expect(fact.source).toBe("user");

    // Repeating the same sentence refreshes it instead of duplicating it.
    const again = await request("/api/v1/ai/memory", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        kind: "stack",
        text: "the checkout lives in apps/store",
      }),
    });
    expect(again.status).toBe(200);
    const list = await request(`/api/v1/ai/memory?workspaceId=${workspaceId}`, { cookie });
    expect(((await list.json()) as { facts: unknown[] }).facts).toHaveLength(1);

    const removed = await request(`/api/v1/ai/memory/${fact.id}`, {
      method: "DELETE",
      cookie,
      body: JSON.stringify({ workspaceId }),
    });
    expect(removed.status).toBe(200);
    const empty = await request(`/api/v1/ai/memory?workspaceId=${workspaceId}`, { cookie });
    expect(((await empty.json()) as { facts: unknown[] }).facts).toHaveLength(0);
  });

  it("reports a reviewer that failed instead of hiding it, and still answers", async () => {
    const { request } = harness;
    const { cookie, workspaceId } = await ready("ai-lens@example.com");

    let call = 0;
    upstreamState.respond = () => {
      call += 1;
      // Call 1 is the main answer; calls 2..4 are reviewers. Fail two of them.
      if (call === 2 || call === 3) return { status: 500, body: {} };
      return {
        status: 200,
        body: { choices: [{ message: { role: "assistant", content: "Answer." } }] },
      };
    };

    const response = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, message: "Explain the run.", effort: "balanced" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      message: string;
      subagents: { id: string; ok: boolean }[];
    };
    expect(body.message).toBe("Answer.");
    expect(body.subagents).toHaveLength(3); // balanced
    expect(body.subagents.filter((agent) => !agent.ok)).toHaveLength(2);
  });

  it("counts a module-reading turn as an audit once, and a plain question as none", async () => {
    const { request, services } = harness;
    const { cookie, workspaceId } = await ready("ai-meter@example.com");

    // A plain question: no module tool, so the audit counter must not move.
    answer("Hello.");
    await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, message: "hello", effort: "quick" }),
    });
    let usage = await services.billing.usageByKind(
      workspaceId,
      "2000-01-01T00:00:00.000Z",
      "2999-01-01T00:00:00.000Z"
    );
    expect(usage.ai_audit ?? 0).toBe(0);

    // A turn that reads findings is an audit.
    let turn = 0;
    upstreamState.respond = () => {
      turn += 1;
      if (turn === 1) {
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
                      id: "call_f",
                      type: "function",
                      function: { name: "recent_findings", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          },
        };
      }
      return {
        status: 200,
        body: { choices: [{ message: { role: "assistant", content: "No findings." } }] },
      };
    };
    const audited = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, message: "audit my runs", effort: "quick" }),
    });
    expect(audited.status).toBe(200);
    const payload = (await audited.json()) as { quota?: { limit: number; remaining: number } };
    // The free plan allows 3 AI audits; one was consumed by this turn.
    expect(payload.quota).toBeDefined();
    expect(payload.quota?.remaining).toBe((payload.quota?.limit ?? 0) - 1);

    usage = await services.billing.usageByKind(
      workspaceId,
      "2000-01-01T00:00:00.000Z",
      "2999-01-01T00:00:00.000Z"
    );
    expect(usage.ai_audit ?? 0).toBe(1);
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

describe("project code and AI code audits", () => {
  type AuditInput = Parameters<ProjectKnowledge["createAudit"]>[0];
  const NOW = "2026-11-23T10:00:00.000Z";

  async function createProject(
    request: Harness["request"],
    cookie: string,
    workspaceId: string,
    name: string
  ): Promise<string> {
    const response = await request("/api/v1/projects", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        name,
        baseUrl: "https://code.example",
        environment: "staging",
      }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { project: { id: string } }).project.id;
  }

  async function connectProvider(request: Harness["request"], cookie: string): Promise<void> {
    const response = await request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "test-model",
        apiKey: "sk-code-key-1234",
      }),
    });
    expect(response.status).toBe(200);
  }

  interface KnowledgeOptions {
    workspaceId: string;
    projectId: string;
    sources?: {
      id: string;
      name: string;
      fileCount: number;
      kind: "folder" | "repo";
    }[];
    files?: { path: string; content: string }[];
    audits?: {
      id: string;
      scope: string;
      score: number | null;
      summary: string;
      findings: {
        severity: "critical" | "high" | "medium" | "low";
        file: string;
        line: number | null;
        title: string;
        evidence: string;
        fix: string;
      }[];
    }[];
  }

  /** A store that records what the route tried to write, so the test can read it back. */
  function installKnowledge(options: KnowledgeOptions): {
    created: AuditInput[];
    listAuditsCalls: { workspaceId: string; projectId: string }[];
    readFilesCalls: { workspaceId: string; projectId: string; sourceId: string }[];
  } {
    const created: AuditInput[] = [];
    const listAuditsCalls: { workspaceId: string; projectId: string }[] = [];
    const readFilesCalls: { workspaceId: string; projectId: string; sourceId: string }[] = [];
    const files = options.files ?? [];
    const sources = (options.sources ?? []).map((source) => ({
      ...source,
      workspaceId: options.workspaceId,
      projectId: options.projectId,
      ref: null,
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const audits = (options.audits ?? []).map((audit) => ({
      ...audit,
      workspaceId: options.workspaceId,
      projectId: options.projectId,
      sourceId: sources[0]?.id ?? null,
      mode: "file" as const,
      status: "done" as const,
      model: "test-model",
      provider: "custom",
      filesAnalyzed: 1,
      error: null,
      createdAt: NOW,
    }));

    harness.services.projectKnowledge = {
      configured: true,
      ping: async () => true,
      createSource: async () => {
        throw new Error("not used by this test");
      },
      listSources: async () => sources,
      deleteSource: async () => false,
      listFiles: async () =>
        files.map((file, index) => ({
          id: `fil_${index}`,
          path: file.path,
          language: "typescript",
          size: file.content.length,
          sha256: "a".repeat(64),
        })),
      readFile: async (_workspaceId, _projectId, _sourceId, path) =>
        files.find((file) => file.path === path) ?? null,
      readFiles: async (workspaceId, projectId, sourceId) => {
        readFilesCalls.push({ workspaceId, projectId, sourceId });
        return files;
      },
      createAudit: async (input) => {
        created.push(input);
        return {
          id: "aia_test",
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          sourceId: input.sourceId,
          scope: input.scope,
          mode: input.mode,
          status: input.status,
          score: input.score ?? null,
          summary: input.summary ?? null,
          model: input.model ?? null,
          provider: input.provider ?? null,
          filesAnalyzed: input.filesAnalyzed,
          findings: input.findings ?? [],
          error: input.error ?? null,
          createdAt: NOW,
        };
      },
      listAudits: async (workspaceId, projectId) => {
        listAuditsCalls.push({ workspaceId, projectId });
        return audits;
      },
      metrics: async () => ({
        sources: sources.length,
        files: files.length,
        audits: audits.length,
        averageScore: audits[0]?.score ?? null,
        findingsBySeverity: [],
        scoreTrend: [],
      }),
    } as unknown as ProjectKnowledge;

    return { created, listAuditsCalls, readFilesCalls };
  }

  function answerWithTool(name: string, args: Record<string, unknown>): void {
    upstreamState.respond = (attempt) =>
      attempt === 1
        ? {
            status: 200,
            body: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call_project_code",
                        type: "function",
                        function: { name, arguments: JSON.stringify(args) },
                      },
                    ],
                  },
                },
              ],
            },
          }
        : {
            status: 200,
            body: {
              choices: [{ message: { role: "assistant", content: "Done." } }],
            },
          };
  }

  it("shows the assistant the sources, metrics and prior code-audit findings", async () => {
    const { request, signUp } = harness;
    const { cookie, workspaceId } = await signUp("ai-code-list@example.com");
    const projectId = await createProject(request, cookie, workspaceId, "Uploaded code");
    const store = installKnowledge({
      workspaceId,
      projectId,
      sources: [{ id: "src_test", name: "uploaded-repo", fileCount: 1, kind: "folder" }],
      files: [{ path: "src/index.ts", content: "export const answer = 42;\n" }],
      audits: [
        {
          id: "aia_prior",
          scope: "src/index.ts",
          score: 61,
          summary: "One authentication gap.",
          findings: [
            {
              severity: "high",
              file: "src/index.ts",
              line: 4,
              title: "Route has no authorization check",
              evidence: "router.get('/admin', handler)",
              fix: "Require an owner session before calling the handler.",
            },
          ],
        },
      ],
    });
    await connectProvider(request, cookie);
    answerWithTool("project_code", { projectId });

    const response = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        message: "What did the last code audit find?",
        effort: "quick",
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      trace: { tool: string; summary?: string }[];
    };
    const trace = body.trace.find((item) => item.tool === "project_code");
    expect(trace?.summary).toContain("1 source(s), 1 file(s), 1 code audit(s)");

    expect(store.listAuditsCalls).toEqual([{ workspaceId, projectId }]);
    const toolTurn = JSON.parse(upstreamState.requests[1]?.body ?? "{}") as {
      messages: { role: string; content: string }[];
    };
    const toolContent = toolTurn.messages.find((message) => message.role === "tool")?.content;
    const toolPayload = JSON.parse((toolContent ?? "").split("\n").slice(1).join("\n")) as {
      sources: { id: string }[];
      recentAudits: { id: string; findings: number }[];
    };
    expect(toolPayload.sources[0]?.id).toBe("src_test");
    expect(toolPayload.recentAudits[0]?.id).toBe("aia_prior");
    expect(toolPayload.recentAudits[0]?.findings).toBe(1);
  });

  it("refuses a project that belongs to another workspace, before reading any source", async () => {
    const { request, signUp } = harness;
    const owner = await signUp("ai-code-owner@example.com");
    const projectId = await createProject(request, owner.cookie, owner.workspaceId, "Private code");
    const stranger = await signUp("ai-code-stranger@example.com");
    let touched = false;
    harness.services.projectKnowledge = {
      listSources: async () => {
        touched = true;
        return [];
      },
    } as unknown as ProjectKnowledge;
    await connectProvider(request, stranger.cookie);
    answerWithTool("project_code", { projectId, sourceId: "src_private" });

    const response = await request("/api/v1/ai/chat", {
      method: "POST",
      cookie: stranger.cookie,
      body: JSON.stringify({
        workspaceId: stranger.workspaceId,
        message: "Read the other workspace's project.",
        effort: "quick",
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      trace: { tool: string; summary?: string }[];
    };
    expect(body.trace.find((item) => item.tool === "project_code")?.summary).toBe(
      "project not found"
    );
    expect(touched).toBe(false);
    expect(upstreamState.requests[1]?.body ?? "").toContain("project not found in this workspace");
  });

  it("runs a fenced AI code audit and records the provider, score and findings", async () => {
    const { request, signUp } = harness;
    const { cookie, workspaceId } = await signUp("ai-code-audit@example.com");
    const projectId = await createProject(request, cookie, workspaceId, "Audit target");
    const source =
      "import { db } from './db';\nexport function find(id: string) {\n  return db.query('select * from users where id = ' + id);\n}\n";
    const store = installKnowledge({
      workspaceId,
      projectId,
      sources: [{ id: "src_test", name: "audit-repo", fileCount: 1, kind: "folder" }],
      files: [{ path: "src/index.ts", content: source }],
    });
    await connectProvider(request, cookie);
    upstreamState.respond = () => ({
      status: 200,
      body: {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                score: 64,
                summary: "The query concatenates untrusted input.",
                findings: [
                  {
                    severity: "critical",
                    file: "src/index.ts",
                    line: 3,
                    title: "SQL injection through string concatenation",
                    evidence: "db.query('select * from users where id = ' + id)",
                    fix: "Pass id as a bound parameter.",
                  },
                ],
              }),
            },
          },
        ],
      },
    });

    const response = await request(`/api/v1/projects/${projectId}/ai-audit`, {
      method: "POST",
      cookie,
      body: JSON.stringify({
        workspaceId,
        sourceId: "src_test",
        path: "src/index.ts",
      }),
    });
    expect(response.status).toBe(201);
    expect(store.readFilesCalls).toEqual([{ workspaceId, projectId, sourceId: "src_test" }]);
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({
      workspaceId,
      projectId,
      sourceId: "src_test",
      mode: "file",
      scope: "src/index.ts",
      status: "done",
      score: 64,
      model: "test-model",
      provider: "custom",
      filesAnalyzed: 1,
    });
    expect(store.created[0]?.findings?.[0]).toMatchObject({
      severity: "critical",
      file: "src/index.ts",
      line: 3,
      title: "SQL injection through string concatenation",
    });

    const requestBody = upstreamState.requests[0]?.body ?? "";
    expect(requestBody).toContain("FILE: src/index.ts");
    expect(requestBody).toContain("<<<PROOFSTACK-UNTRUSTED-DATA-");
    expect(requestBody).toContain("db.query");
    const chatCall = upstreamState.calls.find((call) => call.url.endsWith("/chat/completions"));
    expect(chatCall?.headers.authorization).toBe("Bearer sk-code-key-1234");
  });

  it("stores a failed audit, without inventing a score, when the provider refuses", async () => {
    const { request, signUp } = harness;
    const { cookie, workspaceId } = await signUp("ai-code-failure@example.com");
    const projectId = await createProject(request, cookie, workspaceId, "Failing audit");
    const store = installKnowledge({
      workspaceId,
      projectId,
      sources: [{ id: "src_test", name: "audit-repo", fileCount: 1, kind: "folder" }],
      files: [{ path: "src/index.ts", content: "export const value = 1;\n" }],
    });
    await connectProvider(request, cookie);
    upstreamState.respond = () => ({ status: 500, body: { error: "provider down" } });

    const response = await request(`/api/v1/projects/${projectId}/ai-audit`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ workspaceId, sourceId: "src_test" }),
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ai_provider_error");
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({
      status: "failed",
      filesAnalyzed: 1,
      model: "test-model",
      provider: "custom",
    });
    expect(store.created[0]?.score).toBeUndefined();
    expect(store.created[0]?.error).toContain("HTTP 500");
  });
});
