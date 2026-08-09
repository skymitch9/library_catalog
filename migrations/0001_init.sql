-- library_catalog — initial schema
-- See docs/info/data-model.md, and catalog-platform/docs/LIBRARY_CATALOG.md §6
-- for the design this implements.
--
-- The Board Game Catalog's schema with one axis renamed, and three rules it
-- exists to enforce:
--
--   1. Catalog (facts about the world) is separate from collection (facts about
--      us). Open Library may overwrite the former; it must never touch the
--      latter. Your shelf location survives every re-sync.
--   2. ISBN belongs on `edition`, NEVER on `work`. One work has many ISBNs —
--      hardcover, paperback, book-club, reissue — and putting the identifier on
--      the work is how a reissue becomes a second book you appear not to own.
--   3. Ratings and review text are NOT here. They live in Firestore beside the
--      audiobook reviews, joined on `work.work_key`. See the long note on
--      `user_book` below — this is a deliberate split, not an omission.
--
-- The board game equivalent of `item` is `work`, and the tree is gone: books do
-- not have expansions. What board games expressed as parent/child, books express
-- as `series` + `series_index_sort`, which is the shape `audiobook_catalog`
-- already uses and which is reused here rather than reinvented.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- Identity comes from Firebase Auth (Google SSO) — the SAME Firebase project as
-- `audiobook_catalog`, so one Google account is one person across both sites.
-- The Worker verifies the ID token and reads the `email` claim; this table
-- decides what that person may do.
--
-- ⚠️ `email` is the join to the audiobook catalog, not `id` and not any Firebase
-- uid. That site stores `ab_identity_email` in localStorage and its `isAdmin()`
-- already keys on email precisely because a Google display name can change at
-- any time. Keying on anything else here would re-create the duplicate users
-- this table exists to prevent.
--
-- `firebase_uid` is recorded because it is the only stable identifier if someone
-- ever changes the email on their Google account, but nothing joins on it yet.
CREATE TABLE app_user (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  firebase_uid   TEXT    UNIQUE,
  display_name   TEXT,
  -- Mirrors the name the audiobook site writes on a review, so a review ported
  -- across can be attributed without a second lookup. Lower-cased on write —
  -- that site's review doc ids are `{bookId}_{displayNameLower}`.
  review_name    TEXT,
  photo_url      TEXT,
  role           TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (role IN ('owner', 'reader', 'pending')),
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  approved_by    INTEGER REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE INDEX idx_app_user_review_name ON app_user(review_name);

-- ---------------------------------------------------------------------------
-- Catalog — facts about the world
-- ---------------------------------------------------------------------------

-- A *work*: the thing an author wrote, independent of which printing you hold.
--
-- "The Way of Kings" is one work whether you own the Tor hardcover, the Gollancz
-- paperback, the Kindle file or the Broken Binding signed edition. Open Library
-- models it the same way and its work↔edition graph maps straight onto this.
CREATE TABLE work (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,

  -- As printed on the title page.
  title               TEXT    NOT NULL,
  subtitle            TEXT,
  -- Article-stripped, for ordering. "The Hobbit" sorts under H.
  sort_title          TEXT,

  -- Authors exactly as printed, in the order printed: "Caroline Peckham,
  -- Susanne Valenti". NOT split into rows.
  --
  -- ⚠️ Deliberate, and the reason is a bug this household has already shipped.
  -- `audiobook_catalog` splits author strings on [;,/&] and " and " in two
  -- places, and keeping those two in sync was a real, silent failure. A third
  -- implementation in a third language is how that returns. `splitAuthors` in
  -- packages/core is the ONE implementation; this column stores the input to it.
  authors             TEXT    NOT NULL,
  -- The first name out of `splitAuthors`, folded. Half of `work_key`, stored so
  -- the join is a column comparison rather than a function call per row.
  primary_author      TEXT    NOT NULL,

  -- ⚠️ THE BRIDGE TO THE AUDIOBOOK CATALOG. `normaliseTitle(title) + '|' +
  -- normaliseTitle(primaryAuthor)`, computed ONCE, on write, by
  -- `workKeyFor()` in packages/core — never recomputed at read time and never
  -- reimplemented anywhere else.
  --
  -- Why it must be stored rather than derived: the audiobook site's review docs
  -- are keyed `{slug-of-title-only}_{displayName}`, with no author in the key at
  -- all. Title-only keys collide across authors constantly, which is exactly the
  -- failure LIBRARY_CATALOG.md §3 flags. Recording the composite key here — and
  -- backfilling it onto the existing review docs — is what lets a paperback and
  -- an audiobook of the same book find each other, and what stops two different
  -- books called "Gold" from merging.
  --
  -- NOT unique: two genuinely different works can fold to the same key (a
  -- reissue under a pen name, a translation). Uniqueness here would refuse the
  -- write; a duplicate is visible and fixable, a refused write is a mystery.
  work_key            TEXT    NOT NULL,

  -- The line, not the box. `audiobook_catalog`'s three columns, reused verbatim:
  -- `series_index_sort` orders (1, 2, 2.5, 3), `series_index_display` prints
  -- what the cover actually says ("Book 2", "2.5", "Prequel").
  --
  -- This is what replaces the board game catalog's parent/child tree. Its own
  -- migration 0019 concluded that a line belongs in a column rather than a
  -- parent row, after measuring that tree-matching search returns the whole line
  -- for every hit. Books make that ten times worse — a series is 15 volumes, not
  -- 11 boxes — so books start where that project ended up.
  series              TEXT,
  series_index_sort   REAL,
  series_index_display TEXT,

  first_published     INTEGER,
  -- Open Library's work id, e.g. "OL27448W". Nullable and unset at first: the
  -- join to the audiobook catalog runs on `work_key` today because catalog.csv
  -- has no ISBN and no OL id. This column exists so that join can be hardened to
  -- an identifier later without a migration that touches every row.
  openlibrary_work_id TEXT,
  description         TEXT,
  -- Falls back to the best cover among this work's editions when null.
  cover_url           TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE        INDEX idx_work_key        ON work(work_key);
CREATE        INDEX idx_work_sorttitle  ON work(sort_title);
CREATE        INDEX idx_work_author     ON work(primary_author);
CREATE        INDEX idx_work_series     ON work(series, series_index_sort);
CREATE UNIQUE INDEX idx_work_ol         ON work(openlibrary_work_id)
                                        WHERE openlibrary_work_id IS NOT NULL;

-- The other names one book answers to.
--
-- Ported wholesale from `item_alias` (board game migration 0021) because the
-- case that table was built for is *more* common in books, not less: UK and US
-- editions are routinely retitled outright. "Northern Lights" and "The Golden
-- Compass" are one book. "Harry Potter and the Philosopher's Stone" and
-- "...Sorcerer's Stone" are one book.
--
-- That reasoning is worth re-reading in full before touching the matcher: no
-- similarity threshold can connect those pairs, because there is nothing in the
-- two strings to connect. It is a fact about the world, so it is recorded rather
-- than computed.
CREATE TABLE work_alias (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id    INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  -- As printed. Shown to a person; folded before comparison. No stored fold —
  -- `normaliseTitle` is the fold and a stored copy goes stale the day it changes.
  alias      TEXT    NOT NULL,
  -- 'openlibrary' may be re-imported and overwritten; 'manual' is a person's
  -- answer and a re-import must never delete it.
  source     TEXT    NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('openlibrary', 'manual')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_id, alias)
);

CREATE INDEX idx_work_alias_work ON work_alias(work_id);

-- "Has this work ever been asked for alternate titles?" — distinct from "does it
-- have any". A book with no alternate title is a real answer and must not be
-- re-asked on every pass.
CREATE TABLE alias_check (
  work_id    INTEGER PRIMARY KEY REFERENCES work(id) ON DELETE CASCADE,
  checked_at TEXT    NOT NULL DEFAULT (datetime('now')),
  offered    INTEGER NOT NULL DEFAULT 0,
  outcome    TEXT    NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'not_found'))
);

