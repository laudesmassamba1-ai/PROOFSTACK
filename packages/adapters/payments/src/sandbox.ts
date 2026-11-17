import type { PaymentState } from "@proofcore/contracts";
import type { Money } from "@proofcore/core";
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "@proofcore/core";
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentCapabilities,
  PaymentProvider,
  RefundInput,
  RefundResult,
  VerifiedTransaction,
  VerifiedWebhook,
  WebhookEvent,
} from "./provider.js";

/**
 * Deterministic sandbox provider.
 *
 * It exists so the whole billing path — intent → provider → return → verify →
 * webhook → entitlement — is executable and testable without credentials, and so
 * an automated test can never reach real money. Outcomes are scripted, not random.
 */
export class SandboxProvider implements PaymentProvider {
  static readonly SECRET = "proofcore_sandbox_webhook_secret";

  private readonly transactions = new Map<string, SandboxTransaction>();
  private readonly seenIdempotency = new Map<string, string>();

  constructor(
    private readonly options: {
      /** Scripted outcome for the next checkout, or per metadata marker. */
      outcome?: "success" | "declined" | "pending" | "cancelled" | "expired";
      /** Simulated verification latency in ms. */
      latencyMs?: number;
    } = {}
  ) {}

  getCapabilities(): PaymentCapabilities {
    return {
      provider: "sandbox",
      displayName: "PROOFCORE sandbox",
      automatedRecurring: false,
      hostedCheckout: true,
      pushToPhone: false,
      card: true,
      refunds: true,
      payouts: false,
      webhooks: true,
      webhookSignatureScheme: "saspay-hmac-sha256-v1",
      currencies: ["USD", "EUR", "XOF", "XAF"],
      countries: ["BJ", "CG", "FR", "US", "DE"],
      networks: ["sandbox_card"],
      apiVersion: "sandbox-1",
      rateLimitPerMinute: 6000,
      notes: [
        "No network, no money. Outcomes are scripted by the caller or by the `x-proofcore-outcome` metadata.",
        "Refunds are supported here so the refund state machine is testable; that does NOT mean the production provider supports refunds.",
      ],
    };
  }

  async createCheckout(
    input: CheckoutInput & { flow: "hosted" | "push" }
  ): Promise<CheckoutResult> {
    const scripted =
      (input.metadata["x-proofcore-outcome"] as
        | "success"
        | "declined"
        | "pending"
        | "cancelled"
        | "expired"
        | undefined) ??
      this.options.outcome ??
      "pending";
    const existing = this.seenIdempotency.get(input.idempotencyKey);
    if (existing) {
      const replay = this.transactions.get(existing);
      if (replay) {
        // Same key + same intent must replay the original result, like the real API.
        return {
          providerReference: replay.id,
          flow: replay.flow,
          state: replay.state,
          checkoutUrl: `http://localhost:5173/sandbox/checkout/${replay.id}`,
          providerStatus: replay.providerStatus,
        };
      }
    }

    const id = `sbx_${(await sha256Hex(input.idempotencyKey)).slice(0, 20)}`;
    const state: PaymentState =
      scripted === "success"
        ? "SUCCEEDED"
        : scripted === "pending"
          ? "PENDING"
          : scripted === "declined"
            ? "FAILED"
            : scripted === "cancelled"
              ? "CANCELLED"
              : "EXPIRED";
    const transaction: SandboxTransaction = {
      id,
      flow: input.flow,
      state,
      providerStatus: scripted.toUpperCase(),
      amount: input.amount,
      description: input.description,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
      terminal: scripted !== "pending",
    };
    this.transactions.set(id, transaction);
    this.seenIdempotency.set(input.idempotencyKey, id);

    return {
      providerReference: id,
      flow: input.flow,
      state,
      checkoutUrl: `http://localhost:5173/sandbox/checkout/${id}`,
      instructions:
        "Sandbox checkout: open the URL and choose an outcome to drive the state machine.",
      providerStatus: transaction.providerStatus,
    };
  }

  /** Sandbox control surface: lets a test or the demo page settle a payment. */
  settle(
    providerReference: string,
    outcome: "success" | "declined" | "cancelled" | "expired"
  ): void {
    const transaction = this.transactions.get(providerReference);
    if (!transaction) throw new Error(`sandbox: unknown transaction ${providerReference}`);
    transaction.state =
      outcome === "success"
        ? "SUCCEEDED"
        : outcome === "declined"
          ? "FAILED"
          : outcome === "cancelled"
            ? "CANCELLED"
            : "EXPIRED";
    transaction.providerStatus = outcome.toUpperCase();
    transaction.terminal = true;
  }

