import { describe, expect, it } from "vitest";
import {
  genericAppScenario,
  type InteractionScenario,
  runInteractionScenario,
  summarizeInteraction,
} from "../src/interaction.js";
import type { PageSnapshot } from "../src/page-script.js";
import type { BrowserPage } from "../src/session.js";

/**
 * Interaction engine tests.
 *
 * The CDP transport is exercised by the browser-render tests; here the page is a fake
 * that behaves like one, so the scenario logic is tested deterministically: a click that
 * changes the DOM, a click that does nothing, a missing control, a JavaScript exception
 * after an action, and the destructive-action gate.
 */

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://app.test/dashboard",
    title: "Dashboard",
    readyState: "complete",
    text: "Dashboard Welcome Save",
    headings: ["Dashboard"],
    links: [],
    elements: [
      { ref: "e1", tag: "button", name: "Save", role: "button", visible: true, enabled: true },
      { ref: "e2", tag: "input", name: "Email", role: "textbox", visible: true, enabled: true },
    ] as PageSnapshot["elements"],
    frames: [],
    scroll: { x: 0, y: 0, height: 1000, viewportHeight: 800 },
    active: null,
    alerts: [],
    counts: { elements: 2, links: 0, forms: 1, images: 0 },
    truncated: false,
    ...overrides,
  };
}

interface FakeOptions {
  /** Clicking "Save" changes the page, like a real submit. */
  saveWorks?: boolean;
  /** Throw on the first click. */
  clickThrows?: boolean;
  /** An exception appears after the action. */
  exceptionAfterClick?: string;
}

function fakePage(options: FakeOptions = {}): BrowserPage & { snapshots: number } {
  const state = {
    snapshots: 0,
    clicked: false,
    errors: [] as { message: string }[],
    console: [] as { type: string; text: string }[],
  };
  const page = {
    get snapshots() {
      return state.snapshots;
    },
    get pageErrors() {
      return state.errors;
    },
    get console() {
      return state.console;
    },
    get network() {
      return [] as { status: number; url: string }[];
    },
    async setViewport() {},
    async snapshot() {
      state.snapshots += 1;
      const changed = state.clicked && options.saveWorks;
      return snapshot({
        url: changed ? "https://app.test/saved" : "https://app.test/dashboard",
        text: changed ? "Dashboard Saved" : "Dashboard Welcome Save",
        headings: changed ? ["Saved"] : ["Dashboard"],
      });
    },
    async click() {
      if (options.clickThrows) throw new Error("element detached");
      state.clicked = true;
      if (options.exceptionAfterClick) state.errors.push({ message: options.exceptionAfterClick });
      return {};
    },
    async type() {
      return { typed: 1, value: "x", state: {} };
    },
    async press() {
      return {};
    },
    async select() {
      return { ok: true };
    },
    async scroll() {
      return {};
    },
    async waitFor() {
      return { matched: true, waitedMs: 0, url: "" };
    },
    async navigate() {
      return {};
    },
    async screenshot() {
      return { data: Buffer.from("png"), mimeType: "image/png", width: 1, height: 1 };
    },
  };
  return page as unknown as BrowserPage & { snapshots: number };
}

function scenario(steps: InteractionScenario["steps"]): InteractionScenario {
  return { id: "test.scenario", name: "Test scenario", steps };
}

