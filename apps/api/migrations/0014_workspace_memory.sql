-- Workspace memory: what an assistant should already know when it starts.
--
-- The point of this table is continuity across models. A user who swaps their provider
-- or pastes a new key tomorrow must not have to explain their product again, so the
-- durable knowledge lives with the workspace — not with a conversation, not with a
-- provider, and not with a single assistant's context window.
--
-- Why a table and not a vector store: memory here is a small set of deliberate
-- statements ("prices are in XOF, never floats", "the checkout lives in apps/store"),
-- written on purpose and readable by a human. A similarity index would make the same
-- facts harder to audit, not more accurate.
--
-- `dedupe_key` is the normalised statement, so re-learning the same fact is a no-op
-- instead of a duplicate row; the UNIQUE index is what guarantees it under concurrency.

CREATE TABLE IF NOT EXISTS workspace_memory (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 'decision' | 'convention' | 'stack' | 'goal' | 'lesson'
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  -- Where it came from: 'assistant' (the model wrote it), 'user' (typed in the UI),
  -- 'system' (seeded from the workspace itself).
  source TEXT NOT NULL DEFAULT 'assistant',
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_memory_dedupe
  ON workspace_memory (workspace_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_workspace_memory_recent
  ON workspace_memory (workspace_id, updated_at DESC);
