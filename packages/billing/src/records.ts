import type {
  BillingPeriod,
  Invoice,
  PaymentState,
  ProviderKind,
  SubscriptionState,
  UsageEvent,
  WebhookEventRecord,
} from "@proofstack/contracts";

/**
 * Billing rows.
 *
 * `@proofstack/contracts` owns the wire shapes that cross a boundary (Invoice,
 * UsageEvent, WebhookEventRecord). These are the storage-side records around them.
 * Every amount is a minor-unit *string* plus an explicit currency — never a float,
 * and never a number that can silently lose precision on its way to JSON.
 */

export interface Customer {
  id: string;
  email: string;
  emailNormalized: string;
  name: string;
  /** Country is used only for locale/VAT questions, never to invent a price. */
  country: string | null;
  createdAt: string;
}

export interface Subscription {
  id: string;
  workspaceId: string;
  customerId: string;
  planKey: string;
  currency: string;
  period: BillingPeriod;
  state: SubscriptionState;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** Set by the customer, honoured at the period boundary — never before. */
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  provider: ProviderKind;
  /** Queued plan change, applied only at renewal. */
  pendingPlanKey: string | null;
  /** Provider references of every intent that ever funded this subscription. */
  fundedByIntentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentIntent {
  id: string;
  workspaceId: string;
  subscriptionId: string;
  planKey: string;
  priceId: string;
  period: BillingPeriod;
  currency: string;
  amountMinor: string;
  provider: ProviderKind;
  /**
   * Generated once, at intent creation, and persisted. Every retry of this intent
   * reuses it: that single property is what makes a double debit impossible rather
   * than merely unlikely.
   */
  idempotencyKey: string;
  purpose: "first_charge" | "renewal" | "manual_topup";
  state: PaymentState;
  providerReference: string | null;
  providerCheckoutUrl: string | null;
  verifiedAmountMinor: string | null;
  verifiedNetAmountMinor: string | null;
  /** True once the period was advanced on the strength of this intent. */
  credited: boolean;
  failureReason: string | null;
  /** Set when the provider's reported amount did not match the intent. */
  quarantined: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StoredWebhookRecord = WebhookEventRecord;
export type StoredUsageEvent = UsageEvent;
export type StoredInvoice = Invoice;
