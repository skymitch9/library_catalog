# 📦 RETIRED — the old `docs/HANDOFF.md`, archived whole on 2026-09-02

> 🔴 **DO NOT READ THIS FOR ANYTHING CURRENT. Nothing below is maintained.**
> Every figure here has an age and most are weeks old; a stale figure is not
> evidence.
>
> **What replaced it, by question:**
>
> | If you want to know… | Read |
> |---|---|
> | What is happening now / what is blocked | [`../TODO.md`](../TODO.md) |
> | The map of the whole doc tree | [`../README.md`](../README.md) |
> | Is this a bug or deliberate? | [`../KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) |
> | Was this solved before, and why that way? | [`../DONE.md`](../DONE.md) |
> | How to deploy / roll back / reach it | [`../access/README.md`](../access/README.md) |
> | Why a call was made that way | [`../info/decisions.md`](../info/decisions.md) |
> | A trap that keeps biting | [`../info/gotchas.md`](../info/gotchas.md) |
>
> **Why it was retired** — the whole record is in [`../DONE.md`](../DONE.md).
> The estate docs standard allows exactly one living doc for *"what is
> happening now"*, and this was a second one. `CLAUDE.md`'s first line told
> every session to read it **first**, so when it went stale it did not merely
> fail to help — it misled about what production contained. ⚠️ **That happened
> twice**: the 2026-08-10 handoff was replaced on 2026-08-16 for exactly this,
> and the replacement below was still leading with 2026-08-23 figures on
> 2026-09-02.
>
> ⚠️ **Five facts that SOURCE files, a test and two migrations cited from here
> were MOVED, not deleted.** They live in
> [`../info/decisions.md`](../info/decisions.md) under *"Settled by the retired
> handoff"*: open question 5 (there is no `audio` medium), the dropped
> `alsoInAudio` flag, *"D1 is the only copy of this data"*, *"read the lines,
> not the totals"*, and the paused ebook pipeline. Every citation was
> repointed there in the same commit that retired this file.

---

## The file as it stood, unedited below this line

# Handoff — library_catalog

> **Audience:** Claude sessions. **Status:** 📦 ARCHIVED 2026-09-02 (was TRACKED).
> **Rewritten 2026-08-16**, replacing a 2026-08-10 handoff that had become
> actively wrong. Every figure below was measured on **2026-08-16**; the old
> one is archived whole in [`DONE.md`](DONE.md), with a table of exactly which
> of its claims reality had overtaken.
>
> ⚠️ **Why it was replaced, because the lesson generalises:** it read
> *"committed, **not deployed**, and migration 0010 has NOT been applied to
> `--remote`"*. All of that was true when written and false when read.
> `CLAUDE.md` tells sessions to read this file *first*, so a stale handoff is
> not a tidy-up job — it actively misleads the next session about what
> production contains. **Re-measure before trusting any line here; if you
> re-measure, update the date.**

## 📌 State at 2026-08-23 ~19:15 Phoenix — MEASURED THIS DAY

⚠️ **Everything below was re-measured on 2026-08-23.** The block this replaced
described 2026-08-19 and its headline claim — *"the MAIN instance is NOT
deployed"* — had become **false**: main was deployed on 2026-08-22 (`ede7ff3`,
worker version `658069a6`, the signed-copy toggle), verified by fetching the
live bundle rather than by trusting the deploy's own report.

**Both instances are deployed and in step.** `docs/deploys.log` carries the line.

| | main (`library-catalog`) | friend (`library-catalog-2nd`, padhard) |
|---|---|---|
| works | **493** | **532** |
| no cover | 5 | 15 |
| stand-in covers | 0 | 17 |
| **cover needed** (`cover_url IS NULL OR cover_status='standin'`) | **5** | **32** |
| no series | 110 | 151 |
| no first-published | 28 | 1 |
| no description | 19 | 2 |
| audiobook holdings | 124 (2 stale) | — |

⚠️ **Both catalogues are being loaded live and these numbers move by the hour.**
Padhard gained **163 works between 2026-08-22 evening and 2026-08-23 evening.**
Re-measure before quoting any of them; a figure here has an age, and a stale one
is not evidence.

**Landed 2026-08-22/23, all deployed:**
- `--friend` targeting for every backfill (`scripts/lib/d1.mjs`) — the second
  instance was previously unreachable by any sweep in `scripts/`
- the cover-rung silent-failure fix, and Kiro's 52-cover sweep across both
- the audiobook link sweep re-run: **124 holdings**, incl. work 514 *Elantris*
- the signed-copy toggle on existing copies
- work 511 linked by alias (`Beauty X Beast` ↔ the audiobook's `Beast X Beauty`)

**Open, and designed but not built:** the audiobook sweep as a pipeline step,
and the per-edition holdings schema. Both in [`TODO.md`](TODO.md).


## 📌 State at 2026-08-16 ~15:45 PDT (Opus → Fable handoff)

**Deployed today:** `6e3a368f` (estate-search + the hourly details sweep before
it). Health green, 816 tests, typecheck clean, tree clean.

### Two things live here now that were not this morning

1. **An hourly details sweep**, cron `7 * * * *` — this Worker's FIRST cron
   trigger. ⚠️ **2 books per tick, not 8**, and the reason is not money: one
   research run is ~12 + 4·fields of the 50 subrequests an invocation gets, and
   exceeding that cap TERMINATES the invocation silently. ~4¢/hour, converging
   in ~2½ days then going quiet.
   ⚠️ **This queue does NOT converge on its own** (unlike the games one).
   Roughly half this library answers "not identified", which writes no verdict,
   and the volume-number gap can never be closed by research at all — so the
   sweep tracks what it already asked and never re-asks the same question. It
   deliberately does NOT write `gap_verdict: 'unknown'`, which would silence
   ~22 rows a person holding the book could answer.
2. **`<estate-search>`** — an additive "search the whole estate" panel under the
   top bar. Each app's own collection search is untouched.
   ⚠️ It was CORS-blocked until `READ_ORIGINS` was set on the index Worker
   (catalog-platform, deployed `befcce25`).

### ⚠️ A real defect fixed today — and it is the shape to watch for

`export.ts` gated itself with a blanket `.use('*', requireCapability('editCatalog'))`
and is mounted at the BARE `/api` prefix, so Hono ran that middleware for **every
sub-app mounted after it** — series, universes, crowdfunding, isbn, enrich,
research, reviews, scan-jobs. A `member` was refused as `editCatalog` on routes
declaring `read`, and could mark a book read but not write the review that goes
with it. It failed CLOSED, so nothing broke loudly, and it refused nobody
because this library holds 1 admin + 2 owners and no lesser roles — it would
have bitten the first `member` added.

**Tests went 524 → 816**, including a full route→capability table and a
regression guard that fails if a blanket `.use('*')` returns to `export.ts`.

### Still open here

- `POST /works/:id/reviews-seen` is gated on `read` — the only write a `guest`
  may make. Justified in the route's own comment; now pinned by a test so
  tightening it is a decision, not a drift.
- Two doc-vs-code drifts in comments only (crowdfunding "owner-only", admin
  `/index-push` "owner-only") — the real gates are `editCatalog` and
  `manageUsers`.
- The second-household catalog is **narrowed to "she wants to sort her books"**
  — do NOT start with the index join.

## Where things live

This repo follows the estate's three-doc split. One living doc for state, one
archive, and topic references — cross-linked, never duplicated.

| File | What it holds |
|---|---|
| **this file** | Current state: what is live, what is measured, what is in flight |
| [`TODO.md`](TODO.md) | **ACTIVE only** — work agreed but not finished |
| [`DONE.md`](DONE.md) | Dated archive, newest first, **append-only** |
| [`info/`](info/README.md) | How and why it works — including [`gotchas.md`](info/gotchas.md) and [`decisions.md`](info/decisions.md), both extracted from the old work log |
| [`access/`](access/README.md) | How to operate it — deploys, Cloudflare, [`rollback-points.md`](access/rollback-points.md) |

## Production — ⚠️ superseded, see the measured state at the top of this file

| | |
|---|---|
| **Live** | https://library.heygabi.ai — `/api/health` returns `ok:true`, `database: up`, 16 universes, worker `0.1.0` |
| **Migrations** | `wrangler d1 migrations list library-catalog --remote --config apps/worker/wrangler.toml` → **"No migrations to apply!"** Nothing is pending. |
| **Estate auth** | `ESTATE_CHECK="enforce"` in production — no longer shadow. ⚠️ [`info/estate-auth-shadow.md`](info/estate-auth-shadow.md) still describes the shadow arm; read it for the design, not for the current setting. |
| **Deploy record** | `docs/deploys.log`, one line per deploy, written by `scripts/deploy-done.mjs` |

## Branches — ⚠️ the unmerged three are MERGED, 2026-08-21

This section listed `feature/completeness-wishlist-relations` (3 commits),
`feature/series-overrides` (2) and `feature/openlibrary-ids` (1) as unmerged
and conflicting. **All three were merged by Kiro on 2026-08-21** (item K11,
after K2 took typecheck green). Verified 2026-08-23: `feature/series-overrides`
no longer exists even as a local branch; the other two survive only as
`origin/*` pointers. Nothing in this repo is in flight on a branch.

⚠️ The ~9 `worktree-agent-*` branches from past subagent runs are not work in
progress. Leave them or prune them; do not read them as state.

## The rules that keep biting

Kept here rather than only in `CLAUDE.md` because they are the ones that cost
real time. Full reasoning in [`info/gotchas.md`](info/gotchas.md).

- **Commit with `git commit -F <file>`, never `-m`.** PowerShell mangles a
  message containing quotes, an em dash or a newline *before git sees it*, and
  the observed failure is `error: unknown option` with the commit silently not
  happening.
- **Commit, then deploy.** `npm run deploy` refuses a dirty tree
  (`scripts/check-clean.mjs`) because production twice ran code that was in no
  commit. `ALLOW_DIRTY_DEPLOY=1` is the deliberate escape hatch.
- **Migrate before deploying**, so new code never meets an old schema.
- ⚠️ **`wrangler dev` does not die with whatever started it.** Measured
  2026-08-13: 212 orphaned processes holding 15.6 GB. Stop it by name, not by
  stopping the caller.
- **Exercise a change rather than reasoning about it.** Both real defects found
  while building this were found that way and by nothing else.
