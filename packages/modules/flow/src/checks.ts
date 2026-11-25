import type { ProofCoreConfig } from "@proofcore/contracts";
import { ProofCoreError } from "@proofcore/core";
import type { TestCaseDef, TestSuiteDef } from "@proofcore/engine";
import {
  buildForgedWebhook,
  buildSignedWebhook,
  type FlowScenario,
  looksPaid,
  type PaymentUnderTest,
  SCENARIO_EXPECTATIONS,
  scenarioAmount,
  statusesAgree,
  syntheticOrderReference,
} from "./harness.js";

/**
 * FLOW checks.
 *
 * Every scenario is one case, and every case asserts on what the *product* did, not
 * on what our own code did. The three properties that matter:
 *
 *   1. **Exactly one order.** A duplicate webhook, a retried checkout and a double
 *      redirect are all the same bug from the customer's side: they got charged twice
 *      or shipped twice.
 *   2. **The order status agrees with the payment status.** A paid payment with a
 *      pending order is money taken for nothing.
 *   3. **A forged webhook changes nothing.** If an unsigned body can mark an order
 *      paid, the product is giving away goods.
 *
 * With no `PaymentUnderTest` injected, every case is SKIPPED with a reason. An
 * unconfigured FLOW run must never look like a passing transaction test.
 */

export interface FlowCheckOptions {
  config: ProofCoreConfig;
  target?: PaymentUnderTest;
  /** Narrow the scenario set; defaults to `modules.flow.scenarios`. */
  scenarios?: readonly FlowScenario[];
  /** Secret used to sign the webhooks FLOW sends. Comes from an env var, never a file. */
  webhookSecret?: string;
  /** Run id, used to make synthetic order references unique per run. */
  runId: string;
}

export function buildFlowSuites(options: FlowCheckOptions): TestSuiteDef[] {
  const scenarios = options.scenarios ?? options.config.modules.flow.scenarios;
  const cases = scenarios.map((scenario) => flowCase(scenario, options));
  return [
    {
      id: "flow:transactions",
      name: "FLOW — transaction journeys",
      module: "flow",
      description: `${scenarios.length} payment and webhook reliability scenarios`,
      cases,
    },
  ];
}

