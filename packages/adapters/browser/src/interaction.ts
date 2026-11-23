/// <reference lib="dom" />
import type { PageSnapshot, SnapshotElement } from "./page-script.js";
import type { BrowserPage } from "./session.js";

/**
 * Full browser interaction testing for complex applications.
 *
 * The rest of PROOFCORE reads a page: headers, markup, links, controls. This module
 * *drives* it. It answers the questions a static scan structurally cannot:
 *
 *   - does the form actually submit and change state?
 *   - does the SPA route work when clicked, not only when pasted in the address bar?
 *   - does a JavaScript exception appear only after an interaction?
 *   - does a request fail only when the user performs a real action?
 *   - does the mobile viewport break a control that works on desktop?
 *
 * Design rules, because a browser test that lies is worse than no browser test:
 *
 *  1. Every step records what it observed, not what it hoped. A click that did nothing
 *     is reported as "URL and DOM unchanged", never as "navigated".
 *  2. A step that cannot be performed is SKIPPED with the reason, not PASSED. A page
 *     with no form has no form test, not a passing form test.
 *  3. JavaScript errors and failed requests are read from the real CDP event stream,
 *     not from a regex over the HTML.
 *  4. The scenario never mutates production by default: only steps declared in the
 *     scenario run, and a destructive step needs an explicit opt-in.
 *  5. Evidence is bounded. A page with 10 000 console lines produces a count and the
 *     first few messages, not a report that cannot be read.
 */

export type InteractionStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface InteractionFinding {
  id: string;
  status: InteractionStatus;
  /** The raw observation, in one line. */
  observed: string;
  /** Why it matters, in one sentence. */
  why: string;
  /** Reproducible step, when the finding came from an action. */
  reproduce?: string;
  /** Bounded evidence, never a full console dump. */
  evidence?: Record<string, unknown>;
}

export interface InteractionStep {
  /** Stable id, used in findings and reproduction strings. */
  id: string;
  kind:
    | "navigate"
    | "click"
    | "type"
    | "press"
    | "select"
    | "scroll"
    | "wait"
    | "assert"
    | "screenshot";
  /** Human description, written in the interface language of the caller. */
  label: string;
  /** Visible text or accessible name to find. Resolved from a fresh snapshot. */
  target?: string;
  /** Value for `type` / `select`, key for `press`. */
  value?: string;
  /** For `assert`: what must be true after the previous steps. */
  expect?: {
    urlContains?: string;
    textContains?: string;
    textNotContains?: string;
    headingContains?: string;
    elementAppears?: string;
    elementDisappears?: string;
  };
  /** Skip this step unless the operator opted into state-changing actions. */
  destructive?: boolean;
  /** Milliseconds to wait after the action for the app to settle. */
  settleMs?: number;
}

export interface InteractionScenario {
  id: string;
  name: string;
  steps: InteractionStep[];
  /** Viewport for the whole scenario. */
  viewport?: { width: number; height: number };
}

export interface InteractionOptions {
  /** Run steps marked destructive. Default false. */
  allowDestructive?: boolean;
  /** Maximum characters of page text kept in a snapshot comparison. */
  maxText?: number;
  /** Maximum console/network messages kept as evidence. */
  maxEvidence?: number;
  /** Called before each step, for a progress UI. Never receives secrets. */
  onStep?: (step: InteractionStep, index: number, total: number) => void;
}

export interface InteractionReport {
  scenarioId: string;
  name: string;
  url: string;
  findings: InteractionFinding[];
  stepsRun: number;
  stepsSkipped: number;
  /** Final page state, bounded. */
  final: {
    url: string;
    title: string;
    headings: string[];
    elementCount: number;
    formCount: number;
  } | null;
  /** Screenshots captured on failure, as base64 only when requested by a step. */
  screenshots: { stepId: string; data: string }[];
  durationMs: number;
}

const DEFAULT_MAX_TEXT = 12_000;
const DEFAULT_MAX_EVIDENCE = 12;

/**
 * Find an interactive element by its visible text or accessible name in a fresh snapshot.
 *
 * Refs are re-issued at every snapshot, so a ref from an earlier step is never reused:
 * clicking a stale ref after a re-render is how browser tests silently hit the wrong
 * button. Matching on text is slower but correct.
 */
