import { describe, expect, it } from "vitest";
import {
  analysisDurationMs,
  canTransitionAnalysis,
  coverageLabel,
  coverageRatio,
  emptyCoverage,
  outcomeStatus,
} from "../src/analysis.js";

describe("analysis lifecycle", () => {
  it("lets an execution finish but never restart", () => {
    expect(canTransitionAnalysis("queued", "running")).toBe(true);
    expect(canTransitionAnalysis("running", "completed")).toBe(true);
    expect(canTransitionAnalysis("running", "partial")).toBe(true);
    expect(canTransitionAnalysis("completed", "running")).toBe(false);
    expect(canTransitionAnalysis("cancelled", "running")).toBe(false);
    // A retried PATCH that resends the current status is a no-op, not a conflict.
    expect(canTransitionAnalysis("failed", "failed")).toBe(true);
  });

  it("measures coverage against what was applicable, not what was asked", () => {
    const coverage = {
      ...emptyCoverage(["world", "flow", "exit", "fail"]),
      applicableModules: ["world", "flow"],
      measuredModules: ["world"],
    };
    expect(coverageRatio(coverage)).toBe(0.5);
    expect(coverageLabel(coverage)).toBe("partial");
    expect(coverageRatio(emptyCoverage([]))).toBe(0);
    expect(coverageLabel(emptyCoverage([]))).toBe("none");
  });

  it("calls a run complete only when nothing applicable was skipped", () => {
    const base = { ...emptyCoverage(["world"]), measuredModules: ["world"] };
    expect(outcomeStatus({ coverage: base })).toBe("completed");
    expect(
      outcomeStatus({ coverage: { ...base, skipped: [{ module: "flow", reason: "no form" }] } })
    ).toBe("partial");
    // A crawl that discovered more pages than it read is partial even with no skip entry.
    expect(outcomeStatus({ coverage: { ...base, pages: { discovered: 40, scanned: 12 } } })).toBe(
      "partial"
    );
    expect(outcomeStatus({ error: "boom", coverage: base })).toBe("failed");
    expect(outcomeStatus({ cancelled: true, coverage: base })).toBe("cancelled");
  });

  it("never reports a negative or NaN duration", () => {
    expect(analysisDurationMs("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:02.000Z")).toBe(2000);
    expect(analysisDurationMs("2026-01-01T00:00:02.000Z", "2026-01-01T00:00:00.000Z")).toBe(0);
    expect(analysisDurationMs("nonsense", "2026-01-01T00:00:00.000Z")).toBe(0);
  });
});
