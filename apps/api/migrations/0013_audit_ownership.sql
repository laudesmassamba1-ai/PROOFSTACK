-- Who a scan report belongs to, and whether exact locations were withheld.
--
-- A remote scan of a pasted URL proves nothing about ownership: the address may be a
-- customer's, a competitor's, or one someone typed to see what the API would say. Until
-- the site publishes the workspace's verification token, the report must not become a map
-- of someone else's weaknesses, so `redacted` records what the reader was actually shown.
--
-- The defaults describe every row written before this migration: the first scans were all
-- remote and all unverified, and their payloads were stored unredacted. Keeping
-- `unverified`/`redacted = 1` as the default means a caller that forgets to pass the value
-- fails closed (withheld detail) rather than open.
--
-- `ownership` is 'local' | 'verified' | 'unverified'. 'local' is only ever produced by the
-- CLI scanning the machine it runs on; the API cannot reach a loopback address at all.

ALTER TABLE page_audits ADD COLUMN ownership TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE page_audits ADD COLUMN redacted INTEGER NOT NULL DEFAULT 1;
