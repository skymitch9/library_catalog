-- "This cover is not really the right cover, and I know it."
--
-- Two facts this schema could not hold, and one data correction that needs
-- both. Additive only: one nullable column, one new table, no table rebuilt and
-- no existing row's existing columns touched.
--
-- ===========================================================================
-- 1. `work.cover_status` — is the image we hold actually this book's cover?
-- ===========================================================================
--
-- ⚠️ **"Has a cover" and "has the RIGHT cover" are different questions, and
-- until now only the first was answerable.** Everything in this app treats
-- `cover_url IS NOT NULL` as done: `collectionStats` counts it, the cover
-- backfills skip it, and `Enrich` refuses to overwrite it. That is correct for
-- a missing cover and silently wrong for a wrong one — a stand-in has a URL,
-- passes every one of those tests, and is still not the book on the shelf.
--
-- The five Illumicrate Percy Jackson works below are exactly that case, and it
-- is not a fixable one: the vendor page has no per-title image at all. All seven
-- of its images were downloaded and inspected on 2026-08-10 and every one is a
-- styled marketing shot. The owner's instruction was to use one anyway and
-- label it. Without this column, "use it anyway" is indistinguishable from
-- "solved" the moment the session ends.
--
-- ## Values
--
--   'ok'      — somebody looked, and this is the book's own cover.
--   'standin' — we know it is not, and are holding it until a real one arrives.
--   NULL      — nobody has assessed it. **Not** the same as 'ok'.
--
-- The last distinction is the one `docs/info/covers-and-series.md` §3.1 already
-- insists on for series research: "researched and there is no series" and
-- "nobody has looked" are different facts and only one of them is a reason to
-- look again. Nothing is backfilled to 'ok' here for the same reason migration
-- 0013 refused to backfill `decided_how` to 'human': it would be accurate and it
-- would still be a value nothing observed.
--
-- ## Why a column on `work` and not a row in the table below
--
-- Because a cover has exactly one standing, and that standing must change in
-- the same statement the URL does. Stored anywhere else, replacing a stand-in
-- with a real cover is two writes that can diverge — and the failure mode is the
-- one this column exists to prevent, a book that looks resolved and is not.
-- `updateWork` in `packages/db/src/works.ts` enforces the pairing.
--
-- Deliberately NO CHECK constraint, following `gap_verdict.field` (0007) and
-- `research_finding.decided_how` (0013): the set may grow, a CHECK here would
-- make each addition a table rebuild, and an unrecognised value simply fails to
-- match any filter. `COVER_STATUSES` in `packages/core/src/constants.ts` is the
-- list.

ALTER TABLE work ADD COLUMN cover_status TEXT;

-- "Which books still need a cover" is the query this whole feature exists to
-- answer, and it is a table scan without this. Same shape and same reason as
-- `idx_finding_decided_how` in 0013.
CREATE INDEX idx_work_cover_status ON work(cover_status);

-- ===========================================================================
-- 2. `work_watch` — needs my eyes, and here is why
-- ===========================================================================
--
-- The owner's words, about two books recording contradictory series: *"I'll
-- check — put a watch on this issue so I verify later."*
--
-- ## ⚠️ Why this is a table and `cover_status` is a column
--
-- They look like one feature and they are two, because they are different
-- shapes:
--
--   * A cover's standing is **one bit about one column**, with a closed
--     vocabulary and no explanation to record. "Stand-in" says everything there
--     is to say.
--   * A watch is **an open question about the row**, and the question is the
--     entire content. "Contradicts #215" is the fact worth keeping; a boolean
--     `needs_check` column would store that a question exists and throw away
--     what it was, which is precisely what the owner would need back.
--
-- One book can also hold two unrelated questions at once, and a question has a
-- lifecycle a column has nowhere to put: raised, then answered.
--
-- They share a *surface* — both put a mark on the card and both feed one
-- "needs attention" filter, so the set can be worked through in one pass — and
-- that is the only place they need to agree.
--
-- ## `raised_how` is `decided_how`'s counterpart, and is why this is not a
-- ## single TEXT column on `work`
--
-- The details queue writes values **unread**, on the owner's explicit
-- instruction (see `docs/TODO.md`, "Auto-apply missing details"). Migration 0013
-- added `decided_how` so a machine's guess stays distinguishable from a person's
-- assertion. A run that writes a value it is unsure of has, today, no way to say
-- so — the watch is that missing counterpart, and it can only carry it if the
-- raiser is recorded. Same two values, same vocabulary: `DECISION_MODES`.
--
-- ## Resolved, not deleted
--
-- Migration 0003's rule, applied to a question instead of a claim: "we looked at
-- this and it was fine" is a real answer and worth more than a row's absence,
-- which is indistinguishable from never having asked.

