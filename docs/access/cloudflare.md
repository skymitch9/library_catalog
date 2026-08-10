# Cloudflare — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (no secret values).
> Last verified: **2026-08-09** — every resource below was created and curled on
> that date.

## TL;DR — there is nothing you *must* do on Cloudflare

Provisioning and deployment are **done**. The site is live:

**https://library-catalog.bgc-worker.workers.dev**

The one remaining blocker before anyone can sign in is **not** on Cloudflare — it
is a single click in the **Firebase** console. See §5.

Everything else in this file is optional, or is a runbook for later.

---

## 1. What exists in the account

| | |
|---|---|
| Account | `nbaslamking@gmail.com` · `113be82b840c956b8378a187047ab3ea` |
| Worker | `library-catalog` · version `6915f005-a660-4553-8312-8d1d20174fd3` |
| URL | `https://library-catalog.bgc-worker.workers.dev` |
| D1 database | `library-catalog` · `6022ea5e-2510-450e-81ce-7d847fa31379` · region **WNAM** |
| Migrations applied | `0001_init.sql` (39 statements), `0002_cwa_ebook_formats.sql` (12) |
| Static assets | 5 files, 302 KiB, served by the Worker's `[assets]` binding |
| R2 bucket | **none, deliberately** — see §7 |
| Cron triggers | **none yet** — phase 5 adds one |
| Secrets set | **none yet** — see §4 |

Verified by curl immediately after deploying:

```
GET  /api/health         {"ok":true,"version":"0.1.0","database":"up"}
GET  /api/me             401 {"error":"unauthenticated"}
POST /api/ingest/ebook   404 {"error":"ingest_disabled"}
GET  /                   <title>Library</title>
```

⚠️ The `/api/me` 401 is the important one. It proves the **dev bypass is inert in
production** — `middleware/auth.ts` only honours `DEV_EMAIL` when
`ENVIRONMENT !== 'production'`, and this is the check that the gate is really
holding rather than merely being written down.

---

## 2. ⚠️ Workers, not Pages — and why that differs from the audiobook site

`audiobook_catalog` is a **static site on Cloudflare Pages**, built from a git
branch, with a two-lane prod//dev/ deploy.

`library_catalog` is a **Worker**. It serves the API *and* the built React app
from one origin via the `[assets]` binding.

The difference is not stylistic: this app has a database behind it, and a static
host cannot answer `/api/*`. **There is no Pages project for this repo and there
should not be one.** If you find yourself creating one, something has gone wrong.

Consequences worth knowing:

- There is no `prod` branch and no promote step here. `npm run deploy` from a
  clean tree *is* the deploy.
- The `/dev/` lane convention does not exist either. The dev lane for this app is
  `wrangler dev` on localhost, which also switches the review bridge to the
  `reviews_dev` Firestore collection.

---

## 3. Everyday commands

All run from the repo root.

| Command | Does |
|---|---|
| `npm run deploy` | build the web app, then `wrangler deploy`. **Refuses a dirty tree.** |
| `npm run db:migrate` | apply new migrations to the **remote** D1 |
| `npm run db:migrate:local` | same, against `.wrangler/state` |
| `npm run dev` | worker on `:8787`, web on `:5174`, no sign-in required |
| `npx wrangler tail --config apps/worker/wrangler.toml` | live logs |
| `npx wrangler d1 execute library-catalog --remote --command "SELECT COUNT(*) FROM work"` | query production |
| `npx wrangler deployments list --config apps/worker/wrangler.toml` | version history |

⚠️ **Migrate before you deploy**, so new code never meets an old schema.

⚠️ **`ALLOW_DIRTY_DEPLOY=1` exists but resist it.** The clean-tree guard is there
because the sibling project twice ended up running production code that was in no
commit.

### Rollback

```bash
npx wrangler deployments list --config apps/worker/wrangler.toml
npx wrangler rollback <VERSION_ID> --config apps/worker/wrangler.toml
```

⚠️ **A rollback does not undo a migration.** D1 has no down-migrations here by
design. If a deploy has to be rolled back after a schema change, the schema stays
forward and the old code must still work against it — which is why every
migration so far only adds, or rebuilds a table that is empty.

---

## 4. Secrets — names only

None are set. Neither is required for the app to run today.

```bash
npm run secret GOOGLE_BOOKS_API_KEY   # wrangler secret put …
npm run secret ANTHROPIC_API_KEY
npm run secret:list
```

| Name | Needed for | Consequence if unset |
|---|---|---|
| `GOOGLE_BOOKS_API_KEY` | ISBN ladder rung 2 | rung skipped, with the reason in the scan trace. **Not a degraded mode** — anonymous Google Books returned 429 on 40 of 40 calls, so without a key that rung never answers at all. See below. |

### Getting a Google Books key

Free. No billing account required for the Books API.

1. <https://console.cloud.google.com/> — sign in with the Google account you use
   for everything else here.
2. Create a project, or reuse one. The name is irrelevant.
3. **APIs & Services → Library → search "Books API" → Enable.**
   ⚠️ Easy to skip, and skipping it produces a key that authenticates fine and
   then 403s on every call, which reads like a bad key.
4. **APIs & Services → Credentials → Create credentials → API key.**
5. Restrict it: **API restrictions → Books API only.** A key that can call
   anything in the project is a worse thing to leak than one that can look up
   ISBNs.
