import {
  ANALYSIS_SOURCES,
  ANALYSIS_STATUSES,
  ANALYSIS_TARGET_TYPES,
  type AnalysisCoverage,
  type AnalysisStatus,
  advanceRemediation,
  analysisDurationMs,
  canTransitionAnalysis,
  compareFindingsForDisplay,
  coverageLabel,
  coverageRatio,
  FINDING_STATUS_LABELS,
  FINDING_STATUSES,
  groupByCause,
  nextRemediationStep,
  outcomeStatus,
  planAnalysis,
  profileById,
  REMEDIATION_STEPS,
  seedRemediation,
  summarizeFindings,
} from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { compareAnalysisPair, findingsForAnalysis } from "../findings.js";
import { quotaErrorFromDecision, quotaErrorFromMeter } from "../http/entitlement-http.js";
import { HttpError, RateLimiter } from "../http/errors.js";
import { readBody, requireWorkspace } from "../http/guards.js";
import { pageBody, readPage } from "../http/pagination.js";
import type { AppEnv, Services } from "../http/services.js";
import { verifyRemediationWithAnalysis } from "../remediation-verify.js";
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
    /** A named profile: expands to its modules before the registry is consulted. */
    profile: z.string().min(1).max(40).optional(),
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

const verifyPatchSchema = z
  .object({
    workspaceId: z.string().min(1),
    findingKey: z.string().min(1).max(400),
    /** The person confirmed they applied the diff themselves. PROOFCORE writes no file. */
    applied: z.boolean().default(false),
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

const REPORT_STATUSES = [
  "PASSED",
  "FAILED",
  "WARNING",
  "SKIPPED",
  "BLOCKED",
  "ERROR",
  "NOT_APPLICABLE",
  "NOT_CONFIGURED",
] as const;

function safeParseReport(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function escapeReportHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function analysisRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // A verification re-reads the customer's site: it is a scan, not a free button.
  const verifier = new RateLimiter(10, 60 * 60_000);

  app.post("/analyses", async (c) => {
    const user = c.get("user");
    const body = await readBody(c, createSchema);
    const { workspace, role } = await requireWorkspace(c, services, body.workspaceId);
    // A profile is a promise about what will be measured; an unknown one is a client bug,
    // not a reason to silently run the default.
    const profile = body.profile ? profileById(body.profile) : undefined;
    if (body.profile && !profile) {
      throw new HttpError(400, "unknown_profile", `Unknown analysis profile: ${body.profile}`);
    }
    if (profile && profile.targetType !== body.targetType) {
      throw new HttpError(
        400,
        "profile_target_mismatch",
        `Profile ${profile.id} runs on ${profile.targetType}, not ${body.targetType}.`
      );
    }
    const requestedModules = profile
      ? [...new Set([...profile.modules, ...body.requestedModules])]
      : body.requestedModules;
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
      requestedModules,
      surface: body.source,
    });
    const applicable = body.applicableModules ?? plan.applicableModules;
    const coverage: AnalysisCoverage = {
      requestedModules,
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
      requestedModules,
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

  /**
   * Verify a prepared patch by launching the later analysis itself.
   *
   * The remediation chain says only a later analysis can verify a fix. Asking a person to
   * scan again, find the new analysis, then select it from a dropdown was the gap between
   * that rule and the button next to the diff. This route closes it without weakening the
   * rule: it really reads the target again, records a canonical analysis with its own
   * page audit, then hands that analysis to `verifyRemediationWithAnalysis`.
   *
   * Each target type is re-measured with the engine that produced it: a PAGE with the
   * page scanner, a SITE with the site crawler, a WORKFLOW with the FLOW module. A target
   * type the product cannot re-read is refused with the reason, never scanned into a false
   * negative. Scans are metered as an AI audit; a FLOW re-run spends a test run through
   * the module runner. An inconclusive reading is returned as `verified: false`.
   */
  app.post("/analyses/:analysisId/verify-patch", async (c) => {
    const user = c.get("user");
    const limited = verifier.check(user.id);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      const minutes = Math.max(1, Math.ceil(limited.retryAfterSeconds / 60));
      throw new HttpError(
        429,
        "scan_rate_limited",
        `Trop de vérifications sur cette heure. Réessaie dans ${minutes} min.`,
        { retryAfterSeconds: limited.retryAfterSeconds }
      );
    }

    const body = await readBody(c, verifyPatchSchema);
    const { workspace, role } = await requireWorkspace(c, services, body.workspaceId);
    if (role === "viewer") {
      throw new HttpError(
        403,
        "insufficient_role",
        "Viewers cannot verify a patch. Ask for member rights."
      );
    }
    const analysis = await services.store.getAnalysis(workspace.id, c.req.param("analysisId"));
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
    if (finding.status !== "FAILED" && finding.status !== "WARNING") {
      throw new HttpError(
        409,
        "nothing_to_verify",
        `${finding.controlId} is ${finding.status}: there is no defect to re-check.`
      );
    }
    const parseTarget = (): URL => {
      let target: URL;
      try {
        target = new URL(analysis.target);
      } catch {
        throw new HttpError(
          409,
          "target_not_scannable",
          `This analysis recorded an unusable target (${analysis.target.slice(0, 120)}).`
        );
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new HttpError(409, "target_not_scannable", "The target must be an http(s) URL.");
      }
      return target;
    };
    const meterScan = async (): Promise<string> => {
      const verificationId = `ver_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
      const gate = await services.meter.authorize({
        workspaceId: workspace.id,
        check: { key: "monthly_ai_audits", requested: 1 },
        subjectId: verificationId,
        quantity: 0,
      });
      if (!gate.allowed) throw quotaErrorFromDecision(gate.decision, "AI-audit");
      return verificationId;
    };
    const commitScan = async (verificationId: string): Promise<void> => {
      const metered = await services.meter.meter({
        workspaceId: workspace.id,
        kind: "ai_audit",
        subjectId: verificationId,
        quantity: 1,
        at: services.clock(),
      });
      if (metered.reason === "quota_exhausted") {
        throw quotaErrorFromMeter(metered, "AI-audit");
      }
    };

    let verificationAnalysisId: string;

    if (analysis.targetType === "PAGE") {
      if (!["fail", "clean", "flow", "world", "exit"].includes(finding.module)) {
        throw new HttpError(
          409,
          "verification_not_supported",
          `${finding.module} is not measured by a page scan. Run the module again and verify the new analysis manually.`
        );
      }
      const target = parseTarget();
      const verificationId = await meterScan();
      const scanStartedAt = services.clock().toISOString();
      let result: Awaited<ReturnType<typeof services.scan>>;
      try {
        result = await services.scan(target.toString(), {
          allowPrivate: false,
          maxBytes: 1_500_000,
          timeoutMs: 15_000,
          ownershipHint: "remote",
        });
      } catch (error) {
        throw new HttpError(
          502,
          "scan_failed",
          `Could not reach ${target.hostname}: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
      await commitScan(verificationId);

      const failed = result.findings.filter((item) => item.status === "FAIL").length;
      const warnings = result.findings.filter((item) => item.status === "WARN").length;
      const auditId = `aud_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
      await services.store.createPageAudit({
        id: auditId,
        workspaceId: workspace.id,
        createdBy: user.id,
        url: result.url,
        finalUrl: result.finalUrl,
        status: result.status,
        durationMs: result.durationMs,
        worstVerdict: failed > 0 ? "fail" : warnings > 0 ? "warnings" : "pass",
        failed,
        warnings,
        payload: JSON.stringify(result),
        ownership: result.ownership,
        redacted: result.redacted,
        projectId: analysis.projectId,
        freePreview: false,
      });
      verificationAnalysisId = await recordScanAnalysis(services, {
        auditId,
        workspaceId: workspace.id,
        projectId: analysis.projectId,
        createdBy: user.id,
        url: result.url,
        source: "WEB",
        startedAt: scanStartedAt,
        endedAt: services.clock().toISOString(),
        modules: result.findings.map((item) => String(item.module)),
        environment: "production",
        result: {
          failed,
          warnings,
          passed: result.findings.filter((item) => item.status === "PASS").length,
          httpStatus: result.status,
        },
        freePreview: false,
      });
    } else if (analysis.targetType === "SITE") {
      const target = parseTarget();
      const verificationId = await meterScan();
      const scanStartedAt = services.clock().toISOString();
      let site: Awaited<ReturnType<typeof services.siteAudit>>;
      try {
        site = await services.siteAudit({
          url: target.toString(),
          allowPrivate: false,
          timeoutMs: 15_000,
          // A site analysis describes the site, not the first ten pages: read up to the
          // 200-page ceiling the crawl accepts, then measure every answered page.
          crawl: { maxPages: 200, maxDepth: 2 },
        });
      } catch (error) {
        throw new HttpError(
          502,
          "scan_failed",
          `Could not crawl ${target.hostname}: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
      await commitScan(verificationId);

      const findings = site.scan.findings;
      const failed = findings.filter((item) => item.status === "FAIL").length;
      const warnings = findings.filter((item) => item.status === "WARN").length;
      const auditId = `aud_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
      await services.store.createPageAudit({
        id: auditId,
        workspaceId: workspace.id,
        createdBy: user.id,
        url: site.scan.url,
        finalUrl: site.scan.finalUrl,
        status: site.scan.status,
        durationMs: site.scan.durationMs,
        worstVerdict: failed > 0 ? "fail" : warnings > 0 ? "warnings" : "pass",
        failed,
        warnings,
        payload: JSON.stringify({
          ...site.scan,
          site: site.site,
          scores: site.scores,
          score: site.score,
          login: site.login,
        }),
        ownership: site.scan.ownership,
        redacted: site.scan.redacted,
        projectId: analysis.projectId,
        freePreview: false,
      });
      verificationAnalysisId = await recordScanAnalysis(services, {
        auditId,
        workspaceId: workspace.id,
        projectId: analysis.projectId,
        createdBy: user.id,
        url: site.scan.url,
        source: "WEB",
        startedAt: scanStartedAt,
        endedAt: services.clock().toISOString(),
        modules: findings.map((item) => String(item.module)),
        pages: {
          discovered: site.site.pages.length + site.site.skipped.length,
          scanned: site.site.pages.filter((page) => page.measured).length,
        },
        environment: "production",
        result: {
          failed,
          warnings,
          passed: findings.filter((item) => item.status === "PASS").length,
          httpStatus: site.scan.status,
        },
        freePreview: false,
      });
    } else if (analysis.targetType === "WORKFLOW" && finding.module === "flow") {
      if (!analysis.projectId) {
        throw new HttpError(
          409,
          "verification_requires_project",
          "This FLOW analysis is not attached to a project, so its module cannot be re-run."
        );
      }
      if (!services.runFlow) {
        throw new HttpError(
          503,
          "flow_unavailable",
          "This deployment cannot re-run FLOW. Run the module again and verify the new analysis manually."
        );
      }
      let run: Awaited<ReturnType<NonNullable<typeof services.runFlow>>>;
      try {
        run = await services.runFlow({
          workspaceId: workspace.id,
          projectId: analysis.projectId,
        });
      } catch (error) {
        throw new HttpError(
          502,
          "flow_run_failed",
          `FLOW could not run: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
      if (!run.runId) {
        throw new HttpError(
          409,
          "flow_not_runnable",
          run.note ?? "FLOW produced no run, so there is nothing to verify."
        );
      }

      const now = services.clock().toISOString();
      const status =
        run.status === "COMPLETED"
          ? ("completed" as const)
          : run.status === "CANCELLED"
            ? ("cancelled" as const)
            : ("failed" as const);
      const coverage = {
        requestedModules: ["flow"],
        applicableModules: ["flow"],
        measuredModules: ["flow"],
        skipped: [],
      };
      const mapped = run.cases.flatMap((testCase) => {
        const verdict =
          testCase.status === "PASSED"
            ? ("PASS" as const)
            : testCase.status === "FAILED"
              ? ("FAIL" as const)
              : testCase.status === "WARNING"
                ? ("WARN" as const)
                : testCase.status === "SKIPPED"
                  ? ("SKIPPED" as const)
                  : null;
        if (!verdict) return [];
        const why =
          testCase.failure?.message ??
          `FLOW case ${testCase.id} was re-measured as ${testCase.status}.`;
        const observed = testCase.failure?.code ?? testCase.status;
        const ids = [testCase.id];
        if (testCase.failure?.code && testCase.failure.code !== testCase.id) {
          ids.push(testCase.failure.code);
        }
        // A WORKFLOW finding is identified by its case id, not by a page URL: the
        // engine reports cases, and the analysis target is the journey, not a page.
        return ids.map((id) => ({ module: "flow", id, status: verdict, observed, why }));
      });
      const id = `ana_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
      await services.store.createAnalysis({
        id,
        workspaceId: workspace.id,
        projectId: analysis.projectId,
        createdBy: user.id,
        source: "WEB",
        targetType: "WORKFLOW",
        target: analysis.target,
        scope: analysis.scope,
        requestedModules: ["flow"],
        applicableModules: ["flow"],
        engine: "proofcore",
        engineVersion: "unreported",
        environment: "server",
        status: "running",
        coverage: { ...coverage, measuredModules: [] },
        startedAt: now,
        metadata: { runId: run.runId, reportId: run.reportId, verification: true },
        correlationId: id,
      });
      await services.store.updateAnalysis({
        workspaceId: workspace.id,
        id,
        patch: {
          status,
          endedAt: now,
          durationMs: 0,
          coverage,
          result: { findings: mapped },
          runId: run.runId,
          reportId: run.reportId,
        },
        expected: ["running"],
      });
      verificationAnalysisId = id;
    } else {
      throw new HttpError(
        409,
        "verification_not_supported",
        `A ${analysis.targetType} analysis of ${finding.module} cannot be re-measured automatically. Run the module again and verify the new analysis manually.`
      );
    }
    const fresh = await services.store.getAnalysis(workspace.id, verificationAnalysisId);

    // A remediation is the record the verdict belongs to. Opening it here is part of the
    // same action, not a hidden second decision: the person asked to verify this finding.
    // It is opened only after a real reading, so a failed scan leaves no phantom record.
    const now = services.clock().toISOString();
    let record = await services.store.findRemediationByFinding(
      workspace.id,
      analysis.id,
      body.findingKey
    );
    if (!record) {
      const seed = seedRemediation(finding, now);
      record = await services.store.createRemediation({
        id: `rem_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
        workspaceId: workspace.id,
        projectId: analysis.projectId,
        analysisId: analysis.id,
        findingKey: seed.findingKey,
        module: seed.module,
        controlId: seed.controlId,
        title: seed.title,
        severity: seed.severity,
        priority: seed.priority,
        cause: seed.cause,
        ownerId: null,
        dueAt: null,
        steps: seed.steps,
        fix: seed.fix,
        verification: seed.verification,
        proof: seed.proof,
        createdBy: user.id,
      });
    }

    // "Apply, then verify" is one action, but the application is the person's: this
    // route cannot write their site. A confirmed application is recorded on the chain
    // (up to the `apply` step) before the second measurement, so the history says who
    // asserted it and what proved it.
    if (
      body.applied &&
      record.status !== "verified" &&
      record.status !== "failed" &&
      record.status !== "dismissed"
    ) {
      const appliedAt = services.clock().toISOString();
      let steps = record.steps;
      const done = new Set(steps.map((entry) => entry.step));
      try {
        for (const step of REMEDIATION_STEPS) {
          if (done.has(step)) continue;
          steps = advanceRemediation(steps, step, {
            at: appliedAt,
            by: user.id,
            ...(step === "apply" ? { evidence: "Diff confirmed applied by the user." } : {}),
          });
          done.add(step);
          if (step === "apply") break;
        }
      } catch (error) {
        throw new HttpError(
          409,
          "remediation_step_conflict",
          error instanceof Error ? error.message : "The remediation chain cannot be advanced."
        );
      }
      const updated = await services.store.updateRemediation({
        workspaceId: workspace.id,
        id: record.id,
        patch: { steps, status: "applied", appliedAt },
        expected: [record.status],
      });
      if (!updated) {
        throw new HttpError(
          409,
          "remediation_status_conflict",
          "The remediation changed while applying the patch. Reload and retry."
        );
      }
      record = updated;
    }

    try {
      const verdict = await verifyRemediationWithAnalysis({
        services,
        workspaceId: workspace.id,
        remediationId: record.id,
        analysisId: verificationAnalysisId,
      });
      return c.json({
        analysisId: verificationAnalysisId,
        analysis: fresh ? analysisDto(fresh) : null,
        remediation: {
          ...verdict.remediation,
          nextStep: nextRemediationStep(verdict.remediation.steps),
        },
        outcome: verdict.outcome,
        reason: verdict.reason,
        verified: verdict.outcome === "verified",
      });
    } catch (error) {
      // An inconclusive reading is a real answer: the scan happened, but it did not
      // re-measure this control. Return the recorded state and say it is not a fix.
      if (error instanceof HttpError && error.code === "verification_inconclusive") {
        const current = await services.store.getRemediation(workspace.id, record.id);
        return c.json({
          analysisId: verificationAnalysisId,
          analysis: fresh ? analysisDto(fresh) : null,
          remediation: current
            ? { ...current, nextStep: nextRemediationStep(current.steps) }
            : null,
          outcome: "inconclusive",
          reason: error.message,
          verified: false,
        });
      }
      throw error;
    }
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

  /**
   * Export the canonical analysis and its findings as printable HTML or structured JSON.
   * The workspace check and every nested read are tenant-scoped; no report content is
   * composed from browser-supplied result data.
   */
  app.get("/analyses/:analysisId/report", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const analysis = await services.store.getAnalysis(workspace.id, c.req.param("analysisId"));
    if (!analysis) throw new HttpError(404, "analysis_not_found", "Analysis not found.");
    const loaded = await findingsForAnalysis(services, analysis);
    const findings = loaded.findings.map((finding) => ({
      key: finding.key,
      module: finding.module,
      controlId: finding.controlId,
      title: finding.title,
      status: finding.status,
      severity: finding.severity,
      priority: finding.priority,
      cause: finding.cause,
      confidence: finding.confidence,
      url: finding.url,
      explanation: finding.explanation,
      evidence: finding.evidence,
    }));
    const statusCounts = Object.fromEntries(
      REPORT_STATUSES.map((status) => [
        status,
        findings.filter((finding) => finding.status === status).length,
      ])
    ) as Record<(typeof REPORT_STATUSES)[number], number>;
    const findingCount = findings.length;
    // The findings are the derived view. The stored payload is the evidence they came
    // from: keep it verbatim so a reader can check every claim, including the cases that
    // are not shaped like a finding. No credential is ever part of an analysis payload.
    let evidence: unknown = null;
    let evidenceSource: string | null = null;
    if (analysis.pageAuditId) {
      const row = await services.store.getPageAudit(workspace.id, analysis.pageAuditId);
      if (row) {
        evidence = typeof row.payload === "string" ? safeParseReport(row.payload) : row.payload;
        evidenceSource = "page_audit";
      }
    }
    if (evidence === null && analysis.runId) {
      const run = await services.store.getReportByRunId(workspace.id, analysis.runId);
      if (run) {
        evidence = run;
        evidenceSource = "run";
      }
    }
    if (evidence === null && analysis.result !== null) {
      evidence = analysis.result;
      evidenceSource = "analysis";
    }
    const report = {
      product: "PROOFCORE",
      generatedAt: services.clock().toISOString(),
      analysis: analysisDto(analysis),
      findings,
      statusCounts,
      findingCount,
      coverage: analysis.coverage,
      evidence,
      evidenceSource,
    };
    const format = c.req.query("format") ?? "html";
    if (format === "json") {
      c.header("content-type", "application/json; charset=utf-8");
      c.header(
        "content-disposition",
        `attachment; filename="proofcore-analysis-${analysis.id}.json"`
      );
      c.header("cache-control", "private, no-store");
      return c.body(JSON.stringify(report, null, 2));
    }
    if (format === "md") {
      const lines = [
        `# PROOFCORE — ${analysis.target}`,
        "",
        `- Analyse : ${analysis.id}`,
        `- Statut : ${analysis.status}`,
        `- Source : ${analysis.source} · cible : ${analysis.targetType}`,
        `- Moteur : ${analysis.engine} ${analysis.engineVersion}`,
        `- Démarré : ${analysis.startedAt}`,
        `- Généré : ${report.generatedAt}`,
        "",
        "## Couverture",
        "",
        `- Demandés : ${analysis.coverage.requestedModules.join(", ") || "aucun"}`,
        `- Applicables : ${analysis.coverage.applicableModules.join(", ") || "aucun"}`,
        `- Mesurés : ${analysis.coverage.measuredModules.join(", ") || "aucun"}`,
        ...analysis.coverage.skipped.map(
          (entry) => `- Non mesuré : ${entry.module} — ${entry.reason}`
        ),
        "",
        "## Constats",
        "",
        ...findings.flatMap((finding) => [
          `### ${finding.status} — ${finding.title}`,
          "",
          `- Module : ${finding.module} · contrôle : ${finding.controlId}`,
          `- Gravité : ${finding.severity} · priorité : ${finding.priority}`,
          `- Preuve (${finding.evidence.method}) : ${finding.evidence.observed}`,
          `- Fait : ${finding.explanation.fact}`,
          `- Impact : ${finding.explanation.impact}`,
          `- Correction : ${finding.explanation.fix}`,
          `- Vérification : ${finding.explanation.verification}`,
          ...(finding.url ? [`- URL : ${finding.url}`] : []),
          "",
        ]),
        "## Preuve brute",
        "",
        evidence === null
          ? "Aucune preuve brute persistée pour cette analyse."
          : `\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\``,
        "",
      ];
      c.header("content-type", "text/markdown; charset=utf-8");
      c.header(
        "content-disposition",
        `attachment; filename="proofcore-analysis-${analysis.id}.md"`
      );
      c.header("cache-control", "private, no-store");
      return c.body(lines.join("\n"));
    }
    if (format === "pdf") {
      throw new HttpError(
        501,
        "pdf_renderer_unavailable",
        "Télécharge le rapport HTML puis utilise Imprimer → Enregistrer en PDF."
      );
    }
    if (format !== "html") {
      throw new HttpError(400, "unsupported_format", "Formats disponibles : html, json, md.");
    }
    const coverageItems = [
      ...analysis.coverage.measuredModules.map((module) => ({ module, status: "MESURÉ" })),
      ...analysis.coverage.skipped.map(({ module, reason }) => ({
        module,
        status: `NON MESURÉ — ${reason}`,
      })),
      ...analysis.coverage.applicableModules
        .filter(
          (module) =>
            !analysis.coverage.measuredModules.includes(module) &&
            !analysis.coverage.skipped.some((entry) => entry.module === module)
        )
        .map((module) => ({ module, status: "NON MESURÉ" })),
    ];
    const colors: Record<(typeof REPORT_STATUSES)[number], string> = {
      PASSED: "#28705a",
      FAILED: "#b64231",
      WARNING: "#94620c",
      SKIPPED: "#77766f",
      BLOCKED: "#94620c",
      ERROR: "#b64231",
      NOT_APPLICABLE: "#77766f",
      NOT_CONFIGURED: "#77766f",
    };
    const bars = REPORT_STATUSES.filter((status) => (statusCounts[status] ?? 0) > 0)
      .map((status) => {
        const width = findingCount > 0 ? ((statusCounts[status] ?? 0) / findingCount) * 100 : 0;
        return `<div class="status-line"><span>${status}</span><strong>${statusCounts[status]}</strong><div class="track"><i style="width:${Math.round(width)}%;background:${colors[status]}"></i></div></div>`;
      })
      .join("");
    const modules = [...new Set(findings.map((finding) => finding.module))];
    const moduleRows = modules
      .map((module) => {
        const count = findings.filter((finding) => finding.module === module).length;
        const failed = findings.filter(
          (finding) => finding.module === module && ["FAILED", "ERROR"].includes(finding.status)
        ).length;
        return `<tr><td>${escapeReportHtml(module)}</td><td>${count}</td><td>${failed}</td></tr>`;
      })
      .join("");
    const coverageRows = coverageItems
      .map(
        ({ module, status }) =>
          `<tr><td>${escapeReportHtml(module)}</td><td>${escapeReportHtml(status)}</td></tr>`
      )
      .join("");
    const findingRows = findings
      .map(
        (finding) =>
          `<article class="finding"><div class="finding-kicker"><span>${escapeReportHtml(finding.status)}</span><span>${escapeReportHtml(finding.severity)} · priorité ${escapeReportHtml(finding.priority)}</span></div><h3>${escapeReportHtml(finding.title)}</h3><p>${escapeReportHtml(finding.explanation.fact)}</p><dl><dt>Impact</dt><dd>${escapeReportHtml(finding.explanation.impact)}</dd><dt>Preuve (${escapeReportHtml(finding.evidence.method)})</dt><dd>${escapeReportHtml(finding.evidence.observed)}${finding.evidence.expected ? ` — attendu : ${escapeReportHtml(finding.evidence.expected)}` : ""}</dd><dt>Correction</dt><dd>${escapeReportHtml(finding.explanation.fix)}</dd><dt>Vérification</dt><dd>${escapeReportHtml(finding.explanation.verification)}</dd></dl>${finding.url ? `<p class="url">${escapeReportHtml(finding.url)}</p>` : ""}</article>`
      )
      .join("");
    const target = escapeReportHtml(analysis.target);
    // The evidence appendix is the full stored payload, not a summary. It is embedded as
    // inert text inside <pre>: a target site cannot inject markup into the report.
    const evidenceBlock =
      evidence === null
        ? "<p class='muted'>Aucune preuve brute persistée pour cette analyse.</p>"
        : `<pre class="evidence">${escapeReportHtml(JSON.stringify(evidence, null, 2))}</pre>`;
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rapport PROOFCORE — ${escapeReportHtml(analysis.id)}</title><style>
:root{color-scheme:light;--paper:#f3f0e8;--ink:#171715;--muted:#68665f;--rule:#d8d4c9}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1050px;margin:auto;padding:clamp(20px,5vw,64px)}header{border-bottom:2px solid var(--ink);padding-bottom:22px;margin-bottom:26px}.brand{font:700 12px ui-monospace,monospace;letter-spacing:.2em}.eyebrow{font:11px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}h1{font-size:clamp(32px,6vw,60px);line-height:.98;letter-spacing:-.05em;margin:14px 0}.meta,.muted{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.actions{display:flex;justify-content:flex-end;margin:18px 0}button{border:0;border-radius:999px;background:var(--ink);color:white;padding:10px 16px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #0b8379;outline-offset:3px}.overview{display:grid;grid-template-columns:1.2fr 1fr;gap:16px}.panel{border:1px solid var(--rule);background:#faf8f3;padding:18px;margin:12px 0}.panel h2{font-size:18px;margin:0 0 12px}.status-line{display:grid;grid-template-columns:140px 34px 1fr;gap:10px;align-items:center;margin:8px 0;font-size:12px}.track{height:8px;background:#e7e3d9}.track i{display:block;height:100%}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:400px}td,th{text-align:left;padding:9px;border-bottom:1px solid var(--rule);font-size:13px;vertical-align:top}th{font:11px ui-monospace,monospace;text-transform:uppercase;color:var(--muted)}.finding{border-top:1px solid var(--rule);padding:17px 0;break-inside:avoid}.finding h3{font-size:18px;margin:8px 0}.finding-kicker{display:flex;gap:14px;font:11px ui-monospace,monospace;text-transform:uppercase;color:var(--muted)}dl{display:grid;grid-template-columns:minmax(100px,160px) 1fr;gap:5px 12px;font-size:13px}dt{font-weight:650}dd{margin:0}.url{font:12px ui-monospace,monospace;overflow-wrap:anywhere;color:var(--muted)}pre.evidence{white-space:pre-wrap;overflow-wrap:anywhere;background:#faf8f3;border:1px solid var(--rule);padding:14px;font:11px/1.5 ui-monospace,monospace;max-height:none}footer{margin-top:28px;border-top:1px solid var(--rule);padding-top:12px;color:var(--muted);font-size:12px}@media(max-width:680px){.overview{grid-template-columns:1fr}.status-line{grid-template-columns:100px 28px 1fr}dl{grid-template-columns:1fr;gap:2px}.finding dd{margin-bottom:8px}}@media print{body{background:white}main{max-width:none;padding:0}.actions{display:none}.panel{break-inside:avoid}.overview{grid-template-columns:1.2fr 1fr}.table-wrap{overflow:visible}}
</style></head><body><main><header><div class="brand">PROOFCORE</div><p class="eyebrow">Rapport d'analyse · ${escapeReportHtml(analysis.status)} · couverture ${Math.round(coverageRatio(analysis.coverage) * 100)}%</p><h1>Résultats du diagnostic</h1><p class="meta">${target}<br>ID ${escapeReportHtml(analysis.id)} · ${escapeReportHtml(analysis.source)} · ${escapeReportHtml(analysis.targetType)} · ${escapeReportHtml(analysis.engine)} ${escapeReportHtml(analysis.engineVersion)}<br>Démarré ${escapeReportHtml(analysis.startedAt)}${analysis.durationMs === null ? "" : ` · ${Math.round(analysis.durationMs / 1000)} s`} · Généré ${escapeReportHtml(report.generatedAt)}</p></header><div class="actions"><button type="button" onclick="window.print()">Imprimer / enregistrer en PDF</button></div>
<div class="overview"><section class="panel"><h2>Répartition des constats · ${findingCount} total</h2>${bars || "<p class='muted'>Aucun constat enregistré pour cette analyse.</p>"}</section><section class="panel"><h2>Constats par module</h2><div class="table-wrap"><table><thead><tr><th>Module</th><th>Constats</th><th>Échecs / erreurs</th></tr></thead><tbody>${moduleRows || "<tr><td colspan='3'>Aucun constat</td></tr>"}</tbody></table></div></section></div>
<section class="panel"><h2>Périmètre et couverture</h2><p class="muted">Demandés : ${analysis.coverage.requestedModules.map(escapeReportHtml).join(", ") || "aucun"} · Applicables : ${analysis.coverage.applicableModules.map(escapeReportHtml).join(", ") || "aucun"} · Mesurés : ${analysis.coverage.measuredModules.map(escapeReportHtml).join(", ") || "aucun"}</p>${analysis.coverage.pages ? `<p class="muted">Pages découvertes : ${analysis.coverage.pages.discovered} · pages analysées : ${analysis.coverage.pages.scanned}</p>` : ""}<div class="table-wrap"><table><thead><tr><th>Module</th><th>État observé</th></tr></thead><tbody>${coverageRows || "<tr><td colspan='2'>Pas de détail de couverture</td></tr>"}</tbody></table></div></section>
<section class="panel"><h2>Constats et actions</h2>${findingRows || "<p class='muted'>Aucun constat n'a été enregistré. Cela ne signifie pas que des contrôles non exécutés ont réussi.</p>"}</section><section class="panel"><h2>Preuve brute (${escapeReportHtml(evidenceSource ?? "aucune")})</h2>${evidenceBlock}</section><footer>Document généré à partir des données persistées de cette analyse. Les éléments non mesurés ne sont pas présentés comme réussis.</footer></main></body></html>`;
    c.header(
      "content-disposition",
      `attachment; filename="proofcore-analysis-${analysis.id}.html"`
    );
    c.header("cache-control", "private, no-store");
    return c.html(html);
  });

  /**
   * Compare two analyses finding by finding.
   *
   * Declared non-comparable when one side measured nothing: "0 difference" on two empty
   * runs is the most reassuring lie a report can tell.
   */
  app.get("/analyses/compare", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const baseId = c.req.query("base");
    const targetId = c.req.query("target");
    if (!baseId || !targetId) {
      throw new HttpError(400, "comparison_required", "Both base and target are required.");
    }
    const pair = await compareAnalysisPair(services, workspace.id, baseId, targetId);
    if (!pair) throw new HttpError(404, "analysis_not_found", "Analysis not found.");
    return c.json({
      base: analysisDto(pair.base),
      target: analysisDto(pair.target),
      comparison: pair.comparison,
    });
  });

  /**
   * The findings of one analysis, grouped by cause.
   *
   * Filters are applied before grouping and pagination, so a group always says how many
   * of the filtered findings it holds, and a page never splits a group's counts.
   */
  app.get("/analyses/:analysisId/findings", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const analysis = await services.store.getAnalysis(workspace.id, c.req.param("analysisId"));
    if (!analysis) throw new HttpError(404, "analysis_not_found", "Analysis not found.");
    const loaded = await findingsForAnalysis(services, analysis);

    const csv = (name: string): string[] =>
      (c.req.query(name) ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

    const statuses = csv("status");
    for (const status of statuses) {
      if (!FINDING_STATUSES.includes(status as never)) {
        throw new HttpError(400, "invalid_status", `Unknown finding status: ${status}`);
      }
    }
    const severities = csv("severity");
    const priorities = csv("priority");
    const causes = csv("cause");
    const query = (c.req.query("q") ?? "").toLowerCase();

    const filtered = loaded.findings.filter((finding) => {
      if (statuses.length > 0 && !statuses.includes(finding.status)) return false;
      if (severities.length > 0 && !severities.includes(finding.severity)) return false;
      if (priorities.length > 0 && !priorities.includes(finding.priority)) return false;
      if (causes.length > 0 && !causes.includes(finding.cause)) return false;
      if (query) {
        const haystack =
          finding.title +
          " " +
          finding.controlId +
          " " +
          finding.explanation.fact +
          " " +
          (finding.url ?? "");
        if (!haystack.toLowerCase().includes(query)) return false;
      }
      return true;
    });
    filtered.sort(compareFindingsForDisplay);
    const page = readPage(c);
    const items = filtered.slice(page.offset, page.offset + page.limit);

    return c.json({
      analysis: analysisDto(analysis),
      loaded: loaded.loaded,
      findings: pageBody(items, filtered.length, page),
      counts: summarizeFindings(filtered),
      groups: groupByCause(filtered),
      measuredModules: loaded.measuredModules,
      statuses: FINDING_STATUS_LABELS,
    });
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
