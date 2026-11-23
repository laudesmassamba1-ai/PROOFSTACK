import { proofcoreConfigSchema } from "@proofcore/contracts";
import { FixedClock, Logger } from "@proofcore/core";
import { runEngine } from "@proofcore/engine";
import { describe, expect, it } from "vitest";
import {
  buildSignedWebhook,
  type CheckoutRequest,
  type CheckoutResponse,
  createFlowProvider,
  executeJourney,
  HttpPaymentTarget,
  type JourneyPage,
  looksPaid,
  type OrderState,
  type PaymentUnderTest,
  SCENARIO_EXPECTATIONS,
  statusesAgree,
  verifySignedWebhook,
  type WebhookDelivery,
} from "../src/index.js";

/**
 * FLOW tests.
 *
 * The point of these is not that FLOW runs. It is that FLOW *catches* the defects it
 * claims to catch. So most tests build a deliberately broken product and assert that
 * the run reports FAILED with the right code.
 */

const config = proofcoreConfigSchema.parse({
  project: { name: "FLOW fixture", baseUrl: "http://localhost:3000" },
  environment: "staging",
  modules: {
    world: { enabled: false, target: { kind: "none" } },
    flow: { enabled: true, paymentMode: "simulated" },
    exit: { enabled: false },
  },
  enabledModules: ["flow"],
});

const SECRET = "test_webhook_secret";

interface FakeProductOptions {
  /** Create a second order on a retried checkout. */
  duplicateOnRetry?: boolean;
  /** Accept a webhook with a bad signature. */
  acceptForgedWebhook?: boolean;
  /** Create a second order for a duplicate webhook. */
  duplicateOnWebhook?: boolean;
  /** Leave the order pending even after a success webhook. */
  neverConfirm?: boolean;
  /** Report a status that disagrees with the payment. */
  inconsistentStatus?: boolean;
  /** Refuse to acknowledge duplicate webhooks with a 500. */
  errorOnDuplicate?: boolean;
  /** Roll the order back when a stale PENDING arrives. */
  regressOnStale?: boolean;
  /** Delete the order on refund. */
  deleteOnRefund?: boolean;
}

/** A product that behaves correctly unless told otherwise. */
function fakeProduct(options: FakeProductOptions = {}): PaymentUnderTest {
  const orders = new Map<string, { id: string; status: string; count: number; amount: string }>();
  const payments = new Map<string, string>();
  const seenWebhooks = new Set<string>();
  let orderSeq = 0;

  const target: PaymentUnderTest = {
    name: "fake-product",
    capabilities: { checkout: true, orderReadback: true, webhookReceiver: true, refund: true },

    async checkout(input: CheckoutRequest): Promise<CheckoutResponse> {
      const existing = orders.get(input.orderReference);
      if (existing && !options.duplicateOnRetry) {
        return {
          accepted: true,
          orderId: existing.id,
          paymentId: payments.get(input.orderReference),
          state: existing.status,
        };
      }
      orderSeq += 1;
      const id = `ord_${orderSeq}`;
      // A sandbox gateway settles a success scenario immediately; the webhook
      // scenarios below start from an unpaid order and are settled by the webhook.
      const _status = "pending";
      // A sandbox settles a success scenario immediately. The "broken" flags make the
      // fixture misbehave in the specific way each defect test needs.
      const settled =
        input.scenario === "checkout_success" &&
        !options.inconsistentStatus &&
        !options.neverConfirm
          ? "paid"
          : "pending";
      // The reported state is what the API tells the client, which may lie about the
      // stored order. That gap is exactly what the inconsistent_state case hunts.
      const reported = options.inconsistentStatus ? "paid" : settled;
      orders.set(input.orderReference, {
        id,
        status: settled,
        count: existing ? existing.count + 1 : 1,
        amount: input.amount,
      });
      payments.set(input.orderReference, `pay_${orderSeq}`);
      return { accepted: true, orderId: id, paymentId: `pay_${orderSeq}`, state: reported };
    },

    async readOrder(reference: string): Promise<OrderState | undefined> {
      const order = orders.get(reference);
      if (!order) return undefined;
      return {
        orderId: order.id,
        status: order.status,
        orderCount: order.count,
        amount: order.amount,
        currency: "XOF",
      };
    },

    async deliverWebhook(input: {
      body: string;
      headers: Record<string, string>;
    }): Promise<WebhookDelivery> {
      const verified = await verifySignedWebhook({
        secret: SECRET,
        body: input.body,
        headers: input.headers,
      });
      if (!verified.valid && !options.acceptForgedWebhook) {
        return { status: 401, body: "invalid signature" };
      }

      const parsed = JSON.parse(input.body) as {
        event: string;
        data: { id: string; status: string; reference: string };
      };
      const reference = parsed.data.reference;

      if (seenWebhooks.has(input.body)) {
        if (options.errorOnDuplicate) return { status: 500, body: "duplicate" };
        if (options.duplicateOnWebhook) {
          const order = orders.get(reference);
          if (order) order.count += 1;
        }
        return { status: 200, body: "ok" };
      }
      seenWebhooks.add(input.body);

      const order = orders.get(reference);
      if (!order) return { status: 404, body: "unknown order" };

      if (parsed.data.status === "SUCCESS" && !options.neverConfirm) {
        order.status = options.inconsistentStatus ? "pending" : "paid";
      }
      if (parsed.data.status === "PENDING" && options.regressOnStale) {
        order.status = "pending";
      }
      return { status: 200, body: "ok" };
    },

    async refund(input: { paymentId: string }) {
      for (const [reference, order] of orders) {
        if (payments.get(reference) === input.paymentId) {
          if (options.deleteOnRefund) {
            orders.delete(reference);
            return { accepted: true, state: "refunded" };
          }
          order.status = "refunded";
          return { accepted: true, state: "refunded" };
        }
      }
      return { accepted: false };
    },
  };
  return target;
}

