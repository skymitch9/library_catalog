-- "Yes, this is it" / "Not this one" — the owner's verdict on ONE audiobook
-- recording matched to ONE book, recorded in the edit box.
--
-- ## The ask, verbatim (owner, 2026-09-03 ~14:37 Phoenix)
--
--   "Also I see a lot of books asking if this is the right audio, can we make
--    all of those question ones show the audio even if not sure and then we can
--    confirm if it's right in the edit menu later? Any dramatic misses ping me
--    about"
--
-- Approved as a two-part change the same afternoon (*"Yes do it"*, 15:03):
--
--   1. **DISPLAY** — the `?` comes off the series-ladder chips and the work
--      page's provenance sentence stops asking a question. The hedge survives
--      in the chip's tooltip and in words on the page, pointing at (2).
--      ⚠️ Migration 0010's rule is untouched: provenance is still SHOWN and
--      never hidden. It was reworded, not removed.
--   2. **CONFIRM** — this table. A person looks at the recording and says
--      whether it is the right one.
--
-- Measured before it was built (2026-09-03 ~14:40, both instances live): 8
-- work-level `containment` matches on MAIN (all 0.80–0.82 — seven *Harry
-- Potter … (Full-Cast Edition)* plus *Space Knight Book 1*), 0 on padhard, and
-- 1 stale containment row (work #72, *Tamer Book 11* → "Tamer: King of
-- Dinosaurs") which is the only genuine miss and is already shown lighter.
-- "A lot" was padhard's 27 SERIES-level `fold` rungs, which this table does not
-- touch — see "What this does NOT cover" below.
--
-- ## ⚠️ Why this is a TABLE and not a fourth `matched_via` value
--
-- Because the script would erase it, and migration 0110 already made this exact
-- argument for the series-level twin:
--
--   > `backfill-audiobook-holdings.mjs` upserts with `matched_via =
--   > excluded.matched_via`, so a 'confirmed' written into that column survives
--   > exactly until the next run and then silently reverts […] **A script-owned
--   > column cannot hold a human decision.**
--
-- `audiobook_edition_holding` is a CACHE of another catalog's rows (migration
-- 0010's header: "never a source of truth", and nothing in this app may write
-- it except the backfill). A verdict is the opposite: it is this household's
-- own knowledge, and the backfill must not be able to touch it. Separate table,
-- separate lifetime — three times a day the cache is rewritten and the verdicts
-- sit still.
--
-- The pair is deliberate and the two are NOT interchangeable:
--
--   | | grain | confirms |
--   |---|---|---|
--   | `audiobook_series_link` (0110) | one SERIES | "their series is our series" |
--   | `audiobook_match_review` (this) | one RECORDING of one WORK | "that recording is this book" |
--
-- A series-level rung is confirmed on `/series/<name>`, which already has that
-- control; the work page's Audio tab links to it rather than growing a second
-- answer to one question.
--
-- ## `audio_key` — the recording's identity, and it is not a new one
--
-- The verbatim title the sibling catalog calls the recording:
-- `audiobook_edition_holding.audio_key` (migration 0390), which is
-- `audiobook_holding.raw_title` (0340), which is what `content_warnings.json`
-- and the audiobook site's own `bookId` are keyed by. One string, four
-- surfaces; minting a surrogate id here would be a fifth thing to keep in step.
--
-- ⚠️ **`raw_title` is NULLABLE, so the key falls back to `title`** — exactly as
-- 0390's own copy statement does (`COALESCE(raw_title, title)`). Every row
-- written before 0340 has a NULL `raw_title` until the next backfill run
-- overwrites it, and a verdict recorded against the fallback key would then
-- point at nothing. That is tolerable and deliberate: the row is not deleted
-- (see below), the recording simply reads as un-reviewed again and can be
-- answered a second time. The alternative — keying on `work_id` alone — cannot
-- tell the household's two *Elantris* recordings apart, which is the whole
-- reason 0390 exists.
--
-- ## Rows are never deleted, and a change of mind is an UPSERT
--
-- Migration 0003's rule. A verdict that vanished would be indistinguishable
-- from one nobody ever gave, and "I looked at this and said no" is a different
-- fact from "nobody has looked". Re-deciding rewrites `verdict`,
-- `decided_at` and `decided_by` in place, so there is exactly one standing
-- answer per (work, recording) and no two rows can disagree.
--
-- ## What a verdict CHANGES, and what it does not
--
-- `rejected` hides the recording from the surfaces that would otherwise claim
-- the household owns this book on audio — the work page's Audio section, the
-- series ladder's audio chip, the recording count, the collection's audiobook
-- format filter, the free-details ladder's rung 1, and the machine export the
-- audiobook pipeline stamps "Other versions available" from. It does NOT delete
-- the cache row, and the edit box still lists it with its verdict so the
-- decision is reversible in the place it was made.
--
-- `confirmed` changes only words: the provenance sentence becomes *"Confirmed
-- by you as the right recording."* and the tooltip drops its hedge. It cannot
-- add a holding, raise a count or close a gap — like 0110 it only ever
-- annotates something that is already there.
--
-- ## What this does NOT cover
--
-- ⚠️ **Series-level `fold` rungs (migration 0090) have no `work_id` here** —
-- they are volumes this catalog does not hold, keyed on `(series, index_sort)`,
-- and their confirm mechanism is `audiobook_series_link` on the series page.
-- Nothing in this table can move `maybeOnAudio`, which counts exactly those
-- rungs. Two mechanisms, two grains, one each.

CREATE TABLE audiobook_match_review (
  -- CASCADE like every other work-keyed table: deleting the book takes its
  -- verdicts with it, and there is nothing left for them to be about.
  work_id     INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- ⚠️ The sibling catalog's VERBATIM title — `audiobook_edition_holding
  -- .audio_key`, i.e. `audiobook_holding.raw_title` with a fallback to `title`
  -- where that is NULL. See the header on why the fallback is honest rather
  -- than a bug.
  --
  -- ⚠️ NO foreign key to `audiobook_edition_holding`. That table is a cache the
  -- backfill rewrites three times a day; a REFERENCES here would let a title
  -- edit in the OTHER catalog delete this household's decision, which is
  -- precisely what this table exists to prevent. The route validates the key
  -- against a live row at write time instead — the same posture
  -- `confirmAudioSeries` takes with its rung guard.
  audio_key   TEXT NOT NULL,

  -- Two values, no 'pending'. A row's existence IS "somebody looked"; a
  -- third value meaning "not yet" would make absence and pending two spellings
  -- of one state. Same reasoning as `reviewFindingSchema`'s missing 'pending'.
  verdict     TEXT NOT NULL CHECK (verdict IN ('confirmed', 'rejected')),

  decided_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- The `app_user` id, as TEXT so this survives the account it names. Nullable:
  -- a verdict written by a script or by a user since removed is still a
  -- verdict, and losing the answer to keep the attribution would be the wrong
  -- trade.
  decided_by  TEXT,

  -- One standing verdict per recording per work — the upsert keys on this.
  PRIMARY KEY (work_id, audio_key)
);
