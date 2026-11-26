-- Onboarding, per workspace.
--
-- Kept in its own table rather than added to workspaces: the row is read by the
-- onboarding screen and by the AI context builder, and a workspace created before this
-- feature has no row at all — which is a truthful "never onboarded", not a default.
CREATE TABLE IF NOT EXISTS workspace_onboarding (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  experience TEXT NOT NULL DEFAULT 'simple' CHECK (experience IN ('simple', 'studio')),
  project_type TEXT,
  goal TEXT,
  level TEXT,
  target TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
