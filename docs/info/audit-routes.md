# The standing audits became routes — as built, 2026-09-06

> **Audience:** Claude sessions first, the owner second. **Status:** TRACKED.
> **Last verified: 2026-09-06.**
>
> This is the **why**. The **how** — reading the health keys, triggering by
> hand, the rollback — is [`../access/audits.md`](../access/audits.md).
>
> ### ✅ What WAS measured on 2026-09-06
>
> | Claim | How |
> |---|---|
> | The conversion changed neither script's printed output | `packages/core/test/audits.test.ts` runs the pre-conversion logic (kept verbatim as an oracle) beside the shared functions on a fixture and compares the BYTES |
> | `audit-series-aggregates.mjs` makes **no** network call | read every import in the file and in `scripts/lib/d1.mjs` |
> | Migration 0480 applied to **both** instances | `npm run db:migrate` and `npm run db:migrate:friend`, both `✅` |
> | Both Workers answer `detail.coverHealth` and `detail.seriesAggregates` | `curl -s …/api/health` on both hosts — see [`../access/audits.md`](../access/audits.md) §1 for the readings |
> | 2,816 tests green, typecheck green | `npm run test` / `npm run typecheck` (2,697 before this work) |
>
> ### ⚠️ What was NOT verified
>
> - 🔴 **No cron tick has been observed.** The first fires at **09:47 UTC**, and
>   the trigger is CLAIMED until an `audit_run` row exists with
>   `trigger = 'cron'` on each instance. This is the same rule the two crons
>   above it carry, and it is not a formality — `wrangler deploy` reporting a
>   registered trigger proves nothing about it firing.
> - **The admin routes were not exercised end to end.** They sit behind
>   `requireAuth`, which needs a Firebase bearer the building session did not
>   have. The refusal shape, the auth gate and the response bodies are pinned by
>   `apps/worker/src/routes/audits.test.ts`; what is unmeasured is a real
>   signed-in call.
> - **No cover URL was probed from a Worker.** Every cover-health test uses a
>   stubbed `fetch`. The script's probes are the same code but a different
>   egress.

---

## 1. Why these two, and why now

The owner asked on 2026-09-05: *"Should we make all the scripts routes? Or at
least the ones we use a lot"* → *"then do the scripts you think are the best for
routes"*. The answer to the first half is **no** —
[`catalog-platform/docs/info/scripts-inventory-2026-09-05.md`](../../../catalog-platform/docs/info/scripts-inventory-2026-09-05.md)
measured **186 scripts, of which 13 should move**. These are rows **#4** and
**#5** of its ranked list.

They earn it for one reason each, and both reasons are about a CLOCK rather than
about a route:

| # | Script | The inventory's words |
|---|---|---|
| 4 | `check-cover-health.mjs` | *"pure HTTP + D1 read, zero disk, and **a report nobody remembers to run is a report that never runs**"* |
| 5 | `audit-series-aggregates.mjs` | *"**a standing alarm with no clock is the exact failure this ask is about**"* |

⚠️ **#5 is the sharper of the two.** That file's own header calls it *"the
standing alarm"* for tier 3 of the bare-series-name rule. Nothing ran it. Nothing
noticed that nothing ran it. And because the set it watches has been EMPTY in
production since the 2026-08-13 cleanup, an alarm that never fired and an alarm
that was never armed produced exactly the same silence.

---

## 2. ⚠️ ONE implementation, two callers — the rule this conversion is judged by

The inventory ends on this, and it is not a style preference:

> ⚠️ *the matcher, the fold, the threshold does not get copied. A route and its
> script share ONE implementation in `packages/core`, or the conversion has made
> the estate worse.*

`packages/core/src/matching.ts` opens with three wrong-game matches the sibling
catalog shipped, **every one from a second similarity function drifting from the
first**. So:

| Layer | File | Holds |
|---|---|---|
| **Decisions** | `packages/core/src/audits.ts` | the cover verdict ladder, the byte floor, the bare-series filter, the per-tick window — and **the report text** |
| **SQL** | `packages/db/src/audits.ts` | the reads, and the `audit_run` helpers |
| **Runners** | `apps/worker/src/lib/{cover-health,series-aggregates}-run.ts` | the fetch, the guards, the run row |
| **Callers** | `scripts/*.mjs`, `routes/audits.ts`, `scheduled()` | thin |

**Two rules were being kept in two places and are now kept in one:** the
script's `const MIN_BYTES = 1000` (the same number `MIN_COVER_BYTES` already
held, arrived at twice) and the four-branch cover verdict ladder.

### 🔴 The report TEXT is in `@lc/core` too, and that is what makes the claim checkable

