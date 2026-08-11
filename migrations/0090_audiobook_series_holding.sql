-- "Do we own THAT one on audio?" — asked about a rung with no `work` row.
--
-- ## The bug this exists to remove, stated plainly
--
-- Migration 0010 keys `audiobook_holding` on `work_id REFERENCES work(id)`. That
-- key is not a backfill gap, it is a structural one: **a book owned only on
-- audio has no work row in this catalog, so it cannot be represented at all.**
-- The series ladder therefore drew it as a hole, and the app told the owner they
-- were missing books that are in the house.
--
-- Measured against `audiobook_catalog/site/catalog.csv` on 2026-08-11: the
-- household holds all seven Stormlight Archive audiobooks — 1, 2, 2.5, 3, 3.5, 4
-- and 5 — and this catalog holds exactly one of those titles, *Words of
-- Radiance*, as an ebook. `/series/The Stormlight Archive` read
-- *"1 book of at least 5 — 6 missing from the run itself"*. Six books, every one
-- of them owned.
--
-- ⚠️ **Claiming the owner lacks a book they have is worse than saying nothing**,
-- because it is the one kind of wrong a completeness feature cannot survive: it
-- sends somebody to buy a second copy. About 397 audiobook rows have no work row
-- here, so this is systemic and not a Sanderson anecdote.
--
-- ## Why a second cache table, and not ~400 new `work` rows
--
-- Minting a work per audiobook was the obvious fix and it contradicts all three
-- of migration 0010's stated rules, each of which is still true:
--
--   1. *"An audiobook is not a printing of a work we hold — it is a different
--      object, in a different catalog."* A `work` row is this catalog's claim
--      about a book it holds; 400 of them would move the boundary between the
--      two catalogs, which `PLATFORM.md` §2.2 says nothing may do.
--   2. *"A cache of another system's rows, never a source of truth."* `work` is
--      the source of truth. Rows written by a script from a file on another
--      repo's disk are not, and `ON DELETE CASCADE` from a table nobody may
--      write is the only honest way to say so.
--   3. *"`copy` deliberately cannot reference it."* A work row can be lent,
--      priced, sold and wished for the moment it exists. None of that is true of
--      an audiobook we do not administer.
--
-- And a fourth, from the wishlist: **a `work` row means "the catalog knows this
-- book", which stopped meaning "we have it" the moment `copy.status = 'wanted'`
-- became reachable.** `completeness-wishlist-relations.md` §2.3 records two bugs
-- that cost a browser session each, both from that one conflation. Four hundred
-- rows that mean a third thing again — "somebody else's catalog has it" — is the
-- same mistake at scale.
--
-- ## The key is `(series, index_sort)`, and that is what makes it safe
--
-- A gap rung *is* a series and a number, and nothing else: the whole point of
-- `completeness.ts` is that it never has a title for an `interior` or `earlier`
-- hole. So the join has to be on the number line, and it is — which means
-- **there is no title matching here and therefore no containment guessing.**
-- That matters: containment is precisely the rung that produced the old flat
-- lie *"All 5 held on audio"* on `/series/Tamer: King of Dinosaurs`, where five
-- volumes all matched one generic series-level row. See `signatureOf` in
-- `SeriesDetailPage.tsx`.
--
-- `audiobook_catalog/site/catalog.csv` carries `series` and `series_index_sort`
-- as first-class curated columns, so the answer is read, not inferred.
--
-- ## ⚠️ This table adds no rungs to any ladder. It annotates existing ones.
--
-- Every row written here has a matching `series_volume` row, by construction:
-- `backfill-series-volumes.mjs` walks the same CSV, folds the series name the
-- same way, and keeps the same one-row-per-index rule. So `highestKnown` — the
-- ceiling that `completeness.ts` says is "what stops this fabricating" — is
-- unchanged by this migration. Nothing here can invent a volume; it can only say
-- "that one, you have".
--
-- ## `series` is OUR spelling, and the fold happens in the script
--
-- The same decision `series_volume` made, for the same reason: the read path
-- joins `work.series` exactly and no fold runs at query time. The two catalogs
-- disagree about spelling ("All the Skills" there, "All The Skills" here) and
-- `scripts/backfill-audiobook-holdings.mjs` resolves that on the way in, with
-- `normaliseTitle` — the project's ONE fold, and the same one
-- `backfill-series-volumes.mjs` has always used for exactly this join.
--
-- Measured over the 331 distinct series spellings in that CSV on 2026-08-11, the
-- fold produces 329 keys. Both collisions are the SAME series spelled two ways —
-- `Star Justice, Book` / `Star Justice Book`, and `Dark Healer` / `The Dark
-- Healer`. Zero distinct series were conflated. The second pair is the argument
-- against `normaliseUniverseText` in one line: it keeps leading articles on
-- purpose, so it would file one series as two.
--
-- `audiobook_series` keeps their spelling beside ours anyway — migration 0010's
-- rule, and the only way a wrong mapping is ever noticed by eye.

CREATE TABLE audiobook_series_holding (
  -- ⚠️ OUR spelling of the series name, so this joins `work.series` exactly.
  series            TEXT NOT NULL,
  -- The volume's place on the number line, as the sibling catalog states it.
  -- REAL because 2.5 and 3.5 are ordinary here (Edgedancer, Dawnshard).
  index_sort        REAL NOT NULL,

  -- Their title and their spelling of the series, stored rather than re-derived.
  title             TEXT NOT NULL,
  authors           TEXT,
  audiobook_series  TEXT NOT NULL,
  index_display     TEXT,
  -- Relative to `audiobook_catalog/site/`. Recorded because the file is there.
  cover_href        TEXT,

  -- ⚠️ How the two catalogs' SERIES NAMES were proved to mean the same series.
  -- Not the same question as migration 0010's `matched_via`, which is about one
  -- title meeting another.
  --
  --   'work_match'  — a work we hold in this series was matched to an audiobook
  --                   row by `matching.ts` (title AND author), that row is filed
  --                   under this audiobook series, and the two catalogs give it
  --                   the SAME volume number. One independently identified book
  --                   therefore corroborates the name mapping and the numbering
  --                   together. The ladder may say AUDIO.
  --   'fold'        — the names merely fold onto the same key. Nothing has
  --                   confirmed that they are the same series, or that the two
  --                   catalogs number it alike. The ladder must say AUDIO?.
  --
  -- The hedge is the same rail `SeriesDetailPage` already applies to a
  -- containment match, and it exists for the same reason: a claim the app cannot
  -- evidence must look different from one it can.
  series_matched_via TEXT NOT NULL
                        CHECK (series_matched_via IN ('work_match', 'fold')),

  -- Only one value today. Present so a second audio source is a row and not a
  -- migration — migration 0010's `source` column, and its reasoning.
  source            TEXT NOT NULL DEFAULT 'audiobook_catalog'
                        CHECK (source IN ('audiobook_catalog')),

  first_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),

  -- Marked, never deleted — migration 0003's rule and migration 0010's. A row
  -- vanishing because the other catalog renamed a series looks identical to the
  -- audiobook having been returned. Readers filter on `stale_at IS NULL`.
  stale_at          TEXT,

  -- One row per rung. The upsert keys on it, so a second script run is a no-op.
  PRIMARY KEY (series, index_sort)
);
