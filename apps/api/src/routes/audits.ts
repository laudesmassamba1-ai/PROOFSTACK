import {
  assertScannableUrl,
  hmacSha256Hex,
  scanPage,
  VERIFICATION_META_NAME,
  VERIFICATION_WELL_KNOWN,
} from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppConfig } from "../env.js";
import { quotaErrorFromDecision, quotaErrorFromMeter } from "../http/entitlement-http.js";
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

/**
 * An absolute http(s) address.
 *
 * A relative login endpoint would be resolved against the API origin — the Worker itself —
 * so a real password would be posted to our own host. The scheme is pinned as well, so
 * `file:` or `javascript:` never reach the fetch.
 */
const absoluteHttpUrl = z
  .string()
  .min(4)
  .max(2000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "L'adresse de connexion doit être une URL http(s) absolue.");

const loginSchema = z
  .object({
    url: absoluteHttpUrl,
    email: z.string().email().max(320),
    password: z.string().min(1).max(200),
    emailField: z.string().min(1).max(60).optional(),
    passwordField: z.string().min(1).max(60).optional(),
  })
  .strict();

const scanSchema = z
  .object({
    workspaceId: z.string().min(1),
    url: z.string().min(4).max(2000),
    /** Credentials for a page behind a login. Used for the request only, never stored. */
    headers: z.record(z.string().max(80), z.string().max(2000)).optional(),
    /** An account created for the audit, so the scan sees the product behind its login. */
    login: loginSchema.optional(),
    /** The token published on the site; its presence upgrades the report to full detail. */
    ownershipToken: z.string().min(1).max(200).optional(),
    /** Set when the scan is started from a project page, so its result stays with it. */
    projectId: z.string().min(1).max(64).optional(),
  })
  .strict();

const MAX_SCANS_PER_HOUR = 20;

/**
 * The token an owner publishes to prove a site is theirs.
 *
 * Derived, not stored: `HMAC(secret, label:workspaceId)` answers the same value on every
 * request and from every instance without a table, and nobody without the deployment
 * secret can compute the token of a workspace whose id they only saw in a URL.
 *
 * The secret is the one already deployed for AI key encryption: verification must not add
 * a *required* environment variable to an installation that already runs without it. When
 * it is absent the endpoint says so instead of answering a token derived from public data
 * — a forgeable token would be worse than no verification at all.
 */
const VERIFICATION_LABEL = "proofcore-site-verification/v1";
const MIN_SECRET_LENGTH = 32;

function verificationSecret(config: AppConfig): string | null {
  for (const candidate of [config.aiKeysSecret, config.n8nWebhookSecret]) {
    if (typeof candidate === "string" && candidate.length >= MIN_SECRET_LENGTH) return candidate;
  }
  return null;
}

