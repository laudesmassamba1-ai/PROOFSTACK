import { assertScannableUrl, scanPage } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, RateLimiter } from "../http/errors.js";
import { readBody, requireWorkspace } from "../http/guards.js";
import { pageBody, readPage } from "../http/pagination.js";
import type { AppEnv, Services } from "../http/services.js";

/**
 * Scanning a URL from the app.
 *
 * This exists because the CLI is not always where the person is: a link a customer sends
 * you, a competitor's page, a staging URL. Paste it, get the four families that can be
 * judged from a page — FAIL, CLEAN, WORLD, EXIT — and ask the AI to interpret them.
 *
 * Three constraints are not negotiable here:
 *
 *   1. **No SSRF.** The Worker runs inside Cloudflare's network; a request to
 *      `169.254.169.254` or an internal host is an escape attempt. `assertScannableUrl`
 *      refuses those, and the scan re-validates every redirect hop.
 *   2. **Liveness reads are not free.** Scans are metered per workspace and rate-limited
 *      per caller, because one workspace cannot turn the API into a load generator.
 *   3. **Localhost is the CLI's job.** The Worker cannot reach it, and pretending otherwise
 *      would produce a timeout that looks like a broken site. The error says so.
 *
 * FLOW is deliberately absent: it needs the product's own checkout endpoint, and a page
 * scan cannot stand in for it without lying about what was verified.
 */

const scanSchema = z
  .object({
    workspaceId: z.string().min(1),
    url: z.string().min(4).max(2000),
    /** Credentials for a page behind a login. Used for the request only, never stored. */
    headers: z.record(z.string().max(80), z.string().max(2000)).optional(),
  })
  .strict();

const MAX_SCANS_PER_HOUR = 20;

export function auditRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter(MAX_SCANS_PER_HOUR, 60 * 60_000);

  app.post("/audits", async (c) => {
    const user = c.get("user");
    const limited = limiter.check(user.id);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      const minutes = Math.max(1, Math.ceil(limited.retryAfterSeconds / 60));
      throw new HttpError(
        429,
        "scan_rate_limited",
        `Trop de scans sur cette heure. Réessaie dans ${minutes} min.`,
        { retryAfterSeconds: limited.retryAfterSeconds }
      );
    }

    const body = await readBody(c, scanSchema);
    const { workspace, role } = await requireWorkspace(c, services, body.workspaceId);
    if (role === "viewer") {
      throw new HttpError(
        403,
        "insufficient_role",
        "Viewers cannot start a scan. Ask for member rights."
      );
    }

    // Validate before the request, and name the fix in the message: the most common
    // failure here is someone pasting their dev server.
    let target: URL;
    try {
      target = assertScannableUrl(body.url.trim());
    } catch (error) {
      throw new HttpError(
        400,
        "url_not_scannable",
        error instanceof Error ? error.message : "This URL cannot be scanned."
      );
    }

    let result: Awaited<ReturnType<typeof scanPage>>;
    try {
      result = await scanPage(target.toString(), {
        headers: body.headers,
        allowPrivate: false,
        maxBytes: 1_500_000,
        timeoutMs: 10_000,
        light: true,
      });
    } catch (error) {
      // A scan that could not happen is a harness problem, not a finding about the site:
      // it must not appear as a red result the customer would act on.
      throw new HttpError(
        502,
        "scan_failed",
        `Could not reach ${target.hostname}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }

    const failed = result.findings.filter((item) => item.status === "FAIL").length;
    const warnings = result.findings.filter((item) => item.status === "WARN").length;
    const worstVerdict = failed > 0 ? "fail" : warnings > 0 ? "warnings" : "pass";
    const id = `aud_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await services.store.createPageAudit({
      id,
      workspaceId: workspace.id,
      createdBy: user.id,
      url: result.url,
      finalUrl: result.finalUrl,
      status: result.status,
      durationMs: result.durationMs,
      worstVerdict,
      failed,
      warnings,
      payload: JSON.stringify(result),
    });

    return c.json({ audit: { id, ...result } }, 201);
  });

  app.get("/audits", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const page = readPage(c);
    const { rows, total } = await services.store.listPageAudits(workspace.id, page);
    return c.json(
      pageBody(
        rows.map((row) => ({
          id: String(row.id),
          url: String(row.url),
          finalUrl: String(row.final_url),
          status: Number(row.status),
          durationMs: Number(row.duration_ms),
          worstVerdict: String(row.worst_verdict),
          failed: Number(row.failed),
          warnings: Number(row.warnings),
          createdAt: String(row.created_at),
        })),
        total,
        page
      )
    );
  });

  app.get("/audits/:auditId", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const row = await services.store.getPageAudit(workspace.id, c.req.param("auditId"));
    if (!row) throw new HttpError(404, "audit_not_found", "No scan with this id.");
    return c.json({
      id: String(row.id),
      createdAt: String(row.created_at),
      result: JSON.parse(String(row.payload)),
    });
  });

  return app;
}
