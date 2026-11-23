import type { ScanFinding, ScanModule, ScanResult } from "@proofcore/core";

/**
 * The free site analysis: two per account, and only part of the report.
 *
 * An account without a paid subscription gets two single-page analyses, counted per
 * person and not per workspace. Each one shows 60 % of its tests. The other 40 % are
 * withheld here, on the server: they are never sent, stored or rendered, so hiding them
 * with CSS is not the mechanism. The withheld tests are named (module and test id) so the
 * person knows what the full analysis would check, but their results are not disclosed.
 *
 * The 60 % is the same for every visitor and every scan: the order is fixed by module,
 * then by status (failures first), then by id. Nothing about which tests are shown depends
 * on the person's reaction to them.
 */

export const FREE_PREVIEW_LIMIT = 2;
export const FREE_PREVIEW_SHARE_PERCENT = 60;

const MODULE_ORDER: ScanModule[] = ["fail", "clean", "flow", "world", "exit"];
const STATUS_ORDER: Record<ScanFinding["status"], number> = {
  FAIL: 0,
  WARN: 1,
  PASS: 2,
  SKIPPED: 3,
};

export interface LockedTest {
  module: ScanModule;
  id: string;
}

/** The report a non-subscriber receives. Module scores and totals are left out on purpose. */
export type PreviewResult = Omit<ScanResult, "modules" | "findings"> & {
  findings: ScanFinding[];
  preview: {
    sharePercent: number;
    shownCount: number;
    totalCount: number;
    locked: LockedTest[];
  };
};

/** How many tests a preview shows: 60 % of the total, rounded down, at least one. */
export function previewShownCount(total: number): number {
  if (total === 0) return 0;
  return Math.max(1, Math.floor((total * FREE_PREVIEW_SHARE_PERCENT) / 100));
}

/** Fixed order: module, then status (failures first), then id. */
export function orderForPreview(findings: ScanFinding[]): ScanFinding[] {
  return [...findings].sort((a, b) => {
    const moduleDelta = MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module);
    if (moduleDelta !== 0) return moduleDelta;
    const statusDelta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDelta !== 0) return statusDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Cut a full single-page report down to the preview.
 *
 * Module summaries and scores are dropped: they are computed from every test, so they would
 * reveal the withheld 40 % anyway.
 */
export function buildPreview(result: ScanResult): PreviewResult {
  const ordered = orderForPreview(result.findings);
  const shownCount = previewShownCount(ordered.length);
  const shown = ordered.slice(0, shownCount);
  const locked = ordered.slice(shownCount).map((finding) => ({
    module: finding.module,
    id: finding.id,
  }));
  const { modules: _modules, findings: _findings, ...rest } = result;
  return {
    ...rest,
    findings: shown,
    preview: {
      sharePercent: FREE_PREVIEW_SHARE_PERCENT,
      shownCount,
      totalCount: ordered.length,
      locked,
    },
  };
}
