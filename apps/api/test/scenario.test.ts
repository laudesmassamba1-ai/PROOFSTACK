import { describe, expect, it } from "vitest";
import {
  defaultScenario,
  runScenario,
  type ScenarioPage,
  type ScenarioStep,
  unavailableReport,
} from "../src/scenario.js";

/**
 * Worker scenario engine tests.
 *
 * The Puppeteer binding cannot exist in a unit test, so the page is a fake that behaves
 * like one. What is asserted is the scenario logic: honest verdicts, no inferred passes,
 * the destructive gate, and real console/page-error events.
 */

function makePage(reading: { text?: string; url?: string; formCount?: number } = {}) {
  const state = {
    url: reading.url ?? "https://app.test/dashboard",
    text: reading.text ?? "Dashboard Welcome Save",
    formCount: reading.formCount ?? 1,
    clicks: 0,
    handlers: new Map<string, ((...args: unknown[]) => void)[]>(),
    viewport: { width: 0, height: 0 },
  };

  const page: ScenarioPage = {
    async goto(url: string) {
      state.url = url;
    },
    async title() {
      return "Dashboard";
    },
    url() {
      return state.url;
    },
    async setViewport(v) {
      state.viewport = v;
    },
    evaluate: async () => ({
      url: state.url,
      title: "Dashboard",
      text: state.text,
      headings: ["Dashboard"],
      elementCount: 42,
      formCount: state.formCount,
      controls: [{ text: "Save", x: 10, y: 20 }],
    }),
    keyboard: {
      async press() {},
      async type() {},
    },
    mouse: {
      async click() {
        state.clicks += 1;
      },
      async wheel() {},
    },
    on(event, handler) {
      const list = state.handlers.get(event) ?? [];
      list.push(handler);
      state.handlers.set(event, list);
    },
  };

  return { page, state };
}

function steps(list: ScenarioStep[]): ScenarioStep[] {
  return list;
}

describe("worker scenario engine", () => {
  it("marks an effect as PASS when the DOM changes", async () => {
    const { page, state } = makePage();
    const report = await runScenario(
      page,
      steps([{ id: "save", kind: "click", label: "Save", target: "Save" }])
    );
    // The fake does not change the DOM on click, so the honest verdict is WARN.
    expect(report.findings.find((f) => f.id === "save.effect")?.status).toBe("WARN");
    expect(state.clicks).toBe(1);
  });

  it("skips a missing control rather than reporting a pass", async () => {
    const { page } = makePage();
    const report = await runScenario(
      page,
      steps([{ id: "ghost", kind: "click", label: "Ghost", target: "Does not exist" }])
    );
    expect(report.findings.find((f) => f.id === "ghost.missing")?.status).toBe("SKIPPED");
    expect(report.findings.some((f) => f.id === "ghost.effect")).toBe(false);
  });

  it("evaluates expectations against the live reading", async () => {
    const { page } = makePage();
    const report = await runScenario(
      page,
      steps([
        {
          id: "check",
          kind: "assert",
          label: "Check",
          expect: { urlContains: "app.test", textContains: "Welcome" },
        },
      ])
    );
    expect(report.findings.find((f) => f.id === "check.url")?.status).toBe("PASS");
    expect(report.findings.find((f) => f.id === "check.text")?.status).toBe("PASS");
  });

  it("fails an expectation that does not hold", async () => {
    const { page } = makePage();
    const report = await runScenario(
      page,
      steps([{ id: "check", kind: "assert", label: "Check", expect: { textContains: "Absent" } }])
    );
    expect(report.findings.find((f) => f.id === "check.text")?.status).toBe("FAIL");
  });

  it("does not run destructive steps without the opt-in", async () => {
    const { page, state } = makePage();
    const list = steps([
      { id: "pay", kind: "click", label: "Pay", target: "Save", destructive: true },
    ]);
    const skipped = await runScenario(page, list);
    expect(skipped.stepsSkipped).toBe(1);
    expect(state.clicks).toBe(0);

    const allowed = await runScenario(page, list, { allowDestructive: true });
    expect(allowed.stepsRun).toBe(1);
    expect(state.clicks).toBe(1);
  });

  it("records real page errors from the event stream", async () => {
    const { page, state } = makePage();
    const original = page.evaluate;
    if (!original) throw new Error("the fake page must expose evaluate");
    page.evaluate = async (expression: string) => {
      // The handlers are registered at the start of runScenario; fire only now.
      state.handlers.get("pageerror")?.[0]?.("TypeError: boom");
      return original(expression);
    };
    const report = await runScenario(
      page,
      steps([{ id: "load", kind: "navigate", label: "Load", value: "https://app.test/" }])
    );
    expect(report.findings.find((f) => f.id === "runtime.exception")?.observed).toContain(
      "TypeError: boom"
    );
  });

  it("records console errors as warnings", async () => {
    const { page, state } = makePage();
    const original = page.evaluate;
    if (!original) throw new Error("the fake page must expose evaluate");
    page.evaluate = async (expression: string) => {
      state.handlers.get("console")?.[0]?.({ type: () => "error", text: () => "failed to load" });
      return original(expression);
    };
    const report = await runScenario(
      page,
      steps([{ id: "load", kind: "navigate", label: "Load", value: "https://app.test/" }])
    );
    expect(report.findings.find((f) => f.id === "runtime.console")?.status).toBe("WARN");
  });

  it("reports a step that throws", async () => {
    const { page } = makePage();
    page.evaluate = async () => {
      throw new Error("page closed");
    };
    const report = await runScenario(
      page,
      steps([{ id: "load", kind: "navigate", label: "Load", value: "https://app.test/" }])
    );
    expect(report.findings.some((f) => f.status === "FAIL")).toBe(true);
  });

  it("builds a default scenario with a phone-width render", async () => {
    const { page } = makePage();
    const report = await runScenario(page, defaultScenario("https://app.test/"));
    expect(report.stepsRun).toBe(4);
    expect(report.final?.url).toBe("https://app.test/");
  });

  it("reports unavailability honestly instead of returning an empty success", () => {
    const report = unavailableReport("no binding");
    expect(report.unavailable).toBe(true);
    expect(report.findings[0]?.status).toBe("SKIPPED");
  });
});
