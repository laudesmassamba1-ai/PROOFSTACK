import { normalizeEmail } from "@proofcore/billing";
import { ProofCoreError, uuid } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import {
  CSRF_COOKIE,
  clearCsrfCookie,
  clearSessionCookie,
  createCsrfToken,
  createSessionToken,
  hashPassword,
  hashToken,
  readCookie,
  SESSION_COOKIE,
  serializeCsrfCookie,
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
  const signUpLimit =
    services.config.environment === "test" ? 0 : Number(process.env.SIGNUP_RATE_LIMIT ?? 20);
  const signUpWindowMs = Number(process.env.SIGNUP_RATE_WINDOW_MS ?? 60 * 60_000);
  const signInLimiter = new RateLimiter(10, 5 * 60_000);
  // Durable lockout policy. Read at route-construction time, like the sign-up limit, so
  // a test can lower it without touching the code. Per-address is deliberately looser
  // than per-account: a shared office NAT must not be a denial-of-service lever.
  const maxEmailFailures = Number(process.env.SIGN_IN_MAX_FAILURES ?? 8);
  const maxAddressFailures = Number(process.env.SIGN_IN_MAX_ADDRESS_FAILURES ?? 40);
  const lockoutWindowMs = Number(process.env.SIGN_IN_LOCKOUT_MS ?? 15 * 60_000);
  app.post("/sign-up/email", async (c) => {
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const userAgent = c.req.header("user-agent");
    // The counter lives in the database, not in the isolate: the in-memory limiter this
    // replaces forgot its window when the process recycled, so a burst could reset
    // itself by waiting for a cold start. The rule is the same: per source address,
    // configurable, off under test where one suite creates many accounts.
    if (signUpLimit > 0) {
      const now = services.clock();
      const { count, resetAt } = await services.store.hitRateLimit({
        scope: "signup:address",
        key: address,
        windowMs: signUpWindowMs,
        now,
      });
      if (count > signUpLimit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((Date.parse(resetAt) - now.getTime()) / 1000)
        );
        c.header("Retry-After", String(retryAfterSeconds));
        throw new HttpError(
          429,
          "too_many_signups",
          "Too many accounts created from this address. Try again later."
        );
      }
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
    c.header(
      "Set-Cookie",
      serializeCsrfCookie(createCsrfToken(), { secure: services.config.secureCookies }),
      { append: true }
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
    const email = normalizeEmail(body.email);
    const limited = signInLimiter.check(`${address}|${email}`);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      throw new HttpError(
        429,
        "too_many_attempts",
        "Too many sign-in attempts. Wait before trying again."
      );
    }

    // The in-process limiter above forgets everything when the isolate recycles. These
    // two scopes remember, so a password-guessing run cannot reset its own budget by
    // waiting for a cold start or by spreading across colos.
    const windowStart = new Date(services.clock().getTime() - lockoutWindowMs);
    const [emailFailures, addressFailures] = await Promise.all([
      services.store.countAuthAttempts(`signin:email:${email}`, windowStart),
      services.store.countAuthAttempts(`signin:ip:${address}`, windowStart),
    ]);
    if (
      maxEmailFailures > 0 &&
      (emailFailures >= maxEmailFailures || addressFailures >= maxAddressFailures)
    ) {
      const minutes = Math.ceil(lockoutWindowMs / 60_000);
      c.header("Retry-After", String(minutes * 60));
      throw new HttpError(
        429,
        "account_locked",
        `Too many failed attempts. This account is paused for ${minutes} minutes.`,
        { retryAfterSeconds: minutes * 60 }
      );
    }

    const user = await services.store.findUserByNormalizedEmail(email);
    // One message for "no such user" and "wrong password": no account enumeration.
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !valid) {
      // Both scopes are recorded: an attacker rotating addresses still meets the email
      // budget, and one guessing across many accounts still meets the address budget.
      await Promise.all([
        services.store.recordAuthAttempt(`signin:email:${email}`),
        services.store.recordAuthAttempt(`signin:ip:${address}`),
      ]);
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    await services.store.clearAuthAttempts(`signin:email:${email}`);

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
    c.header(
      "Set-Cookie",
      serializeCsrfCookie(createCsrfToken(), { secure: services.config.secureCookies }),
      { append: true }
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
    c.header("Set-Cookie", clearCsrfCookie(services.config.secureCookies), { append: true });
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
      // A session created before the CSRF cookie shipped gets one on its next probe:
      // the account writes stay protected without forcing a re-login.
      if (!readCookie(c.req.header("cookie"), CSRF_COOKIE)) {
        c.header(
          "Set-Cookie",
          serializeCsrfCookie(createCsrfToken(), { secure: services.config.secureCookies }),
          { append: true }
        );
      }
      const workspaces = await services.store.listWorkspaces(found.user.id);
      return c.json({
        user: publicUser(found.user),
        workspaces,
        // Same field sign-up and sign-in return. The server's notion of "active" is the
        // first membership; a client may store its own choice, but the key is always
        // present so a client never has to infer it.
        workspaceId: workspaces[0]?.id ?? null,
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
