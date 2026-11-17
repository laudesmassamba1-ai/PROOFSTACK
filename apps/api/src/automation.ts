import type { AppConfig } from "./env.js";

/**
 * Optional n8n notification bridge.
 *
 * n8n is an observer, never the payment authority: this runs only after the
 * WebhookProcessor has verified the provider and persisted the outcome. A slow or
 * unavailable n8n must not turn a successful payment into a provider retry, so
 * delivery failures are logged and swallowed.
 */
export interface PaymentAutomationEvent {
  event: "payment.webhook.processed";
  provider: string;
  providerEventId?: string;
  intentId?: string;
  result?: string;
  occurredAt: string;
}

export async function notifyPaymentEvent(
  config: AppConfig,
  event: PaymentAutomationEvent
): Promise<void> {
  const url = config.n8nWebhookUrl;
  if (!url) return;

  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = config.n8nWebhookSecret ?? "";
  const signature = await hmacHex(secret, `${timestamp}.${body}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-proofcore-timestamp": timestamp,
        "x-proofcore-signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[n8n] payment notification rejected with HTTP ${response.status}`);
    }
  } catch (error) {
    // The payment is already committed. n8n is best-effort telemetry/automation.
    console.warn(
      `[n8n] payment notification failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
