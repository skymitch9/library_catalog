-- The audiobook sweep gains a clock, and therefore needs somewhere to remember.
--
-- Step 6 of `catalog-platform/docs/info/audiobook-association-route.md` §9.
-- Phase 0 (steps 1–5) made the sweep's DECISIONS shared between the script and
-- the Worker (`packages/core/src/audiobook-sweep.ts`). Nothing there needed
-- state, because a script is started by a person who can read its output. A
-- cron has no reader, so two facts have to survive the invocation:
--
--   1. **what the sibling catalog looked like last time** — so the next tick can
--      conditional-GET it and skip 1.4 MB when nothing changed, and so the
--      mass-drift guard has a number to compare against;
--   2. **what the last run did** — so `/api/health` can answer "is this working"
--      without anybody tailing a scheduled Worker's logs, which is the one place
--      logs are hardest to read (measured in the sibling project 2026-08-13:
--      three separate `wrangler tail` attempts saw nothing).
--
-- ⚠️ **Neither table is a cache of the CSV.** The rows themselves live where
-- they have always lived, in `audiobook_edition_holding` (0390) and
-- `audiobook_series_holding` (0090). These two tables hold only bookkeeping:
-- an ETag, a count, a timestamp, a verdict. If they were dropped tomorrow the
-- sweep would still be correct — it would simply re-fetch, lose its drift
-- baseline for one tick, and report "never run" until the next one.

-- ---------------------------------------------------------------------------
-- The snapshot — one row, rewritten each time the CSV is actually fetched.
-- ---------------------------------------------------------------------------
--
-- ⚠️ **Singleton by CHECK, not by convention.** `id INTEGER PRIMARY KEY CHECK
-- (id = 1)` makes "there is one snapshot" a property the database enforces
-- rather than a rule every writer has to remember. A second row here would be a
-- second answer to "what did the catalog look like last time", and the drift
-- guard would then compare against whichever one it happened to read.
--
-- ⚠️ `row_count` is the guard's whole point and it is the PARSED count, never
-- `content-length`. A truncated body, an origin error page served with a 200,
-- or a Pages deploy caught mid-flight all yield bytes that parse to a smaller
-- set of rows — and the failure this exists to prevent is the stale sweep then
-- marking every holding in the catalog stale, silently, on both instances.
CREATE TABLE audiobook_snapshot (
  id           INTEGER PRIMARY KEY CHECK (id = 1),

  -- The `ETag` header verbatim, quotes and all, exactly as it must be sent back
  -- in `If-None-Match`. NULL means "we have never had one" — the origin is
  -- allowed not to send it, and then every tick is a full fetch, which is
  -- correct and merely more expensive.
  etag         TEXT,

  -- When the body was last actually READ. ⚠️ Not "when a tick last ran": a 304
  -- leaves this alone on purpose, because the question it answers is *how old
  -- is our picture of the sibling catalog*, and a 304 does not refresh the
  -- picture — it only confirms it.
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),

  -- Rows the shared parser produced from that body. The mass-drift baseline.
  row_count    INTEGER NOT NULL,

  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- The run log — one row per tick, whatever the tick decided.
-- ---------------------------------------------------------------------------
--
-- ⚠️ **A refused run is still a run, and gets a row.** That is the entire
-- reason this table is not just three columns on the snapshot: "the sweep did
-- nothing because the fetch came back with 40 rows instead of 1,088" and "the
-- sweep has not fired at all" are different facts with different fixes, and a
-- design that records only successes cannot tell them apart. Every guard in
-- §6.2 writes its refusal HERE, with its numbers, rather than throwing into a
-- log nobody reads.
CREATE TABLE audiobook_sweep_run (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Who asked. ⚠️ The fact worth keeping (§6.3): it is the only way to tell
  -- later whether the on-add hook is working or the cron is quietly carrying
  -- the whole feature.
  trigger      TEXT NOT NULL CHECK (trigger IN ('cron', 'on-add', 'admin')),

  started_at   TEXT NOT NULL DEFAULT (datetime('now')),

  -- NULL while in flight. ⚠️ A row that stays NULL for hours is the signature
  -- of a cancelled invocation — the sibling project's `waitUntil`-only bug left
  -- run rows stuck at `running` for eleven hours — so the absence is diagnostic
  -- and must not be defaulted away.
  finished_at  TEXT,

  -- ⚠️ Deliberately NOT constrained by CHECK. `change_log.entity` carries the
  -- same posture (migration 0120) and for the same reason: this vocabulary will
  -- grow — the mode ladder alone already needs `shadow`, and phases 3 and 4 of
  -- the design will add more — and a CHECK here would make every new verdict a
  -- migration in a table whose whole job is to record verdicts. The vocabulary
  -- of record is `SweepRunState` in `apps/worker/src/lib/audiobook-sweep-run.ts`:
  --
  --   running | applied | shadow | in-sync | skipped | failed
  --
  -- with the WHY in `detail_json.detail` — 'unchanged' (a 304), 'empty
  -- snapshot', 'drift', 'empty-read', 'mode off'.
  state        TEXT NOT NULL,

  -- The plan, the report counts, and the guard numbers, as JSON.
  --
  -- ⚠️ **This is what makes SHADOW mode worth deploying.** In shadow the run
  -- computes the whole plan and writes nothing to the holding tables; the plan
  -- lands here instead, and comparing it against what the script's dry run says
  -- on the same CSV is the §8 phase-2 gate — "zero divergences over ≥42 ticks".
  -- Without a column to put it in, shadow mode would be a run that proves
  -- nothing.
  --
  -- ⚠️ Counts and keys only. No narrator, no description, nothing a person did
  -- not already publish on `audiobooks.heygabi.ai` — this table is read by
  -- `/api/health`, which is unauthenticated on purpose.
  detail_json  TEXT
);

-- The only question anybody asks of this table: "what happened last time?" —
-- and `/api/health` asks it on every status-page load, on both instances.
CREATE INDEX idx_audiobook_sweep_run_started ON audiobook_sweep_run(started_at DESC);
