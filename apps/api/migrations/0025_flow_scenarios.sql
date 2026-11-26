-- FLOW scenarios, saved once and run on demand.
--
-- A scenario used to live only in a form field: closing the tab lost it, and a run left no
-- trace beyond a log line. The steps are stored as the validated JSON the runner consumes
-- (no second schema), and the last report is kept beside them so a scenario shows what its
-- last run actually observed. A run is also recorded as an Analysis; this row is the
-- reusable definition, not the execution history.
CREATE TABLE IF NOT EXISTS flow_scenarios (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  name TEXT NOT NULL,
  target TEXT NOT NULL,
  steps TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  last_report TEXT
);

CREATE INDEX IF NOT EXISTS idx_flow_scenarios_workspace
  ON flow_scenarios(workspace_id, updated_at DESC);
