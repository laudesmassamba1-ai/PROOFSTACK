-- Scans run from the app, kept so the result is not a one-off screen.
--
-- The CLI stores its runs through `/v1/runs`, with the full engine contract. A scan of an
-- arbitrary URL has no engine run: it is a page, four families of findings, and a verdict.
-- Storing it as its own record keeps both honest — the module pages still show verified
-- runs, and this table shows what a URL said when someone asked.

CREATE TABLE IF NOT EXISTS page_audits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  -- Denormalised so a list view never parses the payload.
  worst_verdict TEXT NOT NULL,
  failed INTEGER NOT NULL,
  warnings INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_audits_workspace
  ON page_audits(workspace_id, created_at DESC);
