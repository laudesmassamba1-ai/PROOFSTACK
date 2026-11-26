-- Distributed fixed-window counters.
--
-- The in-process limiter forgets on every cold start and counts per isolate, so a client
-- that retries across colos gets several budgets. This table is the shared budget: one
-- atomic upsert decides, and the answer survives the isolate.
CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);