describe("interaction scenario engine", () => {
  it("reports a click that changes the page as an effect", async () => {
    const page = fakePage({ saveWorks: true });
    const report = await runInteractionScenario(
      page,
      scenario([{ id: "save", kind: "click", label: "Save", target: "Save" }])
    );
    const effect = report.findings.find((f) => f.id === "save.effect");
    expect(effect?.status).toBe("PASS");
    expect(effect?.observed).toContain("/saved");
    expect(report.stepsRun).toBe(1);
  });

  it("reports a click that does nothing as a warning, never a pass", async () => {
    const page = fakePage({ saveWorks: false });
    const report = await runInteractionScenario(
      page,
      scenario([{ id: "save", kind: "click", label: "Save", target: "Save" }])
    );
    const effect = report.findings.find((f) => f.id === "save.effect");
    expect(effect?.status).toBe("WARN");
    expect(effect?.observed).toContain("unchanged");
  });

  it("skips a click whose control is absent instead of claiming it worked", async () => {
    const page = fakePage();
    const report = await runInteractionScenario(
      page,
      scenario([{ id: "ghost", kind: "click", label: "Ghost", target: "Nonexistent control" }])
    );
    const finding = report.findings.find((f) => f.id === "ghost.missing");
    expect(finding?.status).toBe("SKIPPED");
    expect(report.findings.some((f) => f.id === "ghost.effect")).toBe(false);
  });

  it("evaluates post-conditions against the state after the action", async () => {
    const page = fakePage({ saveWorks: true });
    const report = await runInteractionScenario(
      page,
      scenario([
        { id: "save", kind: "click", label: "Save", target: "Save" },
        {
          id: "check",
          kind: "assert",
          label: "Check saved",
          expect: { urlContains: "/saved", textContains: "Saved" },
        },
      ])
    );
    expect(report.findings.find((f) => f.id === "check.url")?.status).toBe("PASS");
    expect(report.findings.find((f) => f.id === "check.text")?.status).toBe("PASS");
  });

  it("fails an expectation that does not hold", async () => {
    const page = fakePage({ saveWorks: false });
    const report = await runInteractionScenario(
      page,
      scenario([
        { id: "save", kind: "click", label: "Save", target: "Save" },
        { id: "check", kind: "assert", label: "Check saved", expect: { textContains: "Saved" } },
      ])
    );
    expect(report.findings.find((f) => f.id === "check.text")?.status).toBe("FAIL");
  });

  it("reports a JavaScript exception raised after an interaction", async () => {
    const page = fakePage({ saveWorks: true, exceptionAfterClick: "TypeError: boom" });
    const report = await runInteractionScenario(
      page,
      scenario([{ id: "save", kind: "click", label: "Save", target: "Save" }])
    );
    const finding = report.findings.find((f) => f.id === "runtime.exception");
    expect(finding?.status).toBe("FAIL");
    expect(finding?.observed).toContain("TypeError: boom");
  });

  it("does not run destructive steps without an explicit opt-in", async () => {
    const page = fakePage({ saveWorks: true });
    const steps: InteractionScenario["steps"] = [
      { id: "pay", kind: "click", label: "Pay", target: "Save", destructive: true },
    ];
    const report = await runInteractionScenario(page, scenario(steps));
    expect(report.stepsSkipped).toBe(1);
    expect(report.stepsRun).toBe(0);
    expect(report.findings[0]?.status).toBe("SKIPPED");

    const allowed = await runInteractionScenario(page, scenario(steps), { allowDestructive: true });
    expect(allowed.stepsRun).toBe(1);
  });

  it("reports a step that throws as a failure with the error text", async () => {
    const page = fakePage({ clickThrows: true });
    const report = await runInteractionScenario(
      page,
      scenario([{ id: "save", kind: "click", label: "Save", target: "Save" }])
    );
    expect(report.findings.find((f) => f.id === "save.error")?.observed).toContain(
      "element detached"
    );
  });

  it("captures screenshots only when a step asks for one", async () => {
    const page = fakePage();
    const report = await runInteractionScenario(
      page,
      scenario([{ id: "shot", kind: "screenshot", label: "Capture" }])
    );
    expect(report.screenshots).toHaveLength(1);
    expect(report.screenshots[0]?.data).toBe("cG5n");
  });

  it("caps the evidence it keeps", async () => {
    const page = fakePage({ exceptionAfterClick: "x".repeat(500) });
    const report = await runInteractionScenario(
      page,
      scenario([{ id: "save", kind: "click", label: "Save", target: "Save" }]),
      { maxEvidence: 2 }
    );
    const finding = report.findings.find((f) => f.id === "runtime.exception");
    const messages = finding?.evidence?.messages;
    expect(Array.isArray(messages) ? messages.length : 0).toBeLessThanOrEqual(2);
  });

  it("summarises a report in one readable line", async () => {
    const page = fakePage({ saveWorks: true });
    const report = await runInteractionScenario(page, genericAppScenario("https://app.test/"));
    expect(summarizeInteraction(report)).toMatch(/steps, \d+ failed/);
  });
});