async function runFlow(target: PaymentUnderTest | undefined, scenarios?: readonly string[]) {
  const provider = createFlowProvider({
    ...(target === undefined ? {} : { target }),
    webhookSecret: SECRET,
    ...(scenarios === undefined ? {} : { scenarios: scenarios as never }),
  });
  const result = await runEngine({
    config,
    providers: [provider],
    clock: new FixedClock("2026-03-01T10:00:00.000Z"),
    logger: new Logger({ level: "error" }),
    projectId: "proj_test",
    workspaceId: "ws_test",
  });
  return result.run;
}

function caseFor(run: Awaited<ReturnType<typeof runFlow>>, id: string) {
  const found = run.moduleRuns[0]?.cases.find((c) => c.id === id);
  if (!found) throw new Error(`case ${id} not found in run`);
  return found;
}

describe("FLOW HTTP target", () => {
  it("does not call an HTTP 200 with field errors an accepted checkout", async () => {
    const parsed = proofcoreConfigSchema.parse({
      project: { name: "FLOW target", baseUrl: "http://localhost:3000" },
      environment: "staging",
      modules: {
        world: { enabled: false, target: { kind: "none" } },
        flow: {
          enabled: true,
          target: { checkoutUrl: "https://shop.example.test/checkout" },
        },
        exit: { enabled: false },
      },
      enabledModules: ["flow"],
    });
    const target = new HttpPaymentTarget({
      config: parsed,
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ errors: { amount: "invalid amount" } }),
        }) as Response) as typeof fetch,
    });

    const result = await target.checkout({
      amount: "2500.00",
      currency: "XOF",
      orderReference: "order-1",
      scenario: "checkout_declined",
      idempotencyKey: "idem-1",
    });
    expect(result.accepted).toBe(false);
    expect(result.errors?.amount).toBe("invalid amount");
  });
});

