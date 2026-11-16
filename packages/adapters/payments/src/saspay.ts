import type { PaymentState } from "@proofstack/contracts";
import { iso, Money, ProofstackError } from "@proofstack/core";
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentCapabilities,
  PaymentProvider,
  VerifiedTransaction,
  VerifiedWebhook,
} from "./provider.js";
import { PaymentProviderError } from "./provider.js";
import { verifyHmacWebhook } from "./sandbox.js";

/**
 * SasPay adapter — written against the published OpenAPI 3.1 document stored at
 * Docs/research/saspay-openapi.json (fetched 2026-11-16).
 *
 * Verified facts that shape this file:
 *  - servers: https://sandbox-api.saspay.me/api/v1 and https://api.saspay.me/api/v1
 *  - amounts are decimal strings ("2500.00"), never floats
 *  - money-moving routes take an Idempotency-Key: /payments/softpay/,
 *    /payouts/initialize/, /wallet-transfers/, /payments/{id}/retry/
 *  - the authoritative payment status comes from GET /payments/{id}/verify/
 *    (statuses PENDING | SUCCESS | FAILED | CANCELLED)
 *  - hosted sessions: POST /checkout-sessions/ → GET /checkout-sessions/{id}/status/
 *    (PENDING | PAID | EXPIRED | CANCELLED + transaction_id/status/reference)
 *  - webhooks are created only in the merchant dashboard; signature is
 *    HMAC-SHA256 over `${timestamp}.${rawBody}`, hex lowercase, 300s window
 *  - the spec exposes NO refund route and NO recurring/subscription route
 *
 * Consequences enforced here: `refund` is not implemented, `automatedRecurring` is
 * false, and no endpoint outside the list above is ever called.
 */

export const SASPAY_SANDBOX_BASE = "https://sandbox-api.saspay.me/api/v1";
export const SASPAY_LIVE_BASE = "https://api.saspay.me/api/v1";

export interface SasPayConfig {
  /** sk_test_… in development, sk_live_… in production. Read from the environment. */
  apiKey: string;
  /** Signing secret shown once when the webhook is created in the dashboard. */
  webhookSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Fee handling: ADD_ON makes the payer pay fees, DEDUCTED takes them from the net. */
  feeChargeMode?: "ADD_ON" | "DEDUCTED";
  requestTimeoutMs?: number;
}

export class SasPayProvider implements PaymentProvider {
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly feeChargeMode: "ADD_ON" | "DEDUCTED";
  private readonly timeoutMs: number;

  constructor(config: SasPayConfig) {
    if (!config.apiKey) {
      throw new ProofstackError({
        message: "SASPAY_API_KEY is empty; the SasPay adapter refuses to start without a key",
        category: "CONFIGURATION",
        code: "saspay_key_missing",
      });
    }
    if (!config.webhookSecret) {
      throw new ProofstackError({
        message: "SASPAY_WEBHOOK_SECRET is empty; unsigned webhook acceptance is not an option",
        category: "CONFIGURATION",
        code: "saspay_webhook_secret_missing",
      });
    }
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    this.baseUrl = (
      config.baseUrl ??
      (config.apiKey.startsWith("sk_test_") ? SASPAY_SANDBOX_BASE : SASPAY_LIVE_BASE)
    ).replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.feeChargeMode = config.feeChargeMode ?? "ADD_ON";
    this.timeoutMs = config.requestTimeoutMs ?? 15_000;
  }

