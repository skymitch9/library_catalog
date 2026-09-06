# Operating the audiobook association sweep

> **Audience:** Claude sessions first, the owner second.
> **Status:** ✅ TRACKED. **Last verified: 2026-09-05** — measured that day, after
> the series-volume half landed (deploy pair MAIN `6ed4a22b` / friend
> `c57c5173`): both hosts answer `200` on `/api/health` with
> `detail.audiobookSweep.mode = "shadow"` and the new `seriesVolumes`
> sub-object; the admin route answers **401** unauthenticated on both; and the
> script-vs-route parity was re-measured on both instances for the new half
> (§4a).
>
> 🔴 **CORRECTED: the cron HAS fired.** This header previously said *"no
> `audiobook_sweep_run` row exists yet on either instance"*. Measured
> 2026-09-06 05:07 UTC: **MAIN `lastRunAt 04:23:18`, padhard `04:23:12`, both
> `trigger: cron`, `state: shadow`.** The four-hourly tick is real and the
> shadow-tick count toward the ≥42 gate has started on both.
>
> ⚠️ **STILL NOT measured:** the on-add hook has not been seen to fire, the
> admin route has never been called with a real bearer (401 is as far as an
> agent may go), and **no run row carrying the new `seriesVolumes` sub-object
> exists yet** — every row today predates the deploy, so the key reads
> `lastRun: null`. The first tick after `08:23` UTC is what fills it.
>
> **Why it works this way** is [`../info/series-formats-and-audiobooks.md`
> §4.12](../info/series-formats-and-audiobooks.md); the design of record is
> `catalog-platform/docs/info/audiobook-association-route.md`. This file is the
> *how*, and it does not repeat either.

**What it is:** *"do we own this on audio?"*, answered on a clock and on every
book somebody adds, instead of only when the audiobook pipeline next runs.
Two instances, one shared audio pool, one codebase.

⚠️ **Since 2026-09-05 one tick does TWO things.** The same four-hourly
invocation, from the same fetched CSV, also refreshes `series_volume` /
`series_check` — what `npm run backfill:series-volumes` writes. It runs under
the **same** `AUDIOBOOK_SWEEP_MODE`; there is deliberately no second switch. Why:
[`../info/series-formats-and-audiobooks.md` §4.13](../info/series-formats-and-audiobooks.md).

---

## 1. 🔴 It is in SHADOW. It writes nothing.

Today the cron and the on-add hook compute the whole plan and record its counts,
and **STEP 11 of the audiobook pipeline is still doing all the writing** exactly
as it did before. Nothing about the catalogue's behaviour has changed.

`AUDIOBOOK_SWEEP_MODE`, in **both** `[vars]` blocks of
`apps/worker/wrangler.toml`:

| Value | What runs |
|---|---|
| `off` | nothing. No fetch, no run row, no cost |
| **`shadow`** ← today | **both** plans are computed and their COUNTS recorded in `audiobook_sweep_run.detail_json` (`plan` and `seriesVolumes`). **Nothing is written to the holding tables, nor to `series_volume`/`series_check`** |
| `enforce` | the cron writes both halves; the on-add hook goes live |

🔴 **One switch, both halves — and that is a decision, not an oversight.** A
second variable would let an instance shadow the holdings and enforce the
volumes, a state nobody could read off `/api/health` and nothing needs.

⚠️ **It fails CLOSED.** Unset, blank, misspelt, `"on"`, `"true"` — every one of
them resolves to `off`. That is the opposite of `BILLING_POLICY` a few lines
above it in the same file, and deliberately so: billing's worst case is spending
4¢, and this switch's worst case is the stale sweep marking every holding in the
catalog stale on both instances at once.

---

## 2. Is it working? — one curl, no sign-in

```bash
curl -s https://library.heygabi.ai/api/health
curl -s https://padhard.heygabi.ai/api/health
```

Read `detail.audiobookSweep`:

```jsonc
{
  "mode": "shadow",          // the RESOLVED value, not the raw var
  "lastRunAt": null,         // null = it has NEVER run here
  "lastFinishedAt": null,    // set but state 'running' = a cancelled invocation
  "trigger": null,           // cron | on-add | admin — which door fired
  "state": null,             // applied | shadow | in-sync | skipped | failed
  "detail": null,            // 'unchanged' | 'drift' | 'empty snapshot' | 'empty-read' | 'mode off'
  "snapshotRows": null,      // rows PARSED from the CSV, never content-length
  "snapshotAgeHours": null,  // how stale our picture of the sibling catalog is
  "editionsLive": 127,
  "rungsLive": 190,
  "seriesCanonEntries": 6,
  "seriesVolumes": {          // the OTHER half of the same tick
    "lastRun": null,          // what the last tick RECORDED, verbatim — see below
    "volumesLive": 159,       // rows in `series_volume` that are not stale
    "seriesChecked": 84       // rows in `series_check`
  }
}
```

