-- Remediations: a finding, its fix, and the proof that the fix worked.
--
-- The chain of ten steps is stored as JSON because it is read as a whole and never
-- queried by step; the verification points at another analysis so "verified" always has
-- a re-measurement behind it.
CREATE TABLE IF NOT EXISTS remediations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  analysis_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  module TEXT NOT NULL,
  control_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  severity TEXT NOT NULL,
  priority TEXT NOT NULL,
  cause TEXT NOT NULL DEFAULT '',
  owner_id TEXT,
  due_at TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  fix TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT '',
  proof TEXT NOT NULL DEFAULT '',
  verification_analysis_id TEXT,
  verification_outcome TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT,
  verified_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_remediations_finding
  ON remediations(workspace_id, analysis_id, finding_key);
CREATE INDEX IF NOT EXISTS idx_remediations_workspace
  ON remediations(workspace_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_remediations_owner
  ON remediations(workspace_id, owner_id, status);
