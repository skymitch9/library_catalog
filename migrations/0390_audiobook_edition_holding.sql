-- Two audiobook editions of one book — and the row that knows the series wins.
--
-- ## The bug this closes, measured 2026-08-23 against `catalog.csv`
--
-- Migration 0010 made `audiobook_holding.work_id` a `PRIMARY KEY`, and said why
-- in its own comment: *"The question is 'is there an audiobook of this?', not
-- 'how many'."* That is still the right question for the chip on a series
-- ladder. It is the wrong SHAPE for the work page, because the household really
-- does own two of some books and the tie is settled by nothing:
--
--     catalog.csv:995  "Elantris"                                     series NULL   narr. full cast
--     catalog.csv:996  "Elantris - Tenth Anniversary Special Edition" series Elantris, vol 1, narr. Jack Garrett
--
-- One `work_id` key, two rows, last write wins — and the edition that KNEW the
-- series is the one that lost. Work 514 therefore shows an audiobook with no
-- series while the fact that would have filled the series column sat in a row
-- that could not be stored. The owner saw exactly that on
-- <https://library.heygabi.ai/works/514>.
--
-- ## The shape: a table keyed per edition, and a VIEW under the old name
--
-- Six readers name `audiobook_holding` (`packages/db/src/series.ts`,
-- `works.ts`, `apps/worker/src/routes/audiobook-mapping.ts`, `reviews.ts`,
-- `warnings.ts`, and the ebook twin's docs). Every one of them wants ONE row
-- per work — a chip, a link, a content-warning key — and none of them is
-- improved by learning to fold a set. Exactly one writer exists
-- (`scripts/backfill-audiobook-holdings.mjs`, verified by grep), so the name
-- can become a read-only view without stranding a write path.
--
-- ## ⚠️ The view picks a WHOLE row. It never merges fields.
--
-- Preferring the edition that knows more is a display call and a good one.
-- Stitching `title` from one edition onto `series` from another would be a
-- Frankenstein row that describes no audiobook anybody owns — and
-- `audiobook_holding.title` exists *precisely* so a wrong match is noticeable
-- by eye (migration 0010). A merged row destroys that property silently: the
-- title would still look right while the series beside it came from a
-- different recording. So `ROW_NUMBER()` ranks whole rows and the view emits
-- one of them verbatim.
--
-- The order is "knows the most, then stable":
--
--   1. `(series IS NULL)`        — a row that states a series sorts first.
--   2. `(index_display IS NULL)` — then one that states its volume.
--   3. `audio_key`              — alphabetical, so the answer never depends on
--                                 insertion order or on `rowid` reuse. Two runs
--                                 of the backfill must not swap the row shown.
--
-- ## `audio_key` is `raw_title`, and that is not an arbitrary choice
--
-- It is the sibling catalog's verbatim title — the same string migration 0340
-- added `raw_title` for, because it is what `content_warnings.json` and the
-- audiobook site's own `bookId` are keyed by. Keying editions on it means the
-- edition identity here and the warning identity there are the SAME string,
-- rather than two ids that have to be kept in step. The CSV has no id column to
-- use instead, and its titles are unique per row.
--
-- ⚠️ `raw_title` is nullable — every row written before 0340 has NULL — so the
-- copy below falls back to `title` rather than dropping those rows on the
-- NOT NULL. The next backfill run overwrites them with the real raw title;
-- until then the key is honest about being the only string that row has.

CREATE TABLE audiobook_edition_holding (
  -- No longer the primary key on its own. Same cascade as migration 0010: this
  -- is a cache of another system's rows, so a deleted work takes its cache with
  -- it and nothing of value is lost.
  work_id          INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- ⚠️ The sibling catalog's VERBATIM title (`raw_title`), not the cleaned one.
  -- See the header: this is the content-warning key from migration 0340, reused
  -- as the edition's identity so the two cannot drift apart.
  audio_key        TEXT NOT NULL,

  -- Everything below is migration 0010's column list, unchanged in name, type
  -- and meaning, plus `raw_title` from 0340 and `narrator` (new).
  title            TEXT NOT NULL,
  raw_title        TEXT,
  authors          TEXT,
  series           TEXT,
  index_display    TEXT,
  index_sort       REAL,
  cover_href       TEXT,

  -- Who read it. The one field that tells two editions of the same book apart
  -- at a glance — "Jack Garrett" against a fourteen-name full cast — and the
  -- reason the owner can see WHICH of the two he is looking at. NULL where the
  -- CSV states none.
  narrator         TEXT,

  matched_via      TEXT NOT NULL CHECK (matched_via IN ('exact', 'alias', 'containment')),
  title_similarity REAL,
  via_alias        TEXT,

  source           TEXT NOT NULL DEFAULT 'audiobook_catalog'
                        CHECK (source IN ('audiobook_catalog')),

  first_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),

  -- Marked, never deleted — migration 0003's rule and 0010's, for the same
  -- reason. Readers filter on `stale_at IS NULL`; the work page shows a stale
  -- row with a caveat instead, because hiding it looks identical to "never
  -- matched", which loses the fact that it was true once.
  stale_at         TEXT,

  -- One row per audiobook edition of one work. The upsert keys on this, so a
  -- second script run is a no-op.
  PRIMARY KEY (work_id, audio_key)
);

-- Everything already cached, carried across whole. `raw_title` is NULL for any
-- row predating migration 0340, so the key falls back to `title` — see header.
INSERT INTO audiobook_edition_holding (
  work_id, audio_key, title, raw_title, authors, series, index_display,
  index_sort, cover_href, narrator, matched_via, title_similarity, via_alias,
  source, first_seen_at, last_seen_at, stale_at
)
SELECT work_id, COALESCE(raw_title, title), title, raw_title, authors, series,
       index_display, index_sort, cover_href, NULL, matched_via,
       title_similarity, via_alias, source, first_seen_at, last_seen_at, stale_at
  FROM audiobook_holding;

DROP TABLE audiobook_holding;

-- ⚠️ Same NAME, same COLUMNS, same ORDER as the table it replaces, so every
-- existing reader — including any `SELECT *` — is untouched. New columns
-- (`audio_key`, `narrator`) are deliberately NOT exposed here: a reader that
-- wants them wants the set, and asks `audiobook_edition_holding` directly
-- through `listAudioEditions` in `@lc/db`.
CREATE VIEW audiobook_holding AS
SELECT work_id, title, authors, series, index_display, index_sort, cover_href,
       matched_via, title_similarity, via_alias, source, first_seen_at,
       last_seen_at, stale_at, raw_title
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY work_id
             ORDER BY (series IS NULL), (index_display IS NULL), audio_key
           ) AS edition_rank
      FROM audiobook_edition_holding
  )
 WHERE edition_rank = 1;

-- The series page asks for every audiobook holding in one series at a time —
-- migration 0010's index, recreated on the table that now holds the rows. It
-- went away with the DROP above, so the name is free and kept deliberately:
-- the query that needs it is the same query.
CREATE INDEX idx_audiobook_holding_series ON audiobook_edition_holding(series);
