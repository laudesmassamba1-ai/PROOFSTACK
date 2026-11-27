import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { findingKey, stableStringify } from "@proofcore/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";
import type { ProjectKnowledge } from "../src/project-knowledge.js";
import { generateRemediationPlan } from "../src/remediation-plan.js";

/**
 * A complete remediation, grounded in the finding and the registry.
 *
 * The plan must cite real evidence, use the registry's documented fix and verification,
 * rank real uploaded code, and refuse a finding that is not a defect. It writes nothing,
 * so a missing source store is a note — not a reason to invent a file.
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
  return { services: built.services, request };
}

async function signUp(
  harness: Harness,
  email: string
): Promise<{ cookie: string; workspaceId: string; userId: string }> {
  const response = await harness.request("/api/auth/sign-up/email", {
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
}

async function seed(
  harness: Harness,
  email: string,
  status: "FAIL" | "PASS" = "FAIL"
): Promise<{
  cookie: string;
  workspaceId: string;
  projectId: string;
  analysisId: string;
  key: string;
}> {
  const owner = await signUp(harness, email);
  const project = await harness.services.store.createProject({
    workspaceId: owner.workspaceId,
    name: "Remediation project",
    baseUrl: "https://shop.example",
    environment: "staging",
    enabledModules: ["world", "flow", "exit"],
  });
  const now = new Date().toISOString();
  const analysis = await harness.services.store.createAnalysis({
    id: `ana_rem_${Math.random().toString(16).slice(2, 10)}`,
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
    correlationId: "corr_remediation_test",
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
            status,
            observed: status === "FAIL" ? "absent" : "max-age=31536000",
            why: "HSTS prevents a protocol downgrade.",
          },
        ],
      },
    },
  });
  harness.services.projectKnowledge = {
    listSources: async () => [
      {
        id: "src_rem",
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
        id: "fil_rem",
        path: "src/server.ts",
        language: "typescript",
        size: FILE.length,
        sha256: "e".repeat(64),
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

let harness: Harness;
let openServer: ReturnType<typeof createServer> | null = null;
beforeEach(async () => {
  harness = await bootstrap();
});
afterEach(() => {
  openServer?.close();
  openServer = null;
});

describe("generateRemediationPlan", () => {
  it("assembles the registry's fix, verification, examples and real code excerpts", async () => {
    const seeded = await seed(harness, "plan-complete@example.com");
    const result = await generateRemediationPlan({
      services: harness.services,
      workspaceId: seeded.workspaceId,
      args: { analysisId: seeded.analysisId, findingKey: seeded.key },
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.writes).toBe(false);
    expect(result.plan.fix).toContain("Strict-Transport-Security");
    expect(result.plan.verification).toContain("curl");
    expect(result.plan.doneWhen).toContain("PASSED");
    expect(result.plan.steps).toHaveLength(10);
    expect(result.plan.steps.slice(0, 3).map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
    ]);
    expect(result.plan.steps[3]).toMatchObject({
      step: "prepare_fix",
      state: "next",
    });
    expect(result.plan.steps[3].action).toContain("Strict-Transport-Security");
    expect(result.control?.risk).toBe("medium");
    expect(result.control?.complexity).toBe("low");
    expect(result.plan.examples.length).toBeGreaterThan(0);
    expect(result.code.candidates[0]?.path).toBe("src/server.ts");
    expect(result.code.candidates[0]?.line).toBeGreaterThan(0);
    expect(result.code.candidates[0]?.matches.length).toBeGreaterThan(0);
    expect(result.existingRemediation).toBeNull();

    // The tool result goes through stableStringify in the chat loop: prove it is clean.
    expect(() => stableStringify(result, 2)).not.toThrow();
  });

  it("refuses a finding that is not a defect", async () => {
    const seeded = await seed(harness, "plan-passed@example.com", "PASS");
    const result = await generateRemediationPlan({
      services: harness.services,
      workspaceId: seeded.workspaceId,
      args: { analysisId: seeded.analysisId, findingKey: seeded.key },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("finding_not_actionable");
    expect(result.status).toBe("PASSED");
  });

  it("stays complete without a source store, and says why no code is attached", async () => {
    const seeded = await seed(harness, "plan-no-code@example.com");
    harness.services.projectKnowledge = undefined;
    const result = await generateRemediationPlan({
      services: harness.services,
      workspaceId: seeded.workspaceId,
      args: { analysisId: seeded.analysisId, findingKey: seeded.key },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.complete).toBe(true);
    expect(result.code.candidates).toEqual([]);
    expect(result.code.note).toContain("NEON_DATABASE_URL");
  });

  it("reports the remediation already tracking this finding", async () => {
    const seeded = await seed(harness, "plan-existing@example.com");
    const created = await harness.request("/api/v1/remediations", {
      method: "POST",
      cookie: seeded.cookie,
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        analysisId: seeded.analysisId,
        findingKey: seeded.key,
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const remediation = ((await created.json()) as { remediation: { id: string } }).remediation;

    const result = await generateRemediationPlan({
      services: harness.services,
      workspaceId: seeded.workspaceId,
      args: { analysisId: seeded.analysisId, findingKey: seeded.key },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existingRemediation).toMatchObject({
      id: remediation.id,
      status: "proposed",
      nextStep: "prepare_fix",
    });
  });

  it("is callable from the assistant loop and returns the complete plan as data", async () => {
    const seeded = await seed(harness, "plan-loop@example.com");
    const state = { attempts: 0 };
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as {
          messages?: { role: string; content: string }[];
        };
        res.writeHead(200, { "content-type": "application/json" });
        if (!body.messages) {
          res.end(JSON.stringify({ data: [] }));
          return;
        }
        state.attempts += 1;
        if (state.attempts === 1) {
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call_plan",
                        type: "function",
                        function: {
                          name: "generate_remediation",
                          arguments: JSON.stringify({
                            analysisId: seeded.analysisId,
                            findingKey: seeded.key,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            })
          );
          return;
        }
        const result = body.messages.find((message) => message.role === "tool")?.content;
        // The reviewer and synthesis passes have no tool result: answer them plainly.
        if (result === undefined) {
          res.end(
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: "ok" } }],
            })
          );
          return;
        }
        if (
          !result.includes('"complete": true') ||
          !result.includes("Strict-Transport-Security") ||
          !result.includes('"writes": false') ||
          !result.includes('"step": "prepare_fix"')
        ) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "tool result missing the plan" }));
          return;
        }
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Le plan HSTS est complet ; à toi de l'appliquer.",
                },
              },
            ],
          })
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    openServer = server;
    const address = server.address() as AddressInfo;
    const profile = await harness.request("/api/v1/ai/profile", {
      method: "PUT",
      cookie: seeded.cookie,
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "test-model",
        apiKey: "sk-plan-key-1234",
      }),
    });
    expect(profile.status, await profile.clone().text()).toBe(200);

    const chat = await harness.request("/api/v1/ai/chat", {
      method: "POST",
      cookie: seeded.cookie,
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        message: "Donne-moi la remédiation complète du constat HSTS.",
        effort: "quick",
      }),
    });
    expect(chat.status, await chat.clone().text()).toBe(200);
    const body = (await chat.json()) as { trace: { tool: string; summary: string }[] };
    expect(body.trace.map((entry) => entry.tool)).toEqual(["generate_remediation"]);
    expect(body.trace[0]?.summary).toContain("remédiation complète");
  });

  it("answers a real error for an unknown finding", async () => {
    const seeded = await seed(harness, "plan-unknown@example.com");
    const result = await generateRemediationPlan({
      services: harness.services,
      workspaceId: seeded.workspaceId,
      args: { analysisId: seeded.analysisId, findingKey: "fail:hsts:https://elsewhere/" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("finding_not_found");
  });
});
