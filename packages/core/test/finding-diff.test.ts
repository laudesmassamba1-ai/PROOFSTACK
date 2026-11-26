import { describe, expect, it } from "vitest";
import { buildFinding, comparableAnalyses, diffFindings, type Finding } from "../src/index.js";

/**
 * Comparing two analyses.
 *
 * The function is allowed to say "I cannot pair these". It is never allowed to imply a
 * problem was fixed because it stopped being reported for another reason.
 */

function make(
  analysisId: string,
  controlId: string,
  status: "PASS" | "WARN" | "FAIL" | "SKIPPED",
  url = "https://shop.example/"
): Finding {
  return buildFinding({
    analysisId,
    module: "fail",
    controlId,
    status,
    observed: `observed ${controlId}`,
    url,
    detectedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("diffFindings", () => {
  it("names a problem that appeared after the first analysis", () => {
    const before = [make("a1", "hsts", "PASS")];
    const after = [make("a2", "hsts", "PASS"), make("a2", "csp", "FAIL")];
    const diff = diffFindings(before, after);
    expect(diff.added.map((finding) => finding.controlId)).toEqual(["csp"]);
    expect(diff.resolved).toEqual([]);
    expect(diff.persisting).toEqual([]);
  });

  it("only calls a problem resolved when the later analysis still measured the page", () => {
    const before = [make("a1", "csp", "FAIL")];
    const after = [make("a2", "csp", "PASS")];
    const diff = diffFindings(before, after);
    expect(diff.resolved.map((finding) => finding.controlId)).toEqual(["csp"]);
    expect(diff.added).toEqual([]);
  });

  it("keeps a problem that neither improved nor disappeared", () => {
    const before = [make("a1", "csp", "FAIL")];
    const after = [make("a2", "csp", "FAIL")];
    const diff = diffFindings(before, after);
    expect(diff.persisting.map((finding) => finding.controlId)).toEqual(["csp"]);
  });

  it("reports a severity rise as worsened, and a drop as improved", () => {
    const severe = make("a2", "csp", "FAIL");
    const base = make("a1", "csp", "FAIL");
    const worse = diffFindings([base], [{ ...severe, severity: "critical" }]);
    expect(worse.worsened).toHaveLength(1);
    expect(worse.persisting).toEqual([]);
    const better = diffFindings([{ ...base, severity: "critical" }], [severe]);
    expect(better.improved).toHaveLength(1);
  });

  it("refuses to pair findings whose identity is ambiguous", () => {
    const duplicated = make("a1", "csp", "FAIL");
    const diff = diffFindings([duplicated, duplicated], [make("a2", "csp", "PASS")]);
    expect(diff.resolved).toEqual([]);
    expect(diff.incomparable).toHaveLength(1);
    expect(diff.incomparable[0]?.reason).toContain("inventer");
  });

  it("does not treat a control that stopped being reported as fixed on another page", () => {
    const before = [make("a1", "csp", "FAIL", "https://shop.example/checkout")];
    const after = [make("a2", "csp", "FAIL", "https://shop.example/")];
    const diff = diffFindings(before, after);
    // Different pages: the checkout finding is not "resolved", it was not measured again,
    // and the home page problem is new coverage, not a regression.
    expect(diff.resolved).toEqual([]);
    expect(diff.unmeasured.map((finding) => finding.url)).toEqual([
      "https://shop.example/checkout",
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.uncovered.map((finding) => finding.url)).toEqual(["https://shop.example/"]);
  });
});

describe("comparableAnalyses", () => {
  it("accepts two analyses that cover the same modules", () => {
    expect(
      comparableAnalyses({ modules: ["fail", "clean"] }, { modules: ["clean", "fail"] })
    ).toEqual({ comparable: true });
  });

  it("refuses to read a score change across different coverage", () => {
    const verdict = comparableAnalyses({ modules: ["fail"] }, { modules: ["fail", "clean"] });
    expect(verdict.comparable).toBe(false);
    expect(verdict.reason).toContain("modules");
  });
});