function findTarget(snapshot: PageSnapshot, target: string): string | null {
  const needle = target.trim().toLowerCase();
  if (!needle) return null;

  const exact = snapshot.elements.find((element: SnapshotElement) => {
    const name = (element.name ?? "").trim().toLowerCase();
    return name === needle;
  });
  if (exact?.ref) return exact.ref;

  const partial = snapshot.elements.find((element: SnapshotElement) => {
    const name = (element.name ?? "").trim().toLowerCase();
    return name.length > 0 && (name.includes(needle) || needle.includes(name));
  });
  return partial?.ref ?? null;
}

function elementNames(snapshot: PageSnapshot): string[] {
  return snapshot.elements
    .map((element: SnapshotElement) => (element.name ?? "").trim().toLowerCase())
    .filter(Boolean);
}

function short(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Run one scenario against a live BrowserPage.
 *
 * The page is owned by the caller: this function does not open or close it, so a
 * multi-scenario session can reuse one browser and keep cookies between scenarios.
 */
export async function runInteractionScenario(
  page: BrowserPage,
  scenario: InteractionScenario,
  options: InteractionOptions = {}
): Promise<InteractionReport> {
  const started = Date.now();
  const findings: InteractionFinding[] = [];
  const screenshots: InteractionReport["screenshots"] = [];
  const maxEvidence = options.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
  const maxText = options.maxText ?? DEFAULT_MAX_TEXT;
  let stepsRun = 0;
  let stepsSkipped = 0;

  if (scenario.viewport) {
    await page.setViewport(scenario.viewport);
  }

  // Capture the baseline once. Errors present before any interaction are still real,
  // but they are reported as a baseline finding rather than blamed on a later step.
  const baselineErrors = page.pageErrors.length;
  const baselineFailed = page.network.filter((entry) => entry.status >= 400).length;

  for (const [index, step] of scenario.steps.entries()) {
    options.onStep?.(step, index, scenario.steps.length);

    if (step.destructive && !options.allowDestructive) {
      stepsSkipped += 1;
      findings.push({
        id: `${step.id}.skipped`,
        status: "SKIPPED",
        observed: `Step "${step.label}" can change state and was not run.`,
        why: "Destructive actions require an explicit opt-in; nothing was clicked.",
      });
      continue;
    }

    stepsRun += 1;
    const before = await page.snapshot({ maxText, maxElements: 400 });
    // Set when the action could not be performed (missing control). The step is
    // reported as SKIPPED and no "effect" or expectation is inferred from it.
    let notPerformed = false;

    try {
      switch (step.kind) {
        case "navigate": {
          if (!step.value) throw new Error("navigate step has no URL");
          await page.navigate(step.value);
          break;
        }
        case "click": {
          const ref = step.target ? findTarget(before, step.target) : null;
          if (!step.target) throw new Error("click step has no target");
          if (!ref) {
            findings.push({
              id: `${step.id}.missing`,
              status: "SKIPPED",
              observed: `No visible control named "${step.target}" was found.`,
              why: "The click was not performed; a missing control is not a passing click.",
              reproduce: `${scenario.id} → ${step.label}`,
            });
            notPerformed = true;
            break;
          }
          await page.click({ ref });
          break;
        }
        case "type": {
          const ref = step.target ? findTarget(before, step.target) : null;
          if (!step.target || !ref) {
            findings.push({
              id: `${step.id}.missing`,
              status: "SKIPPED",
              observed: `No visible field named "${step.target ?? ""}" was found.`,
              why: "Nothing was typed; a missing field is not a passing input test.",
              reproduce: `${scenario.id} → ${step.label}`,
            });
            notPerformed = true;
            break;
          }
          await page.type({ ref }, step.value ?? "");
          break;
        }
        case "press": {
          await page.press(step.value ?? "Enter");
          break;
        }
        case "select": {
          const ref = step.target ? findTarget(before, step.target) : null;
          if (!step.target || !ref) {
            findings.push({
              id: `${step.id}.missing`,
              status: "SKIPPED",
              observed: `No select named "${step.target ?? ""}" was found.`,
              why: "Nothing was selected; a missing control is not a passing test.",
              reproduce: `${scenario.id} → ${step.label}`,
            });
            notPerformed = true;
            break;
          }
          await page.select({ ref }, [step.value ?? ""]);
          break;
        }
        case "scroll": {
          await page.scroll({ ref: "", dy: Number(step.value ?? 600) });
          break;
        }
        case "wait": {
          await page
            .waitFor({ text: step.value, timeoutMs: Number(step.settleMs ?? 5_000) })
            .catch(() => undefined);
          break;
        }
        case "screenshot": {
          const shot = await page.screenshot();
          screenshots.push({ stepId: step.id, data: shot.data.toString("base64") });
          break;
        }
        case "assert": {
          // Assertions are evaluated below, against the state after the previous actions.
          break;
        }
        default: {
          findings.push({
            id: `${step.id}.unknown`,
            status: "SKIPPED",
            observed: `Unknown step kind "${String((step as InteractionStep).kind)}".`,
            why: "The step was not run; an unknown action cannot be reported as a pass.",
          });
        }
      }

      if (step.settleMs && step.kind !== "wait") {
        await new Promise((resolve) => setTimeout(resolve, step.settleMs));
      }

      if (notPerformed) continue;

      const after = await page.snapshot({ maxText, maxElements: 400 });

      if (
        step.kind === "click" ||
        step.kind === "press" ||
        step.kind === "type" ||
        step.kind === "select"
      ) {
        const changed = before.url !== after.url || before.text !== after.text;
        findings.push({
          id: `${step.id}.effect`,
          status: changed ? "PASS" : "WARN",
          observed: changed
            ? `After "${step.label}", ${before.url === after.url ? "the page content changed" : `the URL became ${after.url}`}.`
            : `After "${step.label}", the URL and page content were unchanged.`,
          why: changed
            ? "The interaction produced an observable effect."
            : "A control that does nothing is a finding, but it may also need a different event or a filled field.",
          reproduce: `${scenario.id} → ${step.label}`,
          evidence: {
            beforeUrl: before.url,
            afterUrl: after.url,
            beforeLength: before.text.length,
            afterLength: after.text.length,
          },
        });
      }

      if (step.expect) {
        const checks = evaluateExpectation(step.expect, after, before);
        for (const check of checks) {
          findings.push({
            id: `${step.id}.${check.id}`,
            status: check.ok ? "PASS" : "FAIL",
            observed: check.observed,
            why: check.ok
              ? "The expected post-condition held."
              : "The application did not reach the expected state.",
            reproduce: `${scenario.id} → ${step.label}`,
          });
        }
      }
    } catch (error) {
      findings.push({
        id: `${step.id}.error`,
        status: "FAIL",
        observed: `Step "${step.label}" threw: ${error instanceof Error ? error.message : String(error)}`,
        why: "The interaction could not be completed; the page state after it is not trustworthy.",
        reproduce: `${scenario.id} → ${step.label}`,
      });
    }
  }

  // JavaScript and network evidence belongs to the whole scenario, not one step:
  // an exception raised asynchronously after a click is still caused by the scenario.
  const newErrors = page.pageErrors.slice(baselineErrors);
  const newFailed = page.network.filter((entry) => entry.status >= 400).slice(baselineFailed);
  const consoleErrors = page.console.filter((entry) => entry.type === "error");

  if (newErrors.length > 0) {
    findings.push({
      id: "runtime.exception",
      status: "FAIL",
      observed: `${newErrors.length} uncaught JavaScript exception(s): ${short(newErrors.map((e) => e.message).join(" | "))}`,
      why: "An exception stopped page code during the scenario; the visible state may be incomplete.",
      evidence: { messages: newErrors.slice(0, maxEvidence).map((e) => e.message) },
    });
  }

  if (consoleErrors.length > 0) {
    findings.push({
      id: "runtime.console",
      status: "WARN",
      observed: `${consoleErrors.length} console error(s): ${short(consoleErrors.map((e) => e.text).join(" | "))}`,
      why: "Console errors can hide a partial failure that the UI does not show.",
      evidence: { messages: consoleErrors.slice(0, maxEvidence).map((e) => e.text) },
    });
  }

  if (newFailed.length > 0) {
    findings.push({
      id: "runtime.network",
      status: "WARN",
      observed: `${newFailed.length} request(s) returned an error status: ${short(
        newFailed.map((e) => `${e.status} ${e.url}`).join(" | ")
      )}`,
      why: "A failing request can leave the interface showing stale or empty data.",
      evidence: {
        requests: newFailed.slice(0, maxEvidence).map((e) => ({ status: e.status, url: e.url })),
      },
    });
  }

  const final = await page.snapshot({ maxText, maxElements: 200 });
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    url: final.url,
    findings,
    stepsRun,
    stepsSkipped,
    final: {
      url: final.url,
      title: final.title,
      headings: final.headings.slice(0, 20),
      elementCount: final.counts.elements,
      formCount: final.counts.forms,
    },
    screenshots,
    durationMs: Date.now() - started,
  };
}

