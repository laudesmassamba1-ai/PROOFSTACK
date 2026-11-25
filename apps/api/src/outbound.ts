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

/**
 * Hosts that are never a legitimate webhook receiver, whatever the environment.
 * `metadata.google.internal` / `instance-data` are the two cloud metadata names an
 * attacker tries first; the rest are cluster/service-discovery names that only resolve
 * inside the deployment's own network.
 */
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

/** Single-label names and special-use suffixes never belong to a public receiver. */
const BLOCKED_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".home.arpa",
  ".localdomain",
  ".svc",
  ".cluster.local",
];

/** Service ports a webhook has no reason to reach. */
const SENSITIVE_PORTS = new Set([
  "22",
  "23",
  "25",
  "53",
  "110",
  "143",
  "389",
  "445",
  "465",
  "587",
  "993",
  "995",
  "1433",
  "1521",
  "2049",
  "2375",
  "2376",
  "3306",
  "3389",
  "5432",
  "5672",
  "6379",
  "6443",
  "8500",
  "9090",
  "9200",
  "11211",
  "27017",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = numbers as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIpv6(raw: string): boolean {
  const host = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  // Any IPv4-mapped address is judged by the IPv4 it embeds; refusing the whole
  // `::ffff:` space is simpler than parsing both dotted and hexadecimal forms.
  if (host.startsWith("::ffff:")) return true;
  if (host.startsWith("64:ff9b:")) return true; // NAT64 translation prefix
  if (host.startsWith("2001:db8")) return true; // documentation
  const first = Number.parseInt(host.split(":")[0] ?? "", 16);
  if (Number.isNaN(first)) return false;
  if ((first & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  return false;
}

/** Loopback and RFC1918 are reachable only when the deployment itself is local. */
function isLanAddress(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare === "::1") return true;
  const parts = bare.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * A webhook target the API is willing to deliver to from this deployment.
 *
 * This is the same class of control as the scanner's SSRF guard, and it has to be just
 * as strict: without it, any workspace owner could register `https://169.254.169.254/`
 * and make the API POST run data to the cloud metadata service from inside the
 * deployment's network. The URL parser normalises decimal/octal/hex IPv4 forms, so
 * checking the parsed hostname catches `http://2130706433/` too.
 *
 * Local receivers (n8n on :5678, a test relay on 127.0.0.1) stay possible outside
 * production; link-local, metadata and reserved ranges are refused everywhere.
 */
export function isValidWebhookUrl(value: string, environment: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;

  const production = environment === "production";
  if (production && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  const bare = host.replace(/^\[|\]$/g, "");
  if (!bare) return false;
  if (BLOCKED_HOSTNAMES.has(bare)) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => bare.endsWith(suffix))) return false;
  // A bare label is an intranet name (or a mistake), never a public receiver. The one
  // exception is `localhost`, which is the documented local receiver and stays confined
  // to non-production by the loopback check below.
  const localhost = bare === "localhost";
  if (!localhost && !bare.includes(".") && !bare.includes(":")) return false;

  if (isPrivateIpv6(host)) {
    if (!isLanAddress(bare) || production) return false;
  } else if (isPrivateIpv4(bare) && (production || !isLanAddress(bare))) {
    return false;
  }

  if (production && url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    if (SENSITIVE_PORTS.has(String(port))) return false;
    if (port < 1024 && port !== 80 && port !== 443) return false;
  }
  return true;
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
        // Re-validate at delivery time, not only at registration: a stored row can
        // predate a policy change, or the deployment's environment can differ from the
        // one that accepted it. A URL that is no longer acceptable fails visibly.
        if (!isValidWebhookUrl(webhook.url, services.config.environment)) {
          await services.store.markWebhookDelivery(
            webhook.id,
            null,
            "blocked: the target is not a public webhook endpoint"
          );
          return;
        }
        const signature = await hmacSha256Hex(webhook.secret, `${timestamp}.${body}`);
        try {
          const response = await fetch(webhook.url, {
            method: "POST",
            // A redirect is a second request to a host nobody validated. Receivers
            // that answer 3xx get a visible delivery failure instead.
            redirect: "manual",
            headers: {
              "content-type": "application/json",
              "x-proofcore-timestamp": timestamp,
              "x-proofcore-signature": `sha256=${signature}`,
              "x-proofcore-event": payload.event,
            },
            body,
            signal: controller.signal,
          });
          const redirected = response.status >= 300 && response.status < 400;
          await response.body?.cancel().catch(() => undefined);
          await services.store.markWebhookDelivery(
            webhook.id,
            response.status,
            response.ok
              ? null
              : redirected
                ? `HTTP ${response.status} (redirects are not followed)`
                : `HTTP ${response.status}`
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
