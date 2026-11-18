import { hmacSha256Hex } from "@proofcore/core";
import type { Services } from "./http/services.js";

/**
 * Outbound workspace webhooks.
 *
 * A workspace registers its own endpoint (a Slack relay, its own n8n, a CI
 * trigger) and PROOFCORE delivers signed events after the local commit. Same
 * authority rules as the ops n8n bridge: the event is sent only after the
 * database holds the truth, a delivery failure changes nothing, and every
 * message is signed HMAC-SHA256 over `${timestamp}.${body}` in
 * `x-proofcore-signature` — receivers reject unsigned or stale (> 300 s) calls.
 *
 * The per-endpoint secret is stored server-side because deliveries are signed
 * here; it is shown in plaintext exactly once, at creation. Delivery targets
 * must be https in production; plain http stays possible for local
 * automations (self-hosted n8n, localhost receivers).
 */

export const WEBHOOK_EVENTS = ["run.completed", "findings.failed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  event: WebhookEvent;
  workspaceId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/** A webhook target the API is willing to deliver to from this deployment. */
export function isValidWebhookUrl(value: string, environment: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const isLocal =
      /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(
        url.hostname
      );
    if (environment === "production") return url.protocol === "https:" && !isLocal;
    // Local deployments may reach local receivers (n8n on :5678, dev relays).
    return true;
  } catch {
    return false;
  }
}

export async function deliverWorkspaceEvent(
  services: Services,
  payload: WebhookPayload
): Promise<void> {
  const webhooks = await services.store.listWorkspaceWebhooks(payload.workspaceId);
  const matching = webhooks.filter((webhook) => webhook.events.includes(payload.event));
  if (matching.length === 0) return;

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(new Date(services.clock()).getTime() / 1000).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    await Promise.all(
      matching.map(async (webhook) => {
        const signature = await hmacSha256Hex(webhook.secret, `${timestamp}.${body}`);
        try {
          const response = await fetch(webhook.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-proofcore-timestamp": timestamp,
              "x-proofcore-signature": `sha256=${signature}`,
              "x-proofcore-event": payload.event,
            },
            body,
            signal: controller.signal,
          });
          await services.store.markWebhookDelivery(
            webhook.id,
            response.status,
            response.ok ? null : `HTTP ${response.status}`
          );
        } catch (error) {
          await services.store.markWebhookDelivery(
            webhook.id,
            null,
            error instanceof Error ? error.message.slice(0, 200) : "delivery failed"
          );
        }
      })
    );
  } finally {
    clearTimeout(timer);
  }
}
