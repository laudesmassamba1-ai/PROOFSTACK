/**
 * A FLOW scenario on the machine's own Chromium.
 *
 * The Worker reaches Cloudflare's Browser Rendering binding; a laptop has no such binding,
 * but it does have a browser. This runner uses the adapter the CLI already drives over CDP,
 * so the local server executes the same steps a person would, instead of answering 503 on
 * the one surface most people use to try the product.
 *
 * Node-only on purpose: it imports `node:child_process` through the adapter, and the
 * Worker entry never imports this file. It is wired by `node.ts`, not by `createApp`.
 */
import { browsers, type InteractionStep, runInteractionScenario } from "@proofcore/adapter-browser";
import type { LocalScenarioInput } from "./http/services.js";
import type { ScenarioReport } from "./scenario.js";

/**
 * Run the steps and normalise the adapter report into the shape every surface returns.
 *
 * The adapter distinguishes the same statuses and keeps the same rule — a step that
 * cannot run is SKIPPED with a reason — so nothing is invented in translation. Evidence
 * fields the scenario report does not expose are dropped, not summarised away.
 */
export async function runLocalScenario(input: LocalScenarioInput): Promise<ScenarioReport> {
  const opened = await browsers.open({ url: input.url });
  try {
    const steps: InteractionStep[] = input.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      label: step.label,
      ...(step.target ? { target: step.target } : {}),
      ...(step.value ? { value: step.value } : {}),
      ...(step.expect ? { expect: step.expect } : {}),
      ...(step.destructive ? { destructive: true } : {}),
      ...(step.settleMs ? { settleMs: step.settleMs } : {}),
    }));
    const report = await runInteractionScenario(
      opened.page,
      { id: "flow-local", name: input.name, steps },
      { allowDestructive: input.allowDestructive }
    );
    return {
      scenarioId: report.scenarioId,
      name: report.name,
      url: report.url,
      findings: report.findings.map((finding) => ({
        id: finding.id,
        status: finding.status,
        observed: finding.observed,
        why: finding.why,
        ...(finding.reproduce ? { reproduce: finding.reproduce } : {}),
      })),
      stepsRun: report.stepsRun,
      stepsSkipped: report.stepsSkipped,
      final: report.final,
      durationMs: report.durationMs,
    };
  } finally {
    // The tab is per run: leaving it open would let a later scenario inherit its state.
    await browsers.close(opened.id).catch(() => undefined);
  }
}
