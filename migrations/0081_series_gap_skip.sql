-- "I am never buying that one." — a missing volume the owner has decided to skip.
--
-- ## The case, in the owner's words
--
-- The Completionist Chronicles has three Patreon-era shorts — **6.5** *Havoc in
-- the Deathyards*, **11.5** *Jaxon's New Clients*, **13.5** *Poppy's Promise* —
-- that will never be bought. Without this table the series reads incomplete for
-- ever, and three rungs sit on the ladder as reproach. *"If we do series
-- completion we need a way to mark those as not important."*
--
-- ## ⚠️ Why `gap_verdict` cannot answer this
--
-- `gap_verdict` (migration 0007) is keyed `(work_id, field)`. It answers *"this
-- book we own has no series, and that is the answer, not a gap"* — a **detail**
-- gap, on a row that exists. A series gap is the opposite shape: it is
-- definitionally a volume with **no work row**, which is why `completeness.ts`
-- can produce an `interior` gap it cannot even name. There is no `work_id` to
-- key on, and inventing one would be exactly the mistake migration 0080's header
-- refuses.
--
-- So the key is the same one a gap rung actually has: `(series, index_sort)`.
--
-- ## ⚠️ This is a decision, NOT a claim about the world
--
-- Every other assertion in this feature costs a source, because it says
-- something that could be false — `series_volume.source`, `series_check
-- .known_total_source`, `gap_verdict.source`. This one cannot be false: the
-- owner is the only authority on what the owner intends to buy, and asking them
-- to cite a source for their own preference would be theatre.
--
-- `reason` is still NOT NULL, for a different purpose: six months on, "why is
-- 11.5 greyed out" needs an answer, and *"Patreon-only short, not sold"* is a
-- different fact from *"already own it in the omnibus"*. It is a reminder, not
-- an evidence rail.
--
-- ## What the sentence says afterwards, and why it is not "12 of 12"
--
-- Two readings were on the table:
--
--   * *"you own 12 of 12, 3 skipped"* — shortens the series. It is a claim about
--     how long the run is, and only `series_check.known_total` with a source may
--     make one. Skipping a book does not un-publish it.
--   * *"you own 12 of 15 — 3 deliberately skipped, so nothing else is missing"* —
--     keeps the length honest and moves the three out of *missing*.
--
-- The second is what `completenessSentence` prints. A skipped rung leaves
-- `SeriesCompleteness.gaps` entirely and arrives in `skipped` instead, so every
-- count derived from `gaps` — and both chips on the series list — stop counting
-- it, while the ladder still draws it, greyed, with its reason and an undo.
--
-- Withdrawing is a plain DELETE, unlike `series_volume`: an imported row is
-- marked and never deleted because its disappearance would be
-- indistinguishable from a purchase, and nothing imports these. A person made
-- the row ten seconds ago and is allowed to change their mind.

CREATE TABLE series_gap_skip (
  -- Matches `work.series` and `series_volume.series` exactly — this catalog's
  -- spelling. No fold at read time; see migration 0080's header.
  series       TEXT NOT NULL,
  -- REAL, so the Patreon shorts at 6.5, 11.5 and 13.5 are expressible. It does
  -- NOT have to exist in `series_volume`: an `earlier` gap is pure arithmetic
  -- and has no attesting row, and those are skippable too.
  index_sort   REAL NOT NULL,

  -- ⚠️ NOT NULL, as a reminder rather than as evidence. See the header.
  reason       TEXT NOT NULL,
  note         TEXT,

  decided_by   INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at   TEXT NOT NULL DEFAULT (datetime('now')),

  -- One decision per rung. Changing the reason is an UPSERT.
  PRIMARY KEY (series, index_sort)
);
