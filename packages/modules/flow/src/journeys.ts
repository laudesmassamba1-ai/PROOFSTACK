import type { FlowConfig, ProofCoreConfig } from "@proofcore/contracts";
import { ProofCoreError } from "@proofcore/core";
import type { TestSuiteDef } from "@proofcore/engine";

/**
 * FLOW journeys.
 *
 * A journey is a list of the same actions a person performs: open a page, fill a
 * field, click a button, wait for the confirmation. The engine owns the semantics;
 * the browser is injected as a small page interface, so the CLI drives Chromium and a
 * test drives a fake. Nothing here invents a selector or an assertion.
 */

export type FlowJourney = FlowConfig["journeys"][number];
export type FlowJourneyStep = FlowJourney["steps"][number];

/** The browser operations a journey needs, independent of any browser library. */
export interface JourneyPage {
  navigate(url: string, timeoutMs: number): Promise<void>;
  click(selector: string, timeoutMs: number): Promise<void>;
  fill(selector: string, value: string, timeoutMs: number): Promise<void>;
  select(selector: string, value: string, timeoutMs: number): Promise<void>;
  submit(selector: string | undefined, timeoutMs: number): Promise<void>;
  waitFor(
    input: { selector?: string; text?: string; url?: string },
    timeoutMs: number
  ): Promise<void>;
  text(): Promise<string>;
  url(): Promise<string>;
  screenshot(): Promise<Uint8Array>;
  api(url: string, timeoutMs: number): Promise<number>;
}

export interface JourneyContext {
  /** Project base URL; a journey startUrl wins when it is present. */
  baseUrl: string;
  runId: string;
}

export interface JourneyResult {
  steps: number;
  finalUrl: string;
  screenshots: Uint8Array[];
}

export type JourneyRunner = (
  journey: FlowJourney,
  context: JourneyContext
) => Promise<JourneyResult>;

function required(value: string | undefined, step: FlowJourneyStep, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new ProofCoreError({
      message: `Journey step "${step.id}" (${step.action}) requires ${field}.`,
      category: "CONFIGURATION",
      code: "journey_step_incomplete",
      details: { stepId: step.id, action: step.action, field },
    });
  }
  return trimmed;
}

function httpUrl(raw: string, step: FlowJourneyStep): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProofCoreError({
      message: `Journey step "${step.id}" has an invalid URL: ${raw}`,
      category: "VALIDATION",
      code: "journey_invalid_url",
      details: { stepId: step.id },
    });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProofCoreError({
      message: `Journey step "${step.id}" only accepts http(s) URLs.`,
      category: "VALIDATION",
      code: "journey_unsupported_scheme",
      details: { stepId: step.id },
    });
  }
  return parsed.toString();
}

async function executeStep(
  step: FlowJourneyStep,
  page: JourneyPage,
  context: JourneyContext,
  screenshots: Uint8Array[]
): Promise<void> {
  const timeoutMs = step.timeoutMs;
  const target = step.target?.trim();
  const value = step.value ?? "";

  switch (step.action) {
    case "navigate": {
      const raw = required(step.target ?? step.value, step, "a URL");
      const resolved = raw.startsWith("/") ? new URL(raw, context.baseUrl).toString() : raw;
      await page.navigate(httpUrl(resolved, step), timeoutMs);
      return;
    }
    case "click":
      await page.click(required(target, step, "a selector (target)"), timeoutMs);
      return;
    case "fill":
      await page.fill(required(target, step, "a selector (target)"), value, timeoutMs);
      return;
    case "select":
      await page.select(required(target, step, "a selector (target)"), value, timeoutMs);
      return;
    case "submit":
      await page.submit(target, timeoutMs);
      return;
    case "waitFor": {
      if (target) {
        await page.waitFor({ selector: target }, timeoutMs);
      } else {
        const expected = required(value, step, "a text or URL (value)");
        await page.waitFor(
          /^https?:\/\//.test(expected) ? { url: expected } : { text: expected },
          timeoutMs
        );
      }
      return;
    }
    case "assertText": {
      const expected = required(value || target, step, "an expected text");
      const text = await page.text();
      if (!text.includes(expected)) {
        throw new ProofCoreError({
          message: `Journey step "${step.id}" expected the page to contain "${expected}".`,
          category: "VALIDATION",
          code: "journey_text_missing",
          details: { stepId: step.id, expected },
        });
      }
      return;
    }
    case "assertUrl": {
      const expected = required(value || target, step, "an expected URL fragment");
      const current = await page.url();
      if (!current.includes(expected)) {
        throw new ProofCoreError({
          message: `Journey step "${step.id}" expected the URL to contain "${expected}", got ${current}.`,
          category: "VALIDATION",
          code: "journey_url_mismatch",
          details: { stepId: step.id, expected, current },
        });
      }
      return;
    }
    case "screenshot":
      screenshots.push(await page.screenshot());
      return;
    case "api": {
      const raw = required(target ?? step.value, step, "a URL (target)");
      const resolved = raw.startsWith("/") ? new URL(raw, context.baseUrl).toString() : raw;
      const status = await page.api(httpUrl(resolved, step), timeoutMs);
      if (status < 200 || status >= 300) {
        throw new ProofCoreError({
          message: `Journey step "${step.id}" expected a 2xx response, got ${status}.`,
          category: "NETWORK",
          code: "journey_api_failed",
          details: { stepId: step.id, status },
        });
      }
      return;
    }
    default: {
      const unreachable: never = step.action;
      throw new ProofCoreError({
        message: `Unsupported journey action: ${String(unreachable)}`,
        category: "CONFIGURATION",
        code: "journey_action_unknown",
      });
    }
  }
}

