import type { PaymentState } from "@proofcore/contracts";
import { hmacSha256Hex, Money, sha256Hex, timingSafeEqualHex } from "@proofcore/core";
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
    const providerReference = encodeTransaction(transaction);
    this.transactions.set(providerReference, transaction);
    this.seenIdempotency.set(input.idempotencyKey, providerReference);

    return {
      providerReference,
      flow: input.flow,
      state,
      checkoutUrl: `http://localhost:5173/sandbox/checkout/${id}`,
      instructions:
        "Sandbox checkout: open the URL and choose an outcome to drive the state machine.",
      providerStatus: transaction.providerStatus,
    };
  }

  /**
   * Sandbox control surface: lets a test or the demo page settle a payment.
   *
   * Returns a self-contained reference carrying the settled state and amount. The
   * caller must persist it before finalising. Cloudflare may serve the checkout and
   * the settle request from different isolates, so an in-memory map alone would make
   * the settlement unreachable in production (`unknown transaction`).
   */
  settle(
    providerReference: string,
    outcome: "success" | "declined" | "cancelled" | "expired",
    fallback?: { amount: Money; metadata?: Record<string, string> }
  ): string {
    const transaction =
      this.transactions.get(providerReference) ??
      decodeTransaction(providerReference) ??
      (fallback
        ? {
            id: providerReference,
            flow: "hosted" as const,
            state: "PENDING" as PaymentState,
            providerStatus: "PENDING",
            amount: fallback.amount,
            description: "Sandbox checkout",
            metadata: fallback.metadata ?? {},
            createdAt: new Date().toISOString(),
            terminal: false,
          }
        : null);
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
    const settledReference = encodeTransaction(transaction);
    // Keep the in-process map useful for tests, but never require it to be shared.
    this.transactions.set(providerReference, transaction);
    this.transactions.set(settledReference, transaction);
    return settledReference;
  }

  async verifyTransaction(providerReference: string): Promise<VerifiedTransaction> {
    if (this.options.latencyMs)
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    const transaction =
      this.transactions.get(providerReference) ?? decodeTransaction(providerReference);
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
    const transaction =
      this.transactions.get(input.providerReference) ?? decodeTransaction(input.providerReference);
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
 * A 1-byte version + the fields verification needs. The reference is data, not a
 * credential: it is only trusted after the intent id, workspace and amount checks
 * in the billing engine have passed. It carries no customer or secret material.
 */
interface SandboxReference {
  v: 1;
  id: string;
  flow: "hosted" | "push";
  state: PaymentState;
  status: string;
  currency: string;
  minor: string;
  createdAt: string;
  metadata: Record<string, string>;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64URL[(triple >> 18) & 63];
    out += BASE64URL[(triple >> 12) & 63];
    if (b !== undefined) out += BASE64URL[(triple >> 6) & 63];
    if (c !== undefined) out += BASE64URL[triple & 63];
  }
  return out;
}

function base64UrlDecode(input: string): string | null {
  if (input.length % 4 === 1) return null;
  const values: number[] = [];
  for (const char of input) {
    const value = BASE64URL.indexOf(char);
    if (value < 0) return null;
    values.push(value);
  }
  const bytes: number[] = [];
  for (let i = 0; i < values.length; i += 4) {
    const a = values[i] ?? 0;
    const b = values[i + 1];
    const c = values[i + 2];
    const d = values[i + 3];
    const triple = (a << 18) | ((b ?? 0) << 12) | ((c ?? 0) << 6) | (d ?? 0);
    bytes.push((triple >> 16) & 255);
    if (c !== undefined) bytes.push((triple >> 8) & 255);
    if (d !== undefined) bytes.push(triple & 255);
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

function encodeTransaction(transaction: SandboxTransaction): string {
  const payload: SandboxReference = {
    v: 1,
    id: transaction.id,
    flow: transaction.flow,
    state: transaction.state,
    status: transaction.providerStatus,
    currency: transaction.amount.currency,
    minor: transaction.amount.minor.toString(),
    createdAt: transaction.createdAt,
    metadata: transaction.metadata,
  };
  return `sbx_${base64UrlEncode(JSON.stringify(payload))}`;
}

function decodeTransaction(reference: string): SandboxTransaction | null {
  if (!reference.startsWith("sbx_")) return null;
  const decoded = base64UrlDecode(reference.slice(4));
  if (!decoded) return null;
  let payload: SandboxReference;
  try {
    payload = JSON.parse(decoded) as SandboxReference;
  } catch {
    return null;
  }
  if (
    payload.v !== 1 ||
    typeof payload.id !== "string" ||
    (payload.flow !== "hosted" && payload.flow !== "push") ||
    typeof payload.state !== "string" ||
    typeof payload.status !== "string" ||
    typeof payload.currency !== "string" ||
    typeof payload.minor !== "string" ||
    !/^\d+$/.test(payload.minor) ||
    typeof payload.createdAt !== "string" ||
    typeof payload.metadata !== "object" ||
    payload.metadata === null
  ) {
    return null;
  }
  return {
    id: payload.id,
    flow: payload.flow,
    state: payload.state,
    providerStatus: payload.status,
    amount: Money.of(payload.currency, BigInt(payload.minor)),
    description: "Sandbox checkout",
    metadata: payload.metadata,
    createdAt: payload.createdAt,
    terminal: payload.state !== "PENDING" && payload.state !== "PROCESSING",
  };
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
