import type { ProofstackConfig } from "@proofstack/contracts";
import { ProofstackError } from "@proofstack/core";
import type {
  CheckoutRequest,
  CheckoutResponse,
  OrderState,
  PaymentUnderTest,
  WebhookDelivery,
} from "./harness.js";

/**
 * HTTP payment target.
 *
 * FLOW talks to the customer's own application over HTTP, using endpoints they
 * already have. Nothing here invents a route: the three URLs come from the project
 * config, and a missing one degrades the capability rather than guessing an address.
 *
 * The token is read from an environment variable at call time, never stored in the
 * config object, so it cannot end up in a report or a committed file.
 */

export interface HttpPaymentTargetOptions {
  config: ProofstackConfig;
  name?: string;
  fetchImpl?: typeof fetch;
  /** Resolves a bearer token. Injected so this package stays runtime-agnostic. */
  tokenProvider?: () => string | undefined;
}

export interface FlowTargetConfig {
  checkoutUrl?: string;
  orderUrlTemplate?: string;
  webhookUrl?: string;
  refundUrl?: string;
  tokenEnvVar?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Read the FLOW target settings out of the project config.
 *
 * The config schema is owned by `@proofstack/contracts`; FLOW reads the optional
 * `modules.flow.target` block when it is present and reports a clear configuration
 * error when it is not. Keeping this in one function means the CLI, the API and the
 * tests all resolve the target the same way.
 */
export function readFlowTargetConfig(config: ProofstackConfig): FlowTargetConfig {
  const flow = config.modules.flow as unknown as {
    target?: {
      checkoutUrl?: string;
      orderUrlTemplate?: string;
      webhookUrl?: string;
      refundUrl?: string;
      tokenEnvVar?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
    };
  };
  return flow.target ?? {};
}

export class HttpPaymentTarget implements PaymentUnderTest {
  readonly name: string;
  readonly capabilities: {
    checkout: boolean;
    orderReadback: boolean;
    webhookReceiver: boolean;
    refund: boolean;
  };

  private readonly target: FlowTargetConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenProvider?: () => string | undefined;

  constructor(options: HttpPaymentTargetOptions) {
    this.target = readFlowTargetConfig(options.config);
    this.name = options.name ?? `http:${this.target.checkoutUrl ?? "unset"}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tokenProvider = options.tokenProvider;
    this.capabilities = {
      checkout: Boolean(this.target.checkoutUrl),
      orderReadback: Boolean(this.target.orderUrlTemplate),
      webhookReceiver: Boolean(this.target.webhookUrl),
      refund: Boolean(this.target.refundUrl),
    };
  }

  async checkout(input: CheckoutRequest): Promise<CheckoutResponse> {
    if (!this.target.checkoutUrl) {
      throw new ProofstackError({
        message: "FLOW target has no checkoutUrl",
        category: "CONFIGURATION",
        code: "flow_checkout_unconfigured",
      });
    }
    const response = await this.request("POST", this.target.checkoutUrl, {
      amount: input.amount,
      currency: input.currency,
      order_reference: input.orderReference,
      scenario: input.scenario,
      idempotency_key: input.idempotencyKey,
    });
    const body = await parseBody(response);
    return {
      accepted: response.ok,
      ...(typeof body.order_id === "string" ? { orderId: body.order_id } : {}),
      ...(typeof body.payment_id === "string" ? { paymentId: body.payment_id } : {}),
      ...(typeof body.redirect_url === "string" ? { redirectUrl: body.redirect_url } : {}),
      ...(typeof body.state === "string" ? { state: body.state } : {}),
      httpStatus: response.status,
      ...(isRecord(body.errors) ? { errors: body.errors as Record<string, string> } : {}),
      rawSample: JSON.stringify(body).slice(0, 2_000),
    };
  }

  async readOrder(orderReference: string): Promise<OrderState | undefined> {
    const template = this.target.orderUrlTemplate;
    if (!template) return undefined;
    const url = template.replace("{reference}", encodeURIComponent(orderReference));
    const response = await this.request("GET", url);
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new ProofstackError({
        message: `order readback failed with HTTP ${response.status}`,
        category: "NETWORK",
        code: "flow_order_readback_failed",
        retryable: response.status >= 500,
      });
    }
    const body = await parseBody(response);
    const orderId = typeof body.order_id === "string" ? body.order_id : orderReference;
    const status = typeof body.status === "string" ? body.status : "unknown";
    // The product must report how many orders exist for the reference; without it we
    // cannot detect duplicates, so we say so rather than assuming one.
    const orderCount =
      typeof body.order_count === "number" ? body.order_count : Array.isArray(body.orders) ? body.orders.length : 1;

    return {
      orderId,
      status,
      orderCount,
      ...(typeof body.amount === "string" ? { amount: body.amount } : {}),
      ...(typeof body.currency === "string" ? { currency: body.currency } : {}),
      ...(typeof body.paid_at === "string" ? { paidAt: body.paid_at } : {}),
      ...(typeof body.refunded_amount === "string" ? { refundedAmount: body.refunded_amount } : {}),
    };
  }

  async deliverWebhook(input: { body: string; headers: Record<string, string> }): Promise<WebhookDelivery> {
    if (!this.target.webhookUrl) {
      throw new ProofstackError({
        message: "FLOW target has no webhookUrl",
        category: "CONFIGURATION",
        code: "flow_webhook_unconfigured",
      });
    }
    // The body is sent byte-for-byte: re-serialising it would invalidate the signature
    // and make a correct receiver look broken.
    const response = await this.request("POST", this.target.webhookUrl, input.body, {
      ...input.headers,
      "content-type": "application/json",
    }, true);
    const text = await response.text().catch(() => "");
    return { status: response.status, body: text.slice(0, 2_000) };
  }

  async refund(input: { paymentId: string; amount?: string }): Promise<{ accepted: boolean; state?: string }> {
    if (!this.target.refundUrl) {
      throw new ProofstackError({
        message: "FLOW target has no refundUrl",
        category: "CONFIGURATION",
        code: "flow_refund_unconfigured",
      });
    }
    const response = await this.request("POST", this.target.refundUrl, {
      payment_id: input.paymentId,
      ...(input.amount ? { amount: input.amount } : {}),
    });
    const body = await parseBody(response);
    return {
      accepted: response.ok,
      ...(typeof body.state === "string" ? { state: body.state } : {}),
    };
  }

  private async request(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    raw = false,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.target.timeoutMs ?? 15_000);
    const headers: Record<string, string> = {
      accept: "application/json",
      ...(this.target.headers ?? {}),
      ...extraHeaders,
    };
    const token = this.tokenProvider?.();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined && !raw) headers["content-type"] = "application/json";

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: raw ? (body as string) : JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ProofstackError({
        message: `FLOW request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
        category: "NETWORK",
        code: "flow_request_failed",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function parseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: text.slice(0, 2_000) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
