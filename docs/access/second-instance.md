# Second Library Instance (friend) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED — no secret values here.
> Last verified: **2026-08-25** — her secret NAMES were re-read that day
> (`npm run secret:list:friend`, seven of them) and the "one command for BOTH
> instances" work landed. ⚠️ NOT re-verified that day: the D1 id, the R2 bucket
> URL, her `app_user` role, and everything in the estate-identity section below
> — those still carry their 2026-08-17 measurement.
> The 2026-08-17 revision applied estate credentials catalog findings F-5, F-6
> and F-8: her estate identity is `library2`, and the "no Anthropic key /
> donor-only" claims were corrected. Built and deployed 2026-08-16, when the
> hostname settled to `padhard.heygabi.ai` and the donor-first sweep landed.
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
| Estate | `ESTATE_CHECK = "enforce"` (same as main) | ⚠️ Inert until `ESTATE_APP_TOKEN_LIBRARY2` is set on HER env — gate logs `estate_config_unset`, behaves as off, new sign-ins land `pending`. **Not `_LIBRARY` — the name changed 2026-08-17, see the estate-identity section below** |
| Estate identity | `ESTATE_APP = "library2"` in `[env.friend.vars]` | ⚠️ **She is her own estate consumer** — one of the five in the auth Worker's `CONSUMER_APPS`, paired with the `vis_library2` column. Fixed 2026-08-17 (credentials catalog F-5): the app id was hard-coded `'library'` in `gate.ts`, so this Worker asserted the MAIN library's identity. Full section below |
| Default role | `member` (posture default) | The flip to `moderator` is ONE line in `[env.friend.vars]`: `ESTATE_DEFAULT_ROLE = "moderator"` — a PAUSED owner decision, access-increasing, never a side effect. Read by `resolveDefaultRole` in `packages/estate-auth/src/gate.ts`; only member/contributor/moderator accepted, garbage falls back to member and flags itself in the tail line |
| 🤖 GABI (conversational fixer) | `GABI_PANEL = "on"` in `[env.friend.vars]` — **HER INSTANCE ONLY**; the main one is `"off"` | ⚠️ **PHASE 0 IS READ-ONLY.** GABI can look things up (find a book, read one, list gaps, list recent changes) and can change NOTHING; the allowlist is `@lc/core`'s `GABI_TOOL_NAMES` and a test fails the build if a write tool is added. ⚠️ The var gates the ROUTE as well as the panel — `POST /api/gabi/turn` answers a worded **404** where it is off (disabled-not-open, the `EBOOK_INGEST_TOKEN` idiom), never 403. Unset = off. Spends HER `ANTHROPIC_API_KEY`, ~1.4–1.8¢ per short conversation (measured 2026-08-17). Design: [`../info/gabi-fixer-design.md`](../info/gabi-fixer-design.md) |
| Her role, for GABI | **`admin`** — MEASURED 2026-08-17 (`SELECT role FROM app_user` on `library-catalog-2nd`, id 3, approved) | `admin` holds `runResearch`, which is what the turn route gates on, so the panel is visible to her. ⚠️ It is a grant to HER ACCOUNT, not a property of the instance — `ESTATE_DEFAULT_ROLE` is still unset, so anyone else signing in there lands `member` and sees no panel at all |

## 🆕 ONE command for BOTH instances (2026-08-25)

Owner ask: *"we should do something so we dont need to always do different
things for these 2 libraries."* The `:friend` twins all remain for one-off use;
these run **main first, then her, stopping on the first failure**.

| Do | Both instances |
|---|---|
| Deploy | `npm run deploy:both` |
| Migrate D1 | `npm run db:migrate:both` |
| Push the SHARED secrets | `npm run secrets:push:both` (add `-- --dry-run` first) |
| Any backfill | `npm run for-both -- backfill:covers -- --remote --commit` |

- `deploy:both` and `db:migrate:both` are `scripts/for-both.mjs`, which runs the
  npm script and then its `:friend` twin. Each half keeps its own
  check-clean / deploy-guard / deploy-done, and the **shared `.deploy.lock`** is
  taken and released once per half — sequential, so it never self-blocks.
- ⚠️ **It does not roll back.** If the friend half fails after main succeeded,
  the instances are out of step and the runner says so in those words. Fix and
  re-run; a runner that un-deploys a good deploy would be worse.