-- A specific printing, file or licence of a work.
--
-- This is where every identifier lives, and where `format` makes "I own this in
-- audio and paperback but not ebook" a query rather than a feature.
CREATE TABLE edition (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id         INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- ⚠️ ISBN-13 ONLY, digits only, no hyphens, 978/979 prefix, checksum valid.
  -- ISBN-10s off pre-2007 books are converted at the edge by `toIsbn13()` so
  -- nothing downstream ever sees two formats. The 5-digit price add-on printed
  -- beside the barcode and the separate retail UPC on mass-market paperbacks are
  -- NOT ISBNs and must never land here — see `isBooklandEan13()`.
  isbn13          TEXT,
  -- Kept only when it was what was printed, for looking a book up on sites that
  -- still index the old form. Never the join key.
  isbn10          TEXT,

  -- ⚠️ ASIN ≠ ISBN. Kindle-native titles carry a `B0…` ASIN that no ISBN
  -- database knows — measured here, not assumed: 16 of 30 sampled titles from
  -- this household's own library have no Open Library record at all (see
  -- docs/info/isbn-ladder.md), and they are overwhelmingly the KU/Audible-native
  -- ones. For those rows this column is the only identifier that exists.
  asin            TEXT,

  format          TEXT    NOT NULL DEFAULT 'paperback'
                          CHECK (format IN ('hardcover', 'paperback', 'mass_market',
                                            'ebook_epub', 'ebook_kindle', 'ebook_pdf')),
  edition_name    TEXT,
  publisher       TEXT,
  published_year  INTEGER,
  pages           INTEGER,
  language        TEXT,
  cover_url       TEXT,
  -- Where this row's facts came from, so a re-sync knows what it may overwrite.
  -- 'manual' outranks everything and is never overwritten automatically.
  source          TEXT    NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'openlibrary', 'googlebooks',
                                            'kindle', 'file', 'research')),
  source_url      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_edition_work   ON edition(work_id);
