import type {
  BillingPeriod,
  EntitlementKey,
  EntitlementValue,
  ModuleId,
  SubscriptionState,
} from "@proofstack/contracts";
import { grantsAccess } from "./machines.js";
import { PLANS, entitlementsFor, findPlan, planRank } from "./plans.js";
import type { Subscription } from "./records.js";
import type { BillingStore } from "./store.js";

/**
 * The server-side entitlement engine.
 *
 * Nothing in the UI decides what a customer may do. Every privileged operation asks
 * this resolver, and the resolver reads the *subscription row*, not a cached header,
 * not a JWT claim, and never a query parameter on a redirect.
 *
 * Two rules make this defensible:
 *   1. A subscription that is not entitled resolves to the FREE entitlement set. It
 *      does not resolve to "no data" and it does not throw — the customer keeps
 *      working at the free level rather than hitting a wall.
 *   2. The period boundaries come from the subscription row, so usage metering and
 *      entitlement checks always agree on which period they are talking about.
 */

export const FREE_PLAN_KEY = "free";

export interface EffectiveEntitlements {
  /** Plan the workspace is actually on right now (free when not entitled). */
  planKey: string;
  planName: string;
  /** Rank of the effective plan; used for upgrade/downgrade decisions. */
  rank: number;
  /** True only when the subscription state and its period both allow paid access. */
  entitled: boolean;
  state: SubscriptionState | "NONE";
  /** The billing period usage is metered against. */
  periodStart: string;
  periodEnd: string;
  /** Fully resolved map: every key present, FREE baseline applied. */
  entitlements: Record<EntitlementKey, EntitlementValue>;
  modules: ModuleId[];
  /** Why the workspace is not on its paid plan, when relevant. */
  reason: string | null;
  subscriptionId: string | null;
  /** When access stops if nothing changes (period end, trial end, or grace end). */
  accessEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** False when the configured provider cannot charge the next period by itself. */
  recurringSupported: boolean;
}

/**
 * Resolve what a workspace may do, right now.
 *
 * `now` is injected everywhere so tests can pin time instead of sleeping, and so the
 * reconciliation pass can evaluate a historical instant without mutating rows.
 */
