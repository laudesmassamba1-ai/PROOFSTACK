import type { Context } from "hono";
import type { ZodType } from "zod";
import { hashToken, readCookie, SESSION_COOKIE } from "../auth.js";
import type { Role, UserRecord, WorkspaceRecord } from "../store/app-store.js";
import { HttpError } from "./errors.js";
import type { AppEnv, Services } from "./services.js";

/**
 * Request guards.
 *
 * The session cookie is resolved to a hashed token lookup on every request — no JWT
 * claim is trusted for identity or plan. Workspace access is a membership row, and a
 * workspace the caller is not a member of answers 404 rather than 403, so an
 * enumeration attempt learns nothing.
 */

export async function requireUser(c: Context<AppEnv>, services: Services): Promise<UserRecord> {
  const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
  if (!token) throw new HttpError(401, "not_authenticated", "Sign in to continue.");
  const tokenHash = await hashToken(token);
  const found = await services.store.findSessionByTokenHash(tokenHash);
  if (!found)
    throw new HttpError(401, "invalid_session", "Your session is no longer valid. Sign in again.");
  if (found.session.expiresAt <= new Date(services.clock()).toISOString()) {
    await services.store.deleteSession(found.session.id);
    throw new HttpError(401, "session_expired", "Your session expired. Sign in again.");
  }
  // Touch at most once per hour: D1 free-tier writes are a real budget.
  const hourAgo = new Date(services.clock().getTime() - 3_600_000).toISOString();
  if (!found.session.lastSeenAt || found.session.lastSeenAt < hourAgo) {
    await services.store.touchSession(found.session.id);
  }
  c.set("user", found.user);
  c.set("session", found.session);
  return found.user;
}

export interface WorkspaceAccess {
  workspace: WorkspaceRecord;
  role: Role;
}

export async function requireWorkspace(
  c: Context<AppEnv>,
  services: Services,
  workspaceId: string | undefined,
  roles?: readonly Role[]
): Promise<WorkspaceAccess> {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "not_authenticated", "Sign in to continue.");
  if (!workspaceId) throw new HttpError(400, "workspace_required", "workspaceId is required.");
  const role = await services.store.workspaceRole(workspaceId, user.id);
  if (!role) throw new HttpError(404, "workspace_not_found", "Workspace not found.");
  const workspace = await services.store.getWorkspace(workspaceId);
  if (!workspace) throw new HttpError(404, "workspace_not_found", "Workspace not found.");
  if (roles && !roles.includes(role)) {
    throw new HttpError(
      403,
      "insufficient_role",
      `This action requires the ${roles.join(" or ")} role; yours is ${role}.`
    );
  }
  return { workspace, role };
}

/** Parse and validate a JSON body. A malformed body is a 400, never a 500. */
/**
 * Largest accepted JSON body.
 *
 * Parsing happens before validation, so an unbounded body is a memory amplifier: a
 * single request could allocate far more than any legitimate payload needs. The
 * `content-length` header is checked first, and the parsed size is checked again for
 * chunked requests that omit it.
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function readBody<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "The request body exceeds 2 MB.");
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON.");
  }
  if (JSON.stringify(raw ?? null).length > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "The request body exceeds 2 MB.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_body", "The request body is invalid.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
