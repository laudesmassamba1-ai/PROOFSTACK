-- A scan made on the free analysis (no paid subscription): it shows 60 % of its tests and
-- counts against the person's two free analyses. Paid scans keep 0.
ALTER TABLE page_audits ADD COLUMN free_preview INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_page_audits_free_preview
  ON page_audits(created_by, free_preview);
