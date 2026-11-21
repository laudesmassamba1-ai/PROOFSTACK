-- PROOFCORE project intelligence store.
--
-- Authentication, billing and run history stay in D1. This database owns the
-- repository-like material a person explicitly uploads for an AI audit: sources,
-- text files and audit results. Every row carries the workspace and project so a
-- tenant boundary is explicit even though this database has no RLS.
--
-- Apply with:
--   psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/neon/schema.sql

create table if not exists pc_project_sources (
  id text primary key,
  workspace_id text not null,
  project_id text not null,
  name text not null,
  kind text not null check (kind in ('folder', 'repo')),
  ref text,
  file_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pc_project_sources_project_idx
  on pc_project_sources (workspace_id, project_id, created_at desc);

create table if not exists pc_project_files (
  id text primary key,
  source_id text not null references pc_project_sources(id) on delete cascade,
  workspace_id text not null,
  project_id text not null,
  path text not null,
  language text,
  size integer not null,
  sha256 text not null,
  content text not null,
  created_at timestamptz not null default now(),
  unique (source_id, path)
);

create index if not exists pc_project_files_source_idx
  on pc_project_files (source_id, path);

create table if not exists pc_ai_audits (
  id text primary key,
  workspace_id text not null,
  project_id text not null,
  source_id text references pc_project_sources(id) on delete set null,
  scope text not null,
  mode text not null check (mode in ('file', 'folder', 'project')),
  status text not null check (status in ('done', 'failed')),
  score integer,
  summary text,
  model text,
  provider text,
  files_analyzed integer not null default 0,
  findings jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists pc_ai_audits_project_idx
  on pc_ai_audits (workspace_id, project_id, created_at desc);
