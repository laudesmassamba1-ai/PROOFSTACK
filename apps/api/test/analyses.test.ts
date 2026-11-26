import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/d1.js";
import { migrationFiles, NodeSqliteDatabase } from "../src/db/node-sqlite.js";
import { readConfig } from "../src/env.js";
import { recordScanAnalysis } from "../src/routes/analyses.js";

/**
 * The canonical Analysis resource.
 *
 * The point of the feature is that one identity survives every surface, so the tests
 * assert identity and lifecycle rather than a payload shape: the same intent sent twice
 * must not create two analyses, a finished one must not restart, and a scan must be
 * reachable from the canonical history without copying its evidence.
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
    services: built.services,
    store: built.services.store,
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

function page() {
  return {
    workspaceId: "",
    source: "WEB",
    targetType: "PAGE",
    target: "https://shop.example/checkout",
    requestedModules: ["world", "flow"],
  };
}

describe("analyses", () => {
  it("creates one analysis and replays a retried create", async () => {
    const who = await signUp("analyst@example.com");
    const body = { ...page(), workspaceId: who.workspaceId };
    const first = await harness.request("/api/v1/analyses", {
      method: "POST",
      headers: { cookie: who.cookie, "idempotency-key": "intent-1" },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { analysis: { id: string } };

    // The same intent, retried: a different HTTP status (replay, not creation) but the
    // same analysis — and the table must still hold exactly one row.
    const retried = await harness.request("/api/v1/analyses", {
      method: "POST",
      headers: { cookie: who.cookie, "idempotency-key": "intent-1" },
      body: JSON.stringify(body),
    });
    expect(retried.status).toBe(200);
    const replay = (await retried.json()) as { analysis: { id: string } };
    expect(replay.analysis.id).toBe(created.analysis.id);

    const list = (await (
      await harness.request(`/api/v1/analyses?workspaceId=${who.workspaceId}`, {
        headers: { cookie: who.cookie },
      })
    ).json()) as { total: number; items: { id: string }[] };
    expect(list.total).toBe(1);
  });

  it("records a lifecycle and derives the duration from the real instants", async () => {
    const who = await signUp("runner@example.com");
    const created = (await (
      await harness.request("/api/v1/analyses", {
        method: "POST",
        headers: { cookie: who.cookie },
        body: JSON.stringify({ ...page(), workspaceId: who.workspaceId, status: "running" }),
      })
    ).json()) as { analysis: { id: string; status: string } };
    expect(created.analysis.status).toBe("running");

    const finished = await harness.request(
      `/api/v1/analyses/${created.analysis.id}?workspaceId=${who.workspaceId}`,
      {
        method: "PATCH",
        headers: { cookie: who.cookie },
        body: JSON.stringify({
          status: "completed",
          coverage: {
            measuredModules: ["world", "flow"],
            skipped: [{ module: "exit", reason: "no redirect surface on this page" }],
          },
          result: { failed: 2, warnings: 1 },
        }),
      }
    );
    expect(finished.status).toBe(200);
    const done = (await finished.json()) as {
      analysis: {
        status: string;
        endedAt: string | null;
        durationMs: number | null;
        coverage: { label: string; measuredModules: string[] };
      };
    };
    expect(done.analysis.status).toBe("completed");
    expect(done.analysis.endedAt).not.toBeNull();
    expect(done.analysis.durationMs).toBeGreaterThanOrEqual(0);
    // A skipped applicable module keeps the run honest: "complete" would claim it measured
    // something it explicitly did not.
    expect(done.analysis.coverage.measuredModules).toEqual(["world", "flow"]);
    expect(done.analysis.coverage.label).toBe("partial");
  });

  it("refuses to restart a finished analysis", async () => {
    const who = await signUp("final@example.com");
    const created = (await (
      await harness.request("/api/v1/analyses", {
        method: "POST",
        headers: { cookie: who.cookie },
        body: JSON.stringify({ ...page(), workspaceId: who.workspaceId, status: "running" }),
      })
    ).json()) as { analysis: { id: string } };
    await harness.request(
      `/api/v1/analyses/${created.analysis.id}?workspaceId=${who.workspaceId}`,
      {
        method: "PATCH",
        headers: { cookie: who.cookie },
        body: JSON.stringify({ status: "completed" }),
      }
    );
    const restart = await harness.request(
      `/api/v1/analyses/${created.analysis.id}?workspaceId=${who.workspaceId}`,
      {
        method: "PATCH",
        headers: { cookie: who.cookie },
        body: JSON.stringify({ status: "running" }),
      }
    );
    expect(restart.status).toBe(409);
  });

  it("cancels a running analysis once and treats a second cancel as a no-op", async () => {
    const who = await signUp("canceller@example.com");
    const created = (await (
      await harness.request("/api/v1/analyses", {
        method: "POST",
        headers: { cookie: who.cookie },
        body: JSON.stringify({ ...page(), workspaceId: who.workspaceId, status: "running" }),
      })
    ).json()) as { analysis: { id: string } };

    const cancelled = await harness.request(
      `/api/v1/analyses/${created.analysis.id}/cancel?workspaceId=${who.workspaceId}`,
      {
        method: "POST",
        headers: { cookie: who.cookie },
      }
    );
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { analysis: { status: string } }).analysis.status).toBe(
      "cancelled"
    );

    const again = await harness.request(
      `/api/v1/analyses/${created.analysis.id}/cancel?workspaceId=${who.workspaceId}`,
      {
        method: "POST",
        headers: { cookie: who.cookie },
      }
    );
    const body = (await again.json()) as { alreadyFinished: boolean };
    expect(body.alreadyFinished).toBe(true);
  });

  it("does not expose an analysis to another workspace", async () => {
    const owner = await signUp("owner@example.com");
    const stranger = await signUp("stranger@example.com");
    const created = (await (
      await harness.request("/api/v1/analyses", {
        method: "POST",
        headers: { cookie: owner.cookie },
        body: JSON.stringify({ ...page(), workspaceId: owner.workspaceId }),
      })
    ).json()) as { analysis: { id: string } };

    const stolen = await harness.request(
      `/api/v1/analyses/${created.analysis.id}?workspaceId=${stranger.workspaceId}`,
      { headers: { cookie: stranger.cookie } }
    );
    // 404, not 403: a wrong guess learns nothing about whether the id exists.
    expect(stolen.status).toBe(404);
  });

  it("filters the history by status and searches the target", async () => {
    const who = await signUp("search@example.com");
    for (const target of ["https://shop.example/checkout", "https://shop.example/cart"]) {
      await harness.request("/api/v1/analyses", {
        method: "POST",
        headers: { cookie: who.cookie },
        body: JSON.stringify({ ...page(), workspaceId: who.workspaceId, target }),
      });
    }
    const searched = (await (
      await harness.request(`/api/v1/analyses?workspaceId=${who.workspaceId}&q=cart`, {
        headers: { cookie: who.cookie },
      })
    ).json()) as { total: number; items: { target: string }[] };
    expect(searched.total).toBe(1);
    expect(searched.items[0]?.target).toContain("cart");

    const byStatus = (await (
      await harness.request(`/api/v1/analyses?workspaceId=${who.workspaceId}&status=completed`, {
        headers: { cookie: who.cookie },
      })
    ).json()) as { total: number };
    expect(byStatus.total).toBe(0);
  });

  it("links a stored scan to its canonical analysis without copying the payload", async () => {
    const who = await signUp("scan@example.com");
    await harness.store.createPageAudit({
      id: "aud_scan1",
      workspaceId: who.workspaceId,
      createdBy: "someone",
      url: "https://shop.example/",
      finalUrl: "https://shop.example/",
      status: 200,
      durationMs: 1200,
      worstVerdict: "fail",
      failed: 1,
      warnings: 0,
      payload: JSON.stringify({ findings: [] }),
      ownership: "unproven",
      redacted: true,
    });
    const analysisId = await recordScanAnalysis(harness.services, {
      auditId: "aud_scan1",
      workspaceId: who.workspaceId,
      projectId: null,
      createdBy: "someone",
      url: "https://shop.example/",
      source: "WEB",
      startedAt: new Date(Date.now() - 1500).toISOString(),
      endedAt: new Date().toISOString(),
      modules: ["world", "fail", "fail"],
      environment: "production",
      result: { failed: 1 },
      freePreview: false,
    });
    const stored = await harness.store.getAnalysis(who.workspaceId, analysisId);
    expect(stored?.pageAuditId).toBe("aud_scan1");
    expect(stored?.targetType).toBe("PAGE");
    // Duplicates in the module list must not inflate the coverage denominator.
    expect(stored?.coverage.measuredModules).toEqual(["world", "fail"]);
    expect(stored?.status).toBe("completed");

    const audit = (await harness.store.getPageAudit(who.workspaceId, "aud_scan1")) as {
      analysis_id?: string;
    };
    expect(audit.analysis_id).toBe(analysisId);
    expect(audit).not.toHaveProperty("payload_copy");
  });
});