- ⚠️ **It commits `docs/deploys.log` between the halves, and nothing else.**
  Found the first time `deploy:both` ran (2026-08-25): main's `postdeploy`
  appends to that log, which makes the tree dirty, which makes the friend half's
  `check-clean` refuse — a circular requirement, because the deploy is what
  writes the file. The runner commits **that one path only**
  (`git commit -- docs/deploys.log`, never `git add -A`, index untouched, so it
  is safe beside another agent's work in progress). If anything ELSE is dirty it
  **stops** and tells you to run the remaining half by hand.
  ⚠️ `check-clean.mjs` was deliberately **not** relaxed: teaching a deploy guard
  to ignore a path would apply to every deploy for ever, and committing a log
  `deploy-done.mjs` already asks you to commit costs nothing.
  The LAST half's line is left uncommitted for you — commit it after.
- For backfills there is no `:friend` twin, so `for-both` runs the same script
  twice and appends `--friend` the second time. `scripts/lib/d1.mjs` still
  refuses `--friend` without `--remote`, and that refusal is left to fire.
- ⚠️ **`--both` was NOT added to `parseFlags()` in `scripts/lib/d1.mjs`** —
  every backfill reads one flags object and makes one pass, so a `--both` there
  would need the same loop copied into ~15 scripts. The loop lives in one place
  instead. `scripts/for-both.mjs` carries the full argument.

## Commands (each is the main instance's command + `:friend`)

| Do | Command |
|---|---|
| Deploy her instance | `npm run deploy:friend` (carries check-clean + deploy-guard + deploy-done exactly like the main deploy; `DEPLOY_HOLDER=<you>` as usual) |
| Migrate her D1 | `npm run db:migrate:friend` — shared `migrations/` dir, same files as main. **Migrate before deploy.** ⚠️ Silence from migrate is a failed migration — expect the checkbox table |
| List her migrations | `npx wrangler d1 migrations list library-catalog-2nd --remote --env friend --config apps/worker/wrangler.toml` |
| One secret | `npm run secret:friend -- NAME` |
| List her secrets | `npm run secret:list:friend` |
| Bulk secrets | `npm run secrets:push:friend` — **since 2026-08-25 this WORKS**, and pushes only `SHARED_SECRETS` from the MAIN `.dev.vars`. ⚠️ There is still **no `.dev.vars.friend`** and there must not be one (credentials catalog F-6); the safety now comes from the list, not from the missing file. Per-instance keys (`ANTHROPIC_API_KEY`, every `ESTATE_APP_TOKEN_*`, `INDEX_PUSH_TOKEN`) are **refused** with a sentence saying what to run instead |
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

Her env holds **seven secrets** — names read from `npm run secret:list:friend`,
**re-measured 2026-08-25**: `ANTHROPIC_API_KEY` (**HER OWN key**, see below),
`DONOR_TOKEN`, `ESTATE_APP_TOKEN_DISCORD`, `ESTATE_APP_TOKEN_LIBRARY2`,
`GOOGLE_BOOKS_API_KEY`, `HARDCOVER_API_TOKEN`, `PEER_TOKEN`.

⚠️ The 2026-08-17 revision of this section said "four secrets" and named
`ESTATE_APP_TOKEN_LIBRARY` as dead weight. **That stale one was deleted
2026-08-25** on the owner's go (`echo y | wrangler secret delete
ESTATE_APP_TOKEN_LIBRARY --env friend`; wrangler 4.120 has no `--force`, it
wants a piped confirm), and live health still reports `configured: true`.

Deliberately never set: `INDEX_PUSH_TOKEN` (federation is phase 2 — and it is a
**per-SOURCE** bearer, so hers would be a `library2` token, never main's),
`EBOOK_INGEST_TOKEN` (her ebook surface is a 404 and stays one),
`AUDIOBOOK_MAPPING_TOKEN` (no audiobook pipeline), `INDEX_READ_TOKEN` (the read
half of the index does not exist on either instance).

### How a bulk push is safe now (changed 2026-08-25)

⚠️ Until 2026-08-25 the answer was **"there is no bulk path"**: `.dev.vars.friend`
does not exist, so `secrets:push:friend` refused. That was right about the
*risk* and wrong about the *remedy* — the risk was never the file, it was
pushing the keys that are HERS. `scripts/push-secrets.mjs` now classifies every
key instead:

| List | Meaning | Friend |
|---|---|---|
| `SHARED_SECRETS` | one value, two holders, by design | pushed |
| `PER_INSTANCE_SECRETS` (+ the `ESTATE_APP_TOKEN_` prefix) | each instance holds its own | **refused, always** |
| anything else | custody not decided | refused, with a sentence |

A key on both lists is a **startup error**, asserted at module load and covered
by `scripts/test/push-secrets.test.mjs`.

⚠️ **There is still no `.dev.vars.friend` and there must not be one** (credentials
catalog F-6). The friend push reads the MAIN `.dev.vars` and sends only the
shared subset. Creating a second file would be a deliberate custody change — a
second home for her key material, and a rotation path whose default is pushing
the OWNER'S keys onto HER Worker.

Values that must never sit in an allowlist still use the **drop-box line** in
the MAIN `apps/worker/.dev.vars` (paste → `npm run secret:friend -- NAME` →
blank the line). `ANTHROPIC_API_KEY_FRIEND_SAM` is the one in use; do not
rename it.

## ⚠️ Her estate identity: `library2`, not `library` (fixed 2026-08-17)

**What was wrong.** `packages/estate-auth/src/gate.ts` declared
`app: 'library'` in the posture and read a hard-coded `ESTATE_APP_TOKEN_LIBRARY`
— on **both** wrangler environments. One build, two Workers, one identity. So:

- this Worker knocked on `auth.heygabi.ai` wearing the **main library's** badge;
- `ESTATE_APP_TOKEN_LIBRARY2`, held on the auth Worker since 2026-08-16, was an
  **orphan** — a secret nothing in the estate ever presented;
- `vis_library2` (auth-worker migration 0007, `DEFAULT 0`, written expressly so
  that "another household's shelf" is granted **by hand**) described a door
  nobody knocked on.

Nothing failed, nothing logged wrong, no request 500'd. A hard-coded identity
is indistinguishable from a correct one until you ask which instance is
speaking — which is why the fix ships with an outside-observable signal.

**What it is now.** The identity is per-instance config in `wrangler.toml`:
`ESTATE_APP = "library"` at top level, `ESTATE_APP = "library2"` under
`[env.friend.vars]`. The app id also selects the **secret name** (`library` →
`ESTATE_APP_TOKEN_LIBRARY`, `library2` → `ESTATE_APP_TOKEN_LIBRARY2`), so the
estate's *one value, two holders, same name both sides* rule holds here too.
`packages/estate-auth/test/instance-estate-app.test.ts` fails on every way this
can regress, including re-hard-coding either half.

**⚠️ What this fix does NOT do.** It does not make `vis_library2` a gate. The
library gate refuses on estate `status` only (revoked / unreachable) — the
visibility array is cached and logged, never enforced, on either instance. So
asserting `library2` makes the directory *answer, attribute and log* for the
right consumer, and makes the column **meaningful to switch on**; it does not
by itself narrow who gets in. Gating on the array is a separate,
access-REDUCING decision.

### ⚠️ Finishing it: PIPE FIRST, DEPLOY SECOND

**As of 2026-08-17 the code is committed and the MAIN instance is deployed;
HER Worker is not.** That is deliberate, and the order matters:

1. **Pipe her bearer** — her env needs the `library2` value under its own name:

   ```
   npm run secret:friend -- ESTATE_APP_TOKEN_LIBRARY2
   # paste the SAME value the auth Worker holds as ESTATE_APP_TOKEN_LIBRARY2
   npm run secret:list:friend        # confirm the NAME is there (never the value)
   ```

   Setting it is inert while the old code runs — that build never reads the
   name — so this step changes nothing until step 2.

2. **Then deploy her** — `npm run deploy:friend`, from a **clean tree**.

⚠️ **Pipe-then-deploy has NO inert window. Deploy-then-pipe has one**, because
the new code looks for a name her env does not yet hold: her gate would log
`estate_config_unset` and behave as **OFF** — local auth only (Firebase + her
own role ladder), nobody locked out, nothing enforced — until the secret
landed. That inert failure is the deliberate safety property (a missing NAME
fails inert, where a wrong VALUE fails as a 401 the gate reports as
`estate_unreachable`), but there is no reason to spend it when the order is
free.

⚠️ **Clean tree is not optional for `deploy:friend`.** It builds
`apps/web/dist` from the WORKING TREE and uploads that directory — so any
concurrent agent's half-finished `apps/web/src` change ships to her site. This
is why the F-5 pass deployed main (tree verified clean at that moment) and
stopped: a second agent had `App.tsx` dirty. `predeploy:friend` runs
`check-clean.mjs` and will refuse; **do not reach for
`ALLOW_DIRTY_DEPLOY=1`** — take a `git worktree add <tmp> HEAD` checkout
instead, or wait.

**Verifying it — three levels, and only the third proves the value:**

| Level | Command | Proves |
|---|---|---|
| Identity | `https://padhard.heygabi.ai/api/health` → `estate.app` | she asserts `library2` and names `ESTATE_APP_TOKEN_LIBRARY2` |
| Config | same response → `estate.configured` | both halves are populated — **not** that the value is right |
| **Pairing** | `npm run tail:friend --workspace @lc/worker`, then a real sign-in | the line `"app":"library2"` with **`"src":"seen"`**. `"src":"none"` or `"stale_cache"` = the directory refused the bearer ⇒ wrong value, re-pipe |

⚠️ **`/api/health` IS EDGE-CACHED on both custom domains — measured
2026-08-17.** A plain fetch right after a deploy returned the PREVIOUS body
(no `estate` block at all) while `?cb=<random>` on the same URL returned the
new one. A post-deploy check without a cache-buster reads the old deployment
and looks exactly like a deploy that did not land. Always append a unique
query string, or hit the `*.workers.dev` host, which is not fronted by the
cache.

**Once the pairing is verified**, delete the stale name from her env —
`npx wrangler secret delete ESTATE_APP_TOKEN_LIBRARY --env friend --config apps/worker/wrangler.toml`.
Nothing reads it after this change, and a live credential nothing consumes is
one more thing a rotation will forget. ⚠️ Verify **first**: deleting it is the
only step here that is not free to get wrong.

**Rollback**, if her deploy misbehaves: `npx wrangler rollback --env friend
--config apps/worker/wrangler.toml` (list versions first with
`npx wrangler deployments list --env friend --config apps/worker/wrangler.toml`).
The previous version reads `ESTATE_APP_TOKEN_LIBRARY`, which is still set on
her env — so a rollback restores her exact prior behaviour, which is the second
reason not to delete that secret until the new pairing is proven.

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

1. `ESTATE_APP_TOKEN_LIBRARY2` on her env — design §6.7 says **mint a NEW
   token** for her (she is her own estate consumer, paired with the estate's
   4th visibility column, which is the auth-worker build); the auth Worker
   must hold the matching value under the **same name**, and has since
   2026-08-16. Until both sides exist, her estate check is off and sign-ins sit
   `pending` for manual approval on her People page. ⚠️ **The name is `_LIBRARY2`
   as of 2026-08-17** — it was `_LIBRARY` while the gate hard-coded the app id.
   Full story, and how to verify the pairing, in the estate-identity section
   above.
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
  `DETAILS_SWEEP_CRON` or `scheduled()` ignores it). ⚠️ It no longer skips for
  want of an AI key — first because the donor build (2026-08-16) gave it a free
  source, and then because she got her own key the same night. It runs
  donor-then-AI and **spends her money** every tick that the donor cannot fully
  answer — see below.

## The donor-first details sweep (built 2026-08-16)

Owner ask: *"before pinging the ai it checks other libraries for answers. If
I have Stormlight Archive don't have her look it up."*

**Her donor is the main library.** Every hourly tick, her sweep asks
`https://library.heygabi.ai/api/donor/details?title=…&author=…` for each
picked book's unasked missing details and copies what the main catalog
already holds, **before** any AI lookup.

⚠️ **Corrected 2026-08-17 (credentials catalog F-8).** This paragraph used to
say she ran in **donor-only mode** because she had no `ANTHROPIC_API_KEY`, and
that her tick's log line began `no ANTHROPIC_API_KEY — donor-only mode`. That
was true for a few hours on 2026-08-16 and has not been true since: she has her
**own** key (`wrangler secret list --env friend` confirms the name), so the
sweep is **donor-then-AI** — free answers from our catalog first, HER key and
HER money only for what the donor could not supply. Documents that say a
credential does not exist while it does are how a spend goes unnoticed; the
same claim was corrected in `wrangler.toml` and `scripts/push-secrets.mjs` the
same day.

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
