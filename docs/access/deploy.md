# Deploy & Provisioning — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (contains no secret values).
> **Last verified: 2026-09-22** — TWO things only: (a) the **Worker version row**
> in the *Live* table, now `a273b877` from the deploy pair that ran that morning
> (`docs/deploys.log`, `npx wrangler deployments list` = 100%), and (b) the new
> section *"`npm run deploy` is refused before check-clean runs"*, written from
> the three refusals of 2026-09-21 and the first-try success after the owner
> added two allow rules on 2026-09-22. ⚠️ **Measured by the conducting session,
> not by this one — this pass ran nothing.** ⚠️ **NOT re-checked on 2026-09-22:**
> every other row of the *Live* table (the D1 id, "both migrations applied", the
> Firebase rows, the Google Books row), the CI section, and every numbered
> section below. **No rendered page on either instance was looked at** — the
> 2026-09-22 evidence is `/api/health` and the deployments list, nothing more.
> Last verified before that: **2026-09-07** for the **CI** section only —
> `tests.yml` was added and its first run measured green. ⚠️ Nothing else on this
> page was re-checked then; everything below still carries its 2026-08-09 age
> (deployed and curled on that date), and the D1 row in the table is that old.

## CI — there are now TWO workflows, and only one of them deploys

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/tests.yml` | **push to `main` + PR + `workflow_call`** | Typecheck + the whole `npm test` suite on a runner. **Deploys nothing, holds no secret, cannot reach a live host.** |
| `.github/workflows/deploy.yml` | **`workflow_dispatch` only** | Migrate → build → `wrangler deploy` to the LIVE domain. ⚠️ **Do not add a push trigger** — this Worker has no dev lane. |

Added 2026-09-07 (estate testing audit §4.3): before it, the most recent CI run
of *any* kind here was **2026-08-17**, so the suite gated only `predeploy` on a
developer's machine. First green run **`34156956144`**, 2m19s —
[actions/workflows/tests.yml](https://github.com/skymitch9/library_catalog/actions/workflows/tests.yml).

⚠️ **A push now runs the suite on Node 22 while this machine is on Node 24**, so
the runner is where a version-specific break (e.g. `node:sqlite`) shows up
first. And it covers **3,026 of 3,027** cases, not all of them — the missing one
is [KI-21](../KNOWN_ISSUES.md). `deploy.yml` is **not** gated on it: `npm run
deploy` runs the same suite via `predeploy` inside its own job.

## Live

**https://library-catalog.bgc-worker.workers.dev**

➡️ **For anything Cloudflare-side — resource ids, redeploy, rollback, logs,
custom domains, troubleshooting — see [`cloudflare.md`](cloudflare.md).** This
file is the shorter "what order do I do things in" version.

| | State |
|---|---|
| Remote D1 | ✅ `library-catalog`, WNAM, `6022ea5e-2510-450e-81ce-7d847fa31379`, both migrations applied |
| Worker | ✅ deployed, version `a273b877-05b7-4dd1-8c09-db2327fc9b7d` — **2026-09-22T15:38:03Z**, on commit `1577628`, crons `7 * * * *` / `23 */4 * * *` / `47 9 * * *`, custom domain `library.heygabi.ai`. Friend's half of the same pair: `3c684023-7307-4f8f-ba5e-8ed4f7e78d03` at 15:39:19Z — [`second-instance.md`](second-instance.md), and `docs/deploys.log` is the full record. (Was `6915f005-a660-4553-8312-8d1d20174fd3` from 2026-08-09; the row had gone un-updated through eleven deploy pairs.) |
| Firebase project | ✅ `audiobook-catalog` — **shared. Do not create a second one.** |
| Firebase authorised domain | ✅ added 2026-08-09 |
| Ownership | ✅ claimed by `nbaslamking@gmail.com` |
| Google Books API key | ❌ not obtained (rung skipped without it) |


## 1–2. Create, migrate, deploy — done

```bash
npm run db:create          # done → 6022ea5e-2510-450e-81ce-7d847fa31379
npm run db:migrate         # done → 0001 and 0002 applied remotely
npm run deploy             # done
```

A redeploy from now on is just `npm run deploy`. `predeploy` refuses a dirty
tree. **Migrate before deploying**, so new code never meets an old schema.

> ⚠️ **Deploying from a shared tree with other writers' WIP in it — use a
> throwaway worktree, and put it at a SHORT path (measured 2026-09-05).**
> `git worktree add --detach <path> HEAD` at the Claude scratchpad path
> (`%TEMP%\claude\<long-project-slug>\<session>\...`) fails with **"Filename
> too long"** on two cover files in this repo — the checkout aborts half-made.
> `C:/lcw/wt-<name>` works. Then junction `node_modules` from the main
> checkout rather than `npm ci` (a fresh install can resolve deps differently
> from the tree the tests passed on — see `DONE.md`), run the tests and both
> deploys from inside the worktree, remove the junctions with `rmdir` on the
> reparse points, and `git worktree remove` it. Both W8-SERIES-VOL and
> W8-GUARD shipped this way that day (`deploys.log` pairs at
> 2026-09-06T05:06Z, holder logged as `unknown`, and 05:30Z).

## ⚠️ `npm run deploy` is refused before check-clean runs — the Claude session's command classifier

**Symptom.** A Claude Code session in auto mode types `npm run deploy` and the
command never starts. No `predeploy` output, no check-clean message, no
deploy-guard message, no `.deploy.lock` — **nothing in this repo ran at all.**
The refusal text names the classifier, e.g. *"denied by the Claude Code auto
mode classifier"*.

**Cause.** Auto mode classifies a command that ships to a live domain as one
needing explicit permission. This is the HARNESS refusing, upstream of every
guard this repo owns.

**Tell it apart from the repo's own guards** — they are three different failures
with three different fixes:

| Refusal | Who said it | What it means |
|---|---|---|
| *"denied by the Claude Code auto mode classifier"* | the Claude session's harness | the command never started; add an allow rule (below) |
| `check-clean` printing a dirty-tree list | `scripts/check-clean.mjs` | commit or use a throwaway worktree (see the note above) |
| `deploy-guard` printing an ancestry complaint | `scripts/deploy-guard.mjs` | the live commit is not in the tree you are shipping |

⚠️ **The guards print their own reasons. The classifier prints the harness's.**
If you see no repo output whatsoever, it is the classifier — do not go looking
for a dirty file.

**The fix**, applied by the owner 2026-09-22 ~08:35 Phoenix: two entries in the
`permissions.allow` list of `~/.claude/settings.json` —

```
Bash(npm run deploy:*)
Bash(npm run deploy)
```

Both are needed: the glob does not cover the bare form. With them, the deploy
ran **first try**, and `predeploy` then did its job normally (check-clean,
deploy-guard and the full suite, all inside the deploy).

🔴 **That file lives in the operator's home directory and is NOT in git — a
rebuilt machine loses it**, and the symptom on the new machine is this section's
symptom with nobody left who remembers the cause. The rule belongs to machine
state: see the machine-state section of
`catalog-platform/docs/access/RECOVERY.md`, which owns it.

⚠️ **CI is not a way around this.** `.github/workflows/deploy.yml` deploys
**MAIN only**, so dispatching it would half-ship under the estate's
both-instances rule — a build on one instance is not a deploy. The pair
(`npm run deploy` then `npm run deploy:friend`, or `npm run deploy:both`) has to
run from a machine.

**Measured 2026-09-21/22 by the conducting session** (this page's author ran
nothing): three refusals on 2026-09-21 — twice through the Bash tool, once
through PowerShell — all before any repo guard executed; then first-try success
on 2026-09-22 once the two rules existed. Both halves of that pair are in
`docs/deploys.log`. The episode's record is the top entry of
[`../DONE.md`](../DONE.md).

## 3. Firebase authorised domain — done 2026-08-09

`library-catalog.bgc-worker.workers.dev` is on the allow-list and **sign-in is
verified working in production**: a real Google ID token was minted, sent as a
bearer token, verified by the Worker against Google's public keys with issuer and
audience asserted, and `app_user` id 1 was created as `owner`.

Repeat this for any additional host (a custom domain). Until a host is on the
list, Google returns `auth/unauthorized-domain` and the app sits on its sign-in
screen. It cannot be scripted — the list is Identity Platform admin config and
`firebase-tools` has no command for it.

> Firebase console → project **audiobook-catalog** → Authentication → Settings →
> **Authorised domains** → Add domain →
> `library-catalog.bgc-worker.workers.dev`

⚠️ Do **not** create a second Firebase project or Firestore database, and do not
change `FIREBASE_PROJECT_ID`. Sharing `audiobook-catalog` is the entire mechanism
by which one Google account is one person across both catalogs — a second project
mints different tokens for the same human and silently forks every user. Reviews
go to the *same* `reviews` collection, which is why one review shows on both
sites with no sync job.

## 4. Claim ownership — done 2026-08-09

```
id 1  nbaslamking@gmail.com  firebase_uid set  display_name "Skylar"
      review_name "Skylar"   role owner
