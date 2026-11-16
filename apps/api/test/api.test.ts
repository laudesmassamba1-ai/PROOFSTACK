import type { TestRun } from "@proofstack/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import type { Services } from "../src/http/services.js";

/**
 * API integration tests.
 *
 * They run the real app against real SQLite (in memory), with the real billing and
 * usage engines. Only the transport is synthetic. The tests that matter most are the
 * ones a security review would ask for: tenant isolation, payment authority, webhook
 * replay, origin checks and upload idempotency.
 */

const ENV = {
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:5173",
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

function harness(): Harness {
  const db = NodeSqliteDatabase.open(":memory:");
  const built = createApp({ db, env: ENV });
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
    return { cookie: cookie!, workspaceId: body.workspace.id, userId: body.user.id };
  };

  return { services: built.services, request, signUp };
}

async function bootstrap(): Promise<Harness> {
  const h = harness();
  await migrate(h.services.db, migrationFiles());
  return h;
}

function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

/** The upload envelope: the contract requires a totals entry for every module. */
function uploadBody(run: TestRun): string {
  const zero = { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0 };
  return JSON.stringify({ run, summary: { totals: { world: zero, flow: zero, exit: zero } } });
}

function sampleRun(input: {
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
                command: `proofstack test --module ${module}`,
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
async function paidWorkspace(h: Harness) {
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

describe("health and public catalogue", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap();
  });

  it("reports its runtime and that payments are sandboxed without credentials", async () => {
    const response = await h.request("/health");
    expect(response.status).toBe(200);
    const body = await json<{
      status: string;
      database: string;
      payments: { provider: string; configured: boolean };
    }>(response);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
    expect(body.payments).toEqual({ provider: "sandbox", configured: false });
  });

  it("serves plans without inventing recurring billing", async () => {
    const body = await json<{
      items: { key: string }[];
      recurringSupported: boolean;
      billingModelNote: string;
    }>(await h.request("/api/v1/plans"));
    expect(body.items.map((plan) => plan.key)).toEqual(["free", "developer", "studio", "agency"]);
    expect(body.recurringSupported).toBe(false);
    expect(body.billingModelNote).toContain("renewed manually");
  });

  /**
   * Regression: CORS used to be mounted on `/api/*` only, so `/health` answered 200
   * with no `Access-Control-Allow-Origin`. The browser could not read it, the web app
   * concluded the API was down, and told the user to start a server that was already
   * running. The probe is the first request the dashboard makes, so this has to work.
   */
  it("lets the configured web origin read /health", async () => {
    const response = await h.request("/health", { headers: { origin: "http://localhost:5173" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not hand CORS headers to an unknown origin", async () => {
    const response = await h.request("/health", { headers: { origin: "https://evil.example" } });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("authentication", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap();
  });

  it("creates an account, a workspace and a usable session", async () => {
    const account = await h.signUp("ada@example.com");
    const session = await json<{
      user: { email: string };
      workspaces: { id: string; role: string }[];
    }>(await h.request("/api/auth/session", { cookie: account.cookie }));
    expect(session.user.email).toBe("ada@example.com");
    expect(session.workspaces[0]).toMatchObject({ id: account.workspaceId, role: "owner" });
  });

  it("never reveals whether an email exists", async () => {
    await h.signUp("ada@example.com");
    const wrong = await h.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "ada@example.com", password: "not the password" }),
    });
    const unknown = await h.request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.com", password: "not the password" }),
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const wrongError = await json<{ error: { code: string; message: string } }>(wrong);
    const unknownError = await json<{ error: { code: string; message: string } }>(unknown);
    expect(wrongError.error).toMatchObject({
      code: unknownError.error.code,
      message: unknownError.error.message,
    });
  });

  it("refuses a weak password and a duplicate account", async () => {
    const weak = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: "weak@example.com", password: "short", name: "Ada" }),
    });
    expect(weak.status).toBe(400);

    await h.signUp("ada@example.com");
    const duplicate = await h.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        email: "ADA@example.com",
        password: "correct horse battery",
        name: "Ada",
      }),
    });
    expect(duplicate.status).toBe(409);
  });

  it("invalidates the session on sign-out", async () => {
    const account = await h.signUp("ada@example.com");
    await h.request("/api/auth/sign-out", { method: "POST", cookie: account.cookie });
    const session = await json<{ user: unknown }>(
      await h.request("/api/auth/session", { cookie: account.cookie })
    );
    expect(session.user).toBeNull();
  });

  it("rejects a cookie-authenticated write from another origin", async () => {
    const account = await h.signUp("ada@example.com");
    const response = await h.request("/api/v1/projects", {
      method: "POST",
      cookie: account.cookie,
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({
        workspaceId: account.workspaceId,
        name: "x",
        baseUrl: "https://example.com",
      }),
    });
    expect(response.status).toBe(403);
  });
});

