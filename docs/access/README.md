# docs/access — index

> **Audience:** Claude sessions. How to reach and operate things.

> ⚠️ **The estate-wide credentials catalog is LOCAL-ONLY in `audiobook_catalog/docs/access/CREDENTIALS.md`** — every custody store, every paired token, the three env-file patterns, and each rotation procedure, in one place. It is deliberately not tracked in any repo (all four are public and the aggregation is more sensitive than the scattered names-only convention). Names only there too; never a value, anywhere.
> Last verified: **2026-08-14**.

| File | Covers |
|---|---|
| [`RECOVERY.md`](RECOVERY.md) | 🔴 **REBUILD FROM NOTHING (new 2026-08-18)** — *from a git clone and the blob backups, how do I rebuild this app?* Full inventory (⚠️ **both instances** — main and `padhard`), the rebuild order with the step everyone forgets (**paste the new `database_id`s**), every secret by NAME with custody and re-mint console, what a rebuild CANNOT recover, and a **drilled-vs-inference** table. ⚠️ `library-covers` has **no local master** — the dump is the only path back. Restore *mechanics* are not duplicated: `catalog-platform/docs/access/RECOVERY.md` is the source of truth |
| [`cloudflare.md`](cloudflare.md) | **Everything Cloudflare**: what exists in the account, Workers-not-Pages and why, redeploy, rollback, logs, D1 queries, secrets, custom domains, troubleshooting |
| [`deploy.md`](deploy.md) | The short "what order do I do things in" version, plus the Firebase step and the review backfill |
| [`secrets.md`](secrets.md) | **How to set/push/rotate secrets + the ops-command reference** (2026-08-26). 🔐 **1Password vault `Estate` is the MASTER since 2026-08-26** (owner option A) — `apps/worker/.dev.vars` is now a GENERATED artifact, `.dev.vars.tpl` is the tracked names-and-pointers template, and `npm run secrets:push:op` never writes a value to disk. Read the item-title convention there before adding a key anywhere in the estate, and the two `op inject` traps before debugging one. ⚠️ It also records **three measured custody gaps** — `ESTATE_APP_TOKEN_LIBRARY`, `INDEX_PUSH_TOKEN` and `AUDIOBOOK_MAPPING_TOKEN` are live with no readable master, so no bulk run can rotate them. (2026-08-25 material follows.) ⚠️ The rule: a raw key never enters chat and Claude never reads `.dev.vars` — owner sets it interactively OR drops it in `.dev.vars` and Claude runs `secrets:push`. Includes the `HARDCOVER_API_TOKEN` steps and which npx commands Claude can run vs which need the owner. Custody inventory stays in `RECOVERY.md`. 🆕 **2026-09-05:** *"The two NAMES the CLI spending gate reads"* — the five CLI money paths (L9–L13) now read `ESTATE_APP_TOKEN_LIBRARY` / `ESTATE_APP_TOKEN_LIBRARY2` from `process.env` first, then `.dev.vars`; ⚠️ **neither is set anywhere readable today**, so the gate reports the policy UNKNOWN and proceeds until the owner re-mints one. |
| [`estate-auth.md`](estate-auth.md) | **`auth.heygabi.ai` (LIVE 2026-08-14)**: the estate directory Worker + D1, the admin API and the apex `/admin` page, `OWNER_EMAILS` break-glass, the three `ESTATE_APP_TOKEN_*` secrets by name and where each side holds them, seed script usage, deploy commands, the 10-min TTL = revocation delay |
| [`index-worker.md`](index-worker.md) | **`index.heygabi.ai` (LIVE, all three catalogs pushed)**: push protocol + per-source tokens by name, search vs lookup, each repo's freshness backstop, deploy commands, D1 id, ⚠️ the CORS/preflight lesson |
| [`themes.md`](themes.md) | The estate theme system: canonical asset location, per-repo vendoring/sync, storage keys, the per-site defaults table, deploy-wave order and what is live where |
| [`gabi-memory.md`](gabi-memory.md) | **GABI's panel memory (LIVE 2026-08-18, both instances)**: the `gabi_conversation` table, the 30-min/20-turn window, how to look at what she remembers and how to make her forget, what continuity is costing (`gabi_turn.history_*`, ⚠️ NULL ≠ 0), and the symptom→cause table. ⚠️ **The limits are changed in catalog-platform, not here** — the substrate is shared with her Discord surface on purpose |
| [`gabi-delegated.md`](gabi-delegated.md) | **GABI's Tier-1 write door (LIVE 2026-08-18, both instances)**: `POST /api/gabi/delegated/{whoami,add-isbn,run-details}`, the `ESTATE_APP_TOKEN_DISCORD` pairing (one value, THREE holders, same name), the three-level verification and what each level does and does not prove, the `gabi-discord` provenance stamp and how to undo it, and ⚠️ the Git-Bash `curl -X POST → HTTP 000` trap |
| [`provision-catalog.md`](provision-catalog.md) | 🆕 **Standing up a THIRD (fourth…) instance from an accepted `catalog_request`** (2026-09-05) — the owner-run `npm run provision:catalog -- --request <id> [--dry] [--resume]`. 🔴 **Never web-triggered**, and ⚠️ **no real instance has been provisioned by it yet — nothing has run past `--dry`**. The twelve steps and which are AUTO vs the two 🔴 MANUAL pauses; what `--resume` can genuinely MEASURE (the live Firebase domain list) versus only assert (the auth Worker being deployed); the naming rule (the host and env follow the person, the D1 / bucket / estate app id stay ORDINAL because none can be renamed); which secrets are pushed, refused and minted; and ⚠️ that the new instance runs on the **OWNER'S** `ANTHROPIC_API_KEY` and spends his money hourly. Design of record: `catalog-platform/docs/info/request-a-catalog-design.md` §7 |
| [`audiobook-sweep.md`](audiobook-sweep.md) | 🆕 **The audiobook association sweep, now a ROUTE + CRON on both instances (2026-09-06)** — 🔴 **deployed in SHADOW: it computes its whole plan and writes NOTHING, and STEP 11 of the audiobook pipeline is still doing all the writing.** How to read `detail.audiobookSweep` on `/api/health` with no sign-in and what each of the five silences means (`unchanged` / `drift` / `empty snapshot` / `empty-read` / `mode off` are NOT interchangeable); the admin `POST …/audiobooks/sweep` with `{"dryRun":true}` and how to get the owner bearer; the script-vs-route comparison table that is the flip gate (**≥42 shadow ticks with zero divergences**, and a divergence is almost certainly the series-canon skew — the ROUTE is the stale side); the two cron strings that must match in BOTH `[triggers]` blocks; and 🔴 **the rollback, which is one word: `AUDIOBOOK_SWEEP_MODE = "off"`.** ⚠️ Measured 2026-09-06: both migrated, both deployed, both `mode: "shadow"`, plans byte-identical to the script on both — but **no `audiobook_sweep_run` row exists yet on either instance**, so no tick has been observed. Why: [`../info/series-formats-and-audiobooks.md` §4.12](../info/series-formats-and-audiobooks.md) |
| [`audits.md`](audits.md) | 🆕 **The two STANDING AUDITS, now a ROUTE + CRON on both instances (2026-09-06)** — platform inventory §7 #5 and #6 — cover health and the bare-series alarm. 🔴 **Both are READ-ONLY: they write nothing to any catalog table, ever, so a finding is a QUESTION for a person.** How to read `detail.coverHealth` / `detail.seriesAggregates` on `/api/health` with no sign-in, and 🔴 **the four readings that look alike and are not** — *never run* / *ran and found nothing* / *refused* / *cancelled*; the refusal reasons (`empty-read`, `run row failed` = migration 0480 missing here); ⚠️ why `unreachable` is not `broken` and why you must **never blank a cover URL to make the number go down**; ⚠️ why a nightly `broken: 0` means *the 250 I looked at were fine* and the SCRIPT is the uncapped instrument; the admin `POST /api/admin/audits/{cover-health,series-aggregates}` and how to get the bearer; and 🔴 **the rollback, which is one edit: delete `"47 9 * * *"` from BOTH `[triggers]` blocks.** ⚠️ Measured 2026-09-06: both migrated, both deployed, both keys live on both hosts — but **no cron tick has been observed yet**, so the trigger is claimed rather than verified. Why: [`../info/audit-routes.md`](../info/audit-routes.md) |
| [`second-instance.md`](second-instance.md) | **The friend's library (`[env.friend]`, LIVE 2026-08-16)**: `padhard.heygabi.ai` (settled name), D1 `library-catalog-2nd`, bucket `library-2nd-covers`, the `:friend` command set, per-instance deploys.log/guard behaviour, rollback, her four secrets and who sets them (⚠️ **never push-synced** — there is no `.dev.vars.friend`), her own estate identity **`library2`** (fixed 2026-08-17, credentials catalog F-5), and the **donor-first details sweep** (donor-then-AI: the main library answers what it can for free, her own key pays for the rest) |
| [`ebook-retirement.md`](ebook-retirement.md) | **Ebook split PHASE 5 — ✅ APPLIED 2026-09-05 ~23:07–23:10 UTC** at the owner's GO, so this is now the RECORD and the REVERSAL path, ~~the owner's go/no-go runbook~~. Export → plan → apply → unset `EBOOK_INGEST_TOKEN`, one command each, with the reversal path committed under `docs/archive/`. Measured on main: `work` 497→**411**, `edition` 568→**445**, ebook editions 126→**3**, `ebook_holding` 126→**40**, `copy` and `change_log` **untouched**; the token is unset on **both** Workers and both hosts went **401 → 404 `ingest_disabled`**. Carries the two things the design got wrong, both re-measured against production: the *"human-asserted read states must be 0"* precondition was **3** (works 358–360, typed fifteen minutes before the reading that recorded 0) — ⚠️ **the owner chose to KEEP those three works**, so they and their 3 ebook editions survive; and `--prune --force-prune` — the instrument the design's §6 names — matched **26 of 127** editions because the 2026-08-20 sweep rewrote `edition.source`. ⚠️ Also: **padhard held 0 ebook rows** (a no-op there, and her plan step was run read-only to put that on the record; the secret was hers too and is unset), and 🔴 **do not run `backfill:ebooks` now** — it would mark the 40 surviving holdings stale |