⚠️ **`seriesVolumes.lastRun` keeps three silences apart, and they are not
interchangeable:**

| It reads | It means |
|---|---|
| `null` | the tick never got that far — mode `off`, a refused fetch, or a failed guard. **Also what a run row written BEFORE 2026-09-05 says**, because the field did not exist |
| `{ "planned": null, "written": null, "detail": "scoped run …" }` | the **on-add hook** fired and deliberately declined this half. Guard 3: a run that looked at one book has not consulted a source about the rest of the catalogue. The cron owns it |
| `{ "planned": {…}, "written": null, "detail": null }` | **shadow, working correctly** |
| `{ "planned": {…}, "written": 329 }` | enforce, applied |
| `{ … "detail": "series volumes failed: …" }` | this half failed and the holdings half did **not**. The two share a tick, not a fate |

`planned` carries `seriesCount`, `found`, `notFound`, `volumeUpserts`,
`checkUpserts`, `newVolumes`, `manualSkipped` and `statements` — exactly the
numbers the script's dry run prints, which is what makes §4a a comparison
somebody can actually do. 🔴 **Counts only, never a series name**: this route is
unauthenticated on purpose.

⚠️ **The five silences are NOT interchangeable, which is why `detail` exists.**
A refused fetch, a `304`, an in-sync catalogue, a switch left off and a sweep
that never fired all look identical from the holding table.

| You see | It means | Do |
|---|---|---|
| `lastRunAt: null` | it has never run **here** | check the cron is registered (§5) and wait for `:23` |
| `state: "shadow"` | working, writing nothing | this is the expected state today |
| `state: "skipped"`, `detail: "unchanged"` | a `304` — the CSV has not changed | nothing. This is healthy |
| `state: "failed"`, `detail: "drift: 900 rows against 1000 last time (cap 3%)"` | the fetch came back short | look at `https://audiobooks.heygabi.ai/catalog.csv` before touching anything. **Nothing was written** |
| `state: "failed"`, `detail: "empty snapshot"` | the body parsed to zero rows | same. A Pages deploy mid-flight is the usual cause; the next tick heals it |
| `state: "failed"`, `detail: "empty-read"` | D1 returned zero WORKS | this is the phase-0 wrangler bug in Worker form. **Nothing was written**; the next tick heals it |
| `state: "running"` with an old `lastRunAt` and `lastFinishedAt: null` | an invocation was cancelled | not seen yet. Would mean the work outlived its `waitUntil` |
| `seriesCanonEntries` suddenly 0 or much lower | the DEPLOY shipped an empty series canon | rebuild and redeploy; until then every affected rung renders `AUDIO?` |

**`snapshotAgeHours` is the freshness number.** Expect it under ~8: the sibling
pipeline commits ≈3×/day and the cron reads every 4 hours. Twenty-four-plus means
either the CSV has genuinely not changed or the sweep has stopped.

---

## 3. Run it now, or rehearse it — the admin route

Both need an **owner or admin** Firebase ID token (`manageUsers`). A member,
contributor or moderator gets a worded 403 naming the role and the way out; a
`pending` account gets a different sentence, because its fix is different.

```bash
# Rehearse: computes the whole plan, writes NOTHING, whatever the mode is.
curl -s -X POST https://library.heygabi.ai/api/admin/audiobooks/sweep \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"dryRun":true}'

# What did the last run decide?
curl -s https://library.heygabi.ai/api/admin/audiobooks/sweep \
  -H "Authorization: Bearer $ID_TOKEN"
```

⚠️ **Only an explicit `true` is a dry run.** `{"dryRun":"false"}` is a REAL run —
the parse is strict on purpose, because the dangerous direction is a rehearsal
that turns out to have written.

⚠️ **A refused sweep answers `200`, with the reason in words under `says`.** The
REQUEST succeeded; the sweep refused. An HTTP error would put *"the fetch came
back with 40 rows"* and *"the route is broken"* in one bucket, which is the
distinction the run rows exist to keep.

