-- Interactive browser sessions.
--
-- A row per open browser, owned by the user who opened it. The Browser Rendering session
-- id is enough to drive the browser, so it never leaves the server: the client holds an
-- opaque row id, and every action re-checks the owner here.
CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_session_id TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS browser_sessions_user_idx ON browser_sessions (user_id, updated_at DESC);
