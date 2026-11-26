import { describe, expect, it } from "vitest";
import {
  advanceRemediation,
  buildFinding,
  canTransitionRemediation,
  nextRemediationStep,
  REMEDIATION_STEPS,
  seedRemediation,
  verificationOutcome,
} from "../src/index.js";

const at = "2026-01-01T00:00:00.000Z";

function finding(status: "PASS" | "FAIL" | "SKIPPED" = "FAIL") {
  return buildFinding({
    analysisId: "ana_1",
    module: "fail",
    controlId: "hsts",
    status,
    observed: "Strict-Transport-Security absent",
    url: "https://shop.example/",
    detectedAt: at,
  });
}

describe("remediation lifecycle", () => {
  it("does not jump from proposed to applied or from verified back to proposed", () => {
    expect(canTransitionRemediation("proposed", "approved")).toBe(true);
    expect(canTransitionRemediation("proposed", "applied")).toBe(false);
    expect(canTransitionRemediation("applied", "verified")).toBe(true);
    expect(canTransitionRemediation("verified", "proposed")).toBe(false);
    expect(canTransitionRemediation("failed", "proposed")).toBe(true);
  });

  it("advances the chain one step at a time", () => {
    const steps = advanceRemediation([], "read_finding", { at });
    expect(steps).toHaveLength(1);
    expect(nextRemediationStep(steps)).toBe("verify_evidence");
    expect(() => advanceRemediation(steps, "preview", { at })).toThrow(/cannot follow/);
    const next = advanceRemediation(steps, "verify_evidence", { at, evidence: "GET /" });
    expect(next.at(-1)?.evidence).toBe("GET /");
  });

  it("treats a repeated step as a no-op so a retry is safe", () => {
    const steps = advanceRemediation([], "read_finding", { at });
    expect(advanceRemediation(steps, "read_finding", { at: "later" })).toEqual(steps);
  });

  it("returns no next step once the chain is complete", () => {
    let steps: ReturnType<typeof advanceRemediation> = [];
    for (const step of REMEDIATION_STEPS) steps = advanceRemediation(steps, step, { at });
    expect(steps).toHaveLength(10);
    expect(nextRemediationStep(steps)).toBeNull();
  });
});

describe("remediation seed", () => {
  it("carries the fix and the verification from the control registry", () => {
    const seed = seedRemediation(finding(), at);
    expect(seed.findingKey).toBe("fail:hsts@https://shop.example/");
    expect(seed.fix.length).toBeGreaterThan(10);
    expect(seed.verification.length).toBeGreaterThan(10);
    expect(seed.steps.map((step) => step.step)).toEqual([
      "read_finding",
      "verify_evidence",
      "gather_context",
    ]);
  });
});

describe("verification verdicts", () => {
  it("verifies only a passed re-measurement", () => {
    expect(verificationOutcome(finding("PASS")).outcome).toBe("verified");
    expect(verificationOutcome(finding("FAIL")).outcome).toBe("still_failing");
    expect(verificationOutcome(finding("SKIPPED")).outcome).toBe("inconclusive");
    expect(verificationOutcome(undefined).outcome).toBe("inconclusive");
  });

  it("will not let a skipped control close a remediation", () => {
    const verdict = verificationOutcome(finding("SKIPPED"));
    expect(verdict.outcome).toBe("inconclusive");
    expect(verdict.reason).toContain("SKIPPED");
  });
});
