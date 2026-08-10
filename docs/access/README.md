# docs/access — index

> **Audience:** Claude sessions. How to reach and operate things.
> Last verified: **2026-08-10**.

| File | Covers |
|---|---|
| [`cloudflare.md`](cloudflare.md) | **Everything Cloudflare**: what exists in the account, Workers-not-Pages and why, redeploy, rollback, logs, D1 queries, secrets, custom domains, troubleshooting |
| [`deploy.md`](deploy.md) | The short "what order do I do things in" version, plus the Firebase step and the review backfill |

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
