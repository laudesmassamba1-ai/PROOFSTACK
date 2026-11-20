import { SandboxProvider } from "@proofcore/adapter-payments";
import { FixedClock } from "@proofcore/core";
import { describe, expect, it } from "vitest";
import {
  CheckoutService,
  checkEntitlement,
  entitlementsFor,
  findPlan,
  MemoryBillingStore,
  normalizeEmail,
  planChangeEffect,
  ReconciliationService,
  resolveEntitlements,
  type Subscription,
  UsageMeter,
  WebhookProcessor,
} from "../src/index.js";

/**
 * Billing tests.
 *
 * These are the tests the product brief calls "critical billing tests", written
 * against the real orchestration rather than a mock of it. Every one of them asserts
 * a property that, if broken, costs a customer money or gives away a paid plan.
 */

const WORKSPACE = "ws_test_1";

function harness(
  options: { outcome?: "success" | "declined" | "pending" | "cancelled" | "expired" } = {}
) {
  const store = new MemoryBillingStore();
  const provider = new SandboxProvider({ outcome: options.outcome ?? "pending" });
  const clock = new FixedClock("2026-03-01T10:00:00.000Z");
  const checkout = new CheckoutService(store, provider, () => new Date(clock.now()));
  const webhooks = new WebhookProcessor(store, provider, checkout, () => new Date(clock.now()));
  const meter = new UsageMeter(store, clock);
  const reconciliation = new ReconciliationService(store, provider, checkout);
  return { store, provider, clock, checkout, webhooks, meter, reconciliation };
}

const customer = { email: "Ada@Example.com", name: "Ada Lovelace" };

