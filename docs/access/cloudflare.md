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
| R2 bucket | **none.** For scan photos that is permanent; for covers it is ⚠️ **pending owner action** — see §7 and §7.1 |
| Cron triggers | `7 * * * *` — the hourly missing-details sweep, **declared 2026-08-16 and not yet deployed**. ⚠️ *A cron is not working until something it writes has rows*; the proof for this one is a `research_run` row with `triggered_by` NULL. Design: `docs/info/research-and-gaps.md` §10 |
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
`ENVIRONMENT === 'development'` (⚠️ **hardened 2026-08-13 from `!== 'production'`, which failed OPEN** — any environment that was not exactly `production`, including unset or misspelled, switched the bypass on), and this is the check that the gate is really
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

⚠️ **Do NOT create a new project or a new Google service. You already have one.**

Measured 2026-08-09: the Firebase web key in `audiobook_catalog/site/admin.html`
was tested directly against the Books API and came back

```
403 PERMISSION_DENIED  accessNotConfigured
"Books API has not been used in project 68492219785 before or it is disabled."
```

That is the *useful* failure. The key authenticated, and it carries no API
restriction — the **only** missing piece is the Books API being switched on for
the project that already exists. Project `68492219785` is the
`audiobook-catalog` Firebase project, i.e. the same one this app already
verifies sign-in tokens against.

So the whole job is:

1. **Enable the API on the existing project** —
   <https://console.developers.google.com/apis/api/books.googleapis.com/overview?project=68492219785>
   → Enable. Wait a minute or two for it to propagate.
2. **Create a second key on that same project**, restricted to **Books API only**:
   APIs & Services → Credentials → Create credentials → API key → Restrict key.

⚠️ **Do not simply reuse the Firebase web key, even though it would now work.**
Two reasons, both real:

- It is **public by design** — it ships to every browser that loads the
  audiobook site. Anything holding it can spend this project's Books quota
  (1,000 requests/day on the free tier).
- Restricting it later would **break Firebase sign-in**. A key cannot be scoped
  to Books API only *and* remain a working Firebase web key, so the two uses want
  two keys.

A second key on the same project costs nothing and avoids both.

⚠️ Do **not** add an HTTP-referrer restriction to the new key. The calls come
from a Cloudflare Worker, not a browser, so there is no referrer to match and the
restriction silently rejects everything.

### Setting it — one place, one command

`apps/worker/.dev.vars` is the **single source of truth** for every secret. Edit
it there, then:

```bash
npm run secrets:push -- --dry   # names and a last-4 fingerprint, nothing sent
npm run secrets:push            # push every allowlisted key
```

`scripts/push-secrets.mjs` sends values to wrangler over **stdin**, so a key
never reaches argv, a process listing or your shell history. Ported from the
Board Game Catalog, where it exists because `wrangler secret put` handles one key
at a time and a rotation once left production holding the old value while
`.dev.vars` held the new one.

Three properties worth knowing:

- **Allowlist, not denylist.** `PRODUCTION_SECRETS` names what may be pushed, so
  a new local-only variable cannot reach production by being forgotten.
  `DEV_EMAIL` is explicitly refused — it is the auth bypass.
- **It only ever sets.** Deleting a line does not delete the production secret;
  that needs `wrangler secret delete`, so a typo cannot strip a live credential.
- **Fingerprints, not values.** It prints `push GOOGLE_BOOKS_API_KEY (…5mMA)` —
  enough to confirm which value went up, useless to anyone else.

Verified working 2026-08-09 — the ISBN ladder now returns two rungs:

```
openlibrary  ok=True found=1 208ms
googlebooks  ok=True found=1 254ms
```

Verify with a scan whose trace should now show two rungs instead of one:

```bash
curl -s "$LIBRARY/api/isbn/9780765326355"   # signed-in browser, not curl — see §8
```

### There is no Goodreads key — but Hardcover is already wired up

⚠️ **Before adding any book-metadata service, check `audiobook_catalog/.env`.**
It already holds `HARDCOVER_TOKEN` and `HARDCOVER_ENABLED`, and
`app/tools/` has a working `hardcover_gql()` client against
`https://api.hardcover.app/v…`, used today for content warnings and chapter
extraction. Hardcover is the modern successor to Goodreads and has a real
GraphQL API — so the thing Goodreads would have provided is already paid for,
authenticated, and has a client written for it one directory over.

