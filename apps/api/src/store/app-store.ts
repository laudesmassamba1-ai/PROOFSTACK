import type {
  EnvironmentKind,
  ModuleId,
  RunStatus,
  Severity,
  TestRun,
  TestStatus,
} from "@proofcore/contracts";
import { iso, ProofCoreError, slugify, uuid } from "@proofcore/core";
import {
  bool,
  type Database,
  json,
  nullableStr,
  num,
  parseJson,
  type Row,
  str,
} from "../db/types.js";

/**
 * Tenant data.
 *
 * Every method that reads tenant-owned data takes the caller's workspace as an
 * argument, and every query filters on it. A route cannot "forget" the scope because
 * there is no method that returns a project by id alone.
 */

export type Role = "owner" | "admin" | "member" | "viewer";

export interface UserRecord {
  id: string;
  email: string;
  emailNormalized: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  emailVerifiedAt: string | null;
}

export interface InvitationRecord {
  id: string;
  workspaceId: string;
  invitedUserId: string;
  invitedByUserId: string;
  role: Role;
  status: "pending" | "accepted" | "declined" | "revoked";
  createdAt: string;
  respondedAt: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  /** Context the browser can show next to a session ("Chrome · 82.64.x.x"). */
  userAgent?: string | null;
  ip?: string | null;
}

export interface DeviceGrantRecord {
  id: string;
  deviceCodeHash: string;
  userCode: string;
  status: "pending" | "approved" | "denied" | "consumed";
  userId: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
  pollCount: number;
  clientName: string | null;
  ip: string | null;
}

