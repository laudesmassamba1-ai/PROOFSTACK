import { type auditSite, findingKey, type scanPage } from "@proofcore/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";
import { findingsForAnalysis } from "../src/findings.js";

/**
 * Verifying a prepared patch by launching the later analysis itself.
 *
 * The scanner is injected, so these tests describe the HTTP path without a network call:
 * a real analysis is recorded, the remediation is opened once, and the verdict comes from
 * the second measurement. A failed or inconclusive reading never becomes a fix.
 */

const PASSWORD = "correct horse battery";
const ENV = { NODE_ENV: "test", ADMIN_EMAILS: "ops@example.com" };

type ScanMode = "pass" | "fail" | "offline";

function scanner(mode: ScanMode, calls: { count: number }) {
  return (async () => {
    calls.count += 1;
    if (mode === "offline") throw new Error("ECONNREFUSED");
    return {
      url: "https://shop.example/",
      finalUrl: "https://shop.example/",
      status: 200,
      contentType: "text/html",
      bytes: 1200,
      durationMs: 42,
      scannedAt: new Date().toISOString(),
      findings: [
        {
          module: "fail",
          id: "hsts",
          status: mode === "pass" ? "PASS" : "FAIL",
          observed: mode === "pass" ? "max-age=31536000" : "absent",
          why: "HSTS prevents a protocol downgrade.",
        },
      ],
      modules: [],
      probes: [],
      clientRendered: false,
      ownership: "unverified",
      redacted: true,
      login: null,
      verification: { tokenProvided: false, found: false, where: null },
    };
  }) as unknown as typeof scanPage;
}

function siteScanner(mode: ScanMode) {
  return (async () => {
    if (mode === "offline") throw new Error("ECONNREFUSED");
    return {
      scan: {
        url: "https://shop.example/",
        finalUrl: "https://shop.example/",
        status: 200,
        contentType: "text/html",
        bytes: 1200,
        durationMs: 42,
        scannedAt: new Date().toISOString(),
        findings: [
          {
            module: "fail",
            id: "hsts",
            status: mode === "pass" ? "PASS" : "FAIL",
            observed: mode === "pass" ? "max-age=31536000" : "absent",
            why: "HSTS prevents a protocol downgrade.",
          },
        ],
        modules: [],
        probes: [],
        clientRendered: false,
        ownership: "unverified",
        redacted: true,
        login: null,
        verification: { tokenProvided: false, found: false, where: null },
      },
      login: null,
      site: {
        pages: [],
        skipped: [],
        robots: null,
        sitemap: null,
        truncated: false,
        truncatedBy: null,
        requests: 1,
        durationMs: 10,
        findings: [],
      },
      scores: [],
      score: { score: 100, coverage: 1, provisional: false },
      measuredControls: 1,
    };
  }) as unknown as typeof auditSite;
}

function flowRunner(mode: "pass" | "fail" | "none") {
  return async () => ({
    runId: mode === "none" ? null : "run_flow_1",
    reportId: mode === "none" ? null : "rpt_flow_1",
    status: mode === "pass" ? "COMPLETED" : mode === "fail" ? "FAILED" : "NOT_RUNNABLE",
    cases:
      mode === "none"
        ? []
        : [
            {
              id: "order_duplicate",
              status: mode === "pass" ? "PASSED" : "FAILED",
              ...(mode === "fail"
                ? {
                    failure: {
                      code: "duplicate_order_created",
                      message: "A retry created a second order.",
                    },
                  }
                : {}),
            },
          ],
    ...(mode === "none" ? { note: "FLOW has no configured target." } : {}),
  });
}

