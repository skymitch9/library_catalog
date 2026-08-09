# docs/access — index

> **Audience:** Claude sessions. How to reach and operate things.
> Last verified: **2026-08-09**.

| File | Covers |
|---|---|
| [`deploy.md`](deploy.md) | Provisioning D1, deploying, Firebase authorised domains, claiming ownership, secret names, the review backfill |

Nothing here contains a secret value. Credentials are named, and the command to
set them is given; the values live in `wrangler secret` and in
`apps/worker/.dev.vars` (gitignored).

**The one thing to know before deploying:** nothing exists in Cloudflare yet.
`wrangler.toml` has a placeholder `database_id`.
