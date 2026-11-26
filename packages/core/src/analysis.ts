/**
 * The canonical Analysis: one execution, one identity.
 *
 * The product had three ways to analyse something (a Web scan, a CLI sync, an AI tool
 * call) and each stored its own truth. This module owns the vocabulary they share: what
 * started it, what it looked at, how far it got, and when it may move to its next state.
 * It is deliberately free of HTTP and SQL so the API, the CLI and the AI orchestrator all
 * enforce the same rules.
 */

export const ANALYSIS_SOURCES = ["WEB", "CLI", "AI", "DESKTOP", "API"] as const;
export type AnalysisSource = (typeof ANALYSIS_SOURCES)[number];

export const ANALYSIS_TARGET_TYPES = [
  "PAGE",
  "SITE",
  "API",
  "PROJECT",
  "WORKFLOW",
  "LOCAL_ENVIRONMENT",
] as const;
export type AnalysisTargetType = (typeof ANALYSIS_TARGET_TYPES)[number];

export const ANALYSIS_STATUSES = [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const TERMINAL_ANALYSIS_STATUSES: readonly AnalysisStatus[] = [
  "completed",
  "partial",
  "failed",
  "cancelled",
];

export function isTerminalAnalysisStatus(status: AnalysisStatus): boolean {
  return TERMINAL_ANALYSIS_STATUSES.includes(status);
}

/**
 * Allowed transitions.
 *
 * `completed` is final on purpose: an analysis that already reported a result must not
 * silently become `partial` when a late tool call fails. A re-run is a new analysis.
 * `partial` may become `completed` when the missing measurements were filled in by a
 * follow-up within the same execution (a browser becoming available, for instance).
 */
const TRANSITIONS: Record<AnalysisStatus, readonly AnalysisStatus[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["completed", "partial", "failed", "cancelled"],
  partial: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

/**
 * True when `to` is reachable from `from`. Re-sending the current status is a no-op
 * (idempotent update), which is what a retried PATCH should be.
 */
export function canTransitionAnalysis(from: AnalysisStatus, to: AnalysisStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export interface AnalysisSkip {
  module: string;
  reason: string;
}

/**
 * How much of the ask was actually measured.
 *
 * Every field is something the runner knows for certain. `pages` is optional because only
 * a site crawl has pages; a single-page scan leaves it out rather than writing zero.
 */
export interface AnalysisCoverage {
  requestedModules: string[];
  applicableModules: string[];
  measuredModules: string[];
  skipped: AnalysisSkip[];
  pages?: { discovered: number; scanned: number };
}

export function emptyCoverage(requestedModules: readonly string[] = []): AnalysisCoverage {
  return {
    requestedModules: [...requestedModules],
    applicableModules: [...requestedModules],
    measuredModules: [],
    skipped: [],
  };
}

/** Measured share of the applicable ask, in [0, 1]. An empty ask measures nothing. */
export function coverageRatio(coverage: AnalysisCoverage): number {
  const total = coverage.applicableModules.length;
  if (total === 0) return 0;
  const measured = new Set(coverage.measuredModules);
  let hit = 0;
  for (const module of coverage.applicableModules) {
    if (measured.has(module)) hit += 1;
  }
  return hit / total;
}

export type CoverageLabel = "complete" | "partial" | "none";

/**
 * The label a report may print. A run that skipped an applicable module is `partial` even
 * if every module it did run passed — those are different statements.
 */
export function coverageLabel(coverage: AnalysisCoverage): CoverageLabel {
  const ratio = coverageRatio(coverage);
  if (ratio === 0) return "none";
  if (ratio >= 1 && coverage.skipped.length === 0) return "complete";
  return "partial";
}

/**
 * The status an execution earns from its outcome.
 *
 * `partial` is chosen by what is demonstrably missing (a skipped applicable module, or
 * pages discovered and never read) — never by a timeout that produced no measurement at
 * all; that case is `failed` and must say so.
 */
export function outcomeStatus(input: {
  error?: string | null;
  cancelled?: boolean;
  coverage: AnalysisCoverage;
}): AnalysisStatus {
  if (input.cancelled) return "cancelled";
  if (input.error) return "failed";
  const uncoveredPages =
    input.coverage.pages !== undefined &&
    input.coverage.pages.scanned < input.coverage.pages.discovered;
  if (input.coverage.skipped.length > 0 || uncoveredPages) return "partial";
  return "completed";
}

/** Milliseconds between two ISO instants; never negative, never NaN. */
export function analysisDurationMs(startedAt: string, endedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

/**
 * A stable correlation id for one user gesture.
 *
 * The web app, the CLI and the AI each mint their own ids; when one gesture triggers
 * several executions they must share a correlation id so the report can join them.
 */
export function correlationIdFor(prefix: string, parts: readonly string[]): string {
  let hash = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      hash = (hash * 31 + part.charCodeAt(i)) >>> 0;
    }
  }
  return `${prefix}_${hash.toString(36).padStart(7, "0")}`;
}
