import {
  advanceRemediation,
  canTransitionRemediation,
  isTerminalRemediation,
  nextRemediationStep,
  REMEDIATION_STATUSES,
  REMEDIATION_STEP_LABELS,
  type RemediationStatus,
  type RemediationStep,
  seedRemediation,
  verificationOutcome,
} from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { findingsForAnalysis } from "../findings.js";
import { HttpError } from "../http/errors.js";
import { readBody, requireWorkspace } from "../http/guards.js";
import { pageBody, readPage } from "../http/pagination.js";
import type { AppEnv, Services } from "../http/services.js";
import type { RemediationRecord } from "../store/app-store.js";

/**
 * Remediations.
 *
 * A remediation is born from one finding of one analysis, and it can only be closed by a
 * later analysis that re-measured the same control. The route enforces that: "verified"
 * is not a status a client may set, it is the verdict of a second measurement.
 */

const createSchema = z
  .object({
    workspaceId: z.string().min(1),
    analysisId: z.string().min(1).max(64),
    findingKey: z.string().min(1).max(400),
    ownerId: z.string().min(1).max(64).nullish(),
    dueAt: z.string().datetime().nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    status: z.enum(REMEDIATION_STATUSES).optional(),
    ownerId: z.string().min(1).max(64).nullish(),
    dueAt: z.string().datetime().nullish(),
    advance: z
      .object({
        step: z.enum(
          Object.keys(REMEDIATION_STEP_LABELS) as [RemediationStep, ...RemediationStep[]]
        ),
        evidence: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const verifySchema = z
  .object({
    workspaceId: z.string().min(1),
    analysisId: z.string().min(1).max(64),
  })
  .strict();

function remediationDto(record: RemediationRecord) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    analysisId: record.analysisId,
    findingKey: record.findingKey,
    module: record.module,
    controlId: record.controlId,
    title: record.title,
    status: record.status,
    severity: record.severity,
    priority: record.priority,
    cause: record.cause,
    owner: record.ownerId,
    dueAt: record.dueAt,
    steps: record.steps,
    nextStep: nextRemediationStep(record.steps),
    fix: record.fix,
    verification: record.verification,
    proof: record.proof,
    verificationAnalysisId: record.verificationAnalysisId,
    verificationOutcome: record.verificationOutcome,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    appliedAt: record.appliedAt,
    verifiedAt: record.verifiedAt,
  };
}

export function remediationRoutes(services: Services) {
  const app = new Hono<AppEnv>();

  /**
   * Turn a finding into a remediation.
   *
   * The seed comes from the finding itself: the fix, the verification method and the
   * confidence are the control registry's words, not a template filled in by the caller.
   */
  app.post("/remediations", async (c) => {
    const body = await readBody(c, createSchema);
    const { workspace, role } = await requireWorkspace(c, services, body.workspaceId);
    if (role === "viewer") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot open a remediation.");
    }
    const analysis = await services.store.getAnalysis(workspace.id, body.analysisId);
    if (!analysis) throw new HttpError(404, "analysis_not_found", "Analysis not found.");
    const loaded = await findingsForAnalysis(services, analysis);
    const finding = loaded.findings.find((item) => item.key === body.findingKey);
    if (!finding) {
      throw new HttpError(
        404,
        "finding_not_found",
        "No finding with this key in that analysis. Re-read the findings first."
      );
    }
    const existing = await services.store.findRemediationByFinding(
      workspace.id,
      body.analysisId,
      body.findingKey
    );
    if (existing) {
      throw new HttpError(409, "remediation_exists", "This finding already has a remediation.", {
        remediationId: existing.id,
      });
    }
    const now = services.clock().toISOString();
    const seed = seedRemediation(finding, now);
    const id = `rem_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const record = await services.store.createRemediation({
      id,
      workspaceId: workspace.id,
      projectId: analysis.projectId,
      analysisId: body.analysisId,
      findingKey: seed.findingKey,
      module: seed.module,
      controlId: seed.controlId,
      title: seed.title,
      severity: seed.severity,
      priority: seed.priority,
      cause: seed.cause,
      ownerId: body.ownerId ?? null,
      dueAt: body.dueAt ?? null,
      steps: seed.steps,
      fix: seed.fix,
      verification: seed.verification,
      proof: seed.proof,
      createdBy: c.get("user").id,
    });
    return c.json({ remediation: remediationDto(record) }, 201);
  });

  app.get("/remediations", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const page = readPage(c);
    const status = c.req.query("status");
    if (status && !REMEDIATION_STATUSES.includes(status as RemediationStatus)) {
      throw new HttpError(400, "invalid_status", `Unknown remediation status: ${status}`);
    }
    const { rows, total } = await services.store.listRemediations(workspace.id, {
      limit: page.limit,
      offset: page.offset,
      ...(status ? { status } : {}),
      ...(c.req.query("priority") ? { priority: c.req.query("priority") } : {}),
      ...(c.req.query("projectId") ? { projectId: c.req.query("projectId") } : {}),
      ...(c.req.query("ownerId") ? { ownerId: c.req.query("ownerId") } : {}),
    });
    return c.json({ remediations: pageBody(rows.map(remediationDto), total, page) });
  });

  app.get("/remediations/:remediationId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const record = await services.store.getRemediation(workspace.id, c.req.param("remediationId"));
    if (!record) throw new HttpError(404, "remediation_not_found", "Remediation not found.");
    return c.json({ remediation: remediationDto(record) });
  });

  /**
   * Move a remediation forward.
   *
   * The chain advances one step at a time and only in order; "verified" is refused here
   * because a status change is not a measurement.
   */
  app.patch("/remediations/:remediationId", async (c) => {
    const body = await readBody(c, patchSchema);
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    if (role === "viewer") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot update a remediation.");
    }
    const current = await services.store.getRemediation(workspace.id, c.req.param("remediationId"));
    if (!current) throw new HttpError(404, "remediation_not_found", "Remediation not found.");
    if (isTerminalRemediation(current.status) && body.status && body.status !== current.status) {
      throw new HttpError(
        409,
        "remediation_finished",
        `A remediation in state ${current.status} cannot be reopened by a status change.`
      );
    }
    if (body.status === "verified") {
      throw new HttpError(
        409,
        "verification_required",
        "Verified is the verdict of a later analysis: POST /remediations/:id/verify."
      );
    }
    if (body.status && !canTransitionRemediation(current.status, body.status)) {
      throw new HttpError(
        409,
        "remediation_status_conflict",
        `A remediation in state ${current.status} cannot become ${body.status}.`,
        { currentStatus: current.status }
      );
    }
    const now = services.clock().toISOString();
    const patch: Parameters<typeof services.store.updateRemediation>[0]["patch"] = {};
    if (body.advance) {
      try {
        patch.steps = advanceRemediation(current.steps, body.advance.step, {
          at: now,
          by: c.get("user").id,
          ...(body.advance.evidence ? { evidence: body.advance.evidence } : {}),
        });
      } catch (error) {
        throw new HttpError(
          400,
          "step_out_of_order",
          error instanceof Error ? error.message : "Step out of order."
        );
      }
    }
    if (body.status) {
      patch.status = body.status;
      if (body.status === "applied") patch.appliedAt = now;
    }
    if (body.ownerId !== undefined) patch.ownerId = body.ownerId;
    if (body.dueAt !== undefined) patch.dueAt = body.dueAt;
    if (Object.keys(patch).length === 0) {
      return c.json({ remediation: remediationDto(current) });
    }
    const updated = await services.store.updateRemediation({
      workspaceId: workspace.id,
      id: current.id,
      patch,
      expected: [current.status],
    });
    if (!updated) {
      throw new HttpError(
        409,
        "remediation_status_conflict",
        "This remediation changed while the update was being applied. Reload and retry."
      );
    }
    return c.json({ remediation: remediationDto(updated) });
  });

  /**
   * Confirm a fix with a second measurement.
   *
   * The supplied analysis must contain the same finding key. A PASSED verdict verifies;
   * a failing one marks the remediation failed with its reason; a missing or inconclusive
   * verdict is refused rather than counted as success.
   */
  app.post("/remediations/:remediationId/verify", async (c) => {
    const body = await readBody(c, verifySchema);
    const { workspace, role } = await requireWorkspace(c, services, body.workspaceId);
    if (role === "viewer") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot verify a remediation.");
    }
    const current = await services.store.getRemediation(workspace.id, c.req.param("remediationId"));
    if (!current) throw new HttpError(404, "remediation_not_found", "Remediation not found.");
    if (current.analysisId === body.analysisId) {
      throw new HttpError(
        400,
        "verification_requires_new_analysis",
        "The analysis that produced the finding cannot verify it."
      );
    }
    const analysis = await services.store.getAnalysis(workspace.id, body.analysisId);
    if (!analysis) {
      throw new HttpError(404, "analysis_not_found", "Verification analysis not found.");
    }
    const loaded = await findingsForAnalysis(services, analysis);
    const finding = loaded.findings.find((item) => item.key === current.findingKey);
    const verdict = verificationOutcome(finding);
    const now = services.clock().toISOString();
    const nextStatus =
      verdict.outcome === "verified"
        ? "verified"
        : verdict.outcome === "still_failing"
          ? "failed"
          : current.status;
    const updated = await services.store.updateRemediation({
      workspaceId: workspace.id,
      id: current.id,
      patch: {
        status: nextStatus,
        verificationAnalysisId: body.analysisId,
        verificationOutcome: verdict.outcome,
        ...(verdict.outcome === "verified" ? { verifiedAt: now } : {}),
      },
      expected: [current.status],
    });
    if (!updated) {
      throw new HttpError(
        409,
        "remediation_status_conflict",
        "The remediation changed while verifying."
      );
    }
    if (verdict.outcome === "inconclusive") {
      throw new HttpError(409, "verification_inconclusive", verdict.reason, {
        remediationId: updated.id,
        verificationOutcome: verdict.outcome,
      });
    }
    return c.json({
      remediation: remediationDto(updated),
      outcome: verdict.outcome,
      reason: verdict.reason,
    });
  });

  return app;
}