⚠️ Estate token **values** live in **Cloudflare Worker secrets, which are
write-only** — nothing on this machine can read one back. The two estate docs
name the secrets; never paste a value anywhere.

> **Corrected 2026-08-17 (estate credentials catalog F-7).** These lines used
> to name a session scratchpad `estate-app-tokens.json` as where the values
> live. **That file no longer exists** (searched, 2026-08-17), and pointing a
> future session at it is worse than useless: it implies a copy exists to
> compare against. There is none. If a value is genuinely needed, the answer is
> to **mint a new one and set it on BOTH holders in one sitting** — never to go
> looking for the old one. The names, the pairings, and which side holds what
> are catalogued in `audiobook_catalog/docs/access/CREDENTIALS.md` (LOCAL ONLY,
> gitignored).

### Commands added 2026-08-10

| Command | Does |
|---|---|
| `npm run backfill:covers [-- --remote] [-- --commit]` | Extracts covers from the EPUBs into `apps/web/public/covers` and sets `work.cover_url`. Dry-run, local, by default. |
| `npm run backfill:series [-- --remote] [-- --commit]` | Fills `work.series` / `series_index_*`. Same defaults. |
| `npm run backfill:openlibrary-ids [-- --remote] [-- --commit]` | Fills `work.openlibrary_work_id`. Dry-run, local, by default. Talks to openlibrary.org (~300 calls on a cold run, ~1/sec, no key needed); a warm run makes **zero** calls because `scripts/openlibrary-ids.json` caches every answer including the misses. |
| `npm run sync:drive-map` | Copies `author_drive_map.json` from the audiobook repo into `apps/web/public/`. Needs no credentials. |
| `npm run backfill:openlibrary-ids -- --remote --aliases-from-local` | Same dry run, but reads `work_alias` from the **local** database and joins it to the production works **by `work_key`**. Exists because production has not had migration 0005 applied and has no alias rows; it measures what the aliases would do without writing to production. See [`../info/aliases-export-people.md`](../info/aliases-export-people.md) §1.7. |

