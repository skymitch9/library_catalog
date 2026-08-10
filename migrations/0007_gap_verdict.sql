-- Answers, so they stop looking like gaps.
--
-- ⚠️ Additive only. Nothing here alters an existing table, and the research
-- tables this works alongside — `research_run` and `research_finding` — have
-- existed since migration 0001 and are untouched.
--
-- ## Why a table and not a null
--
-- A blank column says one of three completely different things:
--
--   1. Nobody has looked.
--   2. Somebody looked, and there is genuinely no such thing.
--   3. Somebody looked, and nobody knows.
--
-- Only the first is a gap. The other two are work already done, and a catalog
-- that cannot tell them apart re-buys them on every pass — with an LLM in the
-- loop, literally re-buys them.
--
-- This is not a hypothetical. Measured against production on 2026-08-10: **13 of
-- 116 works have no series, and all 13 are answers.** Eleven are true
-- standalones, two are genuinely unsettled, and every one of the thirteen was
-- researched by hand on 2026-08-10 with its sources written down in
-- `scripts/series-overrides.json`. That file already draws exactly this
-- distinction, in a `verdict` of `series` / `standalone` / `unknown` with a
-- mandatory `source` array; this table is the same idea where the app can see it.
-- `scripts/seed-gap-verdicts.mjs` copies those thirteen across.
--
-- ## Why `source` is NOT NULL
--
-- The same rule `series_check.known_total` and `series_volume` already enforce,
-- and for the same reason: an unsourced verdict is indistinguishable from data
-- once stored, and nothing later can tell them apart. `series-overrides.json`
-- says it plainly — *"An entry with no source is a bug, not a shortcut."*
--
-- There is deliberately **no `found` verdict**. A value that was found is written
-- into the column it belongs in; a row here beside it would be a second copy of
-- the same fact, free to drift.

CREATE TABLE gap_verdict (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id     INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,

  -- A `DETAIL_FIELDS` value from packages/core/src/constants.ts. Deliberately
  -- not a CHECK constraint: the list is expected to grow as the catalog learns
  -- what else is worth asking, and a CHECK here would make each addition a
  -- table rebuild. `packages/core/src/gaps.ts` is the one place that decides
  -- what a field name means, and an unrecognised one simply matches no gap.
  field       TEXT    NOT NULL,

  -- 'none'  — this book genuinely has no such thing (a true standalone).
  -- 'unknown' — looked, and it is not settled anywhere reachable.
  verdict     TEXT    NOT NULL CHECK (verdict IN ('none', 'unknown')),

  -- ⚠️ NOT NULL. Where the answer came from: a URL, a run id, "the EPUB's own
  -- metadata", "researched 2026-08-10, see series-overrides.json".
  source      TEXT    NOT NULL,
  note        TEXT,

  -- The `research_run` that proposed it, when one did. Null for a hand-entered
  -- verdict and for anything seeded from series-overrides.json, which predates
  -- the pipeline entirely.
  run_id      INTEGER REFERENCES research_run(id) ON DELETE SET NULL,

  decided_by  INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at  TEXT    NOT NULL DEFAULT (datetime('now')),

  -- One answer per field per book. Changing your mind is an UPSERT, not a second
  -- row: two verdicts disagreeing about the same field is the state this whole
  -- table exists to prevent.
  UNIQUE (work_id, field)
);

CREATE INDEX idx_gap_verdict_work  ON gap_verdict(work_id);
CREATE INDEX idx_gap_verdict_field ON gap_verdict(field);
