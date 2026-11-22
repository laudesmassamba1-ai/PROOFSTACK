import {
  assertScannableUrl,
  auditSite,
  hmacSha256Hex,
  scanPage,
  VERIFICATION_META_NAME,
  VERIFICATION_WELL_KNOWN,
} from "@proofcore/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
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
    /** The page holding the form, or the JSON endpoint when the site is an API. */
    url: absoluteHttpUrl,
    email: z.string().email().max(320),
    password: z.string().min(1).max(200),
    /** The form's action, when it cannot be read from the page (a SPA, a separate host). */
    endpoint: absoluteHttpUrl.optional(),
    /** A page that requires the session: the proof the login worked. */
    verifyUrl: absoluteHttpUrl.optional(),
    emailField: z.string().min(1).max(60).optional(),
    passwordField: z.string().min(1).max(60).optional(),
    /** Extra fields a multi-tenant login wants (tenant, domain). Never logged. */
    extraFields: z.record(z.string().max(60), z.string().max(200)).optional(),
  })
  .strict();

const crawlSchema = z
  .object({
    maxPages: z.number().int().min(1).max(200).optional(),
    maxDepth: z.number().int().min(0).max(6).optional(),
    pathPrefix: z.string().max(200).optional(),
    allowExternal: z.boolean().optional(),
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
    /**
     * Read the site and not just the address. Absent means one page: a crawl is opt-in
     * because it costs the target several dozen requests.
     */
    crawl: crawlSchema.optional(),
  })
  .strict();

/**
 * One engine for both routes.
 *
 * A crawl or a login goes through `auditSite`: real session, real pages, site-level controls,
 * computed scores. A plain scan stays one request, because that is all it costs. Extracted so
 * the streaming route cannot drift from the plain one — the two used to duplicate this block.
 */
async function runScan(
  body: {
    url: string;
    headers?: Record<string, string>;
    login?: LoginInput;
    crawl?: CrawlInput;
    ownershipToken?: string;
  },
  target: URL,
  onProgress?: (event: { step: string; message: string; done?: number; total?: number }) => void
): Promise<{
  result: Awaited<ReturnType<typeof scanPage>>;
  site: Awaited<ReturnType<typeof auditSite>> | null;
}> {
  if (body.crawl === undefined && body.login === undefined) {
    const result = await scanPage(target.toString(), {
      headers: body.headers,
      allowPrivate: false,
      maxBytes: 1_500_000,
      timeoutMs: 15_000,
      // A remote site is only ever "verified" by publishing the token: the API has no way to
      // know who is asking, and an unproven report must not name locations.
      ownershipHint: "remote",
      ...(body.ownershipToken ? { ownershipToken: body.ownershipToken } : {}),
    });
    return { result, site: null };
  }
  const site = await auditSite({
    url: target.toString(),
    allowPrivate: false,
    timeoutMs: 15_000,
    ...(body.login
      ? {
          login: {
            loginPageUrl: body.login.url,
            ...(body.login.endpoint === undefined ? {} : { loginUrl: body.login.endpoint }),
            ...(body.login.verifyUrl === undefined ? {} : { verifyUrl: body.login.verifyUrl }),
            email: body.login.email,
            password: body.login.password,
            ...(body.login.emailField === undefined ? {} : { emailField: body.login.emailField }),
            ...(body.login.passwordField === undefined
              ? {}
              : { passwordField: body.login.passwordField }),
            ...(body.login.extraFields === undefined
              ? {}
              : { extraFields: body.login.extraFields }),
          },
        }
      : {}),
    crawl: {
      // Without an explicit crawl request the engine still reads the site's own declarations
      // (robots, sitemap) but does not roam: one page, no depth.
      maxPages: body.crawl?.maxPages ?? (body.crawl ? 25 : 1),
      maxDepth: body.crawl?.maxDepth ?? (body.crawl ? 2 : 0),
      ...(body.crawl?.pathPrefix === undefined ? {} : { pathPrefix: body.crawl.pathPrefix }),
      ...(body.crawl?.allowExternal === undefined
        ? {}
        : { allowExternal: body.crawl.allowExternal }),
    },
    ...(onProgress === undefined ? {} : { onProgress }),
  });
  return { result: site.scan, site };
}

type LoginInput = {
  url: string;
  email: string;
  password: string;
  endpoint?: string;
  verifyUrl?: string;
  emailField?: string;
  passwordField?: string;
  extraFields?: Record<string, string>;
};
type CrawlInput = {
  maxPages?: number;
  maxDepth?: number;
  pathPrefix?: string;
  allowExternal?: boolean;
};

