import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";

/**
 * Remediations: a fix is only verified by a new measurement.
 *
 * The tests walk the chain the way a person does — open, advance, apply, re-measure — and
 * assert the refusals: skipping a step, claiming "verified", and verifying with the very
 * analysis that produced the finding are all rejected.
 */

const PASSWORD = "correct horse battery";
const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };

async function bootstrap() {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({ db, env: ENV });
  const config = readConfig(ENV);
  return {
    request: (path: string, init: RequestInit = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
      }),
    close: async () => db.close(),
  };
}

type Harness = Awaited<ReturnType<typeof bootstrap>>;
let harness: Harness;
beforeEach(async () => {
  harness = await bootstrap();
});
afterEach(async () => {
  await harness.close();
});

async function signUp(email: string): Promise<{ cookie: string; workspaceId: string }> {
  const response = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Tester" }),
  });
  expect(response.status).toBe(201);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string };
  return { cookie, workspaceId: session.workspaceId };
}

const SCAN = {
  findings: [
    {
      module: "fail",
      id: "hsts",
      status: "FAIL",
      observed: "Strict-Transport-Security absent",
      why: "a downgrade stays possible",
    },
    {
      module: "clean",
      id: "html_lang",
      status: "WARN",
      observed: "html lang is empty",
      why: "screen readers pick the wrong voice",
    },
  ],
};

