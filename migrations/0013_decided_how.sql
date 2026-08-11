-- Who actually decided: a person, or the machine acting on their behalf.
--
-- ⚠️ Additive only. Two nullable columns, no table rebuilt, no existing row
-- touched. Both tables keep every column they had.
--
-- ## Why this column has to exist before auto-apply can
--
-- The details queue used to propose and wait. A person read each finding and
-- pressed Use, and `reviewed_by` recorded which person. That made
-- `review_state = 'accepted'` mean something quite strong: *a human being looked
-- at this value and asserted it*.
--
-- Auto-apply keeps the same row and the same `accepted`, and would quietly
-- destroy that meaning — an accepted finding would no longer tell you whether
-- anybody had ever read it. `reviewed_by` cannot carry the distinction either,
-- because a run is still *triggered* by a person, so their id is the honest
-- answer to "who is responsible" and the wrong answer to "who checked it".
--
-- So the two questions get two columns. `reviewed_by` / `decided_by` stay
-- "on whose authority"; `decided_how` is "was it read first".
--
-- This is the same move `edition.source` and `series_volume.source` already make
-- — provenance stored beside the value rather than inferred from its shape —
-- and the same one `gap_verdict.run_id` makes in this very table. A catalog that
-- cannot tell a machine's guess from a person's assertion cannot ever be audited,
-- and the moment to record it is when it is free.
--
-- ## Values
--
--   'human' — somebody read this and pressed a button.
--   'auto'  — a run applied it unread, because the owner asked for that.
--   NULL    — undecided (still pending), or decided before this column existed.
--
-- ⚠️ NULL is deliberately NOT backfilled to 'human'. Every decision made before
-- this migration genuinely was a human one, so backfilling would be *accurate* —
-- and it would still be wrong to do, because it would put a fact into the column
-- that nothing observed. A NULL that means "from before we recorded this" is
-- honest and is easy to read; an invented 'human' is indistinguishable from a
-- measured one forever after.
--
-- Deliberately no CHECK constraint, following `gap_verdict.field` in migration
-- 0007: the set may grow (a future 'imported', 'rule'), and a CHECK here would
-- make each addition a table rebuild. `packages/core/src/constants.ts` holds the
-- list, and an unrecognised value simply fails to match any filter.

ALTER TABLE research_finding ADD COLUMN decided_how TEXT;

-- The same question about a verdict. An auto-applied `none`/`unknown` finding
-- becomes a `gap_verdict` row, and that row is what stops the question ever
-- being asked again — so "did anybody read this before it silenced the
-- question?" is, if anything, the more important of the two.
ALTER TABLE gap_verdict ADD COLUMN decided_how TEXT;

-- Finding the recent auto-applied batch is the whole undo story, and it is a
-- scan of the table without this. Ordered by the column the UI orders by.
CREATE INDEX idx_finding_decided_how ON research_finding(decided_how, reviewed_at);
