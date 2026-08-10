# Handoff

> Rewritten **2026-08-09**, replacing the 2026-08-08 "nothing is built" version.
> **Live** at https://library-catalog.bgc-worker.workers.dev — deployed, Firebase
> domain authorised, and Google sign-in verified in production 2026-08-09.

## State in one paragraph

The app works. Five workspaces typecheck, 26 tests pass, both migrations apply,
and the whole thing has been driven end to end in a browser: sign in, browse the
collection, open a book, set read-state, scan or type an ISBN and resolve it
against live Open Library, enrich a hand-added book, and write a review that
lands in the same Firestore collection the audiobook site uses. **What has not
happened: no ebook container has ever run, and the review backfill has not been
committed.**

Sign-in is verified in production against a real Google token, and ownership is
claimed: `app_user` id 1, `nbaslamking@gmail.com`, `review_name` "Skylar" —
which matches the `…_skylar` document ids the existing audiobook reviews already
use, so the two sites' reviews are the same documents. The production collection
is empty; the four test works are local only.

## Done

| | |
|---|---|
| **Phase 0 — verify** | ✅ Live calls. `docs/info/isbn-ladder.md`. Two of the design's assumptions were wrong. |
| **Phase 1 — scaffold + manual** | ✅ Worker + D1 + Firebase auth + React PWA. Works, editions, copies, read-state, collection, work page. |
| **Phase 2 — ISBN scan** | ✅ Ladder, book-barcode gate, continuous-scan screen, manual entry, per-row Add, covers. `scan_job` table unused. |
| **Shared identity** | ✅ Firebase Google SSO on the `audiobook-catalog` project, joined on email. |
| **Review bridge** | ✅ `workKey`, draft endpoint, Firestore client, review UI, backfill script. **Backfill dry-run only.** |
| **Open Library enrichment** | ✅ Proposes candidates with match scores; never auto-applies. |
| **Phase 3 — ebook pipeline** | ⏸️ **Built, run, then paused 2026-08-09.** The books it catalogued are kept. See below. |

## Not done

- Phase 4 (shelf photo) and phase 5 (research + index).
- `scan_job` is in the schema but no route touches it. The scan screen keeps
  results in React state, so a phone locking mid-sweep loses them. That matters
  much more for phase 4 — a shelf photo costs money, an ISBN is free to re-scan.
- No series browse page; the collection is one flat list ordered by series.
## ⏸️ The ebook pipeline — paused, and how to bring it back

Removed 2026-08-09 on the owner's call: compose file, Dockerfile, entrypoint,
ingest watcher, companion scanner, indexer, `/api/ingest`, the
`EBOOK_INGEST_TOKEN` secret, and the containers, images and volume.

**It worked.** 83 EPUBs from the OpenAudible folders went end to end to the live
catalog. It was paused because file acquisition — getting the Amazon books the
owner already paid for down as files — is not something this repo solves, and a
pipeline fed only by ebooks already loose on disk was not the library that was
wanted. **This is expected to resume.**

### What was deliberately kept

| | |
|---|---|
| **81 works / 83 editions** in production D1 | accurate; they are books the owner owns |
| `edition.format` ebook values + nullable `cwa_book_id` | migration 0002 untouched, so resuming is additive |
| `runtime/ebooks/` — the Calibre library, all 83 already ingested | gitignored, left on disk so resuming does not mean re-ingesting |
| `OpenAudible/books` | **never touched.** That mount was read-only and the scanner copied, never moved |

### Bringing it back

```bash
git revert <the "Remove the ebook pipeline" commit>
npm run secret EBOOK_INGEST_TOKEN        # a new one; the old was deleted
docker compose -f docker-compose.ebooks.yml up -d calibre-web-automated
npm run deploy                            # re-mounts /api/ingest
```

Then read the removed `docs/EBOOK_PIPELINE.md` out of git history first — it
carries the four defects the first real run found, and they will all be waiting
again. Chief among them: the entrypoint must `exec "$@"`, and the dry-run flag
must have one name inside and outside the container.

⚠️ **If a second language ever computes `work_key` again** — the Python indexer
did — restore `scripts/check-fold-parity.mjs` with it. It is not optional.

## ⚠️ What is left

Provisioning, deployment, the Firebase domain and ownership are all done. Full
runbook in `docs/access/cloudflare.md`; redeploying is `npm run deploy`.

The one outstanding action is the backfill, which is what makes the 860 existing audiobook reviews visible
here:

```bash
npm run backfill:reviews                # dry run: 860 documents, 860 matched, 0 unmatched
npm run backfill:reviews -- --commit    # writes to the LIVE reviews collection
```

