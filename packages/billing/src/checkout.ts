import type { PaymentProvider } from "@proofcore/adapter-payments";
import type {
  BillingPeriod,
  Invoice,
  PaymentState,
  Plan,
  ProviderKind,
} from "@proofcore/contracts";
import { deterministicId, iso, Money, ProofCoreError, sha256Hex, uuid } from "@proofcore/core";
import { FREE_PLAN_KEY } from "./entitlements.js";
import { assertPaymentTransition, assertSubscriptionTransition } from "./machines.js";
import { findPlan, findPrice } from "./plans.js";
import type { Customer, PaymentIntent, Subscription } from "./records.js";
import type { BillingStore } from "./store.js";

/**
 * Checkout orchestration.
 *
 * The full path, in order, with the guarantee each step provides:
 *   1  validate the plan, currency and amount              → no invented prices
 *   2  resolve or create the customer (normalised email)  → one person, one record
 *   3  resolve the target subscription                    → no state mutated yet
 *   4  create the PaymentIntent and PERSIST its key       → the anti-double-charge anchor
 *   5  call the provider with that exact key              → a retry cannot debit twice
 *   6  store the provider reference                       → verification has an address
 *   7  hand the caller a checkout URL                     → nothing is credited yet
 *   8  payer acts out of band (webhook, redirect, push)   → we do not trust step 8
 *   9  verify with the provider                           → authoritative truth
 *  10  map the provider status                            → unknown status = no credit
 *  11  idempotency guard                                  → replay is a no-op
 *  12  amount check                                       → wrong amount = quarantine
 *  13  advance the period + state                         → paid time, not paid goodwill
 *  14  recompute entitlements                             → server-side authority
 *  15  mark the intent credited                           → the double-credit wall
 *  16  issue a receipt (never a tax invoice)              → honest documents
 *  17  append the audit trail                             → answerable later
 *
 * Failure path: a declined payment moves the intent to FAILED and the subscription to
 * PAST_DUE. Access is NOT revoked while the already-paid period is still live.
 * Timeout path: the intent stays PENDING and is re-verified later. A timeout is never
 * recorded as a failure, because the charge may have succeeded after we stopped reading.
 */

export interface StartCheckoutInput {
  workspaceId: string;
  /** Plan *key* (not id): the catalogue is keyed by the stable slug. */
  planKey: string;
  period: BillingPeriod;
  currency: string;
  customer: { email: string; name: string; phone?: string };
  provider: ProviderKind;
  flow?: "hosted" | "push";
  push?: { country: string; network: string };
  returnUrl?: string;
  /** Present on a renewal; absent for a first charge. */
  existingSubscriptionId?: string;
  now?: Date;
}

export interface StartCheckoutResult {
  intentId: string;
  subscriptionId: string;
  providerReference: string;
  checkoutUrl: string | undefined;
  state: PaymentState;
  amount: Money;
  idempotencyKey: string;
  /**
   * False means the provider cannot bill the next period by itself. The UI must then
   * show "manual renewal" rather than implying an automatic subscription.
   */
  automatedRenewal: boolean;
  instructions?: string;
}

