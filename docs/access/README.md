# docs/access — index

> **Audience:** Claude sessions. How to reach and operate things.

> ⚠️ **The estate-wide credentials catalog is LOCAL-ONLY in `audiobook_catalog/docs/access/CREDENTIALS.md`** — every custody store, every paired token, the three env-file patterns, and each rotation procedure, in one place. It is deliberately not tracked in any repo (all four are public and the aggregation is more sensitive than the scattered names-only convention). Names only there too; never a value, anywhere.
> Last verified: **2026-08-14**.

| File | Covers |
|---|---|
| [`RECOVERY.md`](RECOVERY.md) | 🔴 **REBUILD FROM NOTHING (new 2026-08-18)** — *from a git clone and the blob backups, how do I rebuild this app?* Full inventory (⚠️ **both instances** — main and `padhard`), the rebuild order with the step everyone forgets (**paste the new `database_id`s**), every secret by NAME with custody and re-mint console, what a rebuild CANNOT recover, and a **drilled-vs-inference** table. ⚠️ `library-covers` has **no local master** — the dump is the only path back. Restore *mechanics* are not duplicated: `catalog-platform/docs/access/RECOVERY.md` is the source of truth |
| [`cloudflare.md`](cloudflare.md) | **Everything Cloudflare**: what exists in the account, Workers-not-Pages and why, redeploy, rollback, logs, D1 queries, secrets, custom domains, troubleshooting |
| [`deploy.md`](deploy.md) | The short "what order do I do things in" version, plus the Firebase step and the review backfill |
| [`secrets.md`](secrets.md) | **How to set/push/rotate secrets + the ops-command reference** (2026-08-26). 🔐 **1Password vault `Estate` is the MASTER since 2026-08-26** (owner option A) — `apps/worker/.dev.vars` is now a GENERATED artifact, `.dev.vars.tpl` is the tracked names-and-pointers template, and `npm run secrets:push:op` never writes a value to disk. Read the item-title convention there before adding a key anywhere in the estate, and the two `op inject` traps before debugging one. ⚠️ It also records **three measured custody gaps** — `ESTATE_APP_TOKEN_LIBRARY`, `INDEX_PUSH_TOKEN` and `AUDIOBOOK_MAPPING_TOKEN` are live with no readable master, so no bulk run can rotate them. (2026-08-25 material follows.) ⚠️ The rule: a raw key never enters chat and Claude never reads `.dev.vars` — owner sets it interactively OR drops it in `.dev.vars` and Claude runs `secrets:push`. Includes the `HARDCOVER_API_TOKEN` steps and which npx commands Claude can run vs which need the owner. Custody inventory stays in `RECOVERY.md`. |
| [`estate-auth.md`](estate-auth.md) | **`auth.heygabi.ai` (LIVE 2026-08-14)**: the estate directory Worker + D1, the admin API and the apex `/admin` page, `OWNER_EMAILS` break-glass, the three `ESTATE_APP_TOKEN_*` secrets by name and where each side holds them, seed script usage, deploy commands, the 10-min TTL = revocation delay |
| [`index-worker.md`](index-worker.md) | **`index.heygabi.ai` (LIVE, all three catalogs pushed)**: push protocol + per-source tokens by name, search vs lookup, each repo's freshness backstop, deploy commands, D1 id, ⚠️ the CORS/preflight lesson |
| [`themes.md`](themes.md) | The estate theme system: canonical asset location, per-repo vendoring/sync, storage keys, the per-site defaults table, deploy-wave order and what is live where |
| [`gabi-memory.md`](gabi-memory.md) | **GABI's panel memory (LIVE 2026-08-18, both instances)**: the `gabi_conversation` table, the 30-min/20-turn window, how to look at what she remembers and how to make her forget, what continuity is costing (`gabi_turn.history_*`, ⚠️ NULL ≠ 0), and the symptom→cause table. ⚠️ **The limits are changed in catalog-platform, not here** — the substrate is shared with her Discord surface on purpose |
| [`gabi-delegated.md`](gabi-delegated.md) | **GABI's Tier-1 write door (LIVE 2026-08-18, both instances)**: `POST /api/gabi/delegated/{whoami,add-isbn,run-details}`, the `ESTATE_APP_TOKEN_DISCORD` pairing (one value, THREE holders, same name), the three-level verification and what each level does and does not prove, the `gabi-discord` provenance stamp and how to undo it, and ⚠️ the Git-Bash `curl -X POST → HTTP 000` trap |
| [`second-instance.md`](second-instance.md) | **The friend's library (`[env.friend]`, LIVE 2026-08-16)**: `padhard.heygabi.ai` (settled name), D1 `library-catalog-2nd`, bucket `library-2nd-covers`, the `:friend` command set, per-instance deploys.log/guard behaviour, rollback, her four secrets and who sets them (⚠️ **never push-synced** — there is no `.dev.vars.friend`), her own estate identity **`library2`** (fixed 2026-08-17, credentials catalog F-5), and the **donor-first details sweep** (donor-then-AI: the main library answers what it can for free, her own key pays for the rest) |

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

**The one thing to know:** Cloudflare is **done** — D1 created, migrated, Worker
deployed at `https://library-catalog.bgc-worker.workers.dev`. The only remaining
blocker is a **Firebase** console click: add that host to Authentication →
Settings → Authorised domains on the `audiobook-catalog` project, or Google
sign-in fails with `auth/unauthorized-domain`.

- [`rollback-points.md`](rollback-points.md) — annotated rollback ids. `docs/deploys.log` is the newer, more complete record; prefer it.
