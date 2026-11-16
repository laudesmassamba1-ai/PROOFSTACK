import { z } from "zod";
import { moneySchema, periodSchema } from "./money.js";
import { moduleIdSchema } from "./statuses.js";

/**
 * Billing vocabulary. The *behaviour* of these state machines lives in
 * `@proofstack/billing`; the *names* live here so the CLI, the API, the web app and
 * the provider adapters can never drift into inventing their own status strings.
 */

export const PAYMENT_STATES = [
  "CREATED",
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export const paymentStateSchema = z.enum(PAYMENT_STATES);
export type PaymentState = z.infer<typeof paymentStateSchema>;

export const SUBSCRIPTION_STATES = [
  "INCOMPLETE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "CANCEL_AT_PERIOD_END",
  "CANCELLED",
  "SUSPENDED",
  "EXPIRED",
] as const;
export const subscriptionStateSchema = z.enum(SUBSCRIPTION_STATES);
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;

/**
 * States that grant paid entitlements. Anything not listed here gets the FREE
 * entitlement set — the engine never infers access from a UI hint or a redirect.
 */
export const ENTITLED_SUBSCRIPTION_STATES: readonly SubscriptionState[] = [
  "TRIALING",
  "ACTIVE",
  "CANCEL_AT_PERIOD_END",
];

export function grantsPaidAccess(state: SubscriptionState): boolean {
  return ENTITLED_SUBSCRIPTION_STATES.includes(state);
}

export const PROVIDER_KINDS = [
  "saspay",
  "sandbox",
  "stripe",
  "paystack",
  "flutterwave",
  "fedapay",
  "cinetpay",
] as const;
export const providerKindSchema = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const ENTITLEMENT_KEYS = [
  "workspace_limit",
  "project_limit",
  "monthly_test_runs",
  "world_profiles",
  "flow_scenarios",
  "exit_datasets",
  "report_retention_days",
  "team_members",
  "api_access",
  "cli_access",
  "github_integration",
  "advanced_reports",
  "client_sharing",
  "priority_support",
] as const;
export const entitlementKeySchema = z.enum(ENTITLEMENT_KEYS);
export type EntitlementKey = z.infer<typeof entitlementKeySchema>;

/**
 * Entitlement values are either a count (-1 = unlimited) or a boolean. Keeping the
 * union here means a plan can silently not become "truthy string" somewhere else.
 */
export const entitlementValueSchema = z.union([z.number().int(), z.boolean()]);
export type EntitlementValue = number | boolean;

/**
 * Entitlement maps are *sparse by design*: a plan only restates what it changes and
 * inherits the rest from the FREE baseline. Enum-keyed `z.record` would demand every
 * key, so the key is validated as a string at runtime instead.
 */
export const entitlementKeyStringSchema = z
  .string()
  .refine((value) => (ENTITLEMENT_KEYS as readonly string[]).includes(value), {
    message: `unknown entitlement key (expected one of ${ENTITLEMENT_KEYS.join(", ")})`,
  });

export type EntitlementMap = Partial<Record<EntitlementKey, EntitlementValue>>;

export const planSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    name: z.string().min(1),
    /** Stable display order; never derive order from the name. */
    rank: z.number().int().nonnegative(),
    description: z.string().default(""),
    trialDays: z.number().int().nonnegative().default(0),
    /** Grace period after PAST_DUE before suspension. */
    graceDays: z.number().int().nonnegative().default(0),
    /** Manual-renewal reminder lead time (only meaningful without recurring support). */
    renewalReminderDays: z.number().int().nonnegative().default(7),
    /** Whether the plan is purchasable at all (internal/enterprise can be false). */
    publiclyAvailable: z.boolean().default(true),
    /** Prepaid-only flag: true when no provider in this deployment can auto-charge. */
    prepaidOnly: z.boolean().default(false),
    active: z.boolean().default(true),
    prices: z
      .array(
        z
          .object({
            id: z.string().min(1),
            period: periodSchema,
            /** Amounts are always integer minor units with an explicit currency. */
            amount: moneySchema,
            /** Display currency for marketing pages; charging uses `amount`. */
            featured: z.boolean().default(false),
          })
          .strict()
      )
      .default([]),
    /** A plan may define only the keys it changes; missing keys inherit the FREE set. */
    entitlements: z.record(entitlementKeyStringSchema, entitlementValueSchema).default({}),
    modules: z.array(moduleIdSchema).default([]),
  })
  .strict();