async function verificationToken(secret: string, workspaceId: string): Promise<string> {
  // 48 hex characters of the HMAC: 192 bits, as hard to guess as a session token, and short
  // enough to paste into a meta tag.
  const digest = await hmacSha256Hex(secret, `${VERIFICATION_LABEL}:${workspaceId}`);
  return `pcv_${digest.slice(0, 48)}`;
}

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
    // Checked before the scan runs: a scan billed to the workspace and then refused for a
    // project that does not exist here would cost a unit for nothing.
    if (body.projectId && !(await services.store.getProject(workspace.id, body.projectId))) {
      throw new HttpError(404, "project_not_found", "No project with this id in this workspace.");
    }

    // The scan id is minted before the gate so gate and meter name the same subject:
    // the gate is a pure check (nothing recorded), and the meter below only writes
    // once the page has actually been read.
    const auditId = `aud_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const gate = await services.meter.authorize({
      workspaceId: workspace.id,
      check: { key: "monthly_ai_audits", requested: 1 },
      subjectId: auditId,
      quantity: 0,
    });
    if (!gate.allowed) {
      throw quotaErrorFromDecision(gate.decision, "AI-audit");
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
        timeoutMs: 15_000,
        // A remote site is only ever "verified" by publishing the token: the API has no way
        // to know who is asking, and an unproven report must not name locations.
        ownershipHint: "remote",
        ...(body.login ? { login: body.login } : {}),
        ...(body.ownershipToken ? { ownershipToken: body.ownershipToken } : {}),
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

    // The scan happened and produced a report: only now does it consume the
    // workspace's monthly AI-audit quota. A scan that failed above (502) is a
    // harness problem and is never billed — same policy as a failed test run.
    const metered = await services.meter.meter({
      workspaceId: workspace.id,
      kind: "ai_audit",
      subjectId: auditId,
      quantity: 1,
      at: services.clock(),
    });
    if (metered.reason === "quota_exhausted") {
      // Race window between the gate and the meter (a concurrent scan consumed the
      // last unit): deny here rather than record an over-quota report.
      throw quotaErrorFromMeter(metered, "AI-audit");
    }

    const failed = result.findings.filter((item) => item.status === "FAIL").length;
    const warnings = result.findings.filter((item) => item.status === "WARN").length;
    const worstVerdict = failed > 0 ? "fail" : warnings > 0 ? "warnings" : "pass";
    const id = auditId;
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
      ownership: result.ownership,
      redacted: result.redacted,
      projectId: body.projectId ?? null,
    });

    return c.json({ audit: { id, ...result } }, 201);
  });

  /**
   * The token an owner publishes to prove a site is theirs.
   *
   * Search consoles settled this pattern: a meta tag or a well-known file, checked by the
   * scanner. It is the only proof that does not depend on believing the caller, which is why
   * it is what unlocks the exact locations of a finding.
   */
  app.get("/audits/verification-token", async (c) => {
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    if (role === "viewer") {
      throw new HttpError(
        403,
        "insufficient_role",
        "Viewers cannot manage site verification. Ask for member rights."
      );
    }
    const secret = verificationSecret(services.config);
    if (!secret) {
      throw new HttpError(
        503,
        "verification_unavailable",
        "La vérification de propriété n'est pas configurée sur ce serveur. Un opérateur doit définir AI_KEYS_SECRET (32 caractères minimum)."
      );
    }
    const token = await verificationToken(secret, workspace.id);
    return c.json({
      token,
      metaTag: `<meta name="${VERIFICATION_META_NAME}" content="${token}">`,
      wellKnownContent: token,
      wellKnownPath: VERIFICATION_WELL_KNOWN,
      instructions: `Publie l'un des deux sur le site, puis relance le scan : la balise ci-dessus dans le <head>, ou exactement ce jeton comme contenu de ${VERIFICATION_WELL_KNOWN}. Le jeton est propre à cet espace de travail et ne change pas : tant qu'il est publié, les scans de ce site montrent les emplacements exacts. Sans lui, le rapport reste flouté.`,
    });
  });

  app.get("/audits", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const page = readPage(c);
    const projectId = c.req.query("projectId") || null;
    // A project id that is not in this workspace is a 404, not an empty list: an empty list
    // would read as "this project has no scans" when the id may belong to someone else.
    if (projectId && !(await services.store.getProject(workspace.id, projectId))) {
      throw new HttpError(404, "project_not_found", "No project with this id in this workspace.");
    }
    const { rows, total } = await services.store.listPageAudits(workspace.id, {
      ...page,
      projectId,
    });
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
          ownership: String(row.ownership ?? "unverified"),
          redacted: Boolean(Number(row.redacted ?? 1)),
          projectId: row.project_id ? String(row.project_id) : null,
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
      // Restated next to the report so a client does not have to infer from the payload
      // whether the detail it is about to display is complete.
      ownership: String(row.ownership ?? "unverified"),
      redacted: Boolean(Number(row.redacted ?? 1)),
      projectId: row.project_id ? String(row.project_id) : null,
      result: JSON.parse(String(row.payload)),
    });
  });

  return app;
}
