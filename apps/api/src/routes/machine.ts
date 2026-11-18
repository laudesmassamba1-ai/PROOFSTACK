import { runUploadRequestSchema } from "@proofcore/contracts";
import { type Context, Hono } from "hono";
import { hashToken } from "../auth.js";
import { HttpError } from "../http/errors.js";
import type { AppEnv, Services } from "../http/services.js";
import { deliverWorkspaceEvent } from "../outbound.js";
import type { ApiKeyRecord, RunTotals } from "../store/app-store.js";

/**
 * Machine API for the CLI and CI.
 *
 * Authenticated by a project API key (`Authorization: Bearer psk_...`), never by a
 * session cookie. Uploads are idempotent on the caller's `Idempotency-Key`, and the
 * usage meter dedupes on the run id, so a retried sync cannot bill twice.
 */
export function machineRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const key = await authenticate(c, services);
    c.set("apiKey", key);
    await next();
  });

  app.get("/project", async (c) => {
    const key = c.get("apiKey");
    const workspace = await services.store.getWorkspace(key.workspaceId);
    if (!workspace) throw new HttpError(404, "workspace_not_found", "Workspace not found.");
    const project = key.projectId
      ? await services.store.getProject(key.workspaceId, key.projectId)
      : null;
    const snapshot = await services.meter.snapshot(key.workspaceId, services.clock());
    const limit = snapshot.entitlements.entitlements.monthly_test_runs;
    const used = snapshot.usage.test_run ?? 0;
    return c.json({
      workspace: { id: workspace.id, name: workspace.name },
      project: project
        ? {
            id: project.id,
            name: project.name,
            baseUrl: project.baseUrl,
            environment: project.environment,
          }
        : null,
      plan: { key: snapshot.entitlements.planKey, entitled: snapshot.entitlements.entitled },
      usage: {
        monthlyTestRuns: used,
        limit: typeof limit === "number" ? limit : 0,
        remaining: typeof limit === "number" && limit !== -1 ? Math.max(0, limit - used) : -1,
      },
    });
  });

  app.post("/runs", async (c) => {
    const key = c.get("apiKey");
    if (!key.scopes.includes("runs:write")) {
      throw new HttpError(403, "scope_missing", "This key does not have the runs:write scope.");
    }
    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(
        400,
        "idempotency_key_required",
        "Send an Idempotency-Key header (8–200 characters)."
      );
    }

    const existing = await services.store.getIdempotentResponse(
      key.workspaceId,
      "runs",
      idempotencyKey
    );
    if (existing) return c.json({ ...(existing as object), recorded: false }, 200);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must be JSON.");
    }
    const parsed = runUploadRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "invalid_run",
        "The run payload does not match the report contract.",
        {
          issues: parsed.error.issues.slice(0, 20).map((issue) => ({
            path: issue.path.join(".") || "(root)",
            message: issue.message,
          })),
        }
      );
    }
    const { run } = parsed.data;

    // Tenant authority comes from the key, not the payload.
    if (run.workspaceId !== key.workspaceId) {
      throw new HttpError(
        403,
        "workspace_mismatch",
        "The run belongs to a different workspace than this key."
      );
    }
    if (key.projectId && run.projectId !== key.projectId) {
      throw new HttpError(403, "project_mismatch", "This key is scoped to another project.");
    }
    const project = await services.store.getProject(key.workspaceId, run.projectId);
    if (!project)
      throw new HttpError(404, "project_not_found", "Project not found in this workspace.");

    // Totals are recomputed from the module runs: a client cannot upload a run whose
    // summary disagrees with its own cases.
    const totals: Record<string, RunTotals> = {};
    for (const moduleRun of run.moduleRuns) {
      totals[moduleRun.module] = {
        total: moduleRun.totals.total,
        passed: moduleRun.totals.passed,
        failed: moduleRun.totals.failed,
        warnings: moduleRun.totals.warnings,
        errors: moduleRun.totals.errors,
        skipped: moduleRun.totals.skipped,
      };
    }

    // A cancelled run and a harness error produced no report: they are recorded with
    // `not_counted` so the customer sees them, but they do not consume quota.
    const countable = run.status !== "CANCELLED" && run.status !== "ERROR";
    const metered = await services.meter.meter({
      workspaceId: key.workspaceId,
      kind: "test_run",
      subjectId: run.id,
      quantity: 1,
      countable,
      projectId: run.projectId,
      at: services.clock(),
    });
    if (countable && metered.reason === "quota_exhausted") {
      throw new HttpError(
        403,
        "quota_exhausted",
        "The monthly test-run quota is exhausted for this workspace.",
        {
          limit: metered.limit,
          used: metered.usage,
          remaining: metered.remaining,
          ...(metered.decision.requiredPlanKey
            ? { requiredPlanKey: metered.decision.requiredPlanKey }
            : {}),
        }
      );
    }

    const retentionDays = (await services.meter.snapshot(key.workspaceId, services.clock()))
      .entitlements.entitlements.report_retention_days;
    const saved = await services.store.saveRun({
      run,
      workspaceId: key.workspaceId,
      projectId: run.projectId,
      totals,
      retainedUntil: retentionBoundary(
        run.endedAt,
        typeof retentionDays === "number" ? retentionDays : 14
      ),
    });
    await services.store.markProjectRun(run.projectId, run.startedAt, run.status);
    await services.store.appendAudit({
      workspaceId: key.workspaceId,
      actor: `api_key:${key.id}`,
      action: "run.uploaded",
      detail: {
        runId: saved.runId,
        projectId: run.projectId,
        status: run.status,
        modules: run.modules,
      },
    });

    // Outbound webhooks fire after the commit: receivers observe truth, they
    // never gate it. A slow endpoint must not delay the CLI response, so the
    // delivery runs in the background where the runtime allows it.
    const webhookTask = deliverWorkspaceEvent(services, {
      event:
        run.status === "COMPLETED" && totalsFailed(totals) > 0
          ? "findings.failed"
          : "run.completed",
      workspaceId: key.workspaceId,
      occurredAt: new Date(services.clock()).toISOString(),
      data: {
        runId: saved.runId,
        reportId: saved.reportId,
        projectId: run.projectId,
        status: run.status,
        modules: run.modules,
        totals,
        endedAt: run.endedAt,
      },
    });

    // The people IN the app learn about a failed run too, not just the webhook
    // receivers: every non-viewer member gets one email, best-effort, only when
    // the sender is configured. It never gates the CLI response.
    const runFailed = run.status !== "COMPLETED" || totalsFailed(totals) > 0;
    const emailTask = runFailed
      ? notifyRunFailure(services, key.workspaceId, {
          runId: saved.runId,
          projectId: run.projectId,
          projectName: project.name,
          status: run.status,
          failed: totalsFailed(totals),
          endedAt: run.endedAt,
        })
      : Promise.resolve();
    try {
      c.executionCtx.waitUntil(webhookTask);
      c.executionCtx.waitUntil(emailTask);
    } catch {
      // Hono's Node adapter has no executionCtx; local dev may await it.
      await webhookTask;
      await emailTask;
    }

    const snapshot = await services.meter.snapshot(key.workspaceId, services.clock());
    const limit = snapshot.entitlements.entitlements.monthly_test_runs;
    const response = {
      runId: saved.runId,
      reportId: saved.reportId,
      recorded: true,
      usage: {
        monthlyTestRuns: snapshot.usage.test_run ?? 0,
        limit: typeof limit === "number" ? limit : 0,
        remaining:
          typeof limit === "number" && limit !== -1
            ? Math.max(0, (limit as number) - (snapshot.usage.test_run ?? 0))
            : -1,
      },
    };
    await services.store.saveIdempotentResponse(key.workspaceId, "runs", idempotencyKey, response);
    return c.json(response, 201);
  });

  return app;
}

