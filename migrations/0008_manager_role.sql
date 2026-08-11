-- A `manager` role: everything an owner can do, except decide who is in.
--
-- Ownership had been doing two unrelated jobs — keeping the catalog, and
-- controlling the guest list. Two people were `owner` purely so that both could
-- add books, which made "who can let someone in" a question with two answers.
-- After this there is one owner, and helping with the catalog no longer
-- requires ownership. The same change lands in the board game catalog as its
-- migration 0024, with the same role name and the same rule.
--
-- `manager` appears in every CAPABILITY_MATRIX entry except `manageUsers`
-- (packages/core/src/capabilities.ts), including `scan` and `runResearch`,
-- which spend money — the owner's explicit choice, recorded there.
--
-- ⚠️ SQLite cannot alter a CHECK constraint, so `app_user` must be redefined,
-- and `DROP TABLE` on a parent performs an implicit `DELETE FROM` that fires
-- foreign key actions. This catalog has SIX references to app_user — one more
-- pair than the board game catalog's, so its migration is not copyable verbatim:
--
--   user_book.user_id            ON DELETE CASCADE   -> every read-state row DELETED
--   research_run.triggered_by    ON DELETE SET NULL  -> nulled
--   research_finding.reviewed_by ON DELETE SET NULL  -> nulled
--   scan_job.created_by          ON DELETE SET NULL  -> nulled      (0006)
--   gap_verdict.decided_by       ON DELETE SET NULL  -> nulled      (0007)
--   app_user.approved_by         ON DELETE SET NULL  -> nulled (self-reference)
--
-- ⚠️ `user_book` is the expensive one. It holds per-person read state, notes and
-- the Firestore rating mirror, and CASCADE deletes whole rows — losing it means
-- losing "have I read this?" for everyone, which no rebuild can reconstruct.
--
-- The escapes do not work here either. `Board_Game_Catalog/migrations/0023`
-- measured both on a real D1 and both LOST DATA (`defer_foreign_keys`,
-- `legacy_alter_table`), and D1 does not support `foreign_keys = OFF`. So the
-- values are stashed and put back, which depends on no pragma at all and can be
-- checked by counting rows on both sides.
--
-- The self-reference is the subtle one: `app_user_new.approved_by` references
-- `app_user` **by name**, which is still the old table when `DROP` runs, so the
-- new table's own column is nulled too before the rename makes it
-- self-referential. It is restored from the same stash as everything else.

-- 1. Stash everything the rebuild is about to break.
--    user_book is CASCADE, so whole rows have to survive, not just a column.
CREATE TABLE _mig8_user_book AS SELECT * FROM user_book;
CREATE TABLE _mig8_run       AS SELECT id, triggered_by FROM research_run     WHERE triggered_by IS NOT NULL;
CREATE TABLE _mig8_finding   AS SELECT id, reviewed_by  FROM research_finding WHERE reviewed_by  IS NOT NULL;
CREATE TABLE _mig8_scan      AS SELECT id, created_by   FROM scan_job         WHERE created_by   IS NOT NULL;
CREATE TABLE _mig8_gap       AS SELECT id, decided_by   FROM gap_verdict      WHERE decided_by   IS NOT NULL;
CREATE TABLE _mig8_approved  AS SELECT id, approved_by  FROM app_user         WHERE approved_by  IS NOT NULL;

-- 2. Rebuild with the widened CHECK. Column order matches 0001 exactly; ids are
--    carried across unchanged, because every stash is keyed on them. The only
--    change is 'manager' in the CHECK list.
CREATE TABLE app_user_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  firebase_uid   TEXT    UNIQUE,
  display_name   TEXT,
  review_name    TEXT,
  photo_url      TEXT,
  role           TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (role IN ('owner', 'manager', 'reader', 'pending')),
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  approved_by    INTEGER REFERENCES app_user(id) ON DELETE SET NULL
);

INSERT INTO app_user_new (id, email, firebase_uid, display_name, review_name, photo_url,
                          role, first_seen_at, approved_at, approved_by)
  SELECT id, email, firebase_uid, display_name, review_name, photo_url,
         role, first_seen_at, approved_at, approved_by FROM app_user;

DROP TABLE app_user;
ALTER TABLE app_user_new RENAME TO app_user;

-- 3. Put back what the implicit DELETE took.
INSERT INTO user_book SELECT * FROM _mig8_user_book;

UPDATE research_run SET triggered_by =
  (SELECT s.triggered_by FROM _mig8_run s WHERE s.id = research_run.id)
  WHERE id IN (SELECT id FROM _mig8_run);

UPDATE research_finding SET reviewed_by =
  (SELECT s.reviewed_by FROM _mig8_finding s WHERE s.id = research_finding.id)
  WHERE id IN (SELECT id FROM _mig8_finding);

UPDATE scan_job SET created_by =
  (SELECT s.created_by FROM _mig8_scan s WHERE s.id = scan_job.id)
  WHERE id IN (SELECT id FROM _mig8_scan);

UPDATE gap_verdict SET decided_by =
  (SELECT s.decided_by FROM _mig8_gap s WHERE s.id = gap_verdict.id)
  WHERE id IN (SELECT id FROM _mig8_gap);

UPDATE app_user SET approved_by =
  (SELECT s.approved_by FROM _mig8_approved s WHERE s.id = app_user.id)
  WHERE id IN (SELECT id FROM _mig8_approved);

-- 4. The three indexes on user_book survive: that table was emptied, never
--    dropped. app_user carries none beyond the implicit UNIQUE on email and
--    firebase_uid, both repeated in the new definition above.
DROP TABLE _mig8_user_book;
DROP TABLE _mig8_run;
DROP TABLE _mig8_finding;
DROP TABLE _mig8_scan;
DROP TABLE _mig8_gap;
DROP TABLE _mig8_approved;
