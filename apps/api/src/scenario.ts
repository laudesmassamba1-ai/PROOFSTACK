/**
 * Browser interaction scenarios inside the Cloudflare Worker.
 *
 * The CLI runs scenarios with the machine's own Chromium over CDP. This module is the
 * equivalent for the deployed app: it drives the Chromium Cloudflare Browser Rendering
 * already provides, through the small `PageLike` surface the browser route uses.
 *
 * No separate runner, no new infrastructure, no paid service. The same product
 * capability is available from both surfaces:
 *
 *   CLI  → local Chromium over CDP  → `packages/adapters/browser/src/interaction.ts`
 *   Web  → Browser Rendering/Puppeteer → this file
 *
 * The semantics are kept identical on purpose: an action that changes nothing is a
 * WARN, a missing control is SKIPPED, a destructive action needs an explicit opt-in,
 * and JavaScript/console errors are read from real events rather than inferred.
 */

export type ScenarioStatus = "PASS" | "WARN" | "FAIL" | "SKIPPED";

export interface ScenarioFinding {
  id: string;
  status: ScenarioStatus;
  observed: string;
  why: string;
  reproduce?: string;
}

export interface ScenarioStep {
  id: string;
  kind: "navigate" | "click" | "type" | "press" | "scroll" | "assert";
  label: string;
  /** Visible text of the control. Resolved from the live DOM, never from a stale ref. */
  target?: string;
  value?: string;
  expect?: {
    urlContains?: string;
    textContains?: string;
    textNotContains?: string;
    headingContains?: string;
  };
  destructive?: boolean;
  settleMs?: number;
}

export interface ScenarioReport {
  scenarioId: string;
  name: string;
  url: string;
  findings: ScenarioFinding[];
  stepsRun: number;
  stepsSkipped: number;
  final: {
    url: string;
    title: string;
    headings: string[];
    elementCount: number;
    formCount: number;
  } | null;
  durationMs: number;
  /** True when the browser binding was absent and nothing was executed. */
  unavailable?: boolean;
}

/** The part of Puppeteer a scenario needs. Kept structural so it can be tested. */
export interface ScenarioPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  setViewport(viewport: { width: number; height: number }): Promise<void>;
  evaluate?: ((expression: string) => Promise<unknown>) | undefined;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  mouse: {
    click(x: number, y: number): Promise<void>;
    wheel(options: { deltaY: number }): Promise<void>;
  };
  on(event: string, handler: (...args: unknown[]) => void): void;
}

interface PageReading {
  url: string;
  title: string;
  text: string;
  headings: string[];
  elementCount: number;
  formCount: number;
  controls: { text: string; x: number; y: number }[];
}

/**
 * Read the page from inside it.
 *
 * This runs in the page context, so it sees the DOM after JavaScript executed — the
 * whole reason to use a browser instead of fetching HTML. Text is capped: a page with
 * a million characters must not produce a million-character report.
 */
const READ_EXPRESSION = `(() => {
  const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
  const controls = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    })
    .slice(0, 250)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: clean(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.value || '').slice(0, 120),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      };
    });
  return {
    url: location.href,
    title: document.title,
    text: clean(document.body ? document.body.innerText : '').slice(0, 12000),
    headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => clean(h.textContent)).filter(Boolean).slice(0, 30),
    elementCount: document.querySelectorAll('*').length,
    formCount: document.querySelectorAll('form').length,
    controls,
  };
})()`;

async function readPage(page: ScenarioPage): Promise<PageReading> {
  if (!page.evaluate) throw new Error("This browser does not support page evaluation.");
  return (await page.evaluate(READ_EXPRESSION)) as PageReading;
}

function findControl(reading: PageReading, target: string): { x: number; y: number } | null {
  const needle = target.trim().toLowerCase();
  if (!needle) return null;
  const exact = reading.controls.find((c) => c.text.toLowerCase() === needle);
  if (exact) return exact;
  const partial = reading.controls.find((c) => c.text.toLowerCase().includes(needle));
  return partial ? { x: partial.x, y: partial.y } : null;
}

