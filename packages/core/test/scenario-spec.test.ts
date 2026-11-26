import { describe, expect, it } from "vitest";
import { validateFlowScenario } from "../src/scenario-spec.js";

const base = {
  name: "Parcours d'achat",
  target: "https://example.com/",
  steps: [
    { id: "open", kind: "navigate", label: "Ouvrir", value: "https://example.com/" },
    { id: "click", kind: "click", label: "Cliquer sur Acheter", target: "Acheter" },
    { id: "check", kind: "assert", label: "Le panier s'ouvre", expect: { urlContains: "/cart" } },
  ],
};

describe("validateFlowScenario", () => {
  it("accepts a scenario the runner can execute and normalises its text", () => {
    const result = validateFlowScenario({
      ...base,
      name: "  Parcours d'achat  ",
      steps: [
        { id: "open", kind: "navigate", label: " Ouvrir ", value: "https://example.com" },
        ...base.steps.slice(1),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.name).toBe("Parcours d'achat");
    expect(result.scenario.target).toBe("https://example.com/");
    expect(result.scenario.steps[0]?.label).toBe("Ouvrir");
    expect(result.scenario.steps[0]?.value).toBe("https://example.com/");
  });

  it("refuses a click without a target instead of guessing the control", () => {
    const result = validateFlowScenario({
      ...base,
      steps: [{ id: "click", kind: "click", label: "Cliquer" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([expect.objectContaining({ step: 0, code: "missing_target" })]);
  });

  it("refuses an assertion that cannot fail", () => {
    const result = validateFlowScenario({
      ...base,
      steps: [{ id: "check", kind: "assert", label: "Tout va bien" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("empty_expectation");
  });

  it("refuses a target that is not a full http(s) address", () => {
    for (const target of ["", "example.com", "ftp://example.com", "javascript:alert(1)"]) {
      const result = validateFlowScenario({ ...base, target });
      expect(result.ok, target).toBe(false);
    }
  });

  it("reports duplicate ids and caps the number of steps", () => {
    const duplicate = validateFlowScenario({
      ...base,
      steps: [
        { id: "same", kind: "press", label: "Entrée", value: "Enter" },
        { id: "same", kind: "press", label: "Échap", value: "Escape" },
      ],
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.issues.map((issue) => issue.code)).toContain("duplicate_id");

    const many = validateFlowScenario({
      ...base,
      steps: Array.from({ length: 21 }, (_, index) => ({
        id: `s${index}`,
        kind: "press",
        label: "Entrée",
        value: "Enter",
      })),
    });
    expect(many.ok).toBe(false);
    if (many.ok) return;
    expect(many.issues.map((issue) => issue.code)).toContain("too_many_steps");
  });

  it("keeps a destructive step, so the runner decides rather than the editor", () => {
    const result = validateFlowScenario({
      ...base,
      steps: [{ id: "pay", kind: "click", label: "Payer", target: "Payer", destructive: true }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.steps[0]?.destructive).toBe(true);
  });

  it("bounds the settle delay instead of trusting the client", () => {
    const result = validateFlowScenario({
      ...base,
      steps: [{ id: "wait", kind: "scroll", label: "Défiler", value: "600", settleMs: 999_999 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.steps[0]?.settleMs).toBe(10_000);
  });
});
