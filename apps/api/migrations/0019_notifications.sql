-- In-app notifications.
--
-- The workspace already knows what happened (audit_logs), but an audit trail is not a
-- notification: it is written for an investigator, has no recipient and no read state.
-- This table is the inbox a member actually looks at. Rows are created from events the
-- product already records — a run upload, a payment finalisation, an API key lifecycle
-- change, a workspace invitation — never from a synthetic "hello" event.
--
-- `user_id` is the recipient. A workspace event can produce one row per member: every
-- recipient gets their own read state, so one person marking a run notice as read does
-- not hide it for the rest of the workspace.
--
-- `dedupe_key` makes an event idempotent. Payment finalisation can be reached from a
-- return, a webhook and reconciliation; without the unique index the same verified
-- payment would produce three notifications. The key also carries the recipient, so
-- two members never compete for the same row.
--
-- `kind` is one of: run.completed, run.failed, payment.credited, payment.failed,
-- api_key.created, api_key.revoked, invitation.sent, invitation.accepted,
-- invitation.declined, invitation.revoked, member.removed, member.role_changed.
-- The UI maps these to copy; an unknown kind is still listed by its raw value.

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  dedupe_key TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_notifications_inbox
  ON notifications (workspace_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (workspace_id, user_id, read_at, created_at DESC);
