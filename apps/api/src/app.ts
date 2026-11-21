import type { PaymentProvider } from "@proofcore/adapter-payments";
import { API_VERSION } from "@proofcore/contracts";
import { iso, uuid } from "@proofcore/core";
import { Hono } from "hono";
import type { Database } from "./db/types.js";
import { type Env, originAllowed, readConfig } from "./env.js";
import { HttpError, toErrorResponse } from "./http/errors.js";
import { type AppEnv, createServices, type Services } from "./http/services.js";
import { createPaymentProvider } from "./providers.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";
import { aiRoutes } from "./routes/ai.js";
import { auditRoutes } from "./routes/audits.js";
import { authRoutes } from "./routes/auth.js";
import { billingRoutes, planRoutes } from "./routes/billing.js";
import { browserRoutes } from "./routes/browser.js";
import { deviceRoutes } from "./routes/device.js";
import { machineRoutes } from "./routes/machine.js";
import { projectIntelligenceRoutes } from "./routes/project-intelligence.js";
import { releaseRoutes } from "./routes/releases.js";
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
    // The API only returns JSON and never renders HTML, so a maximally strict policy
    // costs nothing and removes an entire class of reflected-content attacks.
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    c.header("X-Frame-Options", "DENY");
    c.header("Cross-Origin-Resource-Policy", "same-site");
    c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    // HSTS is set on every response; the Worker is only reachable over https.
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    await next();
  });

  // Credentialed CORS for the configured web origins, and nothing else. Production
  // runs both Vercel and Cloudflare Pages against the same Worker.
  //
  // Mounted on `*` rather than `/api/*` because `/health` is the endpoint the web app
  // probes on load. Scoping CORS to `/api/*` left the probe answering 200 with no
  // `Access-Control-Allow-Origin`, which the browser refuses to read — so a running
  // API looked unreachable and the UI told the user to start a server that was already
  // up.
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && originAllowed(config.webOrigins, origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
    }
    if (c.req.method === "OPTIONS") {
      c.header(
        // PUT is used by the project module configuration; omitting it made every save
        // fail in the browser as a CORS error before the request ever reached a route.
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      c.header(
        "Access-Control-Allow-Headers",
        "content-type, authorization, idempotency-key, x-request-id"
      );
      c.header("Access-Control-Max-Age", "600");
      return c.body(null, 204);
    }
    await next();
  });

  // Cookie-authenticated writes must come from a configured web origin.
  //
  // Mounted on `/api/*` and not just `/api/v1/*`: the account routes (password change,
  // session revocation, account deletion) and the auth routes are cookie-authenticated
  // writes too, and they sat outside the guard. `/api/webhooks/*` is excluded on purpose —
  // those calls come from a payment provider, carry no Origin, and are authenticated by
  // signature instead.
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/webhooks")) {
      await next();
      return;
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (origin && !originAllowed(config.webOrigins, origin)) {
        // The origin is echoed in `details` on purpose: without it the message reads like
        // a mystery, and the fix is always the same one line — add that host to WEB_ORIGIN.
        throw new HttpError(
          403,
          "cross_origin_denied",
          `This origin is not allowed to call the API: ${origin}. Add it to WEB_ORIGIN to allow it.`,
          { origin }
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
        service: "proofcore-api",
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
  app.route("/api/account", accountRoutes(services));
  app.route("/api/auth/device", deviceRoutes(services));
  app.route("/api/v1", planRoutes(services));
  // Registered before the workspace router: that router mounts a session guard on
  // `/api/v1/*`, so anything mounted after it would answer 401 to an anonymous visitor.
  // The download page is public by design and must describe releases before sign-in.
  app.route("/api/v1", releaseRoutes({ token: services.config.githubToken }));
  app.route("/api/v1", workspaceRoutes(services));
  app.route("/api/v1", projectIntelligenceRoutes(services));
  app.route("/api/v1/ai", aiRoutes(services));
  app.route("/api/v1", auditRoutes(services));
  app.route("/api/v1/browser", browserRoutes(services));
  app.route("/api/v1", billingRoutes(services));
  app.route("/api/v1/admin", adminRoutes(services));
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