describe("tenancy and entitlements", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap();
  });

  it("answers 404 for another user's workspace and project", async () => {
    const alice = await h.signUp("alice@example.com");
    const bob = await h.signUp("bob@example.com");
    const created = await h.request(`/api/v1/projects?workspaceId=${alice.workspaceId}`, {
      method: "POST",
      cookie: alice.cookie,
      body: JSON.stringify({
        workspaceId: alice.workspaceId,
        name: "Alice app",
        baseUrl: "https://alice.example",
      }),
    });
    const project = (await json<{ project: { id: string } }>(created)).project;

    expect(
      (await h.request(`/api/v1/projects?workspaceId=${alice.workspaceId}`, { cookie: bob.cookie }))
        .status
    ).toBe(404);
    expect(
      (
        await h.request(`/api/v1/projects/${project.id}?workspaceId=${alice.workspaceId}`, {
          cookie: bob.cookie,
        })
      ).status
    ).toBe(404);
    expect(
      (await h.request(`/api/v1/overview?workspaceId=${alice.workspaceId}`, { cookie: bob.cookie }))
        .status
    ).toBe(404);
  });

  it("enforces the free plan's single-project limit", async () => {
    const account = await h.signUp("ada@example.com");
    const first = await h.request("/api/v1/projects", {
      method: "POST",
      cookie: account.cookie,
      body: JSON.stringify({
        workspaceId: account.workspaceId,
        name: "One",
        baseUrl: "https://one.example",
      }),
    });
    expect(first.status).toBe(201);

    const second = await h.request("/api/v1/projects", {
      method: "POST",
      cookie: account.cookie,
      body: JSON.stringify({
        workspaceId: account.workspaceId,
        name: "Two",
        baseUrl: "https://two.example",
      }),
    });
    expect(second.status).toBe(403);
    const body = await json<{
      error: { code: string; details: { limit: number; requiredPlanKey?: string } };
    }>(second);
    expect(body.error.code).toBe("project_limit_reached");
    expect(body.error.details.limit).toBe(1);
    expect(body.error.details.requiredPlanKey).toBe("developer");
  });

  it("refuses API keys on a plan without API access", async () => {
    const account = await h.signUp("ada@example.com");
    const response = await h.request("/api/v1/api-keys", {
      method: "POST",
      cookie: account.cookie,
      body: JSON.stringify({ workspaceId: account.workspaceId, label: "CI" }),
    });
    expect(response.status).toBe(403);
    expect((await json<{ error: { code: string } }>(response)).error.code).toBe(
      "api_access_not_included"
    );
  });
});

