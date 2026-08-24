-- Let edition.source say 'librarything' — an ISBN supplied by LibraryThing's
-- thingTitle API (backfill-missing-isbns.mjs rung 2.5).
--
-- ## Why this exists
--
-- The LibraryThing rung was landing its finds under source='openlibrary'
-- because that was the only free-rung value the CHECK allowed — a provenance
-- that is not true (2026-08 audit HIGH, backfill-missing-isbns.mjs:246). The
-- CHECK is why the honest relabel was blocked; this migration is that unblock.
-- The FindingSourceTier-style rule applies: the column whose whole job is to
-- say where a value came from must not lie, and `revertFinding`/provenance
-- audits need "show me every LibraryThing-sourced ISBN" to be one query.
--
-- ## The trust note that rides with the value
--
-- ⚠️ 'librarything' is deliberately its own value and NOT folded into an
-- existing one because it is LOWER trust: measured live 2026-08-24, the
-- thingTitle response returns only a flat <isbn> list with the title "omitted
-- per vendor terms" and no author — so the rung cannot title-gate its match the
-- way the Open Library and Google Books rungs do. Stamping it distinctly is
-- what keeps those writes findable and revertable if a match was wrong.
--
-- ## Same four-step rebuild as 0002/0320/0321 (SQLite cannot alter a CHECK in
-- place): new table, copy, drop, rename. The column list is 0002's edition_new
-- plus the two columns ALTER-added since — edition_kind (0050) and collects
-- (0060), both CHECK-less — kept in append order. Ids are copied explicitly so
-- nothing downstream moves; AUTOINCREMENT keeps its sequence because
-- sqlite_sequence tracks the max id on insert. FKs are toggled off for the swap
-- exactly as 0002 did.
--
-- ⚠️ If this is ever run against a database holding an edition whose source is
-- outside the new list, the INSERT…SELECT aborts on the new CHECK. That is the
-- correct failure: it means a source value was invented without being added
-- here (and to EDITION_SOURCES in packages/core/src/constants.ts, which this
-- CHECK must stay in lockstep with).

PRAGMA foreign_keys = OFF;

CREATE TABLE edition_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id         INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  isbn13          TEXT,
  isbn10          TEXT,
  asin            TEXT,
  format          TEXT    NOT NULL DEFAULT 'paperback'
                          CHECK (format IN ('hardcover', 'paperback', 'mass_market',
                                            'ebook_epub', 'ebook_mobi', 'ebook_azw3',
                                            'ebook_kepub', 'ebook_pdf', 'ebook_kindle')),
  edition_name    TEXT,
  publisher       TEXT,
  published_year  INTEGER,
  pages           INTEGER,
  language        TEXT,
  cover_url       TEXT,
  source          TEXT    NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'openlibrary', 'googlebooks',
                                            'kindle', 'file', 'research', 'cwa',
                                            'librarything')),
  source_url      TEXT,
  cwa_book_id     INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- ALTER-added CHECK-less since the 0002 rebuild: 0050, 0060.
  edition_kind    TEXT,
  collects        TEXT
);

INSERT INTO edition_new
  (id, work_id, isbn13, isbn10, asin, format, edition_name, publisher,
   published_year, pages, language, cover_url, source, source_url, cwa_book_id,
   created_at, updated_at, edition_kind, collects)
SELECT
   id, work_id, isbn13, isbn10, asin, format, edition_name, publisher,
   published_year, pages, language, cover_url, source, source_url, cwa_book_id,
   created_at, updated_at, edition_kind, collects
FROM edition;

DROP TABLE edition;

ALTER TABLE edition_new RENAME TO edition;

-- The same six indexes 0001/0002/0050 declared, byte-for-byte.
CREATE INDEX idx_edition_work   ON edition(work_id);
CREATE INDEX idx_edition_format ON edition(format);
CREATE UNIQUE INDEX idx_edition_isbn13 ON edition(isbn13) WHERE isbn13 IS NOT NULL;
CREATE UNIQUE INDEX idx_edition_asin   ON edition(asin)   WHERE asin   IS NOT NULL;
CREATE UNIQUE INDEX idx_edition_cwa ON edition(cwa_book_id) WHERE cwa_book_id IS NOT NULL;
CREATE INDEX idx_edition_kind ON edition(edition_kind) WHERE edition_kind IS NOT NULL;

PRAGMA foreign_keys = ON;
