-- A scan started from a project page belongs to that project.
--
-- Until now `page_audits` recorded only the workspace, so the project page could not
-- answer "what did my own site say last time": it listed CI runs and nothing else, and the
-- scans lived on a separate screen. `project_id` is nullable on purpose — a scan of a
-- pasted address has no project, and every row written before this migration stays valid
-- and readable.

ALTER TABLE page_audits ADD COLUMN project_id TEXT;

-- The project page always filters by project and sorts by date, so the index carries both
-- columns in that order instead of making the planner read the workspace's whole history.
CREATE INDEX IF NOT EXISTS idx_page_audits_project
  ON page_audits(workspace_id, project_id, created_at DESC);
