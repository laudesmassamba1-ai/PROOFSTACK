import { Money, ProofstackError, hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "@proofstack/core";
import type { PaymentState } from "@proofstack/contracts";

/**
 * The FLOW payment surface.
 *
 * FLOW never charges real money. It drives a *payment endpoint the customer owns*
 * (their staging checkout, their webhook receiver) and judges the observable
 * behaviour: did the order get created once, did the duplicate webhook double the
 * order, did a bad signature get rejected.
 *
 * The `PaymentUnderTest` interface is deliberately small. Every method maps to
 * something the customer's application already does; if they cannot expose it, the
 * case is SKIPPED with a reason rather than guessed at.
 */

export interface CheckoutRequest {
  /** Amount as a decimal string, exactly as the product's API takes it. */
  amount: string;
  currency: string;
  /** Synthetic order reference; the product must be idempotent on it. */
  orderReference: string;
  /** Which provider outcome the product should simulate, when it supports it. */
  scenario: FlowScenario;
  idempotencyKey: string;
}

export interface CheckoutResponse {
  accepted: boolean;
  /** Product-side order id, when it returns one. */
  orderId?: string;
  /** Product-side payment/transaction id. */
  paymentId?: string;
  /** Where the payer would be sent. Its presence proves nothing about payment. */
  redirectUrl?: string;
  state?: string;
  httpStatus?: number;
  errors?: Record<string, string>;
  rawSample?: string;
}

export interface OrderState {
  orderId: string;
  /** The product's own status vocabulary, read back from its API. */
  status: string;
  /** How many distinct orders exist for the order reference. Duplicates are the bug. */
  orderCount: number;
  amount?: string;
  currency?: string;
  paidAt?: string;
  refundedAmount?: string;
}

export interface WebhookDelivery {
  /** HTTP status the product's receiver answered with. */
  status: number;
  body?: string;
}

export interface PaymentUnderTest {
  readonly name: string;
  readonly capabilities: {
    checkout: boolean;
    orderReadback: boolean;
    webhookReceiver: boolean;
    refund: boolean;
  };
  /** Create a checkout / payment intent in the product. */
  checkout?(input: CheckoutRequest): Promise<CheckoutResponse>;
  /** Read the order back, including how many orders exist for the reference. */
  readOrder?(orderReference: string): Promise<OrderState | undefined>;
  /** POST a (possibly forged or duplicated) webhook body to the product's receiver. */
  deliverWebhook?(input: { body: string; headers: Record<string, string> }): Promise<WebhookDelivery>;
  /** Trigger the product's refund path. */
  refund?(input: { paymentId: string; amount?: string }): Promise<{ accepted: boolean; state?: string }>;
}

export type FlowScenario =
  | "checkout_success"
  | "checkout_declined"
  | "checkout_cancelled"
  | "checkout_timeout"
  | "webhook_duplicate"
  | "webhook_delayed"
  | "webhook_out_of_order"
  | "webhook_invalid_signature"
  | "order_missing_confirmation"
  | "order_duplicate"
  | "refund_flow"
  | "inconsistent_state";

/**
 * The provider vocabulary FLOW speaks when it forges webhooks. These are the
 * statuses a real gateway sends; the product is expected to map them, and a product
 * that treats an unknown status as "paid" is exactly the bug this catches.
 */
export const WEBHOOK_STATUSES = ["SUCCESS", "PENDING", "FAILED", "CANCELLED", "EXPIRED"] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

/**
 * Build a webhook body in the shape a gateway sends, and sign it the documented way:
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, hex lowercase.
 *
 * The raw body is produced once and reused byte-for-byte. Re-serialising it would
 * change key order or spacing and break the signature — which is the single most
 * common way an integrator "proves" their signature check is broken when it is not.
 */
export async function buildSignedWebhook(input: {
  secret: string;
  event: string;
  data: Record<string, unknown>;
  timestampSeconds?: number;
}): Promise<{ body: string; headers: Record<string, string> }> {
  const timestamp = input.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event: input.event, data: input.data });
  const signature = await hmacSha256Hex(input.secret, `${timestamp}.${body}`);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": String(timestamp),
      "x-webhook-event": input.event,
    },
  };
}

