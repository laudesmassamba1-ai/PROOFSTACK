import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * The managed AI provider.
 *
 * A person must never have to own an API key to ask a question. A deployment that
 * configured its own provider answers under a quota it enforces; a deployment that did
 * not says so, and names what still works without AI.
 */

const BASE_ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
  AI_KEYS_SECRET: "0123456789abcdef0123456789abcdef",
};

interface Harness {
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string) => Promise<{ cookie: string; workspaceId: string }>;
  close: () => Promise<void>;
}

async function bootstrap(env: Record<string, string | undefined>): Promise<Harness> {
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
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const body = (await response.json()) as { workspace: { id: string } };
    return { cookie, workspaceId: body.workspace.id };
  };
  return { request, signUp, close: async () => db.close() };
}

let harness: Harness | undefined;
let calls: { authorization: string; body: Record<string, unknown> }[] = [];
let upstreamBase = "";

beforeAll(async () => {
  upstreamBase = await new Promise<string>((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        calls.push({
          authorization: String(req.headers.authorization ?? ""),
          body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              { message: { role: "assistant", content: "Réponse gérée." }, finish_reason: "stop" },
            ],
          })
        );
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve("http://127.0.0.1:" + (server.address() as AddressInfo).port + "/v1");
    });
    afterAll(() => server.close());
  });
});

beforeEach(() => {
  calls = [];
});
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function managed(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...BASE_ENV,
    MANAGED_AI_PROVIDER: "openai",
    MANAGED_AI_BASE_URL: upstreamBase,
    MANAGED_AI_MODEL: "test-model",
    MANAGED_AI_API_KEY: "sk-managed-secret",
    ...extra,
  };
}

function ask(h: Harness, cookie: string, workspaceId: string) {
  return h.request("/api/v1/ai/chat", {
    method: "POST",
    cookie,
    body: JSON.stringify({ workspaceId, message: "Bonjour", effort: "quick" }),
  });
}

describe("managed AI provider", () => {
  it("says what is missing, and what still works, when nothing is configured", async () => {
    harness = await bootstrap(BASE_ENV);
    const { cookie, workspaceId } = await harness.signUp("managed-none@example.com");
    const response = await ask(harness, cookie, workspaceId);
    expect(response.status).toBe(400);
    const parsed = (await response.json()) as {
      error: { code: string; details?: { managed?: boolean; deterministic?: boolean } };
    };
    expect(parsed.error.code).toBe("ai_not_configured");
    expect(parsed.error.details).toMatchObject({ managed: false, personal: false });
    expect(parsed.error.details?.deterministic).toBe(true);
  });

  it("answers with the deployment key when no personal profile exists", async () => {
    const config = readConfig(managed());
    expect(config.managedAi?.baseUrl).toBe(upstreamBase);
    expect(config.managedAi?.model).toBe("test-model");

    harness = await bootstrap(managed());
    const { cookie, workspaceId } = await harness.signUp("managed-ok@example.com");
    const response = await ask(harness, cookie, workspaceId);
    expect(response.status, await response.clone().text()).toBe(200);
    const parsed = (await response.json()) as {
      message: string;
      ai: { mode: string; provider: string; model: string; managedCallsRemaining: number | null };
    };
    expect(parsed.message).toBe("Réponse gérée.");
    expect(parsed.ai.mode).toBe("managed");
    expect(parsed.ai.model).toBe("test-model");
    expect(parsed.ai.managedCallsRemaining).toBe(299);
    expect(JSON.stringify(parsed)).not.toContain("sk-managed-secret");
    const chat = calls.find((call) => Array.isArray(call.body.tools));
    expect(chat?.authorization).toBe("Bearer sk-managed-secret");
  });

  it("enforces the managed quota, with a horizon", async () => {
    harness = await bootstrap(managed({ MANAGED_AI_CALLS_PER_MONTH: "1" }));
    const { cookie, workspaceId } = await harness.signUp("managed-quota@example.com");
    expect((await ask(harness, cookie, workspaceId)).status).toBe(200);
    const blocked = await ask(harness, cookie, workspaceId);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      "managed_ai_quota"
    );
  });

  it("lets a personal profile take precedence over the managed one", async () => {
    harness = await bootstrap(managed());
    const { cookie, workspaceId } = await harness.signUp("managed-personal@example.com");
    const put = await harness.request("/api/v1/ai/profile", {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: upstreamBase,
        model: "personal-model",
        apiKey: "sk-personal",
      }),
    });
    expect(put.status).toBe(200);
    const response = await ask(harness, cookie, workspaceId);
    expect(response.status).toBe(200);
    const parsed = (await response.json()) as { ai: { mode: string; model: string } };
    expect(parsed.ai.mode).toBe("personal");
    expect(parsed.ai.model).toBe("personal-model");
  });
});
