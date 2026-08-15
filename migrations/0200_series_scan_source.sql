-- 0200: a per-series scan against Claude research — a new `source`, and a year.
--
-- ⚠️ Numbered 0200 rather than 0160, following 0050's rule: wide gaps while
-- several agents may be touching this repo at once, so two migrations picked
-- concurrently do not collide on the same number.
--
-- ## The feature
--
-- The series page already computes numeric gaps for free
-- (`packages/core/src/completeness.ts`) and already has a place for a source to
-- attest a volume by name (`series_volume`, migration 0003) and to record that a
-- source was consulted at all (`series_check`, same migration). This adds
-- nothing new to *that* machinery — it only teaches both tables a fourth
-- `source`, so the machinery can be fed by a Claude web-search pass over a whole
-- series instead of only by the audiobook CSV import, an Open Library rung that
-- was never built, or a person typing.
--
-- ## Why a table rebuild and not an ADD COLUMN
--
-- `edition_kind` (migration 0050) argues for *no* CHECK on a growable enum, and
-- that argument is sound and is NOT being relitigated here — but these two
-- columns already shipped with a CHECK in migration 0003, before that lesson was
-- learned, and SQLite cannot ALTER a CHECK constraint in place. The honest fix is
-- to widen it, not to strand it. Unlike migration 0008's `app_user` rebuild,
-- **nothing references `series_volume` or `series_check` by foreign key** — grep
-- confirms it — so this is the cheap case: no CASCADE to lose, no stash-and-restore
-- dance, just copy the rows across.
--
-- ## `series_volume.year`
--
-- Nullable, additive, and exactly as optional as `title` and `authors` already
-- are on this table: a source names it when it is cheap to find and says nothing
-- when it is not, and a NULL here has always meant "not stated," never "zero." It
-- exists because "#7 'Title' (2019)" is a more checkable claim than "#7 'Title'"
-- alone, and a scan pass is exactly the case where a source page often states the
-- year right next to the title — free information a person typing a volume by
-- hand usually will not bother chasing.

-- ---------------------------------------------------------------------------
-- series_volume: 'claude_research' joins the CHECK; + year
-- ---------------------------------------------------------------------------

CREATE TABLE series_volume_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series        TEXT NOT NULL,
  index_sort    REAL NOT NULL,
  index_display TEXT,
  title         TEXT,
  authors       TEXT,

  -- The year this volume was first published, as printed on the source page.
  -- NULL means "not stated by the source," same rule as title and authors.
  year          INTEGER CHECK (year IS NULL OR (year BETWEEN 1000 AND 2200)),

  -- 'claude_research' is the new rung: a model with a web-search tool, reading
  -- whatever the free rungs above it could not (isbn-ladder.md §4.2 — roughly
  -- half this library has no free record anywhere). Ranked below 'manual' by
  -- `upsertSeriesVolume`'s ON CONFLICT clause exactly as 'audiobook_catalog' and
  -- 'openlibrary' already are: a person's answer is never overwritten by any
  -- import or lookup.
  source        TEXT NOT NULL
                     CHECK (source IN ('audiobook_catalog', 'openlibrary', 'manual', 'claude_research')),
  source_url    TEXT,
  note          TEXT,

  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  stale_at      TEXT
);

INSERT INTO series_volume_new
  (id, series, index_sort, index_display, title, authors, year, source, source_url, note,
   first_seen_at, last_seen_at, stale_at)
  SELECT id, series, index_sort, index_display, title, authors, NULL, source, source_url, note,
         first_seen_at, last_seen_at, stale_at
    FROM series_volume;

DROP TABLE series_volume;
ALTER TABLE series_volume_new RENAME TO series_volume;

CREATE UNIQUE INDEX idx_series_volume_unique ON series_volume(series, index_sort);
CREATE INDEX idx_series_volume_series ON series_volume(series, index_sort);

-- ---------------------------------------------------------------------------
-- series_check: the same new value, nothing else about it changes
-- ---------------------------------------------------------------------------

CREATE TABLE series_check_new (
  series        TEXT PRIMARY KEY,
  checked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  source        TEXT NOT NULL
                     CHECK (source IN ('audiobook_catalog', 'openlibrary', 'manual', 'claude_research')),
  outcome       TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'not_found')),
  volumes_seen  INTEGER NOT NULL DEFAULT 0,
  known_total   INTEGER CHECK (known_total IS NULL OR known_total > 0),
  known_total_source TEXT,
  note          TEXT
);

INSERT INTO series_check_new
  SELECT series, checked_at, source, outcome, volumes_seen, known_total, known_total_source, note
    FROM series_check;

DROP TABLE series_check;
ALTER TABLE series_check_new RENAME TO series_check;

CREATE INDEX idx_series_check_age ON series_check(checked_at);
