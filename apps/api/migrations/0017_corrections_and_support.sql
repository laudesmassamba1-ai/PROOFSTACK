-- Correction tracking for scans.
--
-- A finding key is `module:id` inside a stored scan payload. It is stable across scans of
-- the same site, which is what makes "still present" or "disappeared" comparable without
-- inventing a second identity for a finding. States are an operator's workflow, not a
-- verdict: only a re-scan can say whether the site changed.
--
-- Scoped to (workspace, project) so a project id from another tenant can never read or
-- overwrite a state, and deleting a project deletes its tracking rows with it.

CREATE TABLE IF NOT EXISTS audit_finding_states (
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('todo', 'in_progress', 'fixed', 'verify')),
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, project_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_audit_finding_states_project
  ON audit_finding_states(workspace_id, project_id, updated_at DESC);

-- Support conversations were write-only: a customer got a reference and could never see
-- what happened next. The reply is stored with the message so the reference plus the
-- address that wrote it is enough to read the answer; `updated_at` records the last change.
ALTER TABLE support_messages ADD COLUMN reply_body TEXT;
ALTER TABLE support_messages ADD COLUMN replied_at TEXT;
ALTER TABLE support_messages ADD COLUMN updated_at TEXT;