export class CheckoutService {
  constructor(
    private readonly store: BillingStore,
    private readonly provider: PaymentProvider,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /** Step 1 — nothing downstream runs if the price cannot be proven. */
  private validate(plan: Plan, currency: string, period: BillingPeriod): Money {
    const price = findPrice(plan.key, currency, period);
    if (!price) {
      throw new ProofCoreError({
        message: `Plan ${plan.key} has no configured price for ${currency}/${period}. Add it to the plan catalogue instead of sending a price from the client.`,
        category: "CONFIGURATION",
        code: "price_not_configured",
        details: { planKey: plan.key, currency, period },
      });
    }
    if (price.minor <= 0n && plan.key !== FREE_PLAN_KEY) {
      throw new ProofCoreError({
        message: `Price for ${plan.key}/${currency}/${period} must be greater than zero`,
        category: "CONFIGURATION",
        code: "invalid_price",
      });
    }
    return Money.of(price.currency, price.minor);
  }

  async start(input: StartCheckoutInput): Promise<StartCheckoutResult> {
    const now = input.now ?? this.clock();
    const plan = findPlan(input.planKey);
    if (!plan) {
      throw new ProofCoreError({
        message: `Unknown plan ${input.planKey}`,
        category: "VALIDATION",
        code: "unknown_plan",
        details: { planKey: input.planKey },
      });
    }
    if (!plan.active || !plan.publiclyAvailable) {
      throw new ProofCoreError({
        message: `Plan ${plan.key} is not purchasable`,
        category: "VALIDATION",
        code: "plan_not_purchasable",
      });
    }

    const amount = this.validate(plan, input.currency, input.period);
    const capabilities = this.provider.getCapabilities();
    const automatedRenewal = capabilities.automatedRecurring;

    if (!capabilities.currencies.includes(input.currency)) {
      throw new ProofCoreError({
        message: `${capabilities.displayName} does not declare support for ${input.currency}. Capability source: getCapabilities().`,
        category: "PROVIDER",
        code: "unsupported_currency",
        details: { supported: capabilities.currencies },
      });
    }

    if (amount.minor === 0n) {
      // The free plan is a real path with no money movement, and no checkout.
      await this.store.appendAudit({
        id: uuid(),
        workspaceId: input.workspaceId,
        actor: "billing",
        action: "checkout.refused_free_plan",
        detail: { planKey: plan.key },
        at: iso(now),
      });
      throw new ProofCoreError({
        message: "The free plan needs no checkout",
        category: "VALIDATION",
        code: "free_plan_no_checkout",
      });
    }

    const emailNormalized = normalizeEmail(input.customer.email);
    let customer = await this.store.findCustomerByNormalizedEmail(emailNormalized);
    if (!customer) {
      customer = {
        id: uuid(),
        email: input.customer.email,
        emailNormalized,
        name: input.customer.name,
        country: null,
        createdAt: iso(now),
      };
      await this.store.saveCustomer(customer);
    }

    const subscription = await this.resolveSubscription(input, customer, plan, now);

    // The idempotency key is derived from the *billing period*, not from a random id:
    // starting checkout twice for the same period reuses the same provider session
    // instead of opening a second charge.
    const idempotencyKey = await this.idempotencyKey(
      input.workspaceId,
      subscription.id,
      plan.key,
      input.period,
      now
    );

    const existing = await this.store.findIntentByIdempotencyKey(idempotencyKey);
    if (existing?.providerReference) {
      return {
        intentId: existing.id,
        subscriptionId: existing.subscriptionId,
        providerReference: existing.providerReference,
        checkoutUrl: existing.providerCheckoutUrl ?? undefined,
        state: existing.state,
        amount: Money.of(existing.currency, BigInt(existing.amountMinor)),
        idempotencyKey: existing.idempotencyKey,
        automatedRenewal,
        instructions: "Reused the provider session created for this billing period.",
      };
    }

    const intent: PaymentIntent = {
      id: existing?.id ?? uuid(),
      workspaceId: input.workspaceId,
      subscriptionId: subscription.id,
      planKey: plan.key,
      priceId: findPrice(plan.key, input.currency, input.period)?.id ?? "",
      period: input.period,
      currency: input.currency,
      amountMinor: String(amount.minor),
      provider: capabilities.provider,
      idempotencyKey,
      purpose: input.existingSubscriptionId ? "renewal" : "first_charge",
      state: "CREATED",
      providerReference: null,
      providerCheckoutUrl: null,
      verifiedAmountMinor: null,
      verifiedNetAmountMinor: null,
      credited: false,
      failureReason: null,
      quarantined: false,
      createdAt: existing?.createdAt ?? iso(now),
      updatedAt: iso(now),
    };
    await this.store.saveIntent(intent);

    const checkout = await this.provider.createCheckout({
      idempotencyKey,
      amount,
      description: `PROOFCORE ${plan.name} (${input.period}) — workspace ${input.workspaceId}`,
      customer: input.customer,
      metadata: {
        workspace_id: input.workspaceId,
        plan_key: plan.key,
        period: input.period,
        subscription_id: subscription.id,
        intent_id: intent.id,
      },
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      ...(input.push ? { push: input.push } : {}),
      flow: input.flow ?? "hosted",
    });

    assertPaymentTransition("CREATED", checkout.state);
    intent.providerReference = checkout.providerReference;
    intent.providerCheckoutUrl = checkout.checkoutUrl ?? null;
    intent.state = checkout.state;
    intent.updatedAt = iso(now);
    await this.store.saveIntent(intent);

    await this.store.appendAudit({
      id: uuid(),
      workspaceId: input.workspaceId,
      actor: "billing",
      action: "checkout.started",
      detail: {
        intentId: intent.id,
        provider: intent.provider,
        reference: checkout.providerReference,
        amountMinor: intent.amountMinor,
        currency: intent.currency,
      },
      at: iso(now),
    });

    return {
      intentId: intent.id,
      subscriptionId: subscription.id,
      providerReference: checkout.providerReference,
      checkoutUrl: checkout.checkoutUrl,
      state: checkout.state,
      amount,
      idempotencyKey,
      automatedRenewal,
      ...(checkout.instructions ? { instructions: checkout.instructions } : {}),
    };
  }

  /**
   * Steps 9–17. Safe to call from the return route, a webhook, or a reconciliation
   * job: every branch re-reads the provider, and the credited flag makes repeats inert.
   */
  async finalize(
    intentId: string,
    options: { source: "return" | "webhook" | "reconciliation" } = { source: "reconciliation" }
  ): Promise<FinalizeResult> {
    const now = this.clock();
    const intent = await this.store.getIntent(intentId);
    if (!intent) {
      throw new ProofCoreError({
        message: `Unknown payment intent ${intentId}`,
        category: "NOT_FOUND",
        code: "intent_not_found",
      });
    }
    const subscription = await this.store.getSubscription(intent.subscriptionId);

    if (intent.credited) {
      return { intent, subscription, outcome: "already_credited", invoice: null };
    }
    if (!intent.providerReference) {
      return { intent, subscription, outcome: "no_provider_reference", invoice: null };
    }

    let verified: Awaited<ReturnType<PaymentProvider["verifyTransaction"]>>;
    try {
      verified = await this.provider.verifyTransaction(intent.providerReference);
    } catch (error) {
      // Timeout path: keep the intent as it is, never guess. A charge may have landed.
      await this.store.appendAudit({
        id: uuid(),
        workspaceId: intent.workspaceId,
        actor: "billing",
        action: "finalize.provider_unavailable",
        detail: {
          intentId,
          source: options.source,
          error: error instanceof Error ? error.message : String(error),
        },
        at: iso(now),
      });
      return { intent, subscription, outcome: "verification_unavailable", invoice: null };
    }

    const expected = Money.of(intent.currency, BigInt(intent.amountMinor));
    if (
      verified.amount.currency !== expected.currency ||
      verified.amount.minor !== expected.minor
    ) {
      // Quarantine: the money is real, the intent is not. Never auto-credit a mismatch.
      intent.quarantined = true;
      intent.updatedAt = iso(now);
      await this.store.saveIntent(intent);
      await this.store.appendAudit({
        id: uuid(),
        workspaceId: intent.workspaceId,
        actor: "billing",
        action: "finalize.amount_mismatch",
        detail: {
          intentId,
          expectedMinor: intent.amountMinor,
          observedMinor: verified.amount.minor.toString(),
          currency: verified.amount.currency,
        },
        at: iso(now),
      });
      return { intent, subscription, outcome: "amount_mismatch", invoice: null };
    }

    if (verified.state === "PENDING" || verified.state === "PROCESSING") {
      return { intent, subscription, outcome: "still_pending", invoice: null };
    }

    if (!subscription) {
      throw new ProofCoreError({
        message: `Subscription ${intent.subscriptionId} is missing for intent ${intent.id}`,
        category: "INTERNAL",
        code: "subscription_not_found",
      });
    }

    assertPaymentTransition(intent.state, verified.state);
    intent.state = verified.state;
    intent.verifiedAmountMinor = verified.amount.minor.toString();
    if (verified.netAmount) intent.verifiedNetAmountMinor = verified.netAmount.minor.toString();
    intent.updatedAt = iso(now);

    if (verified.state !== "SUCCEEDED") {
      intent.failureReason = verified.providerStatus;
      await this.store.saveIntent(intent);
      // Failure path. The state we move to depends on whether the subscription was
      // ever live:
      //   INCOMPLETE → stays INCOMPLETE. Nothing was ever paid, so calling it
      //                "past due" would imply a debt that does not exist.
      //   live       → PAST_DUE. The customer keeps the period they already bought;
      //                the resolver decides access from the period boundary.
      const nextState =
        subscription.state === "INCOMPLETE"
          ? "INCOMPLETE"
          : subscription.state === "CANCELLED" || subscription.state === "EXPIRED"
            ? subscription.state
            : "PAST_DUE";
      if (nextState !== subscription.state) {
        assertSubscriptionTransition(subscription.state, nextState);
        await this.store.saveSubscription({
          ...subscription,
          state: nextState,
          updatedAt: iso(now),
        });
      }
      await this.store.appendAudit({
        id: uuid(),
        workspaceId: intent.workspaceId,
        actor: "billing",
        action: "finalize.payment_failed",
        detail: { intentId, providerStatus: verified.providerStatus, subscriptionState: nextState },
        at: iso(now),
      });
      return {
        intent,
        subscription: await this.store.getSubscription(intent.subscriptionId),
        outcome: "failed",
        invoice: null,
      };
    }

    // Success path: the period is advanced from the *paid* plan, and a queued
    // downgrade is honoured here — at the boundary, on a verified payment, not on a timer.
    const paidPlan = findPlan(intent.planKey);
    if (!paidPlan) {
      throw new ProofCoreError({
        message: `Intent ${intent.id} references unknown plan ${intent.planKey}`,
        category: "INTERNAL",
        code: "unknown_plan_on_intent",
      });
    }

    const nextState =
      subscription.state === "TRIALING" ||
      subscription.state === "INCOMPLETE" ||
      subscription.state === "PAST_DUE" ||
      subscription.state === "GRACE_PERIOD" ||
      subscription.state === "SUSPENDED" ||
      subscription.state === "EXPIRED"
        ? "ACTIVE"
        : subscription.state;

    const periodStart = now;
    const next: Subscription = {
      ...subscription,
      planKey: paidPlan.key,
      currency: intent.currency,
      period: intent.period,
      state: nextState,
      currentPeriodStart: iso(periodStart),
      currentPeriodEnd: periodEndFor(intent.period, periodStart),
      trialEndsAt: null,
      pendingPlanKey: null,
      fundedByIntentIds: [...new Set([...subscription.fundedByIntentIds, intent.id])],
      updatedAt: iso(now),
    };
    assertSubscriptionTransition(subscription.state, next.state);
    await this.store.saveSubscription(next);

    intent.credited = true;
    await this.store.saveIntent(intent);

    const invoice = await this.issueReceipt(intent, paidPlan, next, now);

    await this.store.appendAudit({
      id: uuid(),
      workspaceId: intent.workspaceId,
      actor: "billing",
      action: "finalize.credited",
      detail: {
        intentId,
        source: options.source,
        planKey: paidPlan.key,
        periodEnd: next.currentPeriodEnd,
        amountMinor: intent.amountMinor,
        currency: intent.currency,
        netAmountMinor: intent.verifiedNetAmountMinor,
        invoiceId: invoice.id,
      },
      at: iso(now),
    });

    return { intent, subscription: next, outcome: "credited", invoice };
  }

  /**
   * A receipt proves payment; it does not pretend to be a tax invoice. `documentKind`
   * is RECEIPT and the tax note says so, because claiming VAT compliance we have not
   * assessed would be a lie in a PDF.
   */
  async issueReceipt(
    intent: PaymentIntent,
    plan: Plan,
    subscription: Subscription,
    now: Date
  ): Promise<Invoice> {
    const existing = await this.store.findInvoiceByIntent(intent.id);
    if (existing) return existing;

    const amount = Money.of(intent.currency, BigInt(intent.amountMinor));
    const customer = await this.store.getCustomer(subscription.customerId);

    const invoice: Invoice = {
      id: uuid(),
      number: `PS-R-${iso(now).slice(0, 10).replaceAll("-", "")}-${intent.id.slice(0, 8).toUpperCase()}`,
      workspaceId: intent.workspaceId,
      subscriptionId: subscription.id,
      paymentAttemptId: intent.id,
      providerReference: intent.providerReference ?? undefined,
      status: "PAID",
      currency: intent.currency,
      subtotal: amount.toJSON(),
      total: amount.toJSON(),
      lines: [
        {
          description: `PROOFCORE ${plan.name} — ${intent.period} period`,
          quantity: 1,
          unitAmount: amount.toJSON(),
          totalAmount: amount.toJSON(),
        },
      ],
      issuedAt: iso(now),
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      customer: {
        name: customer?.name ?? "Customer",
        email: customer?.email ?? "unknown@example.invalid",
        ...(customer?.country ? { country: customer.country } : {}),
      },
      documentKind: "RECEIPT",
      taxNote:
        "Payment receipt, not a tax invoice. VAT/GST treatment depends on the jurisdiction of the seller and the buyer and has not been assessed for this document.",
    };
    await this.store.saveInvoice(invoice);
    return invoice;
  }

  private async idempotencyKey(
    workspaceId: string,
    subscriptionId: string,
    planKey: string,
    period: BillingPeriod,
    now: Date
  ): Promise<string> {
    const seed = `${workspaceId}|${subscriptionId}|${planKey}|${period}|${periodKey(now)}`;
    const digest = await sha256Hex(seed);
    // Stable for the period, different for the next one.
    return `ps_${digest.slice(0, 32)}`;
  }

  private async resolveSubscription(
    input: StartCheckoutInput,
    customer: Customer,
    plan: Plan,
    now: Date
  ): Promise<Subscription> {
    if (input.existingSubscriptionId) {
      const existing = await this.store.getSubscription(input.existingSubscriptionId);
      if (!existing) {
        throw new ProofCoreError({
          message: `Unknown subscription ${input.existingSubscriptionId}`,
          category: "NOT_FOUND",
          code: "subscription_not_found",
        });
      }
      if (existing.workspaceId !== input.workspaceId) {
        // Tenant isolation: a subscription id from another workspace is not a handle.
        throw new ProofCoreError({
          message: "Subscription does not belong to this workspace",
          category: "PERMISSION",
          code: "subscription_workspace_mismatch",
        });
      }
      return existing;
    }

    const current = await this.store.liveSubscription(input.workspaceId);
    if (current && current.planKey === plan.key && current.period === input.period) return current;

    const subscription: Subscription = {
      id: await deterministicId("sub", [`${input.workspaceId}:${plan.key}:${input.period}`]),
      workspaceId: input.workspaceId,
      customerId: customer.id,
      planKey: plan.key,
      currency: input.currency,
      period: input.period,
      // INCOMPLETE, not TRIALING. Starting a checkout must never be a way to obtain
      // paid features: a trial is granted explicitly (see `startTrial`), and access
      // begins only when a verified payment arrives.
      state: "INCOMPLETE",
      currentPeriodStart: iso(now),
      currentPeriodEnd: iso(now),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      provider: input.provider,
      pendingPlanKey: null,
      fundedByIntentIds: [],
      createdAt: iso(now),
      updatedAt: iso(now),
    };
    await this.store.saveSubscription(subscription);
    return subscription;
  }

  /**
   * Grant a trial. This is a deliberate product decision made once per workspace, not
   * a side effect of opening a checkout page.
   *
   * Returns `null` when a trial was already used, so the caller can show "you have
   * already had your trial" instead of silently extending it.
   */
  async startTrial(input: {
    workspaceId: string;
    planKey: string;
    customer: { email: string; name: string };
    provider: ProviderKind;
    now?: Date;
  }): Promise<Subscription | null> {
    const now = input.now ?? this.clock();
    const plan = findPlan(input.planKey);
    if (!plan || plan.trialDays <= 0) return null;

    const existing = await this.store.listSubscriptions(input.workspaceId);
    // One trial per workspace, ever. A cancelled trial is still a used trial.
    if (existing.some((s) => s.trialEndsAt !== null)) return null;
    if (existing.some((s) => s.state === "ACTIVE" || s.state === "TRIALING")) return null;

    const emailNormalized = normalizeEmail(input.customer.email);
    let customer = await this.store.findCustomerByNormalizedEmail(emailNormalized);
    if (!customer) {
      customer = {
        id: uuid(),
        email: input.customer.email,
        emailNormalized,
        name: input.customer.name,
        country: null,
        createdAt: iso(now),
      };
      await this.store.saveCustomer(customer);
    }

    const trialEnd = new Date(now.getTime() + plan.trialDays * 86_400_000);
    const subscription: Subscription = {
      id: await deterministicId("sub", [`${input.workspaceId}:${plan.key}:trial`]),
      workspaceId: input.workspaceId,
      customerId: customer.id,
      planKey: plan.key,
      currency: "USD",
      period: "monthly",
      state: "TRIALING",
      currentPeriodStart: iso(now),
      currentPeriodEnd: iso(trialEnd),
      cancelAtPeriodEnd: false,
      trialEndsAt: iso(trialEnd),
      provider: input.provider,
      pendingPlanKey: null,
      fundedByIntentIds: [],
      createdAt: iso(now),
      updatedAt: iso(now),
    };
    await this.store.saveSubscription(subscription);
    await this.store.appendAudit({
      id: uuid(),
      workspaceId: input.workspaceId,
      actor: "billing",
      action: "trial.started",
      detail: {
        planKey: plan.key,
        trialDays: plan.trialDays,
        trialEndsAt: subscription.trialEndsAt,
      },
      at: iso(now),
    });
    return subscription;
  }
}

export interface FinalizeResult {
  intent: PaymentIntent;
  subscription: Subscription | null;
  outcome:
    | "credited"
    | "failed"
    | "already_credited"
    | "still_pending"
    | "amount_mismatch"
    | "verification_unavailable"
    | "no_provider_reference";
  invoice: Invoice | null;
}

function periodEndFor(period: BillingPeriod, from: Date): string {
  const date = new Date(from);
  if (period === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

function periodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Normalise an email for identity purposes only. Gmail-style dots and +tags collapse
 * to one identity; other providers keep their local part intact, because `+` is a
 * legitimate mailbox character elsewhere and collapsing it would merge two people.
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    // local cannot be empty for an accepted email; assert once, typed.
    const gmailLocal = local.split("+")[0];
    return `${(gmailLocal ?? "").replaceAll(".", "")}@gmail.com`;
  }
  return `${local}@${domain}`;
}