describe("billing authority", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap();
  });

  it("does not grant paid access from a redirect, only from a verified payment", async () => {
    const account = await h.signUp("ada@example.com");
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
    const { intent } = await json<{ intent: { id: string; state: string } }>(start);
    expect(intent.state).toBe("PENDING");

    const status = await json<{ entitled: boolean; state: string; nextAction: string }>(
      await h.request(`/api/v1/checkout/${intent.id}?workspaceId=${account.workspaceId}`, {
        cookie: account.cookie,
      })
    );
    expect(status.entitled).toBe(false);
    expect(status.state).toBe("PENDING");
    expect(status.nextAction).toBe("verify");

    const billing = await json<{
      subscription: { planKey: string; entitled: boolean; state: string };
    }>(
      await h.request(`/api/v1/billing?workspaceId=${account.workspaceId}`, {
        cookie: account.cookie,
      })
    );
    expect(billing.subscription).toMatchObject({ planKey: "free", entitled: false });

    const settle = await h.request(
      `/api/v1/checkout/${intent.id}/sandbox/settle?workspaceId=${account.workspaceId}`,
      { method: "POST", cookie: account.cookie, body: JSON.stringify({ outcome: "success" }) }
    );
    expect((await json<{ outcome: string }>(settle)).outcome).toBe("credited");

    const after = await json<{
      subscription: { planKey: string; entitled: boolean; state: string };
    }>(
      await h.request(`/api/v1/billing?workspaceId=${account.workspaceId}`, {
        cookie: account.cookie,
      })
    );
    expect(after.subscription).toMatchObject({
      planKey: "developer",
      entitled: true,
      state: "ACTIVE",
    });
  });

  it("marks a declined payment failed and grants nothing", async () => {
    const account = await h.signUp("ada@example.com");
    const start = await json<{ intent: { id: string } }>(
      await h.request("/api/v1/checkout/start", {
        method: "POST",
        cookie: account.cookie,
        body: JSON.stringify({
          workspaceId: account.workspaceId,
          planKey: "developer",
          period: "monthly",
          currency: "USD",
        }),
      })
    );
    const settle = await json<{ outcome: string; state: string }>(
      await h.request(
        `/api/v1/checkout/${start.intent.id}/sandbox/settle?workspaceId=${account.workspaceId}`,
        {
          method: "POST",
          cookie: account.cookie,
          body: JSON.stringify({ outcome: "declined" }),
        }
      )
    );
    expect(settle.outcome).toBe("failed");
    const billing = await json<{
      subscription: { entitled: boolean };
      payments: { state: string }[];
    }>(
      await h.request(`/api/v1/billing?workspaceId=${account.workspaceId}`, {
        cookie: account.cookie,
      })
    );
    expect(billing.subscription.entitled).toBe(false);
    expect(billing.payments[0]?.state).toBe("FAILED");
  });

  it("records cancellation at period end without revoking paid time", async () => {
    const paid = await paidWorkspace(h);
    const cancel = await json<{ state: string }>(
      await h.request("/api/v1/billing/cancel", {
        method: "POST",
        cookie: paid.cookie,
        body: JSON.stringify({ workspaceId: paid.workspaceId, atPeriodEnd: true }),
      })
    );
    expect(cancel.state).toBe("CANCEL_AT_PERIOD_END");

    const billing = await json<{
      subscription: { entitled: boolean; cancelAtPeriodEnd: boolean; state: string };
    }>(await h.request(`/api/v1/billing?workspaceId=${paid.workspaceId}`, { cookie: paid.cookie }));
    expect(billing.subscription.entitled).toBe(true);
    expect(billing.subscription.cancelAtPeriodEnd).toBe(true);
    expect(billing.subscription.state).toBe("CANCEL_AT_PERIOD_END");
  });
});