export interface AiConversationRecord {
  id: string;
  userId: string;
  workspaceId: string;
  title: string;
  effort: string;
  messages: unknown[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One durable statement about a workspace.
 *
 * Memory is deliberately small and human: a sentence, a kind and where it came from.
 * It is scoped to the workspace, so changing the model — or the person — does not
 * restart the product's context.
 */
export interface WorkspaceMemoryRecord {
  id: string;
  workspaceId: string;
  kind: string;
  text: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiProfileRecord {
  userId: string;
  providerBaseUrl: string;
  providerModel: string;
  providerKind: string;
  providerId: string;
  apiKeyEncrypted: string;
  keyFingerprint: string;
  updatedAt: string;
}

export interface WorkspaceWebhookRecord {
  id: string;
  workspaceId: string;
  url: string;
  /** Kept server-side to sign deliveries; shown in plaintext only at creation. */
  secret: string;
  secretPrefix: string;
  events: string[];
  disabled: boolean;
  createdAt: string;
  lastStatus: number | null;
  lastStatusAt: string | null;
  lastError: string | null;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  baseUrl: string;
  stack: string | null;
  environment: EnvironmentKind;
  enabledModules: ModuleId[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  environment: EnvironmentKind;
  revision: string | null;
  totals: Record<string, RunTotals>;
  createdAt: string;
  /** The stored report for this run, when one exists. */
  reportId?: string | null;
}

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
  skipped: number;
}

export interface FindingRecord {
  id: string;
  reportId: string;
  projectId: string;
  module: ModuleId;
  title: string;
  severity: Severity;
  status: TestStatus;
  code: string | null;
  fingerprint: string | null;
  detectedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  label: string;
  prefix: string;
  tokenHash: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

export class AppStore {
  constructor(
    readonly db: Database,
    private readonly clock: () => Date = () => new Date()
  ) {}

  // ------------------------------------------------------------------ users

  async createUser(input: {
    email: string;
    emailNormalized: string;
    name: string;
    passwordHash: string;
  }): Promise<UserRecord> {
    const user: UserRecord = {
      id: `usr_${uuid().replaceAll("-", "").slice(0, 20)}`,
      email: input.email,
      emailNormalized: input.emailNormalized,
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: iso(this.clock()),
      emailVerifiedAt: null,
    };
    try {
      await this.db
        .prepare(
          `INSERT INTO users (id, email, email_normalized, name, password_hash, created_at, email_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          user.id,
          user.email,
          user.emailNormalized,
          user.name,
          user.passwordHash,
          user.createdAt,
          null
        )
        .run();
    } catch (error) {
      // The unique index is the authority on identity, not a prior SELECT.
      if (isUniqueViolation(error)) {
        throw new ProofCoreError({
          message: "An account with this email already exists",
          category: "VALIDATION",
          code: "email_taken",
        });
      }
      throw error;
    }
    return user;
  }

  async findUserByNormalizedEmail(emailNormalized: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE email_normalized = ?")
      .bind(emailNormalized)
      .first<Row>();
    return row ? mapUser(row) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<Row>();
    return row ? mapUser(row) : null;
  }

  // ---------------------------------------------------- account lifecycle

  async createAuthToken(input: {
    id: string;
    userId: string;
    kind: "password_reset" | "email_verify";
    tokenHash: string;
    expiresAt: string;
    requestedIp?: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO auth_tokens (id, user_id, kind, token_hash, created_at, expires_at, requested_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.id,
        input.userId,
        input.kind,
        input.tokenHash,
        iso(this.clock()),
        input.expiresAt,
        input.requestedIp ?? null
      )
      .run();
  }

  /**
   * Consumes a token atomically.
   *
   * `UPDATE ... WHERE consumed_at IS NULL` is the whole point: two concurrent clicks on
   * the same link must not both succeed, and a consumed token must never be reusable.
   */
  async consumeAuthToken(
    tokenHash: string,
    kind: "password_reset" | "email_verify"
  ): Promise<{ userId: string } | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_id, expires_at, consumed_at FROM auth_tokens
         WHERE token_hash = ? AND kind = ?`
      )
      .bind(tokenHash, kind)
      .first<Row>();
    if (!row) return null;
    if (nullableStr(row, "consumed_at")) return null;
    if (str(row, "expires_at") <= iso(this.clock())) return null;
    const result = await this.db
      .prepare("UPDATE auth_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(iso(this.clock()), str(row, "id"))
      .run();
    if (result.changes !== 1) return null;
    return { userId: str(row, "user_id") };
  }

  async invalidateAuthTokens(
    userId: string,
    kind: "password_reset" | "email_verify"
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE auth_tokens SET consumed_at = ? WHERE user_id = ? AND kind = ? AND consumed_at IS NULL"
      )
      .bind(iso(this.clock()), userId, kind)
      .run();
  }

  /**
   * Change a password and revoke sessions.
   *
   * The two callers want different things, so the policy is a parameter rather than a
   * hidden default:
   *  - a reset link (nobody is signed in) revokes every session;
   *  - a change made from inside the app keeps the session that made it, otherwise the
   *    person is thrown out of the page they just used.
   * Returns how many sessions were revoked, so the route can tell the truth about it.
   */
  async updateUserPassword(
    userId: string,
    passwordHash: string,
    options: { keepSessionId?: string } = {}
  ): Promise<number> {
    await this.db
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(passwordHash, userId)
      .run();
    if (options.keepSessionId) {
      const result = await this.db
        .prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?")
        .bind(userId, options.keepSessionId)
        .run();
      return result.changes;
    }
    const result = await this.db
      .prepare("DELETE FROM sessions WHERE user_id = ?")
      .bind(userId)
      .run();
    return result.changes;
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.db
      .prepare("UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL")
      .bind(iso(this.clock()), userId)
      .run();
  }

  async enqueueEmail(input: {
    id: string;
    userId?: string | null;
    to: string;
    subject: string;
    text: string;
    html?: string | null;
    kind: string;
    status: "queued" | "sent" | "failed" | "unconfigured";
    provider?: string | null;
    providerId?: string | null;
    error?: string | null;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO email_outbox (id, user_id, to_address, subject, body_text, body_html,
                                   kind, status, provider, provider_id, error, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.id,
        input.userId ?? null,
        input.to,
        input.subject,
        input.text,
        input.html ?? null,
        input.kind,
        input.status,
        input.provider ?? null,
        input.providerId ?? null,
        input.error ?? null,
        iso(this.clock()),
        input.status === "sent" ? iso(this.clock()) : null
      )
      .run();
  }

  async listEmailOutbox(limit = 50): Promise<
    {
      id: string;
      to: string;
      subject: string;
      kind: string;
      status: string;
      error: string | null;
      createdAt: string;
    }[]
  > {
    const rows = await this.db
      .prepare(
        `SELECT id, to_address, subject, kind, status, error, created_at FROM email_outbox
         ORDER BY created_at DESC LIMIT ?`
      )
      .bind(limit)
      .all<Row>();
    return rows.map((row) => ({
      id: str(row, "id"),
      to: str(row, "to_address"),
      subject: str(row, "subject"),
      kind: str(row, "kind"),
      status: str(row, "status"),
      error: nullableStr(row, "error"),
      createdAt: str(row, "created_at"),
    }));
  }

  /**
   * Full body of one queued message.
   *
   * Only the operator endpoint calls this: it is how a human delivers a reset link by
   * hand when no mail provider is configured. Without it the fallback I documented
   * would be a promise with no implementation.
   */
  async getEmailOutboxEntry(
    id: string
  ): Promise<{ id: string; to: string; subject: string; body: string; status: string } | null> {
    const row = await this.db
      .prepare("SELECT id, to_address, subject, body_text, status FROM email_outbox WHERE id = ?")
      .bind(id)
      .first<Row>();
    if (!row) return null;
    return {
      id: str(row, "id"),
      to: str(row, "to_address"),
      subject: str(row, "subject"),
      body: str(row, "body_text"),
      status: str(row, "status"),
    };
  }

  async createSupportMessage(input: {
    id: string;
    userId?: string | null;
    fromAddress: string;
    workspaceId?: string | null;
    subject: string;
    body: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO support_messages (id, user_id, from_address, workspace_id, subject, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.id,
        input.userId ?? null,
        input.fromAddress,
        input.workspaceId ?? null,
        input.subject,
        input.body,
        iso(this.clock())
      )
      .run();
  }

  // --------------------------------------------------------------- sessions

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
    userAgent?: string;
    ip?: string;
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: `ses_${uuid().replaceAll("-", "").slice(0, 20)}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt: iso(this.clock()),
      expiresAt: input.expiresAt,
      lastSeenAt: null,
    };
    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        session.id,
        session.userId,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
        null,
        input.userAgent ?? null,
        input.ip ?? null
      )
      .run();
    return session;
  }

  /** Resolve a session and the user it belongs to, in one query. */
  async findSessionByTokenHash(
    tokenHash: string
  ): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    const row = await this.db
      .prepare(
        `SELECT s.id AS session_id, s.user_id, s.token_hash, s.created_at AS session_created_at,
                s.expires_at, s.last_seen_at,
                u.id AS user_id_ref, u.email, u.email_normalized, u.name, u.password_hash,
                u.created_at AS user_created_at, u.email_verified_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .bind(tokenHash)
      .first<Row>();
    if (!row) return null;
    return {
      session: {
        id: str(row, "session_id"),
        userId: str(row, "user_id"),
        tokenHash: str(row, "token_hash"),
        createdAt: str(row, "session_created_at"),
        expiresAt: str(row, "expires_at"),
        lastSeenAt: nullableStr(row, "last_seen_at"),
      },
      user: {
        id: str(row, "user_id_ref"),
        email: str(row, "email"),
        emailNormalized: str(row, "email_normalized"),
        name: str(row, "name"),
        passwordHash: str(row, "password_hash"),
        createdAt: str(row, "user_created_at"),
        emailVerifiedAt: nullableStr(row, "email_verified_at"),
      },
    };
  }

  async touchSession(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .bind(iso(this.clock()), id)
      .run();
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  }

  /**
   * Durable brute-force memory.
   *
   * The in-memory limiter in the route is per isolate, so it resets on every cold
   * start. These three helpers back it with rows that all isolates see, and they are
   * only written on a failed attempt — a successful sign-in costs one read.
   *
   * `since` is passed in by the caller so the lockout window is a route policy, not a
   * storage detail.
   */
  async recordAuthAttempt(scope: string, now = this.clock()): Promise<void> {
    await this.db
      .prepare("INSERT INTO auth_attempts (id, scope, at) VALUES (?, ?, ?)")
      .bind(uuid(), scope, iso(now))
      .run();
  }

  /** Attempts for one scope inside the window, pruning anything older than it. */
  async countAuthAttempts(scope: string, since: Date): Promise<number> {
    await this.db
      .prepare("DELETE FROM auth_attempts WHERE scope = ? AND at < ?")
      .bind(scope, iso(since))
      .run();
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE scope = ? AND at >= ?")
      .bind(scope, iso(since))
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  /** A correct password clears the counter: the person proved who they are. */
  async clearAuthAttempts(scope: string): Promise<void> {
    await this.db.prepare("DELETE FROM auth_attempts WHERE scope = ?").bind(scope).run();
  }

  /** Revoke every session but the one in hand: what a password change must do. */
  async deleteSessionsExcept(userId: string, keepSessionId: string): Promise<number> {
    const result = await this.db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?")
      .bind(userId, keepSessionId)
      .run();
    return result.changes;
  }

  async sessionById(id: string): Promise<SessionRecord | null> {
    const row = await this.db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<Row>();
    if (!row) return null;
    return {
      id: str(row, "id"),
      userId: str(row, "user_id"),
      tokenHash: str(row, "token_hash"),
      createdAt: str(row, "created_at"),
      expiresAt: str(row, "expires_at"),
      lastSeenAt: nullableStr(row, "last_seen_at"),
      ...(nullableStr(row, "user_agent") ? { userAgent: nullableStr(row, "user_agent") } : {}),
      ...(nullableStr(row, "ip") ? { ip: nullableStr(row, "ip") } : {}),
    };
  }

  /**
   * Delete a person's account and everything that only exists because of it.
   *
   * Workspace rows are the caller's responsibility: a workspace has its own lifetime
   * and may have other members, so the route decides which ones to delete first. This
   * walk removes what a departure unambiguously owns.
   */
  async deleteUserAccount(userId: string): Promise<void> {
    const userScoped = [
      "sessions",
      "auth_tokens",
      "device_grants",
      "ai_profiles",
      "ai_conversations",
      "browser_sessions",
      "email_outbox",
      "workspace_members",
    ];
    // Invitations are addressed to a person, not owned by them: drop both directions.
    await this.db
      .prepare(
        "DELETE FROM workspace_invitations WHERE invited_user_id = ? OR invited_by_user_id = ?"
      )
      .bind(userId, userId)
      .run();
    for (const table of userScoped) {
      await this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
    }
    // Support messages keep their reference for the operator's queue, but they lose the
    // identity link: the message is a support artefact, the person is gone.
    await this.db
      .prepare("UPDATE support_messages SET user_id = NULL WHERE user_id = ?")
      .bind(userId)
      .run();
    await this.db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  }

  async deleteExpiredSessions(userId: string, now = this.clock()): Promise<void> {
    await this.db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?")
      .bind(userId, iso(now))
      .run();
  }

  async listSessions(userId: string, now = this.clock()): Promise<SessionRecord[]> {
    const rows = await this.db
      .prepare(
        "SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC"
      )
      .bind(userId, iso(now))
      .all<Row>();
    return rows.map(mapSession);
  }

  // ---------------------------------------------------------- device grants

  /** RFC 8628-style grant for `proofcore login --device`. Only the SHA-256 of
   *  the device code is persisted; the raw code is bearer knowledge. */
  async createDeviceGrant(input: {
    deviceCodeHash: string;
    userCode: string;
    expiresAt: string;
    clientName?: string;
    ip?: string;
  }): Promise<DeviceGrantRecord> {
    const grant: DeviceGrantRecord = {
      id: `dvc_${uuid().replaceAll("-", "").slice(0, 20)}`,
      deviceCodeHash: input.deviceCodeHash,
      userCode: input.userCode,
      status: "pending",
      userId: null,
      createdAt: iso(this.clock()),
      expiresAt: input.expiresAt,
      decidedAt: null,
      consumedAt: null,
      pollCount: 0,
      clientName: input.clientName ?? null,
      ip: input.ip ?? null,
    };
    await this.db
      .prepare(
        `INSERT INTO device_grants (id, device_code_hash, user_code, status, user_id, created_at, expires_at, decided_at, consumed_at, poll_count, client_name, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        grant.id,
        grant.deviceCodeHash,
        grant.userCode,
        grant.status,
        null,
        grant.createdAt,
        grant.expiresAt,
        null,
        null,
        0,
        grant.clientName,
        grant.ip
      )
      .run();
    return grant;
  }

  async findDeviceGrantByUserCode(userCode: string): Promise<DeviceGrantRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM device_grants WHERE user_code = ?")
      .bind(userCode)
      .first<Row>();
    return row ? mapDeviceGrant(row) : null;
  }

  async findDeviceGrantByDeviceCodeHash(hash: string): Promise<DeviceGrantRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM device_grants WHERE device_code_hash = ?")
      .bind(hash)
      .first<Row>();
    return row ? mapDeviceGrant(row) : null;
  }

  /** Mark a grant approved (or denied) for a user. Only a pending grant can be
   *  decided: an approved, denied or consumed grant keeps its first decision. */
  async decideDeviceGrant(
    id: string,
    status: "approved" | "denied",
    userId: string
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE device_grants SET status = ?, user_id = ?, decided_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .bind(status, userId, iso(this.clock()), id)
      .run();
  }

  async markDevicePolled(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE device_grants SET poll_count = poll_count + 1 WHERE id = ?")
      .bind(id)
      .run();
  }

  /** Consume an approved grant so the same approval can never mint two sessions. */
  async consumeDeviceGrant(id: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE device_grants SET status = 'consumed', consumed_at = ?
         WHERE id = ? AND status = 'approved'`
      )
      .bind(iso(this.clock()), id)
      .run();
  }

  async deleteExpiredDeviceGrants(now = this.clock()): Promise<void> {
    await this.db.prepare("DELETE FROM device_grants WHERE expires_at <= ?").bind(iso(now)).run();
  }

  // ---------------------------------------------------------- ai experience

  async createBrowserSession(input: {
    id: string;
    userId: string;
    workspaceId: string;
    targetSessionId: string;
    url: string;
  }): Promise<void> {
    const now = iso(this.clock());
    await this.db
      .prepare(
        `INSERT INTO browser_sessions (id, user_id, workspace_id, target_session_id, url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(input.id, input.userId, input.workspaceId, input.targetSessionId, input.url, now, now)
      .run();
  }

  async getBrowserSession(
    userId: string,
    id: string
  ): Promise<{ id: string; targetSessionId: string; url: string } | null> {
    const row = await this.db
      .prepare(
        "SELECT id, target_session_id, url FROM browser_sessions WHERE id = ? AND user_id = ?"
      )
      .bind(id, userId)
      .first<{ id: string; target_session_id: string; url: string }>();
    if (!row) return null;
    return { id: row.id, targetSessionId: row.target_session_id, url: row.url };
  }

  async listBrowserSessions(userId: string): Promise<{ id: string; targetSessionId: string }[]> {
    const rows = await this.db
      .prepare(
        "SELECT id, target_session_id FROM browser_sessions WHERE user_id = ? ORDER BY updated_at DESC"
      )
      .bind(userId)
      .all<{ id: string; target_session_id: string }>();
    return rows.map((row) => ({
      id: row.id,
      targetSessionId: row.target_session_id,
    }));
  }

  async touchBrowserSession(userId: string, id: string, url: string): Promise<void> {
    await this.db
      .prepare("UPDATE browser_sessions SET url = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(url, iso(this.clock()), id, userId)
      .run();
  }

  async deleteBrowserSession(userId: string, id: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM browser_sessions WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .run();
  }

  async saveAiConversation(input: {
    id: string;
    userId: string;
    workspaceId: string;
    title: string;
    effort: string;
    messages: unknown[];
  }): Promise<AiConversationRecord> {
    const now = iso(this.clock());
    await this.db
      .prepare(
        `INSERT INTO ai_conversations (id, user_id, workspace_id, title, effort, messages, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, effort = excluded.effort,
           messages = excluded.messages, updated_at = excluded.updated_at`
      )
      .bind(
        input.id,
        input.userId,
        input.workspaceId,
        input.title,
        input.effort,
        json(input.messages),
        now,
        now
      )
      .run();
    const row = await this.db
      .prepare("SELECT * FROM ai_conversations WHERE id = ?")
      .bind(input.id)
      .first<Row>();
    if (!row) {
      throw new ProofCoreError({
        message: "ai conversation vanished after upsert",
        category: "ASSERTION",
        code: "ai_conversation_missing",
      });
    }
    return mapAiConversation(row);
  }

  async listAiConversations(
    userId: string,
    workspaceId: string,
    limit = 50,
    offset = 0
  ): Promise<{ id: string; title: string; effort: string; updatedAt: string }[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, title, effort, updated_at FROM ai_conversations
         WHERE user_id = ? AND workspace_id = ?
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .bind(userId, workspaceId, limit, offset)
      .all<Row>();
    return rows.map((row) => ({
      id: str(row, "id"),
      title: str(row, "title"),
      effort: str(row, "effort"),
      updatedAt: str(row, "updated_at"),
    }));
  }

  async countAiConversations(userId: string, workspaceId: string): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM ai_conversations WHERE user_id = ? AND workspace_id = ?"
      )
      .bind(userId, workspaceId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  async getAiConversation(userId: string, id: string): Promise<AiConversationRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM ai_conversations WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .first<Row>();
    return row ? mapAiConversation(row) : null;
  }

  async deleteAiConversation(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM ai_conversations WHERE user_id = ? AND id = ?")
      .bind(userId, id)
      .run();
    return result.changes > 0;
  }

  // ------------------------------------------------------------------ memory

  /** Everything the assistant is allowed to remember about this workspace. */
  async listWorkspaceMemory(workspaceId: string, limit = 100): Promise<WorkspaceMemoryRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM workspace_memory WHERE workspace_id = ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .bind(workspaceId, limit)
      .all<Row>();
    return rows.map(mapWorkspaceMemory);
  }

  /**
   * Remember a statement, or refresh the one that already says the same thing.
   *
   * The dedupe key is the normalised sentence, so "Prices are in XOF." and "prices are
   * in XOF" are one memory rather than two that contradict each other later. Returns
   * `created: false` when the fact was already known — the caller uses that to tell the
   * model not to repeat itself.
   */
  async rememberWorkspaceFact(input: {
    workspaceId: string;
    kind: string;
    text: string;
    source?: string;
  }): Promise<{ record: WorkspaceMemoryRecord; created: boolean }> {
    const now = iso(this.clock());
    const text = input.text.trim().replace(/\s+/g, " ").slice(0, 400);
    const dedupeKey = text
      .toLowerCase()
      .replace(/[.!\s]+$/g, "")
      .replace(/\s+/g, " ");
    const existing = await this.db
      .prepare("SELECT * FROM workspace_memory WHERE workspace_id = ? AND dedupe_key = ?")
      .bind(input.workspaceId, dedupeKey)
      .first<Row>();
    if (existing) {
      await this.db
        .prepare("UPDATE workspace_memory SET updated_at = ?, kind = ? WHERE id = ?")
        .bind(now, input.kind, str(existing, "id"))
        .run();
      const refreshed = await this.db
        .prepare("SELECT * FROM workspace_memory WHERE id = ?")
        .bind(str(existing, "id"))
        .first<Row>();
      return { record: mapWorkspaceMemory(refreshed ?? existing), created: false };
    }
    const id = `mem_${uuid().replaceAll("-", "").slice(0, 20)}`;
    await this.db
      .prepare(
        `INSERT INTO workspace_memory (id, workspace_id, kind, text, source, dedupe_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.workspaceId,
        input.kind,
        text,
        input.source ?? "assistant",
        dedupeKey,
        now,
        now
      )
      .run();
    return {
      record: {
        id,
        workspaceId: input.workspaceId,
        kind: input.kind,
        text,
        source: input.source ?? "assistant",
        createdAt: now,
        updatedAt: now,
      },
      created: true,
    };
  }

  async forgetWorkspaceFact(workspaceId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM workspace_memory WHERE id = ? AND workspace_id = ?")
      .bind(id, workspaceId)
      .run();
    return result.changes > 0;
  }

  async saveAiProfile(input: {
    userId: string;
    providerBaseUrl: string;
    providerModel: string;
    providerKind: string;
    providerId: string;
    apiKeyEncrypted: string;
    keyFingerprint: string;
  }): Promise<AiProfileRecord> {
    const now = iso(this.clock());
    await this.db
      .prepare(
        `INSERT INTO ai_profiles (user_id, provider_base_url, provider_model, api_key_encrypted, key_fingerprint, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET provider_base_url = excluded.provider_base_url,
           provider_model = excluded.provider_model, api_key_encrypted = excluded.api_key_encrypted,
           key_fingerprint = excluded.key_fingerprint, updated_at = excluded.updated_at`
      )
      .bind(
        input.userId,
        input.providerBaseUrl,
        input.providerModel,
        input.apiKeyEncrypted,
        input.keyFingerprint,
        now
      )
      .run();
    return {
      userId: input.userId,
      providerBaseUrl: input.providerBaseUrl,
      providerModel: input.providerModel,
      providerKind: input.providerKind,
      providerId: input.providerId,
      apiKeyEncrypted: input.apiKeyEncrypted,
      keyFingerprint: input.keyFingerprint,
      updatedAt: now,
    };
  }

  async getAiProfile(userId: string): Promise<AiProfileRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM ai_profiles WHERE user_id = ?")
      .bind(userId)
      .first<Row>();
    if (!row) return null;
    return {
      userId: str(row, "user_id"),
      providerBaseUrl: str(row, "provider_base_url"),
      providerModel: str(row, "provider_model"),
      providerKind: str(row, "provider_kind") || "openai",
      providerId: str(row, "provider_id") || "custom",
      apiKeyEncrypted: str(row, "api_key_encrypted"),
      keyFingerprint: str(row, "key_fingerprint"),
      updatedAt: str(row, "updated_at"),
    };
  }

  async deleteAiProfile(userId: string): Promise<void> {
    await this.db.prepare("DELETE FROM ai_profiles WHERE user_id = ?").bind(userId).run();
  }

  // ------------------------------------------------------ outbound webhooks

  async createWorkspaceWebhook(input: {
    workspaceId: string;
    url: string;
    secret: string;
    secretPrefix: string;
    events: string[];
  }): Promise<WorkspaceWebhookRecord> {
    const record: WorkspaceWebhookRecord = {
      id: `whk_${uuid().replaceAll("-", "").slice(0, 20)}`,
      workspaceId: input.workspaceId,
      url: input.url,
      secret: input.secret,
      secretPrefix: input.secretPrefix,
      events: input.events,
      disabled: false,
      createdAt: iso(this.clock()),
      lastStatus: null,
      lastStatusAt: null,
      lastError: null,
    };
    await this.db
      .prepare(
        `INSERT INTO workspace_webhooks (id, workspace_id, url, secret, secret_prefix, events, disabled, created_at, last_status, last_status_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL)`
      )
      .bind(
        record.id,
        record.workspaceId,
        record.url,
        record.secret,
        record.secretPrefix,
        record.events.join(","),
        record.createdAt
      )
      .run();
    return record;
  }

  async listWorkspaceWebhooks(workspaceId: string): Promise<WorkspaceWebhookRecord[]> {
    const rows = await this.db
      .prepare("SELECT * FROM workspace_webhooks WHERE workspace_id = ? ORDER BY created_at ASC")
      .bind(workspaceId)
      .all<Row>();
    return rows.filter((row) => !row.disabled).map(mapWorkspaceWebhook);
  }

  async deleteWorkspaceWebhook(workspaceId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM workspace_webhooks WHERE workspace_id = ? AND id = ?")
      .bind(workspaceId, id)
      .run();
    return result.changes > 0;
  }

  async markWebhookDelivery(
    id: string,
    status: number | null,
    error: string | null
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE workspace_webhooks SET last_status = ?, last_status_at = ?, last_error = ? WHERE id = ?"
      )
      .bind(status, iso(this.clock()), error, id)
      .run();
  }

  // ------------------------------------------------------------- workspaces

  async workspaceRole(workspaceId: string, userId: string): Promise<Role | null> {
    const row = await this.db
      .prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, userId)
      .first<Row>();
    return row ? (str(row, "role") as Role) : null;
  }

  async listWorkspaces(userId: string): Promise<(WorkspaceRecord & { role: Role })[]> {
    const rows = await this.db
      .prepare(
        `SELECT w.*, m.role FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
         WHERE m.user_id = ?
         ORDER BY w.created_at ASC`
      )
      .bind(userId)
      .all<Row>();
    return rows.map((row) => ({ ...mapWorkspace(row), role: str(row, "role") as Role }));
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .bind(workspaceId)
      .first<Row>();
    return row ? mapWorkspace(row) : null;
  }

  async createWorkspace(input: {
    name: string;
    userId: string;
  }): Promise<WorkspaceRecord & { role: Role }> {
    const base = slugify(input.name, 40) || "workspace";

    // Slug allocation is a read-then-write, which is a race: two sign-ups with the same
    // workspace name both see the slug as free and the second INSERT fails on the unique
    // index. That surfaced as a 500 on sign-up, which is the worst possible place for
    // one — the account exists but the customer sees an error. The fix is to treat the
    // unique constraint as the authority and retry, rather than to trust the read.
    let slug = base;
    let inserted = false;
    for (let attempt = 0; attempt < 50 && !inserted; attempt += 1) {
      slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const workspace: WorkspaceRecord = {
        id: `ws_${uuid().replaceAll("-", "").slice(0, 20)}`,
        name: input.name,
        slug,
        createdAt: iso(this.clock()),
      };
      try {
        await this.db
          .prepare("INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
          .bind(workspace.id, workspace.name, workspace.slug, workspace.createdAt)
          .run();
        inserted = true;
        await this.db
          .prepare(
            "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)"
          )
          .bind(workspace.id, input.userId, "owner", workspace.createdAt)
          .run();
        return { ...workspace, role: "owner" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Only a slug collision is retryable; anything else is a real failure.
        if (!message.includes("UNIQUE constraint failed: workspaces.slug")) throw error;
      }
    }

    throw new ProofCoreError({
      message: `Could not allocate a unique workspace slug from "${input.name}" after 50 attempts`,
      category: "INTERNAL",
      code: "workspace_slug_exhausted",
    });
  }

  async workspaceMemberCount(workspaceId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  async listMembers(
    workspaceId: string
  ): Promise<{ userId: string; name: string; email: string; role: Role; joinedAt: string }[]> {
    const rows = await this.db
      .prepare(
        `SELECT m.user_id, m.role, m.created_at, u.name, u.email
         FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? ORDER BY m.created_at ASC`
      )
      .bind(workspaceId)
      .all<Row>();
    return rows.map((row) => ({
      userId: str(row, "user_id"),
      name: str(row, "name"),
      email: str(row, "email"),
      role: str(row, "role") as Role,
      joinedAt: str(row, "created_at"),
    }));
  }

  /** Adds a user to a workspace. The caller resolved the user and the role guard. */
  // ------------------------------------------------------------ invitations

  /**
   * Invitations are the only way in, and they need the invitee's answer.
   *
   * Returns the new invitation, or `null` when a pending one already exists for that
   * person — the partial unique index is the authority, so two admins clicking "invite"
   * at the same time cannot produce two rows.
   */
  async createInvitation(input: {
    workspaceId: string;
    invitedUserId: string;
    invitedByUserId: string;
    role: Role;
  }): Promise<InvitationRecord | null> {
    const existing = await this.db
      .prepare(
        `SELECT id FROM workspace_invitations
         WHERE workspace_id = ? AND invited_user_id = ? AND status = 'pending'`
      )
      .bind(input.workspaceId, input.invitedUserId)
      .first<Row>();
    if (existing) return null;
    const invitation: InvitationRecord = {
      id: `inv_${uuid().replaceAll("-", "").slice(0, 20)}`,
      workspaceId: input.workspaceId,
      invitedUserId: input.invitedUserId,
      invitedByUserId: input.invitedByUserId,
      role: input.role,
      status: "pending",
      createdAt: iso(this.clock()),
      respondedAt: null,
    };
    await this.db
      .prepare(
        `INSERT INTO workspace_invitations
           (id, workspace_id, invited_user_id, invited_by_user_id, role, status, created_at, responded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .bind(
        invitation.id,
        invitation.workspaceId,
        invitation.invitedUserId,
        invitation.invitedByUserId,
        invitation.role,
        invitation.status,
        invitation.createdAt
      )
      .run();
    return invitation;
  }

  async getInvitation(id: string): Promise<InvitationRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM workspace_invitations WHERE id = ?")
      .bind(id)
      .first<Row>();
    return row ? mapInvitation(row) : null;
  }

  /** What the invitee sees, with the workspace name and who asked. */
  async listInvitationsForUser(
    userId: string
  ): Promise<(InvitationRecord & { workspaceName: string; invitedByName: string })[]> {
    const rows = await this.db
      .prepare(
        `SELECT i.*, w.name AS workspace_name, u.name AS invited_by_name
         FROM workspace_invitations i
         JOIN workspaces w ON w.id = i.workspace_id
         LEFT JOIN users u ON u.id = i.invited_by_user_id
         WHERE i.invited_user_id = ? AND i.status = 'pending'
         ORDER BY i.created_at DESC`
      )
      .bind(userId)
      .all<Row>();
    return rows.map((row) => ({
      ...mapInvitation(row),
      workspaceName: str(row, "workspace_name"),
      invitedByName: nullableStr(row, "invited_by_name") ?? "",
    }));
  }

  /** What an owner or admin sees on the workspace, with the invitee's identity. */
  async listWorkspaceInvitations(
    workspaceId: string
  ): Promise<(InvitationRecord & { email: string; name: string })[]> {
    const rows = await this.db
      .prepare(
        `SELECT i.*, u.email, u.name
         FROM workspace_invitations i JOIN users u ON u.id = i.invited_user_id
         WHERE i.workspace_id = ? AND i.status = 'pending'
         ORDER BY i.created_at DESC`
      )
      .bind(workspaceId)
      .all<Row>();
    return rows.map((row) => ({
      ...mapInvitation(row),
      email: str(row, "email"),
      name: str(row, "name"),
    }));
  }

  async countPendingInvitations(userId: string): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_invitations WHERE invited_user_id = ? AND status = 'pending'"
      )
      .bind(userId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  /**
   * Answer an invitation.
   *
   * The update is conditional on `status = 'pending'`, so two clicks (or two tabs) cannot
   * both succeed: the second one changes zero rows and the route reports `409`. Returns
   * false when nothing changed, which is the honest answer for "already answered",
   * "revoked", or "not yours" — the route maps that to 404/409 without leaking which.
   */
  async respondToInvitation(
    id: string,
    invitedUserId: string,
    status: "accepted" | "declined"
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE workspace_invitations SET status = ?, responded_at = ?
         WHERE id = ? AND invited_user_id = ? AND status = 'pending'`
      )
      .bind(status, iso(this.clock()), id, invitedUserId)
      .run();
    return result.changes > 0;
  }

  async revokeInvitation(workspaceId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE workspace_invitations SET status = 'revoked', responded_at = ?
         WHERE id = ? AND workspace_id = ? AND status = 'pending'`
      )
      .bind(iso(this.clock()), id, workspaceId)
      .run();
    return result.changes > 0;
  }

  async addWorkspaceMember(input: {
    workspaceId: string;
    userId: string;
    role: Role;
  }): Promise<{ userId: string; role: Role; joinedAt: string }> {
    const joinedAt = iso(this.clock());
    await this.db
      .prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)"
      )
      .bind(input.workspaceId, input.userId, input.role, joinedAt)
      .run();
    return { userId: input.userId, role: input.role, joinedAt };
  }

  async workspaceMemberRole(workspaceId: string, userId: string): Promise<Role | null> {
    // Same query as workspaceRole, named for the member-management reads so the
    // intent in callers is not "can this user in" but "what is this member".
    return this.workspaceRole(workspaceId, userId);
  }

  async updateWorkspaceMemberRole(
    workspaceId: string,
    userId: string,
    role: Role
  ): Promise<boolean> {
    const result = await this.db
      .prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?")
      .bind(role, workspaceId, userId)
      .run();
    return result.changes > 0;
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, userId)
      .run();
    return result.changes > 0;
  }

  async ownerCount(workspaceId: string): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ? AND role = 'owner'"
      )
      .bind(workspaceId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  /** Renames a workspace. The slug stays: it is a stable address, not a label. */
  async renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceRecord | null> {
    await this.db
      .prepare("UPDATE workspaces SET name = ? WHERE id = ?")
      .bind(name, workspaceId)
      .run();
    return this.getWorkspace(workspaceId);
  }

  /** Deletes a workspace and every row that hangs off it, explicitly: the
   * schema declares ON DELETE CASCADE, but D1 connections do not enable
   * foreign keys by default — the deletion walks its own tables. */
  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) return false;
    // The db port has no batch; sequential deletes are correct (a failure stops
    // the walk and the workspace row survives — deletion stays all-or-nothing
    // from the caller's point of view because it is retried, not partial-by-silence).
    // Every table here must actually carry workspace_id. `webhook_events` used to be in
    // this list and does not: the first delete threw "no such column", which made every
    // workspace deletion a 500. Those rows are provider-global anyway — removing them
    // would also break replay protection for events we have already processed.
    const tables = [
      "findings",
      "reports",
      "test_runs",
      "api_keys",
      "invoices",
      "payment_intents",
      "subscriptions",
      "usage_events",
      "audit_logs",
      "idempotency_keys",
      "workspace_webhooks",
      "projects",
      "workspace_members",
      // Workspace-scoped content that is not part of the billing walk: leaving it
      // behind would keep conversations and support messages alive after the
      // workspace is gone, which is exactly what "delete" must not do.
      "ai_conversations",
      "browser_sessions",
      "support_messages",
      "workspace_invitations",
      "page_audits",
    ];
    for (const table of tables) {
      await this.db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).bind(workspaceId).run();
    }
    // The workspaces row carries its own id column, not workspace_id.
    await this.db.prepare("DELETE FROM workspaces WHERE id = ?").bind(workspaceId).run();
    return true;
  }

  // ----------------------------------------------------------- page audits

  /**
   * Scans are workspace data: they name the addresses a tenant cared about, so deleting the
   * workspace deletes them (the table is in the deletion walk above).
   */
  async createPageAudit(input: {
    id: string;
    workspaceId: string;
    createdBy: string;
    url: string;
    finalUrl: string;
    status: number;
    durationMs: number;
    worstVerdict: string;
    failed: number;
    warnings: number;
    payload: string;
    ownership: string;
    redacted: boolean;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO page_audits
           (id, workspace_id, created_by, url, final_url, status, duration_ms,
            worst_verdict, failed, warnings, payload, ownership, redacted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        input.id,
        input.workspaceId,
        input.createdBy,
        input.url,
        input.finalUrl,
        input.status,
        input.durationMs,
        input.worstVerdict,
        input.failed,
        input.warnings,
        input.payload,
        input.ownership,
        input.redacted ? 1 : 0,
        iso(this.clock())
      )
      .run();
  }

  async getPageAudit(workspaceId: string, id: string): Promise<Row | null> {
    const row = await this.db
      .prepare("SELECT * FROM page_audits WHERE workspace_id = ? AND id = ?")
      .bind(workspaceId, id)
      .first<Row>();
    return row ?? null;
  }

  async listPageAudits(
    workspaceId: string,
    options: { limit: number; offset: number }
  ): Promise<{ rows: Row[]; total: number }> {
    const total = await this.db
      .prepare("SELECT COUNT(*) AS count FROM page_audits WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<Row>();
    const rows = await this.db
      .prepare(
        `SELECT id, url, final_url, status, duration_ms, worst_verdict, failed, warnings,
                ownership, redacted, created_at
         FROM page_audits WHERE workspace_id = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .bind(workspaceId, options.limit, options.offset)
      .all<Row>();
    return { rows, total: total ? num(total, "count") : 0 };
  }

  // --------------------------------------------------------------- projects

  async createProject(input: {
    workspaceId: string;
    name: string;
    baseUrl: string;
    stack?: string;
    environment: EnvironmentKind;
    enabledModules: ModuleId[];
  }): Promise<ProjectRecord> {
    const now = iso(this.clock());
    const project: ProjectRecord = {
      id: `prj_${uuid().replaceAll("-", "").slice(0, 20)}`,
      workspaceId: input.workspaceId,
      name: input.name,
      baseUrl: input.baseUrl,
      stack: input.stack ?? null,
      environment: input.environment,
      enabledModules: input.enabledModules,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunStatus: null,
    };
    await this.db
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, base_url, stack, environment, enabled_modules,
                               created_at, updated_at, deleted_at, last_run_at, last_run_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
      )
      .bind(
        project.id,
        project.workspaceId,
        project.name,
        project.baseUrl,
        project.stack,
        project.environment,
        json(project.enabledModules),
        project.createdAt,
        project.updatedAt
      )
      .run();
    return project;
  }

  async listProjects(workspaceId: string): Promise<ProjectRecord[]> {
    const rows = await this.db
      .prepare(
        "SELECT * FROM projects WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at ASC"
      )
      .bind(workspaceId)
      .all<Row>();
    return rows.map(mapProject);
  }

  async countActiveProjects(workspaceId: string): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM projects WHERE workspace_id = ? AND deleted_at IS NULL"
      )
      .bind(workspaceId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  /** Scoped read: the workspace is part of the predicate, not a check afterwards. */
  async getProject(workspaceId: string, projectId: string): Promise<ProjectRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
      .bind(projectId, workspaceId)
      .first<Row>();
    return row ? mapProject(row) : null;
  }

  async updateProject(
    workspaceId: string,
    projectId: string,
    patch: {
      name?: string;
      baseUrl?: string;
      stack?: string | null;
      environment?: EnvironmentKind;
      enabledModules?: ModuleId[];
    }
  ): Promise<ProjectRecord | null> {
    const existing = await this.getProject(workspaceId, projectId);
    if (!existing) return null;
    const next: ProjectRecord = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
      ...(patch.stack !== undefined ? { stack: patch.stack } : {}),
      ...(patch.environment !== undefined ? { environment: patch.environment } : {}),
      ...(patch.enabledModules !== undefined ? { enabledModules: patch.enabledModules } : {}),
      updatedAt: iso(this.clock()),
    };
    await this.db
      .prepare(
        `UPDATE projects SET name = ?, base_url = ?, stack = ?, environment = ?, enabled_modules = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(
        next.name,
        next.baseUrl,
        next.stack,
        next.environment,
        json(next.enabledModules),
        next.updatedAt,
        projectId,
        workspaceId
      )
      .run();
    return next;
  }

  async softDeleteProject(workspaceId: string, projectId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL"
      )
      .bind(iso(this.clock()), iso(this.clock()), projectId, workspaceId)
      .run();
    return result.changes > 0;
  }

  async markProjectRun(projectId: string, at: string, status: RunStatus): Promise<void> {
    await this.db
      .prepare(
        "UPDATE projects SET last_run_at = ?, last_run_status = ?, updated_at = ? WHERE id = ?"
      )
      .bind(at, status, at, projectId)
      .run();
  }

  // ------------------------------------------------------------------- runs

  /** Store a run, its report payload and its findings. The run id is the identity. */
  async saveRun(input: {
    run: TestRun;
    projectId: string;
    workspaceId: string;
    totals: Record<string, RunTotals>;
    retainedUntil?: string;
  }): Promise<{ runId: string; reportId: string }> {
    const { run } = input;
    const runId = run.id;
    // Reuse the report of an already-uploaded run: a retry with a fresh idempotency
    // key must replace the stored result, not add a second report to it.
    const existingReport = await this.db
      .prepare("SELECT id FROM reports WHERE run_id = ? AND workspace_id = ?")
      .bind(runId, input.workspaceId)
      .first<Row>();
    const reportId = existingReport
      ? str(existingReport, "id")
      : `rpt_${uuid().replaceAll("-", "").slice(0, 20)}`;
    const createdAt = iso(this.clock());
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO test_runs (id, workspace_id, project_id, status, started_at, ended_at,
                                          duration_ms, environment, revision, totals, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        runId,
        input.workspaceId,
        input.projectId,
        run.status,
        run.startedAt,
        run.endedAt,
        run.durationMs,
        run.environment,
        run.revision ?? null,
        json(input.totals),
        createdAt
      )
      .run();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO reports (id, run_id, workspace_id, project_id, status, payload, created_at, retained_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        reportId,
        runId,
        input.workspaceId,
        input.projectId,
        run.status,
        json(run),
        createdAt,
        input.retainedUntil ?? null
      )
      .run();

    // Findings are extracted from the run so the dashboard can list them without
    // parsing every stored report. The payload remains the source of truth, and the
    // finding id is stable per (run, finding) so a re-upload replaces rather than
    // duplicates.
    for (const finding of run.findings ?? []) {
      await this.db
        .prepare(
          `INSERT OR REPLACE INTO findings (id, report_id, workspace_id, project_id, module, title, severity,
                                            status, code, fingerprint, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          finding.id,
          reportId,
          input.workspaceId,
          input.projectId,
          finding.module,
          finding.title,
          finding.severity,
          finding.status,
          finding.failure?.code ?? null,
          finding.fingerprint,
          finding.endedAt
        )
        .run();
    }
    return { runId, reportId };
  }

  async listRuns(
    workspaceId: string,
    projectId: string,
    limit = 25,
    offset = 0
  ): Promise<RunRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT r.*, rp.id AS report_id FROM test_runs r
         LEFT JOIN reports rp ON rp.run_id = r.id
         WHERE r.workspace_id = ? AND r.project_id = ?
         ORDER BY r.started_at DESC LIMIT ? OFFSET ?`
      )
      .bind(workspaceId, projectId, limit, offset)
      .all<Row>();
    return rows.map(mapRun);
  }

  async countRuns(workspaceId: string, projectId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM test_runs WHERE workspace_id = ? AND project_id = ?")
      .bind(workspaceId, projectId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  async recentRuns(
    workspaceId: string,
    limit = 10,
    offset = 0
  ): Promise<(RunRecord & { projectName: string })[]> {
    const rows = await this.db
      .prepare(
        `SELECT r.*, p.name AS project_name, rp.id AS report_id FROM test_runs r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN reports rp ON rp.run_id = r.id
         WHERE r.workspace_id = ? ORDER BY r.started_at DESC LIMIT ? OFFSET ?`
      )
      .bind(workspaceId, limit, offset)
      .all<Row>();
    return rows.map((row) => ({ ...mapRun(row), projectName: str(row, "project_name") }));
  }

  async countWorkspaceRuns(workspaceId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM test_runs WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  async getReportPayload(workspaceId: string, reportId: string): Promise<TestRun | null> {
    const row = await this.db
      .prepare("SELECT payload FROM reports WHERE id = ? AND workspace_id = ?")
      .bind(reportId, workspaceId)
      .first<Row>();
    if (!row) return null;
    return parseJson<TestRun | null>(row.payload, null);
  }

  /** Resolve a report through the run id the model already knows. */
  async getReportByRunId(workspaceId: string, runId: string): Promise<TestRun | null> {
    const row = await this.db
      .prepare("SELECT payload FROM reports WHERE workspace_id = ? AND run_id = ?")
      .bind(workspaceId, runId)
      .first<Row>();
    if (!row) return null;
    return parseJson<TestRun | null>(row.payload, null);
  }

  async listReports(workspaceId: string, projectId: string, limit = 25) {
    const rows = await this.db
      .prepare(
        `SELECT id, run_id, status, created_at, retained_until FROM reports
         WHERE workspace_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .bind(workspaceId, projectId, limit)
      .all<Row>();
    return rows.map((row) => ({
      id: str(row, "id"),
      runId: str(row, "run_id"),
      status: str(row, "status") as RunStatus,
      createdAt: str(row, "created_at"),
      retainedUntil: nullableStr(row, "retained_until"),
    }));
  }

  async recentFindings(workspaceId: string, limit = 8): Promise<FindingRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM findings WHERE workspace_id = ? AND status = 'FAILED'
         ORDER BY detected_at DESC LIMIT ?`
      )
      .bind(workspaceId, limit)
      .all<Row>();
    return rows.map(mapFinding);
  } /** Findings across every project of a workspace, optionally for one module. */
  async workspaceFindings(
    workspaceId: string,
    module?: ModuleId,
    limit = 100,
    offset = 0
  ): Promise<FindingRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM findings WHERE workspace_id = ? AND (? IS NULL OR module = ?)
         ORDER BY detected_at DESC LIMIT ? OFFSET ?`
      )
      .bind(workspaceId, module ?? null, module ?? null, limit, offset)
      .all<Row>();
    return rows.map(mapFinding);
  }

  async countWorkspaceFindings(workspaceId: string, module?: ModuleId): Promise<number> {
    const row = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM findings WHERE workspace_id = ? AND (? IS NULL OR module = ?)"
      )
      .bind(workspaceId, module ?? null, module ?? null)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  /** Aggregated evolution data: runs per day, severity mix, module pass rates. */
  async workspaceInsights(
    workspaceId: string,
    days = 30
  ): Promise<{
    runsPerDay: { day: string; total: number; passed: number; failed: number }[];
    severityCounts: { severity: string; count: number }[];
    moduleTotals: {
      module: string;
      passed: number;
      failed: number;
      warnings: number;
      total: number;
    }[];
    since: string;
  }> {
    const since = new Date(this.clock().getTime() - days * 86_400_000).toISOString();
    const runRows = await this.db
      .prepare(
        `SELECT started_at, status, totals FROM test_runs
         WHERE workspace_id = ? AND started_at >= ? ORDER BY started_at ASC LIMIT 1000`
      )
      .bind(workspaceId, since)
      .all<Row>();
    const byDay = new Map<string, { total: number; passed: number; failed: number }>();
    for (const row of runRows) {
      const day = str(row, "started_at").slice(0, 10);
      const entry = byDay.get(day) ?? { total: 0, passed: 0, failed: 0 };
      entry.total += 1;
      const parsed = parseJson<Record<string, { passed?: number; failed?: number }>>(
        str(row, "totals"),
        {}
      );
      for (const totals of Object.values(parsed)) {
        entry.passed += totals.passed ?? 0;
        entry.failed += totals.failed ?? 0;
      }
      byDay.set(day, entry);
    }

    const severityRows = await this.db
      .prepare(
        `SELECT severity, COUNT(*) AS n FROM findings
         WHERE workspace_id = ? AND status = 'FAILED' AND detected_at >= ?
         GROUP BY severity`
      )
      .bind(workspaceId, since)
      .all<Row>();
    const severityCounts = severityRows.map((row) => ({
      severity: str(row, "severity"),
      count: num(row, "n"),
    }));

    const moduleRows = await this.db
      .prepare(`SELECT totals FROM test_runs WHERE workspace_id = ? AND started_at >= ? LIMIT 1000`)
      .bind(workspaceId, since)
      .all<Row>();
    const moduleMap = new Map<
      string,
      { passed: number; failed: number; warnings: number; total: number }
    >();
    for (const row of moduleRows) {
      const parsed = parseJson<
        Record<string, { passed?: number; failed?: number; warnings?: number; total?: number }>
      >(str(row, "totals"), {});
      for (const [moduleName, totals] of Object.entries(parsed)) {
        const entry = moduleMap.get(moduleName) ?? { passed: 0, failed: 0, warnings: 0, total: 0 };
        entry.passed += totals.passed ?? 0;
        entry.failed += totals.failed ?? 0;
        entry.warnings += totals.warnings ?? 0;
        entry.total += totals.total ?? 0;
        moduleMap.set(moduleName, entry);
      }
    }

    return {
      runsPerDay: [...byDay.entries()].map(([day, entry]) => ({ day, ...entry })),
      severityCounts,
      moduleTotals: [...moduleMap.entries()].map(([module, entry]) => ({ module, ...entry })),
      since,
    };
  }

  async listFindings(
    workspaceId: string,
    projectId: string,
    limit = 100,
    offset = 0
  ): Promise<FindingRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM findings WHERE workspace_id = ? AND project_id = ?
         ORDER BY detected_at DESC LIMIT ? OFFSET ?`
      )
      .bind(workspaceId, projectId, limit, offset)
      .all<Row>();
    return rows.map(mapFinding);
  }

  async countFindings(workspaceId: string, projectId: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM findings WHERE workspace_id = ? AND project_id = ?")
      .bind(workspaceId, projectId)
      .first<Row>();
    return row ? num(row, "count") : 0;
  }

  // --------------------------------------------------------------- api keys

  async createApiKey(input: {
    workspaceId: string;
    projectId?: string;
    label: string;
    prefix: string;
    tokenHash: string;
    scopes: string[];
    expiresAt?: string;
  }): Promise<ApiKeyRecord> {
    const record: ApiKeyRecord = {
      id: `key_${uuid().replaceAll("-", "").slice(0, 20)}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      label: input.label,
      prefix: input.prefix,
      tokenHash: input.tokenHash,
      scopes: input.scopes,
      createdAt: iso(this.clock()),
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: input.expiresAt ?? null,
    };
    await this.db
      .prepare(
        `INSERT INTO api_keys (id, workspace_id, project_id, label, prefix, token_hash, scopes,
                               created_at, last_used_at, revoked_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
      )
      .bind(
        record.id,
        record.workspaceId,
        record.projectId,
        record.label,
        record.prefix,
        record.tokenHash,
        json(record.scopes),
        record.createdAt,
        record.expiresAt
      )
      .run();
    return record;
  }

  async findApiKeyByTokenHash(tokenHash: string): Promise<ApiKeyRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM api_keys WHERE token_hash = ?")
      .bind(tokenHash)
      .first<Row>();
    if (!row) return null;
    const key = mapApiKey(row);
    if (key.revokedAt || key.tokenHash !== tokenHash) return null;
    if (key.expiresAt && key.expiresAt <= iso(this.clock())) return null;
    return key;
  }

  async touchApiKey(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .bind(iso(this.clock()), id)
      .run();
  }

  async listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]> {
    const rows = await this.db
      .prepare("SELECT * FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC")
      .bind(workspaceId)
      .all<Row>();
    return rows.map(mapApiKey);
  }

  async revokeApiKey(workspaceId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL"
      )
      .bind(iso(this.clock()), id, workspaceId)
      .run();
    return result.changes > 0;
  }

  // ------------------------------------------------------------ idempotency

  async getIdempotentResponse(
    workspaceId: string,
    scope: string,
    key: string
  ): Promise<unknown | null> {
    const row = await this.db
      .prepare(
        "SELECT response FROM idempotency_keys WHERE workspace_id = ? AND scope = ? AND key = ?"
      )
      .bind(workspaceId, scope, key)
      .first<Row>();
    return row ? parseJson<unknown>(row.response, null) : null;
  }

  async saveIdempotentResponse(
    workspaceId: string,
    scope: string,
    key: string,
    response: unknown
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys (key, workspace_id, scope, response, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(key, workspaceId, scope, json(response), iso(this.clock()))
      .run();
  }

  // ------------------------------------------------------------------ audit

  async appendAudit(entry: {
    workspaceId: string;
    actor: string;
    action: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO audit_logs (id, workspace_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        uuid(),
        entry.workspaceId,
        entry.actor,
        entry.action,
        json(entry.detail),
        iso(this.clock())
      )
      .run();
  }
}

// -------------------------------------------------------------------- mappers

function mapUser(row: Row): UserRecord {
  return {
    id: str(row, "id"),
    email: str(row, "email"),
    emailNormalized: str(row, "email_normalized"),
    name: str(row, "name"),
    passwordHash: str(row, "password_hash"),
    createdAt: str(row, "created_at"),
    emailVerifiedAt: nullableStr(row, "email_verified_at"),
  };
}

function mapWorkspaceMemory(row: Row): WorkspaceMemoryRecord {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    kind: str(row, "kind"),
    text: str(row, "text"),
    source: str(row, "source"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function mapAiConversation(row: Row): AiConversationRecord {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    workspaceId: str(row, "workspace_id"),
    title: str(row, "title"),
    effort: str(row, "effort"),
    messages: parseJson<unknown[]>(str(row, "messages"), []),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function mapWorkspaceWebhook(row: Row): WorkspaceWebhookRecord {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    url: str(row, "url"),
    secret: str(row, "secret"),
    secretPrefix: str(row, "secret_prefix"),
    events: str(row, "events").split(",").filter(Boolean),
    disabled: Number(row.disabled) === 1,
    createdAt: str(row, "created_at"),
    lastStatus: typeof row.last_status === "number" ? row.last_status : null,
    lastStatusAt: nullableStr(row, "last_status_at"),
    lastError: nullableStr(row, "last_error"),
  };
}

function mapInvitation(row: Row): InvitationRecord {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    invitedUserId: str(row, "invited_user_id"),
    invitedByUserId: str(row, "invited_by_user_id"),
    role: str(row, "role") as Role,
    status: str(row, "status") as InvitationRecord["status"],
    createdAt: str(row, "created_at"),
    respondedAt: nullableStr(row, "responded_at"),
  };
}

function mapSession(row: Row): SessionRecord {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    tokenHash: str(row, "token_hash"),
    createdAt: str(row, "created_at"),
    expiresAt: str(row, "expires_at"),
    lastSeenAt: nullableStr(row, "last_seen_at"),
    userAgent: nullableStr(row, "user_agent"),
    ip: nullableStr(row, "ip"),
  };
}

function mapDeviceGrant(row: Row): DeviceGrantRecord {
  return {
    id: str(row, "id"),
    deviceCodeHash: str(row, "device_code_hash"),
    userCode: str(row, "user_code"),
    status: str(row, "status") as DeviceGrantRecord["status"],
    userId: nullableStr(row, "user_id"),
    createdAt: str(row, "created_at"),
    expiresAt: str(row, "expires_at"),
    decidedAt: nullableStr(row, "decided_at"),
    consumedAt: nullableStr(row, "consumed_at"),
    pollCount: typeof row.poll_count === "number" ? row.poll_count : 0,
    clientName: nullableStr(row, "client_name"),
    ip: nullableStr(row, "ip"),
  };
}

export function mapWorkspace(row: Row): WorkspaceRecord {
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    slug: str(row, "slug"),
    createdAt: str(row, "created_at"),
  };
}

function mapProject(row: Row): ProjectRecord {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    name: str(row, "name"),
    baseUrl: str(row, "base_url"),
    stack: nullableStr(row, "stack"),
    environment: str(row, "environment") as EnvironmentKind,
    enabledModules: parseJson<ModuleId[]>(row.enabled_modules, []),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
    lastRunAt: nullableStr(row, "last_run_at"),
    lastRunStatus: (nullableStr(row, "last_run_status") as RunStatus | null) ?? null,
  };
}

function mapRun(row: Row): RunRecord {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    projectId: str(row, "project_id"),
    status: str(row, "status") as RunStatus,
    startedAt: str(row, "started_at"),
    endedAt: str(row, "ended_at"),
    durationMs: num(row, "duration_ms"),
    environment: str(row, "environment") as EnvironmentKind,
    revision: nullableStr(row, "revision"),
    totals: parseJson<Record<string, RunTotals>>(row.totals, {}),
    createdAt: str(row, "created_at"),
    reportId: nullableStr(row, "report_id"),
  };
}

function mapFinding(row: Row): FindingRecord {
  return {
    id: str(row, "id"),
    reportId: str(row, "report_id"),
    projectId: str(row, "project_id"),
    module: str(row, "module") as ModuleId,
    title: str(row, "title"),
    severity: str(row, "severity") as Severity,
    status: str(row, "status") as TestStatus,
    code: nullableStr(row, "code"),
    fingerprint: nullableStr(row, "fingerprint"),
    detectedAt: str(row, "detected_at"),
  };
}

function mapApiKey(row: Row): ApiKeyRecord {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    projectId: nullableStr(row, "project_id"),
    label: str(row, "label"),
    prefix: str(row, "prefix"),
    tokenHash: str(row, "token_hash"),
    scopes: parseJson<string[]>(row.scopes, []),
    createdAt: str(row, "created_at"),
    lastUsedAt: nullableStr(row, "last_used_at"),
    revokedAt: nullableStr(row, "revoked_at"),
    expiresAt: nullableStr(row, "expires_at"),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|constraint failed: users\.email_normalized/i.test(
    message
  );
}

export { bool };
