import {
  ANALYSIS_SOURCES,
  ANALYSIS_STATUSES,
  ANALYSIS_TARGET_TYPES,
  type AnalysisCoverage,
  type AnalysisStatus,
  analysisDurationMs,
  canTransitionAnalysis,
  coverageLabel,
  coverageRatio,
  outcomeStatus,
  planAnalysis,
} from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError } from "../http/errors.js";
import { readBody, requireWorkspace } from "../http/guards.js";
import { pageBody, readPage } from "../http/pagination.js";
import type { AppEnv, Services } from "../http/services.js";
import type { AnalysisRecord } from "../store/app-store.js";

/**
 * Analyses.
 *
 * One list answers "what did I run, where, and how far did it get" for every surface:
 * a Web scan, a CLI push, an AI tool call, a Desktop run. The payloads stay in the tables
 * that already own them; this route is the index, the lifecycle and the honest coverage.
 */

export function analysisDto(analysis: AnalysisRecord) {
  return {
    id: analysis.id,
    workspaceId: analysis.workspaceId,
    projectId: analysis.projectId,
    source: analysis.source,
    targetType: analysis.targetType,
    target: analysis.target,
    scope: analysis.scope,
    requestedModules: analysis.requestedModules,
    applicableModules: analysis.applicableModules,
    engine: analysis.engine,
    engineVersion: analysis.engineVersion,
    environment: analysis.environment,
    status: analysis.status,
    coverage: {
      ...analysis.coverage,
      // Computed once, server-side: a UI that divides these itself can disagree with the
      // report that quotes the same numbers.
      ratio: Number(coverageRatio(analysis.coverage).toFixed(4)),
      label: coverageLabel(analysis.coverage),
    },
    startedAt: analysis.startedAt,
    endedAt: analysis.endedAt,
    durationMs: analysis.durationMs,
    result: analysis.result,
    metadata: analysis.metadata,
    reportId: analysis.reportId,
    pageAuditId: analysis.pageAuditId,
    runId: analysis.runId,
    correlationId: analysis.correlationId,
    error: analysis.error,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}

const moduleList = z.array(z.string().min(1).max(40)).max(24);

const createSchema = z
  .object({
    workspaceId: z.string().min(1),
    projectId: z.string().min(1).max(64).nullish(),
    source: z.enum(ANALYSIS_SOURCES),
    targetType: z.enum(ANALYSIS_TARGET_TYPES),
    target: z.string().min(1).max(2000),
    scope: z.string().min(1).max(120).optional(),
    requestedModules: moduleList.default([]),
    /** What the runner established it can actually do on this target. */
    applicableModules: moduleList.optional(),
    engine: z.string().min(1).max(64).default("proofcore"),
    // Honest by default: a runner that does not report its build says so rather than
    // inheriting a version it never verified.
    engineVersion: z.string().min(1).max(40).default("unreported"),
    environment: z.string().min(1).max(40).default("production"),
    status: z.enum(["queued", "running"]).default("queued"),
    metadata: z.record(z.string(), z.unknown()).optional(),
    correlationId: z.string().min(1).max(80).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();

const patchSchema = z
  .object({
    status: z.enum(ANALYSIS_STATUSES).optional(),
    coverage: z
      .object({
        requestedModules: moduleList.optional(),
        applicableModules: moduleList.optional(),
        measuredModules: moduleList.optional(),
        skipped: z
          .array(z.object({ module: z.string().min(1).max(40), reason: z.string().max(400) }))
          .max(24)
          .optional(),
        pages: z
          .object({ discovered: z.number().int().min(0), scanned: z.number().int().min(0) })
          .optional(),
      })
      .optional(),
    result: z.unknown().optional(),
    error: z.string().max(2000).nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Only a runner that knows its final duration sends it; otherwise it is derived. */
    endedAt: z.string().datetime().optional(),
  })
  .strict();

function mergeCoverage(
  current: AnalysisCoverage,
  patch: NonNullable<z.infer<typeof patchSchema>["coverage"]>
): AnalysisCoverage {
  const merged: AnalysisCoverage = {
    requestedModules: patch.requestedModules ?? current.requestedModules,
    applicableModules: patch.applicableModules ?? current.applicableModules,
    measuredModules: patch.measuredModules ?? current.measuredModules,
    skipped: patch.skipped ?? current.skipped,
  };
  const pages = patch.pages ?? current.pages;
  if (pages) merged.pages = pages;
  return merged;
}

export function analysisRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/analyses", async (c) => {
    const user = c.get("user");
    const body = await readBody(c, createSchema);
    const { workspace, role } = await requireWorkspace(c, services, body.workspaceId);
    if (role === "viewer") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot start an analysis.");
    }
    if (body.projectId && !(await services.store.getProject(workspace.id, body.projectId))) {
      throw new HttpError(404, "project_not_found", "No project with this id in this workspace.");
    }
    // A header wins over the body so a generic client can retry without editing its payload.
    const idempotencyKey = c.req.header("idempotency-key") ?? body.idempotencyKey ?? null;
    const id = `ana_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const now = services.clock().toISOString();
    // Ask the registry what can run here before recording anything: a module that cannot
    // apply is stored as skipped with its reason, never silently dropped.
    const plan = planAnalysis({
      targetType: body.targetType,
      requestedModules: body.requestedModules,
      surface: body.source,
    });
    const applicable = body.applicableModules ?? plan.applicableModules;
    const coverage: AnalysisCoverage = {
      requestedModules: body.requestedModules,
      applicableModules: applicable,
      measuredModules: [],
      skipped: plan.unavailable.map((entry) => ({ module: entry.module, reason: entry.reason })),
    };
    const analysis = await services.store.createAnalysis({
      id,
      workspaceId: workspace.id,
      projectId: body.projectId ?? null,
      createdBy: user.id,
      source: body.source,
      targetType: body.targetType,
      target: body.target,
      scope: body.scope ?? body.targetType,
      requestedModules: body.requestedModules,
      applicableModules: applicable,
      engine: body.engine,
      engineVersion: body.engineVersion,
      environment: body.environment,
      status: body.status,
      coverage,
      startedAt: now,
      ...(body.metadata ? { metadata: body.metadata } : {}),
      correlationId: body.correlationId ?? id,
      idempotencyKey,
    });
    // 200 for a replay, 201 for a first creation: a client can tell a retry that worked
    // from a request that created a second thing.
    const replayed = analysis.id !== id;
    return c.json({ analysis: analysisDto(analysis) }, replayed ? 200 : 201);
  });

  app.get("/analyses", async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.query("workspaceId");
    const { workspace } = await requireWorkspace(c, services, workspaceId);
    void user;
    const page = readPage(c);
    const status = c.req.query("status");
    const source = c.req.query("source");
    const targetType = c.req.query("targetType");
    if (status && !ANALYSIS_STATUSES.includes(status as AnalysisStatus)) {
      throw new HttpError(400, "invalid_status", `Unknown analysis status: ${status}`);
    }
    const { rows, total } = await services.store.listAnalyses(workspace.id, {
      limit: page.limit,
      offset: page.offset,
      projectId: c.req.query("projectId") ?? null,
      status: (status as AnalysisStatus | undefined) ?? null,
      source: (source as (typeof ANALYSIS_SOURCES)[number] | undefined) ?? null,
      targetType: (targetType as (typeof ANALYSIS_TARGET_TYPES)[number] | undefined) ?? null,
      query: c.req.query("q") ?? null,
    });
    return c.json(pageBody(rows.map(analysisDto), total, page));
  });

  app.get("/analyses/:analysisId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const analysis = await services.store.getAnalysis(workspace.id, c.req.param("analysisId"));
    if (!analysis) throw new HttpError(404, "analysis_not_found", "Analysis not found.");
    return c.json({ analysis: analysisDto(analysis) });
  });

  /**
   * The lifecycle endpoint a runner calls as the work progresses.
   *
   * A terminal state is final. Two writers racing (a finish and a cancel) are serialised by
   * the `expected` guard: the loser updates zero rows and gets a 409 instead of silently
   * overwriting a result someone already saw.
   */
  app.patch("/analyses/:analysisId", async (c) => {
    const body = await readBody(c, patchSchema);
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    if (role === "viewer") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot update an analysis.");
    }
    const id = c.req.param("analysisId");
    const current = await services.store.getAnalysis(workspace.id, id);
    if (!current) throw new HttpError(404, "analysis_not_found", "Analysis not found.");

    const coverage = body.coverage ? mergeCoverage(current.coverage, body.coverage) : undefined;
    const now = services.clock().toISOString();
    let nextStatus = body.status ?? current.status;
    const ending = body.status !== undefined && isTerminal(nextStatus);
    if (body.status && !canTransitionAnalysis(current.status, body.status)) {
      throw new HttpError(
        409,
        "analysis_status_conflict",
        `An analysis in state ${current.status} cannot become ${body.status}.`,
        { currentStatus: current.status }
      );
    }
    // A runner that sends no explicit status but reports a failure is finishing, and the
    // recorded status must match the error it just sent.
    if (!body.status && body.error !== undefined && body.error !== null) {
      nextStatus = outcomeStatus({ error: body.error, coverage: coverage ?? current.coverage });
    }
    const patch: Parameters<typeof services.store.updateAnalysis>[0]["patch"] = {};
    if (body.status || nextStatus !== current.status) patch.status = nextStatus;
    if (coverage) patch.coverage = coverage;
    if (body.result !== undefined) patch.result = body.result;
    if (body.error !== undefined) patch.error = body.error;
    if (body.metadata !== undefined) patch.metadata = body.metadata;
    if (ending) {
      const endedAt = body.endedAt ?? now;
      patch.endedAt = endedAt;
      patch.durationMs = analysisDurationMs(current.startedAt, endedAt);
    }
    const updated = await services.store.updateAnalysis({
      workspaceId: workspace.id,
      id,
      patch,
      expected: [current.status],
    });
    if (!updated) {
      throw new HttpError(
        409,
        "analysis_status_conflict",
        "This analysis changed while the update was being applied. Reload and retry."
      );
    }
    const fresh = await services.store.getAnalysis(workspace.id, id);
    return c.json({ analysis: analysisDto(fresh ?? current) });
  });

  app.post("/analyses/:analysisId/cancel", async (c) => {
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    if (role === "viewer") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot cancel an analysis.");
    }
    const id = c.req.param("analysisId");
    const current = await services.store.getAnalysis(workspace.id, id);
    if (!current) throw new HttpError(404, "analysis_not_found", "Analysis not found.");
    if (isTerminal(current.status)) {
      // Cancelling a finished analysis is not an error: it is already what the caller wants.
      return c.json({ analysis: analysisDto(current), alreadyFinished: true });
    }
    const endedAt = services.clock().toISOString();
    const cancelled = await services.store.updateAnalysis({
      workspaceId: workspace.id,
      id,
      patch: {
        status: "cancelled",
        endedAt,
        durationMs: analysisDurationMs(current.startedAt, endedAt),
      },
      expected: ["queued", "running"],
    });
    const fresh = await services.store.getAnalysis(workspace.id, id);
    if (!cancelled && fresh) return c.json({ analysis: analysisDto(fresh), alreadyFinished: true });
    return c.json({ analysis: analysisDto(fresh ?? current) });
  });

  return app;
}

/**
 * Record the analysis a completed Web scan produced.
 *
 * Called from both scan routes after the payload is stored, so the canonical history and
 * the page-audit detail are the same execution seen from two angles, not two copies.
 */
export async function recordScanAnalysis(
  services: Services,
  input: {
    auditId: string;
    workspaceId: string;
    projectId: string | null;
    createdBy: string;
    url: string;
    source: "WEB" | "API";
    startedAt: string;
    endedAt: string;
    modules: string[];
    /** Site crawl totals, when a crawl ran. */
    pages?: { discovered: number; scanned: number };
    environment: string;
    result: unknown;
    freePreview: boolean;
  }
): Promise<string> {
  const measured = [...new Set(input.modules)];
  const coverage: AnalysisCoverage = {
    requestedModules: measured,
    applicableModules: measured,
    measuredModules: measured,
    skipped: [],
    ...(input.pages ? { pages: input.pages } : {}),
  };
  const status = outcomeStatus({ coverage });
  const id = `ana_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await services.store.createAnalysis({
    id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    createdBy: input.createdBy,
    source: input.source,
    targetType: input.pages ? "SITE" : "PAGE",
    target: input.url,
    scope: input.pages ? "SITE" : "PAGE",
    requestedModules: measured,
    applicableModules: measured,
    engine: "proofcore-scan",
    engineVersion: "unreported",
    environment: input.environment,
    status: "running",
    coverage,
    startedAt: input.startedAt,
    metadata: { freePreview: input.freePreview },
    correlationId: id,
    pageAuditId: input.auditId,
  });
  await services.store.linkPageAuditAnalysis(input.workspaceId, input.auditId, id);
  await services.store.updateAnalysis({
    workspaceId: input.workspaceId,
    id,
    patch: {
      status,
      endedAt: input.endedAt,
      durationMs: analysisDurationMs(input.startedAt, input.endedAt),
      result: input.result,
    },
  });
  return id;
}

function isTerminal(status: AnalysisStatus): boolean {
  return (
    status === "completed" || status === "partial" || status === "failed" || status === "cancelled"
  );
}
