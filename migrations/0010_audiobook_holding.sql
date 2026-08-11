-- "Do we already own this one on audio?" — answered without merging the two
-- catalogs.
--
-- ## Why this table exists at all, when the answer is in a file on disk
--
-- `audiobook_catalog/site/catalog.csv` holds 1,075 curated rows and sits beside
-- this repo. Every backfill in `scripts/` reads it directly. **The Worker
-- cannot.** It is a Cloudflare Worker: no filesystem, no sibling repo, and the
-- CSV is not an asset it ships. That is not an oversight to be worked around —
-- it is why `docs/HANDOFF.md` records that `alsoInAudio` was deliberately
-- dropped from the scan review screen. A field the Worker cannot answer would
-- have answered `false` for every book in the house, which is worse than absent.
--
-- So the answer is *cached*, by the same shape `series_volume` already uses: a
-- script reads the sibling catalog, the project's ONE matcher decides what meets
-- what, and the verdict lands in a table the Worker can read. This table is a
-- **cache of another system's rows**, never a source of truth. Nothing in this
-- app may write it except `scripts/backfill-audiobook-holdings.mjs`, and nothing
-- here may edit an audiobook — that catalog is pipeline-fed three times a day
-- and is read-only to us.
--
-- ## ⚠️ This is NOT an edition
--
-- Open question 5 of `docs/HANDOFF.md` asks whether `edition.format` should gain
-- an audiobook value and answers **no**. `PLATFORM.md` §2.2: nothing merges. An
-- audiobook is not a printing of a work we hold — it is a different object, in a
-- different catalog, that happens to be the same book. Hence a separate table
-- joined on `work_id`, rather than a row in `edition`:
--
--   • `copy` cannot reference it, so nothing can lend, sell or price one.
--   • The collection's format filter cannot reach it, so "any format" keeps
--     meaning "any format of a book in THIS catalog".
--   • Deleting every row loses nothing — one script run rebuilds it.
--
-- ## One row per work, and `work_id` is the key
--
-- The question is "is there an audiobook of this?", not "how many". A work with
-- two audiobook rows (an abridgement, a re-narration) keeps the best match; the
-- alternative is a UI that has to explain a distinction the sibling catalog does
-- not itself draw.

CREATE TABLE audiobook_holding (
  -- PRIMARY KEY, so the upsert is by work and a second run is idempotent.
  work_id          INTEGER PRIMARY KEY REFERENCES work(id) ON DELETE CASCADE,

  -- What the sibling catalog calls it, already stripped of Audible's series
  -- decoration by `cleanTitleWithSeries` — see `scripts/lib/audiobooks.mjs`.
  -- Stored rather than re-derived so the UI can show the name that matched when
  -- it differs from ours, which is the only way a wrong match is ever noticed.
  title            TEXT NOT NULL,
  authors          TEXT,
  -- That catalog's own series spelling and volume, NOT this one's. They differ
  -- ("All the Skills" there, "All The Skills" here) and flattening them would
  -- hide exactly the disagreement worth seeing.
  series           TEXT,
  index_display    TEXT,
  index_sort       REAL,
  -- Relative to `audiobook_catalog/site/`. Not used yet; recorded because the
  -- file is right there and re-running the match to get it later would be silly.
  cover_href       TEXT,

  -- ⚠️ How the match was made, and it is shown in the UI rather than hidden.
  -- `matching.ts` opens with three wrong matches the sibling Board Game Catalog
  -- shipped; `containment` is the rung that produced them, and a containment
  -- match on a 0.7 title score is a claim worth marking as one.
  matched_via      TEXT NOT NULL CHECK (matched_via IN ('exact', 'alias', 'containment')),
  title_similarity REAL,

  -- Which of OUR `work_alias` rows unlocked the match, when one did.
  --
  -- ⚠️ Not the same thing as `matched_via = 'alias'`. That value means the
  -- *audiobook* index matched on an alternate title it holds; this column means
  -- the lookup only succeeded because we asked under a name recorded in
  -- `work_alias` — the pen-name case. *He Who Fights with Monsters* is Travis
  -- Deverell here and **Shirtaloon** in the audiobook catalog, and the author
  -- gate in `matching.ts` rejects the match outright under the printed name.
  -- Recorded rather than flattened because a match that needed an alias is a
  -- match that will silently disappear if that alias is ever removed.
  via_alias        TEXT,

  -- Only one value today. Present so a future second audio source (a library
  -- loan service, a Spotify shelf) is a row and not a migration.
  source           TEXT NOT NULL DEFAULT 'audiobook_catalog'
                        CHECK (source IN ('audiobook_catalog')),

  first_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),

  -- Marked, never deleted — migration 0003's rule, for the same reason. A row
  -- vanishing because a title was edited in the other catalog looks identical to
  -- the audiobook having been returned or removed, and only one of those is a
  -- fact about this household. Readers filter on `stale_at IS NULL`.
  stale_at         TEXT
);

-- The series page asks for every audiobook holding in one series at a time.
CREATE INDEX idx_audiobook_holding_series ON audiobook_holding(series);