6. Do **not** add an HTTP-referrer restriction. The calls come from a Cloudflare
   Worker, not a browser, so there is no referrer to match and the restriction
   silently rejects everything.

Then set it **without pasting it into a chat, a file, or your shell history**:

```bash
npm run secret GOOGLE_BOOKS_API_KEY
```

`wrangler` prompts for the value and reads it directly. It never touches the
repo, and `.dev.vars` is only for local development.

Verify with a scan whose trace should now show two rungs instead of one:

```bash
curl -s "$LIBRARY/api/isbn/9780765326355"   # signed-in browser, not curl — see §8
```

### There is no Goodreads key

Checked 2026-08-09: `goodreads.com/api` 302s to the homepage and `/api/keys` is a
bare sign-in wall. Goodreads stopped issuing API keys in December 2020 and
retired the API. **Do not spend time looking for one.**

What it would have supplied, and where that actually comes from here:

| Goodreads gave | This project's answer |
|---|---|
| Ratings and reviews | **Your own**, in the shared Firestore `reviews` collection — the same documents the audiobook site writes. Better than a stranger's average for this purpose. |
| Series and volume | **`audiobook_catalog`'s own `series` / `series_index_sort` columns**, for 1,073 books, joinable on `work_key`. For this library's indie/KU half that is a *better* source than any public API, because those books are barely in the public ones. |
| Covers | Open Library, and CWA extracted them from the EPUBs themselves |
| `ANTHROPIC_API_KEY` | research pipeline (phase 5, unbuilt) | nothing today |

---

## 5. ⚠️ The actual remaining step is in Firebase, not Cloudflare

**Google sign-in will fail until the Worker's host is on Firebase's allow-list.**
The browser gets `auth/unauthorized-domain` and the app sits on its sign-in
screen.

> Firebase console → project **`audiobook-catalog`** → **Authentication** →
> **Settings** → **Authorised domains** → **Add domain** →
> `library-catalog.bgc-worker.workers.dev`

This cannot be scripted: the authorised-domains list is Identity Platform admin
config and `firebase-tools` has no command for it.

**Do not create a new Firebase project or a new Firestore database.**
`FIREBASE_PROJECT_ID` must stay `audiobook-catalog`. Sharing it is the entire
mechanism by which one Google account is one person across both catalogs — a
second project mints different tokens for the same human and silently forks every
user. Reviews likewise go into the *same* `reviews` collection, which is why a
review written on one site shows on the other with no sync job.

### Then claim ownership, before sharing the URL

The first person to sign in against an empty `app_user` table becomes `owner`;
everyone after lands as `pending` and waits for approval. Nobody else has the URL
yet, so this is safe — but do it first. `OWNER_EMAILS` stays empty; it is only a
lock-out recovery hatch.

---

## 6. Optional: a custom domain

Not needed. `*.workers.dev` works and is what the app is verified on.

If you do add one — say `library.example.com` — it is a **Workers custom domain**,
under the Worker → Settings → Domains & Routes, on a zone already in this
account. Two things must follow, or sign-in breaks:

1. Add the new host to Firebase authorised domains as well (§5). The old one can
   stay.
2. Nothing in `wrangler.toml` needs to change. The app reads no absolute URLs of
   its own — `apps/web/src/api.ts` calls `/api/...` relative — so it follows the
   origin it is served from.

---

## 7. Two absences that are decisions, not omissions

**No R2 bucket.** Scan photos go from the upload request straight into the vision
call and are dropped. The sibling project deleted its bucket for exactly this
reason: nothing ever read an object back, so the bucket's entire purpose was to
be emptied later, and one code path forgetting to delete was all it would have
taken to keep photos indefinitely. Do not add one for phase 4.

**No Cloudflare Access.** Identity is Firebase, so that one Google account is one
person across both catalogs. Access would be a second, unrelated Google SSO and
would re-create the duplicate users the design exists to prevent. If you ever see
`CF_ACCESS_*` variables appear in this repo, they came from copying the board
game catalog and are wrong here.

---

## 8. If something looks broken

> **Paused 2026-08-09:** the ebook pipeline and its `EBOOK_INGEST_TOKEN` secret
> were removed. `/api/ingest/*` no longer exists — a request to it is an ordinary
> 404, not a disabled feature. Expected to return; see `docs/HANDOFF.md`.

| Symptom | First check |
|---|---|
| A completely different app on localhost | **Port collision.** `wrangler dev` does not tell you the port was taken; 8792 was already bound by the Board Game Catalog's dev server and served *that* app, title and data included. `curl -s localhost:PORT/ \| grep title`. |
| `auth/unauthorized-domain` | §5 — the Firebase authorised domain. |
| `/api/me` returns 401 in production | Expected without a signed-in Google account. Sign in through the UI; curl cannot. |
| `/api/*` 500 with a confusing message | Suspect the `packages/core` import cycle before anything else. `constants.ts` → `schemas.ts` → `index.ts`, and nothing under `src/` may import `index.ts`. Typecheck does not catch it. |
| `database":"down"` on `/api/health` | Migrations have not run against the environment you are hitting. |
| wrangler prints success then exits 255 | A Windows libuv teardown quirk. Read the output, not the exit code. |
