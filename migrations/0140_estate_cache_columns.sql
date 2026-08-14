-- 0140: the two estate-membership cache columns — estate auth SHADOW adoption.
--
-- Design: catalog-platform/docs/info/estate-auth-design.md §5.2 (the cache),
-- §14.5 (this step). The estate directory (auth.heygabi.ai) answers
-- pending|approved|revoked per person; each app caches that answer ON ITS OWN
-- USER ROW because the row is already loaded on every request — the cache
-- rides for free, survives isolate recycling (unlike memory), and adds no new
-- moving part (unlike KV).
--
-- ⚠️ ADDITIVE ON PURPOSE, and cheap: plain ADD COLUMN, no table rebuild. The
-- 0008 rebuild was forced by a CHECK that could not be altered; these columns
-- arrive with their CHECK in the same statement, so no such cost exists.
-- Nullable, both: NULL means "never checked", which is a real state (every
-- existing row starts there) — and NULL passes the CHECK, as SQLite CHECKs do.
--
-- ⚠️ These columns are a CACHE, not an authorization fact. The local `role`
-- column stays the authorization layer (§3); nothing joins on these, nothing
-- FKs to them, and wiping them costs one /seen round-trip per user. While
-- ESTATE_CHECK is 'off' (the deployed default) or 'shadow', nothing enforces
-- from them either — shadow only logs what the §3.1 table WOULD decide.

ALTER TABLE app_user ADD COLUMN estate_status TEXT
  CHECK (estate_status IN ('pending', 'approved', 'revoked'));

-- ISO timestamp of the last successful /seen answer. Freshness window is the
-- module's REVOCATION_DELAY_MS (10 min — §5.3: the TTL IS the revocation
-- delay, chosen out loud, owner-confirmed 2026-08-13).
ALTER TABLE app_user ADD COLUMN estate_checked_at TEXT;
