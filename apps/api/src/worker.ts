import type { PaymentProvider } from "@proofcore/adapter-payments";
import { createApp } from "./app.js";
import { d1Database } from "./db/d1.js";
import type { Env } from "./env.js";
import { createPaymentProvider } from "./providers.js";
import { workerRenderer } from "./worker-renderer.js";

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

function build(env: WorkerEnv) {
  const bindings = env as Env;
  const kind = bindings.SASPAY_API_KEY && bindings.SASPAY_WEBHOOK_SECRET ? "saspay" : "sandbox";
  if (!cachedProvider || cachedProviderKind !== kind) {
    cachedProvider = createPaymentProvider(bindings);
    cachedProviderKind = kind;
  }
  const app = createApp({ db: d1Database(env.DB), env: bindings, provider: cachedProvider });
  // The Worker's Browser Rendering binding lets a site audit read the DOM of a SPA;
  // without it the scan would see one empty shell and call it a one-page site.
  app.services.renderer = workerRenderer(env.BROWSER, env as Record<string, string | undefined>);
  return app;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const { app } = build(env);
    return app.fetch(request, env as Env);
  },

  /**
   * Retention sweep, daily.
   *
   * A report nobody deletes is a promise nobody keeps: `report_retention_days` is
   * written into every row at upload time, and this is the job that honours it.
   * Lazy purges on read keep a workspace honest between sweeps; this one keeps the
   * whole database honest even for workspaces nobody has opened in months.
   */
  async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
    const { services } = build(env);
    const now = services.clock().toISOString();
    await services.store.purgeAllExpiredReports(now);
    await services.store.purgeExpiredIdempotencyKeys(now);
  },
};