CREATE INDEX idx_edition_format ON edition(format);
-- Self-healing, exactly as `edition.barcode` is in the board game catalog: every
-- successful scan writes back here, so the collection gradually becomes its own
-- lookup table and a re-scan of a book you own costs no network call.
--
-- UNIQUE, unlike the board game catalog's plain index: an ISBN-13 identifies one
-- printing by definition, so two rows carrying one is a bug worth refusing at
-- the database rather than discovering as a duplicate on a shelf list.
CREATE UNIQUE INDEX idx_edition_isbn13 ON edition(isbn13) WHERE isbn13 IS NOT NULL;
CREATE UNIQUE INDEX idx_edition_asin   ON edition(asin)   WHERE asin   IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Collection — facts about us. One joint collection; no per-person ownership.
-- ---------------------------------------------------------------------------

CREATE TABLE copy (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Denormalised alongside edition_id so "do we own this book in any form" is
  -- one indexed lookup, and so a copy can exist before its exact printing is
  -- known — the ordinary case when a spine photo produced the row.
  work_id           INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  edition_id        INTEGER REFERENCES edition(id) ON DELETE SET NULL,
  status            TEXT    NOT NULL DEFAULT 'owned'
                            CHECK (status IN ('owned', 'wanted', 'preordered',
                                              'lent', 'sold', 'borrowed')),
  -- Where it physically is: "living room shelf 3", "loft box 2", "Kindle".
  -- Free text on purpose — the space of shelves is open and an enum would be
  -- rewritten every time furniture moved.
  location          TEXT,
  acquired_on       TEXT,
  price_paid_cents  INTEGER,
  currency          TEXT    NOT NULL DEFAULT 'USD',
  vendor            TEXT,
  condition         TEXT    CHECK (condition IN ('new', 'like_new', 'good', 'fair', 'poor')),
  -- Signed, numbered, sprayed edges, exclusive cover — the things Open Library
  -- will never tell you and the tiered research pipeline exists to find.
  is_signed         INTEGER NOT NULL DEFAULT 0 CHECK (is_signed IN (0, 1)),
  edition_notes     TEXT,
  lent_to           TEXT,
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_copy_work     ON copy(work_id);
CREATE INDEX idx_copy_edition  ON copy(edition_id);
CREATE INDEX idx_copy_status   ON copy(status);
CREATE INDEX idx_copy_location ON copy(location);

-- Per-person reading state.
--
-- ⚠️ THERE IS NO `rating` COLUMN HERE, AND THAT IS THE DESIGN.
--
-- Ratings and review text live in Firestore, in the SAME `reviews` collection
-- the audiobook catalog already writes, joined on `work.work_key`. The owner's
-- requirement is that a review written on one site appears on the other and
-- vice versa; a copy in each store plus a sync job is the shape that produces
-- silent drift, and this household has already shipped exactly that bug once
-- (two author-splitters in two languages). One home, two readers.
--
-- What stays here is what has no audiobook counterpart and no reason to leave
-- the database that holds the shelf: whether *this* copy has been read, when,
-- and private notes. "Did I finish the paperback" is a fact about the paperback.
-- "Was the book any good" is a fact about the book, and belongs where the
-- audiobook's answer to the same question already is.
--
-- `rating_cached` is a read-model, not a source of truth: the Firestore value
-- copied in so the collection page can sort by rating without N network calls.
-- Anything that writes it must treat Firestore as authoritative and must never
-- write back the other way.
CREATE TABLE user_book (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id        INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  read_state     TEXT    NOT NULL DEFAULT 'unread'
                         CHECK (read_state IN ('unread', 'reading', 'read', 'dnf', 'reference')),
  started_on     TEXT,
  finished_on    TEXT,
  -- Which format this person actually consumed, when they know. Lets the UI say
  -- "read (audiobook)" against a paperback on the shelf rather than implying the
  -- paperback was the one that got read.
  read_format    TEXT    CHECK (read_format IN ('print', 'ebook', 'audio')),
  notes          TEXT,
  -- Mirror of Firestore. 0.5–5 in half stars — the audiobook site's scale, not a
  -- new one, so a ported review needs no conversion and no rounding.
  rating_cached  REAL    CHECK (rating_cached IS NULL
                                OR (rating_cached >= 0.5 AND rating_cached <= 5)),
  rating_synced_at TEXT,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_id, user_id)
);

