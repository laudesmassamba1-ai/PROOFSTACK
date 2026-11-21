import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/types.js";
import { nullableStr, num, parseJson, type Row, str } from "../db/types.js";
import { isAdminEmail } from "../env.js";
import { HttpError } from "../http/errors.js";
import { readBody, requireUser } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";

/**
 * Internal operations console.
 *
 * Read-only on purpose: the creator needs to see users, workspaces, payments, runs and
 * webhook failures, not another write surface with production authority. Every request
 * re-resolves the session and re-checks the `ADMIN_EMAILS` allowlist; the `isAdmin`
 * flag in the browser session is only a navigation hint.
 *
 * No row selected here contains a password hash, a session token hash or an API key.
 * Revenue is reported from verified/credited payment intents, never from a browser
 * redirect or a plan row.
 */

interface RunTotalsShape {
  total?: number;
  failed?: number;
  errors?: number;
}

/** Wrangler's `d1 migrations apply` records in d1_migrations; the app's own
 *  migrate() records in schema_migrations. Local test databases only have the
 *  latter, so the query adapts to whichever tables exist. */
async function latestMigrationRow(db: Services["db"]): Promise<Row | null> {
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('d1_migrations','schema_migrations')"
    )
    .all<{ name: string }>();
  const names = tables.map((row) => row.name);
  const hasD1 = names.includes("d1_migrations");
  const hasApp = names.includes("schema_migrations");
  const query =
    hasD1 && hasApp
      ? `SELECT id FROM (
         SELECT name AS id, applied_at FROM d1_migrations
         UNION ALL
         SELECT id, applied_at FROM schema_migrations
       ) ORDER BY applied_at DESC LIMIT 1`
      : hasD1
        ? "SELECT name AS id, applied_at FROM d1_migrations ORDER BY applied_at DESC LIMIT 1"
        : "SELECT id, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1";
  return db.prepare(query).first<Row>();
}

