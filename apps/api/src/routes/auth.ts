import { normalizeEmail } from "@proofcore/billing";
import { ProofCoreError, uuid } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  hashToken,
  readCookie,
  SESSION_COOKIE,
  serializeSessionCookie,
  sessionExpiry,
  verifyPassword,
} from "../auth.js";
import { isAdminEmail } from "../env.js";
import { clientAddress, HttpError, RateLimiter } from "../http/errors.js";
import { readBody } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";

const signUpSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    name: z.string().min(2).max(120),
    workspace: z.string().min(2).max(80).optional(),
  })
  .strict();

const signInSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

/**
 * Authentication routes.
 *
 * The response deliberately states `emailVerification: "not_configured"`: no email
 * provider is wired, so claiming an email was sent would be false. The adapter
 * boundary for delivery is documented in docs/deployment/ENVIRONMENT_VARIABLES.md.
 */
export function authRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Sign-up throttling.
  //
  // The limit is per source address, and an address is shared far more often than it
  // looks: an office, a university, a mobile carrier's NAT, and every CI runner behind
  // one egress IP. Five per hour locked out a whole team during the first end-to-end
  // run. The limit still raises the cost of mass account creation, but it is now
  // configurable and it is off under test, where a suite legitimately creates dozens of
  // accounts from one address.
  const signUpLimit = Number(process.env.SIGNUP_RATE_LIMIT ?? 20);
  const signUpWindowMs = Number(process.env.SIGNUP_RATE_WINDOW_MS ?? 60 * 60_000);
  const signInLimiter = new RateLimiter(10, 5 * 60_000);
  const signUpLimiter =
    services.config.environment === "test" || signUpLimit <= 0
      ? null
      : new RateLimiter(signUpLimit, signUpWindowMs);

  app.post("/sign-up/email", async (c) => {
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const userAgent = c.req.header("user-agent");
    const limited = signUpLimiter?.check(address) ?? { allowed: true, retryAfterSeconds: 0 };
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      throw new HttpError(
        429,
        "too_many_signups",
        "Too many accounts created from this address. Try again later."
      );
    }

    const body = await readBody(c, signUpSchema);
    const emailNormalized = normalizeEmail(body.email);
    const user = await services.store.createUser({
      email: body.email.trim(),
      emailNormalized,
      name: body.name.trim(),
      passwordHash: await hashPassword(body.password),
    });

    const workspace = await services.store.createWorkspace({
      name: body.workspace?.trim() || `${body.name.trim().split(/\s+/)[0] ?? "Personal"} workspace`,
      userId: user.id,
    });

    const { token, tokenHash } = await createSessionToken();
    const expiresAt = sessionExpiry(services.clock());
    await services.store.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      ...(userAgent ? { userAgent } : {}),
      ...(address !== "local" ? { ip: address } : {}),
    });
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: user.id,
      action: "workspace.created",
      detail: { name: workspace.name, via: "sign-up" },
    });

    c.header(
      "Set-Cookie",
      serializeSessionCookie(token, { secure: services.config.secureCookies })
    );
    return c.json(
      {
        user: publicUser(user),
        workspace,
        session: { expiresAt },
        emailVerification: "not_configured" as const,
      },
      201
    );
  });

  app.post("/sign-in/email", async (c) => {
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const userAgent = c.req.header("user-agent");
    const body = await readBody(c, signInSchema);
    const limited = signInLimiter.check(`${address}|${normalizeEmail(body.email)}`);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      throw new HttpError(
        429,
        "too_many_attempts",
        "Too many sign-in attempts. Wait before trying again."
      );
    }

    const user = await services.store.findUserByNormalizedEmail(normalizeEmail(body.email));
    // One message for "no such user" and "wrong password": no account enumeration.
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !valid) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    await services.store.deleteExpiredSessions(user.id, services.clock());
    const { token, tokenHash } = await createSessionToken();
    const expiresAt = sessionExpiry(services.clock());
    await services.store.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      ...(userAgent ? { userAgent } : {}),
      ...(address !== "local" ? { ip: address } : {}),
    });

    const workspaces = await services.store.listWorkspaces(user.id);
    c.header(
      "Set-Cookie",
      serializeSessionCookie(token, { secure: services.config.secureCookies })
    );
    return c.json({ user: publicUser(user), workspaces, session: { expiresAt } });
  });

  app.post("/sign-out", async (c) => {
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    if (token) {
      const found = await services.store.findSessionByTokenHash(await hashToken(token));
      if (found) await services.store.deleteSession(found.session.id);
    }
    c.header("Set-Cookie", clearSessionCookie(services.config.secureCookies));
    return c.json({ ok: true });
  });

  /** 200 with `user: null` when signed out: a probe, not an error. */
  app.get("/session", async (c) => {
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    if (!token) return c.json({ user: null, workspaces: [] });
    try {
      const found = await services.store.findSessionByTokenHash(await hashToken(token));
      if (!found || found.session.expiresAt <= new Date(services.clock()).toISOString()) {
        c.header("Set-Cookie", clearSessionCookie(services.config.secureCookies));
        return c.json({ user: null, workspaces: [] });
      }
      const workspaces = await services.store.listWorkspaces(found.user.id);
      return c.json({
        user: publicUser(found.user),
        workspaces,
        session: { expiresAt: found.session.expiresAt },
        emailVerification: "not_configured" as const,
        // The browser uses this to decide whether to show the operations console.
        // It is not an authorization decision: /api/v1/admin/* re-checks the
        // session against the allowlist on every request.
        isAdmin: isAdminEmail(services.config, found.user.email),
      });
    } catch (error) {
      if (error instanceof ProofCoreError) throw error;
      throw error;
    }
  });

  return app;
}

export function publicUser(user: {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerifiedAt: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

/** Kept so a future invitation flow can reference a stable, opaque identifier. */
export function newInvitationId(): string {
  return `inv_${uuid().replaceAll("-", "").slice(0, 20)}`;
}