### Downloads (owner only, `editCatalog`)

| Route | Gives |
|---|---|
| `GET /api/export.json` | Every row of twelve tables, with the applied migration list stamped on it. Streamed, paged 500 at a time. **The backup.** |
| `GET /api/export.csv` | One row per work, flattened, BOM-prefixed so Excel reads UTF-8. Lossy. |

⚠️ Both need a **Bearer token**, so `curl localhost:8787/api/export.json` works
only because of the dev bypass. In the browser they are fetch-and-Blob, not
`<a download>` — an anchor sends no Authorization header and 401s in production
while working perfectly in local dev.

⚠️ `backfill:covers --remote --commit` writes URLs that only resolve after
`npm run deploy`. Do the two together — see [`deploy.md`](deploy.md).

⚠️ `backfill:openlibrary-ids` needs **no** deploy and **no** migration — the
column has existed since migration 0001 and nothing serves it yet. Read its
outlier list before `--commit`; see [`../info/openlibrary-ids.md`](../info/openlibrary-ids.md).

Nothing here contains a secret value. Credentials are named, and the command to
set them is given; the values live in `wrangler secret` and in
`apps/worker/.dev.vars` (gitignored).

~~**The one thing to know:** Cloudflare is **done** — D1 created, migrated, Worker
deployed at `https://library-catalog.bgc-worker.workers.dev`. The only remaining
blocker is a **Firebase** console click: add that host to Authentication →
Settings → Authorised domains on the `audiobook-catalog` project, or Google
sign-in fails with `auth/unauthorized-domain`.~~

🔴 **Corrected 2026-09-05 (docs audit): there is no remaining blocker, and this
paragraph has been describing a first-deploy state since 2026-08-09.** Measured
that day: `https://library.heygabi.ai/` and `https://padhard.heygabi.ai/` both
answer **200**, both serve the same bundle (`assets/index-BcUnvzMK.js`), and
both `/api/health` answer `{"ok":true,"database":"up"}` with
`estate.mode = "enforce"` (apps `library` and `library2`, tokens configured).
Two live instances, eleven deploy pairs in `docs/deploys.log` since 2026-08-25.

⚠️ **The Firebase authorised-domain step is still REAL — it just is not a
blocker on THESE two hosts.** It is a step in standing up a NEW instance, and
it is 🔴 MANUAL PAUSE #1 of the provisioner:
[`provision-catalog.md`](provision-catalog.md). Left here in struck form
because the failure mode it names (`auth/unauthorized-domain`) is the exact
symptom a new host shows, and that is worth keeping findable.

- [`rollback-points.md`](rollback-points.md) — annotated rollback ids. `docs/deploys.log` is the newer, more complete record; prefer it.
