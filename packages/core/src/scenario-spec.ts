/**
 * A FLOW scenario, validated before anything is saved or run.
 *
 * The editor and the API must reject the same shapes: an editor that accepts a step the
 * runner will skip, or a save that stores a scenario no browser can execute, is a promise
 * the product cannot keep. The runner (`apps/api/src/scenario.ts`) resolves clicks by
 * visible text, so a click without a target is not a scenario, it is a guess.
 */

export const FLOW_STEP_KINDS = ["navigate", "click", "type", "press", "scroll", "assert"] as const;
export type FlowStepKind = (typeof FLOW_STEP_KINDS)[number];

export interface FlowExpectation {
  urlContains?: string;
  textContains?: string;
  textNotContains?: string;
  headingContains?: string;
}

export interface FlowStep {
  id: string;
  kind: FlowStepKind;
  /** What the step does, in the author's words. Shown in the report, never invented. */
  label: string;
  /** Visible text of the control, for click/type. */
  target?: string;
  /** The URL for navigate, the text for type, the key for press, the delta for scroll. */
  value?: string;
  expect?: FlowExpectation;
  /** A step that changes state; it is skipped unless the run opts in. */
  destructive?: boolean;
  settleMs?: number;
}

export interface FlowScenarioSpec {
  name: string;
  target: string;
  steps: FlowStep[];
}

export type FlowValidationCode =
  | "invalid_name"
  | "invalid_target"
  | "empty_steps"
  | "too_many_steps"
  | "unknown_kind"
  | "missing_label"
  | "duplicate_id"
  | "missing_target"
  | "missing_value"
  | "invalid_key"
  | "invalid_scroll"
  | "empty_expectation";

export interface FlowValidationIssue {
  /** 0-based step index, absent for scenario-level issues. */
  step?: number;
  code: FlowValidationCode;
  message: string;
}

export type FlowValidationResult =
  | { ok: true; scenario: FlowScenarioSpec }
  | { ok: false; issues: FlowValidationIssue[] };

const MAX_STEPS = 20;
const MAX_TEXT = 160;

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function httpUrl(value: unknown): string | null {
  const raw = text(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Validate a scenario without executing or storing anything.
 *
 * It normalises what it accepts (trimmed text, a canonical URL) so two spellings of the
 * same scenario compare equal, and it reports every issue with its step instead of
 * stopping at the first one.
 */
export function validateFlowScenario(input: unknown): FlowValidationResult {
  const issues: FlowValidationIssue[] = [];
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = text(record.name, 80);
  if (!name) issues.push({ code: "invalid_name", message: "A scenario needs a name." });

  const target = httpUrl(record.target);
  if (!target) {
    issues.push({
      code: "invalid_target",
      message: "The target must be a full http(s) address.",
    });
  }

  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  if (rawSteps.length === 0) {
    issues.push({ code: "empty_steps", message: "A scenario needs at least one step." });
  }
  if (rawSteps.length > MAX_STEPS) {
    issues.push({
      code: "too_many_steps",
      message: `A scenario is limited to ${MAX_STEPS} steps.`,
    });
  }

  const steps: FlowStep[] = [];
  const seen = new Set<string>();
  rawSteps.slice(0, MAX_STEPS).forEach((raw, index) => {
    const step = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = text(step.kind, 40) as FlowStepKind;
    if (!(FLOW_STEP_KINDS as readonly string[]).includes(kind)) {
      issues.push({ step: index, code: "unknown_kind", message: `Unknown step kind: ${kind || "(empty)"}.` });
      return;
    }
    const id = text(step.id, 60) || `step-${index + 1}`;
    const label = text(step.label);
    if (!label) {
      issues.push({ step: index, code: "missing_label", message: "A step needs a label." });
    }
    if (seen.has(id)) {
      issues.push({ step: index, code: "duplicate_id", message: `Two steps share the id ${id}.` });
      return;
    }
    seen.add(id);

    const targetText = text(step.target);
    const valueText = text(step.value, 2000);
    const expectRaw = (step.expect && typeof step.expect === "object" ? step.expect : {}) as Record<string, unknown>;
    const expect: FlowExpectation = {};
    for (const key of ["urlContains", "textContains", "textNotContains", "headingContains"] as const) {
      const wanted = text(expectRaw[key], 300);
      if (wanted) expect[key] = wanted;
    }

    if ((kind === "click" || kind === "type") && !targetText) {
      issues.push({
        step: index,
        code: "missing_target",
        message: kind === "click"
          ? "A click needs the visible text of the control it clicks."
          : "A type step needs the visible label of the field it fills.",
      });
    }
    if (kind === "navigate" && !httpUrl(valueText)) {
      issues.push({ step: index, code: "missing_value", message: "A navigate step needs a full http(s) address." });
    }
    if (kind === "press" && valueText && valueText.length > 20) {
      issues.push({ step: index, code: "invalid_key", message: "A key name is short: Enter, Tab, Escape." });
    }
    if (kind === "scroll" && valueText && !Number.isFinite(Number(valueText))) {
      issues.push({ step: index, code: "invalid_scroll", message: "A scroll step needs a number of pixels." });
    }
    if (kind === "assert" && Object.keys(expect).length === 0) {
      issues.push({
        step: index,
        code: "empty_expectation",
        message: "An assertion needs at least one expectation, otherwise it cannot fail.",
      });
    }

    const settleMs = Number(step.settleMs ?? 0);
    steps.push({
      id,
      kind,
      label,
      ...(targetText ? { target: targetText } : {}),
      ...(kind === "navigate"
        ? { value: httpUrl(valueText) as string }
        : valueText
          ? { value: valueText }
          : {}),
      ...(Object.keys(expect).length > 0 ? { expect } : {}),
      ...(step.destructive === true ? { destructive: true } : {}),
      ...(Number.isFinite(settleMs) && settleMs > 0
        ? { settleMs: Math.min(10_000, Math.round(settleMs)) }
        : {}),
    });
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, scenario: { name, target: target as string, steps } };
}