  getCapabilities(): PaymentCapabilities {
    const key = this.apiKey.startsWith("sk_test_") ? "test" : "live";
    return {
      provider: "saspay",
      displayName: `SasPay (${key})`,
      automatedRecurring: false,
      hostedCheckout: true,
      pushToPhone: true,
      card: true,
      refunds: false,
      payouts: true,
      webhooks: true,
      webhookSignatureScheme: "saspay-hmac-sha256-v1",
      // The public GET /countries/ list is an ISO reference table (202 entries), not a
      // statement of chargeability. Chargeable networks and rates require an
      // authenticated GET /pricing/my-rates/, which cannot be read without a key.
      currencies: ["XOF", "XAF"],
      countries: ["BJ", "CG", "CI", "SN", "TG", "ML", "NE", "CM", "GA", "CF"],
      networks: [],
      apiVersion: "1.0.0",
      rateLimitPerMinute: 300,
      notes: [
        "No refund endpoint exists in the OpenAPI spec: refunds must be handled administratively, never claimed as API-driven.",
        "No recurring/subscription endpoint exists: paid periods are prepaid and renewed manually.",
        "GET /networks/ and GET /pricing/my-rates/ need authentication (verified 401 without a key), so the network list is empty until a key is present.",
        "Payouts require the server IP to be whitelisted, otherwise 403 ip_not_whitelisted.",
      ],
    };
  }

  async createCheckout(
    input: CheckoutInput & { flow: "hosted" | "push" }
  ): Promise<CheckoutResult> {
    const amount = input.amount.toProviderDecimal();
    if (input.flow === "push") {
      if (!input.push) {
        throw new ProofstackError({
          message: "softpay requires country and network",
          category: "VALIDATION",
          code: "saspay_push_incomplete",
        });
      }
      const [firstName, ...rest] = input.customer.name.trim().split(/\s+/);
      const body = {
        amount,
        currency: input.amount.currency,
        country: input.push.country,
        network: input.push.network,
        description: input.description,
        fee_charge_mode: this.feeChargeMode,
        customer: {
          email: input.customer.email,
          first_name: firstName ?? input.customer.name,
          last_name: rest.join(" ") || firstName || "—",
          phone: input.customer.phone ?? "",
        },
        metadata: input.metadata,
      };
      const data = (await this.request(
        "POST",
        "/payments/softpay/",
        body,
        input.idempotencyKey
      )) as {
        id: string;
        status?: string;
        checkout_url?: string | null;
      };
      return {
        providerReference: data.id,
        flow: "push",
        state: mapPaymentStatus(data.status ?? "PENDING"),
        ...(data.checkout_url ? { checkoutUrl: data.checkout_url } : {}),
        ...(data.checkout_url
          ? {
              instructions:
                "A payment page was returned: the payer must complete it before any charge happens.",
            }
          : { instructions: "A push was sent to the payer's phone. Confirm it on the device." }),
        providerStatus: data.status ?? "PENDING",
      };
    }

    const body = {
      amount,
      currency: input.amount.currency,
      description: input.description,
      customer_email: input.customer.email,
      customer_name: input.customer.name,
      ...(input.customer.phone ? { customer_phone: input.customer.phone } : {}),
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
      fee_charge_mode: this.feeChargeMode,
      metadata: input.metadata,
    };
    const data = (await this.request("POST", "/checkout-sessions/", body)) as {
      id: string;
      slug?: string;
      checkout_url?: string;
      status?: string;
    };
    return {
      providerReference: data.id,
      flow: "hosted",
      state: mapSessionStatus(data.status ?? "PENDING"),
      ...(data.checkout_url ? { checkoutUrl: data.checkout_url } : {}),
      providerStatus: data.status ?? "PENDING",
      raw: { slug: data.slug },
    };
  }

