import type { PermissionClass } from "@proofcore/core";

/**
 * What each assistant tool is allowed to do.
 *
 * The classes are the ones the capability registry already uses for the product itself
 * (read, analysis, write, sensitive), so a tool cannot claim a wider authority than the
 * capability it wraps. An unlisted tool is "sensitive" by default: a new tool is denied
 * until someone classifies it, never granted by omission.
 */

export const AI_TOOL_PERMISSIONS: Record<string, PermissionClass> = {
  // Reads: no side effect, no network.
  workspace_overview: "read",
  list_projects: "read",
  module_status: "read",
  module_config: "read",
  recent_runs: "read",
  recent_findings: "read",
  get_report: "read",
  project_code: "read",
  read_repo: "read",
  capabilities: "read",
  list_analyses: "read",
  analysis_findings: "read",
  compare_analyses: "read",
  validate_scenario: "read",
  list_remediations: "read",

  // Analysis: spends time, quota or someone else's network. Capped per turn.
  analyze_run: "analysis",
  site_audit: "analysis",
  fail_scan: "analysis",
  clean_audit: "analysis",
  module_run: "analysis",
  fetch_web: "analysis",
  browse_url: "analysis",
  probe_url: "analysis",

  // Writes: changes the tenant. Each tool still requires its own confirm flag.
  module_configure: "write",
  remember: "write",
  open_remediation: "write",
};

export function permissionOf(name: string): PermissionClass {
  return AI_TOOL_PERMISSIONS[name] ?? "sensitive";
}

/**
 * The analysis budget for one assistant turn.
 *
 * A model that loops on scans is the expensive failure mode: it costs quota and leaves
 * the user waiting. Three analyses per turn is enough for a real question and small
 * enough that a loop stops mid-answer instead of after the bill.
 */
export const MAX_ANALYSIS_CALLS_PER_TURN = 3;

export class AnalysisBudget {
  private used = 0;

  constructor(private readonly max = MAX_ANALYSIS_CALLS_PER_TURN) {}

  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }

  consume(): boolean {
    if (this.used >= this.max) return false;
    this.used += 1;
    return true;
  }
}