`packages/core/test/audits.test.ts` keeps the **pre-conversion logic of both
scripts, verbatim**, copied out at commit `85082f2`, and runs it beside the
shared functions on one fixture. The assertion is on the printed **bytes**.

⚠️ That test is only possible because the formatter moved too. A formatter left
in the script would have made *"the script still prints the same thing"* a claim
rather than a measurement — and ⚠️ **do not "tidy" the oracles to call the shared
code**: the moment one imports from `audits.ts`, the file stops testing anything.

---

## 3. The shape, and how it differs from the audiobook sweep

The sweep (§4.11–4.12 of
[`series-formats-and-audiobooks.md`](series-formats-and-audiobooks.md)) is the
precedent for the run row, the never-throws promise and the health key. Three
things are deliberately different:

| | Audiobook sweep | These two audits |
|---|---|---|
| **Writes** | yes — holding tables | 🔴 **never**, to any catalog table |
| **Mode ladder** | `off → shadow → enforce`, fails closed | **none, and none is needed** — there is nothing to enforce |
| **`dryRun`** | the phase-1 instrument | **absent, on purpose** — a POST here is already a rehearsal |
| **Run table** | `audiobook_sweep_run` (0470), sweep-shaped | `audit_run` (0480), generic: `audit` is a COLUMN |

### ⚠️ Why one `audit_run` table and not two

An audit run is a name, a verdict, a count and a JSON blob, and that shape does
not vary per audit. Two tables would mean two `/api/health` readers, two sets of
helpers, and a third migration the day a third audit lands. `audit` as a column
costs one index and answers *"what audits exist here"* with a `SELECT DISTINCT`.

⚠️ It is **not** a generalisation of `audiobook_sweep_run`. That table stays.
Folding it in would be a data migration of live rows, for tidiness, on a table
`/api/health` reads on every status-page load, on two instances — all cost, no
answer improved.

---

## 4. 🔴 The vocabulary: four states, because three of them look like silence

`audit_run.state` is `running | ok | findings | failed`.

| State | Means | What a person does |
|---|---|---|
| *(no row at all)* | it has **never run here** | check the cron and the migration |
| `ok` | it RAN and found **nothing** | nothing — this is the good news |
| `findings` | it RAN and found something | POST the admin route for the titled list |
| `failed` | it **REFUSED**, and said why | read `detail`; **nothing was measured** |
| `running` | in flight, or **cancelled** | a row here for hours means the invocation was killed |

