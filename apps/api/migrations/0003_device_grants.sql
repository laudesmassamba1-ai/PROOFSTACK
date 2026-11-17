-- Device authorization grants (RFC 8628-style flow for the CLI).
--
-- `proofcore login --device` asks the API for a short-lived grant, the user
-- approves it in a browser where they are already signed in, and the CLI polls
-- for the session. Only the SHA-256 of the device code is stored: the raw code
-- is bearer knowledge, like a password. The user code is the human-facing
-- string typed into the verification page, unique across live grants.

CREATE TABLE IF NOT EXISTS device_grants (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  consumed_at TEXT,
  poll_count INTEGER NOT NULL DEFAULT 0,
  client_name TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_grants_user_code ON device_grants(user_code);
