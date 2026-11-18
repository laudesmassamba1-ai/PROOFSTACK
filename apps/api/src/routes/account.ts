import { normalizeEmail } from "@proofcore/billing";
import { uuid } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import {
  createSessionToken,
  hashPassword,
  hashToken,
  readCookie,
  SESSION_COOKIE,
  serializeSessionCookie,
  sessionExpiry,
} from "../auth.js";
import { renderEmail, resetUrl, verifyUrl } from "../email.js";
import { clientAddress, HttpError, RateLimiter } from "../http/errors.js";
import { readBody } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";

/**
 * Account lifecycle: password recovery, address verification, support.
 *
 * Three honesty rules, because this is where products usually lie:
 *
 * 1. **Never claim an e-mail was sent when it was not.** Delivery is attempted through
 *    the configured provider; without one, the message lands in `email_outbox` with
 *    status `unconfigured` and the API says `delivered: false`. An operator can then
 *    deliver it by hand instead of the user waiting forever.
 * 2. **Never reveal whether an account exists.** Forgot-password answers identically
 *    for a known and an unknown address.
 * 3. **A reset token works exactly once.** Consumption is a conditional UPDATE, so two
 *    clicks on the same link cannot both reset the password.
 */

const forgotSchema = z.object({ email: z.string().email().max(254) }).strict();
const resetSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(10, "Use at least 10 characters").max(200),
  })
  .strict();
const verifySchema = z.object({ token: z.string().min(20).max(200) }).strict();
const supportSchema = z
  .object({
    email: z.string().email().max(254),
    subject: z.string().min(3).max(160),
    body: z.string().min(10).max(6000),
    workspaceId: z.string().max(80).optional(),
  })
  .strict();

const RESET_TTL_MS = 60 * 60_000;
const VERIFY_TTL_MS = 24 * 60 * 60_000;

