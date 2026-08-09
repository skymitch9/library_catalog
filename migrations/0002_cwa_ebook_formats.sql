-- `edition.format` learns the formats Calibre-Web Automated actually produces.
--
-- `docs/EBOOK_PIPELINE.md` (decision 2026-08-09) puts CWA underneath this
-- catalog as the ebook storage and conversion engine, and names
-- `work → edition → copy` as the representation it feeds. Migration 0001 was
-- written before that decision landed and offers three ebook formats:
-- `ebook_epub`, `ebook_kindle`, `ebook_pdf`.
--
-- CWA converts to and manages **EPUB, MOBI, AZW3, KEPUB and PDF**. Three of
-- those have nowhere to go in the enum above, and `ebook_kindle` is worse than
-- missing — it is ambiguous. It reads as "a Kindle thing", which could be a
-- `.mobi` file, an `.azw3` file, or an Amazon licence with no file at all. That
-- last one is a genuinely different kind of object: it has an ASIN, no bytes,
-- and cannot be sent to a device by us.
--
-- So:
--
--   ebook_epub   unchanged
--   ebook_pdf    unchanged
--   ebook_mobi   new — CWA conversion target
--   ebook_azw3   new — CWA conversion target
--   ebook_kepub  new — CWA conversion target, and what Kobo sync wants
--   ebook_kindle KEPT, and re-scoped to mean the LICENCE: a book in the Amazon
--                library with an ASIN and no file we hold. Phase 0 measured that
--                this population is large — 16 of 30 sampled titles have no Open
--                Library record at all and are overwhelmingly Kindle Unlimited
--                and Audible-native. They are real editions and must be
--                catalogable without pretending a file exists.
--
-- ## Why a table rebuild
--
-- SQLite cannot alter a CHECK constraint in place. The table is rebuilt the same
-- way board game migration 0017 rebuilt `scan_job`, preserving rows and the
-- AUTOINCREMENT high-water mark via the explicit id column.
--
-- This is safe **because `edition` is empty in every environment** — verified
-- 2026-08-09: no remote database exists yet (wrangler.toml still carries a
-- placeholder database_id) and the local D1 has only two `work` rows created by
-- an API smoke test, with no editions. `copy.edition_id` references it with
-- ON DELETE SET NULL and is also empty, so the implicit DELETE that DROP
-- performs removes nothing and orphans nothing.
--
-- ⚠️ If this migration is ever re-run against a database that HAS editions, the
-- INSERT…SELECT below carries them across unchanged — but any row already
-- storing a format outside the new list would violate the new CHECK and abort
-- the migration. That is the correct failure: it means a format was invented
-- somewhere without being added here.

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
                                            'kindle', 'file', 'research', 'cwa')),
  source_url      TEXT,
  -- CWA owns the file; this catalog owns the fact that we have one.
  --
  -- Deliberately NOT a filesystem path. A path is a fact about one machine's
  -- mount layout and goes stale the first time a volume moves, which the Docker
  -- separation in EBOOK_PIPELINE.md makes likely rather than hypothetical. The
  -- Calibre book id is stable within the CWA library and is what `calibredb`
  -- takes, so it is the identifier worth storing.
  cwa_book_id     INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO edition_new
  (id, work_id, isbn13, isbn10, asin, format, edition_name, publisher,
   published_year, pages, language, cover_url, source, source_url, created_at, updated_at)
SELECT
   id, work_id, isbn13, isbn10, asin, format, edition_name, publisher,
   published_year, pages, language, cover_url, source, source_url, created_at, updated_at
FROM edition;

DROP TABLE edition;

ALTER TABLE edition_new RENAME TO edition;

CREATE INDEX idx_edition_work   ON edition(work_id);
CREATE INDEX idx_edition_format ON edition(format);
CREATE UNIQUE INDEX idx_edition_isbn13 ON edition(isbn13) WHERE isbn13 IS NOT NULL;
CREATE UNIQUE INDEX idx_edition_asin   ON edition(asin)   WHERE asin   IS NOT NULL;
-- One CWA library row is one edition here. A second edition claiming the same
-- Calibre book means the importer matched twice, which is a bug to refuse
-- rather than a duplicate to discover later on a shelf list.
CREATE UNIQUE INDEX idx_edition_cwa ON edition(cwa_book_id) WHERE cwa_book_id IS NOT NULL;

PRAGMA foreign_keys = ON;