async function authenticate(c: Context<AppEnv>, services: Services): Promise<ApiKeyRecord> {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("psk_")) {
    throw new HttpError(
      401,
      "invalid_api_key",
      "Send a project token as `Authorization: Bearer psk_...`."
    );
  }
  const key = await services.store.findApiKeyByTokenHash(await hashToken(token));
  if (!key)
    throw new HttpError(401, "invalid_api_key", "This API key is unknown, revoked or expired.");
  await services.store.touchApiKey(key.id);
  return key;
}

function totalsFailed(totals: Record<string, RunTotals>): number {
  return Object.values(totals).reduce((sum, t) => sum + t.failed + t.errors, 0);
}

/** Best-effort failure notice to the workspace's non-viewer members. Never
 * throws into the CLI response: an email outage must not fail an upload. */
async function notifyRunFailure(
  services: Services,
  workspaceId: string,
  run: {
    runId: string;
    projectId: string;
    projectName: string;
    status: string;
    failed: number;
    endedAt: string;
  }
): Promise<void> {
  try {
    if (!services.email.configured) return;
    const members = await services.store.listMembers(workspaceId);
    const recipients = members.filter((member) => member.role !== "viewer");
    if (recipients.length === 0) return;
    const when = new Date(run.endedAt).toLocaleString("fr-FR");
    for (const member of recipients) {
      await services.email.send({
        userId: member.userId,
        to: member.email,
        kind: "run.failed",
        subject: `Échec de run · ${run.projectName} · ${run.failed} anomalie(s)`,
        text:
          `Le run ${run.runId} du projet ${run.projectName} s'est terminé en échec` +
          ` (${run.failed} anomalie(s), statut ${run.status}, ${when}).\n\n` +
          "Ouvrez PROOFCORE pour examiner les constats et relancer : https://proofstack-iota.vercel.app/app",
      });
    }
  } catch (error) {
    // Logged through the email journal inside the sender; never propagate.
    console.error("run failure notice failed", error);
  }
}

function retentionBoundary(endedAt: string, days: number): string {
  const date = new Date(endedAt);
  return new Date(date.getTime() + days * 86_400_000).toISOString();
}