  /**
   * Verification is a two-step read for hosted sessions: the session tells us
   * whether the payer finished, the transaction tells us the money truth. Only the
   * transaction amounts are used for accounting (`debited_amount`, `net_amount`).
   */
  async verifyTransaction(providerReference: string): Promise<VerifiedTransaction> {
    let transactionId = providerReference;
    let sessionStatus: string | undefined;

    if (providerReference.startsWith("cs_") || providerReference.length >= 32) {
      try {
        const session = (await this.request(
          "GET",
          `/checkout-sessions/${encodeURIComponent(providerReference)}/status/`
        )) as {
          status?: string;
          transaction_id?: string | null;
          transaction_status?: string | null;
        };
        sessionStatus = session.status;
        if (session.transaction_id) transactionId = session.transaction_id;
      } catch (error) {
        // Not a session id: fall through and treat the reference as a transaction.
        if (!(error instanceof PaymentProviderError) || error.status !== 404) throw error;
      }
    }

    const data = (await this.request(
      "GET",
      `/payments/${encodeURIComponent(transactionId)}/verify/`
    )) as SasPayVerifyResponse;
    const state = mapPaymentStatus(data.status);
    const currency = data.currency ?? "XOF";
    const money = (value: string | null | undefined): Money | undefined =>
      value === undefined || value === null
        ? undefined
        : Money.fromDecimalString(String(value), currency);

    return {
      providerReference: transactionId,
      state,
      providerStatus: sessionStatus ? `${data.status} (session ${sessionStatus})` : data.status,
      amount: money(data.requested_amount) ?? Money.of(currency, 0n),
      ...(money(data.debited_amount) ? { debitedAmount: money(data.debited_amount) } : {}),
      ...(money(data.net_amount) ? { netAmount: money(data.net_amount) } : {}),
      ...(money(data.client_fee) ? { feeAmount: money(data.client_fee) } : {}),
      ...(data.external_reference ? { externalReference: data.external_reference } : {}),
      verifiedAt: iso(),
      raw: { reference: data.reference, status: data.status, currency: data.currency },
    };
  }

  async verifyWebhook(input: {
    body: string;
    headers: Record<string, string>;
  }): Promise<VerifiedWebhook> {
    return verifyHmacWebhook(input, this.webhookSecret, "saspay");
  }

  /**
   * `refund` is deliberately absent: the specification has no refund route. Any
   * attempt to call it would be an invented endpoint, which the project rules forbid.
   */

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    // Idempotency is optional at the API level and mandatory in practice: a retried
    // debit without a key is a second charge.
    if (idempotencyKey && method === "POST") headers["idempotency-key"] = idempotencyKey;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new PaymentProviderError(
        `SasPay request failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
        "network_error",
        true
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      const parsed = safeParse(text);
      const code =
        typeof parsed?.error === "object" && parsed.error && "code" in parsed.error
          ? String((parsed.error as { code?: string }).code)
          : `http_${response.status}`;
      const message =
        typeof parsed?.error === "string"
          ? parsed.error
          : ((parsed?.error as { message?: string } | undefined)?.message ??
            `HTTP ${response.status}`);
      throw new PaymentProviderError(
        message,
        response.status,
        code,
        // 429 must be spaced out, 5xx may recover; the rest are terminal.
        response.status === 429 || response.status >= 500,
        { path, ...(parsed?.field_errors ? { fieldErrors: parsed.field_errors } : {}) }
      );
    }
    const parsed = safeParse(text);
    if (!parsed)
      throw new PaymentProviderError("SasPay returned a non-JSON body", 502, "bad_response", false);
    return parsed.data ?? parsed;
  }
}

interface SasPayVerifyResponse {
  id?: string;
  reference?: string;
  status: string;
  requested_amount?: string | null;
  debited_amount?: string | null;
  net_amount?: string | null;
  client_fee?: string | null;
  currency?: string | null;
  external_reference?: string | null;
}

function safeParse(text: string): {
  data?: unknown;
  error?: unknown;
  field_errors?: Record<string, string[]>;
} | null {
  try {
    return JSON.parse(text) as never;
  } catch {
    return null;
  }
}

/** Provider vocabulary → our controlled state machine. */
export function mapPaymentStatus(status: string): PaymentState {
  switch (status.toUpperCase()) {
    case "SUCCESS":
    case "PAID":
    case "COMPLETED":
      return "SUCCEEDED";
    case "PENDING":
    case "PROCESSING":
      return "PENDING";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    case "PARTIALLY_REFUNDED":
      return "PARTIALLY_REFUNDED";
    case "REFUNDED":
      return "REFUNDED";
    default:
      // An unknown provider status is not a success. It is surfaced, not guessed.
      throw new ProofstackError({
        message: `Unmapped SasPay status ${JSON.stringify(status)}`,
        category: "PROVIDER",
        code: "unknown_payment_status",
        details: { status },
      });
  }
}

function mapSessionStatus(status: string): PaymentState {
  if (status.toUpperCase() === "PAID") return "SUCCEEDED";
  return mapPaymentStatus(status);
}