describe("entitlement engine", () => {
  it("gives a workspace with no subscription the free entitlement set, not an error", async () => {
    const { store } = harness();
    const effective = await resolveEntitlements(store, WORKSPACE);
    expect(effective.planKey).toBe("free");
    expect(effective.entitled).toBe(false);
    expect(effective.reason).toBe("no_subscription");
    expect(effective.entitlements.project_limit).toBe(1);
  });

  it("resolves the paid plan only from the subscription row", async () => {
    const { store, clock } = harness();
    const now = new Date(clock.now());
    const subscription: Subscription = {
      id: "sub_1",
      workspaceId: WORKSPACE,
      customerId: "cus_1",
      planKey: "studio",
      currency: "USD",
      period: "monthly",
      state: "ACTIVE",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      provider: "sandbox",
      pendingPlanKey: null,
      fundedByIntentIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await store.saveSubscription(subscription);

    const effective = await resolveEntitlements(store, WORKSPACE, now);
    expect(effective.planKey).toBe("studio");
    expect(effective.entitled).toBe(true);
    expect(effective.entitlements.team_members).toBe(10);
  });

  it("drops to free once the paid period has ended, without losing the subscription row", async () => {
    const { store, clock } = harness();
    const now = new Date(clock.now());
    await store.saveSubscription({
      id: "sub_1",
      workspaceId: WORKSPACE,
      customerId: "cus_1",
      planKey: "developer",
      currency: "USD",
      period: "monthly",
      state: "ACTIVE",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: new Date(now.getTime() - 1000).toISOString(),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      provider: "sandbox",
      pendingPlanKey: null,
      fundedByIntentIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const effective = await resolveEntitlements(store, WORKSPACE, now);
    expect(effective.entitled).toBe(false);
    expect(effective.planKey).toBe("free");
    expect(effective.reason).toBe("period_ended_awaiting_renewal");
    // The row is still there: access is dropped, data is not.
    expect(await store.getSubscription("sub_1")).not.toBeNull();
  });

  it("keeps access during PAST_DUE while the paid period is still live", async () => {
    const { store, clock } = harness();
    const now = new Date(clock.now());
    await store.saveSubscription({
      id: "sub_1",
      workspaceId: WORKSPACE,
      customerId: "cus_1",
      planKey: "developer",
      currency: "USD",
      period: "monthly",
      state: "PAST_DUE",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      provider: "sandbox",
      pendingPlanKey: null,
      fundedByIntentIds: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const effective = await resolveEntitlements(store, WORKSPACE, now);
    expect(effective.entitled).toBe(true);
    expect(effective.planKey).toBe("developer");
  });

  it("denies a quota and names the plan that would grant it", () => {
    const free = {
      planKey: "free",
      planName: "Free",
      rank: 0,
      entitled: false,
      state: "NONE" as const,
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-04-01T00:00:00.000Z",
      entitlements: entitlementsFor("free"),
      modules: ["world", "flow", "exit"] as const,
      reason: "no_subscription",
      subscriptionId: null,
      accessEndsAt: null,
      cancelAtPeriodEnd: false,
      recurringSupported: false,
    };
    const decision = checkEntitlement(
      { ...free, modules: [...free.modules] },
      { key: "project_limit" },
      1
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("quota_project_limit_exhausted");
    expect(decision.requiredPlanKey).toBe("developer");
  });

  it("treats -1 as unlimited and never exhausts it", () => {
    const entitlements = {
      planKey: "agency",
      planName: "Agency",
      rank: 3,
      entitled: true,
      state: "ACTIVE" as const,
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-04-01T00:00:00.000Z",
      entitlements: entitlementsFor("agency"),
      modules: ["world", "flow", "exit"] as ("world" | "flow" | "exit")[],
      reason: null,
      subscriptionId: "sub_1",
      accessEndsAt: null,
      cancelAtPeriodEnd: false,
      recurringSupported: false,
    };
    const decision = checkEntitlement(
      entitlements,
      { key: "project_limit", requested: 10_000 },
      999_999
    );
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(-1);
  });

  it("queues a downgrade to the period end and applies an upgrade immediately", () => {
    const subscription = {
      id: "sub_1",
      workspaceId: WORKSPACE,
      customerId: "cus_1",
      planKey: "studio",
      currency: "USD",
      period: "monthly" as const,
      state: "ACTIVE" as const,
      currentPeriodStart: "2026-03-01T00:00:00.000Z",
      currentPeriodEnd: "2026-04-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      provider: "sandbox" as const,
      pendingPlanKey: null,
      fundedByIntentIds: [],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const down = planChangeEffect(subscription, "developer", "monthly");
    expect(down.mode).toBe("at_period_end");
    expect(down.pendingPlanKey).toBe("developer");

    const up = planChangeEffect(subscription, "agency", "monthly");
    expect(up.mode).toBe("immediate");
    expect(up.pendingPlanKey).toBeNull();
  });
});

describe("checkout: a redirect never grants a plan", () => {
  it("creates an intent but leaves the subscription unentitled until verification", async () => {
    const { store, checkout, clock } = harness({ outcome: "pending" });
    const result = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });

    expect(result.checkoutUrl).toBeDefined();
    expect(result.amount.minor).toBe(1500n);
    // The critical assertion: a checkout URL exists, and access does not.
    const effective = await resolveEntitlements(store, WORKSPACE, new Date(clock.now()));
    expect(effective.entitled).toBe(false);
    expect(effective.planKey).toBe("free");
  });

  it("refuses a plan/currency pair that has no configured price", async () => {
    const { checkout } = harness();
    await expect(
      checkout.start({
        workspaceId: WORKSPACE,
        planKey: "developer",
        period: "monthly",
        currency: "JPY",
        customer,
        provider: "sandbox",
      })
    ).rejects.toThrow(/does not declare support for JPY|no configured price/);
  });

  it("refuses an unknown plan instead of inventing one", async () => {
    const { checkout } = harness();
    await expect(
      checkout.start({
        workspaceId: WORKSPACE,
        planKey: "enterprise_platinum",
        period: "monthly",
        currency: "USD",
        customer,
        provider: "sandbox",
      })
    ).rejects.toThrow(/Unknown plan/);
  });

  it("reuses the same provider session when checkout is started twice for one period", async () => {
    const { checkout } = harness({ outcome: "pending" });
    const first = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    const second = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.providerReference).toBe(first.providerReference);
  });
});

describe("checkout: verified payment activates the plan", () => {
  it("credits the period only after the provider says SUCCESS", async () => {
    const { store, checkout, provider, clock } = harness({ outcome: "pending" });
    const started = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });

    // Before settlement: still pending, still free.
    const before = await checkout.finalize(started.intentId, { source: "return" });
    expect(before.outcome).toBe("still_pending");

    // The provider settles out of band.
    provider.settle(started.providerReference, "success");

    const after = await checkout.finalize(started.intentId, { source: "return" });
    expect(after.outcome).toBe("credited");
    expect(after.invoice?.status).toBe("PAID");
    expect(after.invoice?.documentKind).toBe("RECEIPT");

    const effective = await resolveEntitlements(store, WORKSPACE, new Date(clock.now()));
    expect(effective.entitled).toBe(true);
    expect(effective.planKey).toBe("developer");
    expect(effective.entitlements.project_limit).toBe(5);
  });

  it("is idempotent: finalizing twice credits once and issues one receipt", async () => {
    const { store, checkout, provider } = harness({ outcome: "pending" });
    const started = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    provider.settle(started.providerReference, "success");

    const first = await checkout.finalize(started.intentId);
    const second = await checkout.finalize(started.intentId);

    expect(first.outcome).toBe("credited");
    expect(second.outcome).toBe("already_credited");
    const invoices = await store.listInvoices(WORKSPACE);
    expect(invoices).toHaveLength(1);
  });

  it("does not activate paid features when the payment is declined", async () => {
    const { store, checkout, provider, clock } = harness({ outcome: "pending" });
    const started = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "studio",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    provider.settle(started.providerReference, "declined");

    const result = await checkout.finalize(started.intentId);
    expect(result.outcome).toBe("failed");
    // Never paid, so never "past due": it stays incomplete and grants nothing.
    expect(result.subscription?.state).toBe("INCOMPLETE");

    const effective = await resolveEntitlements(store, WORKSPACE, new Date(clock.now()));
    expect(effective.entitled).toBe(false);
    expect(effective.planKey).toBe("free");
  });
});

describe("webhooks", () => {
  it("rejects an unsigned delivery without writing anything", async () => {
    const { webhooks, store } = harness();
    const outcome = await webhooks.handle({
      body: JSON.stringify({ event: "payment.success", data: { id: "txn_1" } }),
      headers: {},
    });
    expect(outcome.status).toBe(400);
    expect(await store.listWebhooks(10)).toHaveLength(0);
  });

  it("rejects a tampered signature", async () => {
    const { webhooks, provider } = harness();
    const signed = await provider.signWebhook("payment.success", {
      id: "txn_1",
      status: "SUCCESS",
    });
    const outcome = await webhooks.handle({
      body: signed.body,
      headers: { ...signed.headers, "x-webhook-signature": "0".repeat(64) },
    });
    expect(outcome.status).toBe(400);
  });

  it("rejects a stale timestamp outside the 300 second window", async () => {
    const { webhooks, provider } = harness();
    const old = Math.floor(Date.now() / 1000) - 400;
    const signed = await provider.signWebhook("payment.success", { id: "txn_1" }, old);
    const outcome = await webhooks.handle({ body: signed.body, headers: signed.headers });
    expect(outcome.status).toBe(400);
    expect(outcome.body.reason).toMatch(/300 second window/);
  });

  it("acknowledges a duplicate event and performs no second credit", async () => {
    const { webhooks, checkout, provider, store } = harness({ outcome: "pending" });
    const started = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    provider.settle(started.providerReference, "success");

    const signed = await provider.signWebhook("payment.success", {
      id: started.providerReference,
      status: "SUCCESS",
    });

    const first = await webhooks.handle({ body: signed.body, headers: signed.headers });
    expect(first.status).toBe(200);
    expect(first.body.result).toBe("credited");

    const second = await webhooks.handle({ body: signed.body, headers: signed.headers });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    expect(await store.listInvoices(WORKSPACE)).toHaveLength(1);
  });

  it("treats a late out-of-order event as harmless because state comes from verify", async () => {
    const { webhooks, checkout, provider } = harness({ outcome: "pending" });
    const started = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    provider.settle(started.providerReference, "success");

    // A "pending" event arrives after the payment already succeeded.
    const late = await provider.signWebhook("payment.pending", {
      id: started.providerReference,
      status: "PENDING",
    });
    const outcome = await webhooks.handle({ body: late.body, headers: late.headers });

    expect(outcome.status).toBe(200);
    // The provider is the authority: verify says SUCCESS, so the plan is credited.
    expect(outcome.body.result).toBe("credited");
  });

  it("returns 404 for a verified event with no matching intent, and never creates one", async () => {
    const { webhooks, provider, store } = harness();
    const signed = await provider.signWebhook("payment.success", {
      id: "txn_unknown",
      status: "SUCCESS",
    });
    const outcome = await webhooks.handle({ body: signed.body, headers: signed.headers });
    expect(outcome.status).toBe(404);
    expect(await store.listIntents(WORKSPACE)).toHaveLength(0);
  });
});

describe("usage metering", () => {
  it("meters a subject once no matter how many times it is reported", async () => {
    const { meter } = harness();
    const first = await meter.meter({
      workspaceId: WORKSPACE,
      kind: "test_run",
      subjectId: "run_1",
    });
    const second = await meter.meter({
      workspaceId: WORKSPACE,
      kind: "test_run",
      subjectId: "run_1",
    });

    expect(first.counted).toBe(true);
    expect(first.reason).toBe("recorded");
    expect(second.counted).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(second.usage).toBe(1);
  });

  it("records a failed run without counting it against the quota", async () => {
    const { meter } = harness();
    const result = await meter.meter({
      workspaceId: WORKSPACE,
      kind: "test_run",
      subjectId: "run_failed",
      countable: false,
    });
    expect(result.counted).toBe(true);
    expect(result.reason).toBe("not_counted");
    expect(result.usage).toBe(0);
  });

  it("refuses the run that would exceed the free monthly quota", async () => {
    const { meter } = harness();
    const limit = entitlementsFor("free").monthly_test_runs as number;
    for (let i = 0; i < limit; i += 1) {
      const result = await meter.meter({
        workspaceId: WORKSPACE,
        kind: "test_run",
        subjectId: `run_${i}`,
      });
      expect(result.counted).toBe(true);
    }
    const over = await meter.meter({
      workspaceId: WORKSPACE,
      kind: "test_run",
      subjectId: "run_over",
    });
    expect(over.counted).toBe(false);
    expect(over.reason).toBe("quota_exhausted");
  });
});

describe("reconciliation", () => {
  it("credits a payment whose webhook never arrived", async () => {
    const { checkout, provider, reconciliation, store, clock } = harness({ outcome: "pending" });
    const started = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    // Provider settled, webhook lost in transit.
    provider.settle(started.providerReference, "success");

    const report = await reconciliation.sweep({
      workspaceIds: [WORKSPACE],
      now: new Date(clock.now()),
    });
    expect(report.credited).toBe(1);

    const effective = await resolveEntitlements(store, WORKSPACE, new Date(clock.now()));
    expect(effective.entitled).toBe(true);
  });

  it("reports disagreement between the ledger and the provider without mutating", async () => {
    const { checkout, provider, reconciliation } = harness({ outcome: "pending" });
    const started = await checkout.start({
      workspaceId: WORKSPACE,
      planKey: "developer",
      period: "monthly",
      currency: "USD",
      customer,
      provider: "sandbox",
    });
    provider.settle(started.providerReference, "success");

    const audit = await reconciliation.audit({ workspaceIds: [WORKSPACE] });
    expect(audit.rows).toHaveLength(1);
    // Provider says SUCCEEDED, we have not credited it yet: that is a disagreement.
    expect(audit.disagreements).toBe(1);
  });
});

describe("email identity", () => {
  it("collapses gmail dots and tags but leaves other providers alone", () => {
    expect(normalizeEmail("Ada.Lovelace+proof@gmail.com")).toBe("adalovelace@gmail.com");
    expect(normalizeEmail("ada+proof@example.com")).toBe("ada+proof@example.com");
  });
});

describe("plan catalogue", () => {
  it("keeps every plan price in integer minor units with a real currency", () => {
    for (const key of ["developer", "studio", "agency"]) {
      const plan = findPlan(key);
      expect(plan).toBeDefined();
      for (const price of plan?.prices ?? []) {
        expect(price.amount.minor).toMatch(/^\d+$/);
        expect(["USD", "EUR", "XOF"]).toContain(price.amount.currency);
      }
    }
  });

  it("marks XOF prices as whole units, because XOF has no subunit", () => {
    const plan = findPlan("developer");
    const xof = plan?.prices.find((p) => p.amount.currency === "XOF" && p.period === "monthly");
    expect(xof?.amount.minor).toBe("9000");
  });
});
