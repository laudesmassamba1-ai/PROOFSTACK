import { ProofstackError, iso, sha256Hex, uuid } from "@proofstack/core";
import type { WebhookEventRecord } from "@proofstack/contracts";
import type { PaymentProvider, WebhookEvent } from "@proofstack/adapter-payments";
import type { CheckoutService } from "./checkout.js";
import type { BillingStore } from "./store.js";

/**
 * Webhook ingestion.
 *
 * Three properties, in this order, because each one is a different attack:
 *   1. authenticity — signature and timestamp window, verified on the RAW body
 *   2. replay safety — the eventId is unique-indexed; a duplicate is acknowledged
 *      with 200 and performs zero side effects
 *   3. authority — the event body is NEVER trusted for state. It only tells us which
 *      transaction to go and verify with the provider.
 *
 * That third point is what makes out-of-order delivery harmless: the state always
 * comes from verify, so a late PAID after an already-verified SUCCESS changes nothing.
 */

export interface WebhookOutcome {
  status: 200 | 400 | 404 | 410;
  body: {
    ok: boolean;
    eventId?: string;
    intentId?: string;
    result?: string;
    reason?: string;
    duplicate?: boolean;
  };
}

export class WebhookProcessor {
  constructor(
    private readonly store: BillingStore,
    private readonly provider: PaymentProvider,
    private readonly checkout: CheckoutService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async handle(input: { body: string; headers: Record<string, string> }): Promise<WebhookOutcome> {
    const now = this.clock();
    const verified = await this.provider.verifyWebhook(input);

    if (!verified.valid || !verified.event) {
      // Unsigned or stale deliveries are rejected before anything is written.
      return {
        status: 400,
        body: { ok: false, reason: verified.reason ?? "signature verification failed" },
      };
    }

    const event = verified.event;
    const bodyDigest = await sha256Hex(input.body);

    const record: WebhookEventRecord = {
      id: uuid(),
      provider: event.provider,
      providerEventId: event.eventId,
      type: event.type,
      receivedAt: iso(now),
      signatureValid: true,
      processingState: "RECEIVED",
      bodyDigest,
    };

    // Replay wall. The store's uniqueness on (provider, providerEventId) is what
    // makes this correct under concurrent delivery, not the read below.
    const isNew = await this.store.insertWebhook(record);
    if (!isNew) {
      return {
        status: 200,
        body: { ok: true, eventId: event.eventId, duplicate: true, result: "already_processed" },
      };
    }

    const reference = event.data.transactionId ?? event.data.reference;
    if (!reference) {
      await this.store.saveWebhook({
        ...record,
        processingState: "REJECTED",
        processedAt: iso(now),
        error: "no transaction reference in payload",
      });
      return { status: 200, body: { ok: true, eventId: event.eventId, result: "ignored_no_reference" } };
    }

    const intent = await this.store.findIntentByProviderReference(reference);
    if (!intent) {
      // Unknown reference: another environment sharing the key, or a webhook that
      // arrived before our row was written. Acknowledge, record, do not retry-loop,
      // and never create an intent from a webhook alone.
      await this.store.saveWebhook({
        ...record,
        processingState: "REJECTED",
        processedAt: iso(now),
        error: `no payment intent for reference ${reference}`,
      });
      return {
        status: 404,
        body: { ok: false, eventId: event.eventId, reason: "no matching payment intent" },
      };
    }

    try {
      const result = await this.checkout.finalize(intent.id, { source: "webhook" });
      await this.store.saveWebhook({
        ...record,
        processingState: "PROCESSED",
        processedAt: iso(now),
      });
      return {
        status: 200,
        body: { ok: true, eventId: event.eventId, intentId: intent.id, result: result.outcome },
      };
    } catch (error) {
      if (error instanceof ProofstackError && error.code === "unknown_payment_status") {
        // The provider invented a status. Refuse to credit, keep the intent as it was.
        await this.store.saveWebhook({
          ...record,
          processingState: "REJECTED",
          processedAt: iso(now),
          error: error.message,
        });
        return {
          status: 200,
          body: { ok: true, eventId: event.eventId, intentId: intent.id, result: "unmapped_status" },
        };
      }
      // Anything else is retryable: keep the event so a replay can finish the work.
      await this.store.saveWebhook({
        ...record,
        processingState: "FAILED_RETRYABLE",
        processedAt: iso(now),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export function describeEvent(event: WebhookEvent): string {
  return `${event.type} ${event.data.transactionId ?? "—"} ${event.data.status ?? "—"}`;
}
