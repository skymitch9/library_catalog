-- The standing audits gain a clock, and therefore need somewhere to remember.
--
-- Platform inventory §7 rows #4 (`scripts/check-cover-health.mjs`) and #5
-- (`scripts/audit-series-aggregates.mjs`) became routes + crons on 2026-09-06.
-- Both are READ-ONLY: they compute findings and write nothing to any catalog
-- table. What they do need is a place to say *when did this last run, and what
-- did it find* — because a script is started by a person who reads its output,
-- and a cron has no reader at all.
--
-- ⚠️ **ONE TABLE FOR BOTH AUDITS, and for every audit after them.** The
-- audiobook sweep got `audiobook_sweep_run` (migration 0470) because its rows
-- carry a sweep-shaped plan. These do not: an audit run is a name, a verdict, a
-- count and a JSON blob, and that shape does not vary per audit. Two tables here
-- would mean two `/api/health` readers, two sets of helpers and a third
-- migration the day a third audit lands — while `audit` as a COLUMN costs one
-- index and answers "what audits exist here" with a `SELECT DISTINCT`.
--
-- ⚠️ **It is deliberately NOT a generalisation of `audiobook_sweep_run`.** That
-- table stays where it is. Folding it in would be a data migration of live rows
-- for tidiness, on a table `/api/health` reads on every status-page load, on two
-- instances — all cost, no answer improved.

CREATE TABLE audit_run (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  -- WHICH audit. ⚠️ No CHECK, the same posture `audiobook_sweep_run.state` and
  -- `change_log.entity` take (migration 0120): this vocabulary is expected to
  -- GROW, and a CHECK would make every new audit a migration in the table whose
  -- whole job is to hold audits. The vocabulary of record is `AuditName` in
  -- `packages/db/src/audits.ts`:
  --
  --   cover-health | series-aggregates
  audit        TEXT NOT NULL,

  -- Who asked: 'cron' or 'admin'. The fact worth keeping for the same reason
  -- 0470 keeps it — it is the only way to tell later whether the clock is
  -- actually firing or a person has been quietly carrying the whole feature.
  trigger      TEXT NOT NULL CHECK (trigger IN ('cron', 'admin')),

  started_at   TEXT NOT NULL DEFAULT (datetime('now')),

  -- NULL while in flight. ⚠️ A row that stays NULL for hours is the signature of
  -- a cancelled invocation — the sibling project's `waitUntil`-only bug left run
  -- rows stuck at `running` for eleven hours — so the absence is diagnostic and
  -- must not be defaulted away.
  finished_at  TEXT,

  -- ⚠️ Three verdicts that a person MUST be able to tell apart, plus the one
  -- that means "still going". `AuditState` in `apps/worker/src/lib/audit-run.ts`
  -- is the vocabulary of record:
  --
  --   running   the row was opened and nothing closed it
  --   ok        it RAN and found nothing — the catalog is clean
  --   findings  it RAN and found something a person should look at
  --   failed    it REFUSED, and the reason is in detail_json.detail
  --
  -- ⚠️ `ok` and *no row at all* are the two states that look identical on a
  -- status page and are not remotely the same fact: "audited last night, clean"
  -- versus "this has never run here". `/api/health` reports `lastRunAt: null`
  -- for the second, and the runbook says so in words.
  state        TEXT NOT NULL,

  -- The findings, as COUNTS. ⚠️ Read back by `/api/health`, which is
  -- unauthenticated on purpose — so no title, no author, no cover URL goes in
  -- here. Ids and tallies only, the same rule migration 0470 states for
  -- `detail_json` and for the same reason: one careless spread away from
  -- publishing the household's shelf. The admin route computes the titled list
  -- LIVE, behind `manageUsers`, and stores none of it.
  detail_json  TEXT
);

-- The only question anybody asks of this table: "what happened last time, for
-- THIS audit?" — and `/api/health` asks it once per audit on every status-page
-- load, on both instances.
CREATE INDEX idx_audit_run_audit_started ON audit_run(audit, id DESC);
