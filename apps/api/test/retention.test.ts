import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/d1.js";
import { migrationFiles } from "../src/db/node-sqlite.js";
import { type Harness, harness, json, paidWorkspace, sampleRun, uploadBody } from "./harness.js";

/**
 * Retention, actually enforced.
 *
 * The contract writes `report_retention_days` into every uploaded report at upload
 * time. These tests prove the other half: an expired report disappears (findings with
 * it), the run ledger survives it, and a read purges lazily so a workspace stays
 * honest even if the scheduled sweep never ran.
 */

/** Forces a stored report into the past without touching anything else. */
async function expireReports(h: Harness, workspaceId: string, when: string): Promise<void> {
  await h.services.db
    .prepare(
      "UPDATE reports SET retained_until = ? WHERE workspace_id = ? AND retained_until IS NOT NULL"
    )
    .bind(when, workspaceId)
    .run();
}

describe("report retention", () => {
  let h: Harness;
  let paid: Awaited<ReturnType<typeof paidWorkspace>>;

  beforeEach(async () => {
    h = harness();
    await migrate(h.services.db, migrationFiles());
    paid = await paidWorkspace(h);
  });

  it("tells the customer when their report expires, at upload time", async () => {
    const run = sampleRun({
      id: "run_ret_1",
      projectId: paid.projectId,
      workspaceId: paid.workspaceId,
      status: "FAILED",
    });
    const response = await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-ret-1" },
      body: uploadBody(run),
    });
    expect(response.status).toBe(201);
    const body = await json<{ retainedUntil: string | null }>(response);
    // Developer keeps reports 90 days: the date the customer can plan around, not a
    // policy discovered the day the report is gone.
    expect(body.retainedUntil).toBeTruthy();
    const days = Math.round(
      (new Date(body.retainedUntil ?? "").getTime() - new Date(run.endedAt).getTime()) / 86_400_000
    );
    expect(days).toBe(90);
  });

  it("purges an expired report on read: findings go, the run ledger stays", async () => {
    const run = sampleRun({
      id: "run_ret_2",
      projectId: paid.projectId,
      workspaceId: paid.workspaceId,
      status: "FAILED",
    });
    const upload = await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-ret-2" },
      body: uploadBody(run),
    });
    expect(upload.status).toBe(201);
    const { reportId } = await json<{ reportId: string }>(upload);

    // Before expiry everything is readable.
    const before = await h.request(
      `/api/v1/projects/${paid.projectId}/findings?workspaceId=${paid.workspaceId}`,
      { cookie: paid.cookie }
    );
    expect((await json<{ items: unknown[] }>(before)).items).toHaveLength(1);

    await expireReports(h, paid.workspaceId, "2020-01-01T00:00:00.000Z");

    // The read purges first: the expired report cannot be served, even once.
    const report = await h.request(`/api/v1/reports/${reportId}?workspaceId=${paid.workspaceId}`, {
      cookie: paid.cookie,
    });
    expect(report.status).toBe(404);

    // Findings cascade with their report: the dashboard cannot list a defect whose
    // evidence no longer exists.
    const findings = await h.request(
      `/api/v1/projects/${paid.projectId}/findings?workspaceId=${paid.workspaceId}`,
      { cookie: paid.cookie }
    );
    expect((await json<{ items: unknown[] }>(findings)).items).toHaveLength(0);

    // The run row stays: it is the ledger (totals, status, usage), not the content.
    const runs = await h.request(
      `/api/v1/projects/${paid.projectId}/runs?workspaceId=${paid.workspaceId}`,
      { cookie: paid.cookie }
    );
    expect((await json<{ items: { id: string }[] }>(runs)).items.map((r) => r.id)).toContain(
      "run_ret_2"
    );
  });

  it("the scheduled sweep deletes expired reports across workspaces, and only those", async () => {
    const fresh = sampleRun({
      id: "run_ret_3",
      projectId: paid.projectId,
      workspaceId: paid.workspaceId,
    });
    await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-ret-3" },
      body: uploadBody(fresh),
    });
    const expired = sampleRun({
      id: "run_ret_4",
      projectId: paid.projectId,
      workspaceId: paid.workspaceId,
      status: "FAILED",
    });
    await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-ret-4" },
      body: uploadBody(expired),
    });
    await expireReports(h, paid.workspaceId, "2020-01-01T00:00:00.000Z");

    const now = h.services.clock().toISOString();
    const purged = await h.services.store.purgeAllExpiredReports(now);
    expect(purged).toBe(2);

    // A second sweep is a no-op: the rows are gone, not soft-deleted.
    expect(await h.services.store.purgeAllExpiredReports(now)).toBe(0);

    const reports = await h.services.store.listReports(paid.workspaceId, paid.projectId, 25);
    // Both reports were expired. Only the run ledger remains.
    expect(reports).toHaveLength(0);
    const runs = await h.request(
      `/api/v1/projects/${paid.projectId}/runs?workspaceId=${paid.workspaceId}`,
      { cookie: paid.cookie }
    );
    // Ordering is by recency; both ledger rows survive the sweep.
    expect((await json<{ items: { id: string }[] }>(runs)).items.map((r) => r.id).sort()).toEqual([
      "run_ret_3",
      "run_ret_4",
    ]);
  });

  it("idempotency keys live 30 days, then the sweep removes them", async () => {
    const run = sampleRun({
      id: "run_ret_5",
      projectId: paid.projectId,
      workspaceId: paid.workspaceId,
    });
    await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-ret-5-old" },
      body: uploadBody(run),
    });
    await h.services.db
      .prepare("UPDATE idempotency_keys SET created_at = ?")
      .bind("2020-01-01T00:00:00.000Z")
      .run();

    const purged = await h.services.store.purgeExpiredIdempotencyKeys(
      h.services.clock().toISOString()
    );
    expect(purged).toBeGreaterThan(0);

    // The key is gone: a re-upload with the same key is a NEW upload now, and it is
    // metered as such — that is the trade retention makes explicit.
    const replay = await h.request("/v1/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${paid.token}`, "idempotency-key": "idem-ret-5-old" },
      body: uploadBody(run),
    });
    expect(replay.status).toBe(201);
  });
});
