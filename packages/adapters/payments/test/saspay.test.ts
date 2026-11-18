import { Money } from "@proofcore/core";
import { describe, expect, it } from "vitest";
import { PaymentProviderError } from "../src/provider.js";
import { mapPaymentStatus, SasPayProvider } from "../src/saspay.js";

/**
 * SasPay adapter tests.
 *
 * This is the layer that talks to money, so the tests assert the things that cost
 * real money when they are wrong:
 *  - amounts leave as decimal strings, never floats;
 *  - every money-moving call carries an Idempotency-Key;
 *  - a payment is never reported SUCCESS from anything but the provider's own
 *    `/verify/` answer;
 *  - capabilities never advertise a refund or a recurring API, because the published
 *    spec has neither.
 */

const KEY = "sk_test_0123456789abcdef";
const SECRET = "whsec_test_secret_value";

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

function provider(responses: Record<string, { status?: number; body: unknown }>): {
  instance: SasPayProvider;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ])
    );
    calls.push({
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers,
    });
    const key = `${method} ${url.pathname.split("/api/v1")[1]}`;
    const match = responses[key] ?? responses["*"];
    if (!match) {
      return new Response(JSON.stringify({ detail: `unmapped ${key}` }), { status: 404 });
    }
    return new Response(JSON.stringify(match.body), {
      status: match.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return {
    instance: new SasPayProvider({ apiKey: KEY, webhookSecret: SECRET, fetchImpl }),
    calls,
  };
}

describe("capabilities", () => {
  it("never advertises a refund or a recurring API, because the spec has neither", () => {
    const { instance } = provider({});
    const capabilities = instance.getCapabilities();
    expect(capabilities.refunds).toBe(false);
    expect(capabilities.automatedRecurring).toBe(false);
    expect(capabilities.hostedCheckout).toBe(true);
    expect(capabilities.webhooks).toBe(true);
    expect(capabilities.notes?.join(" ")).toContain("No refund endpoint");
    // The free-text note must not be the only guard.
    expect(instance).not.toHaveProperty("refund");
    expect(instance).not.toHaveProperty("createSubscription");
  });

  it("reports the environment from the key prefix", () => {
    const test = provider({}).instance.getCapabilities();
    expect(test.displayName).toContain("test");
    const live = new SasPayProvider({
      apiKey: "sk_live_0123456789abcdef",
      webhookSecret: SECRET,
      fetchImpl: fetch,
    }).getCapabilities();
    expect(live.displayName).toContain("live");
  });

  it("refuses to start without a key or a webhook secret", () => {
    expect(() => new SasPayProvider({ apiKey: "", webhookSecret: SECRET })).toThrow(
      /SASPAY_API_KEY/
    );
    expect(() => new SasPayProvider({ apiKey: KEY, webhookSecret: "" })).toThrow(
      /SASPAY_WEBHOOK_SECRET/
    );
  });
});

describe("amounts", () => {
  it("sends a decimal string, never a float", async () => {
    const { instance, calls } = provider({
      "POST /payments/softpay/": { body: { id: "pay_1", status: "PENDING" } },
    });
    await instance.createCheckout({
      amount: Money.of("XOF", 2500n), // XOF has a zero exponent: 2500 minor units = 2 500 F
      currency: "XOF",
      description: "Studio plan",
      idempotencyKey: "idem-1",
      flow: "push",
      push: { country: "BJ", network: "MTN" },
      customer: { email: "payer@example.com", name: "Ada Lovelace", phone: "+22990000000" },
    } as never);

    const body = calls[0]?.body as {
      amount: unknown;
      customer: { first_name: string; last_name: string };
    };
    expect(typeof body.amount).toBe("string");
    expect(body.amount).toBe("2500.00");
    expect(body.customer.first_name).toBe("Ada");
    expect(body.customer.last_name).toBe("Lovelace");
  });

  it("splits a single-word name without producing an empty last name", async () => {
    const { instance, calls } = provider({
      "POST /payments/softpay/": { body: { id: "pay_2", status: "PENDING" } },
    });
    await instance.createCheckout({
      amount: Money.of("XOF", 1000n),
      currency: "XOF",
      description: "Developer plan",
      idempotencyKey: "idem-2",
      flow: "push",
      push: { country: "BJ", network: "MTN" },
      customer: { email: "solo@example.com", name: "Cher" },
    } as never);
    const body = calls[0]?.body as { customer: { first_name: string; last_name: string } };
    expect(body.customer.first_name).toBe("Cher");
    expect(body.customer.last_name).toBe("Cher");
  });
});

describe("idempotency", () => {
  it("sends the Idempotency-Key header on a money-moving call", async () => {
    const { instance, calls } = provider({
      "POST /payments/softpay/": { body: { id: "pay_3", status: "PENDING" } },
    });
    await instance.createCheckout({
      amount: Money.of("XOF", 1000n),
      currency: "XOF",
      description: "Developer plan",
      idempotencyKey: "checkout-abc-123",
      flow: "push",
      push: { country: "BJ", network: "MTN" },
      customer: { email: "payer@example.com", name: "Payer One" },
    } as never);
    expect(calls[0]?.headers["idempotency-key"]).toBe("checkout-abc-123");
  });

  it("refuses a push checkout without country and network instead of guessing", async () => {
    const { instance } = provider({});
    await expect(
      instance.createCheckout({
        amount: Money.of("XOF", 1000n),
        currency: "XOF",
        description: "Developer plan",
        idempotencyKey: "idem-4",
        flow: "push",
        customer: { email: "payer@example.com", name: "Payer One" },
      } as never)
    ).rejects.toThrow(/country and network/);
  });
});

describe("verification", () => {
  it("reads the money truth from /verify/ and never from the session alone", async () => {
    const { instance, calls } = provider({
      "GET /payments/pay_9/verify/": {
        body: {
          id: "pay_9",
          status: "SUCCESS",
          currency: "XOF",
          requested_amount: "2500.00",
          debited_amount: "2500.00",
          net_amount: "2450.00",
          client_fee: "50.00",
        },
      },
    });
    const verified = await instance.verifyTransaction("pay_9");
    expect(verified.state).toBe("SUCCEEDED");
    expect(verified.amount.toProviderDecimal()).toBe("2500.00");
    expect(verified.netAmount?.toProviderDecimal()).toBe("2450.00");
    expect(verified.feeAmount?.toProviderDecimal()).toBe("50.00");
    expect(calls.at(-1)?.path).toContain("/payments/pay_9/verify/");
  });

  it("maps every provider status explicitly and treats an unknown one as failed", () => {
    expect(mapPaymentStatus("SUCCESS")).toBe("SUCCEEDED");
    expect(mapPaymentStatus("PAID")).toBe("SUCCEEDED");
    expect(mapPaymentStatus("PENDING")).toBe("PENDING");
    expect(mapPaymentStatus("FAILED")).toBe("FAILED");
    expect(mapPaymentStatus("CANCELLED")).toBe("CANCELLED");
    expect(mapPaymentStatus("EXPIRED")).toBe("EXPIRED");
    // An unknown status is never optimistically read as paid: it throws.
    expect(() => mapPaymentStatus("SOMETHING_NEW")).toThrow(/Unmapped SasPay status/);
    expect(() => mapPaymentStatus("")).toThrow(/Unmapped SasPay status/);
  });

  it("surfaces a provider refusal as an error instead of returning a fake success", async () => {
    const { instance } = provider({
      "GET /payments/missing/verify/": { status: 404, body: { detail: "Not found" } },
    });
    await expect(instance.verifyTransaction("missing")).rejects.toBeInstanceOf(
      PaymentProviderError
    );
  });
});

describe("webhooks", () => {
  it("rejects an unsigned payload and accepts a correctly signed one", async () => {
    const { instance } = provider({});
    const body = JSON.stringify({ event: "payment.succeeded", data: { id: "pay_1" } });
    const { createHmac } = await import("node:crypto");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");

    const accepted = await instance.verifyWebhook({
      body,
      headers: {
        "x-webhook-timestamp": timestamp,
        "x-webhook-signature": signature,
        "x-webhook-event": "payment.succeeded",
      },
    });
    expect(accepted.valid).toBe(true);
    expect(accepted.event?.eventId).toBe("saspay:payment.succeeded:pay_1");
    expect(accepted.event?.provider).toBe("saspay");

    const wrongSignature = await instance.verifyWebhook({
      body,
      headers: { "x-webhook-timestamp": timestamp, "x-webhook-signature": "deadbeef" },
    });
    expect(wrongSignature.valid).toBe(false);
    expect(wrongSignature.reason).toMatch(/signature mismatch/);

    const unsigned = await instance.verifyWebhook({ body, headers: {} });
    expect(unsigned.valid).toBe(false);
    expect(unsigned.reason).toMatch(/missing signature/);

    // A signature over a different body must not be accepted: this is the whole point
    // of signing the raw body rather than the parsed object.
    const tampered = await instance.verifyWebhook({
      body: body.replace("pay_1", "pay_2"),
      headers: { "x-webhook-timestamp": timestamp, "x-webhook-signature": signature },
    });
    expect(tampered.valid).toBe(false);
  });

  it("rejects a signature whose timestamp is outside the 300s window", async () => {
    const { instance } = provider({});
    const body = JSON.stringify({ event: "payment.succeeded", data: { id: "pay_1" } });
    const { createHmac } = await import("node:crypto");
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    const signature = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
    const stale = await instance.verifyWebhook({
      body,
      headers: { "x-webhook-timestamp": timestamp, "x-webhook-signature": signature },
    });
    expect(stale.valid).toBe(false);
    expect(stale.reason).toMatch(/300 second window/);
  });
});
