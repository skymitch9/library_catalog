-- 0300: the 2026-08-16 role ladder redesign — `manager` -> `moderator`,
-- `reader` -> `member`; `guest`, `contributor` and `admin` join the CHECK.
--
-- ⚠️ Numbered 0300 rather than 0210, following 0200's own rule (which followed
-- 0050's): wide gaps while several agents may be touching this repo at once,
-- so two migrations picked concurrently do not collide on the same number.
--
-- ## The ladder (packages/core/src/constants.ts carries the full design)
--
-- `guest < member < contributor < moderator < admin < owner`, cumulative.
-- `pending` is untouched — it is a STATUS, not a ladder rung, and no row with
-- `role = 'pending'` is touched by this migration at all.
--
-- Owner-approved verbatim ("Role matrix approved"). The mapping is chosen so
-- **no existing user loses a capability**: `manager`'s old CAPABILITY_MATRIX
-- row (packages/core/src/capabilities.ts, pre-2026-08-16) is a strict subset
-- of `moderator`'s new one, and `reader`'s old row is a strict subset of
-- `member`'s new one. `guest`, `contributor` and `admin` are new rungs; this
-- migration does not assign them to anyone — every existing row maps to
-- exactly `moderator`, `member`, `owner` or stays `pending`.
--
--   reader  -> member
--   manager -> moderator
--   owner   -> owner    (unchanged)
--   pending -> pending  (unchanged, and out of scope for the CASE below)
--
-- No `change_log` rows are written for the rename. It is a vocabulary change
-- to a data migration, not a person's action — the same reasoning migration
-- 0200 applied to `series_volume.source`/`series_check.source`, and change_log
-- itself (0120) exists to audit `setUserRole`'s writes, not the schema's.
--
-- ## Why a table rebuild and not an UPDATE + a separate CHECK widen
--
-- SQLite cannot ALTER a CHECK constraint in place (`edition_kind`'s migration
-- 0050 says so, `series_volume`'s 0200 says so, and 0008 is this exact table
-- learning it the first time). The CHECK has to be rebuilt, which means the
-- table has to be rebuilt, which means every foreign key pointing at it fires
-- ON DELETE the moment `DROP TABLE app_user` runs — so this migration is 0008's
-- stash-and-restore dance again, widened for how much has been added to
-- `app_user`'s reference count since 2026-08-09.
--
-- ⚠️ **0008 said "SIX references to app_user." There are now ELEVEN**, across
-- ten distinct columns (`work_watch` holds two) plus the self-reference —
-- confirmed by grepping every migration for `REFERENCES app_user` before
-- writing this one, not assumed from 0008's count:
--
--   app_user.approved_by              ON DELETE SET NULL  (self-reference, 0001)
--   user_book.user_id                 ON DELETE CASCADE    -> every read-state row DELETED
--   research_run.triggered_by         ON DELETE SET NULL  (0001)
--   research_finding.reviewed_by      ON DELETE SET NULL  (0001)
--   scan_job.created_by               ON DELETE SET NULL  (0006)
--   gap_verdict.decided_by            ON DELETE SET NULL  (0007)
--   work_watch.raised_by              ON DELETE SET NULL  (0040)
--   work_watch.resolved_by            ON DELETE SET NULL  (0040)
--   series_gap_skip.decided_by        ON DELETE SET NULL  (0100, composite PK: series + index_sort)
--   audiobook_series_link.confirmed_by ON DELETE SET NULL (0110, PK: series)
--   change_log.changed_by             ON DELETE SET NULL  (0120)
--
-- `user_book` is still the expensive one, unchanged from 0008's warning: it
-- holds per-person read state, notes and the Firestore rating mirror, and
-- CASCADE deletes whole rows if not stashed and restored whole.
--
-- The escapes still do not work: `Board_Game_Catalog/migrations/0023` measured
-- both `defer_foreign_keys` and `legacy_alter_table` LOSING DATA on a real D1,
-- and D1 does not support `foreign_keys = OFF`. So every value is stashed and
-- put back, which depends on no pragma at all and can be checked by counting
-- rows on both sides — exactly 0008's method, extended to every column above.
--
-- The self-reference is still the subtle one: `app_user_new.approved_by`
-- references `app_user` **by name**, which is still the OLD table while `DROP`
-- runs, so the new table's own column is nulled too before the rename makes it
-- self-referential again. Restored from the same stash as everything else.

-- ---------------------------------------------------------------------------
-- 1. Stash everything the rebuild is about to break.
--    user_book is CASCADE, so whole rows have to survive, not just a column.
-- ---------------------------------------------------------------------------
CREATE TABLE _mig300_user_book   AS SELECT * FROM user_book;
CREATE TABLE _mig300_run         AS SELECT id, triggered_by FROM research_run         WHERE triggered_by  IS NOT NULL;
CREATE TABLE _mig300_finding     AS SELECT id, reviewed_by  FROM research_finding     WHERE reviewed_by   IS NOT NULL;
CREATE TABLE _mig300_scan        AS SELECT id, created_by   FROM scan_job            WHERE created_by    IS NOT NULL;
CREATE TABLE _mig300_gap         AS SELECT id, decided_by   FROM gap_verdict         WHERE decided_by    IS NOT NULL;
CREATE TABLE _mig300_approved    AS SELECT id, approved_by  FROM app_user            WHERE approved_by   IS NOT NULL;
CREATE TABLE _mig300_watch_r     AS SELECT id, raised_by    FROM work_watch          WHERE raised_by     IS NOT NULL;
CREATE TABLE _mig300_watch_x     AS SELECT id, resolved_by  FROM work_watch          WHERE resolved_by   IS NOT NULL;
CREATE TABLE _mig300_gap_skip    AS SELECT series, index_sort, decided_by FROM series_gap_skip
                                    WHERE decided_by IS NOT NULL;
