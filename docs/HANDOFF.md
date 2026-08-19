# Handoff — library_catalog

> **Audience:** Claude sessions. **Status:** TRACKED.
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

## 📌 State at 2026-08-19 ~11:05 MST — the details queue CONVERGES

**Deployed to the FRIEND instance only:** commit `ed5881b5`. 1296 tests,
typecheck clean, build clean, tree clean. ⚠️ **The MAIN instance is NOT
deployed** — `npm run deploy` was refused by that session's permission layer.
Main owes 0 details of 448 works, so the change is inert there, but the two
Workers are out of step until someone runs `npm run deploy`.

**The owner's rules, and the one document that answers them permanently:**
[`info/volume-numbers.md`](info/volume-numbers.md). `series` +
`series_index_sort` = complete; the printed form (`series_index_display`) is
optional data; research auto-applies. Written because he said *"We're wasting
all our buffer usage on solving nonsense we've solved many times."* Do not
re-argue the volume predicate anywhere else.

**Measured 2026-08-19, both instances, `--remote`:**

| | friend (`library-catalog-2nd`) | main (`library-catalog`) |
|---|---|---|
| works | 74 | 448 |
| details queue, before | 55 | 0 |
| details queue, after the predicate change | **53** | **0** |
| pending findings to apply | **0** | **0** |

⚠️ The predicate change closes only 2 — **53 of the 55 have no
`series_index_sort` at all** and genuinely need a lookup. That is the honest
number; the coordinator's expectation that most would close arithmetically was
not what the data said.

**What finishes it, with nobody touching anything:** the hourly `7 * * * *`
sweep takes 2 books a tick on HER key, ≈2¢ each. 53 books ≈ **27 hours,
≈$1.10**. Pressing **Look up all** at <https://padhard.heygabi.ai/queue> does
the same work in ~20 minutes on the same key. The cron is **verified, not
claimed** — ten `research_run` rows carry `triggered_by` NULL, one of them
`model = 'donor'`.

⚠️ **The queue will not reach zero and must not be read as broken when it
doesn't.** Roughly half this library has no free record anywhere
(`isbn-ladder.md` §4.2), so some rows will end as *named residue*: the page now
states, in words, that research asked and could not answer, and what would
settle it. An anonymous count that stops falling is how a working button got
reported as broken.

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

## Production, measured 2026-08-16

| | |
|---|---|
| **Live** | https://library.heygabi.ai — `/api/health` returns `ok:true`, `database: up`, 16 universes, worker `0.1.0` |
| **Migrations** | `wrangler d1 migrations list library-catalog --remote --config apps/worker/wrangler.toml` → **"No migrations to apply!"** Nothing is pending. |
| **Estate auth** | `ESTATE_CHECK="enforce"` in production — no longer shadow. ⚠️ [`info/estate-auth-shadow.md`](info/estate-auth-shadow.md) still describes the shadow arm; read it for the design, not for the current setting. |
| **Deploy record** | `docs/deploys.log`, one line per deploy, written by `scripts/deploy-done.mjs` |

## Branches

`main` is **363–373 commits ahead** of every `feature/*` branch in the repo, so
none of them is "in flight" in any meaningful sense. Treat them as historical
unless you deliberately revive one.

| Branch | Commits not in `main` | Read as |
|---|---|---|
| `feature/library-parity` | 0 | Fully merged; pointer only |
| `feature/apply-pending-findings` | 0 | Fully merged; pointer only |
| `feature/override-aware-review-carry` | 0 | Fully merged; pointer only |
| `feature/aliases-export-people` · `feature/scanjobs-vision` · `feature/research-details` · `feature/router` | 0 (merged into `main`) | Fully merged; pointer only |
| `feature/completeness-wishlist-relations` | 3 | ⚠️ Unmerged tail, last commit 2026-08-10 — check whether `main` superseded it before reviving |
| `feature/openlibrary-ids` | 1 | ⚠️ Same |
| `feature/series-overrides` | 2 | ⚠️ Same |

There are also ~9 `worktree-agent-*` branches from past subagent runs. They are
not work in progress; leave them or prune them, but do not read them as state.

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