const MAX_SCANS_PER_HOUR = 20;

const correctionSchema = z
  .object({
    state: z.enum(["todo", "in_progress", "fixed", "verify"]),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();

type PageFinding = {
  module: string;
  id: string;
  status: string;
  observed: string;
  why: string;
};

const CORRECTION_STATES = new Set(["todo", "in_progress", "fixed", "verify"]);

function scanFindings(payload: unknown): PageFinding[] {
  const raw = (payload as { findings?: unknown })?.findings;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is PageFinding =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as PageFinding).module === "string" &&
      typeof (item as PageFinding).id === "string"
  );
}

/** The last verification of a tracked finding, as the board needs it. */
function verificationOf(state: Record<string, unknown> | undefined) {
  if (!state?.verified_at) return null;
  return {
    at: String(state.verified_at),
    status: state.verified_status ? String(state.verified_status) : null,
    observed: state.verified_observed ? String(state.verified_observed) : null,
    before: state.verified_before ? String(state.verified_before) : null,
    verdict: state.verified_verdict ? String(state.verified_verdict) : null,
  };
}

function findingKey(item: Pick<PageFinding, "module" | "id">): string {
  return `${item.module}:${item.id}`;
}

/**
 * What changed between two scans of the same project.
 *
 * The comparison is by `module:id`, the identity the scanner itself uses. Nothing is
 * inferred: a finding is "resolved" only when the later scan no longer reports it, and
 * "persisting" only when it still does. A caller cannot turn this into a green verdict.
 */
