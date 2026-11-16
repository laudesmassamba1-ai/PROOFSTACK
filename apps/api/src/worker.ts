import type { PaymentProvider } from "@proofstack/adapter-payments";
import { createApp } from "./app.js";
import { d1Database } from "./db/d1.js";
import type { Env } from "./env.js";
import { createPaymentProvider } from "./providers.js";

type WorkerEnv = {
  DB: Parameters<typeof d1Database>[0];
  [key: string]: unknown;
};

/**
 * Cloudflare Worker entry.
 *
 * Production persistence is D1. The provider is cached per isolate so a sandbox
 * deployment keeps its scripted transactions across requests within that isolate;
 * with SasPay configured the adapter is stateless and caching is equally correct.
 */
let cachedProvider: PaymentProvider | null = null;
let cachedProviderKind: string | null = null;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const bindings = env as Env;
    const kind = bindings.SASPAY_API_KEY && bindings.SASPAY_WEBHOOK_SECRET ? "saspay" : "sandbox";
    if (!cachedProvider || cachedProviderKind !== kind) {
      cachedProvider = createPaymentProvider(bindings);
      cachedProviderKind = kind;
    }
    const { app } = createApp({ db: d1Database(env.DB), env: bindings, provider: cachedProvider });
    return app.fetch(request, env);
  },
};
