# Second Library Instance (friend) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED — no secret values here.
> Last verified: **2026-08-16** (built and deployed that day; hostname settled
> to `padhard.heygabi.ai` and the donor-first sweep added the same day).
> Design: `catalog-platform/docs/info/friend-ingest-design.md` (read-only).

The friend's catalog: **the same Worker code, its own data**. One repo, one
build, two wrangler targets. Everything instance-specific lives in
`apps/worker/wrangler.toml` under `[env.friend]`.

## What exists

| Thing | Name / value | Notes |
|---|---|---|
| Wrangler env | `[env.friend]` | Worker deploys as **`library-catalog-friend`** |
| Hostname | `padhard.heygabi.ai` | **Settled 2026-08-16** (owner decision, replacing the temporary `sam.heygabi.ai`). Still the ONLY name allowed to change. Changing it again: edit the `[[env.friend.routes]]` pattern, add the new host to Firebase Authorised domains, `npm run deploy:friend` |
| workers.dev | `library-catalog-friend.bgc-worker.workers.dev` | Works regardless of the custom domain |
| D1 | `library-catalog-2nd` | id `9dcf4af9-d1a2-4de4-adcf-ac7eea77f1c8`, WNAM, created 2026-08-16. Identity-neutral name on purpose |
| R2 covers | `library-2nd-covers` | Public dev URL enabled: `https://pub-6521c378bf4b4ac3b17d5ac898832819.r2.dev` = her `COVERS_BASE_URL`. r2.dev is rate-limited/uncacheable — swap for a bucket custom domain + 1-year Cache Rule when her hostname settles (edit one var, redeploy) |
| Estate | `ESTATE_CHECK = "enforce"` (same as main) | ⚠️ Inert until `ESTATE_APP_TOKEN_LIBRARY` is set on HER env — gate logs `estate_config_unset`, behaves as off, new sign-ins land `pending` |
| Default role | `member` (posture default) | The flip to `moderator` is ONE line in `[env.friend.vars]`: `ESTATE_DEFAULT_ROLE = "moderator"` — a PAUSED owner decision, access-increasing, never a side effect. Read by `resolveDefaultRole` in `packages/estate-auth/src/gate.ts`; only member/contributor/moderator accepted, garbage falls back to member and flags itself in the tail line |
| 🤖 GABI (conversational fixer) | `GABI_PANEL = "on"` in `[env.friend.vars]` — **HER INSTANCE ONLY**; the main one is `"off"` | ⚠️ **PHASE 0 IS READ-ONLY.** GABI can look things up (find a book, read one, list gaps, list recent changes) and can change NOTHING; the allowlist is `@lc/core`'s `GABI_TOOL_NAMES` and a test fails the build if a write tool is added. ⚠️ The var gates the ROUTE as well as the panel — `POST /api/gabi/turn` answers a worded **404** where it is off (disabled-not-open, the `EBOOK_INGEST_TOKEN` idiom), never 403. Unset = off. Spends HER `ANTHROPIC_API_KEY`, ~1.4–1.8¢ per short conversation (measured 2026-08-17). Design: [`../info/gabi-fixer-design.md`](../info/gabi-fixer-design.md) |
| Her role, for GABI | **`admin`** — MEASURED 2026-08-17 (`SELECT role FROM app_user` on `library-catalog-2nd`, id 3, approved) | `admin` holds `runResearch`, which is what the turn route gates on, so the panel is visible to her. ⚠️ It is a grant to HER ACCOUNT, not a property of the instance — `ESTATE_DEFAULT_ROLE` is still unset, so anyone else signing in there lands `member` and sees no panel at all |

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

Her env holds **three secrets**: `DONOR_TOKEN` (set 2026-08-16 — see the donor
section above; the main instance holds the same value under the same name),
`ESTATE_APP_TOKEN_LIBRARY` (set 2026-08-16, minted fresh for her as her own
estate consumer), and `ANTHROPIC_API_KEY` — **HER OWN key** (see below).
Deliberately never set: `INDEX_PUSH_TOKEN` (federation is phase 2 — push code
logs one line, inert), `EBOOK_INGEST_TOKEN` (her ebook surface is a 404 and
stays one), `AUDIOBOOK_MAPPING_TOKEN` (no audiobook pipeline).

