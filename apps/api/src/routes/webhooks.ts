import { Hono } from "hono";
import { notifyPaymentEvent } from "../automation.js";
import { HttpError } from "../http/errors.js";
import type { AppEnv, Services } from "../http/services.js";
import { notifyFinalize } from "./billing.js";

/**
 * Webhook ingestion.
 *
 * The raw body is passed through untouched: the signature is computed over the exact
 * bytes the provider sent. Parsing and re-serialising JSON would invalidate every
 * signature. Authenticity, replay and authority are handled by WebhookProcessor:
 * signature window first, then the unique event id, then a server-side verification —
 * the payload never decides a payment state.
 *
 * A processing failure answers 500 on purpose, so the provider retries. A duplicate
 * answers 200 with `duplicate: true` and changes nothing.
 */
export function webhookRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/:provider", async (c) => {
    const provider = c.req.param("provider");
    const configured = services.provider.getCapabilities().provider;
    if (provider !== configured) {
      // A webhook for a provider this deployment does not use is not our event.
      throw new HttpError(
        404,
        "unknown_provider",
        "This deployment is not configured for that payment provider."
      );
    }

    const length = Number(c.req.header("content-length") ?? 0);
    if (length > 256_000)
      throw new HttpError(413, "payload_too_large", "Webhook payload exceeds 256 KB.");

    const body = await c.req.text();
    // `content-length` is optional on a chunked request, so check the actual body too.
    if (body.length > 256_000)
      throw new HttpError(413, "payload_too_large", "Webhook payload exceeds 256 KB.");
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.header())) {
      if (value !== undefined) headers[key.toLowerCase()] = value;
    }

    try {
      const outcome = await services.webhooks.handle({ body, headers });
      if (outcome.body.ok && !outcome.body.duplicate) {
        // A verified webhook can credit (or fail) a payment. The billing engine wrote the
        // audit row; project it into the inbox of the workspace members. Duplicates do
        // not reach here, so the dedupe key is a second line of defence, not the first.
        if (
          outcome.body.result === "credited" ||
          outcome.body.result === "failed" ||
          outcome.body.result === "already_credited"
        ) {
          const intent = outcome.body.intentId
            ? await services.billing.getIntent(outcome.body.intentId)
            : null;
          if (intent) {
            await notifyFinalize(
              services,
              intent.workspaceId,
              outcome.body.result === "failed" ? "failed" : "credited",
              intent.planKey
            );
          }
        }
        const task = notifyPaymentEvent(services.config, {
          event: "payment.webhook.processed",
          provider,
          ...(outcome.body.eventId ? { providerEventId: outcome.body.eventId } : {}),
          ...(outcome.body.intentId ? { intentId: outcome.body.intentId } : {}),
          ...(outcome.body.result ? { result: outcome.body.result } : {}),
          occurredAt: new Date(services.clock()).toISOString(),
        });
        try {
          c.executionCtx.waitUntil(task);
        } catch {
          // Hono's Node adapter has no executionCtx; local dev may await it.
          void task;
        }
      }
      return c.json(outcome.body, outcome.status as 200);
    } catch (error) {
      // Retryable processing failure: keep the event row (state FAILED_RETRYABLE) and
      // ask the provider to deliver it again.
      console.error("[webhook] processing failed", error instanceof Error ? error.message : error);
      throw new HttpError(
        500,
        "webhook_processing_failed",
        "The event was recorded but could not be processed yet."
      );
    }
  });

  return app;
}
