# The standing audits — how to read them, run them, and turn them off

> **Audience:** Claude sessions first, the owner second. **Status:** TRACKED.
> **Last verified: 2026-09-06.**
>
> This is the **how**. The **why** — the design, the cap, the vocabulary, the
> corrections — is [`../info/audit-routes.md`](../info/audit-routes.md).
>
> **What they are.** Two read-only checks that used to be scripts nobody
> remembered to run, and now also fire daily in the Worker on **both**
> instances:
>
> | Audit | Asks | Health key |
> |---|---|---|
> | **cover health** | do the stored cover URLs still answer with a usable image? | `detail.coverHealth` |
> | **series aggregates** | has an Open Library work-level aggregate wearing a series name minted a phantom work? | `detail.seriesAggregates` |
>
> 🔴 **Neither writes anything, ever.** Not to `work`, not to `edition`, not to
> anything but its own `audit_run` row. A finding is a QUESTION for a person.

---

## 1. Read it with no sign-in — the one curl

```bash
curl -s https://library.heygabi.ai/api/health | python -m json.tool
curl -s https://padhard.heygabi.ai/api/health | python -m json.tool
```

The two keys live under `detail` (and, during the envelope transition, at the top
level too — same object, one fact):

```
.detail.coverHealth
.detail.seriesAggregates
```

⚠️ **`curl -I` / `-o /dev/null` report `000` on these hosts** (estate memory,
2026-09-05). Use `-s`, or `-D -` when you want headers.

**Measured 2026-09-06 02:01 UTC, minutes after the deploy — both hosts, both
keys, identical:**

```json
{ "lastRunAt": null, "lastFinishedAt": null, "trigger": null,
  "state": null, "detail": null, "ageHours": null, "findings": null }
```

✅ That is the **"never run"** reading, and it is the correct one: the cron had
not yet reached 09:47 UTC. `ok: true` and `database: "up"` on both; the
pre-existing `audiobookSweep`, `estate`, `gabi`, `universes`, `version` and
`time` keys were all still there — this change is additive and removed nothing.

### 🔴 The four readings, and what each one means

**This is the whole point of the key.** `ok` and *never run* look identical on a
status page and are the opposite fact.

| Reads | Means | Do |
|---|---|---|
| `"lastRunAt": null, "state": null` | **NEVER RUN on this instance** | check the cron is in `wrangler.toml`, and that migration 0480 is applied here |
| `"state": "ok"` | ran, found **nothing** | nothing. This is the good news |
| `"state": "findings"` | ran, found something | POST the admin route (§2) for the titled list |
| `"state": "failed"` | **REFUSED** — read `detail` | 🔴 **nothing was measured.** This is NOT "the covers are fine" |
| `"state": "running"` for hours | the invocation was **cancelled** | the run never finished; look for a deploy or a timeout at that hour |

⚠️ **`"findings": null` with `"state": "failed"` is correct and expected** — a
refused run counted nothing. `"findings": null` with `"state": null` means it has
never run. `"findings": {…}` with all zeros means it ran and everything is fine.
Three different nulls, three different fixes.

### The refusal reasons you can meet

| `detail` | Means |
|---|---|
| `empty-read` | the D1 read returned **zero works**. A real shape — one `--remote` run of a sibling script returned `0 work(s)` and exited 0. Reported as a refusal precisely so it is not read as a clean catalog |
| `no covers to check` | ⚠️ **NOT a refusal** — the state is `ok`. There are works, and none of them has a cover URL |
| `read failed: …` | D1 answered with an error. The message is D1's |
| `run row failed: …` | the audit could not open its own bookkeeping row, so it refused to run at all. Almost always "no such table: audit_run" — **migration 0480 is not applied on this instance** |

### The cover-health counts

```jsonc
"findings": {
  "withCover":    411,  // works claiming a cover, catalog-wide
  "missingCover":   4,  // works with NO cover URL — the free ladder's business
  "checked":      250,  // this tick's window (the cap)
  "deferred":     161,  // rolled to the next nightly tick
  "windowOffset":   0,  // where in the id-ordered list this tick started
  "broken":         2,  // the origin ANSWERED, and it was not a usable cover
  "unreachable":    1,  // nothing answered at all — may be an OUTAGE, not a fault
  "sampleIds":  [356]   // at most 20, so a person has somewhere to start
}
```

