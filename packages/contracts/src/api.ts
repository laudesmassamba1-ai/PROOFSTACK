import { z } from "zod";
import {
  checkoutIntentSchema,
  entitlementKeySchema,
  entitlementKeyStringSchema,
  invoiceSchema,
  paymentStateSchema,
  planSchema,
  subscriptionStateSchema,
} from "./billing.js";
import { isoInstantSchema, testRunSchema } from "./engine.js";
import { moneySchema } from "./money.js";
import {
  environmentKindSchema,
  moduleIdSchema,
  moduleIdStringSchema,
  runStatusSchema,
  testStatusSchema,
} from "./statuses.js";

/**
 * HTTP contracts for the PROOFCORE API. The web app and the CLI/SDK both consume
 * these; the server validates inbound bodies with the same schemas.
 */

export const API_VERSION = "1";

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        /** Machine-readable, stable across releases. */
        category: z.string(),
        details: z.unknown().optional(),
        requestId: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const workspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    createdAt: isoInstantSchema,
    /** Role of the *requesting* user in this workspace, resolved server-side. */
    myRole: z.enum(["owner", "admin", "member", "viewer"]).optional(),
  })
  .strict();
export type WorkspaceDto = z.infer<typeof workspaceSchema>;

export const projectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    baseUrl: z.string(),
    stack: z.string().optional(),
    environment: environmentKindSchema,
    enabledModules: z.array(moduleIdSchema),
    createdAt: isoInstantSchema,
    updatedAt: isoInstantSchema,
    lastRunAt: isoInstantSchema.optional(),
    lastRunStatus: runStatusSchema.optional(),
  })
  .strict();
export type ProjectDto = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(120),
    baseUrl: z.string().url(),
    stack: z.string().max(60).optional(),
    environment: environmentKindSchema.default("local"),
    enabledModules: z.array(moduleIdSchema).min(1).default(["world", "flow", "exit"]),
  })
  .strict();

export const createWorkspaceRequestSchema = z.object({ name: z.string().min(2).max(80) }).strict();

/**
 * Run upload: the CLI sends the run it produced. `idempotencyKey` is mandatory so
 * a retried upload cannot double-count usage or duplicate a report.
 */
export const runUploadRequestSchema = z
  .object({
    run: testRunSchema,
    /** Trimmed summary so list endpoints do not need the full payload. */
    summary: z
      .object({
        /**
         * Keyed by module, and **sparse on purpose**.
         *
         * An enum-keyed `z.record` is a *total* map: it demands every module key, so a
         * run that only executed `--module world` was rejected for not reporting FLOW
         * and EXIT totals. Filling those with zeros would be worse than the rejection:
         * it would claim a module was verified and found clean when it never ran. The
         * string-keyed variant validates the key at runtime and lets a run report only
         * what it actually did.
         */
        totals: z.record(
          moduleIdStringSchema,
          z
            .object({
              total: z.number().int(),
              passed: z.number().int(),
              failed: z.number().int(),
              warnings: z.number().int(),
              errors: z.number().int(),
              skipped: z.number().int(),
            })
            .strict()
        ),
      })
      .strict(),
  })
  .strict();
export type RunUploadRequest = z.infer<typeof runUploadRequestSchema>;

export const runUploadResponseSchema = z
  .object({
    runId: z.string(),
    reportId: z.string(),
    /** False when the same idempotency key had already been accepted. */
    recorded: z.boolean(),
    usage: z
      .object({
        monthlyTestRuns: z.number().int().nonnegative(),
        limit: z.union([z.number().int(), z.literal(-1)]),
        remaining: z.union([z.number().int(), z.literal(-1)]),
      })
      .strict(),
  })
  .strict();
export type RunUploadResponse = z.infer<typeof runUploadResponseSchema>;

export const reportListItemSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    runId: z.string(),
    status: runStatusSchema,
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema,
    durationMs: z.number().int(),
    revision: z.string().optional(),
    environment: environmentKindSchema,
    findings: z.number().int(),
    criticalFindings: z.number().int(),
    /** Retention is policy-driven; expired reports are marked, never silently deleted. */
    retainedUntil: isoInstantSchema.optional(),
  })
  .strict();
export type ReportListItem = z.infer<typeof reportListItemSchema>;

export const apiKeyScopeSchema = z.enum([
  "project:read",
  "runs:write",
  "reports:read",
  "usage:read",
]);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const createApiKeyRequestSchema = z
  .object({
    label: z.string().min(1).max(60),
    projectId: z.string().optional(),
    scopes: z.array(apiKeyScopeSchema).min(1).default(["runs:write", "reports:read"]),
  })
  .strict();

/**
 * The plaintext token appears exactly once, in this response. Storage keeps only a
 * SHA-256 hash plus the display prefix.
 */
export const createApiKeyResponseSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    scopes: z.array(apiKeyScopeSchema),
    prefix: z.string(),
    token: z.string().min(20),
    createdAt: isoInstantSchema,
    lastUsedAt: isoInstantSchema.optional(),
    expiresAt: isoInstantSchema.optional(),
    warning: z.string(),
  })
  .strict();
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;

export const apiKeyListItemSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    prefix: z.string(),
    scopes: z.array(apiKeyScopeSchema),
    createdAt: isoInstantSchema,
    lastUsedAt: isoInstantSchema.optional(),
    revokedAt: isoInstantSchema.optional(),
  })
  .strict();

