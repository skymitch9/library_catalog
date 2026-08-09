# docs/access — index

> **Audience:** Claude sessions. How to reach and operate things.
> Last verified: **2026-08-09**.

| File | Covers |
|---|---|
| [`cloudflare.md`](cloudflare.md) | **Everything Cloudflare**: what exists in the account, Workers-not-Pages and why, redeploy, rollback, logs, D1 queries, secrets, custom domains, troubleshooting |
| [`deploy.md`](deploy.md) | The short "what order do I do things in" version, plus the Firebase step and the review backfill |

Nothing here contains a secret value. Credentials are named, and the command to
set them is given; the values live in `wrangler secret` and in
`apps/worker/.dev.vars` (gitignored).

**The one thing to know:** Cloudflare is **done** — D1 created, migrated, Worker
deployed at `https://library-catalog.bgc-worker.workers.dev`. The only remaining
blocker is a **Firebase** console click: add that host to Authentication →
Settings → Authorised domains on the `audiobook-catalog` project, or Google
sign-in fails with `auth/unauthorized-domain`.