🔴 **`unreachable` is not `broken`.** Re-run before changing anything, and
**never blank a cover URL to make the number go down** — a dead URL may be an
outage, and blanking it loses where the cover came from (`docs/TODO.md`, padhard
356 *Evocation*).

⚠️ **`checked` is a WINDOW, not the catalog.** The audit probes 250 URLs a night
and the window rotates daily. **Measured 2026-09-06: main has 411 covers and
padhard 642**, so a full pass takes **2 nights on main and 3 on padhard**. A single
tick's `broken: 0` means *"the 250 I looked at were fine"*.

### The series-aggregate counts

```jsonc
"findings": {
  "seriesKeys":         187,  // distinct folded series names known here
  "multiEditionWorks":   34,  // works carrying 2+ editions — the denominator
  "flagged":              0,  // ⚠️ THE ALARM. Expected to be 0
  "flaggedIds":          []   // never truncated — every one deserves an eyeball
}
```

⚠️ **`flagged: 0` is the normal answer** and has been since the 2026-08-13
cleanup. ⚠️ **`seriesKeys: 0` is a red flag even with `flagged: 0`** — an empty
fold flags nothing and looks exactly like a clean catalog.

---

## 2. Run one by hand

Both are owner-or-admin (`manageUsers`) and both need a Firebase bearer, the same
as every other `/api/admin` route.

```bash
# what the last run decided (no run needed)
curl -s -H "Authorization: Bearer $ID_TOKEN" \
  https://library.heygabi.ai/api/admin/audits/cover-health

# run it now — the response carries the TITLED list
curl -s -X POST -H "Authorization: Bearer $ID_TOKEN" \
  https://library.heygabi.ai/api/admin/audits/cover-health

curl -s -X POST -H "Authorization: Bearer $ID_TOKEN" \
  https://library.heygabi.ai/api/admin/audits/series-aggregates
```

Swap the host for `padhard.heygabi.ai` for the second instance. **Nothing else
changes** — each instance audits its own database.

**Getting `$ID_TOKEN`:** sign in at the site, then in the browser console
`await firebase.auth().currentUser.getIdToken()`. It expires in an hour.
⚠️ In Git Bash, `curl -X POST` against these hosts can report **HTTP 000** —
that trap is in [`gabi-delegated.md`](gabi-delegated.md); PowerShell's
`Invoke-RestMethod` is the way round it.

### ⚠️ There is no `dryRun`, and there is nothing to add one to

The audiobook sweep has one because it WRITES. These do not: a POST here is
already a rehearsal, and every run of it is safe to repeat. A `dryRun` flag would
imply a mode in which they do something else.

### What the POST gives you that the health key does not

The **titled list** — `rows[]`, with the work title, the URL asked for, the
verdict and the reason. ⚠️ It is computed live and **never persisted**: the run
row carries counts and ids only, because `/api/health` reads it back
unauthenticated.

### If you are refused

There are **two different refusals**, and they come from two different places:

| You get | From | Means |
|---|---|---|
| **401** `{"error":"unauthenticated"}` | `requireAuth`, the blanket `/api/*` middleware | **no valid bearer.** Not a permissions problem — you are not signed in at all |
| **403** with `capability`, `role` and a worded `detail` | these routes, via `lib/admin-refusal.ts` | you ARE signed in and your role is not enough — or your account is still `pending`, which says something different because it is a different fix |

⚠️ **Measured 2026-09-06:** a bearer-less `GET`/`POST` to
`/api/admin/audits/*` answers **401 on both hosts**. That terse body is the
estate-wide shape every `/api/*` route shares — the web app turns it into a
sign-in prompt, which is where the "never a bare status" rule is met for it.
🟡 A raw curl still sees only the code; widening that would touch every route on
the Worker and is deliberately **not** done here.

The 403 says what happened, what it needs by name (`manageUsers`) and how to get
it. There is **no UI control** for these routes; curl is the whole surface,
deliberately — preferring not to render a control somebody cannot use.

---

## 3. Run the SCRIPTS instead — and when to

The scripts are **not retired**, and for the cover audit the script is the more
capable instrument: it has **no per-tick cap**.

```bash
npm run check:cover-health -- --remote                    # main, the WHOLE catalog
npm run check:cover-health -- --remote --friend           # padhard, the whole catalog
npm run audit:series-aggregates -- --remote               # main; exits 1 if flagged
npm run audit:series-aggregates -- --remote --friend      # padhard; NEW 2026-09-06
```