CREATE INDEX idx_user_book_work  ON user_book(work_id);
CREATE INDEX idx_user_book_user  ON user_book(user_id);
CREATE INDEX idx_user_book_state ON user_book(read_state);

-- ---------------------------------------------------------------------------
-- Lookup cache — remember what we have already asked the internet.
-- ---------------------------------------------------------------------------

-- Ported unchanged from board game migration 0005, including the decision to
-- store whole-response JSON rather than columns: what a rung returns changes as
-- rungs are added, and a cache needing a migration every time the shape shifts
-- is worse than no cache.
--
-- Deliberately NOT a substitute for the local catalog. `edition.isbn13` is the
-- authoritative "we own this"; this is only "we asked the internet this before".
CREATE TABLE lookup_cache (
  kind        TEXT NOT NULL CHECK (kind IN ('isbn', 'title', 'asin')),
  -- Normalised by the caller: digits only for ISBNs, `normaliseTitle` for
  -- titles. Two spellings of one question must hit one row.
  key         TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, key)
);

CREATE INDEX idx_lookup_cache_age ON lookup_cache(created_at);

-- ---------------------------------------------------------------------------
-- Scan queue — store the decision, compute the fact.
-- ---------------------------------------------------------------------------

-- Ported wholesale, and it matters MORE here than in the source project: every
-- scan reconciles against the physical shelf, the ebook files, and 1,073
-- audiobooks. A scan is a queued job with a review step, never a direct write.
--
-- Three modes, and `isbn` is the cheap one: it has no image, never calls vision,
-- and costs nothing. Recording it as a photo job would make the queue lie about
-- where its titles came from.
CREATE TABLE scan_job (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL DEFAULT 'uploaded'
                CHECK (status IN ('uploaded','reading','read','enriching','review','done','failed')),
  mode          TEXT NOT NULL DEFAULT 'shelf'
                CHECK (mode IN ('shelf','single','isbn','file')),
  -- For an isbn job this is the scanned code; for a photo job, a transient key.
  -- Photos are NEVER stored: captured, sent, read, dropped. No R2 bucket exists
  -- for this app, deliberately — see the board game wrangler.toml note.
  photo_key     TEXT NOT NULL,
  -- Vision output: array of {text, author, position, confidence, note?}
  raw_titles    TEXT,
  -- Enriched: array of resolved candidates with match data.
  enriched      TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT,
  reviewed_at   TEXT
);

