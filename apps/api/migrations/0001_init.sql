-- PROOFSTACK API schema — SQLite dialect, applied identically on Cloudflare D1 and
-- on Node's built-in SQLite for local development/tests.
--
-- Conventions:
--   * ids are prefixed opaque strings, never sequential integers exposed to clients
--   * timestamps are UTC ISO-8601 strings; comparisons are lexicographic and correct
--   * money is stored as an integer minor-unit *string* plus its ISO currency
--   * tenant-owned rows always carry workspace_id so scoping is a WHERE clause, and
--     the API resolves membership before it ever reads them
--   * every unique constraint here is a correctness guarantee relied upon by code

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  email_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  stack TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production', 'ci')),
  enabled_modules TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id, deleted_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);

CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  environment TEXT NOT NULL,
  revision TEXT,
  totals TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON test_runs(project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retained_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  code TEXT,
  fingerprint TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(project_id, fingerprint);

-- Upload idempotency: the CLI may retry a sync after a network failure. The unique
-- key is what prevents double usage metering and duplicate reports, not a read.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, scope, key)
);

-- ---------------------------------------------------------------- billing

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  plan_key TEXT NOT NULL,
  currency TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('monthly', 'yearly')),
  state TEXT NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  trial_ends_at TEXT,
  provider TEXT NOT NULL,
  pending_plan_key TEXT,
  funded_by_intent_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON subscriptions(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  plan_key TEXT NOT NULL,
  price_id TEXT NOT NULL,
  period TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor TEXT NOT NULL,
  provider TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_reference TEXT,
  provider_checkout_url TEXT,
  verified_amount_minor TEXT,
  verified_net_amount_minor TEXT,
  credited INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  quarantined INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_workspace ON payment_intents(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intents_provider_ref ON payment_intents(provider, provider_reference);

-- A delivered webhook is recorded exactly once. (provider, provider_event_id) is the
-- replay wall; the handler acknowledges duplicates with zero side effects.
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  signature_valid INTEGER NOT NULL,
  processing_state TEXT NOT NULL,
  processed_at TEXT,
  body_digest TEXT NOT NULL,
  error TEXT,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  payment_attempt_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(id),
  provider_reference TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  issued_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace ON invoices(workspace_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  kind TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  billing_treatment TEXT NOT NULL,
  UNIQUE (workspace_id, kind, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_usage_workspace ON usage_events(workspace_id, occurred_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_logs(workspace_id, at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
