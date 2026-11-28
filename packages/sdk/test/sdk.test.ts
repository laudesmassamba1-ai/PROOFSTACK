import type { RunUploadRequest } from "@proofcore/contracts";
import { describe, expect, it } from "vitest";
import { bootstrap, paidWorkspace, sampleRun } from "../../../apps/api/test/harness.js";
import { createProofcoreClient, type FetchLike, ProofcoreApiError } from "../src/index.js";

/**
 * The SDK is proven against the real app, not a hand-written stub: the harness builds the
 * actual routes and database, and the only synthetic part is the transport, which the
 * client accepts by design.
 */

type Harness = Awaited<ReturnType<typeof bootstrap>>;

function transportFor(h: Harness): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    return h.request(`${parsed.pathname}${parsed.search}`, init);
  };
}

const ZERO = { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0 };

function uploadBody(workspaceId: string, projectId: string, runId: string): RunUploadRequest {
  return {
    run: sampleRun({ id: runId, workspaceId, projectId }),
    summary: { totals: { world: ZERO } },
  };
}

describe("PROOFCORE SDK over the machine API", () => {
  it("reads the workspace, project, plan and usage the token actually belongs to", async () => {
    const h = await bootstrap();
    const account = await paidWorkspace(h);
    const client = createProofcoreClient({
      baseUrl: "https://api.test",
      token: account.token,
      fetch: transportFor(h),
    });

    const project = await client.getProject();

    expect(project.workspace.id).toBe(account.workspaceId);
    expect(project.project?.id).toBe(account.projectId);
    expect(project.plan.entitled).toBe(true);
    expect(project.usage.monthlyTestRuns).toBe(0);
  });

  it("uploads a run once, then reports the same key as already recorded", async () => {
    const h = await bootstrap();
    const account = await paidWorkspace(h);
    const client = createProofcoreClient({
      baseUrl: "https://api.test/",
      token: account.token,
      fetch: transportFor(h),
    });

    const body = uploadBody(account.workspaceId, account.projectId, "run_sdk_0001");
    const first = await client.uploadRun(body);
    const second = await client.uploadRun(body);

    expect(first.recorded).toBe(true);
    expect(first.runId).toBeTruthy();
    expect(first.reportId).toBeTruthy();
    expect(second.recorded).toBe(false);
    expect(second.runId).toBe(first.runId);

    const project = await client.getProject();
    expect(project.usage.monthlyTestRuns).toBe(1);
  });

  it("sends the Idempotency-Key it derived, and the one it was given", async () => {
    const h = await bootstrap();
    const account = await paidWorkspace(h);
    const seen: (string | null)[] = [];
    const client = createProofcoreClient({
      baseUrl: "https://api.test",
      token: account.token,
      fetch: async (url, init) => {
        seen.push(new Headers(init?.headers).get("idempotency-key"));
        return transportFor(h)(url, init);
      },
    });

    const body = uploadBody(account.workspaceId, account.projectId, "run_sdk_0002");
    await client.uploadRun(body);
    await client.uploadRun(uploadBody(account.workspaceId, account.projectId, "run_sdk_0003"), {
      idempotencyKey: "deploy-2026-11-28-001",
    });

    expect(seen).toEqual(["sync:run_sdk_0002", "deploy-2026-11-28-001"]);
  });

  it("turns a missing scope into a typed 403 instead of a thrown string", async () => {
    const h = await bootstrap();
    const account = await paidWorkspace(h);
    const created = await h.request("/api/v1/api-keys", {
      method: "POST",
      cookie: account.cookie,
      body: JSON.stringify({
        workspaceId: account.workspaceId,
        projectId: account.projectId,
        label: "read only",
        scopes: ["reports:read"],
      }),
    });
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };

    const client = createProofcoreClient({
      baseUrl: "https://api.test",
      token,
      fetch: transportFor(h),
    });

    const error = await client
      .uploadRun(uploadBody(account.workspaceId, account.projectId, "run_sdk_0004"))
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProofcoreApiError);
    const apiError = error as ProofcoreApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe("scope_missing");
    expect(apiError.message).toContain("runs:write");
  });

  it("reports an unknown token as invalid_api_key, not as a network failure", async () => {
    const h = await bootstrap();
    await paidWorkspace(h);
    const client = createProofcoreClient({
      baseUrl: "https://api.test",
      token: "psk_this_token_does_not_exist",
      fetch: transportFor(h),
    });

    const error = (await client.getProject().catch((cause: unknown) => cause)) as ProofcoreApiError;

    expect(error).toBeInstanceOf(ProofcoreApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_api_key");
  });

  it("reads the token from its variable at call time, so a rotation needs no new client", async () => {
    const h = await bootstrap();
    const account = await paidWorkspace(h);
    const name = "PROOFCORE_SDK_TEST_TOKEN";
    const previous = process.env[name];
    process.env[name] = account.token;
    const client = createProofcoreClient({
      baseUrl: "https://api.test",
      tokenEnvVar: name,
      fetch: transportFor(h),
    });

    try {
      await expect(client.getProject()).resolves.toMatchObject({
        workspace: { id: account.workspaceId },
      });
      delete process.env[name];
      await expect(client.getProject()).rejects.toThrow(new RegExp(`${name} is not set`));
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  it("refuses a session cookie as a credential before spending a request", () => {
    expect(() =>
      createProofcoreClient({ baseUrl: "https://api.test", token: "ps_sess_123" })
    ).toThrow(/project token/);
  });

  it("refuses a 2xx body it does not recognise instead of casting it", async () => {
    const client = createProofcoreClient({
      baseUrl: "https://api.test",
      token: "psk_valid_looking",
      fetch: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const error = (await client.getProject().catch((cause: unknown) => cause)) as ProofcoreApiError;

    expect(error).toBeInstanceOf(ProofcoreApiError);
    expect(error.code).toBe("invalid_response");
    expect(error.details).toBeTruthy();
  });
});
