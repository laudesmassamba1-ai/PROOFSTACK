import { z } from "zod";

/**
 * Shared vocabularies. These enums are the contract between the CLI (which runs
 * tests), the API (which stores results and enforces entitlements) and the web
 * app (which displays them). Adding a status here is the only sanctioned way to
 * add one anywhere else.
 */

export const TEST_STATUSES = [
  "PENDING",
  "RUNNING",
  "PASSED",
  "FAILED",
  "WARNING",
  "SKIPPED",
  "ERROR",
] as const;
export const testStatusSchema = z.enum(TEST_STATUSES);
export type TestStatus = z.infer<typeof testStatusSchema>;

/**
 * A run is only PASSED when nothing errored and nothing failed. `ERROR` means the
 * check could not be evaluated (harness/network/config), which is deliberately not
 * the same thing as a product defect and must never be shown as a pass.
 */
export const RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "ERROR",
  "CANCELLED",
  /**
   * Nothing was verified: every case was skipped because a module had no target.
   *
   * This is deliberately not ERROR (the harness worked fine) and deliberately not
   * COMPLETED (nothing was proven). A fresh project lands here on its first run, and
   * the CLI exits non-zero so CI cannot mistake "not wired up" for "passing".
   */
  "NOTHING_VERIFIED",
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const MODULE_IDS = ["world", "flow", "exit"] as const;
export const moduleIdSchema = z.enum(MODULE_IDS);
export type ModuleId = z.infer<typeof moduleIdSchema>;

/**
 * String-keyed variant for use as a `z.record` key: zod types enum-keyed records as
 * total maps, which would force every plan to restate every entitlement. Keys are
 * still validated at runtime, so a typo fails loudly instead of becoming a silent
 * unlimited grant.
 */
export const moduleIdStringSchema = z
  .string()
  .refine((value) => (MODULE_IDS as readonly string[]).includes(value), {
    message: `expected one of ${MODULE_IDS.join(", ")}`,
  });

export const MODULE_LABELS: Record<ModuleId, { name: string; question: string }> = {
  world: {
    name: "WORLD",
    question: "Can users from different countries use the software correctly?",
  },
  flow: {
    name: "FLOW",
    question: "Can users successfully complete the critical operations?",
  },
  exit: {
    name: "EXIT",
    question: "Can users retrieve their information without losing it?",
  },
};

/** Terminal statuses: a check in one of these will not change without a new run. */
export const TERMINAL_TEST_STATUSES: readonly TestStatus[] = [
  "PASSED",
  "FAILED",
  "WARNING",
  "SKIPPED",
  "ERROR",
];

export function isTerminalStatus(status: TestStatus): boolean {
  return TERMINAL_TEST_STATUSES.includes(status);
}

export function aggregateStatus(statuses: readonly TestStatus[]): RunStatus {
  if (statuses.length === 0) return "ERROR";
  const active = statuses.filter((s) => !isTerminalStatus(s));
  if (active.some((s) => s === "RUNNING")) return "RUNNING";
  if (statuses.includes("ERROR")) return "ERROR";
  if (statuses.includes("FAILED")) return "FAILED";
  // Every case skipped means nothing was actually verified. That is its own outcome:
  // calling it ERROR blames the harness, calling it COMPLETED claims a pass nobody ran.
  if (statuses.every((s) => s === "SKIPPED")) return "NOTHING_VERIFIED";
  if (statuses.includes("WARNING")) return "PARTIAL";
  return "COMPLETED";
}

export const ENVIRONMENT_KINDS = ["local", "staging", "production", "ci", "demo"] as const;
export const environmentKindSchema = z.enum(ENVIRONMENT_KINDS);
export type EnvironmentKind = z.infer<typeof environmentKindSchema>;

/**
 * Anything that can move money or mutate real data is refused against production
 * unless the operator explicitly opts in. This is a contract-level rule, not a UI
 * convention, so the CLI and the API both enforce it.
 */
export const PRODUCTION_GUARDED_MODES = ["live_charge", "destructive_export", "real_payout"] as const;
export const productionGuardedModeSchema = z.enum(PRODUCTION_GUARDED_MODES);
export type ProductionGuardedMode = z.infer<typeof productionGuardedModeSchema>;
