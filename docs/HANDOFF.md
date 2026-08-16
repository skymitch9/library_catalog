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
