import type { ScanFinding, ScanResult } from "@proofcore/core";
import { describe, expect, it } from "vitest";
import {
  buildPreview,
  FREE_PREVIEW_LIMIT,
  FREE_PREVIEW_SHARE_PERCENT,
  orderForPreview,
  previewShownCount,
} from "../src/free-preview.js";

/**
 * Free analysis tests.
 *
 * The commercial rule is a security boundary, not a display preference: the withheld
 * 40 % must never reach the browser, the store or a report. These tests assert the cut
 * itself, its determinism, and that no score survives to leak the hidden results.
 */

function finding(
  id: string,
  module: ScanFinding["module"],
  status: ScanFinding["status"]
): ScanFinding {
  return {
    id,
    module,
    status,
    title: `Finding ${id}`,
    detail: `Detail ${id}`,
    severity: "HIGH",
    observed: `Observed ${id}`,
    why: "Why",
    reproduction: { command: `proofcore test --only ${id}`, summary: "Reproduce" },
  } as ScanFinding;
}

function result(findings: ScanFinding[]): ScanResult {
  return {
    url: "https://site.test/",
    finalUrl: "https://site.test/",
    status: 200,
    contentType: "text/html",
    bytes: 1000,
    durationMs: 120,
    scannedAt: "2026-11-23T10:00:00.000Z",
    findings,
    modules: [
      {
        module: "fail",
        status: "fail",
        passed: 1,
        warnings: 0,
        failed: findings.length,
        skipped: 0,
        score: 12,
        verdict: "fail",
      },
    ],
    clientRendered: false,
  } as ScanResult;
}

describe("free preview", () => {
  it("shows 60 % rounded down, never more than the total", () => {
    expect(previewShownCount(10)).toBe(6);
    expect(previewShownCount(7)).toBe(4);
    expect(previewShownCount(1)).toBe(1);
    expect(previewShownCount(0)).toBe(0);
    expect(FREE_PREVIEW_SHARE_PERCENT).toBe(60);
    expect(FREE_PREVIEW_LIMIT).toBe(2);
  });

  it("orders by module, then failures first, then id — the same for everyone", () => {
    const list = [
      finding("z-pass", "world", "PASS"),
      finding("a-warn", "world", "WARN"),
      finding("b-fail", "world", "FAIL"),
      finding("c-fail", "fail", "FAIL"),
    ];
    expect(orderForPreview(list).map((f) => f.id)).toEqual([
      "c-fail",
      "b-fail",
      "a-warn",
      "z-pass",
    ]);
  });

  it("returns only the first 60 % of findings", () => {
    const all = Array.from({ length: 10 }, (_, i) =>
      finding(`t${i}`, "world", i < 3 ? "FAIL" : "PASS")
    );
    const preview = buildPreview(result(all));

    expect(preview.findings).toHaveLength(6);
    expect(preview.preview.shownCount).toBe(6);
    expect(preview.preview.totalCount).toBe(10);
    expect(preview.preview.locked).toHaveLength(4);
  });

  it("never includes the withheld findings' results", () => {
    const all = Array.from({ length: 10 }, (_, i) => finding(`t${i}`, "world", "FAIL"));
    const preview = buildPreview(result(all));
    const serialized = JSON.stringify(preview);

    for (const locked of preview.preview.locked) {
      // The id may appear in the locked list (a name, not a result), but the detail and
      // observed values must be absent from the payload entirely.
      expect(serialized).not.toContain(`Detail ${locked.id}`);
      expect(serialized).not.toContain(`Observed ${locked.id}`);
    }
  });

  it("drops module summaries and scores: they would reveal the hidden 40 %", () => {
    const all = Array.from({ length: 5 }, (_, i) => finding(`t${i}`, "world", "PASS"));
    const full = result(all);
    const preview = buildPreview(full) as unknown as Record<string, unknown>;

    expect(preview.modules).toBeUndefined();
    expect(preview.scores).toBeUndefined();
    expect(preview.score).toBeUndefined();
    expect(preview.site).toBeUndefined();
  });

  it("keeps the non-sensitive metadata a person needs to judge the scan", () => {
    const preview = buildPreview(result([finding("t1", "world", "PASS")]));
    expect(preview.url).toBe("https://site.test/");
    expect(preview.status).toBe(200);
    expect(preview.durationMs).toBe(120);
    expect(preview.clientRendered).toBe(false);
  });

  it("is deterministic: the same report always hides the same tests", () => {
    const all = Array.from({ length: 10 }, (_, i) =>
      finding(`t${i}`, "world", i % 2 ? "PASS" : "FAIL")
    );
    const a = buildPreview(result(all));
    const b = buildPreview(result([...all].reverse()));
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
    expect(a.preview.locked).toEqual(b.preview.locked);
  });
});
