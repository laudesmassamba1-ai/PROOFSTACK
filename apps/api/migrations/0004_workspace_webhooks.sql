-- Outbound workspace webhooks.
--
-- Workspaces register their own endpoints (Slack relay, n8n, CI trigger). The
-- API signs each delivery the same way it signs the ops n8n bridge:
-- HMAC-SHA256 over `${timestamp}.${body}` in x-proofcore-signature. The secret
-- is stored server-side (deliveries are signed here) and shown in plaintext
-- exactly once, at creation.

CREATE TABLE IF NOT EXISTS workspace_webhooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  secret_prefix TEXT NOT NULL,
  events TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_status INTEGER,
  last_status_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON workspace_webhooks(workspace_id);
