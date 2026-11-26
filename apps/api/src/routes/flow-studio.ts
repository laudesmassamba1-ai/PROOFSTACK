import { type FlowValidationIssue, type FlowStep, validateFlowScenario } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { executeBrowserScenario } from "../browser-scenario.js";
import { HttpError } from "../http/errors.js";
import { readBody, requireWorkspace } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";
import type { FlowScenarioRecord } from "../store/app-store.js";

/**
 * FLOW scenarios, saved and run on demand.
 *
 * The editor needs the definition to survive a reload; the runner needs exactly the steps
 * the editor validated. Both sides call `validateFlowScenario` from core, so a scenario the
 * editor accepts is one the runner can execute, and a refusal names the step at fault.
 */

const stepSchema = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(["navigate", "click", "type", "press", "scroll", "assert"]),
  label: z.string().min(1).max(160),
  target: z.string().max(160).optional(),
  value: z.string().max(2000).optional(),
  expect: z
    .object({
      urlContains: z.string().max(300).optional(),
      textContains: z.string().max(300).optional(),
      textNotContains: z.string().max(300).optional(),
      headingContains: z.string().max(300).optional(),
    })
    .strict()
    .optional(),
  destructive: z.boolean().optional(),
  settleMs: z.number().int().min(0).max(10_000).optional(),
});

const createSchema = z
  .object({
    workspaceId: z.string().min(1).max(64),
    projectId: z.string().min(1).max(64).nullish(),
    name: z.string().min(1).max(80),
    target: z.string().min(1).max(2048),
    steps: z.array(stepSchema).min(1).max(20),
  })
  .strict();

const updateSchema = z
  .object({
    workspaceId: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    target: z.string().min(1).max(2048),
    steps: z.array(stepSchema).min(1).max(20),
  })
  .strict();

const runSchema = z
  .object({
    workspaceId: z.string().min(1).max(64),
    allowDestructive: z.boolean().default(false),
  })
  .strict();

function scenarioDto(record: FlowScenarioRecord) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    name: record.name,
    target: record.target,
    steps: record.steps,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastRunAt: record.lastRunAt,
    lastReport: record.lastReport,
  };
}

/**
 * Re-validate on the server, with the same function the browser used.
 *
 * The body already passed Zod, so this only rejects scenarios that are structurally valid
 * but meaningless — a click with no control, an assertion that cannot fail. The issues are
 * returned per step so the editor can point at the field, not dump one string.
 */
function validated(input: { name: string; target: string; steps: FlowStep[] }): {
  name: string;
  target: string;
  steps: FlowStep[];
} {
  const result = validateFlowScenario(input);
  if (result.ok) return result.scenario;
  const issues: FlowValidationIssue[] = result.issues;
  throw new HttpError(
    400,
    "invalid_scenario",
    issues.map((issue) => issue.message).join(" "),
    { issues }
  );
}

export function flowStudioRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/flow/scenarios", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const projectId = c.req.query("projectId") ?? null;
    if (projectId && !(await services.store.getProject(workspace.id, projectId))) {
      throw new HttpError(404, "project_not_found", "No project with this id in this workspace.");
    }
    const scenarios = await services.store.listFlowScenarios(workspace.id, projectId);
    return c.json({ scenarios: scenarios.map(scenarioDto) });
  });

  app.post("/flow/scenarios", async (c) => {
    const body = await readBody(c, createSchema);
    const { workspace } = await requireWorkspace(c, services, body.workspaceId, [
      "owner",
      "admin",
      "member",
    ]);
    if (body.projectId && !(await services.store.getProject(workspace.id, body.projectId))) {
      throw new HttpError(404, "project_not_found", "No project with this id in this workspace.");
    }
    const scenario = validated(body);
    const created = await services.store.createFlowScenario({
      id: `flw_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      workspaceId: workspace.id,
      projectId: body.projectId ?? null,
      name: scenario.name,
      target: scenario.target,
      steps: scenario.steps,
      createdBy: c.get("user").id,
      now: services.clock(),
    });
    return c.json({ scenario: scenarioDto(created) }, 201);
  });

  app.patch("/flow/scenarios/:id", async (c) => {
    const body = await readBody(c, updateSchema);
    const { workspace } = await requireWorkspace(c, services, body.workspaceId, [
      "owner",
      "admin",
      "member",
    ]);
    const existing = await services.store.getFlowScenario(workspace.id, c.req.param("id"));
    if (!existing) throw new HttpError(404, "scenario_not_found", "No scenario with this id.");
    const scenario = validated(body);
    const updated = await services.store.updateFlowScenario({
      workspaceId: workspace.id,
      id: existing.id,
      name: scenario.name,
      target: scenario.target,
      steps: scenario.steps,
      now: services.clock(),
    });
    if (!updated) throw new HttpError(404, "scenario_not_found", "No scenario with this id.");
    return c.json({ scenario: scenarioDto(updated) });
  });

  app.delete("/flow/scenarios/:id", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
      "member",
    ]);
    const removed = await services.store.deleteFlowScenario(workspace.id, c.req.param("id"));
    if (!removed) throw new HttpError(404, "scenario_not_found", "No scenario with this id.");
    return c.json({ deleted: true });
  });

  /**
   * Run the saved steps through the real browser.
   *
   * The report is stored beside the definition and the execution is recorded as a
   * canonical Analysis, so the Analysis Center shows the run even when the scenario is
   * edited afterwards. A missing browser is a 503 with an honest message, never an empty
   * success.
   */
  app.post("/flow/scenarios/:id/run", async (c) => {
    const body = await readBody(c, runSchema);
    const access = await requireWorkspace(c, services, body.workspaceId, [
      "owner",
      "admin",
      "member",
    ]);
    const existing = await services.store.getFlowScenario(access.workspace.id, c.req.param("id"));
    if (!existing) throw new HttpError(404, "scenario_not_found", "No scenario with this id.");
    const execution = await executeBrowserScenario(services, c.env, {
      workspaceId: access.workspace.id,
      projectId: existing.projectId,
      userId: c.get("user").id,
      url: existing.target,
      name: existing.name,
      scenarioId: existing.id,
      steps: existing.steps,
      allowDestructive: body.allowDestructive,
    });
    await services.store.recordFlowScenarioRun({
      workspaceId: access.workspace.id,
      id: existing.id,
      report: execution.report,
      now: services.clock(),
    });
    return c.json({ report: execution.report, analysisId: execution.analysisId });
  });

  return app;
}
