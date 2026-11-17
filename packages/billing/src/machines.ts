import {
  PAYMENT_STATES,
  type PaymentState,
  SUBSCRIPTION_STATES,
  type SubscriptionState,
} from "@proofcore/contracts";

/**
 * State machines for money.
 *
 * These exist as data, not prose, so an illegal transition is a thrown error instead
 * of a corrupted row. The shapes are dictated by what SasPay can actually do:
 * there is no refund route and no recurring route in its OpenAPI, therefore
 * SUCCEEDED → REFUNDED is an *administrative* transition recorded by a human, and
 * there is no automatic renewal transition at all — a new period needs a new intent.
 */

export const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  CREATED: ["PENDING", "CANCELLED", "FAILED"],
  PENDING: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "PENDING"],
  SUCCEEDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: ["PENDING"],
  CANCELLED: [],
  EXPIRED: ["PENDING"],
  REFUNDED: [],
};

export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionState, readonly SubscriptionState[]> = {
  INCOMPLETE: ["TRIALING", "ACTIVE", "CANCELLED", "EXPIRED"],
  TRIALING: ["ACTIVE", "PAST_DUE", "CANCEL_AT_PERIOD_END", "CANCELLED", "EXPIRED"],
  ACTIVE: ["PAST_DUE", "CANCEL_AT_PERIOD_END", "GRACE_PERIOD", "SUSPENDED", "EXPIRED"],
  PAST_DUE: ["ACTIVE", "GRACE_PERIOD", "CANCELLED", "SUSPENDED", "EXPIRED"],
  GRACE_PERIOD: ["ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"],
  CANCEL_AT_PERIOD_END: ["ACTIVE", "CANCELLED", "EXPIRED"],
  CANCELLED: [],
  SUSPENDED: ["ACTIVE", "CANCELLED", "EXPIRED"],
  EXPIRED: ["ACTIVE", "CANCELLED"],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: "payment" | "subscription",
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[]
  ) {
    super(
      `Illegal ${machine} transition ${from} → ${to}. Allowed from ${from}: ${allowed.join(", ") || "(terminal state)"}`
    );
    this.name = "IllegalTransitionError";
  }
}

export function assertPaymentTransition(from: PaymentState, to: PaymentState): void {
  if (from === to) return;
  const allowed = PAYMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new IllegalTransitionError("payment", from, to, allowed);
}

export function assertSubscriptionTransition(from: SubscriptionState, to: SubscriptionState): void {
  if (from === to) return;
  const allowed = SUBSCRIPTION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new IllegalTransitionError("subscription", from, to, allowed);
}

export function isTerminalPayment(state: PaymentState): boolean {
  return (PAYMENT_TRANSITIONS[state] ?? []).length === 0;
}

/**
 * Entitlement windows.
 *
 * A failed renewal must NEVER delete access that was already paid for. ACTIVE,
 * PAST_DUE and GRACE_PERIOD therefore keep access until the paid period truly ends,
 * while SUSPENDED, CANCELLED and EXPIRED do not. CANCEL_AT_PERIOD_END keeps access
 * precisely because the customer already bought that period.
 */
export const ACCESS_KEEPING_STATES: readonly SubscriptionState[] = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "CANCEL_AT_PERIOD_END",
];

export interface AccessWindow {
  state: SubscriptionState;
  /** True when the current state can, in principle, grant access. */
  stateAllows: boolean;
  /** True when a period boundary (or trial end) has already passed. */
  expired: boolean;
  /** When access would stop even if nothing else changed. */
  endsAt: Date | null;
}

export function evaluateAccessWindow(
  state: SubscriptionState,
  now: Date,
  currentPeriodEnd: Date | null,
  trialEndsAt: Date | null
): AccessWindow {
  const stateAllows = ACCESS_KEEPING_STATES.includes(state);
  const candidate = state === "TRIALING" ? trialEndsAt : currentPeriodEnd;
  return {
    state,
    stateAllows,
    expired: candidate !== null && candidate.getTime() <= now.getTime(),
    endsAt: candidate,
  };
}

export function grantsAccess(
  state: SubscriptionState,
  now: Date,
  currentPeriodEnd: Date | null,
  trialEndsAt: Date | null
): boolean {
  const window = evaluateAccessWindow(state, now, currentPeriodEnd, trialEndsAt);
  return window.stateAllows && !window.expired;
}

export const ALL_PAYMENT_STATES = PAYMENT_STATES;
export const ALL_SUBSCRIPTION_STATES = SUBSCRIPTION_STATES;