export async function resolveEntitlements(
  store: BillingStore,
  workspaceId: string,
  now: Date = new Date(),
): Promise<EffectiveEntitlements> {
  const subscription = await store.liveSubscription(workspaceId);
  if (!subscription) {
    return freeEntitlements(now, "no_subscription");
  }

  const accessEndsAt = accessBoundary(subscription);
  const entitled = grantsAccess(
    subscription.state,
    now,
    subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
    subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null,
  );

  if (!entitled) {
    // The paid period is over (or the state never granted access). The customer is not
    // deleted, not blocked from their data, and not silently downgraded in the DB:
    // they simply resolve to FREE until a verified payment arrives.
    const reason =
      subscription.state === "CANCELLED"
        ? "subscription_cancelled"
        : subscription.state === "SUSPENDED"
          ? "subscription_suspended"
          : subscription.state === "EXPIRED"
            ? "subscription_expired"
            : "period_ended_awaiting_renewal";
    return {
      ...freeEntitlements(now, reason),
      state: subscription.state,
      subscriptionId: subscription.id,
      accessEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }

  const plan = findPlan(subscription.planKey);
  return {
    planKey: plan?.key ?? FREE_PLAN_KEY,
    planName: plan?.name ?? "Free",
    rank: plan?.rank ?? 0,
    entitled: true,
    state: subscription.state,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    entitlements: entitlementsFor(subscription.planKey),
    modules: plan?.modules ?? ["world", "flow", "exit"],
    reason: null,
    subscriptionId: subscription.id,
    accessEndsAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    recurringSupported: !(plan?.prepaidOnly ?? true),
  };
}

function freeEntitlements(now: Date, reason: string): EffectiveEntitlements {
  const plan = findPlan(FREE_PLAN_KEY);
  // The free tier is metered against the calendar month, not against a zero-length
  // window. Without this, `periodStart === periodEnd` and every usage event falls
  // outside the period, so a free workspace would have unlimited quota by accident.
  const { start, end } = calendarMonth(now);
  return {
    planKey: FREE_PLAN_KEY,
    planName: plan?.name ?? "Free",
    rank: 0,
    entitled: false,
    state: "NONE",
    periodStart: start,
    periodEnd: end,
    entitlements: entitlementsFor(FREE_PLAN_KEY),
    modules: plan?.modules ?? ["world", "flow", "exit"],
    reason,
    subscriptionId: null,
    accessEndsAt: null,
    cancelAtPeriodEnd: false,
    recurringSupported: false,
  };
}

/** UTC calendar month containing `now`. Used for every non-subscription period. */
export function calendarMonth(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * The instant access stops if nothing else happens. A trial ends at `trialEndsAt`;
 * everything else ends at the paid period boundary. Grace is deliberately *not*
 * added here: the grace window is a policy the caller applies, not a fact about the
 * subscription row.
 */
function accessBoundary(subscription: Subscription): string | null {
  if (subscription.state === "TRIALING") return subscription.trialEndsAt ?? subscription.currentPeriodEnd;
  return subscription.currentPeriodEnd;
}

/**
 * An entitlement request. The key alone says what is being asked; the value type in
 * the plan map says whether it is a flag (boolean) or a quota (number, -1 = unlimited).
 */
export interface EntitlementCheck {
  key: EntitlementKey;
  /** How many units the caller wants to consume. Defaults to 1. */
  requested?: number;
}

export interface EntitlementDecision {
  allowed: boolean;
  key: EntitlementKey;
  /** The resolved limit: a boolean for flags, a number for quotas (-1 = unlimited). */
  limit: EntitlementValue;
  used: number;
  /** -1 means unlimited, 0 means exhausted. */
  remaining: number;
  /** Machine-readable reason, present only when denied. */
  reason?: string;
  /** The cheapest plan that would grant this, when one exists. */
  requiredPlanKey?: string;
}

/**
 * Decide one entitlement, given how much the workspace has already used this period.
 *
 * The caller supplies `used` because only the caller knows which usage counter backs
 * which entitlement. This function stays pure so it can be unit-tested exhaustively
 * without a store.
 */
export function checkEntitlement(
  entitlements: EffectiveEntitlements,
  check: EntitlementCheck,
  used = 0,
): EntitlementDecision {
  const requested = check.requested ?? 1;
  const limit = entitlements.entitlements[check.key];

  if (typeof limit === "boolean") {
    return limit
      ? { allowed: true, key: check.key, limit, used: limit ? 1 : 0, remaining: limit ? 1 : 0 }
      : {
          allowed: false,
          key: check.key,
          limit,
          used: 0,
          remaining: 0,
          reason: `plan_${entitlements.planKey}_lacks_${check.key}`,
          ...requiredPlan(check.key, entitlements.rank),
        };
  }

  if (limit === -1) {
    return { allowed: true, key: check.key, limit, used, remaining: -1 };
  }

  const remaining = Math.max(0, limit - used);
  if (requested > remaining) {
    return {
      allowed: false,
      key: check.key,
      limit,
      used,
      remaining,
      reason: `quota_${check.key}_exhausted`,
      ...requiredPlan(check.key, entitlements.rank),
    };
  }
  return { allowed: true, key: check.key, limit, used, remaining: remaining - requested };
}

/**
 * Find the cheapest higher-ranked plan that grants a given entitlement. This is what
 * lets a denial explain itself ("Studio raises this to 20") instead of just saying no.
 */
function requiredPlan(key: EntitlementKey, currentRank: number): { requiredPlanKey?: string } {
  const candidates = findPlanUpgrade(key, currentRank);
  return candidates ? { requiredPlanKey: candidates } : {};
}

function findPlanUpgrade(key: EntitlementKey, currentRank: number): string | undefined {
  const ordered = [...PLANS]
    .filter((p) => p.rank > currentRank && p.publiclyAvailable && p.active)
    .sort((a, b) => a.rank - b.rank);
  for (const plan of ordered) {
    const value = entitlementsFor(plan.key)[key];
    if (typeof value === "boolean" ? value : value === -1 || value > 0) return plan.key;
  }
  return undefined;
}

/**
 * A plan change never takes effect in the middle of a paid period downwards, and
 * never silently charges upwards. Upgrades are immediate (a new charge covers the
 * remaining days); downgrades queue until the period boundary.
 *
 * `pendingPlanKey` is the queue, and it is honoured by the next verified payment —
 * not by a timer, so a downgrade cannot happen without a renewal event.
 */
export function planChangeEffect(
  subscription: Subscription,
  targetPlanKey: string,
  period: BillingPeriod,
): { mode: "immediate" | "at_period_end"; effectiveAt: string; pendingPlanKey: string | null; reason: string } {
  void period;
  if (subscription.planKey === targetPlanKey) {
    return {
      mode: "immediate",
      effectiveAt: subscription.currentPeriodEnd,
      pendingPlanKey: null,
      reason: "already_on_plan",
    };
  }
  const isUpgrade = planRank(targetPlanKey) > planRank(subscription.planKey);
  if (isUpgrade) {
    return {
      mode: "immediate",
      effectiveAt: new Date().toISOString(),
      pendingPlanKey: null,
      reason: "upgrade_immediate",
    };
  }
  return {
    mode: "at_period_end",
    effectiveAt: subscription.currentPeriodEnd,
    pendingPlanKey: targetPlanKey,
    reason: "downgrade_queued",
  };
}
