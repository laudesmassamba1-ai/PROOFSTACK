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
import { pageBody, readPage } from "../http/pagination.js";
import type { AppEnv, Services } from "../http/services.js";
import { notifyAudit } from "../notifications.js";
import { isValidWebhookUrl, WEBHOOK_EVENTS } from "../outbound.js";
import {
  blockingIssues,
  buildProjectConfig,
  projectConfigInputSchema,
  projectConfigIssues,
  readStoredProjectConfig,
} from "../project-config.js";

const createWorkspaceSchema = z.object({ name: z.string().min(2).max(80) }).strict();

const renameWorkspaceSchema = z.object({ name: z.string().min(2).max(80) }).strict();

const addMemberSchema = z
  .object({ email: z.string().email().max(200), role: z.enum(["admin", "member", "viewer"]) })
  .strict();

const updateMemberSchema = z
  .object({ role: z.enum(["owner", "admin", "member", "viewer"]) })
  .strict();

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
  /** Project pre-check: unconfigured and blocked are different states, not one warning. */
  const precheck = (
    stored: ReturnType<typeof readStoredProjectConfig>,
    config: ReturnType<typeof buildProjectConfig>
  ): "NOT_CONFIGURED" | "BLOCKED" | "READY" => {
    // "Never configured" is a first-run state, not a broken configuration. "Blocked"
    // means something was saved that the engine must not execute: a real charge or an
    // unacknowledged production export. Showing one label for both hid the second.
    if (!stored) return "NOT_CONFIGURED";
    if (blockingIssues(projectConfigIssues(config)).length > 0) return "BLOCKED";
    return "READY";
  };
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

  app.patch("/workspaces/:workspaceId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"), [
      "owner",
      "admin",
    ]);
    const body = await readBody(c, renameWorkspaceSchema);
    const renamed = await services.store.renameWorkspace(workspace.id, body.name.trim());
    if (!renamed) throw new HttpError(404, "workspace_not_found", "Workspace not found.");
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "workspace.renamed",
      detail: { from: workspace.name, to: renamed.name },
    });
    return c.json({ workspace: renamed });
  });

  /** Owner-only. The cascade is explicit (see the store): projects, runs,
   * findings, keys and history all go with the workspace. */
  app.delete("/workspaces/:workspaceId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"), [
      "owner",
    ]);
    const deleted = await services.store.deleteWorkspace(workspace.id);
    if (!deleted) throw new HttpError(404, "workspace_not_found", "Workspace not found.");
    return c.json({ ok: true });
  });

  app.get("/workspaces/:workspaceId/members", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"));
    return c.json({ items: await services.store.listMembers(workspace.id) });
  });

  /**
   * Invite an existing account.
   *
   * This used to write the membership row immediately, which meant one person could grant
   * another person access to a tenant without their knowledge or consent — and the
   * notification the product advertised did not exist. Now it records a *pending*
   * invitation, tells the invitee (email plus the in-app list), and the membership is
   * created only when they accept on `/api/account/invitations`.
   *
   * There are still no ghost invitations: an address with no account is reported as such
   * rather than being subscribed to a workspace that cannot reach it.
   */
  app.post("/workspaces/:workspaceId/invitations", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"), [
      "owner",
      "admin",
    ]);
    const body = await readBody(c, addMemberSchema);
    const inviter = c.get("user");
    const user = await services.store.findUserByNormalizedEmail(body.email.trim().toLowerCase());
    if (!user) {
      throw new HttpError(
        404,
        "user_not_found",
        `No PROOFCORE account uses ${body.email}. Ask them to sign up first, then invite them.`
      );
    }
    if (await services.store.workspaceMemberRole(workspace.id, user.id)) {
      throw new HttpError(
        409,
        "already_member",
        "This person is already a member of the workspace."
      );
    }
    const invitation = await services.store.createInvitation({
      workspaceId: workspace.id,
      invitedUserId: user.id,
      invitedByUserId: inviter.id,
      role: body.role,
    });
    if (!invitation) {
      throw new HttpError(
        409,
        "invitation_pending",
        "This person already has a pending invitation to the workspace."
      );
    }
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: inviter.id,
      action: "invitation.sent",
      detail: { invitationId: invitation.id, userId: user.id, email: user.email, role: body.role },
    });
    // The invitee is not a member yet, so the default "all members" audience would
    // miss the one person this request concerns. Address it to them personally.
    await notifyAudit(
      services,
      workspace.id,
      await latestAuditId(services, workspace.id, "invitation.sent", invitation.id),
      {
        recipients: [user.id],
        kind: "invitation.request",
        title: `Workspace request: ${workspace.name}`,
        body: `${inviter.name} invited you to join ${workspace.name} as ${body.role}. Nothing is granted until you answer.`,
        link: "/app",
      }
    );

    // The email is a courtesy, not the authority: the invitation exists in the database
    // either way, and the reply says whether a message was actually accepted by a provider.
    const delivered = await services.email.send({
      to: user.email,
      subject: `${inviter.name} ${"t'invite"} à rejoindre ${workspace.name}`,
      text: `${inviter.name} (${inviter.email}) t'invite à rejoindre l'espace de travail "${workspace.name}" sur PROOFCORE, avec le rôle ${body.role}. Ouvre /app pour accepter ou refuser : rien ne t'est accordé tant que tu n'as pas répondu.`,
      kind: "workspace_invitation",
      userId: user.id,
    });

    return c.json(
      {
        invitation: {
          id: invitation.id,
          role: invitation.role,
          createdAt: invitation.createdAt,
          status: invitation.status,
        },
        invitee: { name: user.name, email: user.email },
        email: { delivered: delivered.status === "sent", status: delivered.status },
      },
      201
    );
  });

  /** Pending invitations of a workspace, for the owner or admin who sent them. */
  app.get("/workspaces/:workspaceId/invitations", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"), [
      "owner",
      "admin",
    ]);
    const items = await services.store.listWorkspaceInvitations(workspace.id);
    return c.json({ items });
  });

  app.delete("/workspaces/:workspaceId/invitations/:invitationId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"), [
      "owner",
      "admin",
    ]);
    const revoked = await services.store.revokeInvitation(
      workspace.id,
      c.req.param("invitationId")
    );
    if (!revoked) {
      throw new HttpError(404, "invitation_not_found", "No pending invitation with this id.");
    }
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "invitation.revoked",
      detail: { invitationId: c.req.param("invitationId") },
    });
    await notifyLatestAudit(services, workspace.id, "invitation.revoked");
    return c.json({ ok: true });
  });

  /** Owner-only role change, with a last-owner guard: a workspace always keeps
   * at least one owner. */
  app.patch("/workspaces/:workspaceId/members/:userId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.param("workspaceId"), [
      "owner",
    ]);
    const body = await readBody(c, updateMemberSchema);
    const targetUserId = c.req.param("userId");
    const current = await services.store.workspaceMemberRole(workspace.id, targetUserId);
    if (!current) {
      throw new HttpError(404, "member_not_found", "This user is not a member of the workspace.");
    }
    if (
      current === "owner" &&
      body.role !== "owner" &&
      (await services.store.ownerCount(workspace.id)) <= 1
    ) {
      throw new HttpError(
        409,
        "last_owner",
        "The workspace needs at least one owner. Promote another member first."
      );
    }
    await services.store.updateWorkspaceMemberRole(workspace.id, targetUserId, body.role);
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "member.role_changed",
      detail: { userId: targetUserId, from: current, to: body.role },
    });
    return c.json({ ok: true });
  });

  /** Removes a member. Owners and admins may remove others; a member may leave
   * on their own. The last owner cannot be removed. */
  app.delete("/workspaces/:workspaceId/members/:userId", async (c) => {
    const { workspace, role: actorRole } = await requireWorkspace(
      c,
      services,
      c.req.param("workspaceId")
    );
    const targetUserId = c.req.param("userId");
    if (actorRole !== "owner" && actorRole !== "admin" && actorRole !== "member") {
      throw new HttpError(403, "insufficient_role", "Viewers cannot manage members.");
    }
    if (actorRole === "member" && targetUserId !== c.get("user").id) {
      throw new HttpError(403, "insufficient_role", "Members can only remove themselves.");
    }
    const current = await services.store.workspaceMemberRole(workspace.id, targetUserId);
    if (!current) {
      throw new HttpError(404, "member_not_found", "This user is not a member of the workspace.");
    }
    if (current === "owner" && (await services.store.ownerCount(workspace.id)) <= 1) {
      throw new HttpError(
        409,
        "last_owner",
        "The workspace needs at least one owner. Promote another member first."
      );
    }
    await services.store.removeWorkspaceMember(workspace.id, targetUserId);
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "member.removed",
      detail: { userId: targetUserId, role: current },
    });
    return c.json({ ok: true });
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

  /**
   * The effective module configuration for a project.
   *
   * Built from the project's own fields plus the saved module subtree, so the answer is
   * always a complete, parseable `ProofCoreConfig` — exactly what the CLI would load.
   * `issues` are returned, not hidden: a missing target is information, not a failure.
   */
  app.get("/projects/:projectId/config", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    const stored = readStoredProjectConfig(project.moduleConfig);
    const config = buildProjectConfig(project, stored);
    const issues = projectConfigIssues(config);
    return c.json({
      config,
      issues,
      blocking: blockingIssues(issues),
      precheck: precheck(stored, config),
      savedAt: stored?.savedAt ?? null,
      source: stored ? "saved" : "defaults",
    });
  });

  app.put("/projects/:projectId/config", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
      "member",
    ]);
    const body = await readBody(c, projectConfigInputSchema);
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");

    const savedAt = new Date(services.clock()).toISOString();
    const stored = { ...body, savedAt };
    const config = buildProjectConfig(project, stored);
    const issues = projectConfigIssues(config);
    const blocking = blockingIssues(issues);
    if (blocking.length > 0) {
      throw new HttpError(
        422,
        "config_unsafe",
        "This configuration cannot be run automatically. Fix the listed settings and save again.",
        { issues: blocking }
      );
    }

    const saved = await services.store.setProjectModuleConfig(
      workspace.id,
      project.id,
      JSON.stringify(stored)
    );
    if (!saved) throw new HttpError(404, "project_not_found", "Project not found.");
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "project.config_updated",
      detail: { projectId: project.id },
    });
    return c.json({ config, issues, savedAt, source: "saved" });
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
    const page = readPage(c);
    const [runs, total] = await Promise.all([
      services.store.recentRuns(workspace.id, page.limit, page.offset),
      services.store.countWorkspaceRuns(workspace.id),
    ]);
    return c.json(
      pageBody(
        runs.map((run) => ({ ...runSummaryDto(run), projectName: run.projectName })),
        total,
        page
      )
    );
  });

  /** Findings across the workspace, filtered by module when asked. */
  app.get("/findings", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const raw = c.req.query("module");
    const module = raw === "world" || raw === "flow" || raw === "exit" ? raw : undefined;
    const page = readPage(c);
    const [findings, total] = await Promise.all([
      services.store.workspaceFindings(workspace.id, module, page.limit, page.offset),
      services.store.countWorkspaceFindings(workspace.id, module),
    ]);
    return c.json(pageBody(findings, total, page));
  });

  app.get("/projects/:projectId/runs", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    const page = readPage(c);
    const [runs, total] = await Promise.all([
      services.store.listRuns(workspace.id, project.id, page.limit, page.offset),
      services.store.countRuns(workspace.id, project.id),
    ]);
    return c.json(
      pageBody(
        runs.map((run) => runSummaryDto(run)),
        total,
        page
      )
    );
  });

  app.get("/projects/:projectId/findings", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    const page = readPage(c);
    const [items, total] = await Promise.all([
      services.store.listFindings(workspace.id, project.id, page.limit, page.offset),
      services.store.countFindings(workspace.id, project.id),
    ]);
    return c.json(pageBody(items, total, page));
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

/** Project the audit row a route has just committed into the workspace inbox. */
async function notifyLatestAudit(
  services: Services,
  workspaceId: string,
  action: string
): Promise<void> {
  const rows = await services.db
    .prepare(
      "SELECT id FROM audit_logs WHERE workspace_id = ? AND action = ? ORDER BY at DESC LIMIT 1"
    )
    .bind(workspaceId, action)
    .all<{ id: string }>();
  const auditId = rows[0]?.id;
  if (auditId) await notifyAudit(services, workspaceId, auditId);
}

/**
 * The audit id of the row just written. `appendAudit` returns void, so the bridge
 * looks up the newest matching row: the detail carries the invitation id, which makes
 * the match exact even if two invitations are sent in the same second.
 */
async function latestAuditId(
  services: Services,
  workspaceId: string,
  action: string,
  invitationId: string
): Promise<string> {
  const rows = await services.db
    .prepare(
      "SELECT id, detail FROM audit_logs WHERE workspace_id = ? AND action = ? ORDER BY at DESC LIMIT 20"
    )
    .bind(workspaceId, action)
    .all<{ id: string; detail: string }>();
  const match = rows.find((row) => row.detail.includes(invitationId));
  return match?.id ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
