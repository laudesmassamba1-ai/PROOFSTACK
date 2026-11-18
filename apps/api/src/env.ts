import type { PaymentProvider } from "@proofcore/adapter-payments";
import { normalizeEmail } from "@proofcore/billing";
import { createPaymentProvider, hasSasPayCredentials } from "./providers.js";

/**
 * Runtime configuration. Values arrive from the environment on Node and from Worker
 * secrets/bindings on Cloudflare; nothing is read at module scope, so a missing
 * variable is a startup error with a message instead of a mystery 500 later.
 */
export interface AppConfig {
  environment: "development" | "production" | "test";
  /** Primary public origin of the web app: used for cookies and default return URLs. */
  webOrigin: string;
  /** Every web origin allowed to make credentialed calls (Vercel and Cloudflare Pages). */
  webOrigins: string[];
  apiOrigin: string;
  secureCookies: boolean;
  paymentProvider: "saspay" | "sandbox";
  /**
   * Accounts allowed to read the internal operations console. This is an
   * authorization list, not a secret: it contains no credential, and the session
   * cookie is still required. An empty list disables the console instead of
   * falling back to "first user" or "any authenticated user".
   */
  adminEmails: string[];
  /** Optional n8n webhook for verified payment events; never payment authority. */
  n8nWebhookUrl: string | undefined;
  n8nWebhookSecret: string | undefined;
  /** Master key for encrypting stored AI provider keys (AES-256-GCM, base64 or hex, >= 32 bytes). */
  aiKeysSecret: string | undefined;
  /**
   * Outbound e-mail. Without RESEND_API_KEY every message is journalled in
   * `email_outbox` with status `unconfigured` instead of being silently dropped, and
   * the API tells the truth about it. This is the one connection point a deployment
   * operator must fill in for password recovery to actually reach a human.
   */
  resendApiKey: string | undefined;
  mailFrom: string | undefined;
  /** Address shown to customers for support, and recipient of support notifications. */
  supportEmail: string;
  /**
   * Cloudflare Browser Rendering, used by the assistant's `browse_url` tool.
   *
   * A Worker cannot run Chromium, so a real rendered page needs this service. Without it
   * the tool still works, but reports `server_html`: the page as fetched, JavaScript not
   * executed. The distinction is shown to the user rather than hidden.
   */
  cfAccountId: string | undefined;
  /**
   * Assistant requests allowed per hour, per account and address.
   *
   * 40 was too tight to be useful: a single afternoon of real work, or a demo, hit the
   * wall and the user saw "trop de demandes" with no way forward. The default also has to
   * absorb retries, because a failed turn still counted. A signed-in human talking to their
   * own assistant should never meet this limit; the cap exists to stop a loop, so it is set
   * where only a runaway client can reach it.
   */
  aiRateLimitPerHour: number;
  cfBrowserToken: string | undefined;
}

export type Env = Record<string, string | undefined>;

/** A bounded positive integer from the environment, or the default. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.round(value), 10_000);
}

export function readConfig(env: Env): AppConfig {
  const environment = (
    env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development"
  ) as AppConfig["environment"];
  const webOrigins = parseWebOrigins(env.WEB_ORIGIN);
  const webOrigin = webOrigins[0] ?? "http://localhost:5173";
  const apiOrigin = (env.API_ORIGIN ?? "http://localhost:8787").replace(/\/+$/, "");
  return {
    environment,
    webOrigin,
    webOrigins,
    apiOrigin,
    // Secure cookies are mandatory in production and on any https origin. Loopback
    // http is the only case where they are omitted, because a Secure cookie on
    // http://localhost would make local sign-in impossible.
    secureCookies:
      environment === "production" || webOrigins.some((origin) => origin.startsWith("https://")),
    paymentProvider: hasSasPayCredentials(env) ? "saspay" : "sandbox",
    adminEmails: parseAdminEmails(env.ADMIN_EMAILS),
    n8nWebhookUrl: env.N8N_WEBHOOK_URL,
    n8nWebhookSecret: env.N8N_WEBHOOK_SECRET,
    aiKeysSecret: env.AI_KEYS_SECRET,
    resendApiKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM,
    supportEmail: env.SUPPORT_EMAIL ?? "support@proofcore.dev",
    cfAccountId: env.CF_ACCOUNT_ID?.trim() || undefined,
    aiRateLimitPerHour: positiveInt(env.AI_RATE_LIMIT_PER_HOUR, 5000),
    cfBrowserToken: env.CF_BROWSER_TOKEN?.trim() || undefined,
  };
}

/**
 * Is this `Origin` header one of ours?
 *
 * Exact matches cover the canonical deployments. A pattern entry may use `*` as one
 * label — `https://*.proofstack-01z.pages.dev` — because Cloudflare Pages and Vercel
 * give every deployment a fresh hostname (`6f0fee2d.proofstack-01z.pages.dev`,
 * `proofstack-3lh66ezz5-<team>.vercel.app`) and an allowlist that only names the
 * production alias silently rejects every write made from a preview URL. That is how a
 * workspace invitation answered `cross_origin_denied` while the rest of the app looked
 * fine.
 *
 * The match is deliberately narrow:
 *   - the scheme must be identical, so `http://x` never matches `https://x`;
 *   - `*` stands for exactly one label, so `evil.attacker.com.our.domain` cannot pass;
 *   - no path, query or trailing slash is accepted in the header value.
 *
 * A bare wildcard over a shared suffix (`https://*.pages.dev`) is not a pattern this
 * function can express safely and should never be configured: anyone can deploy to it.
 */
export function originAllowed(origins: readonly string[], candidate: string | undefined): boolean {
  if (!candidate) return false;
  // The header is a serialized origin, i.e. scheme://host[:port]. It always contains
  // "//", so a naive "no slash" test rejects everything — including our own app. Parsing
  // it is also what turns a hostile string like `https://x.dev/path` into a refusal
  // instead of a lucky prefix match.
  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return false;
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return false;
  const value = parsed.origin;
  for (const entry of origins) {
    if (entry === value) return true;
    const star = entry.indexOf("*");
    if (star === -1) continue;
    const prefix = entry.slice(0, star);
    const suffix = entry.slice(star + 1);
    if (!value.startsWith(prefix) || !value.endsWith(suffix)) continue;
    const label = value.slice(prefix.length, value.length - suffix.length);
    if (label.length > 0 && !label.includes(".")) return true;
  }
  return false;
}

function parseWebOrigins(raw: string | undefined): string[] {
  const values = (raw ?? "http://localhost:5173")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => value.length > 0);
  return [...new Set(values)];
}

function parseAdminEmails(raw: string | undefined): string[] {
  const values = (raw ?? "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter((value) => value.length > 0);
  return [...new Set(values)];
}

/** Case-insensitive membership test against the configured allowlist. */
export function isAdminEmail(config: AppConfig, email: string): boolean {
  return config.adminEmails.includes(normalizeEmail(email));
}

export function paymentProviderFor(env: Env): PaymentProvider {
  return createPaymentProvider(env);
}
