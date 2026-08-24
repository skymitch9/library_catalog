-- WHO has the book — the person on the other end of a lend, a borrow or a sale.
--
-- Owner request OR-1 (docs/TODO.md, 2026-08-23): *"if i loaned out a book to
-- Samantha I should be able to put her name in a text box that matches the
-- theme and saves. if Samantha is a user in the estate i should be able to
-- autofill to her user profile so its linked to her."*
--
-- ## Two columns, not one — his decision, verbatim: "Both: id plus typed text"
--
--   person_user_id  the estate identity, when the person is a member here
--   person_name     the name AS TYPED, always
--
-- ⚠️ **`person_name` is kept even when `person_user_id` is set**, and that is
-- the whole reason there are two columns rather than a nullable FK.
--
--   * A **non-member** is the common case — most people you lend a book to have
--     never signed into this catalog — and a design that could only record a
--     member would refuse the ordinary lend.
--   * A **member's** card shows their CURRENT `display_name`, resolved
--     server-side on every read (his answer to "live join or snapshot?": live).
--     `person_name` is then the fallback that survives the row being unlinked,
--     the member being deleted (`ON DELETE SET NULL` below), or the estate
--     being unreachable — the record still says who had the book.
--
-- So the two are not a duplicate fact wearing two hats: the id is *which
-- account*, the text is *what was written down*. Compare `edition_name` /
-- `edition_kind` in migration 0050 — same shape of argument, one table over.
--
-- ## Which statuses may carry a person
--
-- `lent`, `borrowed`, `sold`. Not enforced by a CHECK here, deliberately: the
-- rule is about a TRANSITION (you may not newly attach a person to a copy that
-- is merely `owned`) and a row-level CHECK cannot see the difference between
-- attaching one and *keeping* one across a status change. A copy that comes
-- home from a lend keeps its history; the panel simply stops printing it.
-- `assertPersonStatus` in `packages/db/src/editions.ts` is the one rule, and it
-- refuses in words.
--
-- ## `sold` keeps its row — his decision #3, "Sold stays as a record"
--
-- Nothing is deleted. A sold copy keeps person + `acquired_on`, so "who did I
-- sell that to, and when" stays answerable years later. The collection hides
-- works whose copies are ALL sold unless the Copies filter asks for them.
--
-- ## ⚠️ `lent_to` is DEPRECATED and is NOT dropped here
--
-- It is backfilled into `person_name` below and then left standing for one
-- release, so a deploy that lands before this migration (or a rollback to the
-- commit before it) still reads the text it wrote. **Dropping it is a later
-- migration**, once nothing in the tree reads it — the estate's own
-- migrate-before-deploy rule cuts the other way for a REMOVAL, and a column
-- that two live instances still SELECT is not free to disappear.
--
-- ⚠️ `IF NOT EXISTS` is not available for ADD COLUMN in SQLite, so this
-- migration is not re-runnable by itself. It is guarded the way 0380's repair
-- note describes: `d1 migrations apply` records it in `d1_migrations`, and it
-- must not be applied out of band.

ALTER TABLE copy ADD COLUMN person_user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE copy ADD COLUMN person_name    TEXT;

-- Carry the existing free text across. Only where it says something: a blank
-- string is not a name, and `optionalText` in `@lc/core` already treats it as
-- absent everywhere else.
UPDATE copy
   SET person_name = trim(lent_to)
 WHERE lent_to IS NOT NULL
   AND trim(lent_to) <> ''
   AND person_name IS NULL;

-- "Books with you": every copy pointing at one member, which is the whole query
-- behind that section. Partial, because the overwhelming majority of copies
-- carry no person at all and an index over 800 NULLs earns nothing.
CREATE INDEX IF NOT EXISTS idx_copy_person_user
  ON copy(person_user_id) WHERE person_user_id IS NOT NULL;
