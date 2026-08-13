-- The illustrator credit gets a column of its own.
--
-- Why: this library is heavy in picture and board books, where the illustrator
-- is frequently the credit that matters and sometimes the ONLY human credited.
-- Two cases forced it on 2026-08-13 and both survived only as audit-log notes,
-- which is not a place anyone reads:
--   * #174 "I Love You, Little Bear" - Judi Abbot (Giuditta Gaviraghi) is
--     credited on the ISBN as illustrator; no writer is named anywhere, so
--     `authors` had to take the publisher and her credit had nowhere to go.
--   * #269 "Who Goes Roar?" - "Illustrated by Shannon Hays" is printed on the
--     back cover; again no writer is named on the object.
-- Before this column the choice was "record the publisher OR the illustrator",
-- and both are true.
--
-- ⚠️ THE ONE RULE: `illustrator` MUST NEVER ENTER `work_key`.
--
-- `work_key` is `normaliseTitle(title)|normaliseTitle(primaryAuthor(authors))`
-- and it is the join to ~860 reviews across two catalogs (0001's header, and
-- docs/info/identity-and-reviews.md). Widening it is not a schema change - it
-- is a rewrite of every stored key in both stores plus every Firestore document
-- that carries one. A book whose illustrator is later corrected must NOT move
-- its key, which is exactly what would happen if this column were folded in.
-- Keep it a display field. `workKeyFor` takes title and authors only, and that
-- signature is the guard.
--
-- Nullable, and NOT backfilled beyond the two known values below: an
-- unrecorded illustrator is "nobody has looked", not "there is none" - 0040's
-- rule, which refused to backfill cover_status to 'ok' for the same reason.
-- A work with no illustrator (most novels) simply stays NULL; there is no
-- "not applicable" sentinel, because the absence already says it.
--
-- Additive only. No table rebuild - `work` is the most-referenced table here
-- and 0008 records what a D1 rebuild of a referenced table costs.

ALTER TABLE work ADD COLUMN illustrator TEXT;

-- The two credits that forced the column, recovered from change_log where they
-- were parked. Both are stated on the books themselves, so these are observed
-- values rather than inferences.
UPDATE work SET illustrator = 'Judi Abbot'   WHERE id = 174;
UPDATE work SET illustrator = 'Shannon Hays' WHERE id = 269;