## The findings that changed the design

1. **Anonymous Google Books is dead.** 40 calls, 40 × HTTP 429 — the shared
   unauthenticated quota is exhausted. It needs a free API key or it is not a
   rung at all. The design listed it as a free second rung.
2. **Half this library is not in Open Library.** 14/30 by title. The misses are
   the Kindle Unlimited / Audible-native indie half. The design budgeted research
   to fire on ~5% of rows; that number is wrong for this collection, so either
   research fires far more often than budgeted or those rows stay hand-entered.
3. **A wrong answer can score 1.0.** `/api/enrich` on *Firefight* returns
   "Firefight / Brandon Sanderson", Random House, **2001** — perfect title and
   author similarity, and the wrong book. No threshold can catch it; only the
   year and publisher can, which is why they are rendered beside every candidate.
   See `docs/info/isbn-ladder.md` §4.4. **Never auto-select the top candidate.**
4. **The audiobook site's review key has no author in it**, and it throws its
   Google session away immediately after sign-in. Both facts shaped the entire
   identity design — read `docs/info/identity-and-reviews.md` §1 before touching
   auth.
5. **`work_key` is computed in two languages now** — TypeScript (authoritative)
   and Python (the ebook indexer, which runs in a container with no Node). This
   is the shape that has already bitten this household. `npm run check:fold`
   proves the two agree on 10 cases and **must be run after any change to
   `normaliseTitle`, `splitAuthors`, `primaryAuthor` or `workKeyFor`.** `npm test`
   cannot cover it.
6. **Reading the backfill's dry run caught a defect the counts hid.** 860/860
   matched looked perfect; the keys it would have written were
   `court of mist and fury part 1 of 2 dramatized adaptation …`, which no
   paperback could match. Fixed by using the `series` column. Read the keys, not
   the totals.

## Gotchas that will bite the next session

- **`git commit -F`, never `-m`.** See `CLAUDE.md`.
- **`wrangler dev` does not tell you the port was already taken.** Port 8792 was
  bound by the Board Game Catalog's own dev server, so this app silently failed
  to bind and the browser served **that application** — title, data and all. It
  reads like a catastrophic build failure and is a port collision. Check
  `curl -s localhost:PORT/ | grep title` first.
- **A `<video>` element makes Chrome's screenshot capture hang**, not the page.
  The scan screen looks frozen to browser automation for 10–30s after it mounts
  while being completely responsive to a person. Do not hunt for a render loop.
- **`packages/core` import order is load-bearing** and typecheck does not catch a
  violation. `constants.ts` → `schemas.ts` → `index.ts`; nothing under `src/` may
  import `index.ts`.
- **`bookIdFromTitle` ≠ `normaliseTitle`.** The first keeps the leading article
  and builds Firestore document ids; the second strips it and builds `work_key`.
  Swapping them writes a duplicate review instead of updating one.
- **`npm test` and `npm run check:fold` need tsx** (a devDependency). Node's type
  stripping cannot resolve the `.js` specifiers the source uses.
- **`.dev.vars` is gitignored** and holds a real Google address so the dev bypass
  produces the right `app_user` row. Recreate from `.dev.vars.example`.
- Local D1 is in `apps/worker/.wrangler/state` and has four test works in it.

## Verification commands

```bash
npm run typecheck        # five workspaces
npm test                 # 26 core-rule tests
npm run check:fold       # TS vs Python work_key parity — 10/10
npm run db:migrate:local
npm run dev              # worker :8787, web :5174
curl -s localhost:8787/api/health
curl -s localhost:8787/api/isbn/9780765326355   # live Open Library
```

## Open questions

| # | Question | Blocks | State |
|---|---|---|---|
| 1 | Kindle metadata cache on this machine? | Phase 3 | `My Kindle Content` does not exist at either default path. A wider sweep timed out at 2 minutes without finishing, so "no Kindle for PC" is likely but **not proven**. |
| 2 | Amazon "Request My Data" export | Phase 3 | Not started. Needs the owner's Amazon login; takes days, so start it early. |
| 3 | Where do loose ebook files live — disk, Drive, or both? | Phase 3 | Not investigated. |
| 4 | Do the legacy passphrase users need Google accounts? | UX | Their reviews show up fine; they just cannot sign in here. A conversation, not a code change. |
| 5 | Should `edition.format` gain an audiobook value once the shared index lands? | Platform | **No.** `PLATFORM.md` §2.2 says nothing merges; audiobooks stay read-only in their own catalog and meet this one through `work_key`. Recorded because it will be asked. |
