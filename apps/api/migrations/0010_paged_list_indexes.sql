-- Indexes for the queries the new pagination actually runs.
--
-- The paged lists filter by workspace and sort by a timestamp. Until now the only
-- indexes were project-scoped, so the workspace-wide pages (`/api/v1/runs` and
-- `/api/v1/findings`, both used by the overview) answered with `SCAN` plus
-- `USE TEMP B-TREE FOR ORDER BY` — a full table read and a sort for every page, worse the
-- more history a tenant has. Project-scoped paging already had an index and is untouched.
--
-- DESC matches the ORDER BY in the queries, so SQLite can walk the index instead of
-- building a temporary B-tree.

CREATE INDEX IF NOT EXISTS idx_findings_workspace
  ON findings(workspace_id, detected_at DESC);

-- The module filter is applied inside the same query; without the module column the
-- planner still has to read every finding of the workspace to sort the subset.
CREATE INDEX IF NOT EXISTS idx_findings_workspace_module
  ON findings(workspace_id, module, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_workspace
  ON test_runs(workspace_id, started_at DESC);
