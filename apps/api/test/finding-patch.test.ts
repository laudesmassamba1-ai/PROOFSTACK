import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { findingKey } from "@proofcore/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";
import type { ProjectKnowledge } from "../src/project-knowledge.js";

/**
 * Preparing a patch with the product's AI.
 *
 * The model is simulated, the file store is real enough to refuse an invented line, and
 * the assertion is on the diff the server returns — not on model prose. A proposal whose
 * `before` does not exist in the uploaded file never becomes a diff.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
  API_ORIGIN: "http://localhost:8787",
  AI_KEYS_SECRET: "0123456789abcdef0123456789abcdef",
};

const FILE = [
  'import express from "express";',
  "const app = express();",
  "app.get('/', (_req, res) => res.send('ok'));",
  "app.listen(3000);",
].join("\n");

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (email: string) => Promise<{ cookie: string; workspaceId: string; userId: string }>;
}

async function bootstrap(): Promise<Harness> {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
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
    const body = (await response.json()) as {
      workspace: { id: string };
      user: { id: string };
    };
    return { cookie, workspaceId: body.workspace.id, userId: body.user.id };
  };
  return { services: built.services, request, signUp };
}

interface Upstream {
  base: string;
  bodies: Record<string, unknown>[];
  respond: (body: Record<string, unknown>) => string;
}

function startUpstream(): Promise<Upstream> {
  return new Promise((resolve) => {
    const state: Upstream = {
      base: "",
      bodies: [],
      respond: () => "{}",
    };
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        state.bodies.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: state.respond(body) } }],
          })
        );
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      state.base = `http://127.0.0.1:${address.port}/v1`;
      afterEach(() => server.close());
      resolve(state);
    });
  });
}

let harness: Harness;
let upstream: Upstream;

beforeAll(async () => {
  upstream = await startUpstream();
});

beforeEach(async () => {
  harness = await bootstrap();
  upstream.bodies = [];
  upstream.respond = () => "{}";
});

async function seed(email: string) {
  const owner = await harness.signUp(email);
  const project = await harness.services.store.createProject({
    workspaceId: owner.workspaceId,
    name: "Patch project",
    baseUrl: "https://shop.example",
    environment: "staging",
    enabledModules: ["world", "flow", "exit"],
  });
  const now = new Date().toISOString();
  const analysis = await harness.services.store.createAnalysis({
    id: `ana_patch_${Math.random().toString(16).slice(2, 10)}`,
    workspaceId: owner.workspaceId,
    projectId: project.id,
    createdBy: owner.userId,
    source: "WEB",
    targetType: "PAGE",
    target: "https://shop.example/",
    scope: "PAGE",
    requestedModules: ["fail"],
    applicableModules: ["fail"],
    engine: "scan",
    engineVersion: "1",
    environment: "server",
    status: "completed",
    coverage: {
      requestedModules: ["fail"],
      applicableModules: ["fail"],
      measuredModules: ["fail"],
      skipped: [],
    },
    startedAt: now,
    correlationId: "corr_patch_test",
  });
  await harness.services.store.updateAnalysis({
    workspaceId: owner.workspaceId,
    id: analysis.id,
    patch: {
      status: "completed",
      result: {
        findings: [
          {
            module: "fail",
            id: "hsts",
            status: "FAIL",
            observed: "absent",
            why: "HSTS prevents a protocol downgrade.",
          },
        ],
      },
    },
  });
  harness.services.projectKnowledge = {
    listSources: async () => [
      {
        id: "src_patch",
        workspaceId: owner.workspaceId,
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
        id: "fil_patch",
        path: "src/server.ts",
        language: "typescript",
        size: FILE.length,
        sha256: "c".repeat(64),
      },
    ],
    readFile: async () => ({ path: "src/server.ts", content: FILE }),
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
  return {
    ...owner,
    projectId: project.id,
    analysisId: analysis.id,
    key: findingKey("fail", "hsts", "https://shop.example/"),
  };
}

async function configureAi(cookie: string): Promise<void> {
  const response = await harness.request("/api/v1/ai/profile", {
    method: "PUT",
    cookie,
    body: JSON.stringify({
      providerId: "custom",
      baseUrl: upstream.base,
      model: "test-model",
      apiKey: "sk-patch-key-1234",
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

describe("POST /ai/patch", () => {
  it("turns a verified proposal into a diff, without writing the file", async () => {
    const seeded = await seed("patch-ok@example.com");
    await configureAi(seeded.cookie);
    upstream.respond = () =>
      JSON.stringify({
        path: "src/server.ts",
        before: "const app = express();",
        after: "const app = express();\napp.use(helmet());",
        rationale: "Adds the missing HSTS middleware.",
      });

    const response = await harness.request("/api/v1/ai/patch", {
      method: "POST",
      cookie: seeded.cookie,
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        analysisId: seeded.analysisId,
        findingKey: seeded.key,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      patch: { diff: string; path: string; line: number; rationale: string } | null;
      applied: boolean;
      saved: boolean;
    };
    expect(body.patch?.path).toBe("src/server.ts");
    expect(body.patch?.line).toBe(2);
    expect(body.patch?.diff).toContain("--- a/src/server.ts");
    expect(body.patch?.diff).toContain("+app.use(helmet());");
    expect(body.patch?.rationale).toContain("HSTS");
    expect(body.applied).toBe(false);
    expect(body.saved).toBe(false);

    // The structured answer did not need the tool catalogue on the wire. The profile
    // save may have read the model catalogue first, so look at the completion itself.
    const completion = upstream.bodies.find((body) => "messages" in body);
    expect(completion).toBeDefined();
    expect(completion).not.toHaveProperty("tools");
  });

  it("refuses a proposal whose before does not exist in the real file", async () => {
    const seeded = await seed("patch-invented@example.com");
    await configureAi(seeded.cookie);
    upstream.respond = () =>
      JSON.stringify({
        path: "src/server.ts",
        before: "app.use(helmet());",
        after: "app.use(cors());",
        rationale: "Replaces a line that is not there.",
      });

    const response = await harness.request("/api/v1/ai/patch", {
      method: "POST",
      cookie: seeded.cookie,
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        analysisId: seeded.analysisId,
        findingKey: seeded.key,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      patch: unknown;
      reason: string;
      applied: boolean;
    };
    expect(body.patch).toBeNull();
    expect(body.reason).toBe("before_not_found");
    expect(body.applied).toBe(false);
  });

  it("reports a model refusal instead of inventing a patch", async () => {
    const seeded = await seed("patch-refuse@example.com");
    await configureAi(seeded.cookie);
    upstream.respond = () =>
      JSON.stringify({ refuse: "The excerpt does not contain the response header code." });

    const response = await harness.request("/api/v1/ai/patch", {
      method: "POST",
      cookie: seeded.cookie,
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        analysisId: seeded.analysisId,
        findingKey: seeded.key,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      patch: unknown;
      reason: string;
      message: string;
    };
    expect(body.patch).toBeNull();
    expect(body.reason).toBe("model_refused");
    expect(body.message).toContain("does not contain");
  });

  it("answers ai_not_configured instead of calling a provider nobody configured", async () => {
    const seeded = await seed("patch-no-ai@example.com");
    const response = await harness.request("/api/v1/ai/patch", {
      method: "POST",
      cookie: seeded.cookie,
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        analysisId: seeded.analysisId,
        findingKey: seeded.key,
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ai_not_configured");
    expect(upstream.bodies).toHaveLength(0);
  });

  it("returns no diff when no uploaded file matches the finding", async () => {
    const seeded = await seed("patch-no-file@example.com");
    await configureAi(seeded.cookie);
    harness.services.projectKnowledge = {
      ...harness.services.projectKnowledge,
      listFiles: async () => [
        {
          id: "fil_other",
          path: "README.md",
          language: "markdown",
          size: 20,
          sha256: "d".repeat(64),
        },
      ],
      readFile: async () => ({ path: "README.md", content: "# unrelated\n" }),
    } as unknown as ProjectKnowledge;

    const response = await harness.request("/api/v1/ai/patch", {
      method: "POST",
      cookie: seeded.cookie,
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        analysisId: seeded.analysisId,
        findingKey: seeded.key,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { patch: unknown; reason: string };
    expect(body.patch).toBeNull();
    expect(body.reason).toBe("no_candidate_file");
    // No completion was spent: the tool had nothing to propose.
    expect(upstream.bodies.some((call) => "messages" in call)).toBe(false);
  });
});
