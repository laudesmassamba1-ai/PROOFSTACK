-- One report per run.
--
-- A CLI retry can upload the same run with a different Idempotency-Key (a new CI
-- job, a manual re-sync). The run id is the identity of the result, so a second
-- report row for it would duplicate every joined row and inflate counts. The unique
-- index makes the database, not the caller, the authority on that.

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_run_unique ON reports(run_id);