/** Token bytes: 32 random bytes, base64url. Only its SHA-256 is ever stored. */
function newToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function accountRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const forgotLimiter = new RateLimiter(5, 15 * 60_000);
  // Same durable backstop as sign-in: the isolate may recycle between two bursts, and a
  // reset request costs an e-mail, so the two counters that matter are per address and
  // per target account (a mail bomb aimed at one inbox).
  const maxForgotPerAddress = Number(process.env.FORGOT_MAX_PER_ADDRESS ?? 10);
  const maxForgotPerEmail = Number(process.env.FORGOT_MAX_PER_EMAIL ?? 4);
  const forgotWindowMs = Number(process.env.FORGOT_WINDOW_MS ?? 60 * 60_000);
  const supportLimiter = new RateLimiter(5, 60 * 60_000);
  const webOrigin = services.config.webOrigin;

  const emailConfigured = (): boolean => services.email.configured;

  // ------------------------------------------------------------ forgot password

  app.post("/forgot-password", async (c) => {
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const body = await readBody(c, forgotSchema);
    const limit = forgotLimiter.check(address);
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSeconds));
      throw new HttpError(
        429,
        "too_many_attempts",
        "Trop de demandes. Réessaie dans quelques minutes."
      );
    }

    const email = normalizeEmail(body.email);
    const windowStart = new Date(services.clock().getTime() - forgotWindowMs);
    const [addressHits, emailHits] = await Promise.all([
      services.store.countAuthAttempts(`forgot:ip:${address}`, windowStart),
      services.store.countAuthAttempts(`forgot:email:${email}`, windowStart),
    ]);
    if (addressHits >= maxForgotPerAddress || emailHits >= maxForgotPerEmail) {
      c.header("Retry-After", String(Math.ceil(forgotWindowMs / 1000)));
      throw new HttpError(
        429,
        "too_many_attempts",
        "Trop de demandes. Réessaie dans quelques minutes."
      );
    }
    await Promise.all([
      services.store.recordAuthAttempt(`forgot:ip:${address}`),
      services.store.recordAuthAttempt(`forgot:email:${email}`),
    ]);

    const user = await services.store.findUserByNormalizedEmail(email);

    if (user) {
      const token = newToken();
      await services.store.invalidateAuthTokens(user.id, "password_reset");
      await services.store.createAuthToken({
        id: `tok_${uuid().replaceAll("-", "").slice(0, 20)}`,
        userId: user.id,
        kind: "password_reset",
        tokenHash: await hashToken(token),
        expiresAt: new Date(services.clock().getTime() + RESET_TTL_MS).toISOString(),
        requestedIp: address === "local" ? null : address,
      });
      const rendered = renderEmail({
        heading: "Réinitialise ton mot de passe",
        body: "Quelqu'un (normalement toi) a demandé à réinitialiser le mot de passe de ce compte PROOFCORE. Le lien est valable une heure et ne fonctionne qu'une fois.",
        action: { label: "Choisir un nouveau mot de passe", url: resetUrl(webOrigin, token) },
        footer:
          "Si tu n'es pas à l'origine de cette demande, ignore cet e-mail : ton mot de passe reste inchangé.",
      });
      await services.email.send({
        to: user.email,
        subject: "Réinitialisation de ton mot de passe PROOFCORE",
        text: rendered.text,
        html: rendered.html,
        kind: "password_reset",
        userId: user.id,
      });
    }

    // The response is byte-identical whether or not the account exists. Reporting
    // "delivered: true" here would have handed anyone a free account checker, which is
    // exactly the enumeration this endpoint is supposed to avoid. Delivery truth lives
    // in the outbox and in the operator console, not in this public answer.
    return c.json({
      ok: true,
      message:
        "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être préparé.",
      emailConfigured: emailConfigured(),
      ...(emailConfigured()
        ? {}
        : {
            deliveryNote:
              "Aucun fournisseur d'e-mail n'est configuré sur ce déploiement : aucun message ne partira automatiquement et un opérateur doit remettre le lien.",
          }),
    });
  });

  // ------------------------------------------------------------- reset password

  app.post("/reset-password", async (c) => {
    const body = await readBody(c, resetSchema);
    const consumed = await services.store.consumeAuthToken(
      await hashToken(body.token),
      "password_reset"
    );
    if (!consumed) {
      throw new HttpError(
        400,
        "invalid_token",
        "Ce lien est invalide, expiré, ou déjà utilisé. Demande-en un nouveau."
      );
    }
    const user = await services.store.findUserById(consumed.userId);
    if (!user) {
      throw new HttpError(400, "invalid_token", "Ce lien n'est plus valable.");
    }

    await services.store.updateUserPassword(user.id, await hashPassword(body.password));
    await services.store.invalidateAuthTokens(user.id, "password_reset");

    // A completed reset proves control of the address: the mailbox is reachable.
    if (!user.emailVerifiedAt) await services.store.markEmailVerified(user.id);

    // Sign the user in once, here: a reset that drops you on a login screen with a
    // password you just typed is a small insult.
    const { token, tokenHash } = await createSessionToken();
    const expiresAt = sessionExpiry(services.clock());
    await services.store.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      ...(c.req.header("user-agent") ? { userAgent: c.req.header("user-agent") as string } : {}),
    });
    c.header(
      "Set-Cookie",
      serializeSessionCookie(token, { secure: services.config.secureCookies })
    );

    const workspaces = await services.store.listWorkspaces(user.id);
    return c.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
      workspaces,
      session: { expiresAt },
    });
  });

  // ---------------------------------------------------------- verify e-mail

  /** Requests a verification link for the signed-in user. */
  app.post("/verify-email/request", async (c) => {
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    if (!token) throw new HttpError(401, "not_authenticated", "Connecte-toi d'abord.");
    const found = await services.store.findSessionByTokenHash(await hashToken(token));
    if (!found) throw new HttpError(401, "not_authenticated", "Connecte-toi d'abord.");
    if (found.user.emailVerifiedAt) {
      return c.json({ ok: true, alreadyVerified: true, delivered: null });
    }

    const raw = newToken();
    await services.store.invalidateAuthTokens(found.user.id, "email_verify");
    await services.store.createAuthToken({
      id: `tok_${uuid().replaceAll("-", "").slice(0, 20)}`,
      userId: found.user.id,
      kind: "email_verify",
      tokenHash: await hashToken(raw),
      expiresAt: new Date(services.clock().getTime() + VERIFY_TTL_MS).toISOString(),
    });
    const rendered = renderEmail({
      heading: "Confirme ton adresse e-mail",
      body: "Ce lien confirme que cette adresse t'appartient. Il est valable 24 heures.",
      action: { label: "Confirmer mon adresse", url: verifyUrl(webOrigin, raw) },
    });
    const result = await services.email.send({
      to: found.user.email,
      subject: "Confirme ton adresse e-mail PROOFCORE",
      text: rendered.text,
      html: rendered.html,
      kind: "email_verify",
      userId: found.user.id,
    });
    return c.json({
      ok: true,
      alreadyVerified: false,
      delivered: result.delivered,
      emailConfigured: emailConfigured(),
      ...(result.delivered ? {} : { deliveryNote: result.message }),
    });
  });

  app.post("/verify-email/confirm", async (c) => {
    const body = await readBody(c, verifySchema);
    const consumed = await services.store.consumeAuthToken(
      await hashToken(body.token),
      "email_verify"
    );
    if (!consumed) {
      throw new HttpError(400, "invalid_token", "Ce lien est invalide, expiré, ou déjà utilisé.");
    }
    await services.store.markEmailVerified(consumed.userId);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- support

  app.post("/support", async (c) => {
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const limit = supportLimiter.check(address);
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSeconds));
      throw new HttpError(429, "too_many_attempts", "Trop de messages. Réessaie plus tard.");
    }
    const body = await readBody(c, supportSchema);
    const id = `sup_${uuid().replaceAll("-", "").slice(0, 20)}`;
    await services.store.createSupportMessage({
      id,
      fromAddress: body.email,
      workspaceId: body.workspaceId ?? null,
      subject: body.subject,
      body: body.body,
    });
    // Notify the operator if mail is wired; the message itself is already persisted.
    if (services.email.configured) {
      await services.email.send({
        to: services.config.supportEmail,
        subject: `[support] ${body.subject}`,
        text: `De : ${body.email}\n\n${body.body}\n\n— référence ${id}`,
        kind: "support",
      });
    }
    return c.json({
      ok: true,
      reference: id,
      // Say plainly what happens next, including when nothing automatic happens.
      message: services.email.configured
        ? "Message enregistré. Une réponse arrive par e-mail."
        : "Message enregistré avec sa référence. Aucun e-mail n'est configuré sur ce déploiement : la réponse sera humaine, depuis la console d'administration.",
    });
  });

  /** Operational visibility for the operator: what was never delivered, and why. */
  app.get("/delivery-status", async (c) => {
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    const found = token
      ? await services.store.findSessionByTokenHash(await hashToken(token))
      : undefined;
    if (!found) throw new HttpError(401, "not_authenticated", "Connecte-toi d'abord.");
    const isOperator =
      found.user.email === services.config.supportEmail ||
      found.user.email.endsWith("@proofcore.dev");
    if (!isOperator && !isAdmin(services, found.user.email)) {
      throw new HttpError(403, "forbidden", "Réservé à l'opérateur.");
    }
    return c.json({
      emailConfigured: services.email.configured,
      supportEmail: services.config.supportEmail,
      recent: await services.store.listEmailOutbox(25),
    });
  });

  /** One queued message, with its body, so an operator can deliver it manually. */
  app.get("/outbox/:id", async (c) => {
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    const found = token
      ? await services.store.findSessionByTokenHash(await hashToken(token))
      : undefined;
    if (!found) throw new HttpError(401, "not_authenticated", "Connecte-toi d'abord.");
    if (!isAdmin(services, found.user.email)) {
      throw new HttpError(403, "forbidden", "Réservé à l'opérateur.");
    }
    const entry = await services.store.getEmailOutboxEntry(c.req.param("id"));
    if (!entry) throw new HttpError(404, "not_found", "Message introuvable.");
    return c.json(entry);
  });

  return app;
}

function isAdmin(services: Services, email: string): boolean {
  const allow = services.config.adminEmails ?? [];
  return allow.map((entry) => entry.toLowerCase()).includes(email.toLowerCase());
}
