import { aggregateStatus, type TestCaseResult } from "@proofcore/contracts";
import { describe, expect, it } from "vitest";
import { exitCodeFor, renderReport, runTotals } from "../src/index.js";
import { makeRun } from "./fixtures.js";

/**
 * BLOCKED, NOT_APPLICABLE and NOT_CONFIGURED exist so that a check which answered nothing
 * cannot be read as a pass. These tests hold the whole chain to that: aggregation, counts,
 * exit code, and the three report formats.
 */

function withStatus(status: TestCaseResult["status"], reason?: string) {
  const run = makeRun();
  const moduleRun = run.moduleRuns[0];
  if (!moduleRun) throw new Error("fixture has no module run");
  const testCase = moduleRun.cases[0];
  if (!testCase) throw new Error("fixture has no case");
  testCase.status = status;
  if (reason !== undefined) testCase.skippedReason = reason;
  moduleRun.totals = {
    ...moduleRun.totals,
    passed: status === "PASSED" ? 1 : 0,
    skipped: status === "SKIPPED" ? 1 : 0,
    blocked: status === "BLOCKED" ? 1 : 0,
    notApplicable: status === "NOT_APPLICABLE" ? 1 : 0,
    notConfigured: status === "NOT_CONFIGURED" ? 1 : 0,
  };
  moduleRun.status = aggregateStatus([status]);
  run.status = aggregateStatus([status]);
  return run;
}

describe("statuses that answer nothing", () => {
  it("never lets a blocked case become a passed run", () => {
    // Nothing was judged, so the run verified nothing — and a case that did run keeps it
    // out of COMPLETED, because part of the question went unanswered.
    expect(aggregateStatus(["BLOCKED"])).toBe("NOTHING_VERIFIED");
    expect(aggregateStatus(["NOT_CONFIGURED"])).toBe("NOTHING_VERIFIED");
    expect(aggregateStatus(["PASSED", "BLOCKED"])).toBe("PARTIAL");
  });

  it("treats not-applicable as an answer, not as an unverified run", () => {
    // A product with no print styles because it has no pages is not failing anything.
    // But a run made only of not-applicable cases proved nothing either.
    expect(aggregateStatus(["NOT_APPLICABLE"])).toBe("NOTHING_VERIFIED");
    expect(aggregateStatus(["PASSED", "NOT_APPLICABLE"])).toBe("COMPLETED");
  });

  it("keeps a blocked or unconfigured run out of a green CI gate", () => {
    expect(exitCodeFor(withStatus("BLOCKED", "no browser available"))).toBe(2);
    expect(exitCodeFor(withStatus("NOT_CONFIGURED", "no export format declared"))).toBe(2);
  });

  it("does not fail a gate for a question that does not apply", () => {
    // A pass plus a not-applicable check is a verified run: the case that mattered ran.
    const mixed = withStatus("NOT_APPLICABLE", "no cookie set");
    const moduleRun = mixed.moduleRuns[0];
    if (!moduleRun) throw new Error("fixture has no module run");
    const first = moduleRun.cases[0];
    if (!first) throw new Error("fixture has no case");
    moduleRun.cases = [
      { ...first, id: "world.identity.accept", status: "PASSED" },
      { ...first, id: "exit.print_styles", status: "NOT_APPLICABLE" },
    ];
    moduleRun.totals = { ...moduleRun.totals, total: 2, passed: 1, notApplicable: 1 };
    moduleRun.status = aggregateStatus(["PASSED", "NOT_APPLICABLE"]);
    mixed.status = "COMPLETED";
    expect(exitCodeFor(mixed)).toBe(0);
  });

  it("counts the three statuses separately instead of folding them into skipped", () => {
    const run = withStatus("BLOCKED", "no browser");
    const totals = runTotals(run);
    expect(totals.blocked).toBe(1);
    expect(totals.skipped).toBe(0);
    expect(totals.passed).toBe(0);
  });

  it("names the status and the reason in the JUnit report instead of a pass", () => {
    const run = withStatus("BLOCKED", "no browser available");
    const junit = renderReport(run, "junit");
    expect(junit).toContain("<skipped");
    expect(junit).toContain("BLOCKED: no browser available");
    expect(junit).not.toContain("<failure");
  });

  it("shows the reason in the text report", () => {
    const run = withStatus("NOT_CONFIGURED", "aucun format d'export déclaré");
    const text = renderReport(run, "text");
    expect(text).toContain("CFG");
    expect(text).toContain("not configured: aucun format d'export déclaré");
    expect(text).toContain("1 not configured");
  });
});
