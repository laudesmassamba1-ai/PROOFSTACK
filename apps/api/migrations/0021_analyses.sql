-- The canonical Analysis resource.
--
-- Until now a scan lived in `page_audits`, a module run in `test_runs`, and an AI tool call
-- left nothing behind. They were three separate truths with no common identity, so the app
-- could not answer "show me everything I ran on this project" without guessing. This table
-- is the identity: one row per execution, whichever surface started it, linked to whatever
-- it produced. The old tables keep their payloads (no data is moved or rewritten); they gain
-- a nullable `analysis_id`, so an existing scan is linked instead of copied.

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Nullable: a one-off page scan need not belong to a project.
  project_id TEXT,
  created_by TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('WEB', 'CLI', 'AI', 'DESKTOP', 'API')),
  target_type TEXT NOT NULL CHECK (
    target_type IN ('PAGE', 'SITE', 'API', 'PROJECT', 'WORKFLOW', 'LOCAL_ENVIRONMENT')
  ),
  -- The address, the repository, the workflow id: whatever the caller analysed.
  target TEXT NOT NULL,
  scope TEXT NOT NULL,
  -- JSON arrays. `requested` is the ask; `applicable` is what the registry says can run,
  -- so "we skipped FAIL because this target has no HTTP surface" is recorded, not implied.
  requested_modules TEXT NOT NULL,
  applicable_modules TEXT NOT NULL,
  engine TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')
  ),
  -- JSON: which modules actually measured something, which were skipped and why, and how
  -- many pages were discovered versus read. A partial run must stay visibly partial.
  coverage TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  -- JSON summary of the outcome (counts per verdict); the full payload stays in the
  -- linked page_audit/report so there is exactly one copy of the evidence.
  result TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  report_id TEXT,
  page_audit_id TEXT,
  run_id TEXT,
  -- Correlation across the web app, the CLI and the AI for one user gesture.
  correlation_id TEXT NOT NULL,
  -- A retried POST with the same key returns the first analysis instead of creating a second.
  idempotency_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_workspace
  ON analyses(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_project
  ON analyses(workspace_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_status
  ON analyses(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_correlation ON analyses(correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analyses_idempotency
  ON analyses(workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Back-references so an old screen keeps working while the canonical list grows.
ALTER TABLE page_audits ADD COLUMN analysis_id TEXT;
ALTER TABLE test_runs ADD COLUMN analysis_id TEXT;

CREATE INDEX IF NOT EXISTS idx_page_audits_analysis ON page_audits(analysis_id);
CREATE INDEX IF NOT EXISTS idx_runs_analysis ON test_runs(analysis_id);