⚠️ Getting the token: it is a Firebase ID token for an `OWNER_EMAILS` address —
the same one the app sends on every `/api/*` call. Read it out of a signed-in
browser's devtools (Network → any `/api/` request → `Authorization`), or from
`localStorage`. It expires in an hour.

**There is deliberately no button anywhere for this.** Not rendering a control
somebody cannot use is the estate rule, and a curl-only surface is the honest
form of it while the whole feature is in shadow.

---

## 4. The instrument that decides the flip — the script beside the route

```bash
npm run backfill:audiobooks -- --remote            # MAIN, dry by default
npm run backfill:audiobooks -- --remote --friend   # padhard
```

🔴 **Never pass `--commit` to compare.** The dry run prints everything the gate
needs.

**Compare against the route's recorded plan** (`detail_json.plan` on the run row,
or the `plan` object the admin `POST` returns):

| Script line | Route field |
|---|---|
| `N work(s) in the REMOTE database` | `plan.workCount` |
| `N audiobook row(s) read from …` | `plan.audiobookCount` |
| `matched an audiobook N` | `plan.matched` |
| `audio editions written N` | `plan.editionUpserts` |
| the rung table's row count | `plan.seriesWithRungs` |
| `N statement(s) to run` | `editionUpserts + editionStales + rungUpserts + rungStales` |

**Measured 2026-09-06, both plans byte-identical on both instances:**

| | MAIN | padhard |
|---|---|---|
| works / audiobook rows | 411 / 1089 | 677 / 1089 |
| matched | 122 | 119 |
| edition upserts / stales | 127 / 0 | 123 / 0 |
| rung upserts / stales | 190 / 0 | 140 / 0 |
| statements | 317 | 263 |

### 4a. The OTHER half — `series_volume`, the same comparison

```bash
npm run backfill:series-volumes -- --remote            # MAIN, dry by default
npm run backfill:series-volumes -- --remote --friend   # padhard
```

| Script line | Route field (`seriesVolumes.planned`) |
|---|---|
| `N series in the REMOTE database` | `seriesCount` |
| `the sibling catalog knows  N` | `found` |
| `never heard of it          N` | `notFound` |
| `N volume(s) this run has not seen before` | `newVolumes` |
| `N statement(s)` — ⚠️ **minus the Open Library rung's** | `statements` |

🔴 **The script counts MORE statements than the route plans, and that is
correct.** Rung 2 (Open Library) is script-only: one serial HTTP call per work
carrying an OL id is a cron tick's whole subrequest budget. Subtract the lines
under `open library:` before comparing, and expect the OL half to wobble between
runs — it is a live third-party fetch.

**Measured 2026-09-05, script and route identical on both instances:**

| | MAIN | padhard |
|---|---|---|
| series | 139 | 313 |
| knows / never heard of | 32 / 107 | 44 / 269 |
| volume upserts / check upserts | 190 / 139 | 140 / 313 |
| statements (rung 1) | 329 | 453 |
| volumes not seen before | 69 | 140 |

🔴 **What those numbers say about the tables today:** `/api/health` reports
**MAIN 159 volumes / 84 series checked** and **padhard 0 / 0**. padhard's
`series_volume` has never been written at all — nobody was running the script on
her instance — which is the size of what enforcing this half would land.

---

⚠️ **A divergence is most likely the series-canon skew.** The route's canon is as
fresh as the last DEPLOY; the script's is as fresh as the last `git pull` of
`catalog-platform`. When they disagree the ROUTE is the stale one, and the fix is
a rebuild-and-deploy, not a code change. Diagnose it; never wave it through.

---

## 5. The crons

```toml
[triggers]              crons = ["7 * * * *", "23 */4 * * *"]
[env.friend.triggers]   crons = ["7 * * * *", "23 */4 * * *"]
```

`23 */4 * * *` — 00:23, 04:23, 08:23 … **UTC**. Six ticks a day against a CSV
that changes about three times.

⚠️ **Both blocks carry the SAME strings, deliberately.** `scheduled()` dispatches
on the string and an unrecognised cron does *nothing*, so a different minute in
the friend block would silently disable HER sweep while the file still looked
configured. `apps/worker/src/lib/audiobook-cron.test.ts` reads the toml and fails
if either block loses either string, or if the two blocks disagree.

⚠️ **A registered trigger is not a working one.** `wrangler deploy` printing
`schedule: 23 */4 * * *` proves it is registered and nothing more. **The proof is
a row:**

