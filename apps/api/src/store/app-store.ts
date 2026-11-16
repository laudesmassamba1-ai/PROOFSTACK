import type {
  EnvironmentKind,
  ModuleId,
  RunStatus,
  Severity,
  TestRun,
  TestStatus,
} from "@proofstack/contracts";
import { iso, ProofstackError, slugify, uuid } from "@proofstack/core";
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

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
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
        throw new ProofstackError({
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
    let slug = base;
    for (let attempt = 1; attempt < 50; attempt += 1) {
      const taken = await this.db
        .prepare("SELECT 1 FROM workspaces WHERE slug = ?")
        .bind(slug)
        .first<Row>();
      if (!taken) break;
      slug = `${base}-${attempt + 1}`;
    }
    const workspace: WorkspaceRecord = {
      id: `ws_${uuid().replaceAll("-", "").slice(0, 20)}`,
      name: input.name,
      slug,
      createdAt: iso(this.clock()),
    };
    await this.db
      .prepare("INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
      .bind(workspace.id, workspace.name, workspace.slug, workspace.createdAt)
      .run();
    await this.db
      .prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)"
      )
      .bind(workspace.id, input.userId, "owner", workspace.createdAt)
      .run();
    return { ...workspace, role: "owner" };
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

  async listRuns(workspaceId: string, projectId: string, limit = 25): Promise<RunRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT r.*, rp.id AS report_id FROM test_runs r
         LEFT JOIN reports rp ON rp.run_id = r.id
         WHERE r.workspace_id = ? AND r.project_id = ?
         ORDER BY r.started_at DESC LIMIT ?`
      )
      .bind(workspaceId, projectId, limit)
      .all<Row>();
    return rows.map(mapRun);
  }

  async recentRuns(
    workspaceId: string,
    limit = 10
  ): Promise<(RunRecord & { projectName: string })[]> {
    const rows = await this.db
      .prepare(
        `SELECT r.*, p.name AS project_name, rp.id AS report_id FROM test_runs r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN reports rp ON rp.run_id = r.id
         WHERE r.workspace_id = ? ORDER BY r.started_at DESC LIMIT ?`
      )
      .bind(workspaceId, limit)
      .all<Row>();
    return rows.map((row) => ({ ...mapRun(row), projectName: str(row, "project_name") }));
  }

  async getReportPayload(workspaceId: string, reportId: string): Promise<TestRun | null> {
    const row = await this.db
      .prepare("SELECT payload FROM reports WHERE id = ? AND workspace_id = ?")
      .bind(reportId, workspaceId)
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
    limit = 100
  ): Promise<FindingRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM findings WHERE workspace_id = ? AND (? IS NULL OR module = ?)
         ORDER BY detected_at DESC LIMIT ?`
      )
      .bind(workspaceId, module ?? null, module ?? null, limit)
      .all<Row>();
    return rows.map(mapFinding);
  }

  async listFindings(
    workspaceId: string,
    projectId: string,
    limit = 100
  ): Promise<FindingRecord[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM findings WHERE workspace_id = ? AND project_id = ?
         ORDER BY detected_at DESC LIMIT ?`
      )
      .bind(workspaceId, projectId, limit)
      .all<Row>();
    return rows.map(mapFinding);
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

function mapSession(row: Row): SessionRecord {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    tokenHash: str(row, "token_hash"),
    createdAt: str(row, "created_at"),
    expiresAt: str(row, "expires_at"),
    lastSeenAt: nullableStr(row, "last_seen_at"),
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
