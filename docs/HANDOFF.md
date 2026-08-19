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

## 📌 State at 2026-08-19 ~10:40 MST — the details queue now CONVERGES

**Deployed to the FRIEND instance only:** `fa75710f` (version
`5e07d5f9-a167-481b-a1e5-026360cbd92f`, plus `4062520` comments-only after it).
1301 tests, typecheck clean, tree clean. ⚠️ **The MAIN instance is NOT deployed**
— `npm run deploy` was refused by this session's permission layer. Its queue is
empty (0 of 448 works owe a detail, measured 2026-08-19), so the code is inert
there, but the two Workers are out of step until someone runs `npm run deploy`.

**What changed, and why it is the headline.** The owner reported *"Sam has 55
missing details, the button didnt fix"*. The button was fine; the queue could
not converge. All 55 remaining rows were `seriesIndex`, 54 with neither column
set, and `applyFinding` wrote `series_index_sort` while `seriesIndexIncomplete`
requires **both** — so every lookup succeeded, was paid for, and closed nothing.
Full argument and every measured figure:
[`info/research-and-gaps.md`](info/research-and-gaps.md) §10.5 – §10.7.

⚠️ **Three claims elsewhere in this file are now WRONG and are left in place
below only because this is a dated log:**

| Line below says | Reality since 2026-08-19 |
|---|---|
| *"the volume-number gap can never be closed by research at all"* | Fixed. `applyFinding` writes the derived printed form beside the sort (`seriesIndexDisplayFrom`, the literal lifted out of `routes/ingest.ts`, which has always written it). |
| *"the sweep … deliberately does NOT write `gap_verdict: 'unknown'`"* | Still true, and still right. Nothing here silences a row a person could answer. |
| the sweep is two paid rungs | Three. **Rung 0** (`fillPrintedVolumeNumbers`) runs first, above the key gate, costs no lookup and no money, and heals rows stranded before the fix — capped at 4 a tick with its subrequests charged against `SWEEP_BUDGET`. |

**Also now VERIFIED rather than claimed:** her `7 * * * *` cron fires. Ten
`research_run` rows on `library-catalog-2nd` carry `triggered_by` NULL, one of
them `model = 'donor'` — the proof this repo's own rule demands.

**What is left, and it needs nobody:** ~53 volume-number rows drain at 2/hour on
HER key, ≈2¢ each, ≈$1.10 and ~27 hours in total. Pressing **Look up all** at
<https://padhard.heygabi.ai/queue> does the same work in ~20 minutes, on the
same key. Neither is required — the sweep gets there alone.

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