```bash
npx wrangler d1 execute library-catalog --remote --config apps/worker/wrangler.toml \
  --command "SELECT id, trigger, started_at, finished_at, state, detail_json
               FROM audiobook_sweep_run ORDER BY id DESC LIMIT 5"
```

…and the same with `library-catalog-2nd --env friend`.

---

## 6. Flipping the mode

**To `enforce` — the gate, and it is a number:**

> 🔴 **≥42 shadow ticks (a week at four-hourly) with ZERO divergences** against
> the script's dry run on the same CSV — ⚠️ **on BOTH halves now**: the
> holdings comparison in §4 *and* the series-volume comparison in §4a. One
> switch flips both, so evidence for one is not evidence for the other.

⚠️ **The clock started 2026-09-06.** The first `audiobook_sweep_run` rows are on
both instances (`04:23` UTC, `trigger: cron`, `state: shadow`), so the tick count
is running — but the rows that carry `seriesVolumes` only begin with the tick
after the 2026-09-05 deploy pair.

Then, and only then: change **both** `AUDIOBOOK_SWEEP_MODE` lines in
`apps/worker/wrangler.toml` to `"enforce"`, in **one commit of its own**, and
deploy the pair. ⚠️ Never as a side effect of an unrelated deploy — that is the
estate's off → shadow → enforce rule, and this switch is the one it was written
for.

```bash
npm run db:migrate:both     # nothing new to apply, but the order is the rule
npm run deploy:both
curl -s https://library.heygabi.ai/api/health   # confirm mode: "enforce"
curl -s https://padhard.heygabi.ai/api/health
```

**🔴 ROLLBACK IS ONE WORD: set the mode to `off`.** Both blocks, one commit,
`npm run deploy:both`. It takes effect on the next tick, needs no migration, and
un-does nothing that was already written — the sweep is idempotent and STEP 11
keeps running regardless, so an `off` instance simply goes back to exactly the
behaviour it had before 2026-09-06.

⚠️ **Rolling the WORKER back is the heavier option and is rarely the right one.**
Migration 0470 is additive (two new tables, nothing altered), so an older bundle
runs fine against the migrated database — but a version rollback also takes back
every unrelated change in the same deploy. Prefer the mode flip.
Version ids live in [`rollback-points.md`](rollback-points.md) and `docs/deploys.log`.

---

## 7. What it costs

| | |
|---|---|
| Money | **nothing.** No model is called. The only external request is one conditional GET |
| Subrequests, cron tick | ~10 of the 50 an invocation gets: 1 fetch, 4 D1 reads, 1 batch, 3 run-row writes |
| Bandwidth | 1.4 MB per tick **only when the CSV changed** — an `If-None-Match` `304` costs a few hundred bytes |
| On an add | one conditional GET, on `ctx.waitUntil`, after the response has gone out |

⚠️ **The on-add hook DOES fetch**, which the design said it must not. There is no
row cache to read instead — migration 0470 stores the etag and the row count, not
the rows. Books are added a handful of times a day against a cron that fetches six
times a day regardless. A KV row cache is the follow-up; §4.12 of the info doc
carries the reasoning.

---

## 8. Where everything is

| Thing | Where |
|---|---|
| The decisions (shared with the script) | `packages/core/src/audiobook-sweep.ts` |
| The one statement list | `packages/db/src/audiobook-holdings.ts` |
| The script's renderer over that list | `scripts/lib/audiobook-sql.mjs` |
| **The series-volume decisions** (shared with `backfill:series-volumes`) | `packages/core/src/series-volumes.ts` |
| **Its one statement list** | `packages/db/src/series-volumes.ts` |
| The `lit()` substitution BOTH renderers use | `scripts/lib/sweep-sql.mjs` |
| The fetch, guards, run row, mode | `apps/worker/src/lib/audiobook-sweep-run.ts` |
| The admin verbs | `apps/worker/src/routes/audiobook-sweep.ts` |
| The status line | `apps/worker/src/routes/health.ts` |
| The on-add hook's callers | `routes/catalog.ts`, `routes/gabi-delegated.ts`, `routes/ingest.ts` |
| The tables | migration `0470_audiobook_sweep_state.sql`; the holdings are `0390` and `0090` |
| The recovery path | `npm run backfill:audiobooks -- --remote --commit` — 🔴 **the script is never retired**; it is the only path that works when the Worker is down |
| The series-volume recovery path | `npm run backfill:series-volumes -- --remote --commit` (and `--friend`) — same rule, plus it is the **only** caller that has the Open Library rung at all |