/**
 * Executes one journey from its start URL through every step.
 *
 * A non-optional failing step aborts with the step id in the error: a report tells the
 * user exactly where the flow broke, not merely that it did. An optional step records
 * nothing on success and is ignored on failure.
 */
export async function executeJourney(
  journey: FlowJourney,
  page: JourneyPage,
  context: JourneyContext
): Promise<JourneyResult> {
  const start = journey.startUrl ?? context.baseUrl;
  if (!start) {
    throw new ProofCoreError({
      message: `Journey "${journey.name}" has no start URL and the project has no base URL.`,
      category: "CONFIGURATION",
      code: "journey_no_start_url",
      details: { journeyId: journey.id },
    });
  }
  await page.navigate(httpUrl(start, journey.steps[0] as FlowJourneyStep), 30_000);

  const screenshots: Uint8Array[] = [];
  let completed = 0;
  for (const step of journey.steps) {
    try {
      await executeStep(step, page, context, screenshots);
      completed += 1;
    } catch (error) {
      if (step.optional) continue;
      throw error;
    }
  }
  return { steps: completed, finalUrl: await page.url(), screenshots };
}

/**
 * Builds one suite for the configured journeys. Without a runner — the API Worker has
 * no browser — every journey is SKIPPED with the reason, which is honest and keeps a
 * server-side run from looking like a verified browser flow.
 */
export function buildJourneySuites(
  config: ProofCoreConfig,
  runId: string,
  runner?: JourneyRunner
): TestSuiteDef[] {
  const journeys = config.modules.flow.journeys;
  if (journeys.length === 0) return [];
  return [
    {
      id: "flow:journeys",
      name: "FLOW — browser journeys",
      module: "flow",
      description: `${journeys.length} step-by-step user journey(s)`,
      cases: journeys.map((journey) => ({
        id: `flow/journey/${journey.id}`,
        name: journey.name,
        description: `${journey.steps.length} configured browser step(s) from ${journey.startUrl ?? config.project.baseUrl}`,
        module: "flow" as const,
        severity: journey.destructive ? ("HIGH" as const) : ("MEDIUM" as const),
        suiteId: "flow:journeys",
        timeoutMs: Math.min(
          300_000,
          Math.max(30_000, journey.steps.reduce((sum, step) => sum + step.timeoutMs, 0) + 30_000)
        ),
        ...(runner
          ? {}
          : {
              skip: "no browser runner in this runtime; run `proofcore test` locally or in CI",
            }),
        execute: async (ctx) => {
          if (!runner) return;
          const result = await runner(journey, {
            baseUrl: journey.startUrl ?? config.project.baseUrl,
            runId,
          });
          for (const [index, bytes] of result.screenshots.entries()) {
            await ctx.attachBytes({
              label: `${journey.name} — screenshot ${index + 1}`,
              kind: "screenshot",
              bytes,
              mediaType: "image/png",
            });
          }
          void ctx;
          void result.finalUrl;
        },
      })),
    },
  ];
}
