import type { PaymentProvider } from "@proofstack/adapter-payments";
import { API_VERSION } from "@proofstack/contracts";
import { iso, uuid } from "@proofstack/core";
import { Hono } from "hono";
import type { Database } from "./db/types.js";
import { type Env, readConfig } from "./env.js";
import { HttpError, toErrorResponse } from "./http/errors.js";
import { type AppEnv, createServices, type Services } from "./http/services.js";
import { createPaymentProvider } from "./providers.js";
import { authRoutes } from "./routes/auth.js";
import { billingRoutes, planRoutes } from "./routes/billing.js";
import { machineRoutes } from "./routes/machine.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { workspaceRoutes } from "./routes/workspace.js";

export interface CreateAppOptions {
  db: Database;
  env?: Env;
  provider?: PaymentProvider;
  clock?: () => Date;
}

/**
 * The HTTP application.
 *
 * It is transport-agnostic: the Worker and the Node dev server both call this, and the
 * tests call `app.request()` directly. That is why every guarantee the product makes
 * is testable without a browser or a deployed worker.
 */
export function createApp(options: CreateAppOptions): { app: Hono<AppEnv>; services: Services } {
  const env = options.env ?? (process.env as Env);
  const config = readConfig(env);
  const provider = options.provider ?? createPaymentProvider(env);
  const services = createServices({
    db: options.db,
    config,
    provider,
    ...(options.clock ? { clock: options.clock } : {}),
  });

  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const requestId =
      c.req.header("x-request-id") ?? `req_${uuid().replaceAll("-", "").slice(0, 16)}`;
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });

  // Credentialed CORS for the one allowed web origin, and nothing else.
  //
  // Mounted on `*` rather than `/api/*` because `/health` is the endpoint the web app
  // probes on load. Scoping CORS to `/api/*` left the probe answering 200 with no
  // `Access-Control-Allow-Origin`, which the browser refuses to read — so a running
  // API looked unreachable and the UI told the user to start a server that was already
  // up. The origin allow-list is still exactly one origin; only the path scope widened.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin === config.webOrigin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
    }
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      c.header(
        "Access-Control-Allow-Headers",
        "content-type, authorization, idempotency-key, x-request-id"
      );
      c.header("Access-Control-Max-Age", "600");
      return c.body(null, 204);
    }
    await next();
  });

  // Cookie-authenticated writes must come from the configured web origin.
  app.use("/api/v1/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (origin && origin !== config.webOrigin) {
        throw new HttpError(
          403,
          "cross_origin_denied",
          "This origin is not allowed to call the API."
        );
      }
    }
    await next();
  });

  app.get("/health", async (c) => {
    let database = "ok";
    try {
      await services.db.prepare("SELECT 1").first();
    } catch {
      database = "unreachable";
    }
    return c.json(
      {
        status: database === "ok" ? "ok" : "degraded",
        service: "proofstack-api",
        apiVersion: API_VERSION,
        time: iso(services.clock()),
        database,
        payments: {
          provider: services.provider.getCapabilities().provider,
          configured: services.provider.getCapabilities().provider !== "sandbox",
        },
      },
      200
    );
  });

  app.route("/api/auth", authRoutes(services));
  app.route("/api/v1", planRoutes(services));
  app.route("/api/v1", workspaceRoutes(services));
  app.route("/api/v1", billingRoutes(services));
  app.route("/v1", machineRoutes(services));
  app.route("/api/webhooks", webhookRoutes(services));

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: "No route matches this request.",
          category: "NOT_FOUND",
          requestId: c.get("requestId") ?? "unknown",
        },
      },
      404
    )
  );

  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? "unknown";
    const { status, body } = toErrorResponse(error, requestId);
    if (status >= 500) {
      // Structured, redacted: a stack trace may contain a provider token in a URL.
      console.error(
        JSON.stringify({
          level: "error",
          requestId,
          path: c.req.path,
          method: c.req.method,
          code: body.error.code,
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
    return c.json(body, status as 400);
  });

  return { app, services };
}

export type { Services };
