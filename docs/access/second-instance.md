# Second Library Instance (friend) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED — no secret values here.
> Last verified: **2026-08-16** (built and deployed that day).
> Design: `catalog-platform/docs/info/friend-ingest-design.md` (read-only).

The friend's catalog: **the same Worker code, its own data**. One repo, one
build, two wrangler targets. Everything instance-specific lives in
`apps/worker/wrangler.toml` under `[env.friend]`.

## What exists

| Thing | Name / value | Notes |
|---|---|---|
| Wrangler env | `[env.friend]` | Worker deploys as **`library-catalog-friend`** |
| Hostname | `sam.heygabi.ai` | ⚠️ **TEMPORARY by owner decision** — the ONLY name allowed to change. Changing it: edit the `[[env.friend.routes]]` pattern, add the new host to Firebase Authorised domains, `npm run deploy:friend` |
| workers.dev | `library-catalog-friend.bgc-worker.workers.dev` | Works regardless of the custom domain |
| D1 | `library-catalog-2nd` | id `9dcf4af9-d1a2-4de4-adcf-ac7eea77f1c8`, WNAM, created 2026-08-16. Identity-neutral name on purpose |
| R2 covers | `library-2nd-covers` | Public dev URL enabled: `https://pub-6521c378bf4b4ac3b17d5ac898832819.r2.dev` = her `COVERS_BASE_URL`. r2.dev is rate-limited/uncacheable — swap for a bucket custom domain + 1-year Cache Rule when her hostname settles (edit one var, redeploy) |
| Estate | `ESTATE_CHECK = "enforce"` (same as main) | ⚠️ Inert until `ESTATE_APP_TOKEN_LIBRARY` is set on HER env — gate logs `estate_config_unset`, behaves as off, new sign-ins land `pending` |
| Default role | `member` (posture default) | The flip to `moderator` is ONE line in `[env.friend.vars]`: `ESTATE_DEFAULT_ROLE = "moderator"` — a PAUSED owner decision, access-increasing, never a side effect. Read by `resolveDefaultRole` in `packages/estate-auth/src/gate.ts`; only member/contributor/moderator accepted, garbage falls back to member and flags itself in the tail line |

## Commands (each is the main instance's command + `:friend`)

| Do | Command |
|---|---|
| Deploy her instance | `npm run deploy:friend` (carries check-clean + deploy-guard + deploy-done exactly like the main deploy; `DEPLOY_HOLDER=<you>` as usual) |
| Migrate her D1 | `npm run db:migrate:friend` — shared `migrations/` dir, same files as main. **Migrate before deploy.** ⚠️ Silence from migrate is a failed migration — expect the checkbox table |
| List her migrations | `npx wrangler d1 migrations list library-catalog-2nd --remote --env friend --config apps/worker/wrangler.toml` |
| One secret | `npm run secret:friend -- NAME` |
| List her secrets | `npm run secret:list:friend` |
| Bulk secrets | put values in `apps/worker/.dev.vars.friend` (gitignored, wrangler's own per-env convention), then `npm run secrets:push:friend` |
| Tail her logs | `npm run tail:friend --workspace @lc/worker` (or `npx wrangler tail --env friend --config apps/worker/wrangler.toml`) |
| Query her D1 | `npx wrangler d1 execute library-catalog-2nd --remote --env friend --config apps/worker/wrangler.toml --command "..."` |

## How the guards stay two-instance-safe

- `docs/deploys.log`: her deploys append a **fifth field `env=friend`**; main
  lines keep the pre-instance four-field shape byte-for-byte.
- `deploy-guard.mjs` ancestry-checks against the last line **of the same
  instance** — the two Workers are separate artifacts, so main being ahead of
  her log line is normal, not a regression.
- The `.deploy.lock` is **shared across instances on purpose**: both deploys
  build into the same `apps/web/dist`, so concurrent deploys of *different*
  instances can still ship each other's half-built assets.

## Rollback

Same as main, with `--env friend`:

```
npx wrangler deployments list --env friend --config apps/worker/wrangler.toml
npx wrangler rollback --env friend --config apps/worker/wrangler.toml [<version-id>]
```

`docs/deploys.log` lines tagged `env=friend` are her rollback record. Her D1
is hers alone — no migration on her database touches the main instance's, and
vice versa.

## Secrets — names only, and who can set them

Her env launches with **zero secrets**. Deliberately never set: `INDEX_PUSH_TOKEN`
(federation is phase 2 — push code logs one line, inert), `EBOOK_INGEST_TOKEN`
(her ebook surface is a 404 and stays one), `AUDIOBOOK_MAPPING_TOKEN` (no
audiobook pipeline), `ANTHROPIC_API_KEY` (owner decision — scanPhoto dark;
when set later it should be a **separate capped-workspace key**, design §4).

Owner/conductor steps (values unreadable from the main Worker, so they cannot
be copied by an agent):

1. `ESTATE_APP_TOKEN_LIBRARY` on her env — design §6.7 says **mint a NEW
   token** for her (she is her own estate consumer, paired with the estate's
   4th visibility column, which is the auth-worker build); the auth Worker
   must hold the matching value. Until both sides exist, her estate check is
   off and sign-ins sit `pending` for manual approval on her People page.
2. `GOOGLE_BOOKS_API_KEY` — optional, reuse the main key (design §6.7).
3. **Firebase console**: add `sam.heygabi.ai` (and the workers.dev host if
   she'll ever see it) to Authentication → Settings → Authorised domains on
   the `audiobook-catalog` project — BEFORE she gets the URL, or sign-in
   fails `auth/unauthorized-domain`.

## Gotchas that already bit

- Wrangler nags on every `--env friend` command that `INDEX_URL` "exists at
  top level but not on env.friend.vars — probably not what you want". It IS
  what we want (phase-2 federation, inert by absence). Do not "fix" it.
- This LAN negative-caches new subdomains ~30 min (router NXDOMAIN cache) —
  a dead-looking `sam.heygabi.ai` right after deploy is the router, not the
  deploy. Test via the workers.dev URL or another network.
- Her details-sweep cron is live (same `"7 * * * *"` string — it MUST match
  `DETAILS_SWEEP_CRON` or `scheduled()` ignores it) and skips itself every
  hour with `no ANTHROPIC_API_KEY` until a key exists. Free, by design.
