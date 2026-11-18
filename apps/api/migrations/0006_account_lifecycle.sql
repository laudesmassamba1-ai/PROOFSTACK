-- Account lifecycle: email delivery, verification, password recovery, support.
--
-- Two rules drive this schema:
--   1. A token is never stored in clear. Only its SHA-256 is written, exactly like a
--      session token; a database dump cannot be replayed.
--   2. Every outbound e-mail is journalled. When no provider is configured the message
--      stays in the outbox with an explicit status instead of being silently dropped,
--      so "we sent you a link" is never a lie.

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- 'password_reset' | 'email_verify'
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  requested_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user
  ON auth_tokens(user_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  kind TEXT NOT NULL,               -- 'password_reset' | 'email_verify' | 'support' | 'test'
  status TEXT NOT NULL,             -- 'queued' | 'sent' | 'failed' | 'unconfigured'
  provider TEXT,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status
  ON email_outbox(status, created_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  from_address TEXT NOT NULL,
  workspace_id TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