  async verifyTransaction(providerReference: string): Promise<VerifiedTransaction> {
    if (this.options.latencyMs)
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    const transaction = this.transactions.get(providerReference);
    if (!transaction) throw new Error(`sandbox: unknown transaction ${providerReference}`);
    return {
      providerReference,
      state: transaction.state,
      providerStatus: transaction.providerStatus,
      amount: transaction.amount,
      debitedAmount: transaction.amount,
      netAmount: transaction.amount,
      verifiedAt: new Date().toISOString(),
      raw: { sandbox: true, metadata: transaction.metadata },
    };
  }

  async verifyWebhook(input: {
    body: string;
    headers: Record<string, string>;
  }): Promise<VerifiedWebhook> {
    return verifyHmacWebhook(input, SandboxProvider.SECRET, "sandbox");
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const transaction = this.transactions.get(input.providerReference);
    if (!transaction) throw new Error(`sandbox: unknown transaction ${input.providerReference}`);
    const partial = input.amount !== undefined && input.amount.minor < transaction.amount.minor;
    transaction.state = partial ? "PARTIALLY_REFUNDED" : "REFUNDED";
    transaction.providerStatus = partial ? "PARTIALLY_REFUNDED" : "REFUNDED";
    return {
      state: transaction.state,
      providerReference: input.providerReference,
      providerStatus: transaction.providerStatus,
    };
  }

  /** Build a correctly signed webhook payload so tests exercise the real verifier. */
  async signWebhook(
    event: string,
    data: Record<string, unknown>,
    timestampSeconds = Math.floor(Date.now() / 1000)
  ): Promise<{ body: string; headers: Record<string, string> }> {
    const body = JSON.stringify({ event, data });
    const signature = await hmacSha256Hex(SandboxProvider.SECRET, `${timestampSeconds}.${body}`);
    return {
      body,
      headers: {
        "x-webhook-signature": signature,
        "x-webhook-timestamp": String(timestampSeconds),
        "x-webhook-event": event,
      },
    };
  }
}

interface SandboxTransaction {
  id: string;
  flow: "hosted" | "push";
  state: PaymentState;
  providerStatus: string;
  amount: Money;
  description: string;
  metadata: Record<string, string>;
  createdAt: string;
  terminal: boolean;
}

/**
 * Shared HMAC webhook verification, matching the documented scheme:
 * signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`), hex lowercase,
 * compared in constant time, with a 300-second timestamp window.
 *
 * The raw body string is used verbatim. Re-serialising the JSON would change byte
 * order or spacing and silently break every signature.
 */
export async function verifyHmacWebhook(
  input: { body: string; headers: Record<string, string> },
  secret: string,
  provider: "saspay" | "sandbox",
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<VerifiedWebhook> {
  const signature = findHeader(input.headers, "x-webhook-signature");
  const timestamp = findHeader(input.headers, "x-webhook-timestamp");
  const eventHeader = findHeader(input.headers, "x-webhook-event");

  if (!signature || !timestamp)
    return { valid: false, reason: "missing signature or timestamp header" };
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { valid: false, reason: "timestamp is not a unix integer" };
  if (Math.abs(nowSeconds - seconds) > 300)
    return { valid: false, reason: "timestamp outside the 300 second window" };

  const expected = await hmacSha256Hex(secret, `${timestamp}.${input.body}`);
  if (!timingSafeEqualHex(expected.toLowerCase(), signature.toLowerCase())) {
    return { valid: false, reason: "signature mismatch" };
  }

  let parsed: { event?: string; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(input.body) as typeof parsed;
  } catch {
    return { valid: false, reason: "body is not JSON" };
  }
  const type = eventHeader ?? parsed.event;
  if (!type) return { valid: false, reason: "no event name in header or body" };

  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const eventId =
    typeof data.id === "string"
      ? `${provider}:${type}:${data.id}`
      : `${provider}:${type}:${await sha256Hex(input.body)}`;

  const event: WebhookEvent = {
    provider,
    eventId,
    type,
    occurredAt: new Date(seconds * 1000).toISOString(),
    data: {
      ...(typeof data.id === "string" ? { transactionId: data.id } : {}),
      ...(typeof data.status === "string" ? { status: data.status } : {}),
      ...(typeof data.amount === "string" ? { amount: data.amount } : {}),
      ...(typeof data.currency === "string" ? { currency: data.currency } : {}),
      ...(typeof data.reference === "string" ? { reference: data.reference } : {}),
      ...(data.metadata && typeof data.metadata === "object"
        ? { metadata: data.metadata as Record<string, string> }
        : {}),
    },
  };
  return { valid: true, event };
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}