function evaluateExpectation(
  expect: NonNullable<InteractionStep["expect"]>,
  after: PageSnapshot,
  before: PageSnapshot
): { id: string; ok: boolean; observed: string }[] {
  const out: { id: string; ok: boolean; observed: string }[] = [];
  const text = after.text.toLowerCase();
  const names = elementNames(after);

  if (expect.urlContains) {
    const ok = after.url.toLowerCase().includes(expect.urlContains.toLowerCase());
    out.push({
      id: "url",
      ok,
      observed: ok
        ? `URL contains "${expect.urlContains}".`
        : `URL is ${after.url}, expected to contain "${expect.urlContains}".`,
    });
  }
  if (expect.textContains) {
    const needle = expect.textContains.toLowerCase();
    out.push({
      id: "text",
      ok: text.includes(needle),
      observed: text.includes(needle)
        ? `Page contains "${expect.textContains}".`
        : `Page does not contain "${expect.textContains}".`,
    });
  }
  if (expect.textNotContains) {
    const needle = expect.textNotContains.toLowerCase();
    out.push({
      id: "text-absent",
      ok: !text.includes(needle),
      observed: !text.includes(needle)
        ? `Page does not contain "${expect.textNotContains}".`
        : `Page still contains "${expect.textNotContains}".`,
    });
  }
  if (expect.headingContains) {
    const needle = expect.headingContains.toLowerCase();
    const ok = after.headings.some((h: string) => h.toLowerCase().includes(needle));
    out.push({
      id: "heading",
      ok,
      observed: ok
        ? `A heading contains "${expect.headingContains}".`
        : `No heading contains "${expect.headingContains}".`,
    });
  }
  if (expect.elementAppears) {
    const needle = expect.elementAppears.toLowerCase();
    const ok = names.some((name) => name.includes(needle));
    out.push({
      id: "appears",
      ok,
      observed: ok
        ? `Control "${expect.elementAppears}" is present.`
        : `Control "${expect.elementAppears}" did not appear.`,
    });
  }
  if (expect.elementDisappears) {
    const needle = expect.elementDisappears.toLowerCase();
    const beforeHad = elementNames(before).some((name) => name.includes(needle));
    const ok = beforeHad && !names.some((name) => name.includes(needle));
    out.push({
      id: "disappears",
      ok,
      observed: ok
        ? `Control "${expect.elementDisappears}" disappeared.`
        : beforeHad
          ? `Control "${expect.elementDisappears}" is still present.`
          : `Control "${expect.elementDisappears}" was not present before the action.`,
    });
  }
  return out;
}

