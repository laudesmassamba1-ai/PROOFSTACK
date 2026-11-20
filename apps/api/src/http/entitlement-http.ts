import type { EntitlementDecision, MeterResult } from "@proofcore/billing";
import { HttpError } from "./errors.js";

/**
 * One HTTP shape for an exhausted plan quota.
 *
 * Every gate that denies a metered action must answer the same way: 403,
 * `quota_exhausted`, the numbers the customer will see on the billing page, and
 * — when one exists — the cheapest plan that would lift the limit. Before this
 * helper each route hand-rolled its details object, and a gate that forgot
 * `requiredPlanKey` turned an actionable "upgrade" into a dead end.
 */

function details(decision: EntitlementDecision): Record<string, unknown> {
  return {
    limit: typeof decision.limit === "number" ? decision.limit : 0,
    used: decision.used,
    remaining: decision.remaining,
    ...(decision.requiredPlanKey ? { requiredPlanKey: decision.requiredPlanKey } : {}),
  };
}

/** Deny from a read-only `checkEntitlement` decision (the pre-work gate). */
export function quotaErrorFromDecision(decision: EntitlementDecision, what: string): HttpError {
  return new HttpError(
    403,
    "quota_exhausted",
    `The monthly ${what} quota is exhausted for this workspace.`,
    details(decision)
  );
}

/** Deny from a meter result (the post-work meter rejected in a race window). */
export function quotaErrorFromMeter(metered: MeterResult, what: string): HttpError {
  return new HttpError(
    403,
    "quota_exhausted",
    `The monthly ${what} quota is exhausted for this workspace.`,
    {
      limit: metered.limit,
      used: metered.usage,
      remaining: metered.remaining,
      ...(metered.decision.requiredPlanKey
        ? { requiredPlanKey: metered.decision.requiredPlanKey }
        : {}),
    }
  );
}