`ANTHROPIC_API_KEY` history, all within 2026-08-16 late (three states in one
evening; the LAST one is current): (1) design said leave unset, scanPhoto
dark; (2) owner ordered a copy of HIS key as a stopgap, pushed from the main
`.dev.vars` (which turned out to hold it — it is the repo's documented
single-source-of-truth secrets file); (3) owner then minted **Samantha's own
key** and it replaced his the same night, pushed via the
`ANTHROPIC_API_KEY_FRIEND_SAM` drop-box line in `apps/worker/.dev.vars`
(paste → pipe to `wrangler secret put ANTHROPIC_API_KEY --env friend` → line
blanked; the drop-box name is in no push allowlist, so it can never ship by
accident). Rotation = same drop-box, same pipe. ⚠️ Not verified: whether her
key sits in a capped workspace — the $10-cap workspace remains the design
recommendation (§4); confirm with the owner before assuming a cap exists.
Her sweep runs donor-then-AI on every `:07` tick and scanPhoto is live — no
deploy was needed at any step.

Owner/conductor steps (values unreadable from the main Worker, so they cannot
be copied by an agent):

1. `ESTATE_APP_TOKEN_LIBRARY` on her env — design §6.7 says **mint a NEW
   token** for her (she is her own estate consumer, paired with the estate's
   4th visibility column, which is the auth-worker build); the auth Worker
   must hold the matching value. Until both sides exist, her estate check is
   off and sign-ins sit `pending` for manual approval on her People page.
2. `GOOGLE_BOOKS_API_KEY` — optional, reuse the main key (design §6.7).
3. **Firebase console**: add `padhard.heygabi.ai` (and the workers.dev host
   if she'll ever see it) to Authentication → Settings → Authorised domains
   on the `audiobook-catalog` project — BEFORE she gets the URL, or sign-in
   fails `auth/unauthorized-domain`. (Done for `padhard` 2026-08-16, when the
   hostname settled.)

## Gotchas that already bit

- Wrangler nags on every `--env friend` command that `INDEX_URL` "exists at
  top level but not on env.friend.vars — probably not what you want". It IS
  what we want (phase-2 federation, inert by absence). Do not "fix" it.
- This LAN negative-caches new subdomains ~30 min (router NXDOMAIN cache) —
  a dead-looking `padhard.heygabi.ai` right after deploy is the router, not
  the deploy. Test via the workers.dev URL or another network.
- Her details-sweep cron is live (same `"7 * * * *"` string — it MUST match
  `DETAILS_SWEEP_CRON` or `scheduled()` ignores it). ⚠️ Since the donor build
  (2026-08-16) it no longer skips on the missing AI key — see below.

## The donor-first details sweep (built 2026-08-16)

Owner ask: *"before pinging the ai it checks other libraries for answers. If
I have Stormlight Archive don't have her look it up."*

**Her donor is the main library.** Every hourly tick, her sweep asks
`https://library.heygabi.ai/api/donor/details?title=…&author=…` for each
picked book's unasked missing details and copies what the main catalog
already holds — running in **donor-only mode**, since she has no
`ANTHROPIC_API_KEY` (her tick's log line starts its `skipped` list with
`no ANTHROPIC_API_KEY — donor-only mode`).

| Piece | Where | Notes |
|---|---|---|
| Endpoint | `GET /api/donor/details` on BOTH instances | Header `X-Donor-Token` must equal the `DONOR_TOKEN` secret; unset/absent/wrong are all **404** (disabled, never advertised). Read-only; answers only filled detail fields + the matched work id/title |
| `DONOR_URL` | `[env.friend.vars]` = `https://library.heygabi.ai` | ⚠️ The MAIN instance has NO `DONOR_URL` on purpose — reciprocity (our sweep asking her catalog) is a later one-line owner flip: `DONOR_URL = "https://padhard.heygabi.ai"` in the top-level `[vars]` |
| `DONOR_TOKEN` | Secret on BOTH instances (set 2026-08-16, conductor; values nowhere) | Same value both sides. Rotate with `npm run secret -- DONOR_TOKEN` and `npm run secret:friend -- DONOR_TOKEN` — together, or her asks 404 |
| Provenance | `research_finding.source_tier = 'donor'` (migration 0320), `research_run.model = 'donor'`, `decided_how = 'auto'` | Donor copies are auditable/revertible on the queue page's auto-applied list like any machine batch |
| Convergence | Donor-ANSWERED fields count as asked; a reachable donor with no answer advances the rotation without silencing anything | Books the donor can't answer are re-asked on later rotations — the main library's own AI sweep is still filling its gaps hourly, so her donor keeps learning |
| Wrangler nag | `DONOR_URL` "exists on env.friend but not at top level" on main-instance commands | Same class as the `INDEX_URL` nag above — correct, do not "fix" |

**Verifying her sweep worked:** a `research_run` row on `library-catalog-2nd`
with `model = 'donor'` and `triggered_by` NULL (query via the D1 command in
the table above). Her next `:07` cron tick after deploy is the true test.
