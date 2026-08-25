# Secrets & ops commands — how to set/push keys and run the npx tooling

> **Audience:** the owner + Claude sessions. **Status:** TRACKED.
> **Last verified: 2026-08-25.** Complements [`RECOVERY.md`](RECOVERY.md), which
> is the disaster *inventory* (what every secret is + where a copy lives); this is
> the *operational* how-to (how to set, push, and rotate them, and the ops
> commands). One fact, one home: custody lives in RECOVERY, procedure lives here.

## ⚠️ The rule that governs this whole doc

**A raw secret value never goes into chat, and Claude never reads the file that
holds it.** Two safe channels only:
1. **Owner sets it interactively** — `wrangler secret put` prompts hidden; the
   value goes straight to Cloudflare. Claude can't see it and doesn't need to.
2. **Owner writes it to `apps/worker/.dev.vars`** (gitignored) and Claude runs
   `npm run secrets:push` — the *script* reads the file and pushes; Claude runs
   the command but never opens `.dev.vars`.

`.dev.vars` is gitignored and MUST stay that way. It is the single source of
truth for the main instance's secrets.

## Where secrets live

Cloudflare **Worker secrets** — encrypted at rest, never in git, never in
`wrangler.toml`. Two instances, two independent secret sets:
- **main** (`library.heygabi.ai`) — `.dev.vars` is its source of truth.
- **friend** (`padhard.heygabi.ai`) — ⚠️ **there is no `.dev.vars.friend` on
  purpose.** Each friend secret is set one at a time, so a bulk push can never
  overwrite her own key material with main's.

## Adding / rotating a secret

### Path A — `.dev.vars` + push (Claude can run the push, MAIN only)
```
# 1. Owner: add the line to apps/worker/.dev.vars (gitignored) — NAME=value
# 2. Claude or owner:
npm run secrets:push          # pushes every allowlisted key present in .dev.vars
```
The pushable allowlist lives in `scripts/push-secrets.mjs` (`PRODUCTION_SECRETS`).
A key not on it is skipped — add it there first (a one-line code change).

### Path B — interactive `wrangler secret put` (owner runs; works for friend)
```
npx wrangler secret put <NAME> --config apps/worker/wrangler.toml             # main
npx wrangler secret put <NAME> --config apps/worker/wrangler.toml --env friend # friend
```
Paste the value at the hidden prompt. This is the ONLY way for the friend
instance (no bulk file).

### List what's set (no values shown)
```
npm run secret:list            # main
npm run secret:list:friend     # friend
```

## The Hardcover.app key, concretely (owner has one, 2026-08-25)

Secret name: **`HARDCOVER_API_TOKEN`** (Bearer token; free key at
`hardcover.app/account/api`). Already added to `env.ts` + the push allowlist.

- **main:** add `HARDCOVER_API_TOKEN=<key>` to `apps/worker/.dev.vars`, then Claude
  runs `npm run secrets:push`. (Owner never pastes the key to Claude; Claude never
  reads `.dev.vars`.)
- **friend:** owner runs
  `npx wrangler secret put HARDCOVER_API_TOKEN --config apps/worker/wrangler.toml --env friend`.
- The Hardcover **rung** that USES it (in the free-details ladder) is a separate
  build — see `docs/TODO.md` / delegated to a subagent; it reads
  `env.HARDCOVER_API_TOKEN` and skips when unset, exactly like the Google Books
  and Wikidata rungs.

## Ops command reference (which Claude can run vs which need the owner)

| Command | What | Who |
|---|---|---|
| `npm run deploy` / `deploy:friend` | Build + deploy a worker (clean-tree + overlap guards) | Claude |
| `npm run db:migrate` / `db:migrate:friend` | Apply migrations to one instance's D1 | Claude |
| `npm run backfill:audiobooks -- --remote [--friend] [--commit]` | Re-run the audiobook matcher (durable audio links) | Claude |
| `npx wrangler d1 execute library-catalog[-2nd] --remote --command "..."` | Direct prod D1 read/write | Claude (writes with care) |
| `npm run secrets:push` | Push `.dev.vars` secrets to MAIN | Claude (never reads the file) |
| `npx wrangler secret put ... [--env friend]` | Set one secret interactively | **Owner** (hidden prompt) |
| `npm run secret:list[:friend]` | List secret NAMES | Either |

## ⚠️ Known secret-hygiene gap (2026-08 audit)

A live **`PEER_TOKEN`** was committed in plaintext to this (public) repo — it needs
rotating. There is **no central password/key vault** (1Password/Bitwarden/etc.);
secrets are spread across Cloudflare, `.dev.vars`, GCP, Firebase. A proper
secrets-management review (inventory → flag exposed → recommend a vault +
rotation) is offered as a follow-up. See `docs/info/audit-2026-08-findings.md`.