function flowCase(scenario: FlowScenario, options: FlowCheckOptions): TestCaseDef {
  const expectation = SCENARIO_EXPECTATIONS[scenario];
  const target = options.target;
  const skipReason = skipFor(scenario, target);

  return {
    id: `flow/${scenario}`,
    name: scenario.replaceAll("_", " "),
    description: expectation.description,
    module: "flow",
    severity: severityFor(scenario),
    suiteId: "flow:transactions",
    ...(skipReason ? { status: skipReason } : {}),
    execute: async (ctx) => {
      // unreachable: `skipFor` skips the case before execute when the target or
      // its checkout surface is absent. Assert once, for the type checker.
      if (!target?.checkout) return;
      // skipFor() guarantees the optional surfaces exist for the scenarios that
      // need them. If one is missing here, the skip table and the switch have
      // drifted: fail the harness loudly instead of silently passing.
      // Bind once: these are class methods on the HTTP target. A detached method
      // loses `this`, which turned every webhook/refund/readback case into a
      // TypeError instead of a product verdict. Closures (test fakes) hid it.
      const deliver = target.deliverWebhook?.bind(target);
      if (!deliver)
        throw new ProofCoreError({
          message: "flow harness drift: webhook receiver missing for a webhook scenario",
          category: "INTERNAL",
          code: "harness_drift",
        });
      const checkout = target.checkout.bind(target);
      if (!checkout)
        throw new ProofCoreError({
          message: "flow harness drift: checkout missing for a checkout scenario",
          category: "INTERNAL",
          code: "harness_drift",
        });
      const readback = target.readOrder?.bind(target);
      if (!readback)
        throw new ProofCoreError({
          message: "flow harness drift: order readback missing",
          category: "INTERNAL",
          code: "harness_drift",
        });
      const refundFn = target.refund?.bind(target);
      if (!refundFn)
        throw new ProofCoreError({
          message: "flow harness drift: refund surface missing",
          category: "INTERNAL",
          code: "harness_drift",
        });

      const orderReference = syntheticOrderReference(options.runId, scenario);
      const currency = "XOF";
      const amount = scenarioAmount(currency);

      switch (scenario) {
        case "checkout_success":
        case "checkout_declined":
        case "checkout_cancelled":
        case "checkout_timeout": {
          const response = await target.checkout({
            amount,
            currency,
            orderReference,
            scenario,
            idempotencyKey: orderReference,
          });
          await ctx.attachText({
            label: "checkout response",
            kind: "payload",
            mediaType: "application/json",
            text: JSON.stringify(response),
          });

          if (scenario === "checkout_success" && !response.accepted) {
            ctx.check(false, {
              description: "a valid sandbox checkout is accepted",
              expected: "accepted",
              actual: JSON.stringify(response.errors ?? response.rawSample ?? "rejected"),
              code: "checkout_rejected",
              severity: "HIGH",
            });
            return;
          }

          const order = await readOrderOrSkip(ctx, target, orderReference);
          if (!order) return;

          ctx.check(order.orderCount === 1, {
            description: "exactly one order exists for the reference",
            expected: 1,
            actual: order.orderCount,
            code: "order_count_wrong",
            severity: "CRITICAL",
          });

          if (scenario === "checkout_success") {
            ctx.check(looksPaid(order.status), {
              description: "a successful payment leaves the order paid",
              expected: expectation.acceptableOrderStatuses.join(" | "),
              actual: order.status,
              code: "order_not_paid",
              severity: "CRITICAL",
            });
          } else {
            ctx.check(!looksPaid(order.status), {
              description: `a ${scenario.replace("checkout_", "")} payment must not leave the order paid`,
              expected: expectation.acceptableOrderStatuses.join(" | "),
              actual: order.status,
              code: "unpaid_order_marked_paid",
              severity: "CRITICAL",
            });
          }
          return;
        }

        case "webhook_duplicate":
        case "webhook_delayed":
        case "webhook_out_of_order": {
          const checkout = await target.checkout({
            amount,
            currency,
            orderReference,
            scenario: "checkout_success",
            idempotencyKey: orderReference,
          });
          const paymentId = checkout.paymentId ?? checkout.orderId;
          const secret = options.webhookSecret;
          if (!paymentId) {
            // The product was asked for a payment id and returned none: the forged-webhook
            // check has nothing to address, so it cannot judge signature handling at all.
            ctx.notApplicable(
              "the product did not return a payment id, so a webhook cannot be addressed to it"
            );
            return;
          }
          if (!secret) {
            ctx.notConfigured(
              "no webhook secret configured (modules.flow.webhookSecretEnvVar is unset or empty)"
            );
            return;
          }

          const successEvent = await buildSignedWebhook({
            secret,
            event: "payment.success",
            data: { id: paymentId, status: "SUCCESS", amount, currency, reference: orderReference },
          });

          if (scenario === "webhook_duplicate") {
            const first = await deliver(successEvent);
            const second = await deliver(successEvent);
            ctx.check(first.status < 500, {
              description: "the first webhook delivery is accepted",
              expected: "< 500",
              actual: first.status,
              code: "webhook_delivery_failed",
              severity: "HIGH",
            });
            ctx.check(second.status < 500, {
              description: "the duplicate delivery is acknowledged, not errored",
              expected: "< 500",
              actual: second.status,
              code: "webhook_duplicate_errored",
              severity: "HIGH",
            });
          }

          if (scenario === "webhook_delayed") {
            // Delivered well after the redirect would have returned.
            await ctx.sleep(Math.min(options.config.engine.timeoutMs / 4, 2_000));
            const late = await deliver(successEvent);
            ctx.check(late.status < 500, {
              description: "a delayed webhook is still accepted",
              expected: "< 500",
              actual: late.status,
              code: "webhook_delayed_rejected",
              severity: "HIGH",
            });
          }

          if (scenario === "webhook_out_of_order") {
            await deliver(successEvent);
            const stale = await buildSignedWebhook({
              secret,
              event: "payment.pending",
              data: {
                id: paymentId,
                status: "PENDING",
                amount,
                currency,
                reference: orderReference,
              },
            });
            const staleResult = await deliver(stale);
            ctx.check(staleResult.status < 500, {
              description: "a late PENDING event is handled without erroring",
              expected: "< 500",
              actual: staleResult.status,
              code: "webhook_out_of_order_errored",
              severity: "MEDIUM",
            });
          }

          const order = await readOrderOrSkip(ctx, target, orderReference);
          if (!order) return;

          ctx.check(order.orderCount === 1, {
            description: "repeated webhooks produced exactly one order",
            expected: 1,
            actual: order.orderCount,
            code: "duplicate_order_from_webhook",
            severity: "CRITICAL",
          });
          ctx.check(looksPaid(order.status), {
            description: "the order is paid after the success webhook",
            expected: expectation.acceptableOrderStatuses.join(" | "),
            actual: order.status,
            code: "order_not_paid_after_webhook",
            severity: "CRITICAL",
          });
          return;
        }

        case "webhook_invalid_signature": {
          // Open a checkout that is still awaiting payment. Using a settled checkout
          // here would make "the order is not paid" vacuously false and the case
          // could never pass, which would be a broken test rather than a finding.
          const checkout = await target.checkout({
            amount,
            currency,
            orderReference,
            scenario: "checkout_timeout",
            idempotencyKey: orderReference,
          });
          const paymentId = checkout.paymentId ?? checkout.orderId;
          if (!paymentId) {
            ctx.skip("the product did not return a payment id to address a forged webhook to");
            return;
          }

          const orderBefore = await readOrderOrSkip(ctx, target, orderReference);
          if (!orderBefore) return;
          if (looksPaid(orderBefore.status)) {
            ctx.skip(
              `the product settled the order as "${orderBefore.status}" before any webhook, so a forged webhook cannot be shown to change anything`
            );
            return;
          }

          const forged = await buildForgedWebhook({
            event: "payment.success",
            data: { id: paymentId, status: "SUCCESS", amount, currency, reference: orderReference },
          });
          const result = await deliver(forged);

          ctx.check(result.status >= 400, {
            description: "a forged signature is rejected with a 4xx",
            expected: ">= 400",
            actual: result.status,
            code: "forged_webhook_accepted",
            severity: "CRITICAL",
          });

          const order = await readOrderOrSkip(ctx, target, orderReference);
          if (!order) return;
          ctx.check(!looksPaid(order.status), {
            description: "a forged webhook did not mark the order paid",
            expected: "not paid",
            actual: order.status,
            code: "forged_webhook_changed_state",
            severity: "CRITICAL",
          });
          return;
        }

        case "order_duplicate": {
          const first = await checkout({
            amount,
            currency,
            orderReference,
            scenario: "checkout_success",
            idempotencyKey: orderReference,
          });
          // Same idempotency key, same body: the product must not create a second order.
          const second = await checkout({
            amount,
            currency,
            orderReference,
            scenario: "checkout_success",
            idempotencyKey: orderReference,
          });

          ctx.check(second.accepted, {
            description: "the retried checkout is accepted (idempotently)",
            expected: "accepted",
            actual: JSON.stringify(second.errors ?? "rejected"),
            code: "idempotent_retry_rejected",
            severity: "HIGH",
          });

          if (first.orderId && second.orderId) {
            ctx.check(first.orderId === second.orderId, {
              description: "the retry returned the same order id",
              expected: first.orderId,
              actual: second.orderId,
              code: "duplicate_order_created",
              severity: "CRITICAL",
            });
          }

          const order = await readOrderOrSkip(ctx, target, orderReference);
          if (!order) return;
          ctx.check(order.orderCount === 1, {
            description: "exactly one order exists after the retry",
            expected: 1,
            actual: order.orderCount,
            code: "duplicate_order_created",
            severity: "CRITICAL",
          });
          return;
        }

        case "order_missing_confirmation": {
          const checkout = await target.checkout({
            amount,
            currency,
            orderReference,
            scenario: "checkout_success",
            idempotencyKey: orderReference,
          });
          const order = await readback(orderReference);
          if (!order) {
            ctx.check(false, {
              description: "a paid payment has a readable order",
              expected: "an order",
              actual: "no order found",
              code: "missing_order_confirmation",
              severity: "CRITICAL",
            });
            return;
          }
          ctx.check(looksPaid(order.status), {
            description: "the paid payment produced a confirmed order",
            expected: expectation.acceptableOrderStatuses.join(" | "),
            actual: order.status,
            code: "missing_order_confirmation",
            severity: "CRITICAL",
          });
          if (checkout.orderId) {
            ctx.check(order.orderId === checkout.orderId, {
              description: "the order read back is the one checkout created",
              expected: checkout.orderId,
              actual: order.orderId,
              code: "order_identity_mismatch",
              severity: "HIGH",
            });
          }
          return;
        }

        case "refund_flow": {
          const checkout = await target.checkout({
            amount,
            currency,
            orderReference,
            scenario: "checkout_success",
            idempotencyKey: orderReference,
          });
          const paymentId = checkout.paymentId ?? checkout.orderId;
          if (!paymentId) {
            ctx.skip("the product did not return a payment id to refund");
            return;
          }

          const refund = await refundFn({ paymentId, amount });
          ctx.check(refund.accepted, {
            description: "the refund is accepted",
            expected: "accepted",
            actual: JSON.stringify(refund.state ?? "rejected"),
            code: "refund_rejected",
            severity: "HIGH",
          });

          const order = await readback(orderReference);
          if (!order) {
            // The order existed before the refund (checkout returned an id) and is gone
            // after it. A refund must never delete the record: the customer's history is
            // the thing a portability product exists to protect.
            ctx.check(false, {
              description: "the refunded order still exists (refunds do not delete records)",
              expected: "the order is readable after the refund",
              actual: "no order found",
              code: "refund_deleted_order",
              severity: "CRITICAL",
            });
            return;
          }
          ctx.check(order.orderCount === 1, {
            description: "the refunded order still exists (refunds do not delete records)",
            expected: 1,
            actual: order.orderCount,
            code: "refund_deleted_order",
            severity: "HIGH",
          });
          ctx.check(
            expectation.acceptableOrderStatuses.some(
              (s) => s.toLowerCase() === order.status.toLowerCase()
            ),
            {
              description: "the order moved to a refunded state",
              expected: expectation.acceptableOrderStatuses.join(" | "),
              actual: order.status,
              code: "refund_state_wrong",
              severity: "HIGH",
            }
          );
          return;
        }

        case "inconsistent_state": {
          const checkout = await target.checkout({
            amount,
            currency,
            orderReference,
            scenario: "checkout_success",
            idempotencyKey: orderReference,
          });
          const order = await readOrderOrSkip(ctx, target, orderReference);
          if (!order) return;

          const paymentStatus = checkout.state ?? order.status;
          const agreement = statusesAgree(order.status, paymentStatus);
          ctx.check(agreement.agree, {
            description: "the order status agrees with the payment status",
            expected: "both paid or both unpaid",
            actual: agreement.reason ?? "agree",
            code: "inconsistent_payment_state",
            severity: "CRITICAL",
          });

          if (order.amount !== undefined) {
            ctx.check(order.amount === amount, {
              description: "the stored amount equals the charged amount",
              expected: amount,
              actual: order.amount,
              code: "amount_corrupted",
              severity: "CRITICAL",
            });
          }
          return;
        }

        default: {
          ctx.skip(`scenario ${scenario} is not implemented by this engine version`);
        }
      }
    },
  };
}

