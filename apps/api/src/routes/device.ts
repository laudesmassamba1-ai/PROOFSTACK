import { sha256Hex, uuid } from "@proofcore/core";
import { Hono } from "hono";
import { z } from "zod";
import {
  base64url,
  createSessionToken,
  randomBytes,
  serializeSessionCookie,
  sessionExpiry,
} from "../auth.js";
import { clientAddress, HttpError, RateLimiter } from "../http/errors.js";
import { readBody, requireUser } from "../http/guards.js";
import type { AppEnv, Services } from "../http/services.js";
import { publicUser } from "./auth.js";

const DEVICE_GRANT_TTL_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 3_000;

/** Unambiguous alphabet: no 0/O, 1/I/L to keep manual entry reliable. */
const USER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const startSchema = z
  .object({
    clientName: z.string().min(1).max(60).optional(),
  })
  .strict();

const tokenSchema = z
  .object({
    deviceCode: z.string().min(20).max(200),
  })
  .strict();

const verifySchema = z
  .object({
    userCode: z.string().min(6).max(20),
  })
  .strict();

function randomUserCode(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Device authorization (RFC 8628-style) for the CLI.
 *
 * `proofcore login --device` cannot open a browser on every machine it runs on —
 * CI runners, SSH boxes, a teammate's terminal. Instead the CLI asks for a
 * short-lived grant, the user opens the verification URL on any device where
 * they are already signed in, and the CLI polls until the grant is decided.
 *
 * Authority invariants:
 * - The device code is bearer knowledge; only its SHA-256 is stored.
 * - The approval decision happens in an authenticated browser session, never
 *   through the device channel.
 * - A grant is consumed on first use: one approval mints exactly one session.
 * - Polling is rate limited per grant, and the interval is advisory anyway: the
 *   point is cost, not correctness.
 */
export function deviceRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const startLimiter = new RateLimiter(10, 10 * 60_000);
  const pollLimiter = new RateLimiter(60, 10 * 60_000);
  const verifyLimiter = new RateLimiter(30, 10 * 60_000);

  app.post("/start", async (c) => {
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const limited = startLimiter.check(address);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      throw new HttpError(
        429,
        "too_many_requests",
        "Too many device grants. Wait before retrying."
      );
    }

    const body = await readBody(c, startSchema);
    await services.store.deleteExpiredDeviceGrants();

    // 32 random bytes, base64url — the same shape as a session token.
    const deviceCode = `ps_dev_${base64url(randomBytes(32))}`;
    const grant = await services.store.createDeviceGrant({
      deviceCodeHash: await sha256Hex(deviceCode),
      userCode: randomUserCode(),
      expiresAt: new Date(new Date(services.clock()).getTime() + DEVICE_GRANT_TTL_MS).toISOString(),
      clientName: body.clientName?.trim() || "proofcore CLI",
      ...(address !== "local" ? { ip: address } : {}),
    });

    const webOrigin = services.config.webOrigins[0] ?? "http://localhost:5173";
    return c.json(
      {
        deviceCode,
        userCode: grant.userCode,
        verificationUrl: `${webOrigin}/device`,
        expiresIn: Math.round(DEVICE_GRANT_TTL_MS / 1000),
        interval: Math.round(POLL_INTERVAL_MS / 1000),
      },
      201
    );
  });

  app.post("/token", async (c) => {
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const body = await readBody(c, tokenSchema);
    const grant = await services.store.findDeviceGrantByDeviceCodeHash(
      await sha256Hex(body.deviceCode)
    );
    if (!grant) {
      // Identical answer for an unknown, an expired and a revoked code: the
      // caller cannot learn which one it was.
      throw new HttpError(
        400,
        "invalid_grant",
        "The device code is unknown or expired. Start again."
      );
    }

    const limited = pollLimiter.check(grant.id);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      throw new HttpError(429, "slow_down", "Polling too fast. Wait for the interval.");
    }
    await services.store.markDevicePolled(grant.id);

    if (new Date(grant.expiresAt).getTime() <= new Date(services.clock()).getTime()) {
      throw new HttpError(400, "expired_token", "The device grant expired. Start again.");
    }

    if (grant.status === "denied") {
      throw new HttpError(403, "access_denied", "The request was denied in the browser.");
    }
    if (grant.status === "consumed") {
      throw new HttpError(
        400,
        "invalid_grant",
        "The device code is unknown or expired. Start again."
      );
    }
    if (grant.status === "pending" || !grant.userId) {
      throw new HttpError(400, "authorization_pending", "Open the verification URL and approve.");
    }

    // Approved: mint the session in the same transaction-like order sign-in uses,
    // then consume the grant so a second poll cannot mint a second session.
    const user = await services.store.findUserById(grant.userId);
    if (!user)
      throw new HttpError(
        400,
        "invalid_grant",
        "The device code is unknown or expired. Start again."
      );

    await services.store.deleteExpiredSessions(user.id, services.clock());
    const { token, tokenHash } = await createSessionToken();
    const expiresAt = sessionExpiry(services.clock());
    await services.store.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: grant.clientName ?? "proofcore CLI (device flow)",
      ...(address !== "local" ? { ip: address } : {}),
    });
    await services.store.consumeDeviceGrant(grant.id);
    await services.store.appendAudit({
      workspaceId: "",
      actor: user.id,
      action: "device.grant.consumed",
      detail: { grantId: grant.id },
    });

    const workspaces = await services.store.listWorkspaces(user.id);
    c.header(
      "Set-Cookie",
      serializeSessionCookie(token, { secure: services.config.secureCookies })
    );
    return c.json({ user: publicUser(user), workspaces, session: { expiresAt } });
  });

  /** Approve (or deny) from the browser, signed in as the approving user. */
  app.post("/verify", async (c) => {
    const user = await requireUser(c, services);
    const address = clientAddress({ get: (name) => c.req.header(name) });
    const limited = verifyLimiter.check(`${address}|${user.id}`);
    if (!limited.allowed) {
      c.header("Retry-After", String(limited.retryAfterSeconds));
      throw new HttpError(
        429,
        "too_many_requests",
        "Too many verification attempts. Wait a moment."
      );
    }

    const body = await readBody(c, verifySchema);
    const userCode = body.userCode.trim().toUpperCase();
    const grant = await services.store.findDeviceGrantByUserCode(userCode);
    if (!grant || new Date(grant.expiresAt) <= new Date(services.clock())) {
      throw new HttpError(404, "unknown_code", "This code is not active. Check it and try again.");
    }
    if (grant.status !== "pending") {
      throw new HttpError(409, "already_decided", "This request was already handled.");
    }

    await services.store.decideDeviceGrant(grant.id, "approved", user.id);
    await services.store.appendAudit({
      workspaceId: "",
      actor: user.id,
      action: "device.grant.approved",
      detail: { grantId: grant.id, clientName: grant.clientName },
    });
    return c.json({ ok: true, clientName: grant.clientName });
  });

  app.post("/deny", async (c) => {
    const user = await requireUser(c, services);
    const body = await readBody(c, verifySchema);
    const userCode = body.userCode.trim().toUpperCase();
    const grant = await services.store.findDeviceGrantByUserCode(userCode);
    if (!grant || new Date(grant.expiresAt) <= new Date(services.clock())) {
      throw new HttpError(404, "unknown_code", "This code is not active. Check it and try again.");
    }
    await services.store.decideDeviceGrant(grant.id, "denied", user.id);
    return c.json({ ok: true });
  });

  return app;
}

export function newDeviceGrantId(): string {
  return `dvc_${uuid().replaceAll("-", "").slice(0, 20)}`;
}