It also holds `DOESTHEDOGDIE_API_KEY`. The house rule this suggests: **grep the
sibling repo's `.env` before signing up for anything.**

### The retired API

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

**No R2 bucket for scan photos, and there must not be one.** Photos go from the
upload request straight into the vision call and are dropped. The sibling project
deleted its bucket for exactly this reason: nothing ever read an object back, so
the bucket's entire purpose was to be emptied later, and one code path forgetting
to delete was all it would have taken to keep photos indefinitely.

⚠️ **That decision is about photographs, not about R2.** Migration 0040 added a
cover-upload path, and a cover is the opposite kind of object: it is read on
every page load, forever, and *deleting* it is the bug. Do not read the rule
above as forbidding the bucket below — and do not read the bucket below as
permission to store a scan frame. Nothing does, and nothing should.

### 7.1 The covers bucket — ⚠️ NOT PROVISIONED. Owner action required.

`apps/worker/src/routes/covers.ts` is written, tested and mounted. Without the
binding, `POST /api/works/:id/cover` answers **501** with a sentence naming what
is missing, and the web UI hides the file picker rather than offering a control
that can only fail. Everything else in the feature — linking an image somebody
else hosts, marking a cover as a stand-in, the "Cover needed" label and its
filter — works today with no bucket at all.

To switch uploading on:

```bash
# 1. The bucket.
wrangler r2 bucket create library-covers

# 2. A PUBLIC hostname for it. ⚠️ THIS STEP IS NOT OPTIONAL.
#    Dashboard → R2 → library-covers → Settings → Public access →
#    Connect a custom domain → covers.heygabi.ai
#
#    The `*.r2.dev` URL is rate-limited and explicitly not for production; it is
#    also uncacheable, so every cover on every page load would go to origin.
#    The sibling audiobook catalog fronts its bucket with a custom domain for
#    exactly this reason — that is the whole point of that setup, not a nicety.
#
# 3. A Cache Rule on the zone, same as the audiobook catalog's:
#    covers.heygabi.ai/*  →  Eligible for cache, Edge TTL 1 year.
#    ⚠️ Safe here in a way it is NOT for /covers/* on the Worker: these object
#    names are a hash of the FILE CONTENTS, so a replaced cover is a different
#    URL and a cached copy can never be stale. See `coverObjectKey`.
```

Then in `apps/worker/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "COVERS"
bucket_name = "library-covers"

[vars]
COVERS_BASE_URL = "https://covers.heygabi.ai"
```

⚠️ **Both, or neither.** The route refuses to write unless the binding *and* the
base URL are set, rather than storing an object and then being unable to record
where it went. `npx wrangler deploy` after, then `GET /api/cover-storage` should
answer `{"enabled":true}` — that endpoint exists to be curled for this.

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
| `"database":"down"` locally, right after provisioning | ⚠️ **Local D1 state is keyed by `database_id`.** Changing that value in `wrangler.toml` — as happened when the placeholder was replaced with the real id — orphans the old local database, and the new id starts with no tables. Production is unaffected. Fix: `npm run db:migrate:local`. |
| A completely different app on localhost | **Port collision.** `wrangler dev` does not tell you the port was taken; 8792 was already bound by the Board Game Catalog's dev server and served *that* app, title and data included. `curl -s localhost:PORT/ \| grep title`. |
| `auth/unauthorized-domain` | §5 — the Firebase authorised domain. |
| `/api/me` returns 401 in production | Expected without a signed-in Google account. Sign in through the UI; curl cannot. |
| `/api/*` 500 with a confusing message | Suspect the `packages/core` import cycle before anything else. `constants.ts` → `schemas.ts` → `index.ts`, and nothing under `src/` may import `index.ts`. Typecheck does not catch it. |
| `database":"down"` on `/api/health` | Migrations have not run against the environment you are hitting. |
| wrangler prints success then exits 255 | A Windows libuv teardown quirk. Read the output, not the exit code. |
