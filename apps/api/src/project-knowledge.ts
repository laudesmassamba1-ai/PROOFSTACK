import { neon } from "@neondatabase/serverless";
import { uuid } from "@proofcore/core";

/**
 * Project intelligence storage (Neon Postgres).
 *
 * D1 remains the system of record for identity, billing and test runs. This store owns
 * only the material a person explicitly imports for an AI code audit: sources, text
 * files and the audit results. Keeping it separate avoids a risky rewrite of the whole
 * tenant database while still giving file/project audits a real relational home.
 *
 * The transport is Neon's HTTP driver, which runs in Workers and Node without a socket
 * pool. Every query is parameterised; no file path or file content is interpolated into
 * SQL text.
 */

export interface ProjectFileInput {
  path: string;
  content: string;
  language?: string;
}

export interface ProjectSourceRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  kind: "folder" | "repo";
  ref: string | null;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileRecord {
  id: string;
  path: string;
  language: string | null;
  size: number;
  sha256: string;
}

export interface ProjectAuditFinding {
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line?: number | null;
  title: string;
  evidence: string;
  fix: string;
}

export interface ProjectAuditFileResult {
  path: string;
  score: number | null;
  summary: string | null;
  status: "done" | "failed";
  findings: ProjectAuditFinding[];
  error: string | null;
  /** True when the file exceeded the per-file limit and was not sent to the model. */
  oversized: boolean;
}

export interface ProjectAiAuditRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  sourceId: string | null;
  scope: string;
  mode: "file" | "folder" | "project";
  status: "done" | "failed";
  score: number | null;
  summary: string | null;
  model: string | null;
  provider: string | null;
  filesAnalyzed: number;
  findings: ProjectAuditFinding[];
  /** One row per file actually sent to the provider, including its own score. */
  files: ProjectAuditFileResult[];
  error: string | null;
  createdAt: string;
}

export interface ProjectIntelligenceMetrics {
  sources: number;
  files: number;
  audits: number;
  averageScore: number | null;
  findingsBySeverity: { severity: string; count: number }[];
  scoreTrend: { id: string; createdAt: string; score: number; scope: string }[];
}

export interface ProjectKnowledge {
  readonly configured: true;
  /** One round trip, so /health can say whether this store answers. */
  ping(): Promise<boolean>;
  createSource(input: {
    workspaceId: string;
    projectId: string;
    name: string;
    kind: "folder" | "repo";
    ref?: string | null;
    files: { path: string; content: string; language: string | null; sha256: string }[];
  }): Promise<ProjectSourceRecord>;
  listSources(workspaceId: string, projectId: string): Promise<ProjectSourceRecord[]>;
  deleteSource(workspaceId: string, projectId: string, sourceId: string): Promise<boolean>;
  listFiles(workspaceId: string, projectId: string, sourceId: string): Promise<ProjectFileRecord[]>;
  readFile(
    workspaceId: string,
    projectId: string,
    sourceId: string,
    path: string
  ): Promise<{ path: string; content: string } | null>;
  readFiles(
    workspaceId: string,
    projectId: string,
    sourceId: string
  ): Promise<{ path: string; content: string }[]>;
  createAudit(input: {
    workspaceId: string;
    projectId: string;
    sourceId: string | null;
    scope: string;
    mode: "file" | "folder" | "project";
    status: "done" | "failed";
    score?: number | null;
    summary?: string | null;
    model?: string | null;
    provider?: string | null;
    filesAnalyzed: number;
    findings?: ProjectAuditFinding[];
    files?: ProjectAuditFileResult[];
    error?: string | null;
  }): Promise<ProjectAiAuditRecord>;
  listAudits(
    workspaceId: string,
    projectId: string,
    limit?: number
  ): Promise<ProjectAiAuditRecord[]>;
  metrics(workspaceId: string, projectId: string): Promise<ProjectIntelligenceMetrics>;
}

type Row = Record<string, unknown>;

const str = (row: Row, key: string): string => {
  const value = row[key];
  // The Neon driver returns timestamptz as Date on Node and as an ISO string over HTTP.
  // Normalise both so the API shape never depends on the transport.
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
};
const nullable = (row: Row, key: string): string | null => {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
};
const number = (row: Row, key: string): number => Number(row[key] ?? 0);

function sourceFrom(row: Row): ProjectSourceRecord {
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    projectId: str(row, "project_id"),
    name: str(row, "name"),
    kind: str(row, "kind") === "repo" ? "repo" : "folder",
    ref: nullable(row, "ref"),
    fileCount: number(row, "file_count"),
    createdAt: str(row, "created_at"),
    updatedAt: str(row, "updated_at"),
  };
}

