import { checkEntitlement, resolveEntitlements } from "@proofcore/billing";
import type { ModuleId } from "@proofcore/contracts";
import { moduleIdSchema } from "@proofcore/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { createApiKeyToken } from "../auth.js";
import {
  entitlementMap,
  projectDto,
  runSummaryDto,
  subscriptionView,
  usageCounters,
} from "../http/dto.js";
import { HttpError } from "../http/errors.js";
import { readBody, requireUser, requireWorkspace } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";
import { isValidWebhookUrl, WEBHOOK_EVENTS } from "../outbound.js";

const createWorkspaceSchema = z.object({ name: z.string().min(2).max(80) }).strict();

const createProjectSchema = z
  .object({
    workspaceId: z.string().min(1),
    name: z.string().min(1).max(120),
    baseUrl: z.string().url().max(2048),
    stack: z.string().max(60).optional(),
    environment: z.enum(["local", "staging", "production", "ci"]).default("local"),
    enabledModules: z.array(moduleIdSchema).min(1).default(["world", "flow", "exit"]),
  })
  .strict();

const patchProjectSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    baseUrl: z.string().url().max(2048).optional(),
    stack: z.string().max(60).nullable().optional(),
    environment: z.enum(["local", "staging", "production", "ci"]).optional(),
    enabledModules: z.array(moduleIdSchema).min(1).optional(),
  })
  .strict();

const createWebhookSchema = z
  .object({
    workspaceId: z.string().min(1),
    url: z.string().min(8).max(2048),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  })
  .strict();