export function adminRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const user = await requireUser(c, services);
    if (services.config.adminEmails.length === 0) {
      throw new HttpError(
        503,
        "admin_not_configured",
        "The operations console is disabled: ADMIN_EMAILS is empty on this deployment."
      );
    }
    if (!isAdminEmail(services.config, user.email)) {
      throw new HttpError(
        403,
        "admin_required",
        "This account is not allowed to read the operations console."
      );
    }
    await next();
  });

  app.get("/overview", async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    const now = services.clock();
    const since24h = new Date(now.getTime() - 86_400_000).toISOString();
    const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();

    const [
      usersCount,
      workspacesCount,
      projectsCount,
      activeSubscriptions,
      runs24h,
      runs7d,
      failedFindings7d,
      failedWebhooks,
      latestMigration,
      revenueRows,
      paymentStateRows,
      userRows,
      workspaceRows,
      paymentRows,
      runRows,
      webhookRows,
    ] = await Promise.all([
      count(services.db, "SELECT COUNT(*) AS count FROM users"),
      count(services.db, "SELECT COUNT(*) AS count FROM workspaces"),
      count(services.db, "SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL"),
      count(
        services.db,
        "SELECT COUNT(*) AS count FROM subscriptions WHERE state NOT IN ('CANCELLED', 'EXPIRED')"
      ),
      count(services.db, "SELECT COUNT(*) AS count FROM test_runs WHERE started_at >= ?", since24h),
      count(services.db, "SELECT COUNT(*) AS count FROM test_runs WHERE started_at >= ?", since7d),
      count(
        services.db,
        "SELECT COUNT(*) AS count FROM findings WHERE status = 'FAILED' AND detected_at >= ?",
        since7d
      ),
      count(
        services.db,
        "SELECT COUNT(*) AS count FROM webhook_events WHERE processing_state = 'FAILED'"
      ),
      latestMigrationRow(services.db),
      services.db
        .prepare(
          `SELECT currency,
                  SUM(CAST(COALESCE(verified_amount_minor, amount_minor) AS INTEGER)) AS minor,
                  COUNT(*) AS payment_count
           FROM payment_intents
           WHERE credited = 1
           GROUP BY currency
           ORDER BY currency`
        )
        .all<Row>(),
      services.db
        .prepare(
          `SELECT state, COUNT(*) AS count FROM payment_intents
           GROUP BY state ORDER BY count DESC`
        )
        .all<Row>(),
      services.db
        .prepare(
          `SELECT u.id, u.email, u.name, u.created_at, u.email_verified_at,
                  (SELECT COUNT(*) FROM workspace_members m WHERE m.user_id = u.id) AS workspace_count,
                  (SELECT COUNT(*) FROM test_runs r
                   WHERE r.workspace_id IN
                     (SELECT m2.workspace_id FROM workspace_members m2 WHERE m2.user_id = u.id)) AS run_count,
                  (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_session_at
           FROM users u
           ORDER BY u.created_at DESC LIMIT ?`
        )
        .bind(limit)
        .all<Row>(),
      services.db
        .prepare(
          `SELECT w.id, w.name, w.slug, w.created_at,
                  (SELECT u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
                   WHERE m.workspace_id = w.id
                   ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at ASC
                   LIMIT 1) AS owner_email,
                  (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
                  (SELECT COUNT(*) FROM projects p
                   WHERE p.workspace_id = w.id AND p.deleted_at IS NULL) AS project_count,
                  (SELECT COUNT(*) FROM test_runs r WHERE r.workspace_id = w.id) AS run_count,
                  (SELECT s.plan_key FROM subscriptions s
                   WHERE s.workspace_id = w.id ORDER BY s.created_at DESC LIMIT 1) AS plan_key,
                  (SELECT s.state FROM subscriptions s
                   WHERE s.workspace_id = w.id ORDER BY s.created_at DESC LIMIT 1) AS plan_state,
                  (SELECT MAX(r.started_at) FROM test_runs r WHERE r.workspace_id = w.id) AS last_run_at
           FROM workspaces w
           ORDER BY w.created_at DESC LIMIT ?`
        )
        .bind(limit)
        .all<Row>(),
      services.db
        .prepare(
          `SELECT p.id, p.workspace_id, p.plan_key, p.period, p.currency, p.amount_minor,
                  p.state, p.credited, p.provider, p.provider_reference, p.failure_reason,
                  p.created_at, w.name AS workspace_name
           FROM payment_intents p JOIN workspaces w ON w.id = p.workspace_id
           ORDER BY p.created_at DESC LIMIT ?`
        )
        .bind(limit)
        .all<Row>(),
      services.db
        .prepare(
          `SELECT r.id, r.workspace_id, r.project_id, r.status, r.started_at, r.duration_ms,
                  r.environment, r.totals, w.name AS workspace_name, p.name AS project_name
           FROM test_runs r
           JOIN workspaces w ON w.id = r.workspace_id
           JOIN projects p ON p.id = r.project_id
           ORDER BY r.started_at DESC LIMIT ?`
        )
        .bind(limit)
        .all<Row>(),
      services.db
        .prepare(
          `SELECT id, provider, type, processing_state, received_at, signature_valid, error
           FROM webhook_events ORDER BY received_at DESC LIMIT ?`
        )
        .bind(Math.min(50, limit))
        .all<Row>(),
    ]);

    const capabilities = services.provider.getCapabilities();

    return c.json({
      generatedAt: now.toISOString(),
      admin: { email: c.get("user").email },
      provider: {
        slug: capabilities.provider,
        displayName: capabilities.displayName,
        live: capabilities.provider !== "sandbox",
      },
      totals: {
        users: usersCount,
        workspaces: workspacesCount,
        projects: projectsCount,
        activeSubscriptions,
        runs24h,
        runs7d,
        failedFindings7d,
        failedWebhooks,
        latestMigration: latestMigration ? nullableStr(latestMigration, "id") : null,
      },
      revenue: revenueRows.map((row) => ({
        currency: str(row, "currency"),
        minor: String(num(row, "minor")),
        payments: num(row, "payment_count"),
      })),
      paymentsByState: paymentStateRows.map((row) => ({
        state: str(row, "state"),
        count: num(row, "count"),
      })),
      users: userRows.map((row) => ({
        id: str(row, "id"),
        email: str(row, "email"),
        name: str(row, "name"),
        createdAt: str(row, "created_at"),
        emailVerified: nullableStr(row, "email_verified_at") !== null,
        workspaces: num(row, "workspace_count"),
        runs: num(row, "run_count"),
        lastSessionAt: nullableStr(row, "last_session_at"),
      })),
      workspaces: workspaceRows.map((row) => ({
        id: str(row, "id"),
        name: str(row, "name"),
        slug: str(row, "slug"),
        createdAt: str(row, "created_at"),
        ownerEmail: nullableStr(row, "owner_email"),
        members: num(row, "member_count"),
        projects: num(row, "project_count"),
        runs: num(row, "run_count"),
        planKey: nullableStr(row, "plan_key"),
        planState: nullableStr(row, "plan_state"),
        lastRunAt: nullableStr(row, "last_run_at"),
      })),
      payments: paymentRows.map((row) => ({
        id: str(row, "id"),
        workspaceId: str(row, "workspace_id"),
        workspaceName: str(row, "workspace_name"),
        planKey: str(row, "plan_key"),
        period: str(row, "period"),
        amountMinor: str(row, "amount_minor"),
        currency: str(row, "currency"),
        state: str(row, "state"),
        credited: num(row, "credited") === 1,
        provider: str(row, "provider"),
        providerReference: nullableStr(row, "provider_reference"),
        failureReason: nullableStr(row, "failure_reason"),
        createdAt: str(row, "created_at"),
      })),
      runs: runRows.map((row) => {
        const totals = runTotals(row.totals);
        return {
          id: str(row, "id"),
          workspaceName: str(row, "workspace_name"),
          projectName: str(row, "project_name"),
          status: str(row, "status"),
          environment: str(row, "environment"),
          startedAt: str(row, "started_at"),
          durationMs: num(row, "duration_ms"),
          totalCases: totals.total,
          failedCases: totals.failed,
        };
      }),
      webhooks: webhookRows.map((row) => ({
        id: str(row, "id"),
        provider: str(row, "provider"),
        type: str(row, "type"),
        state: str(row, "processing_state"),
        receivedAt: str(row, "received_at"),
        signatureValid: num(row, "signature_valid") === 1,
        error: nullableStr(row, "error"),
      })),
    });
  });

  /**
   * Customer messages, with their current workflow state.
   *
   * Read-only apart from the reply below: the creator answers a message, and the customer
   * can then read that answer with the reference and the address they wrote from.
   */
  app.get("/support", async (c) => {
    const rows = await services.store.listSupportMessages(50);
    return c.json({
      items: rows.map((row) => ({
        id: str(row, "id"),
        from: str(row, "from_address"),
        subject: str(row, "subject"),
        body: str(row, "body"),
        status: str(row, "status"),
        reply: nullableStr(row, "reply_body"),
        repliedAt: nullableStr(row, "replied_at"),
        createdAt: str(row, "created_at"),
        updatedAt: nullableStr(row, "updated_at"),
      })),
    });
  });

  app.post("/support/:reference/reply", async (c) => {
    const body = await readBody(
      c,
      z
        .object({
          reply: z.string().min(1).max(6000),
          status: z.enum(["open", "in_progress", "resolved"]).default("resolved"),
        })
        .strict()
    );
    const message = await services.store.getSupportMessage(c.req.param("reference"));
    if (!message) throw new HttpError(404, "support_not_found", "No message with this reference.");
    await services.store.replyToSupportMessage(message.id, body.reply, body.status);
    return c.json({ ok: true, reference: message.id, status: body.status });
  });

  return app;
}

async function count(db: Database, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<Row>();
  return row ? num(row, "count") : 0;
}

function runTotals(raw: unknown): { total: number; failed: number } {
  const totals = parseJson<Record<string, RunTotalsShape>>(raw, {});
  return Object.values(totals).reduce<{ total: number; failed: number }>(
    (sum, item) => ({
      total: sum.total + Number(item.total ?? 0),
      failed: sum.failed + Number(item.failed ?? 0) + Number(item.errors ?? 0),
    }),
    { total: 0, failed: 0 }
  );
}