function compareScans(
  beforeId: string,
  beforePayload: unknown,
  afterId: string,
  afterPayload: unknown
) {
  const before = new Map(scanFindings(beforePayload).map((item) => [findingKey(item), item]));
  const after = new Map(scanFindings(afterPayload).map((item) => [findingKey(item), item]));
  const brief = (item: PageFinding) => ({
    key: findingKey(item),
    module: item.module,
    id: item.id,
    status: item.status,
    observed: item.observed,
  });
  const resolved = [...before.entries()]
    .filter(([key]) => !after.has(key))
    .map(([, item]) => brief(item));
  const persisting = [...after.entries()]
    .filter(([key]) => before.has(key))
    .map(([, item]) => brief(item));
  const appeared = [...after.entries()]
    .filter(([key]) => !before.has(key))
    .map(([, item]) => brief(item));
  return {
    before: beforeId,
    after: afterId,
    resolved,
    persisting,
    appeared,
    counts: {
      resolved: resolved.length,
      persisting: persisting.length,
      appeared: appeared.length,
    },
  };
}

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
    // Read before the new row exists: this scan is the baseline of the re-control.
    const previous = body.projectId
      ? (await services.store.latestPageAudits(workspace.id, body.projectId, 1))[0]
      : undefined;

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
    let site: Awaited<ReturnType<typeof auditSite>> | null = null;
    try {
      const run = await runScan(body, target);
      result = run.result;
      site = run.site;
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
      // The payload is the report: one page's findings, the site section when a crawl ran,
      // the computed scores, and the login outcome (never a credential).
      payload: JSON.stringify({
        ...result,
        ...(site === null
          ? {}
          : { site: site.site, scores: site.scores, score: site.score, login: site.login }),
      }),
      ownership: result.ownership,
      redacted: result.redacted,
      projectId: body.projectId ?? null,
    });

    // The comparison is computed from two stored scans, not from a promise: a finding is
    // "fixed" only once a later scan no longer reports it.
    let comparison: ReturnType<typeof compareScans> | null = null;
    if (body.projectId && previous) {
      comparison = compareScans(
        String(previous.id),
        JSON.parse(String(previous.payload)),
        id,
        result
      );
      // A tracked finding that disappears becomes "to verify": the person who fixed it
      // confirms the result, the tool does not declare victory on its own.
      const tracked = new Map(
        (await services.store.listAuditFindingStates(workspace.id, body.projectId)).map((row) => [
          String(row.finding_key),
          {
            state: String(row.state),
            note: row.note ? String(row.note) : null,
          },
        ])
      );
      for (const item of comparison.resolved) {
        const current = tracked.get(item.key);
        if (current?.state === "todo" || current?.state === "in_progress") {
          await services.store.setAuditFindingState({
            workspaceId: workspace.id,
            projectId: body.projectId,
            findingKey: item.key,
            state: "verify",
            // The automatic transition is about the code disappearing; it must not
            // erase the human note attached to the finding.
            note: current.note,
          });
        }
      }
    }

    return c.json(
      {
        audit: {
          id,
          projectId: body.projectId ?? null,
          ...result,
          ...(site === null
            ? {}
            : { site: site.site, scores: site.scores, score: site.score, login: site.login }),
        },
        comparison,
      },
      201
    );
  });

  /**
   * The token an owner publishes to prove a site is theirs.
   *
   * Search consoles settled this pattern: a meta tag or a well-known file, checked by the
   * scanner. It is the only proof that does not depend on believing the caller, which is why
   * it is what unlocks the exact locations of a finding.
   */
  /**
   * The same scan, with the phases the server actually performs.
   *
   * The regular POST is one request and one response; this route exists because "reading
   * the page" and "comparing with the previous scan" are real, separable steps. Each
   * event is emitted after the work it describes has started or finished — there is no
   * timer pretending a phase is running. The final event carries the scan and comparison.
   */
  app.post("/audits/stream", async (c) => {
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
    if (body.projectId && !(await services.store.getProject(workspace.id, body.projectId))) {
      throw new HttpError(404, "project_not_found", "No project with this id in this workspace.");
    }
    const previous = body.projectId
      ? (await services.store.latestPageAudits(workspace.id, body.projectId, 1))[0]
      : undefined;

    const auditId = `aud_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const gate = await services.meter.authorize({
      workspaceId: workspace.id,
      check: { key: "monthly_ai_audits", requested: 1 },
      subjectId: auditId,
      quantity: 0,
    });
    if (!gate.allowed) throw quotaErrorFromDecision(gate.decision, "AI-audit");

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

    return streamSSE(c, async (stream) => {
      const emit = async (payload: unknown) => {
        await stream.writeSSE({ data: JSON.stringify(payload) });
      };
      const step = async (
        id: string,
        label: string,
        status: "running" | "done" | "failed",
        detail?: string
      ) => emit({ type: "step", id, label, status, ...(detail ? { detail } : {}) });

      try {
        await step("request", "Demande validée et quota réservé", "done");
        const fetchLabel = `Lecture de ${target.hostname} et analyse des cinq familles`;
        await step("fetch", fetchLabel, "running");
        // Each phase below is emitted when the engine actually reaches it: a crawl that takes
        // four seconds shows four seconds of real work, not a timer filling the gap.
        const run = await runScan(body, target, (event) => {
          void step("fetch", `  ${event.message}`, "running").catch(() => undefined);
        });
        const result = run.result;
        await step(
          "fetch",
          fetchLabel,
          "done",
          "HTTP " +
            result.status +
            " · " +
            Math.round(result.bytes / 1024) +
            " kB · " +
            result.durationMs +
            " ms" +
            (run.site === null
              ? ""
              : ` · ${run.site.site.pages.filter((page) => page.measured).length} page(s) mesurée(s)`)
        );

        await step("verdict", "Calcul du verdict et des scores", "running");
        const failed = result.findings.filter((item) => item.status === "FAIL").length;
        const warnings = result.findings.filter((item) => item.status === "WARN").length;
        const worstVerdict = failed > 0 ? "fail" : warnings > 0 ? "warnings" : "pass";
        await step(
          "verdict",
          "Calcul du verdict et des scores",
          "done",
          `${failed} échec(s) · ${warnings} avertissement(s)`
        );

        await step("save", "Enregistrement du scan et comparaison", "running");
        const metered = await services.meter.meter({
          workspaceId: workspace.id,
          kind: "ai_audit",
          subjectId: auditId,
          quantity: 1,
          at: services.clock(),
        });
        if (metered.reason === "quota_exhausted") {
          throw quotaErrorFromMeter(metered, "AI-audit");
        }
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
          payload: JSON.stringify({
            ...result,
            ...(run.site === null
              ? {}
              : {
                  site: run.site.site,
                  scores: run.site.scores,
                  score: run.site.score,
                  login: run.site.login,
                }),
          }),
          ownership: result.ownership,
          redacted: result.redacted,
          projectId: body.projectId ?? null,
        });

        let comparison: ReturnType<typeof compareScans> | null = null;
        if (body.projectId && previous) {
          comparison = compareScans(
            String(previous.id),
            JSON.parse(String(previous.payload)),
            id,
            result
          );
          const tracked = new Map(
            (await services.store.listAuditFindingStates(workspace.id, body.projectId)).map(
              (row) => [
                String(row.finding_key),
                {
                  state: String(row.state),
                  note: row.note ? String(row.note) : null,
                },
              ]
            )
          );
          for (const item of comparison.resolved) {
            const current = tracked.get(item.key);
            if (current?.state === "todo" || current?.state === "in_progress") {
              await services.store.setAuditFindingState({
                workspaceId: workspace.id,
                projectId: body.projectId,
                findingKey: item.key,
                state: "verify",
                note: current.note,
              });
            }
          }
        }
        await step(
          "save",
          "Enregistrement du scan et comparaison",
          "done",
          comparison
            ? `${comparison.counts.resolved} corrigé(s) · ${comparison.counts.persisting} toujours présent(s) · ${comparison.counts.appeared} nouveau(x)`
            : "Premier scan de ce projet : aucune baseline à comparer"
        );
        await emit({
          type: "result",
          audit: { id, projectId: body.projectId ?? null, ...result },
          comparison,
        });
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 502;
        const code = error instanceof HttpError ? error.code : "scan_failed";
        await emit({
          type: "error",
          status,
          code,
          message: error instanceof Error ? error.message : "The scan could not run.",
        });
      }
    });
  });

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

  /**
   * The correction board of a project: the findings of its latest scan, each with the
   * workflow state a person gave it, plus findings that disappeared since the scan before.
   */
  app.get("/projects/:projectId/corrections", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");

    const audits = await services.store.latestPageAudits(workspace.id, project.id, 2);
    const stateRows = await services.store.listAuditFindingStates(workspace.id, project.id);
    const states = new Map(stateRows.map((row) => [String(row.finding_key), row]));
    const latest = audits[0];
    if (!latest) {
      return c.json({ auditId: null, items: [], comparison: null });
    }

    const latestPayload = JSON.parse(String(latest.payload));
    const latestFindings = scanFindings(latestPayload);
    const latestKeys = new Set(latestFindings.map(findingKey));
    const items = latestFindings.map((item) => {
      const key = findingKey(item);
      const state = states.get(key);
      return {
        ...item,
        key,
        present: true,
        state: state ? String(state.state) : "todo",
        note: state?.note ? String(state.note) : null,
        updatedAt: state?.updated_at ? String(state.updated_at) : null,
        verification: verificationOf(state),
      };
    });

    // A finding that vanished is still part of the correction board when someone tracked
    // it. Showing it is what lets them confirm "fixed" instead of guessing.
    const previous = audits[1];
    if (previous) {
      for (const item of scanFindings(JSON.parse(String(previous.payload)))) {
        const key = findingKey(item);
        if (latestKeys.has(key)) continue;
        const state = states.get(key);
        if (!state) continue;
        items.push({
          ...item,
          key,
          present: false,
          state: String(state.state),
          note: state.note ? String(state.note) : null,
          updatedAt: state.updated_at ? String(state.updated_at) : null,
          verification: verificationOf(state),
        });
      }
    }

    return c.json({
      auditId: String(latest.id),
      scannedAt: String(latest.created_at),
      items,
      comparison: previous
        ? compareScans(
            String(previous.id),
            JSON.parse(String(previous.payload)),
            String(latest.id),
            latestPayload
          )
        : null,
    });
  });

  /**
   * Re-checks one finding against the live site, now.
   *
   * A correction is only corrected once the site says so, and waiting for the next full
   * scan means re-measuring 45 controls to learn one answer. This endpoint reads the page
   * again, picks the same `module:id` out of the fresh report, and records what it saw
   * next to what it saw before. It does not create an audit row (it is not a new
   * baseline) and does not consume the monthly audit quota.
   *
   * The verdict is a fact about one request: `fixed` means the control now passes, not
   * that the product is secure.
   */
  app.post("/projects/:projectId/corrections/:key/verify", async (c) => {
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    if (role === "viewer") {
      throw new HttpError(
        403,
        "insufficient_role",
        "Viewers cannot verify a correction. Ask for member rights."
      );
    }
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");

    const limited = limiter.check(`verify:${workspace.id}`);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      const minutes = Math.max(1, Math.ceil(limited.retryAfterSeconds / 60));
      throw new HttpError(
        429,
        "scan_rate_limited",
        `Trop de vérifications sur cette heure. Réessaie dans ${minutes} min.`,
        { retryAfterSeconds: limited.retryAfterSeconds }
      );
    }

    const key = c.req.param("key");
    const audits = await services.store.latestPageAudits(workspace.id, project.id, 1);
    const latest = audits[0];
    if (!latest) {
      throw new HttpError(
        404,
        "no_scan",
        "This project has no scan yet. Scan it once before verifying a correction."
      );
    }
    const payload = JSON.parse(String(latest.payload)) as { url?: string; finalUrl?: string };
    const before = scanFindings(payload).find((item) => findingKey(item) === key);
    if (!before) {
      throw new HttpError(
        404,
        "finding_not_current",
        `${key} is not a finding of the project's latest scan. Re-scan the project first.`
      );
    }

    // Verifying a control that already passes answers nothing, and verifying a skipped one
    // would produce a misleading "still present". Refuse with the action that makes sense.
    if (before.status !== "FAIL" && before.status !== "WARN") {
      throw new HttpError(
        409,
        "nothing_to_verify",
        `${key} is ${before.status} on the latest scan: there is no defect to re-check. Fix the site and run a new scan.`
      );
    }

    const recorded = payload.finalUrl ?? payload.url;
    if (typeof recorded !== "string" || recorded.length === 0) {
      // A stored scan without its URL cannot be re-read. Say so with the action that fixes
      // it rather than failing with a bare parse error.
      throw new HttpError(
        409,
        "scan_url_missing",
        "This scan did not record the URL it read. Run a new scan on the project, then verify again."
      );
    }
    let target: URL;
    try {
      target = new URL(recorded);
    } catch {
      throw new HttpError(
        409,
        "scan_url_invalid",
        `This scan recorded an unusable URL (${recorded.slice(0, 120)}). Run a new scan on the project.`
      );
    }
    let after: PageFinding | undefined;
    let failure: string | null = null;
    try {
      const fresh = await services.scan(target.toString(), {
        allowPrivate: false,
        maxBytes: 1_500_000,
        timeoutMs: 15_000,
        ownershipHint: "remote",
        light: true,
      });
      after = scanFindings(fresh).find((item) => findingKey(item) === key);
    } catch (error) {
      // The site could not be read: that is inconclusive, not "still present".
      failure = error instanceof Error ? error.message : "unknown error";
    }

    // `before` is a defect by construction (checked above), so only three comparisons
    // remain: it passes now, it is as bad as before, or it got worse.
    const verdict: "fixed" | "still_present" | "worse" | "not_checked" | "inconclusive" =
      failure !== null
        ? "inconclusive"
        : after === undefined
          ? "not_checked"
          : after.status === "PASS"
            ? "fixed"
            : after.status === "FAIL" && before.status === "WARN"
              ? "worse"
              : "still_present";

    await services.store.recordFindingVerification({
      workspaceId: workspace.id,
      projectId: project.id,
      findingKey: key,
      status: after?.status ?? "NOT_CHECKED",
      observed: after?.observed ?? failure ?? "the control was not part of this reading",
      before: before.observed,
      verdict,
      // Only a proven fix moves the workflow; anything else leaves the user's state alone.
      ...(verdict === "fixed" ? { state: "fixed" as const } : {}),
    });

    return c.json({
      ok: verdict === "fixed",
      key,
      verdict,
      before: { status: before.status, observed: before.observed },
      after: after ? { status: after.status, observed: after.observed } : null,
      url: target.toString(),
      checkedAt: services.clock().toISOString(),
      ...(failure === null ? {} : { error: failure }),
    });
  });

  /** Set the workflow state of one finding on the project's latest scan. */
  app.patch("/projects/:projectId/corrections/:key", async (c) => {
    const { workspace, role } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    if (role === "viewer") {
      throw new HttpError(
        403,
        "insufficient_role",
        "Viewers cannot change correction states. Ask for member rights."
      );
    }
    const project = await services.store.getProject(workspace.id, c.req.param("projectId"));
    if (!project) throw new HttpError(404, "project_not_found", "Project not found.");
    const body = await readBody(c, correctionSchema);
    const key = c.req.param("key");
    if (!CORRECTION_STATES.has(body.state)) {
      throw new HttpError(400, "invalid_state", "Unknown correction state.");
    }

    const audits = await services.store.latestPageAudits(workspace.id, project.id, 2);
    const known = new Set(
      audits.flatMap((row) =>
        scanFindings(JSON.parse(String(row.payload))).map((item) => findingKey(item))
      )
    );
    if (!known.has(key)) {
      throw new HttpError(
        404,
        "finding_not_current",
        "This finding is not part of the project's last two scans. Re-scan the project first."
      );
    }

    const existing = (await services.store.listAuditFindingStates(workspace.id, project.id)).find(
      (row) => String(row.finding_key) === key
    );
    const note =
      body.note === undefined ? (existing?.note ? String(existing.note) : null) : body.note;
    await services.store.setAuditFindingState({
      workspaceId: workspace.id,
      projectId: project.id,
      findingKey: key,
      state: body.state,
      note,
    });
    return c.json({ ok: true, key, state: body.state, note });
  });

  return app;
}
