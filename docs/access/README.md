# docs/access — index

> **Audience:** Claude sessions. How to reach and operate things.

> ⚠️ **The estate-wide credentials catalog is LOCAL-ONLY in `audiobook_catalog/docs/access/CREDENTIALS.md`** — every custody store, every paired token, the three env-file patterns, and each rotation procedure, in one place. It is deliberately not tracked in any repo (all four are public and the aggregation is more sensitive than the scattered names-only convention). Names only there too; never a value, anywhere.
> Last verified: **2026-08-14**.

| File | Covers |
|---|---|
| [`cloudflare.md`](cloudflare.md) | **Everything Cloudflare**: what exists in the account, Workers-not-Pages and why, redeploy, rollback, logs, D1 queries, secrets, custom domains, troubleshooting |
| [`deploy.md`](deploy.md) | The short "what order do I do things in" version, plus the Firebase step and the review backfill |
| [`estate-auth.md`](estate-auth.md) | **`auth.heygabi.ai` (LIVE 2026-08-14)**: the estate directory Worker + D1, the admin API and the apex `/admin` page, `OWNER_EMAILS` break-glass, the three `ESTATE_APP_TOKEN_*` secrets by name and where each side holds them, seed script usage, deploy commands, the 10-min TTL = revocation delay |
| [`index-worker.md`](index-worker.md) | **`index.heygabi.ai` (LIVE, all three catalogs pushed)**: push protocol + per-source tokens by name, search vs lookup, each repo's freshness backstop, deploy commands, D1 id, ⚠️ the CORS/preflight lesson |
| [`themes.md`](themes.md) | The estate theme system: canonical asset location, per-repo vendoring/sync, storage keys, the per-site defaults table, deploy-wave order and what is live where |
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
`npm run deploy`. Do the two together — see `docs/HANDOFF.md`.

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