export const entitlementCheckRequestSchema = z
  .object({ key: entitlementKeySchema, requested: z.number().int().nonnegative().default(1) })
  .strict();

export const entitlementCheckResponseSchema = z
  .object({
    key: entitlementKeySchema,
    allowed: z.boolean(),
    limit: z.union([z.number().int(), z.literal(-1), z.boolean()]),
    used: z.number().int().nonnegative().optional(),
    /** Present when denied so the UI can explain, not just block. */
    reason: z.string().optional(),
    requiredPlanKey: z.string().optional(),
  })
  .strict();
export type EntitlementCheckResponse = z.infer<typeof entitlementCheckResponseSchema>;

export const subscriptionSummarySchema = z
  .object({
    state: subscriptionStateSchema,
    plan: planSchema.pick({ id: true, key: true, name: true, prepaidOnly: true }),
    period: z.enum(["monthly", "yearly"]),
    amount: moneySchema,
    currentPeriodStart: isoInstantSchema,
    currentPeriodEnd: isoInstantSchema,
    /** Only set when the deployment cannot auto-charge: the manual renewal date. */
    renewalDueAt: isoInstantSchema.optional(),
    cancelAtPeriodEnd: z.boolean(),
    graceEndsAt: isoInstantSchema.optional(),
    recurringSupported: z.boolean(),
    entitlements: z.record(entitlementKeyStringSchema, z.union([z.number().int(), z.boolean()])),
    usage: z
      .array(
        z
          .object({
            key: entitlementKeySchema,
            used: z.number().int().nonnegative(),
            limit: z.union([z.number().int(), z.literal(-1)]),
          })
          .strict()
      )
      .optional(),
  })
  .strict();
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;

export const usageSummarySchema = z
  .object({
    periodStart: isoInstantSchema,
    periodEnd: isoInstantSchema,
    counters: z.array(
      z
        .object({
          key: entitlementKeySchema,
          used: z.number().int().nonnegative(),
          limit: z.union([z.number().int(), z.literal(-1)]),
          /** Billing treatment of the counted events, surfaced so it is not folklore. */
          counted: z.string(),
        })
        .strict()
    ),
  })
  .strict();
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const checkoutStartRequestSchema = z
  .object({
    planKey: z.string().min(1),
    period: z.enum(["monthly", "yearly"]),
    currency: z.string().length(3).optional(),
    country: z.string().length(2).optional(),
    /** Mobile money network for softpay-style flows, e.g. "mtn_bj". */
    network: z.string().max(24).optional(),
    customer: z
      .object({
        email: z.string().email(),
        name: z.string().min(1),
        phone: z.string().min(6).max(24).optional(),
      })
      .strict(),
    returnUrl: z.string().url().optional(),
  })
  .strict();

export const checkoutStartResponseSchema = z
  .object({
    intent: checkoutIntentSchema,
    /** Where the browser should go, when the provider hosts the payment page. */
    redirectUrl: z.string().url().optional(),
    /** Instructions for push-to-phone flows with no hosted page. */
    instructions: z.string().optional(),
  })
  .strict();
export type CheckoutStartResponse = z.infer<typeof checkoutStartResponseSchema>;

export const paymentStatusResponseSchema = z
  .object({
    intentId: z.string(),
    state: paymentStateSchema,
    /** Verified provider status, only present after a server-side verification. */
    providerStatus: z.string().optional(),
    subscriptionState: subscriptionStateSchema.optional(),
    verifiedAt: isoInstantSchema.optional(),
    /** Explicitly false until a verified transaction exists. */
    entitled: z.boolean(),
    message: z.string(),
    nextAction: z
      .enum(["none", "verify", "retry", "manual_renewal", "contact_support"])
      .default("none"),
  })
  .strict();
export type PaymentStatusResponse = z.infer<typeof paymentStatusResponseSchema>;

export const invoiceListResponseSchema = z
  .object({ items: z.array(invoiceSchema), taxNote: z.string() })
  .strict();

export const planListResponseSchema = z
  .object({
    items: z.array(planSchema),
    /** Currency the marketing page should default to for this visitor. */
    displayCurrency: z.string().length(3),
    recurringSupported: z.boolean(),
    billingModelNote: z.string(),
  })
  .strict();

export const moduleRunSummarySchema = z
  .object({
    module: moduleIdSchema,
    status: runStatusSchema,
    passed: z.number().int(),
    failed: z.number().int(),
    warnings: z.number().int(),
    errors: z.number().int(),
    lastRunAt: isoInstantSchema.optional(),
  })
  .strict();

export const overviewResponseSchema = z
  .object({
    workspace: workspaceSchema,
    projects: z.array(projectSchema),
    recentRuns: z.array(reportListItemSchema),
    modules: z.array(moduleRunSummarySchema),
    recentFailures: z.array(
      z
        .object({
          findingId: z.string(),
          title: z.string(),
          module: moduleIdSchema,
          severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
          status: testStatusSchema,
          detectedAt: isoInstantSchema,
          projectId: z.string(),
        })
        .strict()
    ),
    usage: usageSummarySchema,
    subscription: subscriptionSummarySchema,
  })
  .strict();
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

export const integrationSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    kind: z.enum(["github", "gitlab", "circleci", "generic_ci", "payment_adapter"]),
    label: z.string(),
    status: z.enum(["connected", "disabled", "error"]),
    createdAt: isoInstantSchema,
    /** Non-secret configuration only. Tokens are never echoed back. */
    config: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type IntegrationDto = z.infer<typeof integrationSchema>;
