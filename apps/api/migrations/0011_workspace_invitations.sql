-- Workspace invitations, with consent.
--
-- Adding a person to a tenant is not something one party can decide. Until now
-- `POST /workspaces/:id/members` wrote the membership row immediately: the invited person
-- was granted access to projects, runs and findings without ever agreeing, and without
-- being told. The notification that the product promised did not exist either.
--
-- An invitation is now its own record with its own lifecycle. The membership row is
-- created only when the invitee accepts, so "invited" and "member" can never be confused.
--
-- `status` is one of: pending | accepted | declined | revoked.
-- The partial unique index keeps at most one *pending* invitation per person per
-- workspace, while still allowing a re-invitation later (after a decline or a removal).

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  invited_user_id TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  responded_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_one_pending
  ON workspace_invitations(workspace_id, invited_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_invitations_invitee
  ON workspace_invitations(invited_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invitations_workspace
  ON workspace_invitations(workspace_id, status, created_at DESC);