describe("run ingestion", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap();
  });

  it("rejects an unsigned upload, a wrong workspace and a cross-tenant project", async () => {
    const paid = await paidWorkspace(h);
    const unsigned = await h.request("/v1/runs", {
      method: "POST",
      headers: { "idempotency-key": "idem-0000001" },
      body: uploadBody(
        sampleRun({ id: "run_1", projectId: paid.projectId, workspaceId: paid.workspaceId })
      ),
    });
    expect(unsigned.status).toBe(401);

    const otherWorkspace = await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-0000002" },
      body: uploadBody(
        sampleRun({ id: "run_2", projectId: paid.projectId, workspaceId: "ws_other" })
      ),
    });
    expect(otherWorkspace.status, await otherWorkspace.clone().text()).toBe(403);
  });

  it("stores a run once per idempotency key and meters it once per run id", async () => {
    const paid = await paidWorkspace(h);
    const run = sampleRun({
      id: "run_abc",
      projectId: paid.projectId,
      workspaceId: paid.workspaceId,
      status: "FAILED",
    });
    const body = uploadBody(run);
    const headers = { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-run-abc" };

    const first = await h.request("/v1/runs", { method: "POST", headers, body });
    const firstBody = await first.text();
    expect(first.status, firstBody).toBe(201);
    const accepted = JSON.parse(firstBody) as {
      runId: string;
      reportId: string;
      recorded: boolean;
      usage: { monthlyTestRuns: number };
    };
    expect(accepted).toMatchObject({ runId: "run_abc", recorded: true });
    expect(accepted.usage.monthlyTestRuns).toBe(1);

    const replay = await h.request("/v1/runs", { method: "POST", headers, body });
    expect(replay.status).toBe(200);
    expect((await json<{ recorded: boolean }>(replay)).recorded).toBe(false);

    // A different idempotency key for the same run must not double-bill either: the
    // usage meter dedupes on the run id.
    const retry = await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-run-abc-again" },
      body,
    });
    expect(retry.status).toBe(201);
    expect((await json<{ usage: { monthlyTestRuns: number } }>(retry)).usage.monthlyTestRuns).toBe(
      1
    );

    const runs = await json<{ items: { id: string; status: string }[] }>(
      await h.request(`/api/v1/projects/${paid.projectId}/runs?workspaceId=${paid.workspaceId}`, {
        cookie: paid.cookie,
      })
    );
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({ id: "run_abc", status: "FAILED" });

    const findings = await json<{ items: { title: string; code: string }[] }>(
      await h.request(
        `/api/v1/projects/${paid.projectId}/findings?workspaceId=${paid.workspaceId}`,
        { cookie: paid.cookie }
      )
    );
    expect(findings.items[0]).toMatchObject({
      title: "Accented surname was corrupted",
      code: "corrupted_transformation",
    });

    const html = await h.request(
      `/api/v1/reports/${accepted.reportId}?workspaceId=${paid.workspaceId}&format=html`,
      { cookie: paid.cookie }
    );
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("accented surname survives the form");
  });

  it("records a harness error without consuming quota", async () => {
    const paid = await paidWorkspace(h);
    const response = await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-error-run" },
      body: uploadBody(
        sampleRun({
          id: "run_error",
          projectId: paid.projectId,
          workspaceId: paid.workspaceId,
          status: "ERROR",
        })
      ),
    });
    expect(response.status).toBe(201);
    expect(
      (await json<{ usage: { monthlyTestRuns: number } }>(response)).usage.monthlyTestRuns
    ).toBe(0);
  });

  it("fails an upload without an Idempotency-Key header", async () => {
    const paid = await paidWorkspace(h);
    const response = await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}` },
      body: uploadBody(
        sampleRun({ id: "run_no_idem", projectId: paid.projectId, workspaceId: paid.workspaceId })
      ),
    });
    expect(response.status).toBe(400);
  });
});

describe("webhooks", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await bootstrap();
  });

  it("rejects a forged signature and accepts a valid duplicate only once", async () => {
    const paid = await paidWorkspace(h);
    const intents = await h.services.billing.listIntents(paid.workspaceId);
    const reference = intents[0]?.providerReference;
    expect(reference).toBeTruthy();

    const provider = h.services.provider as unknown as {
      signWebhook(
        event: string,
        data: Record<string, unknown>
      ): Promise<{ body: string; headers: Record<string, string> }>;
    };
    const signed = await provider.signWebhook("transaction.success", {
      id: reference,
      status: "SUCCESS",
    });

    const forged = await h.request("/api/webhooks/sandbox", {
      method: "POST",
      headers: { ...signed.headers, "x-webhook-signature": "00".repeat(32) },
      body: signed.body,
    });
    expect(forged.status).toBe(400);

    const accepted = await h.request("/api/webhooks/sandbox", {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    expect(accepted.status).toBe(200);
    expect((await json<{ result: string }>(accepted)).result).toBe("already_credited");

    const duplicate = await h.request("/api/webhooks/sandbox", {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    expect(duplicate.status).toBe(200);
    expect((await json<{ duplicate: boolean }>(duplicate)).duplicate).toBe(true);

    const stored = await h.services.billing.listWebhooks(10);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.processingState).toBe("PROCESSED");
  });

  it("rejects a stale timestamp", async () => {
    const signed = await (
      h.services.provider as unknown as {
        signWebhook(
          event: string,
          data: Record<string, unknown>,
          ts?: number
        ): Promise<{ body: string; headers: Record<string, string> }>;
      }
    ).signWebhook(
      "transaction.success",
      { id: "sbx_unknown" },
      Math.floor(Date.now() / 1000) - 3600
    );
    const response = await h.request("/api/webhooks/sandbox", {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    expect(response.status).toBe(400);
  });
});