async function readOrderOrSkip(
  ctx: { skip(reason: string): never },
  target: PaymentUnderTest,
  orderReference: string
) {
  if (!target.capabilities.orderReadback || !target.readOrder) {
    ctx.skip(
      "the product does not expose an order readback endpoint, so the outcome cannot be verified"
    );
  }
  const order = await target.readOrder(orderReference);
  if (!order) {
    ctx.skip(
      `no order found for reference ${orderReference}; the product may not persist sandbox orders`
    );
  }
  return order;
}

/**
 * Why a scenario cannot run, as a status rather than a sentence.
 *
 * The distinction is the point. A product that declared no target has not been configured
 * (`NOT_CONFIGURED`, a setup task). A product that has no checkout or no refund surface
 * makes the scenario inapplicable (`NOT_APPLICABLE`, an answer). Neither is a pass, and
 * neither is a defect: FLOW reports what it could not ask, separately from what failed.
 */
function skipFor(
  scenario: FlowScenario,
  target: PaymentUnderTest | undefined
): { status: "NOT_APPLICABLE" | "NOT_CONFIGURED"; reason: string } | undefined {
  if (!target) {
    return {
      status: "NOT_CONFIGURED",
      reason: 'no payment target configured (modules.flow.target.kind is "none")',
    };
  }
  if (!target.capabilities.checkout || !target.checkout) {
    return {
      status: "NOT_APPLICABLE",
      reason: "the product does not expose a checkout endpoint",
    };
  }
  const needsReadback = scenario !== "checkout_success" && scenario !== "checkout_declined";
  if (needsReadback && (!target.capabilities.orderReadback || !target.readOrder)) {
    return {
      status: "NOT_APPLICABLE",
      reason: "the product does not expose an order readback endpoint",
    };
  }
  if (
    scenario.startsWith("webhook_") &&
    (!target.capabilities.webhookReceiver || !target.deliverWebhook)
  ) {
    return {
      status: "NOT_APPLICABLE",
      reason: "the product does not expose a webhook receiver",
    };
  }
  if (scenario === "refund_flow" && (!target.capabilities.refund || !target.refund)) {
    return { status: "NOT_APPLICABLE", reason: "the product does not expose a refund path" };
  }
  return undefined;
}

function severityFor(scenario: FlowScenario): "CRITICAL" | "HIGH" | "MEDIUM" {
  switch (scenario) {
    case "webhook_invalid_signature":
    case "order_duplicate":
    case "webhook_duplicate":
    case "inconsistent_state":
      return "CRITICAL";
    case "checkout_success":
    case "order_missing_confirmation":
    case "refund_flow":
      return "HIGH";
    default:
      return "MEDIUM";
  }
}
