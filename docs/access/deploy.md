# Deploy & Provisioning — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (contains no secret values).
> Last verified: **2026-08-09** — deployed and curled on that date.

## Live

**https://library-catalog.bgc-worker.workers.dev**

➡️ **For anything Cloudflare-side — resource ids, redeploy, rollback, logs,
custom domains, troubleshooting — see [`cloudflare.md`](cloudflare.md).** This
file is the shorter "what order do I do things in" version.

| | State |
|---|---|
| Remote D1 | ✅ `library-catalog`, WNAM, `6022ea5e-2510-450e-81ce-7d847fa31379`, both migrations applied |
| Worker | ✅ deployed, version `6915f005-a660-4553-8312-8d1d20174fd3` |
| Firebase project | ✅ `audiobook-catalog` — **shared. Do not create a second one.** |
| Firebase authorised domain | ✅ added 2026-08-09 |
| Ownership | ✅ claimed by `nbaslamking@gmail.com` |
| Google Books API key | ❌ not obtained (rung skipped without it) |
| `EBOOK_INGEST_TOKEN` | ❌ not set, so `/api/ingest/*` 404s |

## 1–2. Create, migrate, deploy — done

```bash
npm run db:create          # done → 6022ea5e-2510-450e-81ce-7d847fa31379
npm run db:migrate         # done → 0001 and 0002 applied remotely
npm run deploy             # done
```

A redeploy from now on is just `npm run deploy`. `predeploy` refuses a dirty
tree. **Migrate before deploying**, so new code never meets an old schema.

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
