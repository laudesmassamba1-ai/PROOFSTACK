import { describe, expect, it } from "vitest";
import { buildReportHtml, buildReportJson, buildReportMarkdown } from "./report-export.js";

/**
 * An export is a deliverable, not a teaser. The scan result is the only source of truth,
 * and a reader must be able to check every page and every skipped address from it.
 */
const longValue = `long evidence value ${"x".repeat(900)}`;
const scan = {
  id: "aud_export_test",
  url: "https://example.com/dashboard",
  finalUrl: "https://example.com/dashboard",
  status: 200,
  bytes: 42_000,
  durationMs: 1200,
  scannedAt: "2026-11-28T08:00:00.000Z",
  findings: [
    {
      module: "fail",
      id: "content_security_policy",
      status: "FAIL",
      observed: longValue,
      why: "header missing",
    },
  ],
  modules: ["fail", "clean", "flow", "world", "exit"].map((module) => ({
    module,
    passed: 0,
    warnings: 0,
    failed: module === "fail" ? 1 : 0,
    skipped: 0,
    score: module === "fail" ? 10 : 100,
    verdict: module === "fail" ? "fail" : "pass",
  })),
  clientRendered: false,
  site: {
    pages: [
      {
        url: "https://example.com/dashboard",
        finalUrl: "https://example.com/dashboard",
        status: 200,
        title: "Dashboard",
        bytes: 1000,
        durationMs: 10,
        depth: 0,
        measured: true,
        error: null,
      },
    ],
    skipped: Array.from({ length: 45 }, (_, index) => ({
      url: `https://example.com/skipped-${index}`,
      reason: "robots.txt",
    })),
    robots: { found: true },
    sitemap: { found: false },
    truncated: false,
    truncatedBy: null,
    requests: 50,
    durationMs: 500,
    findings: [],
  },
};

describe("report exports", () => {
  it("keeps every skipped page and the full observed evidence in Markdown", () => {
    const markdown = buildReportMarkdown(scan, {}, false);
    expect(markdown).toContain("skipped-44");
    expect(markdown).toContain(longValue);
  });

  it("keeps every skipped page and the full observed evidence in JSON", () => {
    const json = buildReportJson(scan, {});
    expect(json).toContain("skipped-44");
    expect(json).toContain(longValue);
  });

  it("builds a self-contained rich document with all five modules, charts and tables", () => {
    const html = buildReportHtml(scan, {}, false);
    for (const module of ["WORLD", "FLOW", "EXIT", "FAIL", "CLEAN"]) {
      expect(html).toContain(module);
    }
    expect(html).toContain("<svg"); // stacked bars and score bars
    expect(html).toContain("<table");
    expect(html).toContain("#0d9f6e"); // status colors
    expect(html).toContain("Glossary");
    expect(html).toContain(longValue);
    expect(html).toContain("@media print");
  });
});
