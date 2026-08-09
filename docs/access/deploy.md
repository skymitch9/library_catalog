# Deploy & Provisioning — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (contains no secret values).
> Last verified: **2026-08-09**.
> ⚠️ **Nothing in the Cloudflare account has been created yet.** Every command
> below is unrun. `wrangler.toml` carries a placeholder `database_id` and the
> app cannot deploy until step 1 replaces it.

## What exists and what does not

| | State |
|---|---|
| Repo, schema, Worker, web app | ✅ built, typechecks, tested, runs locally |
| Local D1 (`.wrangler/state`) | ✅ migrated, 39 statements applied |
| **Remote D1 database** | ❌ not created |
| **Worker deployment** | ❌ never deployed |
| Firebase project | ✅ exists — `audiobook-catalog`, shared with the audiobook site. Nothing new to create. |
| Google Books API key | ❌ not obtained (rung skipped without it) |

## 1. Create the D1 database

```bash
npm run db:create          # wrangler d1 create library-catalog
```

Paste the printed `database_id` into `apps/worker/wrangler.toml`, replacing
`REPLACE_ME_AFTER_db:create`.

## 2. Migrate, then deploy — in that order

```bash
npm run db:migrate         # --remote
npm run deploy             # builds the web app, then wrangler deploy
```

`predeploy` refuses a dirty tree. Migrate first so new code never meets an old
schema.

## 3. Firebase — authorise the new domain

The Worker verifies Firebase ID tokens from project `audiobook-catalog`; that
needs no setup. What **does** need one manual step: the Worker's URL must be
added to Firebase Auth's authorised domains, or Google sign-in fails in the
browser with `auth/unauthorized-domain`.

> Firebase console → Authentication → Settings → Authorised domains → Add
> `library-catalog.<your-subdomain>.workers.dev`

⚠️ Do **not** create a second Firebase project. `FIREBASE_PROJECT_ID` in
wrangler.toml must stay `audiobook-catalog` — it is the entire mechanism by
which one Google account is one person across both catalogs.

## 4. Claim ownership

The first person to sign in against an empty `app_user` table becomes `owner`.
Sign in immediately after deploying. `OWNER_EMAILS` stays empty; it is a
lock-out recovery hatch only.

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