CREATE TABLE _mig300_ab_link     AS SELECT series, confirmed_by FROM audiobook_series_link
                                    WHERE confirmed_by IS NOT NULL;
CREATE TABLE _mig300_change_log  AS SELECT id, changed_by   FROM change_log          WHERE changed_by    IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Rebuild with the widened CHECK and the role mapping. Column order
--    matches the live table exactly (0008's four originals + 0140's two +
--    0150's one); every id is carried across unchanged, since every stash
--    above is keyed on it.
-- ---------------------------------------------------------------------------
CREATE TABLE app_user_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  firebase_uid   TEXT    UNIQUE,
  display_name   TEXT,
  review_name    TEXT,
  photo_url      TEXT,
  role           TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (role IN ('owner', 'admin', 'moderator', 'contributor', 'member', 'guest', 'pending')),
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  approved_by    INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  estate_status      TEXT CHECK (estate_status IN ('pending', 'approved', 'revoked')),
  estate_checked_at  TEXT,
  estate_visibility  TEXT
);

INSERT INTO app_user_new (id, email, firebase_uid, display_name, review_name, photo_url,
                          role, first_seen_at, approved_at, approved_by,
                          estate_status, estate_checked_at, estate_visibility)
  SELECT id, email, firebase_uid, display_name, review_name, photo_url,
         CASE role WHEN 'reader' THEN 'member' WHEN 'manager' THEN 'moderator' ELSE role END,
         first_seen_at, approved_at, approved_by,
         estate_status, estate_checked_at, estate_visibility
    FROM app_user;

DROP TABLE app_user;
ALTER TABLE app_user_new RENAME TO app_user;

-- ⚠️ Found while writing this migration, fixed rather than carried forward:
-- 0001 created `idx_app_user_review_name` (the review-bridge lookup's index),
-- but 0008's rebuild dropped `app_user` without recreating it and nothing
-- since has — a table rebuild drops its indexes same as it drops its rows,
-- and 0008's own comment on "what survives" only accounted for `user_book`'s
-- three (which were never dropped, only emptied). The index has been missing
-- from production since 0008 shipped. Restored here since this migration is
-- already rebuilding the same table; it does not undo anything else 0008 did.
CREATE INDEX idx_app_user_review_name ON app_user(review_name);

-- ---------------------------------------------------------------------------
-- 3. Put back what the implicit DELETE took.
-- ---------------------------------------------------------------------------
INSERT INTO user_book SELECT * FROM _mig300_user_book;

UPDATE research_run SET triggered_by =
  (SELECT s.triggered_by FROM _mig300_run s WHERE s.id = research_run.id)
  WHERE id IN (SELECT id FROM _mig300_run);

UPDATE research_finding SET reviewed_by =
  (SELECT s.reviewed_by FROM _mig300_finding s WHERE s.id = research_finding.id)
  WHERE id IN (SELECT id FROM _mig300_finding);

UPDATE scan_job SET created_by =
  (SELECT s.created_by FROM _mig300_scan s WHERE s.id = scan_job.id)
  WHERE id IN (SELECT id FROM _mig300_scan);

UPDATE gap_verdict SET decided_by =
  (SELECT s.decided_by FROM _mig300_gap s WHERE s.id = gap_verdict.id)
  WHERE id IN (SELECT id FROM _mig300_gap);

UPDATE app_user SET approved_by =
  (SELECT s.approved_by FROM _mig300_approved s WHERE s.id = app_user.id)
  WHERE id IN (SELECT id FROM _mig300_approved);

UPDATE work_watch SET raised_by =
  (SELECT s.raised_by FROM _mig300_watch_r s WHERE s.id = work_watch.id)
  WHERE id IN (SELECT id FROM _mig300_watch_r);

UPDATE work_watch SET resolved_by =
  (SELECT s.resolved_by FROM _mig300_watch_x s WHERE s.id = work_watch.id)
  WHERE id IN (SELECT id FROM _mig300_watch_x);

UPDATE series_gap_skip SET decided_by =
  (SELECT s.decided_by FROM _mig300_gap_skip s
    WHERE s.series = series_gap_skip.series AND s.index_sort = series_gap_skip.index_sort)
  WHERE (series, index_sort) IN (SELECT series, index_sort FROM _mig300_gap_skip);

UPDATE audiobook_series_link SET confirmed_by =
  (SELECT s.confirmed_by FROM _mig300_ab_link s WHERE s.series = audiobook_series_link.series)
  WHERE series IN (SELECT series FROM _mig300_ab_link);

UPDATE change_log SET changed_by =
  (SELECT s.changed_by FROM _mig300_change_log s WHERE s.id = change_log.id)
  WHERE id IN (SELECT id FROM _mig300_change_log);

-- ---------------------------------------------------------------------------
-- 4. Drop the stashes. `user_book`'s three indexes survive: that table was
--    emptied by the CASCADE and refilled, never dropped itself. `app_user`
--    carries none beyond the implicit UNIQUE on email and firebase_uid, both
--    repeated in the new definition above.
-- ---------------------------------------------------------------------------
DROP TABLE _mig300_user_book;
DROP TABLE _mig300_run;
DROP TABLE _mig300_finding;
DROP TABLE _mig300_scan;
DROP TABLE _mig300_gap;
DROP TABLE _mig300_approved;
DROP TABLE _mig300_watch_r;
DROP TABLE _mig300_watch_x;
DROP TABLE _mig300_gap_skip;
DROP TABLE _mig300_ab_link;
DROP TABLE _mig300_change_log;