function fileFrom(row: Row): ProjectAuditFileResult {
  return {
    path: str(row, "path"),
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    summary: nullable(row, "summary"),
    status: str(row, "status") === "failed" ? "failed" : "done",
    findings: Array.isArray(row.findings) ? (row.findings as ProjectAuditFinding[]) : [],
    error: nullable(row, "error"),
    oversized: row.oversized === true,
  };
}

function auditFrom(row: Row): ProjectAiAuditRecord {
  const findings = Array.isArray(row.findings) ? row.findings : [];
  return {
    id: str(row, "id"),
    workspaceId: str(row, "workspace_id"),
    projectId: str(row, "project_id"),
    sourceId: nullable(row, "source_id"),
    scope: str(row, "scope"),
    mode:
      str(row, "mode") === "file" ? "file" : str(row, "mode") === "folder" ? "folder" : "project",
    status: str(row, "status") === "failed" ? "failed" : "done",
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    summary: nullable(row, "summary"),
    model: nullable(row, "model"),
    provider: nullable(row, "provider"),
    filesAnalyzed: number(row, "files_analyzed"),
    findings: findings as ProjectAuditFinding[],
    files: [],
    error: nullable(row, "error"),
    createdAt: str(row, "created_at"),
  };
}

export function createProjectKnowledge(databaseUrl: string | undefined): ProjectKnowledge | null {
  const url = databaseUrl?.trim();
  if (!url) return null;
  const sql = neon(url);

  return {
    configured: true,

    async ping() {
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },

    async createSource(input) {
      const id = `src_${uuid().replaceAll("-", "").slice(0, 20)}`;
      const source = await sql`
        insert into pc_project_sources
          (id, workspace_id, project_id, name, kind, ref, file_count)
        values
          (${id}, ${input.workspaceId}, ${input.projectId}, ${input.name}, ${input.kind},
           ${input.ref ?? null}, ${input.files.length})
        returning *`;
      const row = source[0];
      if (!row) throw new Error("Neon did not return the created source");

      if (input.files.length > 0) {
        // One multi-row insert keeps a 250-file import to one round trip. Values are
        // parameters, never textual SQL, and the unique (source_id, path) constraint
        // turns a duplicate browser folder into a clear database error.
        const tuples: string[] = [];
        const params: unknown[] = [];
        input.files.forEach((file, index) => {
          const base = index * 9;
          tuples.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
              `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
          );
          params.push(
            `fil_${uuid().replaceAll("-", "").slice(0, 20)}`,
            id,
            input.workspaceId,
            input.projectId,
            file.path,
            file.language,
            file.content.length,
            file.sha256,
            file.content
          );
        });
        await sql.query(
          `insert into pc_project_files
             (id, source_id, workspace_id, project_id, path, language, size, sha256, content)
           values ${tuples.join(", ")}`,
          params
        );
      }

      return sourceFrom(row);
    },

    async listSources(workspaceId, projectId) {
      const rows = await sql`
        select * from pc_project_sources
        where workspace_id = ${workspaceId} and project_id = ${projectId}
        order by created_at desc`;
      return rows.map((row) => sourceFrom(row));
    },

    async deleteSource(workspaceId, projectId, sourceId) {
      const rows = await sql`
        delete from pc_project_sources
        where id = ${sourceId} and workspace_id = ${workspaceId} and project_id = ${projectId}
        returning id`;
      return rows.length > 0;
    },

    async listFiles(workspaceId, projectId, sourceId) {
      const rows = await sql`
        select id, path, language, size, sha256 from pc_project_files
        where workspace_id = ${workspaceId} and project_id = ${projectId} and source_id = ${sourceId}
        order by path`;
      return rows.map((row) => ({
        id: str(row, "id"),
        path: str(row, "path"),
        language: nullable(row, "language"),
        size: number(row, "size"),
        sha256: str(row, "sha256"),
      }));
    },

    async readFile(workspaceId, projectId, sourceId, path) {
      const rows = await sql`
        select path, content from pc_project_files
        where workspace_id = ${workspaceId} and project_id = ${projectId}
          and source_id = ${sourceId} and path = ${path}
        limit 1`;
      const row = rows[0];
      return row ? { path: str(row, "path"), content: str(row, "content") } : null;
    },

    async readFiles(workspaceId, projectId, sourceId) {
      const rows = await sql`
        select path, content from pc_project_files
        where workspace_id = ${workspaceId} and project_id = ${projectId} and source_id = ${sourceId}
        order by path`;
      return rows.map((row) => ({ path: str(row, "path"), content: str(row, "content") }));
    },

    async createAudit(input) {
      const id = `aia_${uuid().replaceAll("-", "").slice(0, 20)}`;
      const rows = await sql`
        insert into pc_ai_audits
          (id, workspace_id, project_id, source_id, scope, mode, status, score, summary,
           model, provider, files_analyzed, findings, error)
        values
          (${id}, ${input.workspaceId}, ${input.projectId}, ${input.sourceId},
           ${input.scope}, ${input.mode}, ${input.status}, ${input.score ?? null},
           ${input.summary ?? null}, ${input.model ?? null}, ${input.provider ?? null},
           ${input.filesAnalyzed}, ${JSON.stringify(input.findings ?? [])}::jsonb,
           ${input.error ?? null})
        returning *`;
      const row = rows[0];
      if (!row) throw new Error("Neon did not return the created audit");
      const files = input.files ?? [];
      if (files.length > 0) {
        const tuples: string[] = [];
        const params: unknown[] = [];
        files.forEach((file, index) => {
          const base = index * 11;
          tuples.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
              `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`
          );
          params.push(
            `fia_${uuid().replaceAll("-", "").slice(0, 20)}`,
            id,
            input.workspaceId,
            input.projectId,
            file.path,
            file.score,
            file.summary,
            file.status,
            JSON.stringify(file.findings),
            file.error,
            file.oversized
          );
        });
        await sql.query(
          `insert into pc_ai_audit_files
             (id, audit_id, workspace_id, project_id, path, score, summary, status,
              findings, error, oversized)
           values ${tuples.join(", ")}`,
          params
        );
      }
      return { ...auditFrom(row), files };
    },

    async listAudits(workspaceId, projectId, limit = 20) {
      const rows = await sql`
        select * from pc_ai_audits
        where workspace_id = ${workspaceId} and project_id = ${projectId}
        order by created_at desc
        limit ${Math.min(100, Math.max(1, limit))}`;
      const audits = rows.map((row) => auditFrom(row));
      if (audits.length === 0) return audits;
      const fileRows = await sql`
        select * from pc_ai_audit_files
        where workspace_id = ${workspaceId} and project_id = ${projectId}
        order by created_at, path`;
      const filesByAudit = new Map<string, ProjectAuditFileResult[]>();
      for (const row of fileRows) {
        const auditId = str(row, "audit_id");
        const list = filesByAudit.get(auditId) ?? [];
        list.push(fileFrom(row));
        filesByAudit.set(auditId, list);
      }
      return audits.map((audit) => ({ ...audit, files: filesByAudit.get(audit.id) ?? [] }));
    },

    async metrics(workspaceId, projectId) {
      const [countsRows, severityRows, trendRows] = await Promise.all([
        sql`
          select
            (select count(*) from pc_project_sources
             where workspace_id = ${workspaceId} and project_id = ${projectId}) as sources,
            (select count(*) from pc_project_files
             where workspace_id = ${workspaceId} and project_id = ${projectId}) as files,
            (select count(*) from pc_ai_audits
             where workspace_id = ${workspaceId} and project_id = ${projectId}) as audits,
            (select round(avg(score)) from pc_ai_audits
             where workspace_id = ${workspaceId} and project_id = ${projectId}
               and status = 'done' and score is not null) as average_score`,
        sql`
          select coalesce(finding->>'severity', 'unknown') as severity, count(*)::int as count
          from pc_ai_audits, jsonb_array_elements(findings) as finding
          where workspace_id = ${workspaceId} and project_id = ${projectId}
          group by 1 order by 2 desc`,
        sql`
          select id, created_at, score, scope from pc_ai_audits
          where workspace_id = ${workspaceId} and project_id = ${projectId}
            and status = 'done' and score is not null
          order by created_at asc limit 30`,
      ]);
      const counts = countsRows[0] ?? {};
      return {
        sources: number(counts, "sources"),
        files: number(counts, "files"),
        audits: number(counts, "audits"),
        averageScore:
          counts.average_score === null || counts.average_score === undefined
            ? null
            : Number(counts.average_score),
        findingsBySeverity: severityRows.map((row) => ({
          severity: str(row, "severity"),
          count: number(row, "count"),
        })),
        scoreTrend: trendRows.map((row) => ({
          id: str(row, "id"),
          createdAt: str(row, "created_at"),
          score: number(row, "score"),
          scope: str(row, "scope"),
        })),
      };
    },
  };
}
