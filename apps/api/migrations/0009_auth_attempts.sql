-- Attempt memory that outlives a Worker isolate.
--
-- The in-process limiter is a first line, but it lives in one isolate: a cold start, a
-- deploy, or a request landing in another colo hands the attacker a fresh window. These
-- rows make the lockout durable and shared, at the cost of one INSERT per *failed*
-- attempt — a write that only happens when someone is actually guessing wrong.
--
-- `scope` is a coarse label, never a credential. Sign-in rows record failures; the
-- forgot-password rows record requests, because there every request costs an e-mail:
--   'signin:email:<normalized email>'
--   'signin:ip:<client address>'
--   'forgot:ip:<client address>'
--
-- Old rows are pruned when a scope is read, so the table cannot grow without bound.

CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_scope ON auth_attempts(scope, at DESC);