⚠️ **`--friend` needs `--remote`** — there is no local copy of the second
instance, and `scripts/lib/d1.mjs` refuses the combination rather than silently
reading the main database.

### 🔴 `audit:series-aggregates --friend` did not exist until 2026-09-06

The script passed `{ remote }` to `query()` and nothing else, so `dbName()`
resolved to the MAIN database on every run and **the alarm had never once looked
at padhard.** It is the same shape as the defect fixed in `check-cover-health.mjs`
on 2026-08-22 (that one switched the fetch BASE to padhard while still reading
main's rows).

⚠️ **It was invisible because the alarm's normal answer is EMPTY** — a clean run
against main looks exactly like a clean run against a catalog nobody read. It was
found only because the ROUTE half runs on both instances, which made the script
the lagging one. **First measurement of padhard, ever, 2026-09-06:**
`309 known series name(s), 4 work(s) with 2+ editions, 0 flagged` — clean.

⚠️ **`check:cover-health` runs under `tsx` now** (it imports TypeScript from
`@lc/core`). `node scripts/check-cover-health.mjs` will not work — use the npm
script.

⚠️ **The script and the route say the same thing, and that is measured**, not
assumed: `packages/core/test/audits.test.ts` runs the pre-conversion script logic
beside the shared functions and compares the printed bytes.

⚠️ **`audit:series-aggregates` exits 1 when anything is flagged.** That is
deliberate (it can sit at the end of a scanning session), and it means a shell
that stops on error will stop there.

### ⚠️ `check:cover-health` has NO fetch timeout, and it is slow

The ROUTE gives every probe **10 seconds** (`AbortSignal.timeout`) and runs six
at a time. The SCRIPT does neither: it fetches **one at a time with no timeout**,
so a single hanging origin stalls the whole run, and ~400 covers take **many
minutes** even when nothing hangs. It prints `  N/total...` every 50 rows, which
is the only progress you get.

⚠️ **Do not read a run that is still going as a run that found nothing.** If you
need an answer in a hurry, the ROUTE's window is the fast instrument and the
script is the thorough one. Adding a timeout to the script would be a behaviour
change to a tool whose output is currently pinned byte-for-byte, so it has been
left alone deliberately — but it is a fair thing to change on purpose.

---

## 4. 🔴 The rollback: delete one string

There is no mode var and no shadow ladder, because there is nothing to enforce —
neither audit writes. **Turning them off is one edit:**

1. In `apps/worker/wrangler.toml`, remove `"47 9 * * *"` from **both**
   `[triggers]` and `[env.friend.triggers]`.
2. `npm run deploy:both`.

⚠️ **Both blocks, one edit.** `apps/worker/src/lib/audits-cron.test.ts` asserts
the two blocks carry the SAME set of strings, so removing it from one and not the
other fails the build rather than half-disabling the audits.

The routes, the table and the health keys can stay: with no cron they simply
report the last run forever, which is honest and costs nothing. Removing the
routes as well is a code revert of `apps/worker/src/routes/audits.ts` and its
mount in `index.ts`.

**Migration 0480 is not rolled back.** `audit_run` is bookkeeping about the
audits and holds no catalog data; dropping it would gain nothing and lose the
history.

---

## 5. When it looks broken — symptom → cause

| Symptom | Cause | Fix |
|---|---|---|
| `state: null`, no row, days after deploy | the cron string is missing on this instance, or `scheduled()` does not know it | `audits-cron.test.ts` catches both. Check `wrangler.toml`'s **friend** block — it is the one three hundred lines down that people forget |
| `run row failed: … no such table: audit_run` | migration 0480 not applied here | `npm run db:migrate` / `npm run db:migrate:friend` |
| a handful of PADHARD covers `unreachable`, repeatedly | **KI-16** — her `COVERS_BASE_URL` is `r2.dev`, which is rate-limited, and her covers are 3–4 MB each. Measured 2026-09-06: **7 of 8 reported rows were fine on a re-probe** | nothing. Re-run. 🔴 **Never blank one to make the number go down** — the object is there |
| every cover suddenly `unreachable` | the Worker's egress, or an origin-wide outage — **not** 400 broken covers | re-run tomorrow before touching a single URL |
| `broken` climbing on padhard only | expected historically — her rows are the ones the script could not audit at all until 2026-08-22, and she had 40 blank covers on 2026-08-23 | the free ladder: `npm run backfill:missing-covers -- --remote --friend` |
| `flagged` suddenly non-zero | either the 2026-08-13 OL aggregate bug recurring, or a real multi-printing volume 1 | **a person looks.** Nothing may auto-act on this list |
| `seriesKeys: 0` | the series fold read nothing | check `work.series` / `series_volume` / `series_check` are populated on this instance |
| a run row stuck at `running` | the invocation was cancelled | the handler both returns AND `waitUntil`s the promise; a stuck row means something killed the invocation, not that the pattern is wrong |
| `state: "ok"` but you expected findings | ⚠️ read `checked` — a nightly tick looks at **250** URLs, not all of them | run the SCRIPT (§3), which has no cap |

---

## 6. What is measured and what is not

| Claim | State |
|---|---|
| Migration 0480 applied to both instances | ✅ **measured 2026-09-06** — and re-checked from the other side: `audit_run` exists on **both** D1s, with **0 rows**, which is exactly what `/api/health`'s "never run" reading claims |
| Both hosts answer both health keys | ✅ **measured 2026-09-06** — see §1 |
| Script output unchanged by the conversion | ✅ **measured** — byte comparison against the pre-conversion logic |
| **The shared rules run against PRODUCTION on both instances** | ✅ **measured 2026-09-06** — see the table below |
| 2,816 tests + typecheck green | ✅ **measured 2026-09-06** |

### The first production run of the converted code, both instances

| Audit | main `library-catalog` | padhard `library-catalog-2nd` |
|---|---|---|
| **cover health** | **411 covers, 0 broken** | **642 covers, 8 reported — and 🔴 7 of the 8 were FINE** (below) |
| **series aggregates** | 151 series names, 28 works with 2+ editions, **3 flagged** | 309 series names, 4 works with 2+ editions, **0 flagged** — ⚠️ **the first measurement of this instance, ever** |

### 🔴 The padhard run is the case `unreachable` vs `broken` was built for

Seven of the eight were `fetch failed` against `pub-….r2.dev` — her
`COVERS_BASE_URL`, which `wrangler.toml` already records as **rate-limited**.
Re-probed by hand minutes later, **three of three answered HTTP 200,
`image/jpeg`, 3.4–4.2 MB**. Only the eighth — **356 *Evocation***, an Open
Library URL that redirects to an archive.org object — was a genuine **HTTP
503**, confirming this catalog's long-standing row for the third time.

So the honest reading is **1 broken, 7 unreachable**. A merged count would have
said *"8 broken covers on padhard"* and sent somebody after seven covers that
were never broken. Full record and the removal condition: **KI-16**.

### The three flagged on main are a QUESTION, not a defect

**#263 Dungeon Crawler Carl** (3 editions, 3
copies), **#333 The Maze Runner** (2/2) and **#341 He Who Fights with Monsters**
(2/3). ⚠️ **All three look like the legitimate case** — a volume 1 genuinely
titled with its series name, owned in more than one printing — which is exactly
the *question, not defect* the alarm exists to raise. 🔴 **Nothing was changed,
and nothing may be**: a person decides.
| 🔴 **A cron tick has fired** | ❌ **NOT measured.** First fires 09:47 UTC; the trigger is CLAIMED until an `audit_run` row exists with `trigger = 'cron'` on each instance |
| The admin routes are MOUNTED and gated | ✅ **measured 2026-09-06** — a bearer-less call answers **401 on both hosts**, so the routes exist and `requireAuth` is in front of them |
| The admin routes end to end, SIGNED IN | ❌ **NOT measured** — that needs a Firebase bearer the building session did not have. The 403 wording, the four causes and the response bodies are pinned by `apps/worker/src/routes/audits.test.ts`, not by a live call |
| A cover probed from a Worker | ❌ **NOT measured** — every test stubs `fetch` |

**How to close the first one**, the morning after a deploy:

```bash
curl -s https://library.heygabi.ai/api/health | grep -o '"coverHealth":{[^}]*}'
curl -s https://padhard.heygabi.ai/api/health | grep -o '"coverHealth":{[^}]*}'
```

A `lastRunAt` around `09:47` with `trigger: "cron"` is the proof. Until then the
trigger is registered, not verified — the same rule the details sweep and the
audiobook sweep carry, and it exists because `wrangler deploy` happily reports
triggers that never fire.
