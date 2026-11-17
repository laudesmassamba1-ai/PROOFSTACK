import type { PaymentProvider } from "@proofstack/adapter-payments";
import { normalizeEmail } from "@proofstack/billing";
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
}

export type Env = Record<string, string | undefined>;

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
  };
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
