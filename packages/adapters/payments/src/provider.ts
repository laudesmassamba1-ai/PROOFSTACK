import type { PaymentState, ProviderKind } from "@proofcore/contracts";
import type { Money } from "@proofcore/core";

/**
 * The provider boundary.
 *
 * Every capability below is a *claim about the provider*, and the claims are
 * sourced from Docs/research/saspay-openapi.json. Nothing in the application is
 * allowed to infer a capability: recurring billing, refunds and payout support are
 * read from `getCapabilities()` and enforced by the billing layer.
 */

export interface PaymentCapabilities {
  readonly provider: ProviderKind;
  readonly displayName: string;
  /** True only if the provider can charge a saved mandate on a schedule by itself. */
  readonly automatedRecurring: boolean;
  readonly hostedCheckout: boolean;
  readonly pushToPhone: boolean;
  readonly card: boolean;
  readonly refunds: boolean;
  readonly payouts: boolean;
  readonly webhooks: boolean;
  readonly webhookSignatureScheme: "saspay-hmac-sha256-v1" | "none";
  readonly currencies: readonly string[];
  readonly countries: readonly string[];
  readonly networks: readonly string[];
  readonly apiVersion: string;
  readonly rateLimitPerMinute: number;
  /** Anything an integrator must know before trusting this adapter. */
  readonly notes: readonly string[];
}

export interface CheckoutInput {
  /** Unique per intent. A retry of the same intent MUST reuse the same key. */
  idempotencyKey: string;
  amount: Money;
  description: string;
  customer: { email: string; name: string; phone?: string };
  metadata: Record<string, string>;
  /** Where the provider sends the payer back. Carries no authority whatsoever. */
  returnUrl?: string;
  /** Push-to-phone (softpay) parameters, required when flow is "push". */
  push?: { country: string; network: string };
  expiresAt?: string;
}

export type CheckoutFlow = "hosted" | "push";

export interface CheckoutResult {
  /** Provider-side identifier we will verify later. */
  providerReference: string;
  /** Secondary id when the provider distinguishes session from transaction. */
  sessionReference?: string;
  flow: CheckoutFlow;
  state: PaymentState;
  /** Non-empty means the payer must be sent there or nothing happens. */
  checkoutUrl?: string;
  instructions?: string;
  providerStatus?: string;
  raw?: Record<string, unknown>;
}

export interface VerifiedTransaction {
  providerReference: string;
  /** Our controlled state, mapped from the provider's own vocabulary. */
  state: PaymentState;
  providerStatus: string;
  amount: Money;
  /** What the payer was actually debited, when the provider reports it. */
  debitedAmount?: Money;
  /** What the merchant receives, when reported. Never recomputed locally. */
  netAmount?: Money;
  feeAmount?: Money;
  externalReference?: string;
  verifiedAt: string;
  raw: Record<string, unknown>;
}

export interface VerifiedWebhook {
  valid: boolean;
  reason?: string;
  event?: WebhookEvent;
}

export interface WebhookEvent {
  provider: ProviderKind;
  /** Provider event id when present; otherwise a digest-derived stable id. */
  eventId: string;
  type: string;
  occurredAt: string;
  /** Only the fields billing needs. Never a full customer payload. */
  data: {
    transactionId?: string;
    status?: string;
    amount?: string;
    currency?: string;
    reference?: string;
    metadata?: Record<string, string>;
  };
}

export interface RefundInput {
  providerReference: string;
  amount?: Money;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  state: PaymentState;
  providerReference: string;
  providerStatus: string;
}

export interface PaymentProvider {
  createCheckout(input: CheckoutInput & { flow: CheckoutFlow }): Promise<CheckoutResult>;
  verifyTransaction(providerReference: string): Promise<VerifiedTransaction>;
  verifyWebhook(input: { body: string; headers: Record<string, string> }): Promise<VerifiedWebhook>;
  refund?(input: RefundInput): Promise<RefundResult>;
  getCapabilities(): PaymentCapabilities;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
