-- "Does the household pool hold this as an ebook?" — answered from a cache,
-- exactly the shape migration 0010 (`audiobook_holding`) established.
--
-- ## Why this table exists when `edition` already answers the question
--
-- Today it does: 127 `ebook_epub` editions on 126 works record what the ebook
-- ingest stored. But the ebook split design
-- (`catalog-platform/docs/info/ebook-split-design.md`) demotes those rows:
-- ebooks are SHARED-POOL inventory, like audiobooks, not printings of a book
-- this catalog owns — "an audiobook is not a printing of a work we hold — it
-- is a different object, in a different catalog, that happens to be the same
-- book" (0010's words), and after the split that sentence is true of ebooks
-- verbatim. Phase 5 retires the ebook ingest and prunes the file-sourced
-- editions; this table is what keeps "the household has this as an ebook"
-- visible in the UI after they go, the way `audiobook_holding` already keeps
-- "we own this on audio" visible.
--
-- This is phase 4 of six: the holding rows are backfilled FROM the existing
-- edition rows and the UI shows BOTH answers side by side, so phase 5's
-- retirement has visible evidence that the two sources agree before the
-- editions leave.
--
-- ## This is a cache, never a source of truth — 0010's rules, verbatim
--
--   • Nothing in this app may write it except
--     `scripts/backfill-ebook-holdings.mjs` (`npm run backfill:ebooks`).
--   • `copy` cannot reference it, so nothing can lend, sell or price one.
--   • Deleting every row loses nothing — one script run rebuilds it.
--   • Rows are marked `stale_at`, never deleted — migration 0003's rule. A row
--     vanishing because an edition was pruned looks identical to the ebook
--     having been deleted from the library, and only one of those is a fact
--     about this household. Readers filter on `stale_at IS NULL` when they
--     want the live answer, and show the stale row with a caveat when they
--     want the honest one.
--
-- ## One row per work, and `work_id` is the key
--
-- The question is "is there an ebook of this?", not "how many". Work #90
-- carries two ebook editions (measured 2026-08-16); its holding is one row
-- whose `formats` lists what is held. Same rule as 0010: a UI that had to
-- explain two rows would be explaining a distinction the pool does not draw.

CREATE TABLE ebook_holding (
  -- PRIMARY KEY, so the upsert is by work and a second run is idempotent.
  work_id        INTEGER PRIMARY KEY REFERENCES work(id) ON DELETE CASCADE,

  -- The work's title and authors AT DERIVATION TIME. Stored rather than
  -- re-derived — the identity rule: stored keys, never re-derivation — and
  -- kept so that after phase 5 prunes the editions the holding still says
  -- what it is a holding OF, even if the work row is later renamed. When the
  -- two drift, the drift is visible instead of silently papered over — the
  -- same reason 0010 stores the sibling catalog's spelling.
  title          TEXT NOT NULL,
  authors        TEXT,

  -- The ebook FILE formats held, comma-joined in the manifest's own spelling
  -- ('epub', 'pdf' — see `build_ebook_manifest.py`), sorted, deduplicated.
  -- Never `ebook_kindle`: a licence has no file in the pool, so it is not a
  -- pool holding — the same rule `EBOOK_FILE_FORMATS` in @lc/core enforces
  -- for "send to my reader".
  formats        TEXT NOT NULL,

  -- Manifest-relative path of the file (`edition.source_url`, which the ebook
  -- ingest stored verbatim from `ebooks.json`'s `path`). NULL for the one
  -- hand-added edition, which names no file. Recorded because the deep link
  -- and the phase-5 export both want it, and re-deriving it later would mean
  -- re-matching — the thing this whole design refuses to do.
  source_path    TEXT,

  -- Provenance of the edition rows this row was derived from: 'file' means
  -- the ebook ingest saw the file in the manifest; 'manual' means a person
  -- recorded it by hand. Shown, never hidden — 0010's `matched_via` rule: a
  -- weaker claim must read as one. A work with both kinds records 'file',
  -- the stronger evidence.
  edition_source TEXT NOT NULL CHECK (edition_source IN ('file', 'manual')),

  -- How this row was derived. Only 'edition' today: phase 4 reads the stored
  -- edition rows by `work_id` — no titles are re-derived, no matcher runs.
  -- 'manifest' is anticipated for after phase 5, when the editions are gone
  -- and the backfill must read `ebooks.json` and match the way
  -- `backfill-audiobook-holdings.mjs` does; that widening is a new CHECK and
  -- a deliberate decision, not a default.
  derived_via    TEXT NOT NULL CHECK (derived_via IN ('edition')),

  -- Where the underlying data comes from. One value today — the audiobook
  -- repo's pipeline manifest (`site/ebooks.json`), of which the edition rows
  -- are the stored record. Present so a second pool source is a row and not
  -- a migration — the same anticipation 0010's `source` column records.
  source         TEXT NOT NULL DEFAULT 'ebook_manifest'
                      CHECK (source IN ('ebook_manifest')),

  first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),

  -- Marked, never deleted — see the header.
  stale_at       TEXT
);
