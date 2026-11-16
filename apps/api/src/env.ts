import type { PaymentProvider } from "@proofstack/adapter-payments";
import { createPaymentProvider, hasSasPayCredentials } from "./providers.js";

/**
 * Runtime configuration. Values arrive from the environment on Node and from Worker
 * secrets/bindings on Cloudflare; nothing is read at module scope, so a missing
 * variable is a startup error with a message instead of a mystery 500 later.
 */
export interface AppConfig {
  environment: "development" | "production" | "test";
  /** Public origin of the web app: used for cookies, origin checks and return URLs. */
  webOrigin: string;
  apiOrigin: string;
  secureCookies: boolean;
  paymentProvider: "saspay" | "sandbox";
}

export type Env = Record<string, string | undefined>;

export function readConfig(env: Env): AppConfig {
  const environment = (
    env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development"
  ) as AppConfig["environment"];
  const webOrigin = (env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "");
  const apiOrigin = (env.API_ORIGIN ?? "http://localhost:8787").replace(/\/+$/, "");
  return {
    environment,
    webOrigin,
    apiOrigin,
    // Secure cookies are mandatory in production and on any https origin. Loopback
    // http is the only case where they are omitted, because a Secure cookie on
    // http://localhost would make local sign-in impossible.
    secureCookies: environment === "production" || webOrigin.startsWith("https://"),
    paymentProvider: hasSasPayCredentials(env) ? "saspay" : "sandbox",
  };
}

export function paymentProviderFor(env: Env): PaymentProvider {
  return createPaymentProvider(env);
}
