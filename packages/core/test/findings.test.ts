import { describe, expect, it } from "vitest";
import {
  buildFinding,
  causeOf,
  compareFindings,
  groupByCause,
  isInconclusive,
  normalizeStatus,
  priorityOf,
  summarizeFindings,
} from "../src/index.js";

const analysisId = "ana_test";

function make(controlId: string, status: "PASS" | "WARN" | "FAIL" | "SKIPPED", url?: string) {
  return buildFinding({
    analysisId,
    module: "fail",
    controlId,
    status,
    observed: `observed ${controlId}`,
    url: url ?? "https://shop.example/",
    detectedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("finding statuses", () => {
  it("maps the engine's four statuses onto the product's eight", () => {
    expect(normalizeStatus("PASS")).toBe("PASSED");
    expect(normalizeStatus("FAIL")).toBe("FAILED");
    expect(normalizeStatus("WARN")).toBe("WARNING");
    expect(normalizeStatus("SKIPPED")).toBe("SKIPPED");
  });

  it("treats every no-verdict status as inconclusive, never as a pass", () => {
    for (const status of [
      "SKIPPED",
      "BLOCKED",
      "ERROR",
      "NOT_APPLICABLE",
      "NOT_CONFIGURED",
    ] as const) {
      expect(isInconclusive(status)).toBe(true);
    }
    expect(isInconclusive("PASSED")).toBe(false);
    expect(isInconclusive("FAILED")).toBe(false);
  });
});

describe("severity and priority", () => {
  it("takes severity from the registry's risk, not from the status", () => {
    const tls = make("tls", "FAIL");
    // tls is high risk; a warning about it is still a high-exposure control.
    expect(tls.severity).toBe("high");
    expect(make("csp", "FAIL").severity).not.toBe("critical");
    // A secret in the served HTML is exposed now, not potentially later.
    expect(make("secrets_in_html", "FAIL").severity).toBe("critical");
  });

  it("ranks a cheap high-risk fix above an expensive one", () => {
    expect(priorityOf({ severity: "high", complexity: "low" })).toBe("P1");
    expect(priorityOf({ severity: "high", complexity: "high" })).toBe("P2");
    expect(priorityOf({ severity: "critical", complexity: "high" })).toBe("P0");
    expect(priorityOf({ severity: "info", complexity: "low" })).toBe("P3");
  });

  it("puts a blocking journey finding at P0 whatever its severity", () => {
    const blocked = buildFinding({
      analysisId,
      module: "flow",
      controlId: "journey_entry",
      status: "FAIL",
      observed: "no form found",
      url: "https://shop.example/",
      detectedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(blocked.priority).toBe("P0");
  });
});

describe("explanations", () => {
  it("fills all seven levels from the control registry", () => {
    const hsts = make("hsts", "FAIL");
    for (const level of [
      "fact",
      "meaning",
      "impact",
      "scope",
      "verification",
      "fix",
      "confidence",
    ] as const) {
      expect(hsts.explanation[level].length, level).toBeGreaterThan(5);
    }
    expect(hsts.explanation.fact).toContain("observed hsts");
    expect(hsts.evidence.expected).toBeTruthy();
  });

  it("marks a site-level finding as inferred, and says from how many pages", () => {
    const site = buildFinding({
      analysisId,
      module: "clean",
      controlId: "crawl_coverage",
      status: "WARN",
      observed: "12 of 40 pages read",
      pages: ["https://shop.example/a", "https://shop.example/b"],
      detectedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(site.confidence).toBe("inferred");
    expect(site.url).toBeNull();
    expect(site.explanation.confidence).toContain("2 page");
  });
});

describe("cause grouping", () => {
  it("groups by cause, not by module", () => {
    const findings = [
      make("hsts", "FAIL"),
      make("csp", "WARN"),
      make("tls", "PASS"),
      make("secrets_in_html", "FAIL"),
    ];
    const groups = groupByCause(findings);
    const byCause = Object.fromEntries(groups.map((group) => [group.cause, group]));
    // hsts and tls are one transport problem; csp is a header problem.
    expect(byCause.transport?.findings).toHaveLength(2);
    expect(byCause.headers?.findings).toHaveLength(1);
    expect(byCause.exposure?.worstSeverity).toBe("critical");
    // The critical exposure sorts first: it is what a person must read first.
    expect(groups[0]?.cause).toBe("exposure");
  });
});

describe("causeOf", () => {
  it("maps a known control and falls back to a valid cause per module", () => {
    expect(causeOf("fail", "hsts")).toBe("transport");
    expect(causeOf("fail", "legacy_check")).toBe("headers");
    expect(causeOf("flow", "legacy_check")).toBe("journey");
    expect(causeOf("clean", "legacy_check")).toBe("content");
    // A stored payload from a module we no longer ship still has a label.
    expect(causeOf("unknown", "legacy_check")).toBe("content");
  });
});

describe("comparison", () => {
  const measured = { before: ["fail"], after: ["fail"] };

  it("separates appeared, resolved and persisting", () => {
    const before = [make("hsts", "FAIL"), make("csp", "FAIL")];
    const after = [make("hsts", "FAIL"), make("tls", "FAIL")];
    const result = compareFindings(before, after, measured);
    expect(result.persisting.map((item) => item.controlId)).toEqual(["hsts"]);
    expect(result.appeared.map((item) => item.controlId)).toEqual(["tls"]);
    expect(result.resolved.map((item) => item.controlId)).toEqual(["csp"]);
    expect(result.counts.total).toBe(3);
  });

  it("does not compare two analyses that measured nothing", () => {
    const result = compareFindings([], [], { before: [], after: [] });
    expect(result.comparable).toBe(false);
    expect(result.reasons).toHaveLength(2);
    expect(result.counts.total).toBe(0);
  });

  it("does not call a finding fixed when the target never read that page", () => {
    const before = [make("hsts", "FAIL", "https://shop.example/a")];
    const after = [make("hsts", "PASS", "https://shop.example/b")];
    const result = compareFindings(before, after, measured);
    // The old page left the crawl: its finding was not corrected, it went unobserved.
    expect(result.resolved).toHaveLength(0);
    expect(result.unmeasured.map((item) => item.url)).toEqual(["https://shop.example/a"]);
    expect(result.appeared).toHaveLength(0);
    expect(result.reasons.join(" ")).toContain("pas relues");
  });

  it("summarises statuses without counting an inconclusive finding as a pass", () => {
    const summary = summarizeFindings([make("hsts", "PASS"), make("csp", "SKIPPED")]);
    expect(summary.total).toBe(2);
    expect(summary.conclusive).toBe(1);
    expect(summary.inconclusive).toBe(1);
    expect(summary.byStatus.SKIPPED).toBe(1);
  });
});