async function bootstrap(
  mode: ScanMode,
  calls = { count: 0 },
  options: { siteAudit?: typeof auditSite; runFlow?: ReturnType<typeof flowRunner> } = {}
) {
  const db = NodeSqliteDatabase.open(":memory:");
  await migrate(db, migrationFiles());
  const built = createApp({
    db,
    env: ENV,
    scan: scanner(mode, calls),
    ...(options.siteAudit ? { siteAudit: options.siteAudit } : {}),
    ...(options.runFlow ? { runFlow: options.runFlow } : {}),
  });
  const config = readConfig(ENV);
  return {
    request: (path: string, init: RequestInit = {}) =>
      built.app.request(`http://localhost${path}`, {
        ...init,
        headers: { "content-type": "application/json", origin: config.webOrigin, ...init.headers },
      }),
    services: built.services,
    calls,
    close: async () => db.close(),
  };
}

type Harness = Awaited<ReturnType<typeof bootstrap>>;
let harness: Harness;

beforeEach(async () => {
  harness = await bootstrap("pass");
});
afterEach(async () => {
  await harness.close();
});

async function seed(
  email: string,
  status: "FAIL" | "PASS" = "FAIL",
  module = "fail",
  targetType: "PAGE" | "SITE" | "WORKFLOW" | "API" = "PAGE",
  controlId = "hsts"
) {
  const signed = await harness.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, name: "Tester" }),
  });
  expect(signed.status).toBe(201);
  const cookie = (signed.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const session = (await (
    await harness.request("/api/auth/session", { headers: { cookie } })
  ).json()) as { workspaceId: string; user: { id: string } };
  const project = await harness.services.store.createProject({
    workspaceId: session.workspaceId,
    name: "Shop",
    baseUrl: "https://shop.example",
    environment: "production",
    enabledModules: ["world", "flow", "exit"],
  });
  const now = new Date().toISOString();
  const analysis = await harness.services.store.createAnalysis({
    id: `ana_verify_${Math.random().toString(16).slice(2, 10)}`,
    workspaceId: session.workspaceId,
    projectId: project.id,
    createdBy: session.user.id,
    source: "WEB",
    targetType,
    target: targetType === "WORKFLOW" ? "https://shop.example/checkout" : "https://shop.example/",
    scope: targetType,
    requestedModules: [module],
    applicableModules: [module],
    engine: "scan",
    engineVersion: "1",
    environment: "production",
    status: "completed",
    coverage: {
      requestedModules: [module],
      applicableModules: [module],
      measuredModules: [module],
      skipped: [],
    },
    startedAt: now,
    correlationId: "corr_verify_patch",
  });
  await harness.services.store.updateAnalysis({
    workspaceId: session.workspaceId,
    id: analysis.id,
    patch: {
      endedAt: now,
      result: {
        findings: [
          {
            module,
            id: controlId,
            status,
            observed:
              status === "FAIL"
                ? controlId === "order_duplicate"
                  ? "duplicate_order_created"
                  : "absent"
                : "max-age=31536000",
            why: "HSTS prevents a protocol downgrade.",
          },
        ],
      },
    },
  });
  return {
    cookie,
    workspaceId: session.workspaceId,
    userId: session.user.id,
    projectId: project.id,
    analysisId: analysis.id,
    key: findingKey(module, controlId, targetType === "PAGE" ? "https://shop.example/" : null),
  };
}

function verify(
  seeded: Awaited<ReturnType<typeof seed>>,
  key = seeded.key,
  extra: Record<string, unknown> = {}
) {
  return harness.request(`/api/v1/analyses/${seeded.analysisId}/verify-patch`, {
    method: "POST",
    headers: { cookie: seeded.cookie },
    body: JSON.stringify({ workspaceId: seeded.workspaceId, findingKey: key, ...extra }),
  });
}

