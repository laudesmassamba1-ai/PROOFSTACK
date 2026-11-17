import {
  assertSubscriptionTransition,
  checkEntitlement,
  findPlan,
  findPrice,
  planRank,
  resolveEntitlements,
} from "@proofcore/billing";
import type { BillingPeriod } from "@proofcore/contracts";
import { iso } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { createApiKeyToken } from "../auth.js";
import { entitlementMap, subscriptionView, usageCounters } from "../http/dto.js";
import { HttpError } from "../http/errors.js";
import { readBody, requireUser, requireWorkspace } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";
import { isSandbox } from "../providers.js";

const startCheckoutSchema = z
  .object({
    workspaceId: z.string().min(1),
    planKey: z.string().min(1),
    period: z.enum(["monthly", "yearly"]),
    currency: z.string().length(3).optional(),
    country: z.string().length(2).optional(),
    network: z.string().max(32).optional(),
    phone: z.string().min(6).max(24).optional(),
    returnUrl: z.string().url().optional(),
  })
  .strict();

const cancelSchema = z
  .object({ workspaceId: z.string().min(1), atPeriodEnd: z.boolean().default(true) })
  .strict();

const changePlanSchema = z
  .object({ workspaceId: z.string().min(1), planKey: z.string().min(1) })
  .strict();

const settleSchema = z
  .object({ outcome: z.enum(["success", "declined", "cancelled", "expired"]) })
  .strict();

const apiKeySchema = z
  .object({
    workspaceId: z.string().min(1),
    projectId: z.string().optional(),
    label: z.string().min(1).max(60),
    scopes: z
      .array(z.enum(["project:read", "runs:write", "reports:read", "usage:read"]))
      .min(1)
      .default(["runs:write", "reports:read"]),
  })
  .strict();

