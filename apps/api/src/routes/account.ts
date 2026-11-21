import { normalizeEmail } from "@proofcore/billing";
import { uuid } from "@proofcore/core";
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
import { renderEmail, resetUrl, verifyUrl } from "../email.js";
import { clientAddress, HttpError, RateLimiter } from "../http/errors.js";
import { readBody, requireUser } from "../http/guards.js";
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
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10, "Use at least 10 characters").max(200),
  })
  .strict();
const deleteAccountSchema = z
  .object({
    password: z.string().min(1).max(200),
    /** Typed by hand: a destructive action must not be one stray click away. */
    confirm: z.literal("DELETE"),
  })
  .strict();
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

/**
 * A password prompt is a place to guess a password.
 *
 * `POST /account/password` and `DELETE /account` both verify the current password, so a
 * stolen session cookie was enough to grind a password there with no limit at all: the
 * sign-in lockout never saw it. The budget is per account and per action, so a failed
 * deletion attempt does not lock the password form, and a correct password clears it.
 */
const PASSWORD_GUARD_MAX = 5;
const PASSWORD_GUARD_WINDOW_MS = 15 * 60_000;

function passwordScope(userId: string, action: "password" | "delete"): string {
  return `account:${action}:${userId}`;
}

async function assertPasswordBudget(
  services: Services,
  userId: string,
  action: "password" | "delete"
): Promise<void> {
  const since = new Date(services.clock().getTime() - PASSWORD_GUARD_WINDOW_MS);
  const used = await services.store.countAuthAttempts(passwordScope(userId, action), since);
  if (used >= PASSWORD_GUARD_MAX) {
    const minutes = Math.ceil(PASSWORD_GUARD_WINDOW_MS / 60_000);
    throw new HttpError(
      429,
      "too_many_attempts",
      `Too many wrong passwords. This action is paused for ${minutes} minutes.`,
      { retryAfterSeconds: minutes * 60 }
    );
  }
}

async function notePasswordFailure(
  services: Services,
  userId: string,
  action: "password" | "delete"
): Promise<void> {
  await services.store.recordAuthAttempt(passwordScope(userId, action));
}

