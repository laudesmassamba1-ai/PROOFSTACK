import {
  buildFinding,
  compareFindings,
  type Finding,
  type FindingComparison,
  findingKey,
  type ScanStatus,
} from "@proofcore/core";
import type { Services } from "./http/services.js";
import type { AnalysisRecord } from "./store/app-store.js";

/**
 * Turning stored payloads into findings.
 *
 * A page audit stores what the scan measured, a module run stores its report, and a
 * client can post a result of its own. Rather than rewrite every payload (and lose the
 * evidence already on disk), this module walks the stored JSON looking for objects shaped
 * like a measurement, then enriches them from the control registry. The payload stays the
 * source of truth; a finding is a view of it.
 */

interface RawMeasurement {
  module?: unknown;
  id?: unknown;
  controlId?: unknown;
  status?: unknown;
  observed?: unknown;
  why?: unknown;
  url?: unknown;
  pages?: unknown;
}

function isMeasurement(value: unknown): value is RawMeasurement {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.status === "string" &&
    (typeof record.id === "string" || typeof record.controlId === "string") &&
    typeof record.observed === "string"
  );
}

const CONTAINER_KEYS = ["findings", "site", "results", "modules", "report", "checks", "controls"];

function collect(value: unknown, out: RawMeasurement[], depth: number): void {
  if (depth > 6 || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  if (isMeasurement(value)) {
    out.push(value);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of CONTAINER_KEYS) {
    if (key in record) collect(record[key], out, depth + 1);
  }
}

/**
 * Build the findings of one analysis from the payload it points at.
 *
 * Deduplicated by key with the worse verdict kept: a crawl can report the same control for
 * the same page twice (the page scan and the site aggregate), and the report must not show
 * both as if they were two problems.
 */
export function findingsFromPayload(
  payload: unknown,
  analysis: AnalysisRecord,
  fallbackUrl: string | null
): Finding[] {
  const raw: RawMeasurement[] = [];
  collect(payload, raw, 0);
  const byKey = new Map<string, Finding>();
  for (const item of raw) {
    const module = typeof item.module === "string" ? item.module : "clean";
    const controlId =
      typeof item.controlId === "string"
        ? item.controlId
        : typeof item.id === "string"
          ? item.id
          : "";
    if (!controlId) continue;
    const status = String(item.status) as ScanStatus;
    if (!["PASS", "WARN", "FAIL", "SKIPPED"].includes(status)) continue;
    const pages = Array.isArray(item.pages)
      ? item.pages.filter((page): page is string => typeof page === "string")
      : undefined;
    const url = typeof item.url === "string" ? item.url : pages ? null : fallbackUrl;
    const finding = buildFinding({
      analysisId: analysis.id,
      module,
      controlId,
      status,
      observed: String(item.observed),
      ...(typeof item.why === "string" ? { why: item.why } : {}),
      url,
      detectedAt: analysis.endedAt ?? analysis.startedAt,
      ...(pages && pages.length > 0 ? { pages } : {}),
    });
    const existing = byKey.get(finding.key);
    if (!existing || severityWorse(finding, existing)) byKey.set(finding.key, finding);
  }
  return [...byKey.values()];
}

function severityWorse(candidate: Finding, current: Finding): boolean {
  const order = { critical: 4, high: 3, medium: 2, low: 1, info: 0 } as const;
  const candidateRank = order[candidate.severity];
  const currentRank = order[current.severity];
  if (candidateRank !== currentRank) return candidateRank > currentRank;
  const statusRank: Record<string, number> = { FAILED: 0, WARNING: 1 };
  return (statusRank[candidate.status] ?? 9) < (statusRank[current.status] ?? 9);
}

/** The URL an analysis was about, used as the evidence location of page findings. */
function targetUrl(analysis: AnalysisRecord): string | null {
  return analysis.targetType === "PAGE" ? analysis.target : null;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function modulesMeasured(findings: readonly Finding[], analysis: AnalysisRecord): string[] {
  const measured = new Set(findings.map((finding) => finding.module));
  if (measured.size > 0) return [...measured];
  return analysis.coverage.measuredModules;
}

function pack(findings: Finding[], analysis: AnalysisRecord) {
  return { findings, measuredModules: modulesMeasured(findings, analysis), loaded: true };
}

/**
 * Load the stored evidence of an analysis and return its findings.
 *
 * Returns an empty list when the analysis has no payload yet (queued, failed before
 * measuring): an empty report is not a clean report, and the caller decides which it is
 * from the analysis status.
 */
export async function findingsForAnalysis(
  services: Services,
  analysis: AnalysisRecord
): Promise<{ findings: Finding[]; measuredModules: string[]; loaded: boolean }> {
  if (analysis.pageAuditId) {
    const row = await services.store.getPageAudit(analysis.workspaceId, analysis.pageAuditId);
    if (!row) return { findings: [], measuredModules: [], loaded: false };
    const payload = typeof row.payload === "string" ? safeParse(row.payload) : row.payload;
    return pack(findingsFromPayload(payload, analysis, targetUrl(analysis)), analysis);
  }
  // An analysis created through the API or the CLI carries its result on the row itself.
  // Prefer it when it holds findings: a FLOW re-run writes canonical findings to the row
  // while still pointing at its stored report, and the report's engine findings use a
  // different shape (`detail`, no `observed`) that this reader would skip.
  if (analysis.result) {
    const packed = pack(
      findingsFromPayload(analysis.result, analysis, targetUrl(analysis)),
      analysis
    );
    if (packed.findings.length > 0) return packed;
  }
  if (analysis.runId) {
    const report = await services.store.getReportByRunId(analysis.workspaceId, analysis.runId);
    if (!report) return { findings: [], measuredModules: [], loaded: false };
    return pack(findingsFromPayload(report, analysis, targetUrl(analysis)), analysis);
  }
  return { findings: [], measuredModules: [], loaded: false };
}

/** The stable identity two analyses are compared on. */
export function findingIdentity(finding: Finding): string {
  return findingKey(finding.module, finding.controlId, finding.url);
}

/**
 * The comparison behind both `GET /analyses/compare` and the assistant's
 * `compare_analyses` tool.
 *
 * One implementation on purpose: a chat answer and a report that disagree about whether
 * a problem was fixed would make the second opinion worthless.
 */
export async function compareAnalysisPair(
  services: Services,
  workspaceId: string,
  baseId: string,
  targetId: string
): Promise<{ base: AnalysisRecord; target: AnalysisRecord; comparison: FindingComparison } | null> {
  const [base, target] = await Promise.all([
    services.store.getAnalysis(workspaceId, baseId),
    services.store.getAnalysis(workspaceId, targetId),
  ]);
  if (!base || !target) return null;
  const [before, after] = await Promise.all([
    findingsForAnalysis(services, base),
    findingsForAnalysis(services, target),
  ]);
  return {
    base,
    target,
    comparison: compareFindings(before.findings, after.findings, {
      before: before.measuredModules,
      after: after.measuredModules,
    }),
  };
}
