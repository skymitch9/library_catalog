-- "What am I missing" — for a line of books rather than a box of cardboard.
--
-- The board game catalog answers this with `game_component` + `component_check`
-- (migration 0016 there), and the shape ports; the *source* does not. There is
-- no BoardGameGeek for books. What exists here, measured 2026-08-10:
--
--   • 104 of 117 works carry a series, across 25 distinct series, and 96 carry a
--     volume number. That is what makes any of this possible at all.
--   • `audiobook_catalog/site/catalog.csv` — 1,075 rows with a **curated**
--     series and volume column. 13 of this library's 25 series have a
--     counterpart there. That is the one free, local, attributable source.
--   • Open Library knows series on `/works/<key>/editions.json` and nowhere
--     else (docs/info/covers-and-series.md §3.1) — but no work here has an
--     `openlibrary_work_id`, so that rung cannot fire yet.
--   • Google Books is dead anonymously (isbn-ladder.md §4.1), and there are 0
--     ISBNs in this catalog.
--
-- ## ⚠️ The load-bearing distinction: what is DERIVED and what is STORED
--
-- **Nothing in this migration is needed to say "you own Cradle 1, 2 and 4, so 3
-- is missing".** That is arithmetic over `work.series_index_sort` and it cannot
-- be wrong. `packages/core/src/completeness.ts` does it with no database access
-- and is the honest core of the feature.
--
-- These tables exist for the *other* half — the half that needs a source:
-- knowing that a series has a book 14 when the highest one you own is 13. A
-- claim like that is not derivable, and inventing it is the specific failure
-- this schema is shaped to refuse. **`series_volume` holds only volumes some
-- named source actually attested.** There is no "expected length" column that a
-- guess could be written into.
--
-- Two tables, for the reason migration 0016 gives in the sibling project: one
-- holds what is known, the other holds *whether anyone has ever looked*. Without
-- the second, "this series has no volumes beyond yours" and "nobody has checked"
-- are the same empty result, and the UI would be telling an owner their shelf is
-- complete on the strength of never having asked.

-- One volume of one series, as some source describes it.
--
-- A row here is NOT a claim that we do or do not own the volume — that is
-- answered by joining `work` on (series, series_index_sort) at read time, which
-- keeps ownership in exactly one place. A row here says only: *this volume
-- exists, and here is who said so.*
CREATE TABLE series_volume (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Matched to `work.series` **exactly**, not fuzzily. The series name is the
  -- join key and it is a string a person curated, so a second normalisation
  -- rule here would be a second place for the two to disagree. The importer
  -- resolves the sibling catalog's "All the Skills" to this catalog's "All The
  -- Skills" *before* writing, and stores the name this catalog uses.
  series        TEXT NOT NULL,

  -- The volume's place on the number line. NOT NULL, unlike
  -- `work.series_index_sort` — a volume we cannot number is a volume we cannot
  -- say anything useful about, and the six *Blade Dance* "Extra" side stories
  -- prove the nulls are real and belong on `work`, not here.
  index_sort    REAL NOT NULL,
  -- What the source printed: "Book 7", "Volume 07", "2.5".
  index_display TEXT,

  -- The volume's own title and author, when the source names them. This is what
  -- turns "you are missing book 14" into "you are missing *Moonrise*, by Selkie
  -- Myth" — and what lets the missing volume be added to the wishlist without
  -- anybody typing it.
  title         TEXT,
  authors       TEXT,

  -- Where the claim came from. There is deliberately no 'guess' and no
  -- 'inferred': a volume with no source has no business being a row.
  --
  --   audiobook_catalog — the sibling catalog's curated series column.
  --   openlibrary       — /works/<key>/editions.json. No rows yet; no work here
  --                       has an openlibrary_work_id. Listed so the importer
  --                       that adds it needs no migration.
  --   manual            — a person typed it. Outranks everything and is never
  --                       overwritten by an import, exactly as `edition.source`
  --                       treats 'manual'.
  source        TEXT NOT NULL
                     CHECK (source IN ('audiobook_catalog', 'openlibrary', 'manual')),
  source_url    TEXT,
  -- Free text for a manual row: *how* it is known. Shown verbatim beside the
  -- volume, because an unexplained claim is indistinguishable from the guessing
  -- this table exists to refuse.
  note          TEXT,

  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- ⚠️ **Marked, never deleted** — migration 0016's rule, and it transfers
  -- exactly. A row silently vanishing from the missing list looks identical to
  -- the owner having bought the book, and that is a fact about their shelf we
  -- would be inventing. A source that stops listing a volume gets a date here
  -- and the volume is still shown, quietly, saying so.
  --
  -- A `manual` row is never marked stale by an import; a person's answer does
  -- not expire because a CSV changed.
  stale_at      TEXT
);

-- One row per volume per series, so a re-import is an upsert and not a
-- duplicate. The whole importer's idempotency rests on this index.
CREATE UNIQUE INDEX idx_series_volume_unique ON series_volume(series, index_sort);
CREATE INDEX idx_series_volume_series ON series_volume(series, index_sort);


-- What we know about the *series*, including whether anybody has ever asked.
CREATE TABLE series_check (
  series        TEXT PRIMARY KEY,
  checked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- Which source was consulted, so 'not_found' means something specific.
  source        TEXT NOT NULL
                     CHECK (source IN ('audiobook_catalog', 'openlibrary', 'manual')),
  -- 'ok'        — the source answered, and `series_volume` holds what it said.
  -- 'not_found' — the source was asked and has no such series. A real answer,
  --               and a different fact from never having asked. 12 of this
  --               library's 25 series are exactly this against the sibling
  --               catalog, measured 2026-08-10.
  outcome       TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'not_found')),
  -- What the last sweep saw, so a re-run can report movement without recounting.
  volumes_seen  INTEGER NOT NULL DEFAULT 0,

  -- ⚠️ **The only place a series length may be asserted, and only by a person.**
  --
  -- NULL is the default and the honest answer for every series in this catalog
  -- today. With it NULL the app says "you own 10 of at least 16" — a lower
  -- bound, which is all the evidence supports. Set it, and the app may say the
  -- series is finished and you have all of it.
  --
  -- No importer writes this and no rung can fill it: `audiobook_catalog` is a
  -- record of what this household bought, not of what a publisher printed, so
  -- its highest volume is a floor and never a total. Deriving a total from it
  -- would produce "6 of 12" with nothing behind the 12, which is the lie that
  -- looks like data.
  known_total   INTEGER CHECK (known_total IS NULL OR known_total > 0),
  -- Required alongside `known_total` by the write path, not by the database:
  -- SQLite cannot express "NOT NULL when that other column is not null" without
  -- a CHECK that also fires on the NULL/NULL case. The API refuses one without
  -- the other.
  known_total_source TEXT,

  note          TEXT
);

-- The sweep takes the least recently checked series first, exactly as the cover
-- check walks URLs in the sibling project.
CREATE INDEX idx_series_check_age ON series_check(checked_at);
