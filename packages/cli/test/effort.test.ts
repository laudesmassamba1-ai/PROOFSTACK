import { describe, expect, it } from "vitest";
import { EFFORT_LEVELS, effortProfile, parseEffort, subagentPrompt } from "../src/effort.js";

describe("effortProfile", () => {
  it("never promises fewer than two subagents above low effort", () => {
    expect(effortProfile("medium").subagents).toBeGreaterThanOrEqual(2);
    expect(effortProfile("high").subagents).toBeGreaterThan(effortProfile("medium").subagents);
  });

  it("spends more steps as effort rises — effort is paid in tokens, not in promises", () => {
    expect(effortProfile("high").maxSteps).toBeGreaterThan(effortProfile("medium").maxSteps);
    expect(effortProfile("medium").maxSteps).toBeGreaterThan(effortProfile("low").maxSteps);
  });

  it("low effort disables subagents entirely", () => {
    expect(effortProfile("low").subagents).toBe(0);
    expect(subagentPrompt(effortProfile("low"))).toContain("désactivés");
  });
});

describe("subagentPrompt", () => {
  it("names the minimum the product promises, in words the model can follow", () => {
    const prompt = subagentPrompt(effortProfile("medium"));
    expect(prompt).toContain("au minimum 2 sous-agents");
    expect(prompt).toContain("relecture");
  });

  it("tightens verification as effort rises", () => {
    // Deep effort is the only level that asks the model to declare what it could not verify;
    // low effort spends no subagent at all, so the two prompts must differ in kind.
    expect(subagentPrompt(effortProfile("high"))).toContain("n'as pas pu vérifier");
    expect(subagentPrompt(effortProfile("low"))).toContain("sous-agents sont désactivés");
  });
});

describe("parseEffort", () => {
  it("reads the three levels and falls back to medium", () => {
    for (const level of EFFORT_LEVELS) expect(parseEffort(level)).toBe(level);
    expect(parseEffort("HIGH")).toBe("high");
    expect(parseEffort(undefined)).toBe("medium");
    expect(parseEffort("turbo")).toBe("medium");
  });
});