CREATE INDEX idx_scan_job_status ON scan_job(status);

-- ---------------------------------------------------------------------------
-- Research staging — the LLM never writes to the catalog directly.
-- ---------------------------------------------------------------------------

-- Every claim lands here with a source and a tier, and a human promotes it.
--
-- ⚠️ Gate before pipeline. `docs/info/cost-reduction.md` in the board game repo
-- records what happens otherwise: 616 rows put in front of a web-search model
-- for $8.30 because the question asked was "what does this row not know" rather
-- than "what is worth buying for this row". For 500 trade paperbacks Open
-- Library is complete and this must never fire. It fires on the signed,
-- numbered, Kickstarted and BookFunnel-delivered minority.
CREATE TABLE research_run (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id        INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  edition_id     INTEGER REFERENCES edition(id) ON DELETE CASCADE,
  tier           TEXT    NOT NULL
                         CHECK (tier IN ('official', 'crowdfunding', 'retail', 'details')),
  model          TEXT,
  effort         TEXT,
  status         TEXT    NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'running', 'done', 'error')),
  error_message  TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  result_json    TEXT,
  -- What the run knew when it ran, so the next pass can tell whether anything
  -- has changed since. Board game migration 0020's reasoning holds unchanged: a
  -- 2027 pre-order asked in 2026 has nothing to find; the same book asked the
  -- week it ships has a publisher listing and reviews. The question did not
  -- change — the world did.
  input_owned    INTEGER,
  input_isbn13   TEXT,
  input_title    TEXT,
  input_year     INTEGER,
  -- Comma-delimited WITH leading and trailing commas, so an exact test is
  -- `instr(unfilled, ',pages,')` and `publisher` cannot match inside
  -- `publisherUrl`.
  unfilled       TEXT,
  triggered_by   INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_run_work   ON research_run(work_id);
CREATE INDEX idx_run_status ON research_run(status);
CREATE INDEX idx_run_tier   ON research_run(tier, work_id);

CREATE TABLE research_finding (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES research_run(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  edition_id    INTEGER REFERENCES edition(id) ON DELETE CASCADE,
  field         TEXT    NOT NULL,
  value_json    TEXT    NOT NULL,
  source_tier   TEXT    NOT NULL
                        CHECK (source_tier IN ('official', 'crowdfunding', 'retail', 'community')),
  source_url    TEXT,
  confidence    REAL,
  review_state  TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (review_state IN ('pending', 'accepted', 'rejected')),
  reviewed_by   INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_finding_work   ON research_finding(work_id);
CREATE INDEX idx_finding_review ON research_finding(review_state);
CREATE INDEX idx_finding_run    ON research_finding(run_id);