describe("POST /analyses/:id/verify-patch", () => {
  it("records a later analysis, opens the remediation and verifies it", async () => {
    const seeded = await seed("verify-ok@example.com");
    const response = await verify(seeded);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      analysisId: string;
      outcome: string;
      verified: boolean;
      remediation: { id: string; status: string; verificationAnalysisId: string };
      analysis: { pageAuditId: string | null; target: string };
    };
    expect(body.verified).toBe(true);
    expect(body.outcome).toBe("verified");
    expect(body.analysisId).not.toBe(seeded.analysisId);
    expect(body.analysis.target).toBe("https://shop.example/");
    expect(body.analysis.pageAuditId).toBeTruthy();
    expect(body.remediation.status).toBe("verified");
    expect(body.remediation.verificationAnalysisId).toBe(body.analysisId);
    expect(harness.calls.count).toBe(1);

    // The verdict is readable from the canonical record, not just the response.
    const fresh = await harness.services.store.getAnalysis(seeded.workspaceId, body.analysisId);
    expect(fresh).toBeTruthy();
    if (!fresh) return;
    const loaded = await findingsForAnalysis(harness.services, fresh);
    expect(loaded.findings.find((item) => item.key === seeded.key)?.status).toBe("PASSED");
  });

  it("marks the remediation failed when the control still fails", async () => {
    await harness.close();
    harness = await bootstrap("fail");
    const seeded = await seed("verify-still@example.com");
    const response = await verify(seeded);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      outcome: string;
      verified: boolean;
      remediation: { status: string; verificationOutcome: string };
    };
    expect(body.verified).toBe(false);
    expect(body.outcome).toBe("still_failing");
    expect(body.remediation.status).toBe("failed");
    expect(body.remediation.verificationOutcome).toBe("still_failing");
  });

  it("reuses the remediation already tracking the finding", async () => {
    const seeded = await seed("verify-existing@example.com");
    const created = await harness.request("/api/v1/remediations", {
      method: "POST",
      headers: { cookie: seeded.cookie },
      body: JSON.stringify({
        workspaceId: seeded.workspaceId,
        analysisId: seeded.analysisId,
        findingKey: seeded.key,
      }),
    });
    expect(created.status).toBe(201);
    const remediationId = ((await created.json()) as { remediation: { id: string } }).remediation
      .id;

    const body = (await (await verify(seeded)).json()) as { remediation: { id: string } };
    expect(body.remediation.id).toBe(remediationId);
    const remediations = await harness.services.store.listRemediations(seeded.workspaceId, {
      limit: 10,
      offset: 0,
    });
    expect(remediations.total).toBe(1);
  });

  it("refuses a finding that already passes", async () => {
    const seeded = await seed("verify-passed@example.com", "PASS");
    const response = await verify(seeded);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("nothing_to_verify");
    expect(harness.calls.count).toBe(0);
  });

  it("refuses a target type the product cannot re-measure", async () => {
    const seeded = await seed("verify-api@example.com", "FAIL", "fail", "API");
    const response = await verify(seeded);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("verification_not_supported");
    expect(harness.calls.count).toBe(0);
  });

  it("re-measures a SITE analysis with the site crawler and records a SITE analysis", async () => {
    await harness.close();
    harness = await bootstrap("pass", { count: 0 }, { siteAudit: siteScanner("pass") });
    const seeded = await seed("verify-site@example.com", "FAIL", "fail", "SITE");
    const response = await verify(seeded);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      verified: boolean;
      analysisId: string;
      analysis: {
        targetType: string;
        pageAuditId: string | null;
        coverage: { pages?: { scanned: number } };
      };
    };
    expect(body.verified).toBe(true);
    expect(body.analysis.targetType).toBe("SITE");
    expect(body.analysis.pageAuditId).toBeTruthy();
    expect(body.analysis.coverage.pages?.scanned).toBe(0);
    expect(harness.calls.count).toBe(0);
  });

  it("re-runs FLOW and verifies the same case by its case id", async () => {
    await harness.close();
    harness = await bootstrap("pass", { count: 0 }, { runFlow: flowRunner("pass") });
    const seeded = await seed(
      "verify-flow@example.com",
      "FAIL",
      "flow",
      "WORKFLOW",
      "order_duplicate"
    );
    const response = await verify(seeded);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      verified: boolean;
      analysisId: string;
      analysis: { targetType: string; runId: string | null; reportId: string | null };
    };
    expect(body.verified).toBe(true);
    expect(body.analysis.targetType).toBe("WORKFLOW");
    expect(body.analysis.runId).toBe("run_flow_1");
    expect(body.analysis.reportId).toBe("rpt_flow_1");

    const fresh = await harness.services.store.getAnalysis(seeded.workspaceId, body.analysisId);
    expect(fresh).toBeTruthy();
    if (!fresh) return;
    const loaded = await findingsForAnalysis(harness.services, fresh);
    expect(loaded.findings.find((item) => item.key === seeded.key)?.status).toBe("PASSED");
  });

  it("records a confirmed application on the remediation chain before verifying", async () => {
    const seeded = await seed("verify-apply@example.com");
    const response = await verify(seeded, seeded.key, { applied: true });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      verified: boolean;
      remediation: { status: string; appliedAt: string | null; steps: { step: string }[] };
    };
    expect(body.verified).toBe(true);
    expect(body.remediation.status).toBe("verified");
    expect(body.remediation.appliedAt).toBeTruthy();
    expect(body.remediation.steps.map((entry) => entry.step)).toContain("apply");
  });

  it("marks FLOW failed when the re-run case still fails", async () => {
    await harness.close();
    harness = await bootstrap("pass", { count: 0 }, { runFlow: flowRunner("fail") });
    const seeded = await seed(
      "verify-flow-fail@example.com",
      "FAIL",
      "flow",
      "WORKFLOW",
      "order_duplicate"
    );
    const body = (await (await verify(seeded)).json()) as {
      outcome: string;
      verified: boolean;
      remediation: { status: string };
    };
    expect(body.verified).toBe(false);
    expect(body.outcome).toBe("still_failing");
    expect(body.remediation.status).toBe("failed");
  });

  it("returns 502 when FLOW itself cannot run", async () => {
    await harness.close();
    harness = await bootstrap(
      "pass",
      { count: 0 },
      {
        runFlow: async () => {
          throw new Error("browser unavailable");
        },
      }
    );
    const seeded = await seed(
      "verify-flow-down@example.com",
      "FAIL",
      "flow",
      "WORKFLOW",
      "order_duplicate"
    );
    const response = await verify(seeded);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("flow_run_failed");
  });

  it("says FLOW produced no run instead of inventing a verdict", async () => {
    await harness.close();
    harness = await bootstrap("pass", { count: 0 }, { runFlow: flowRunner("none") });
    const seeded = await seed(
      "verify-flow-none@example.com",
      "FAIL",
      "flow",
      "WORKFLOW",
      "order_duplicate"
    );
    const response = await verify(seeded);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("flow_not_runnable");
  });

  it("does not record a SITE analysis when the crawler cannot read the site", async () => {
    await harness.close();
    harness = await bootstrap("pass", { count: 0 }, { siteAudit: siteScanner("offline") });
    const seeded = await seed("verify-site-offline@example.com", "FAIL", "fail", "SITE");
    const response = await verify(seeded);
    expect(response.status).toBe(502);
    const list = await harness.services.store.listAnalyses(seeded.workspaceId, {
      limit: 10,
      offset: 0,
    });
    expect(list.total).toBe(1);
  });

  it("does not invent a verdict when the site cannot be read", async () => {
    await harness.close();
    harness = await bootstrap("offline");
    const seeded = await seed("verify-offline@example.com");
    const response = await verify(seeded);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("scan_failed");

    const list = await harness.services.store.listAnalyses(seeded.workspaceId, {
      limit: 10,
      offset: 0,
    });
    expect(list.total).toBe(1);
    const remediation = await harness.services.store.findRemediationByFinding(
      seeded.workspaceId,
      seeded.analysisId,
      seeded.key
    );
    expect(remediation).toBeNull();
  });
});