async function analysisWith(
  auth: { cookie: string; workspaceId: string },
  result: unknown
): Promise<string> {
  const created = await harness.request("/api/v1/analyses", {
    method: "POST",
    headers: { cookie: auth.cookie },
    body: JSON.stringify({
      workspaceId: auth.workspaceId,
      source: "API",
      targetType: "PAGE",
      target: "https://shop.example/checkout",
      requestedModules: ["fail", "clean"],
    }),
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { analysis: { id: string } }).analysis.id;
  for (const body of [{ status: "running" }, { status: "completed", result }]) {
    const patched = await harness.request(
      `/api/v1/analyses/${id}?workspaceId=${auth.workspaceId}`,
      { method: "PATCH", headers: { cookie: auth.cookie }, body: JSON.stringify(body) }
    );
    expect(patched.status, await patched.clone().text()).toBe(200);
  }
  return id;
}

interface RemediationBody {
  remediation: {
    id: string;
    status: string;
    steps: Array<{ step: string; at: string }>;
    nextStep: string | null;
    findingKey: string;
    fix: string;
    verification: string;
    verifiedAt: string | null;
    verificationOutcome: string | null;
  };
}

async function openRemediation(
  auth: { cookie: string; workspaceId: string },
  analysisId: string,
  findingKey: string
): Promise<RemediationBody["remediation"]> {
  const response = await harness.request("/api/v1/remediations", {
    method: "POST",
    headers: { cookie: auth.cookie },
    body: JSON.stringify({ workspaceId: auth.workspaceId, analysisId, findingKey }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as RemediationBody).remediation;
}

function patch(
  auth: { cookie: string; workspaceId: string },
  id: string,
  body: unknown
): Promise<Response> {
  return harness.request(`/api/v1/remediations/${id}?workspaceId=${auth.workspaceId}`, {
    method: "PATCH",
    headers: { cookie: auth.cookie },
    body: JSON.stringify(body),
  });
}

describe("remediations", () => {
  it("seeds the chain from the finding, with the registry's fix", async () => {
    const auth = await signUp("fix@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const remediation = await openRemediation(
      auth,
      analysisId,
      "fail:hsts@https://shop.example/checkout"
    );
    expect(remediation.status).toBe("proposed");
    expect(remediation.steps.map((step) => step.step)).toEqual([
      "read_finding",
      "verify_evidence",
      "gather_context",
    ]);
    expect(remediation.nextStep).toBe("prepare_fix");
    expect(remediation.fix.length).toBeGreaterThan(10);
    expect(remediation.verification.length).toBeGreaterThan(10);
  });

  it("refuses a finding that is not in the analysis", async () => {
    const auth = await signUp("missing@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const response = await harness.request("/api/v1/remediations", {
      method: "POST",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({
        workspaceId: auth.workspaceId,
        analysisId,
        findingKey: "fail:nope@https://shop.example/checkout",
      }),
    });
    expect(response.status).toBe(404);
  });

  it("refuses an owner who is not a member of the workspace", async () => {
    const auth = await signUp("owner-a@example.com");
    const outsider = await signUp("owner-b@example.com");
    const outsiderId = (
      (await (
        await harness.request("/api/auth/session", { headers: { cookie: outsider.cookie } })
      ).json()) as { user: { id: string } }
    ).user.id;
    const analysisId = await analysisWith(auth, SCAN);
    const key = "fail:hsts@https://shop.example/checkout";
    const refused = await harness.request("/api/v1/remediations", {
      method: "POST",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({
        workspaceId: auth.workspaceId,
        analysisId,
        findingKey: key,
        ownerId: outsiderId,
      }),
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error?: { code?: string } }).error?.code).toBe(
      "owner_not_member"
    );
    const opened = await openRemediation(auth, analysisId, key);
    const reassign = await patch(auth, opened.id, { ownerId: outsiderId });
    expect(reassign.status).toBe(400);
    expect(((await reassign.json()) as { error?: { code?: string } }).error?.code).toBe(
      "owner_not_member"
    );
  });

  it("does not open two remediations for one finding", async () => {
    const auth = await signUp("twice@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const key = "fail:hsts@https://shop.example/checkout";
    await openRemediation(auth, analysisId, key);
    const response = await harness.request("/api/v1/remediations", {
      method: "POST",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({ workspaceId: auth.workspaceId, analysisId, findingKey: key }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("remediation_exists");
  });

  it("advances one step at a time and refuses to skip", async () => {
    const auth = await signUp("chain@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const remediation = await openRemediation(
      auth,
      analysisId,
      "fail:hsts@https://shop.example/checkout"
    );
    const skip = await patch(auth, remediation.id, { advance: { step: "preview" } });
    expect(skip.status).toBe(400);
    const next = await patch(auth, remediation.id, { advance: { step: "prepare_fix" } });
    expect(next.status).toBe(200);
    const body = (await next.json()) as RemediationBody;
    expect(body.remediation.nextStep).toBe("explain");
    expect(body.remediation.steps.at(-1)?.step).toBe("prepare_fix");
  });

  it("refuses to call itself verified", async () => {
    const auth = await signUp("claim@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const remediation = await openRemediation(
      auth,
      analysisId,
      "fail:hsts@https://shop.example/checkout"
    );
    const response = await patch(auth, remediation.id, { status: "verified" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe(
      "verification_required"
    );
  });

  it("verifies only with a later analysis that passed the same control", async () => {
    const auth = await signUp("verify@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const remediation = await openRemediation(
      auth,
      analysisId,
      "fail:hsts@https://shop.example/checkout"
    );
    await patch(auth, remediation.id, { status: "approved" });
    await patch(auth, remediation.id, { status: "applied" });

    const stillFailing = await analysisWith(auth, SCAN);
    const failed = await harness.request(`/api/v1/remediations/${remediation.id}/verify`, {
      method: "POST",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({ workspaceId: auth.workspaceId, analysisId: stillFailing }),
    });
    expect(failed.status).toBe(200);
    const failedBody = (await failed.json()) as {
      outcome: string;
      remediation: { status: string };
    };
    expect(failedBody.outcome).toBe("still_failing");
    expect(failedBody.remediation.status).toBe("failed");
  });

  it("marks verified when the control now passes, and records the proof", async () => {
    const auth = await signUp("proof@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const remediation = await openRemediation(
      auth,
      analysisId,
      "fail:hsts@https://shop.example/checkout"
    );
    await patch(auth, remediation.id, { status: "approved" });
    await patch(auth, remediation.id, { status: "applied" });
    const proof = await analysisWith(auth, {
      findings: [
        {
          module: "fail",
          id: "hsts",
          status: "PASS",
          observed: "max-age=31536000",
          why: "",
        },
      ],
    });
    const response = await harness.request(`/api/v1/remediations/${remediation.id}/verify`, {
      method: "POST",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({ workspaceId: auth.workspaceId, analysisId: proof }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      outcome: string;
      remediation: {
        status: string;
        verifiedAt: string | null;
        verificationAnalysisId: string;
        verificationOutcome: string;
      };
    };
    expect(body.outcome).toBe("verified");
    expect(body.remediation.status).toBe("verified");
    expect(body.remediation.verifiedAt).toBeTruthy();
    expect(body.remediation.verificationAnalysisId).toBe(proof);
  });

  it("refuses an inconclusive verification instead of counting it as success", async () => {
    const auth = await signUp("inconclusive@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    const remediation = await openRemediation(
      auth,
      analysisId,
      "fail:hsts@https://shop.example/checkout"
    );
    const blank = await analysisWith(auth, { findings: [] });
    const response = await harness.request(`/api/v1/remediations/${remediation.id}/verify`, {
      method: "POST",
      headers: { cookie: auth.cookie },
      body: JSON.stringify({ workspaceId: auth.workspaceId, analysisId: blank }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("verification_inconclusive");
  });

  it("lists open remediations by status, worst priority first", async () => {
    const auth = await signUp("list@example.com");
    const analysisId = await analysisWith(auth, SCAN);
    await openRemediation(auth, analysisId, "fail:hsts@https://shop.example/checkout");
    await openRemediation(auth, analysisId, "clean:html_lang@https://shop.example/checkout");
    const response = await harness.request(`/api/v1/remediations?workspaceId=${auth.workspaceId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      remediations: { total: number; items: Array<{ priority: string }> };
    };
    expect(body.remediations.total).toBe(2);
    // Worst priority first, whatever the registry currently says about these two controls.
    const rank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const priorities = body.remediations.items.map((item) => item.priority);
    expect(priorities).toHaveLength(2);
    expect(priorities).toEqual([...priorities].sort((a, b) => rank[a] - rank[b]));
  });
});