export function billingRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await requireUser(c, services);
    await next();
  });

  // -------------------------------------------------------------- checkout

  app.post("/checkout/start", async (c) => {
    const body = await readBody(c, startCheckoutSchema);
    const { workspace } = await requireWorkspace(c, services, body.workspaceId, ["owner", "admin"]);
    const user = c.get("user");

    const plan = findPlan(body.planKey);
    if (!plan) throw new HttpError(404, "unknown_plan", `No plan named ${body.planKey}.`);
    if (!plan.active || !plan.publiclyAvailable) {
      throw new HttpError(
        400,
        "plan_not_purchasable",
        "This plan is not available for self-serve checkout."
      );
    }

    const effective = await resolveEntitlements(services.billing, workspace.id, services.clock());
    if (effective.entitled && effective.planKey === plan.key) {
      throw new HttpError(409, "already_subscribed", `This workspace is already on ${plan.name}.`);
    }

    const capability = services.provider.getCapabilities();
    const currency = chooseCurrency(plan.key, body.period, body.currency, capability.currencies);
    if (!currency) {
      throw new HttpError(
        400,
        "no_chargeable_currency",
        `No configured price exists for this plan and period in ${body.currency ?? "a supported currency"}.`
      );
    }
    const push =
      body.network && body.country && capability.pushToPhone
        ? { country: body.country.toUpperCase(), network: body.network }
        : undefined;

    const current = await services.billing.liveSubscription(workspace.id);
    const result = await services.checkout.start({
      workspaceId: workspace.id,
      planKey: plan.key,
      period: body.period,
      currency,
      customer: {
        email: user.email,
        name: user.name,
        ...(body.phone ? { phone: body.phone } : {}),
      },
      provider: capability.provider,
      flow: push ? "push" : "hosted",
      ...(push ? { push } : {}),
      returnUrl: body.returnUrl ?? `${services.config.webOrigin}/app/billing`,
      ...(current ? { existingSubscriptionId: current.id } : {}),
      now: services.clock(),
    });

    return c.json(
      {
        intent: {
          id: result.intentId,
          state: result.state,
          amount: { currency: result.amount.currency, minor: result.amount.minor.toString() },
          idempotencyKey: result.idempotencyKey,
          provider: capability.provider,
          automatedRenewal: result.automatedRenewal,
        },
        // The sandbox provider's synthetic URL has no hosted page. Returning it
        // would send an integrator to a 404, so the sandbox answers with
        // instructions and the control surface instead.
        ...(result.checkoutUrl && capability.provider !== "sandbox"
          ? { redirectUrl: result.checkoutUrl }
          : {}),
        ...(result.instructions ? { instructions: result.instructions } : {}),
      },
      201
    );
  });

  /**
   * Poll a payment. The server verifies with the provider; the browser cannot turn
   * this into a success by asking politely. `entitled` is resolved from the
   * subscription row after finalisation, never from the request.
   */
  app.get("/checkout/:intentId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const intent = await services.billing.getIntent(c.req.param("intentId"));
    if (!intent || intent.workspaceId !== workspace.id) {
      throw new HttpError(404, "intent_not_found", "Payment attempt not found.");
    }

    if (!intent.credited && intent.providerReference) {
      try {
        await services.checkout.finalize(intent.id, { source: "return" });
      } catch {
        // Provider unreachable: report pending and let the webhook/reconciliation finish.
      }
    }

    const fresh = (await services.billing.getIntent(intent.id)) ?? intent;
    const effective = await resolveEntitlements(services.billing, workspace.id, services.clock());
    const entitled = fresh.credited && effective.entitled && effective.planKey === fresh.planKey;

    return c.json({
      intentId: fresh.id,
      state: fresh.state,
      ...(fresh.failureReason ? { providerStatus: fresh.failureReason } : {}),
      verifiedAt: fresh.credited ? fresh.updatedAt : undefined,
      entitled,
      message: messageFor(fresh.state, entitled),
      nextAction: nextActionFor(fresh.state, entitled),
      ...(fresh.providerCheckoutUrl ? { redirectUrl: fresh.providerCheckoutUrl } : {}),
    });
  });

  /**
   * Sandbox control surface. Present only when the deployment runs the sandbox
   * provider; a production SasPay deployment answers 404 here.
   */
  app.post("/checkout/:intentId/sandbox/settle", async (c) => {
    if (!isSandbox(services.provider)) {
      throw new HttpError(
        404,
        "not_found",
        "The sandbox control surface is not available on this deployment."
      );
    }
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
    ]);
    const intent = await services.billing.getIntent(c.req.param("intentId"));
    if (!intent || intent.workspaceId !== workspace.id) {
      throw new HttpError(404, "intent_not_found", "Payment attempt not found.");
    }
    if (!intent.providerReference)
      throw new HttpError(409, "no_provider_reference", "This attempt has no provider session.");
    const body = await readBody(c, settleSchema);
    services.provider.settle(intent.providerReference, body.outcome);
    const result = await services.checkout.finalize(intent.id, { source: "return" });
    return c.json({ outcome: result.outcome, state: result.intent.state });
  });

  // --------------------------------------------------------------- summary

  app.get("/billing", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const snapshot = await services.meter.snapshot(workspace.id, services.clock());
    const subscription = await subscriptionView(services, workspace.id, snapshot.entitlements);
    const invoices = await services.billing.listInvoices(workspace.id);
    const intents = await services.billing.listIntents(workspace.id);
    const capabilities = services.provider.getCapabilities();

    return c.json({
      subscription: subscription.view,
      entitlements: entitlementMap(subscription.effective),
      usage: usageCounters(subscription.effective, snapshot.usage),
      provider: {
        name: capabilities.displayName,
        slug: capabilities.provider,
        automatedRecurring: capabilities.automatedRecurring,
        refunds: capabilities.refunds,
        webhookSignatureScheme: capabilities.webhookSignatureScheme,
        notes: capabilities.notes,
      },
      payments: intents.slice(0, 20).map((intent) => ({
        id: intent.id,
        state: intent.state,
        planKey: intent.planKey,
        period: intent.period,
        amount: { currency: intent.currency, minor: intent.amountMinor },
        providerReference: intent.providerReference,
        credited: intent.credited,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt,
        ...(intent.failureReason ? { failureReason: intent.failureReason } : {}),
      })),
      invoices,
    });
  });

  app.post("/billing/cancel", async (c) => {
    const body = await readBody(c, cancelSchema);
    const { workspace } = await requireWorkspace(c, services, body.workspaceId, ["owner", "admin"]);
    const subscription = await services.billing.liveSubscription(workspace.id);
    if (!subscription)
      throw new HttpError(409, "no_subscription", "There is no paid subscription to cancel.");

    const now = services.clock();
    const nextState = body.atPeriodEnd ? "CANCEL_AT_PERIOD_END" : "CANCELLED";
    if (subscription.state !== nextState)
      assertSubscriptionTransition(subscription.state, nextState);
    await services.billing.saveSubscription({
      ...subscription,
      state: nextState,
      cancelAtPeriodEnd: body.atPeriodEnd,
      pendingPlanKey: null,
      updatedAt: iso(now),
    });
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: body.atPeriodEnd
        ? "subscription.cancel_at_period_end"
        : "subscription.cancelled_immediately",
      detail: {
        subscriptionId: subscription.id,
        planKey: subscription.planKey,
        accessEndsAt: subscription.currentPeriodEnd,
      },
    });

    return c.json({
      state: nextState,
      // The customer already paid for this period; say so rather than revoking it.
      accessEndsAt: body.atPeriodEnd ? subscription.currentPeriodEnd : iso(now),
      message: body.atPeriodEnd
        ? `Cancellation recorded. You keep ${subscription.planKey} access until ${subscription.currentPeriodEnd}, and no further charge will be made.`
        : "Subscription cancelled immediately. Your data is kept and your workspace resolves to the Free plan.",
    });
  });

  app.post("/billing/change-plan", async (c) => {
    const body = await readBody(c, changePlanSchema);
    const { workspace } = await requireWorkspace(c, services, body.workspaceId, ["owner", "admin"]);
    const target = findPlan(body.planKey);
    if (!target) throw new HttpError(404, "unknown_plan", `No plan named ${body.planKey}.`);
    const subscription = await services.billing.liveSubscription(workspace.id);
    if (!subscription)
      throw new HttpError(409, "no_subscription", "There is no subscription to change.");
    if (subscription.planKey === target.key) {
      return c.json({ mode: "none", message: `Already on ${target.name}.` });
    }
    if (planRank(target.key) > planRank(subscription.planKey)) {
      return c.json({
        mode: "checkout_required",
        message: `Start a checkout for ${target.name}: upgrades are effective only after the payment is verified.`,
        planKey: target.key,
      });
    }

    // A downgrade is queued and applied by the next verified payment, never mid-period.
    await services.billing.saveSubscription({
      ...subscription,
      pendingPlanKey: target.key,
      cancelAtPeriodEnd: true,
      updatedAt: iso(services.clock()),
    });
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "subscription.downgrade_queued",
      detail: {
        from: subscription.planKey,
        to: target.key,
        effectiveAt: subscription.currentPeriodEnd,
      },
    });
    return c.json({
      mode: "queued",
      effectiveAt: subscription.currentPeriodEnd,
      message: `${target.name} will start at the end of the current period (${subscription.currentPeriodEnd}). You keep ${subscription.planKey} until then.`,
    });
  });

  // -------------------------------------------------------------- API keys

  app.get("/api-keys", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
    ]);
    const keys = await services.store.listApiKeys(workspace.id);
    // Never return the hash; it is not a credential the client can use.
    return c.json({
      items: keys.map((key) => ({
        id: key.id,
        label: key.label,
        prefix: key.prefix,
        projectId: key.projectId,
        scopes: key.scopes,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
        expiresAt: key.expiresAt,
      })),
    });
  });

  app.post("/api-keys", async (c) => {
    const body = await readBody(c, apiKeySchema);
    const { workspace } = await requireWorkspace(c, services, body.workspaceId, ["owner", "admin"]);

    const effective = await resolveEntitlements(services.billing, workspace.id, services.clock());
    const decision = checkEntitlement(effective, { key: "api_access" });
    if (!decision.allowed) {
      throw new HttpError(
        403,
        "api_access_not_included",
        `API access is not included in ${effective.planName}.`,
        {
          ...(decision.requiredPlanKey ? { requiredPlanKey: decision.requiredPlanKey } : {}),
        }
      );
    }
    if (body.projectId) {
      const project = await services.store.getProject(workspace.id, body.projectId);
      if (!project)
        throw new HttpError(404, "project_not_found", "Project not found in this workspace.");
    }

    const { token, tokenHash, prefix } = await createApiKeyToken();
    const key = await services.store.createApiKey({
      workspaceId: workspace.id,
      ...(body.projectId ? { projectId: body.projectId } : {}),
      label: body.label,
      prefix,
      tokenHash,
      scopes: body.scopes,
    });
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "api_key.created",
      detail: { keyId: key.id, label: key.label, scopes: key.scopes },
    });

    return c.json(
      {
        id: key.id,
        label: key.label,
        prefix: key.prefix,
        scopes: key.scopes,
        createdAt: key.createdAt,
        token,
        warning: "This token is shown once. Store it in CI secrets; it cannot be recovered later.",
      },
      201
    );
  });

  app.delete("/api-keys/:keyId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"), [
      "owner",
      "admin",
    ]);
    const revoked = await services.store.revokeApiKey(workspace.id, c.req.param("keyId"));
    if (!revoked)
      throw new HttpError(404, "api_key_not_found", "API key not found or already revoked.");
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: c.get("user").id,
      action: "api_key.revoked",
      detail: { keyId: c.req.param("keyId") },
    });
    return c.json({ ok: true });
  });

  return app;
}