CREATE TABLE work_watch (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id      INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- Why this book needs eyes. NOT NULL and not defaulted: a watch with no
  -- reason is a mark the owner will find later and be unable to act on, which
  -- is worse than no mark. The UI refuses an empty one too.
  note         TEXT    NOT NULL,

  -- 'human' — a person raised it.
  -- 'auto'  — a run raised it about a value it wrote unread.
  -- No CHECK, for the reason given on `cover_status` above. `DECISION_MODES`.
  raised_how   TEXT    NOT NULL DEFAULT 'human',
  raised_by    INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  -- NULL while open. Set when somebody says they have looked.
  resolved_at  TEXT,
  resolved_by  INTEGER REFERENCES app_user(id) ON DELETE SET NULL
);

-- The two reads this table has: "is this book watched" (the book page, and the
-- collection's mark) and "what is still open" (the filter). Partial on
-- `resolved_at IS NULL` because a resolved watch is history and is never what
-- either query is asking for.
CREATE INDEX idx_work_watch_open ON work_watch(work_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_work_watch_work ON work_watch(work_id, created_at);

-- ===========================================================================
-- 3. The data these two exist for
-- ===========================================================================
--
-- ⚠️ Data in a migration, deliberately and exceptionally. Both corrections are
-- one-time, are the reason the columns above were added, and are worthless
-- deferred — a label feature that ships with nothing labelled cannot be looked
-- at and judged. Both are guarded so they write nothing in a database that does
-- not hold these rows.

-- ⚠️ **The same image on five books is deliberate, and is what the label is
-- for.** Anything that later "deduplicates" identical cover URLs must read this
-- first: these five are not a mistake to be tidied away, they are five books
-- wearing one marketing photograph on purpose until real covers exist.
--
-- The URL is the plain-background five-book lineup — the most cover-like of the
-- seven images on the vendor page, 198KB, chosen by eye on 2026-08-11.
--
-- Selected by `edition_name` rather than by id, so it lands on the right five
-- rows in any database. `cover_status` is set in the same statement as
-- `cover_url`, which is the pairing rule this schema now depends on.
UPDATE work
   SET cover_url    = 'https://us.illumicrate.com/cdn/shop/files/ef4a309d-7981-48e0-b0b2-db9456075c9a__00407_1.jpg?width=1000',
       cover_status = 'standin',
       updated_at   = datetime('now')
 WHERE id IN (SELECT DISTINCT work_id FROM edition
               WHERE edition_name = 'Illumicrate Exclusive');

-- The first two watches, and the reason the feature was asked for. #213 *Secret
-- Ingredient* is recorded as "The Pengrooms" vol 2 while #215 *Pengrooms* is
-- "Pringle & Finn" vol 1 — both auto-filled, both citing a real source, both
-- plausible, and they cannot both be right. Paul Castle's series is indexed
-- under both names.
--
-- Matched on id AND title: the ids are production's, and the title test stops
-- this landing on two unrelated books in a database numbered differently.
-- 'human' because the owner raised these by asking for the feature.
INSERT INTO work_watch (work_id, note, raised_how)
SELECT id,
       'Series contradicts the other Paul Castle book — #213 says "The Pengrooms", #215 says "Pringle & Finn". Both were auto-filled from real sources. Pick one.',
       'human'
  FROM work
 WHERE (id = 213 AND title LIKE '%Secret Ingredient%')
    OR (id = 215 AND title LIKE '%Pengrooms%');