describe("FLOW harness primitives", () => {
  it("signs and verifies a webhook the documented way", async () => {
    const signed = await buildSignedWebhook({
      secret: SECRET,
      event: "payment.success",
      data: { id: "txn_1", status: "SUCCESS" },
    });
    const verdict = await verifySignedWebhook({
      secret: SECRET,
      body: signed.body,
      headers: signed.headers,
    });
    expect(verdict.valid).toBe(true);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const signed = await buildSignedWebhook({
      secret: "wrong_secret",
      event: "payment.success",
      data: { id: "txn_1" },
    });
    const verdict = await verifySignedWebhook({
      secret: SECRET,
      body: signed.body,
      headers: signed.headers,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe("signature mismatch");
  });

  it("rejects a re-serialised body, which is why the raw body is used", async () => {
    const signed = await buildSignedWebhook({ secret: SECRET, event: "x", data: { id: "1" } });
    const reserialised = JSON.stringify(JSON.parse(signed.body), null, 2);
    const verdict = await verifySignedWebhook({
      secret: SECRET,
      body: reserialised,
      headers: signed.headers,
    });
    expect(verdict.valid).toBe(false);
  });

  it("knows which statuses mean money was collected", () => {
    expect(looksPaid("paid")).toBe(true);
    expect(looksPaid("COMPLETED")).toBe(true);
    expect(looksPaid("pending")).toBe(false);
    expect(looksPaid("failed")).toBe(false);
  });

  it("flags an order that disagrees with its payment", () => {
    expect(statusesAgree("paid", "SUCCESS").agree).toBe(true);
    expect(statusesAgree("pending", "SUCCESS").agree).toBe(false);
    expect(statusesAgree("paid", "FAILED").agree).toBe(false);
  });

  it("declares an expectation for every scenario the config can request", () => {
    for (const scenario of [
      "checkout_success",
      "checkout_declined",
      "checkout_cancelled",
      "checkout_timeout",
      "webhook_duplicate",
      "webhook_delayed",
      "webhook_out_of_order",
      "webhook_invalid_signature",
      "order_missing_confirmation",
      "order_duplicate",
      "refund_flow",
      "inconsistent_state",
    ] as const) {
      expect(SCENARIO_EXPECTATIONS[scenario]).toBeDefined();
    }
  });
});

describe("FLOW against a correct product", () => {
  it("passes the success, duplicate-webhook and forged-signature scenarios", async () => {
    const run = await runFlow(fakeProduct(), [
      "checkout_success",
      "webhook_duplicate",
      "webhook_invalid_signature",
    ]);
    expect(caseFor(run, "flow/checkout_success").status).toBe("PASSED");
    expect(caseFor(run, "flow/webhook_duplicate").status).toBe("PASSED");
    expect(caseFor(run, "flow/webhook_invalid_signature").status).toBe("PASSED");
  });

  it("reports NOT_CONFIGURED, with the reason, when no payment target is declared", async () => {
    const run = await runFlow(undefined, ["checkout_success"]);
    const testCase = caseFor(run, "flow/checkout_success");
    expect(testCase.status).toBe("NOT_CONFIGURED");
    expect(testCase.skippedReason).toContain("no payment target configured");
    expect(run.status).not.toBe("COMPLETED");
  });

  it("reports NOT_APPLICABLE when the product has no checkout surface at all", async () => {
    // The scenario cannot be asked of a product that never had a checkout: an answer,
    // not a defect, and still not a pass.
    const run = await runFlow(
      {
        capabilities: { checkout: false },
        checkout: undefined,
      } as unknown as Parameters<typeof runFlow>[0],
      ["checkout_success"]
    );
    const testCase = caseFor(run, "flow/checkout_success");
    expect(testCase.status).toBe("NOT_APPLICABLE");
    expect(run.status).not.toBe("COMPLETED");
  });
});

describe("FLOW browser journeys", () => {
  it("executes steps in order and stops at a failed assertion", async () => {
    const calls: string[] = [];
    const page: JourneyPage = {
      navigate: async (url) => void calls.push(`navigate:${url}`),
      click: async (selector) => void calls.push(`click:${selector}`),
      fill: async (selector, value) => void calls.push(`fill:${selector}=${value}`),
      select: async (selector, value) => void calls.push(`select:${selector}=${value}`),
      submit: async (selector) => void calls.push(`submit:${selector ?? "enter"}`),
      waitFor: async (input) =>
        void calls.push(`wait:${input.selector ?? input.text ?? input.url}`),
      text: async () => "Commande confirmée",
      url: async () => "https://shop.example/confirmation",
      screenshot: async () => new Uint8Array([1, 2, 3]),
      api: async () => 200,
    };
    const journey = {
      id: "checkout",
      name: "Checkout",
      startUrl: "https://shop.example/cart",
      destructive: false,
      steps: [
        { id: "s1", action: "click" as const, target: "#pay", timeoutMs: 5000, optional: false },
        {
          id: "s2",
          action: "assertText" as const,
          value: "confirmée",
          timeoutMs: 5000,
          optional: false,
        },
      ],
    };
    const result = await executeJourney(journey, page, {
      baseUrl: "https://shop.example",
      runId: "run_test",
    });
    expect(result.steps).toBe(2);
    expect(calls).toEqual(["navigate:https://shop.example/cart", "click:#pay"]);
  });

  it("reports the failing step instead of passing silently", async () => {
    const page = {
      navigate: async () => undefined,
      click: async () => undefined,
      fill: async () => undefined,
      select: async () => undefined,
      submit: async () => undefined,
      waitFor: async () => undefined,
      text: async () => "page sans confirmation",
      url: async () => "https://shop.example/cart",
      screenshot: async () => new Uint8Array(),
      api: async () => 200,
    } satisfies JourneyPage;
    await expect(
      executeJourney(
        {
          id: "failing",
          name: "Failing",
          startUrl: "https://shop.example/cart",
          destructive: false,
          steps: [
            {
              id: "confirm",
              action: "assertText" as const,
              value: "Merci",
              timeoutMs: 5000,
              optional: false,
            },
          ],
        },
        page,
        { baseUrl: "https://shop.example", runId: "run_test" }
      )
    ).rejects.toThrow(/confirm/);
  });
});

describe("FLOW catches real defects", () => {
  it("fails when a retried checkout creates a second order", async () => {
    const run = await runFlow(fakeProduct({ duplicateOnRetry: true }), ["order_duplicate"]);
    const testCase = caseFor(run, "flow/order_duplicate");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("duplicate_order_created");
  });

  it("fails when a duplicate webhook creates a second order", async () => {
    const run = await runFlow(fakeProduct({ duplicateOnWebhook: true }), ["webhook_duplicate"]);
    const testCase = caseFor(run, "flow/webhook_duplicate");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("duplicate_order_from_webhook");
  });

  it("fails when a forged webhook is accepted", async () => {
    const run = await runFlow(fakeProduct({ acceptForgedWebhook: true }), [
      "webhook_invalid_signature",
    ]);
    const testCase = caseFor(run, "flow/webhook_invalid_signature");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("forged_webhook_accepted");
  });

  it("fails when a paid payment never confirms the order", async () => {
    const run = await runFlow(fakeProduct({ neverConfirm: true }), ["order_missing_confirmation"]);
    const testCase = caseFor(run, "flow/order_missing_confirmation");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("missing_order_confirmation");
  });

  it("fails when the order status disagrees with the payment status", async () => {
    const run = await runFlow(fakeProduct({ inconsistentStatus: true }), ["inconsistent_state"]);
    const testCase = caseFor(run, "flow/inconsistent_state");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("inconsistent_payment_state");
  });

  it("fails when a refund deletes the order instead of marking it", async () => {
    const run = await runFlow(fakeProduct({ deleteOnRefund: true }), ["refund_flow"]);
    const testCase = caseFor(run, "flow/refund_flow");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("refund_deleted_order");
  });

  it("fails when a stale PENDING rolls a paid order backwards", async () => {
    const run = await runFlow(fakeProduct({ regressOnStale: true }), ["webhook_out_of_order"]);
    const testCase = caseFor(run, "flow/webhook_out_of_order");
    expect(testCase.status).toBe("FAILED");
    expect(testCase.failure?.code).toBe("order_not_paid_after_webhook");
  });
});