⚠️ **`ok` and "no row" are the two most easily confused and the least alike.**
A status page showing a green tick for both would be the silent-staleness trap
the estate's rules exist to kill. `/api/health` therefore reports `lastRunAt:
null` and `state: null` for "never run" — null-shaped, never zero-shaped, because
a zero reads as *"ran and found nothing"*.

⚠️ **`failed` is never clean.** An audit that could not read the database has
learnt nothing about the catalog.

---

## 5. The cover audit's cap, and why a cap needs rotation

🔴 **250 URLs per tick, concurrency 6, 10-second timeout.**

Main holds ~411 works and padhard ~370, so **two ticks cover either catalog** and
a third is slack. The cap exists because this is the only one of the two audits
that leaves the Worker, and a scheduled invocation's subrequest budget is finite
— the games repo records 50 on the free plan, and *"the account moved to Workers
Paid so it is higher"* is not a number worth betting a silent cron on.

### ⚠️ A cap without rotation is worse than no cap

`ORDER BY id LIMIT 250` audits the first 250 covers **every night, forever**, and
never once looks at the rest — **while reporting itself clean**. So `auditWindow`
in `@lc/core` WRAPS: the tick index is days-since-epoch, the offset advances one
whole cap per day, and the slice runs off the end and back to the front. Every
row is reached within `ceil(total / cap)` days, with no cursor to persist and
nothing to go stale if a tick is missed.

⚠️ **The D1 read is NOT capped** — a read is not a subrequest and 400 rows is
nothing. The window is applied in memory, which is what lets it wrap at all.

### 🔴 `unreachable` is counted apart from `broken`

| Count | Means | Whose problem |
|---|---|---|
| `broken` | the origin ANSWERED, and the answer was not a usable cover | this catalog's |
| `unreachable` | **nothing answered at all** | possibly nobody's — a timeout, a DNS blip, an outage |
| `missingCover` | the work has no cover URL to check | the free ladder's (`backfill-missing-covers.mjs`) |

The script folded the first two together, and that was right for a script: a
person watching it scroll has the reason column. **A cron has no reader.** A
Worker with flaky egress would file every cover in the catalog as broken,
`/api/health` would say so, and the next person would go hunting four hundred
dead covers that were all fine.

⚠️ **The script still prints them under one heading** — that is what the
byte-equality test pins.

---

## 6. ⚠️ What this audit is NOT the instrument for

Two known defects clear the 1,000-byte floor and this audit passes both,
**deliberately**:

- **KI-6** — a Google Books *"COVER COMING SOON"* card is a genuine **4,013-byte
  JPEG**. `check-cover-health.mjs` is named in that entry as *"the WRONG
  instrument"*, and it still is.
- **The 50-pixel smudge** (`docs/TODO.md`) — `…._SX50_.jpg` is **1,980 real
  bytes** of the right book.

Both are findable only by LOOKING at the image. ⚠️ **Do not widen the floor here
hoping to catch them** — it would start failing 25 real covers on main. KI-6
names the instrument that would (a hash deny-list in `verifyCoverUrl`) and the
condition for building it (a **second** hit).

---

## 7. 🔴 Neither audit writes, and neither ever may

A broken cover URL and a bare-series hit are both **questions**.

- `docs/TODO.md`'s padhard **356 *Evocation*** row says it outright: the stored
  cover redirects to an archive.org object answering 503, and the instruction is
  *"wait and re-run … **not cleared: a dead URL may be an outage, and blanking it
  loses where the cover came from**"*. An audit that healed itself would throw
  that away on the first bad afternoon at somebody's CDN.
- ***The Wandering Inn*** is legitimately titled with its series name and
  legitimately owned in two printings. Auto-acting on the series alarm's list
  would delete a real book.

`apps/worker/src/lib/*-run.test.ts` asserts this on the WRITES, not on the return
value: a fake D1 records every statement, and the assertion is that nothing but
`audit_run` was touched.

---

## 8. ⚠️ ONE shared cron for both audits — the choice, and its cost

`"47 9 * * *"`, on **both** `[triggers]` blocks. The alternative was one string
each. Three reasons, in weight order:

1. **The failure this family of tests exists to catch is a STRING that drifted
   between two blocks three hundred lines apart.** Two audits with their own
   strings means **four** entries to keep in step; one shared string means two.
2. **They compete for nothing.** `series-aggregates` makes **zero** subrequests,
   so the games repo's rule about two crons in one minute fighting over a budget
   does not bind — only one of the pair spends any, under an explicit cap.
3. **They answer one question** — *is the catalog quietly rotting?* — read as two
   keys off one `/api/health`.

**The cost, said out loud:** a future audit that genuinely needs its own cadence
must get its own string, and adding it to this list would be the wrong move. The
dispatcher branches by string, so that is a two-line change when it comes.

**Why 09:47 UTC (02:47 Phoenix):** minute 47 is neither `:00` (the world's
stampede), nor `:07` (the details sweep, which the games repo measures spending
46 of 50 subrequests), nor `:23` (the audiobook sweep). 09 UTC is the quietest
hour for a job that asks a few hundred of other people's origins for an image.

**Why daily and no faster:** a broken cover does not un-break itself. The
inventory's point was that a report with **no** clock never runs, not that it
needs a fast one; hourly would probe 6,000 URLs a day to learn what one tick
already knew.

---

## 9. 🟡 A correction to the platform inventory

Its row for `audit-series-aggregates.mjs` reads *"Reads: **D1 + HTTP (Open
Library)**"*.

**Measured 2026-09-06: there is no HTTP.** The script imports `foldSeriesNames`
/`isBareSeriesTitle` from `@lc/core` and `query` from `scripts/lib/d1.mjs`, and
makes no network call of any kind. The Open Library connection is in what the
alarm is **about** (an OL work-level aggregate wearing a series name as a title),
not in how it looks. That is half the reason the two audits can share one
invocation without competing for a budget, so it is worth having straight.

---

## 10. Where everything is

| Thing | File |
|---|---|
| The rules + the report text | `packages/core/src/audits.ts` |
| The byte-equality test (the oracles) | `packages/core/test/audits.test.ts` |
| The SQL + `audit_run` helpers | `packages/db/src/audits.ts` |
| The table | `migrations/0480_audit_run.sql` |
| Shared run bookkeeping + `AUDITS_CRON` | `apps/worker/src/lib/audit-run.ts` |
| The two runners | `apps/worker/src/lib/{cover-health,series-aggregates}-run.ts` |
| The admin routes | `apps/worker/src/routes/audits.ts` |
| The shared refusal | `apps/worker/src/lib/admin-refusal.ts` |
| The cron strings + the dispatcher | `apps/worker/wrangler.toml`, `apps/worker/src/index.ts` |
| The toml-reading guard | `apps/worker/src/lib/audits-cron.test.ts` |
| The health keys | `apps/worker/src/routes/health.ts` |
| **Operating it** | [`../access/audits.md`](../access/audits.md) |
