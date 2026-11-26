/**
 * One execution path for a FLOW scenario, whichever surface asked.
 *
 * The browser route and the saved-scenario route used to be two plausible places to run a
 * journey; a third would have made a third truth. This module owns the browser binding
 * check, the run, the canonical Analysis and the last report — so a scenario started from
 * the editor and one started from the browser panel are the same execution, recorded the
 * same way. A deployment without the BROWSER binding says so; it never fakes a report.
 */
import { type AnalysisCoverage, iso, uuid } from "@proofcore/core";
import { HttpError } from "./http/errors.js";
import type { Services } from "./http/services.js";
import { runScenario, type ScenarioReport, type ScenarioStep } from "./scenario.js";

interface BrowserLike {
  pages(): Promise<ScenarioPageLike[]>;
  newPage(): Promise<ScenarioPageLike>;
  close(): Promise<void>;
}

interface ScenarioPageLike {
  setViewport(viewport: { width: number; height: number }): Promise<void>;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  evaluate?: ((expression: string) => Promise<unknown>) | undefined;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  mouse: { click(x: number, y: number): Promise<void>; wheel(options: { deltaY: number }): Promise<void> };
  on(event: string, handler: (...args: unknown[]) => void): void;
}

async function puppeteerModule(): Promise<{
  launch: (binding: unknown, options?: Record<string, unknown>) => Promise<BrowserLike>;
}> {
  const module = (await import("@cloudflare/puppeteer")) as unknown as {
    default: { launch: (binding: unknown, options?: Record<string, unknown>) => Promise<BrowserLike> };
  };
  return module.default;
}

export interface ScenarioExecutionInput {
  workspaceId: string;
  projectId?: string | null;
  userId: string;
  url: string;
  name?: string;
  scenarioId?: string | null;
  steps: ScenarioStep[];
  allowDestructive?: boolean;
}

export interface ScenarioExecution {
  report: ScenarioReport;
  analysisId: string;
}

/**
 * Execute the steps on a real Chromium and record the run as an Analysis.
 *
 * `completed` means the execution finished, not that the journey passed: the findings carry
 * that verdict. Recording a failed assertion as `failed` would lose the distinction between
 * "the browser could not run" and "the page did not behave", which is the whole product.
 */
export async function executeBrowserScenario(
  services: Services,
  env: { BROWSER?: unknown } | undefined,
  input: ScenarioExecutionInput
): Promise<ScenarioExecution> {
  const binding = env?.BROWSER;
  if (!binding) {
    throw new HttpError(
      503,
      "browser_unavailable",
      "Ce déploiement n'a pas de navigateur (liaison BROWSER absente). Le même scénario peut être exécuté par la CLI : proofcore audit interact."
    );
  }

  const id = `ana_${uuid().replaceAll("-", "").slice(0, 20)}`;
  const startedAt = services.clock();
  const requestedModules = ["flow"];
  const coverage: AnalysisCoverage = {
    requestedModules,
    applicableModules: requestedModules,
    measuredModules: [],
    skipped: [],
  };
  // Recorded before the browser starts: a run that dies mid-flight stays visible as
  // `running` and can be diagnosed, instead of vanishing with the request.
  await services.store.createAnalysis({
    id,
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    createdBy: input.userId,
    source: "WEB",
    targetType: "WORKFLOW",
    target: input.url,
    scope: input.scenarioId ? `scenario:${input.scenarioId}` : "scenario:adhoc",
    requestedModules,
    applicableModules: requestedModules,
    engine: "browser-scenario",
    engineVersion: "1",
    environment: "cloudflare-browser",
    status: "running",
    coverage,
    startedAt: iso(startedAt),
    metadata: {
      ...(input.name ? { scenarioName: input.name } : {}),
      ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
      stepCount: input.steps.length,
    },
    correlationId: id,
  });

  try {
    const puppeteer = await puppeteerModule();
    const browser = await puppeteer.launch(binding);
    try {
      const page = (await browser.pages())[0] ?? (await browser.newPage());
      await page.setViewport({ width: 1280, height: 800 });
      const report = await runScenario(page as never, input.steps, {
        name: input.name ?? "Browser interaction",
        allowDestructive: input.allowDestructive === true,
      });
      const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIPPED: 0 };
      for (const finding of report.findings) counts[finding.status] += 1;
      const endedAt = services.clock();
      await services.store.updateAnalysis({
        workspaceId: input.workspaceId,
        id,
        patch: {
          status: "completed",
          endedAt: iso(endedAt),
          durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
          coverage: { ...coverage, measuredModules: ["flow"] },
          result: {
            stepsRun: report.stepsRun,
            stepsSkipped: report.stepsSkipped,
            findings: counts,
            finalUrl: report.final?.url ?? null,
          },
        },
        expected: ["running"],
      });
      await services.store.appendAudit({
        workspaceId: input.workspaceId,
        actor: input.userId,
        action: "browser.scenario",
        detail: {
          url: input.url,
          stepsRun: report.stepsRun,
          failed: counts.FAIL,
          destructive: input.allowDestructive === true,
          analysisId: id,
        },
      });
      return { report, analysisId: id };
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    const endedAt = services.clock();
    await services.store.updateAnalysis({
      workspaceId: input.workspaceId,
      id,
      patch: {
        status: "failed",
        endedAt: iso(endedAt),
        durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
        error: error instanceof Error ? error.message : String(error),
      },
      expected: ["running"],
    });
    throw error;
  }
}