export type Plan = z.output<typeof planSchema>;

/** Seed shape: defaults are applied by the schema, so seeds stay readable. */
export type PlanSeed = z.input<typeof planSchema>;

export const checkoutIntentSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    planId: z.string(),
    priceId: z.string(),
    period: periodSchema,
    amount: moneySchema,
    state: paymentStateSchema,
    idempotencyKey: z.string(),
    provider: providerKindSchema,
    providerReference: z.string().optional(),
    /** Where to send the customer, when the provider hosts the payment page. */
    providerCheckoutUrl: z.string().url().optional(),
    createdAt: z.string(),
    expiresAt: z.string().optional(),
    /** Human-readable reason when the intent cannot proceed. */
    refusal: z.string().optional(),
  })
  .strict();
export type CheckoutIntent = z.infer<typeof checkoutIntentSchema>;

export const webhookEventSchema = z
  .object({
    id: z.string(),
    provider: providerKindSchema,
    /** Provider event id — the deduplication key. */
    providerEventId: z.string(),
    type: z.string(),
    receivedAt: z.string(),
    signatureValid: z.boolean(),
    processedAt: z.string().optional(),
    processingState: z
      .enum(["RECEIVED", "IGNORED_DUPLICATE", "PROCESSED", "REJECTED", "FAILED_RETRYABLE"])
      .default("RECEIVED"),
    /** Raw body is never stored verbatim; a digest is enough for forensics. */
    bodyDigest: z.string(),
    error: z.string().optional(),
  })
  .strict();
export type WebhookEventRecord = z.infer<typeof webhookEventSchema>;

export const invoiceLineSchema = z
  .object({
    description: z.string(),
    quantity: z.number().int().nonnegative().default(1),
    unitAmount: moneySchema,
    totalAmount: moneySchema,
  })
  .strict();
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const invoiceSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    workspaceId: z.string(),
    subscriptionId: z.string().optional(),
    paymentAttemptId: z.string().optional(),
    /** Provider transaction reference, present only after a verified payment. */
    providerReference: z.string().optional(),
    status: z.enum(["DRAFT", "OPEN", "PAID", "VOID", "REFUNDED", "UNCOLLECTIBLE"]),
    currency: z.string().length(3),
    subtotal: moneySchema,
    total: moneySchema,
    lines: z.array(invoiceLineSchema),
    issuedAt: z.string(),
    /** Service period this document covers. */
    periodStart: z.string(),
    periodEnd: z.string(),
    customer: z
      .object({
        name: z.string(),
        email: z.string().email(),
        country: z.string().length(2).optional(),
      })
      .strict(),
    /**
     * A payment receipt is not a legally compliant tax invoice. Callers must not
     * present these as VAT/GST invoices without a jurisdiction-specific check.
     */
    documentKind: z.enum(["RECEIPT", "TAX_INVOICE"]).default("RECEIPT"),
    taxNote: z.string().optional(),
  })
  .strict();
export type Invoice = z.infer<typeof invoiceSchema>;

export const usageEventKindSchema = z.enum([
  "test_run",
  "module_run",
  "report_storage",
  "export_job",
  "api_request",
  "cli_sync",
]);
export type UsageEventKind = z.infer<typeof usageEventKindSchema>;

export const usageEventSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    projectId: z.string().optional(),
    kind: usageEventKindSchema,
    quantity: z.number().int().nonnegative(),
    /** Client-supplied key so a retried upload is not counted twice. */
    dedupeKey: z.string(),
    occurredAt: z.string(),
    billingTreatment: z.enum(["counted", "not_counted", "counted_once_per_intent"]),
  })
  .strict();
export type UsageEvent = z.infer<typeof usageEventSchema>;
