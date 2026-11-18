-- AI experience, server-persisted.
--
-- Conversations belong to the user; the UI is stateless without them. The API
-- key is stored ENCRYPTED (AES-256-GCM under AI_KEYS_SECRET) — a database dump
-- alone must not reveal it.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT 'balanced',
  messages TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations(user_id, workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_profiles (
  user_id TEXT PRIMARY KEY,
  provider_base_url TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