export function workspaceRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await requireUser(c, services);
    await next();
  });

  // ------------------------------------------------------------ workspaces

  app.get("/workspaces", async (c) => {
    const user = c.get("user");
    const workspaces = await services.store.listWorkspaces(user.id);
    return c.json({ items: workspaces });
  });

  app.post("/workspaces", async (c) => {
    const user = c.get("user");
    const body = await readBody(c, createWorkspaceSchema);
    const owned = (await services.store.listWorkspaces(user.id)).filter(
      (ws) => ws.role === "owner" || ws.role === "admin"
    );
    const effective = owned[0]
      ? await resolveEntitlements(services.billing, owned[0].id, services.clock())
      : null;
    if (effective) {
      const decision = checkEntitlement(effective, { key: "workspace_limit" }, owned.length);
      if (!decision.allowed) {
        throw new HttpError(
          403,
          "workspace_limit_reached",
          "Your plan's workspace limit is reached.",
          {
            limit: decision.limit,
            used: owned.length,
            ...(decision.requiredPlanKey ? { requiredPlanKey: decision.requiredPlanKey } : {}),
          }
        );
      }
    }
    const workspace = await services.store.createWorkspace({ name: body.name, userId: user.id });
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: user.id,
      action: "workspace.created",
      detail: { name: workspace.name, via: "api" },
    });
    return c.json({ workspace }, 201);
  });

  app.get("/workspaces/:workspaceId", async (c) => {
    const { workspace, role } = await requireWorkspace(c, services, c.req.param("workspaceId"));
    const members = await services.store.listMembers(workspace.id);
    return c.json({ ...workspace, myRole: role, members });
  });

  app.get("/workspaces/:workspaceId/members", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"));
    return c.json({ items: await services.store.listMembers(workspace.id) });
  });

  // -------------------------------------------------------------- projects

  app.get("/projects", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const projects = await services.store.listProjects(workspace.id);
    return c.json({ items: projects.map(projectDto) });
  });

  app.post("/projects", async (c) => {
    const body = await readBody(c, createProjectSchema);
    const { workspace, role } = await requireWorkspace(c, services, body.workspaceId, [
      "owner",
      "admin",
      "member",
    ]);
    const effective = await resolveEntitlements(services.billing, workspace.id, services.clock());
    const used = await services.store.countActiveProjects(workspace.id);
    const decision = checkEntitlement(effective, { key: "project_limit" }, used);
    if (!decision.allowed) {
      throw new HttpError(
        403,
        "project_limit_reached",
        `The ${effective.planName} plan allows ${String(decision.limit)} project(s).`,
        {
          limit: decision.limit,
          used,
          ...(decision.requiredPlanKey ? { requiredPlanKey: decision.requiredPlanKey } : {}),
        }
      );
    }

    const project = await services.store.createProject({
      workspaceId: workspace.id,
      name: body.name,
      baseUrl: body.baseUrl,
      ...(body.stack ? { stack: body.stack } : {}),
      environment: body.environment,
      enabledModules: body.enabledModules,
    });
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "project.created",
      detail: { projectId: project.id, name: project.name, role },
    });
    return c.json({ project: projectDto(project) }, 201);
  });

  app.get("/projects/:projectId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    return c.json({ project: projectDto(project) });
  });

  app.patch("/projects/:projectId", async (c) => {
    const workspaceId = c.req.query("workspaceId");
    const { workspace } = await requireWorkspace(c, services, workspaceId, [
      "owner",
      "admin",
      "member",
    ]);
    const body = await readBody(c, patchProjectSchema);
    const updated = await services.store.updateProject(
      workspace.id,
      c.req.param("projectId"),
      body
    );
    if (!updated) throw new HttpError(404, "project_not_found", "Project not found.");
    return c.json({ project: projectDto(updated) });
  });

  app.delete("/projects/:projectId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
    ]);
    const removed = await services.store.softDeleteProject(workspace.id, c.req.param("projectId"));
    if (!removed) throw new HttpError(404, "project_not_found", "Project not found.");
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "project.deleted",
      detail: { projectId: c.req.param("projectId") },
    });
    return c.json({ ok: true });
  });

  /** Recent runs across every project, for the module views. */
  app.get("/runs", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 25) || 25));
    const runs = await services.store.recentRuns(workspace.id, limit);
    return c.json({
      items: runs.map((run) => ({ ...runSummaryDto(run), projectName: run.projectName })),
    });
  });

  /** Findings across the workspace, filtered by module when asked. */
  app.get("/findings", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const raw = c.req.query("module");
    const module = raw === "world" || raw === "flow" || raw === "exit" ? raw : undefined;
    const findings = await services.store.workspaceFindings(workspace.id, module, 100);
    return c.json({ items: findings });
  });

  app.get("/projects/:projectId/runs", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 25) || 25));
    const runs = await services.store.listRuns(workspace.id, project.id, limit);
    return c.json({ items: runs.map((run) => runSummaryDto(run)) });
  });

  app.get("/projects/:projectId/findings", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    const findings = await services.store.listFindings(workspace.id, project.id);
    return c.json({ items: findings });
  });

  /** The stored run payload, exactly as the engine produced it. */
  app.get("/reports/:reportId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const payload = await services.store.getReportPayload(workspace.id, c.req.param("reportId"));
    if (!payload) throw new HttpError(404, "report_not_found", "Report not found.");

    const format = c.req.query("format") ?? "json";
    if (format === "json") return c.json(payload);
    if (format !== "html") {
      throw new HttpError(
        400,
        "unsupported_format",
        "Only json and html are available from the API; use the CLI for JUnit XML."
      );
    }
    // A self-contained download: the same report data, no external assets.
    const rows = payload.moduleRuns
      .flatMap((moduleRun) =>
        moduleRun.cases.map((testCase) => ({ module: moduleRun.module, testCase }))
      )
      .map(
        ({ module, testCase }) =>
          `<tr><td>${escapeHtml(module)}</td><td>${escapeHtml(testCase.name)}</td><td>${escapeHtml(testCase.status)}</td><td><code>${escapeHtml(testCase.id)}</code></td></tr>`
      )
      .join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PROOFCORE report ${escapeHtml(payload.id)}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#142033}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e9f0;padding:.5rem;text-align:left;font-size:.85rem}code{font-family:ui-monospace,monospace}</style>
</head><body><h1>PROOFCORE report</h1>
<p><strong>Run ${escapeHtml(payload.id)}</strong> — ${escapeHtml(payload.status)} — ${payload.moduleRuns.reduce((sum, m) => sum + m.totals.total, 0)} cases</p>
<table><thead><tr><th>Module</th><th>Case</th><th>Status</th><th>Id</th></tr></thead><tbody>${rows}</tbody></table>
<p style="color:#68778a;font-size:.8rem">Generated from the stored report payload. Reproduce with the CLI: <code>proofcore test</code>.</p></body></html>`;
    return c.html(html);
  });

  // -------------------------------------------------------------- insights

  app.get("/insights", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const days = Math.min(90, Math.max(7, Number(c.req.query("days") ?? "30") || 30));
    const insights = await services.store.workspaceInsights(workspace.id, days);
    return c.json({ workspaceId: workspace.id, days, ...insights });
  });

  // -------------------------------------------------------------- overview

  app.get("/overview", async (c) => {
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const projects = await services.store.listProjects(workspace.id);
    const recentRuns = await services.store.recentRuns(workspace.id, 10);
    const recentFailures = await services.store.recentFindings(workspace.id, 6);
    const snapshot = await services.meter.snapshot(workspace.id, services.clock());
    const subscription = await subscriptionView(services, workspace.id, snapshot.entitlements);

    const modules = (["world", "flow", "exit"] as ModuleId[]).map((module) => {
      const latest = recentRuns.find((run) => run.totals[module] !== undefined);
      const totals = latest?.totals[module];
      if (!latest || !totals) {
        // Nothing has been verified for this module yet. Not a pass, not an error.
        return { module, status: "NOTHING_VERIFIED", passed: 0, failed: 0, warnings: 0, errors: 0 };
      }
      const status =
        totals.failed > 0
          ? "FAILED"
          : totals.errors > 0
            ? "ERROR"
            : totals.warnings > 0
              ? "PARTIAL"
              : "COMPLETED";
      return {
        module,
        status,
        passed: totals.passed,
        failed: totals.failed,
        warnings: totals.warnings,
        errors: totals.errors,
        lastRunAt: latest.startedAt,
      };
    });

    return c.json({
      workspace: { ...workspace, myRole: role },
      projects: projects.map(projectDto),
      recentRuns: recentRuns.map((run) => ({
        ...runSummaryDto(run),
        projectName: run.projectName,
      })),
      modules,
      recentFailures,
      usage: {
        counters: usageCounters(subscription.effective, snapshot.usage),
        entitlements: entitlementMap(subscription.effective),
      },
      subscription: subscription.view,
    });
  });

  // ------------------------------------------------------- outbound webhooks

  /** The user's own automations: PROOFCORE posts signed events after commit. */
  app.get("/webhooks", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
    ]);
    const webhooks = await services.store.listWorkspaceWebhooks(workspace.id);
    return c.json({
      events: WEBHOOK_EVENTS,
      items: webhooks.map((webhook) => ({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secretPrefix: webhook.secretPrefix,
        createdAt: webhook.createdAt,
        lastStatus: webhook.lastStatus,
        lastStatusAt: webhook.lastStatusAt,
        lastError: webhook.lastError,
      })),
    });
  });

  app.post("/webhooks", async (c) => {
    const body = await readBody(c, createWebhookSchema);
    const { workspace } = await requireWorkspace(c, services, body.workspaceId, ["owner", "admin"]);
    if (!isValidWebhookUrl(body.url, services.config.environment)) {
      throw new HttpError(
        400,
        "webhook_url_invalid",
        services.config.environment === "production"
          ? "Use a public https URL."
          : "The URL is not a valid http(s) endpoint."
      );
    }

    const { token, prefix } = await createApiKeyToken();
    const secret = token.replace("psk_", "wsk_");
    const webhook = await services.store.createWorkspaceWebhook({
      workspaceId: workspace.id,
      url: body.url,
      secret,
      secretPrefix: prefix,
      events: body.events,
    });
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "webhook.created",
      detail: { webhookId: webhook.id, url: body.url, events: body.events },
    });
    return c.json(
      {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secretPrefix: webhook.secretPrefix,
        secret,
        warning: "This secret is shown once. Receivers verify x-proofcore-signature with it.",
      },
      201
    );
  });

  app.delete("/webhooks/:webhookId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
    ]);
    const removed = await services.store.deleteWorkspaceWebhook(
      workspace.id,
      c.req.param("webhookId")
    );
    if (!removed) throw new HttpError(404, "webhook_not_found", "Webhook not found.");
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "webhook.deleted",
      detail: { webhookId: c.req.param("webhookId") },
    });
    return c.json({ ok: true });
  });

  return app;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
