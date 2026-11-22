-- Verification of a single correction.
--
-- The corrections board already said whether a finding was still present on the *next*
-- full scan. That answers "did something change", not "did my fix work": a user who
-- deployed a header and wanted to know now had to wait for the next scan, which also
-- re-measured 45 other controls.
--
-- A verification re-checks one finding against the live site and records what it saw,
-- without creating a new audit row: it is not a new baseline, and it must not consume the
-- monthly audit quota. The state row keeps an audit trail — when it was checked, what was
-- observed before, what is observed now, and the verdict.
--
-- `verified_verdict` is deliberately narrow: `fixed`, `still_present`, `worse`,
-- `not_checked` (the control was not emitted at all this time) and `inconclusive` (the
-- page could not be read). A verdict is a fact about a request, never a guarantee.

ALTER TABLE audit_finding_states ADD COLUMN verified_at TEXT;
ALTER TABLE audit_finding_states ADD COLUMN verified_status TEXT;
ALTER TABLE audit_finding_states ADD COLUMN verified_observed TEXT;
ALTER TABLE audit_finding_states ADD COLUMN verified_before TEXT;
ALTER TABLE audit_finding_states ADD COLUMN verified_verdict TEXT
  CHECK (
    verified_verdict IS NULL
    OR verified_verdict IN ('fixed', 'still_present', 'worse', 'not_checked', 'inconclusive')
  );