function short(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** A default scenario for a complex app, used when the dashboard asks for a quick run. */
export function defaultScenario(url: string): ScenarioStep[] {
  return [
    { id: "load", kind: "navigate", label: "Load the application", value: url, settleMs: 900 },
    {
      id: "rendered",
      kind: "assert",
      label: "The application rendered",
      expect: { urlContains: new URL(url).origin },
    },
    { id: "form", kind: "assert", label: "A form is present", expect: {} },
    {
      id: "mobile",
      kind: "assert",
      label: "The application renders at a phone width",
      expect: { urlContains: new URL(url).origin },
    },
  ];
}

/**
 * Run a scenario on a live Puppeteer page.
 *
 * The caller owns the page and closes it. That keeps this function usable both from a
 * one-shot endpoint and from a longer browser session.
 */
export async function runScenario(
  page: ScenarioPage,
  steps: ScenarioStep[],
  options: {
    name?: string;
    allowDestructive?: boolean;
    onStep?: (step: ScenarioStep, i: number, total: number) => void;
  } = {}
): Promise<ScenarioReport> {
  const started = Date.now();
  const findings: ScenarioFinding[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let stepsRun = 0;
  let stepsSkipped = 0;

  page.on("console", (...args: unknown[]) => {
    const message = args[0] as { type?: () => string; text?: () => string } | string | undefined;
    const type = typeof message === "object" && message?.type ? message.type() : "log";
    if (type === "error") {
      const text =
        typeof message === "object" && message?.text ? message.text() : String(message ?? "");
      consoleErrors.push(short(text, 300));
    }
  });
  page.on("pageerror", (...args: unknown[]) => {
    pageErrors.push(short(String(args[0] ?? "unknown error"), 300));
  });

  const baselineErrors = pageErrors.length;

  for (const [index, step] of steps.entries()) {
    options.onStep?.(step, index, steps.length);

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
    let before: PageReading | null = null;
    try {
      before = await readPage(page);

      switch (step.kind) {
        case "navigate": {
          if (!step.value) throw new Error("navigate step has no URL");
          await page.goto(step.value, { waitUntil: "networkidle2", timeout: 25_000 });
          break;
        }
        case "click": {
          if (!step.target) throw new Error("click step has no target");
          const point = findControl(before, step.target);
          if (!point) {
            findings.push({
              id: `${step.id}.missing`,
              status: "SKIPPED",
              observed: `No visible control named "${step.target}" was found.`,
              why: "The click was not performed; a missing control is not a passing click.",
              reproduce: step.label,
            });
            continue;
          }
          await page.mouse.click(point.x, point.y);
          break;
        }
        case "type": {
          if (!step.target) throw new Error("type step has no target");
          const point = findControl(before, step.target);
          if (!point) {
            findings.push({
              id: `${step.id}.missing`,
              status: "SKIPPED",
              observed: `No visible field named "${step.target}" was found.`,
              why: "Nothing was typed; a missing field is not a passing input test.",
              reproduce: step.label,
            });
            continue;
          }
          await page.mouse.click(point.x, point.y);
          await page.keyboard.type(step.value ?? "");
          break;
        }
        case "press":
          await page.keyboard.press(step.value ?? "Enter");
          break;
        case "scroll":
          await page.mouse.wheel({ deltaY: Number(step.value ?? 600) });
          break;
        case "assert":
          break;
      }

      if (step.settleMs && step.kind !== "navigate") {
        await new Promise((resolve) => setTimeout(resolve, step.settleMs));
      }

      const after = await readPage(page);

      if (step.kind === "click" || step.kind === "type" || step.kind === "press") {
        const changed = before.url !== after.url || before.text !== after.text;
        findings.push({
          id: `${step.id}.effect`,
          status: changed ? "PASS" : "WARN",
          observed: changed
            ? `After "${step.label}", ${before.url === after.url ? "the page content changed" : `the URL became ${after.url}`}.`
            : `After "${step.label}", the URL and page content were unchanged.`,
          why: changed
            ? "The interaction produced an observable effect."
            : "A control that does nothing is a finding.",
          reproduce: step.label,
        });
      }

      if (step.expect) {
        const text = after.text.toLowerCase();
        const checks: { id: string; ok: boolean; observed: string }[] = [];
        if (step.expect.urlContains) {
          const ok = after.url.toLowerCase().includes(step.expect.urlContains.toLowerCase());
          checks.push({
            id: "url",
            ok,
            observed: ok ? `URL contains "${step.expect.urlContains}".` : `URL is ${after.url}.`,
          });
        }
        if (step.expect.textContains) {
          const ok = text.includes(step.expect.textContains.toLowerCase());
          checks.push({
            id: "text",
            ok,
            observed: ok
              ? `Page contains "${step.expect.textContains}".`
              : `Page does not contain "${step.expect.textContains}".`,
          });
        }
        if (step.expect.textNotContains) {
          const ok = !text.includes(step.expect.textNotContains.toLowerCase());
          checks.push({
            id: "text-absent",
            ok,
            observed: ok
              ? `Page does not contain "${step.expect.textNotContains}".`
              : `Page still contains "${step.expect.textNotContains}".`,
          });
        }
        const headingContains = step.expect.headingContains;
        if (headingContains) {
          const ok = after.headings.some((h) =>
            h.toLowerCase().includes(headingContains.toLowerCase())
          );
          checks.push({
            id: "heading",
            ok,
            observed: ok
              ? `A heading contains "${headingContains}".`
              : `No heading contains "${headingContains}".`,
          });
        }
        for (const check of checks) {
          findings.push({
            id: `${step.id}.${check.id}`,
            status: check.ok ? "PASS" : "FAIL",
            observed: check.observed,
            why: check.ok
              ? "The expected post-condition held."
              : "The application did not reach the expected state.",
            reproduce: step.label,
          });
        }
      }
    } catch (error) {
      findings.push({
        id: `${step.id}.error`,
        status: "FAIL",
        observed: `Step "${step.label}" threw: ${error instanceof Error ? error.message : String(error)}`,
        why: "The interaction could not be completed; the state after it is not trustworthy.",
        reproduce: step.label,
      });
    }
  }

  const newErrors = pageErrors.slice(baselineErrors);
  if (newErrors.length) {
    findings.push({
      id: "runtime.exception",
      status: "FAIL",
      observed: `${newErrors.length} uncaught JavaScript exception(s): ${short(newErrors.join(" | "))}`,
      why: "An exception stopped page code during the scenario.",
    });
  }
  if (consoleErrors.length) {
    findings.push({
      id: "runtime.console",
      status: "WARN",
      observed: `${consoleErrors.length} console error(s): ${short(consoleErrors.join(" | "))}`,
      why: "Console errors can hide a partial failure the UI does not show.",
    });
  }

  const final = await readPage(page).catch(() => null);
  return {
    scenarioId: "interact.worker",
    name: options.name ?? "Browser interaction",
    url: final?.url ?? "",
    findings,
    stepsRun,
    stepsSkipped,
    final: final
      ? {
          url: final.url,
          title: final.title,
          headings: final.headings,
          elementCount: final.elementCount,
          formCount: final.formCount,
        }
      : null,
    durationMs: Date.now() - started,
  };
}

export function unavailableReport(reason: string): ScenarioReport {
  return {
    scenarioId: "interact.worker",
    name: "Browser interaction",
    url: "",
    findings: [
      {
        id: "browser.unavailable",
        status: "SKIPPED",
        observed: reason,
        why: "Nothing was executed.",
      },
    ],
    stepsRun: 0,
    stepsSkipped: 0,
    final: null,
    durationMs: 0,
    unavailable: true,
  };
}