/** Plans are public: the marketing page and the dashboard read the same catalogue. */
export function planRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const capabilities = services.provider.getCapabilities();
  app.get("/plans", async (c) => {
    const currency = c.req.query("currency")?.toUpperCase() ?? "USD";
    return c.json({
      items: (await import("@proofcore/billing")).plansForDisplay(),
      displayCurrency: findPrice("developer", currency, "monthly") ? currency : "USD",
      recurringSupported: capabilities.automatedRecurring,
      provider: capabilities.provider,
      billingModelNote: capabilities.automatedRecurring
        ? "Recurring charges are supported by the configured provider."
        : `The configured provider (${capabilities.displayName}) cannot charge a saved mandate on a schedule. Paid plans are prepaid periods renewed manually; no automatic renewal is implied.`,
    });
  });
  return app;
}

function chooseCurrency(
  planKey: string,
  period: BillingPeriod,
  requested: string | undefined,
  supported: readonly string[]
): string | null {
  const candidates = requested ? [requested.toUpperCase()] : ["USD", "EUR", "XOF"];
  for (const currency of candidates) {
    if (!supported.includes(currency)) continue;
    if (findPrice(planKey, currency, period)) return currency;
  }
  return null;
}

function messageFor(state: string, entitled: boolean): string {
  if (entitled) return "Payment verified. Your plan is active.";
  switch (state) {
    case "PENDING":
    case "PROCESSING":
      return "The provider has not confirmed this payment yet. This page will show the verified state when it arrives.";
    case "FAILED":
      return "The provider reports this payment as failed. No paid access was granted.";
    case "CANCELLED":
      return "The payment was cancelled. No paid access was granted.";
    case "EXPIRED":
      return "The payment session expired. Start a new checkout to try again.";
    case "SUCCEEDED":
      return "The provider confirms the payment, but the subscription is not entitled yet (period ended or state changed). Contact support with this payment reference.";
    default:
      return "Payment has not been verified yet.";
  }
}

function nextActionFor(
  state: string,
  entitled: boolean
): "none" | "verify" | "retry" | "manual_renewal" | "contact_support" {
  if (entitled) return "none";
  if (state === "PENDING" || state === "PROCESSING" || state === "CREATED") return "verify";
  if (state === "FAILED" || state === "EXPIRED" || state === "CANCELLED") return "retry";
  if (state === "SUCCEEDED") return "contact_support";
  return "none";
}
