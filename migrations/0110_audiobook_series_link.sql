-- "Yes — that IS the same series, and I own those." — the owner settling a series
-- mapping the two catalogs cannot settle between themselves.
--
-- ## The case, measured
--
-- Migration 0090 grades every series mapping `work_match` or `fold`, and the
-- grade decides whether a rung reads *"you own this on audio"* or the hedged
-- *"possibly on audio"*. `work_match` requires **one volume present in BOTH
-- catalogs**, matched by title and author, and agreeing on its number — that pair
-- is what corroborates the name mapping and the numbering together.
--
-- Measured against production 2026-08-12, exactly two series are hedged, and
-- neither can ever stop being:
--
--   • **Arcane Pathfinder** — this catalog holds book **5**; the audiobooks are
--     1–4. Rungs 1, 2, 3 and 4 all read AUDIO?.
--   • **Legion** — this catalog holds 1 and 2; the only audiobook is **4**, the
--     omnibus *The Many Lives of Stephen Leeds*. Rung 4 reads AUDIO?.
--
-- ⚠️ **The overlap is empty in both, and that is not a coincidence — it is the
-- rule eating itself.** `work_match` needs a volume the two catalogs share, and
-- the whole purpose of `audiobook_series_holding` is the volumes they do *not*
-- share. So the series most in need of the answer are the ones structurally least
-- able to earn it, and no number of `backfill:audiobooks` runs will move them.
-- The series names are byte-identical on both sides in both cases.
--
-- The owner checked each one by hand and was right every time. That is a source.
-- This table is where it goes.
--
-- ## ⚠️ Why this is a table and not a third value in `series_matched_via`
--
-- Because the script would erase it. `backfill-audiobook-holdings.mjs` upserts
-- with `series_matched_via = excluded.series_matched_via`, so a `'confirmed'`
-- written into that column survives exactly until the next run and then silently
-- reverts — the rungs would start hedging again with nothing to show why. **A
-- script-owned column cannot hold a human decision.** `series_volume` reached the
-- same conclusion from the other side and protects `source = 'manual'` with a
-- CASE in its own upsert; a separate table needs no such guard.
--
-- ## ⚠️ A decision, NOT a claim about the world — and the ONE that is both
--
-- Migration 0100's rule was that a skip costs no source because a preference
-- cannot be false. This one is different and the difference matters: **"these two
-- names are the same series" CAN be false.** It is a claim, and it is being
-- accepted on the owner's authority rather than on evidence.
--
-- So it is graded as its own thing. `AudioSeriesMatch` gains `'owner'` rather
-- than the rung being promoted to `work_match`, and the page says *"you confirmed
-- the series match"* rather than pretending a work corroborated it. Two facts,
-- one of them checkable, and the app must not launder the second into the first
-- — that is the whole rail this feature is built out of.
--
-- What it buys is real: the rung leaves the missing count, exactly as a
-- `work_match` rung does, so the sentence stops telling the owner they lack books
-- that are in the house.
--
-- ## ⚠️ `audiobook_series` is stored, and it is a GUARD and not decoration
--
-- The confirmation is about a specific **pair of names**, not about our name
-- alone. If the sibling catalog later refiles these books under a different
-- series — a rename, a re-import, a split — the fold produces rows for a mapping
-- nobody has ever looked at, and a confirmation keyed only on our spelling would
-- silently authorise them.
--
-- So the read path compares this column against the live
-- `audiobook_series_holding.audiobook_series` and only upgrades a rung when the
-- two agree. A rename therefore reverts those rungs to AUDIO? and asks again,
-- which is the correct behaviour: the owner confirmed one thing and the world
-- became another.
--
-- ## What it does NOT do
--
-- ⚠️ **It adds no rungs to any ladder, and it cannot raise `highestKnown`.** Like
-- migration 0090 it only ever annotates a rung that already exists, and for the
-- same reason: `completeness.ts` calls that ceiling "what stops this fabricating".
-- Confirming a mapping is not evidence that any volume exists — `series_volume`
-- is the only table that says that.
--
-- Withdrawing is a plain DELETE, as in migration 0100 and for the same reason:
-- nothing imports these rows, so a row disappearing cannot be mistaken for
-- anything else. A person made it and is allowed to change their mind.

CREATE TABLE audiobook_series_link (
  -- ⚠️ OUR spelling — matches `work.series`, `series_volume.series` and
  -- `audiobook_series_holding.series` exactly. No fold at read time; migration
  -- 0090's header carries the argument.
  --
  -- One confirmation per series, so re-confirming with a better note is an
  -- UPSERT rather than two rows disagreeing.
  series            TEXT PRIMARY KEY,

  -- ⚠️ THEIR spelling, as it stood when the owner looked at it. The guard — see
  -- the header. A rung is only upgraded while this still matches the live
  -- `audiobook_series_holding.audiobook_series`.
  audiobook_series  TEXT NOT NULL,

  -- Optional, unlike `series_gap_skip.reason`. There is nothing to explain six
  -- months on: the rung already prints both series names beside each other, so
  -- "why is this unhedged" is answered on the page itself. Room for the case
  -- that needs a word anyway — "audiobook 4 is the omnibus of 1-3".
  note              TEXT,

  confirmed_by      INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  confirmed_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
