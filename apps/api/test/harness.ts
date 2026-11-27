import type { TestRun } from "@proofcore/contracts";
import { expect } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";

/**
 * Shared integration harness.
 *
 * Real app, real SQLite (in memory), real billing and usage engines; only the transport
 * is synthetic. Every test file composes the same building blocks so a behaviour change
 * in one place is proven everywhere.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173,https://proofcore-01z.pages.dev",
  API_ORIGIN: "http://localhost:8787",
};

interface Harness {
  services: Services;
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  signUp: (
    email: string,
    workspace?: string
  ) => Promise<{ cookie: string; workspaceId: string; userId: string }>;
}

export function harness(overrides: Record<string, string> = {}): Harness {
  const db = NodeSqliteDatabase.open(":memory:");
  const built = createApp({ db, env: { ...ENV, ...overrides } });
  const request: Harness["request"] = async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return built.app.request(path, { ...init, headers });
  };

  const signUp: Harness["signUp"] = async (email, workspace = "Acme") => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email,
        password: "correct horse battery",
        name: "Ada Lovelace",
        workspace,
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { workspace: { id: string }; user: { id: string } };
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    return { cookie: cookie ?? "", workspaceId: body.workspace.id, userId: body.user.id };
  };

  return { services: built.services, request, signUp };
}

export async function bootstrap(overrides: Record<string, string> = {}): Promise<Harness> {
  const h = harness(overrides);
  await migrate(h.services.db, migrationFiles());
  return h;
}

export function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

/** The upload envelope: the contract requires a totals entry for every module. */
export function uploadBody(run: TestRun): string {
  const zero = { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0 };
  return JSON.stringify({ run, summary: { totals: { world: zero, flow: zero, exit: zero } } });
}

export function sampleRun(input: {
  id: string;
  projectId: string;
  workspaceId: string;
  status?: "COMPLETED" | "FAILED" | "ERROR" | "CANCELLED";
  module?: "world" | "flow" | "exit";
}): TestRun {
  const now = new Date().toISOString();
  const module = input.module ?? "world";
  return {
    id: input.id,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    environment: "local",
    status: input.status ?? "COMPLETED",
    startedAt: now,
    endedAt: now,
    durationMs: 42,
    modules: [module],
    moduleRuns: [
      {
        module,
        status: input.status ?? "COMPLETED",
        startedAt: now,
        endedAt: now,
        durationMs: 42,
        totals: {
          total: 1,
          passed: input.status === "FAILED" || input.status === "ERROR" ? 0 : 1,
          failed: input.status === "FAILED" ? 1 : 0,
          warnings: 0,
          errors: input.status === "ERROR" ? 1 : 0,
          skipped: 0,
        },
        cases: [
          {
            id: `${module}/case-1`,
            name: "accented surname survives the form",
            module,
            description: "fr-BJ identity fixture",
            status: input.status === "FAILED" ? "FAILED" : "PASSED",
            severity: "HIGH",
            startedAt: now,
            endedAt: now,
            durationMs: 42,
            environment: "local",
            suiteId: "suite-1",
            assertions: [],
            findingIds: input.status === "FAILED" ? ["find_1"] : [],
            evidence: [],
            logs: [],
            attempts: 1,
          },
        ],
      },
    ],
    findings:
      input.status === "FAILED"
        ? [
            {
              id: "find_1",
              testCaseId: `${module}/case-1`,
              module,
              title: "Accented surname was corrupted",
              detail: "Expected Kòfí, received Kof?",
              severity: "HIGH",
              status: "FAILED",
              fingerprint: `${module}:identity:accent`,
              failure: {
                message: "Accented surname was corrupted",
                category: "ASSERTION",
                code: "corrupted_transformation",
                expected: "Kòfí",
                actual: "Kof?",
              },
              reproduction: {
                summary: "Run the fr-BJ profile",
                command: `proofcore test --module ${module}`,
                fixtureIds: [],
              },
              evidenceIds: [],
              startedAt: now,
              endedAt: now,
              durationMs: 42,
            },
          ]
        : [],
  };
}

/** Sign up, activate Developer through a verified sandbox payment, return a project token. */
export async function paidWorkspace(h: Harness) {
  const account = await h.signUp("ada@example.com");
  const projectResponse = await h.request(`/api/v1/projects?workspaceId=${account.workspaceId}`, {
    method: "POST",
    cookie: account.cookie,
    body: JSON.stringify({
      workspaceId: account.workspaceId,
      name: "Shop",
      baseUrl: "http://localhost:3000",
    }),
  });
  expect(projectResponse.status).toBe(201);
  const project = (await json<{ project: { id: string } }>(projectResponse)).project;

  const start = await h.request("/api/v1/checkout/start", {
    method: "POST",
    cookie: account.cookie,
    body: JSON.stringify({
      workspaceId: account.workspaceId,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
    }),
  });
  expect(start.status).toBe(201);
  const checkout = await json<{ intent: { id: string } }>(start);

  const settle = await h.request(
    `/api/v1/checkout/${checkout.intent.id}/sandbox/settle?workspaceId=${account.workspaceId}`,
    {
      method: "POST",
      cookie: account.cookie,
      body: JSON.stringify({ outcome: "success" }),
    }
  );
  expect(settle.status).toBe(200);
  expect((await json<{ outcome: string }>(settle)).outcome).toBe("credited");

  const keyResponse = await h.request("/api/v1/api-keys", {
    method: "POST",
    cookie: account.cookie,
    body: JSON.stringify({
      workspaceId: account.workspaceId,
      projectId: project.id,
      label: "CI",
      scopes: ["runs:write", "reports:read"],
    }),
  });
  expect(keyResponse.status).toBe(201);
  const token = (await json<{ token: string; id: string }>(keyResponse)).token;

  return { ...account, projectId: project.id, token };
}