/** A deliberately wrong signature, for the rejection test. */
export async function buildForgedWebhook(input: {
  event: string;
  data: Record<string, unknown>;
  timestampSeconds?: number;
}): Promise<{ body: string; headers: Record<string, string> }> {
  const timestamp = input.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event: input.event, data: input.data });
  // Valid-looking hex, wrong value: this is what an attacker can produce.
  const forged = (await sha256Hex(`${timestamp}.${body}`)).slice(0, 64);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": forged,
      "x-webhook-timestamp": String(timestamp),
      "x-webhook-event": input.event,
    },
  };
}

/**
 * Verify a webhook the way the product *should*, used by FLOW's self-check so the
 * harness itself is proven before it judges anyone else.
 */
export async function verifySignedWebhook(input: {
  secret: string;
  body: string;
  headers: Record<string, string>;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<{ valid: boolean; reason?: string }> {
  const signature = header(input.headers, "x-webhook-signature");
  const timestamp = header(input.headers, "x-webhook-timestamp");
  if (!signature || !timestamp) return { valid: false, reason: "missing signature or timestamp" };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { valid: false, reason: "timestamp is not an integer" };

  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - seconds) > tolerance) return { valid: false, reason: "timestamp outside tolerance" };

  const expected = await hmacSha256Hex(input.secret, `${timestamp}.${input.body}`);
  if (!timingSafeEqualHex(expected.toLowerCase(), signature.toLowerCase())) {
    return { valid: false, reason: "signature mismatch" };
  }
  return { valid: true };
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * The state a payment must be in for a given scenario, expressed as the *product's*
 * expected outcome. FLOW asserts against this, not against our own vocabulary,
 * because the product under test is the thing being judged.
 */
export interface ScenarioExpectation {
  scenario: FlowScenario;
  /** Human description used in the report. */
  description: string;
  /** Statuses the product's order may legitimately end in. */
  acceptableOrderStatuses: readonly string[];
  /** Whether the product must have created exactly one order. */
  exactlyOneOrder: boolean;
  /** Whether money must be considered collected. */
  expectsPaid: boolean;
}

export const SCENARIO_EXPECTATIONS: Record<FlowScenario, ScenarioExpectation> = {
  checkout_success: {
    scenario: "checkout_success",
    description: "A successful sandbox payment creates exactly one paid order.",
    acceptableOrderStatuses: ["paid", "PAID", "completed", "COMPLETED", "confirmed", "CONFIRMED"],
    exactlyOneOrder: true,
    expectsPaid: true,
  },
  checkout_declined: {
    scenario: "checkout_declined",
    description: "A declined payment must not create a paid order.",
    acceptableOrderStatuses: ["failed", "FAILED", "declined", "DECLINED", "pending", "PENDING", "cancelled", "CANCELLED"],
    exactlyOneOrder: true,
    expectsPaid: false,
  },
  checkout_cancelled: {
    scenario: "checkout_cancelled",
    description: "A cancelled payment must not create a paid order.",
    acceptableOrderStatuses: ["cancelled", "CANCELLED", "abandoned", "ABANDONED", "pending", "PENDING"],
    exactlyOneOrder: true,
    expectsPaid: false,
  },
  checkout_timeout: {
    scenario: "checkout_timeout",
    description: "A timed-out payment must stay pending, never silently succeed.",
    acceptableOrderStatuses: ["pending", "PENDING", "expired", "EXPIRED", "failed", "FAILED"],
    exactlyOneOrder: true,
    expectsPaid: false,
  },
  webhook_duplicate: {
    scenario: "webhook_duplicate",
    description: "The same webhook delivered twice must not create a second order or a second credit.",
    acceptableOrderStatuses: ["paid", "PAID", "completed", "COMPLETED", "confirmed", "CONFIRMED"],
    exactlyOneOrder: true,
    expectsPaid: true,
  },
  webhook_delayed: {
    scenario: "webhook_delayed",
    description: "A webhook arriving long after the redirect must still settle the order once.",
    acceptableOrderStatuses: ["paid", "PAID", "completed", "COMPLETED", "confirmed", "CONFIRMED"],
    exactlyOneOrder: true,
    expectsPaid: true,
  },
  webhook_out_of_order: {
    scenario: "webhook_out_of_order",
    description: "A late PENDING after SUCCESS must not roll the order backwards.",
    acceptableOrderStatuses: ["paid", "PAID", "completed", "COMPLETED", "confirmed", "CONFIRMED"],
    exactlyOneOrder: true,
    expectsPaid: true,
  },
  webhook_invalid_signature: {
    scenario: "webhook_invalid_signature",
    description: "A forged webhook must be rejected and must change nothing.",
    acceptableOrderStatuses: ["pending", "PENDING", "created", "CREATED", "awaiting_payment", "AWAITING_PAYMENT"],
    exactlyOneOrder: true,
    expectsPaid: false,
  },
  order_missing_confirmation: {
    scenario: "order_missing_confirmation",
    description: "A paid payment must always produce a confirmable order.",
    acceptableOrderStatuses: ["paid", "PAID", "completed", "COMPLETED", "confirmed", "CONFIRMED"],
    exactlyOneOrder: true,
    expectsPaid: true,
  },
  order_duplicate: {
    scenario: "order_duplicate",
    description: "Retrying the same checkout must not create a second order.",
    acceptableOrderStatuses: ["paid", "PAID", "completed", "COMPLETED", "confirmed", "CONFIRMED"],
    exactlyOneOrder: true,
    expectsPaid: true,
  },
  refund_flow: {
    scenario: "refund_flow",
    description: "A refund must move the order to a refunded state without deleting it.",
    acceptableOrderStatuses: ["refunded", "REFUNDED", "partially_refunded", "PARTIALLY_REFUNDED"],
    exactlyOneOrder: true,
    expectsPaid: false,
  },
  inconsistent_state: {
    scenario: "inconsistent_state",
    description: "The order status and the payment status must agree with each other.",
    acceptableOrderStatuses: [
      "paid",
      "PAID",
      "completed",
      "COMPLETED",
      "confirmed",
      "CONFIRMED",
      "pending",
      "PENDING",
      "failed",
      "FAILED",
    ],
    exactlyOneOrder: true,
    expectsPaid: false,
  },
};

/** Map a product's status string to whether it means "money collected". */
export function looksPaid(status: string): boolean {
  const normalised = status.trim().toLowerCase();
  return ["paid", "completed", "confirmed", "succeeded", "success", "captured", "settled"].includes(normalised);
}

/** Map a product's status to whether it is terminal. */
export function looksTerminal(status: string): boolean {
  const normalised = status.trim().toLowerCase();
  return [
    "paid",
    "completed",
    "confirmed",
    "succeeded",
    "success",
    "captured",
    "settled",
    "failed",
    "declined",
    "cancelled",
    "canceled",
    "expired",
    "refunded",
    "partially_refunded",
  ].includes(normalised);
}

/**
 * Compare the product's payment status against the order status. This is the check
 * that catches the classic integration bug: the webhook says PAID, the order says
 * pending, and the customer has been charged for nothing.
 */
export function statusesAgree(orderStatus: string, paymentStatus: string): { agree: boolean; reason?: string } {
  const orderPaid = looksPaid(orderStatus);
  const paymentPaid = looksPaid(paymentStatus);
  if (orderPaid === paymentPaid) return { agree: true };
  return {
    agree: false,
    reason: `order is "${orderStatus}" while the payment is "${paymentStatus}"`,
  };
}

/** A synthetic order reference that is unique per run and per scenario. */
export function syntheticOrderReference(runId: string, scenario: FlowScenario): string {
  return `PS-${runId.slice(-8).toUpperCase()}-${scenario.toUpperCase().replaceAll("_", "-")}`;
}

/** Money for a scenario, as the decimal string a product API expects. */
export function scenarioAmount(scenario: FlowScenario, currency = "XOF"): string {
  const amount = Money.of(currency, currency === "XOF" ? 2500n : 2500n);
  return amount.toProviderDecimal();
}

export class FlowHarnessError extends ProofstackError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super({ message, category: "CONFIGURATION", code, ...(details ? { details } : {}) });
    this.name = "FlowHarnessError";
  }
}

/** The controlled payment states FLOW asserts against, for reporting. */
export const FLOW_PAYMENT_STATES: readonly PaymentState[] = [
  "CREATED",
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
];