async function clearPasswordBudget(
  services: Services,
  userId: string,
  action: "password" | "delete"
): Promise<void> {
  await services.store.clearAuthAttempts(passwordScope(userId, action));
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

  /**
   * What happened to a support message.
   *
   * The reference alone is not enough to read a conversation: whoever knows the address
   * that wrote it must also present that address. The answer never reveals the message of
   * a reference whose address does not match, and the lookup is constant in shape.
   */
  const supportLookup = async (reference: string, address: string) => {
    const message = await services.store.getSupportMessage(reference);
    if (!message || normalizeEmail(message.fromAddress) !== normalizeEmail(address)) {
      throw new HttpError(404, "support_not_found", "No message with this reference and address.");
    }
    return message;
  };

  app.get("/support/:reference", async (c) => {
    // The reference is long, but this endpoint is public: a durable per-address
    // counter keeps a distributed caller from turning it into a free oracle.
    const ip = clientAddress({ get: (name) => c.req.header(name) });
    const scope = `support:lookup:${ip}`;
    const since = new Date(services.clock().getTime() - 60 * 60_000);
    if ((await services.store.countAuthAttempts(scope, since)) >= 30) {
      c.header("Retry-After", "3600");
      throw new HttpError(429, "too_many_attempts", "Trop de recherches. Réessaie dans une heure.");
    }
    await services.store.recordAuthAttempt(scope);
    const address = c.req.query("email") ?? "";
    if (!address.includes("@")) {
      throw new HttpError(400, "invalid_email", "Add the address that wrote the message.");
    }
    const message = await supportLookup(c.req.param("reference"), address);
    return c.json({
      reference: message.id,
      subject: message.subject,
      status: message.status,
      reply: message.reply,
      repliedAt: message.repliedAt,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    });
  });

  // ---------------------------------------------------------- invitations

  /**
   * Invitations waiting for an answer.
   *
   * The invitee is the only one who can decide, and this list is how they find out: the
   * workspace they were added to does not appear in their session until they accept.
   */
  app.get("/invitations", async (c) => {
    const user = await requireUser(c, services);
    const items = await services.store.listInvitationsForUser(user.id);
    return c.json({ items });
  });

  app.post("/invitations/:invitationId/accept", async (c) => {
    const user = await requireUser(c, services);
    const invitation = await services.store.getInvitation(c.req.param("invitationId"));
    // Someone else's invitation answers 404, never 403: ids stay unenumerable.
    if (!invitation || invitation.invitedUserId !== user.id) {
      throw new HttpError(404, "invitation_not_found", "This invitation does not exist.");
    }
    if (invitation.status !== "pending") {
      throw new HttpError(
        409,
        "invitation_already_answered",
        `This invitation was already ${invitation.status}.`
      );
    }
    const workspace = await services.store.getWorkspace(invitation.workspaceId);
    if (!workspace) {
      await services.store.respondToInvitation(invitation.id, user.id, "declined");
      throw new HttpError(404, "workspace_not_found", "This workspace no longer exists.");
    }
    const answered = await services.store.respondToInvitation(invitation.id, user.id, "accepted");
    if (!answered) {
      // Lost the race against another tab: it has an answer already.
      throw new HttpError(409, "invitation_already_answered", "This invitation was answered.");
    }
    // The membership row is created only now, which is the whole point: invited is not
    // the same as member.
    if (!(await services.store.workspaceMemberRole(workspace.id, user.id))) {
      await services.store.addWorkspaceMember({
        workspaceId: workspace.id,
        userId: user.id,
        role: invitation.role,
      });
    }
    await services.store.appendAudit({
      workspaceId: workspace.id,
      actor: user.id,
      action: "invitation.accepted",
      detail: { invitationId: invitation.id, role: invitation.role },
    });
    return c.json({
      ok: true,
      workspace: { id: workspace.id, name: workspace.name, role: invitation.role },
    });
  });

  app.post("/invitations/:invitationId/decline", async (c) => {
    const user = await requireUser(c, services);
    const invitation = await services.store.getInvitation(c.req.param("invitationId"));
    if (!invitation || invitation.invitedUserId !== user.id) {
      throw new HttpError(404, "invitation_not_found", "This invitation does not exist.");
    }
    const answered = await services.store.respondToInvitation(invitation.id, user.id, "declined");
    if (!answered) {
      throw new HttpError(409, "invitation_already_answered", "This invitation was answered.");
    }
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- sessions

  /**
   * The sessions a person can see and revoke.
   *
   * A password cannot protect what the owner cannot inspect: "sign out everywhere" is
   * only meaningful with a list of where "everywhere" is. The token hash is never
   * returned — knowing a session exists must not help impersonate it.
   */
  app.get("/sessions", async (c) => {
    const user = await requireUser(c, services);
    const current = c.get("session");
    const sessions = await services.store.listSessions(user.id, services.clock());
    return c.json({
      items: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
        userAgent: session.userAgent ?? null,
        ip: session.ip ?? null,
        current: session.id === current.id,
      })),
    });
  });

  app.delete("/sessions/:sessionId", async (c) => {
    const user = await requireUser(c, services);
    const session = await services.store.sessionById(c.req.param("sessionId"));
    // Someone else's session is "not found", never "forbidden": no id enumeration.
    if (!session || session.userId !== user.id) {
      throw new HttpError(404, "session_not_found", "This session does not exist.");
    }
    await services.store.deleteSession(session.id);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------- password change

  /**
   * Change the password with the current one as proof, then revoke every *other*
   * session. That second half is the point: a person changing a password usually
   * believes someone else may be signed in, and leaving those sessions alive would
   * make the change cosmetic.
   */
  app.post("/password", async (c) => {
    const user = await requireUser(c, services);
    const body = await readBody(c, changePasswordSchema);
    await assertPasswordBudget(services, user.id, "password");
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      await notePasswordFailure(services, user.id, "password");
      throw new HttpError(403, "invalid_password", "The current password is incorrect.");
    }
    await clearPasswordBudget(services, user.id, "password");
    if (body.currentPassword === body.newPassword) {
      throw new HttpError(
        400,
        "password_unchanged",
        "The new password must differ from the current one."
      );
    }
    const current = c.get("session");
    const revoked = await services.store.updateUserPassword(
      user.id,
      await hashPassword(body.newPassword),
      {
        keepSessionId: current.id,
      }
    );
    return c.json({ ok: true, revokedSessions: revoked });
  });

  // -------------------------------------------------------- account deletion

  /**
   * Delete the account, as the privacy page promises.
   *
   * Two guards keep this from surprising anyone: the password is re-checked, and the
   * word DELETE has to be typed. A workspace the person owns with other members is
   * refused, because deleting it would delete their colleagues' work — the person is
   * told to transfer ownership or remove the members first.
   */
  // Canonical path is `/api/account` (no trailing slash): Hono mounts this router
  // under that prefix, so "/" is the account itself.
  app.delete("/", async (c) => {
    const user = await requireUser(c, services);
    const body = await readBody(c, deleteAccountSchema);
    await assertPasswordBudget(services, user.id, "delete");
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await notePasswordFailure(services, user.id, "delete");
      throw new HttpError(403, "invalid_password", "The password is incorrect.");
    }
    await clearPasswordBudget(services, user.id, "delete");

    const workspaces = await services.store.listWorkspaces(user.id);
    const owned = workspaces.filter((workspace) => workspace.role === "owner");
    for (const workspace of owned) {
      const members = await services.store.listMembers(workspace.id);
      const others = members.filter((member) => member.userId !== user.id);
      if (others.length > 0) {
        throw new HttpError(
          409,
          "workspace_not_empty",
          `You still own "${workspace.name}" with ${others.length} other member(s). Transfer ownership or remove them first.`,
          { workspaceId: workspace.id, workspaceName: workspace.name, members: others.length }
        );
      }
    }
    // Every owned workspace is now single-member, so deleting it removes only this
    // person's own data. Memberships elsewhere are dropped by deleteUserAccount.
    for (const workspace of owned) await services.store.deleteWorkspace(workspace.id);
    await services.store.deleteUserAccount(user.id);

    c.header("Set-Cookie", clearSessionCookie(services.config.secureCookies));
    return c.json({ ok: true });
  });

  /** Operational visibility for the operator: what was never delivered, and why. */
  app.get("/delivery-status", async (c) => {
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    const found = token
      ? await services.store.findSessionByTokenHash(await hashToken(token))
      : undefined;
    if (!found) throw new HttpError(401, "not_authenticated", "Connecte-toi d'abord.");
    // An address ending in the product's domain is not a proof of anything: anyone
    // can sign up as `anything@proofcore.dev` and would otherwise read the whole
    // outbox, including reset links. Operator status comes only from the explicit
    // allow-list, exactly like `/outbox/:id`.
    if (!isAdmin(services, found.user.email)) {
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