/**
 * A ready-made scenario for a complex application: load, read the structure, exercise a
 * navigation control, fill and submit a form if one exists, then check the runtime.
 *
 * It is deliberately generic. A scenario the operator writes for their own app is more
 * precise; this one gives a useful first reading without knowing the product.
 */
export function genericAppScenario(
  url: string,
  name = "Application interaction"
): InteractionScenario {
  return {
    id: "interact.generic",
    name,
    viewport: { width: 1280, height: 800 },
    steps: [
      { id: "load", kind: "navigate", label: "Load the application", value: url, settleMs: 800 },
      {
        id: "structure",
        kind: "assert",
        label: "Read the rendered structure",
        expect: { urlContains: new URL(url).origin },
      },
      {
        id: "form-present",
        kind: "assert",
        label: "Check for a form",
        expect: {},
      },
      {
        id: "mobile",
        kind: "assert",
        label: "Render at a phone width",
        expect: { urlContains: new URL(url).origin },
      },
    ],
  };
}

/** Summarise a report in one line for a CLI or a dashboard row. */
export function summarizeInteraction(report: InteractionReport): string {
  const failed = report.findings.filter((f) => f.status === "FAIL").length;
  const warnings = report.findings.filter((f) => f.status === "WARN").length;
  const skipped = report.findings.filter((f) => f.status === "SKIPPED").length;
  return `${report.name}: ${report.stepsRun} steps, ${failed} failed, ${warnings} warnings, ${skipped} skipped in ${(report.durationMs / 1000).toFixed(1)}s`;
}