```

⚠️ `review_name` is the load-bearing field. Review document ids are
`{bookId}_{displayNameLower}`, and the existing audiobook reviews are filed under
`…_skylar` — so this account's reviews on both sites are **the same documents**,
which is the whole point of the bridge. Changing a Google display name would
split them; that is why the value is stored here rather than read live.

The bootstrap rule has now fired and can never fire again: everyone signing in
from here lands as `pending` until an owner approves them. `OWNER_EMAILS` stays
empty; it is a lock-out recovery hatch only.

## 5. Optional — Google Books

```bash
npm run secret GOOGLE_BOOKS_API_KEY
```

Free, from the Google Cloud console with the Books API enabled. Without it the
rung is skipped and says so in the scan trace. This is **not** a graceful
degradation choice — anonymous Google Books returns HTTP 429 on every call from
here (measured 40/40, see `docs/info/isbn-ladder.md`), so a key is the only way
that rung works at all.

## 6. The review backfill — owner's call, not automatic

```bash
npm run backfill:reviews                # dry run (default) — reads only
npm run backfill:reviews -- --commit    # writes workKey to live `reviews`
```

Dry-run result 2026-08-09: **860 documents, 860 matched, 0 unmatched.**

⚠️ This writes to the audiobook site's live review data. It has not been run.
Read `docs/info/identity-and-reviews.md` §5 first.

## Useful

| Command | Does |
|---|---|
| `npm run dev` | worker on :8787 + web on :5174 |
| `npm test` | core rules (26 tests) |
| `npm run typecheck` | all five workspaces |
| `npm run db:migrate:local` | apply migrations to `.wrangler/state` |
| `wrangler tail --config apps/worker/wrangler.toml` | live logs |

## Secrets — names only, never values

| Name | Where | Needed for |
|---|---|---|
| `GOOGLE_BOOKS_API_KEY` | `wrangler secret put` | ISBN rung 2 |
| `ANTHROPIC_API_KEY` | `wrangler secret put` | research pipeline (phase 5, unbuilt) |

Local equivalents live in `apps/worker/.dev.vars`, which is gitignored.
