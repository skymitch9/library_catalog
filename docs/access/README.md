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
| `npm run sync:drive-map` | Copies `author_drive_map.json` from the audiobook repo into `apps/web/public/`. Needs no credentials. |

⚠️ `backfill:covers --remote --commit` writes URLs that only resolve after
`npm run deploy`. Do the two together — see `docs/HANDOFF.md`.

Nothing here contains a secret value. Credentials are named, and the command to
set them is given; the values live in `wrangler secret` and in
`apps/worker/.dev.vars` (gitignored).

**The one thing to know:** Cloudflare is **done** — D1 created, migrated, Worker
deployed at `https://library-catalog.bgc-worker.workers.dev`. The only remaining
blocker is a **Firebase** console click: add that host to Authentication →
Settings → Authorised domains on the `audiobook-catalog` project, or Google
sign-in fails with `auth/unauthorized-domain`.
