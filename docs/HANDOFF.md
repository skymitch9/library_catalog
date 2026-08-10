# Handoff

> Updated **2026-08-10**. **Live** at https://library.heygabi.ai — deployed,
> Firebase domain authorised, Google sign-in verified in production 2026-08-09.

## 🟡 In flight — `feature/completeness-wishlist-relations`

Three features, built and driven in a browser against a local worker, **not
deployed and not migrated against `--remote`**. The owner gates production.

| | |
|---|---|
| **Series completeness** | `/api/series`, a Series screen and a per-series ladder. 15 of 25 series have a gap: **7 interior**, **69 earlier**, **12 on a source's word**. |
| **Wishlist** | `copy.status = 'wanted'` is reachable at last — it was an unusable column with 0 rows. A Wishlist screen, a Copies panel, promotion by PATCH. |
| **Related books** | `work_relation`: same universe / companion / contains / precedes. Hand-entered; two of the four are directional. |

Everything measured is in
[`docs/info/completeness-wishlist-relations.md`](info/completeness-wishlist-relations.md).
**Read §2.3 before touching the wishlist** — two bugs there were found only by
clicking, and both come from `work` meaning "the catalog knows this book" rather
than "we have it".

### To finish it

```bash
npm test                                            # 63
npm run typecheck                                   # five workspaces
npm run db:migrate                                  # ⚠️ REMOTE — 0003 + 0004, BEFORE deploying
npm run deploy
npm run backfill:series-volumes -- --remote         # dry run, READ THE PER-SERIES LINES
npm run backfill:series-volumes -- --remote --commit
```

⚠️ **Migrate before deploying.** `/api/series` queries three tables production
does not have; deploying first makes every series request a 500.

### What was deliberately left out

- **No Open Library rung for series volumes.** The right endpoint is known
  (`/works/<key>/editions.json`, §3.1 of `covers-and-series.md`) and
  `series_volume.source` already allows `'openlibrary'` — but **no work here has
  an `openlibrary_work_id`**, so the rung has nothing to call with.
  **↳ Unblocked on `feature/openlibrary-ids`**, measured but not written: 35 of
  116 works now have a corroborated id, including **11 of 12 Cradle volumes**,
  the series the sibling catalog has never heard of. See the section below.
- **No "% complete" bar.** A percentage needs a denominator, and 24 of 25 series
  have none. It would be inventing the number it displays.
- **No bulk relation seeding.** Three Cosmere links and one omnibus link were
  entered by hand while testing; the rest is the owner's to enter.
- **The wanted→owned promotion does not create an edition.** Deliberate, and
  load-bearing — see §2.3.

## 🟡 In flight — `feature/openlibrary-ids`

`work.openlibrary_work_id` was **0 of 116**. A dry run against **production,
read-only** on 2026-08-10 resolved **35** of them with corroboration beyond
title+author. **Nothing has been written to any database, local or remote** —
the owner gates it.

| | |
|---|---|
| matched, corroborated | **35 (30%)** — 16 via an ISBN inside the EPUB, 19 via fielded search |
| searched, **not found** | **68 (59%)** — 66 of them returned zero results; the light-novel and Kindle-native half |
| **outliers for hand review** | **13** — all named, each with a candidate id, in `scripts/openlibrary-ids.json` |

Everything measured, including the ten Open Library duplicate-record cases and
the matches refused despite a **1.0 title and 1.0 author** score, is in
[`docs/info/openlibrary-ids.md`](info/openlibrary-ids.md). **Read §6 before
touching the outliers** — seven of the thirteen are one question about
fan-translated light novels, not seven questions.

### To finish it

```bash
npm test                                                   # 63
npm run typecheck                                          # five workspaces
npm run backfill:openlibrary-ids -- --remote               # dry run; READ THE OUTLIER LIST
npm run backfill:openlibrary-ids -- --remote --commit      # ⚠️ owner gates this
```

No migration and no deploy are needed: the column, its unique partial index and
`series_volume.source = 'openlibrary'` have all existed since migrations 0001 and
0003. Nothing in the Worker or the web app reads the column yet.

⚠️ **`scripts/openlibrary-ids.json` is the ledger and it is tracked.** It records
"searched, Open Library has nothing" separately from "nobody has looked", so a
re-run makes **zero** network calls. Delete it and the next run re-asks
openlibrary.org ~300 times for answers it already had.

## ✅ Shipped and live — covers, series, sorting, filters, Drive links

All merged to `main`, deployed, and **applied to production D1 on 2026-08-10**.
Measured against the remote database after the run, not assumed:

| | |
|---|---|
| Works | **117** |
| With a cover | **115** (2 have none: *White Sand*, whose EPUB carries no cover, and a picture book) |
| With a series | **104**, across **25** distinct series |
| Left without a series **on purpose** | **13** — 11 researched true standalones and 2 genuinely unknown. See `info/covers-and-series.md` §3.1 |

Series arrived in two passes: 80 from the automatic ladder (65 from the book's
own `dc:title`, 15 from the audiobook catalog), then 24 from
`scripts/series-overrides.json`.

### ⚠️ Deploy order — the handoff used to say the opposite, and it was wrong

The original instruction here was backfill first, then deploy. **Do it the other
way round.** Cover URLs point at `/covers/*.jpg`, which exist only in the
deployed assets, so backfilling first opens a window where every cover is a
broken image. Deploying first is a strict improvement: the images sit there with
nothing referencing them and the page looks exactly as it did, then the backfill
makes them appear at once. **Zero gap, rather than a managed one.**

```bash
npm run deploy                                   # 1. images + UI first
npm run backfill:covers -- --remote              # 2. dry run, READ THE OUTPUT
npm run backfill:covers -- --remote --commit
npm run backfill:series -- --remote
npm run backfill:series -- --remote --commit
```

⚠️ A cover filename is a hash of `work_key`, **not** of the image bytes, so
correcting a title mints a new filename. Two BtDEM books hit this — their images
were extracted after the deploy and had to be committed and shipped in a second
pass. If a cover renders as a title card, check the file exists in
`apps/web/public/covers` before suspecting the database.

## State in one paragraph

The app works. Five workspaces typecheck, 40 tests pass, both migrations apply,
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
holds 117 works and 117 editions, all ebooks imported from
`audiobook_catalog/site/ebooks.json`.

## Done

| | |
|---|---|
| **Phase 0 — verify** | ✅ Live calls. `docs/info/isbn-ladder.md`. Two of the design's assumptions were wrong. |
| **Phase 1 — scaffold + manual** | ✅ Worker + D1 + Firebase auth + React PWA. Works, editions, copies, read-state, collection, work page. |
| **Phase 2 — ISBN scan** | ✅ Ladder, book-barcode gate, continuous-scan screen, manual entry, per-row Add, covers. `scan_job` table unused. |
| **Shared identity** | ✅ Firebase Google SSO on the `audiobook-catalog` project, joined on email. |
| **Review bridge** | ✅ `workKey`, draft endpoint, Firestore client, review UI, backfill script. **Backfill dry-run only.** |
| **Open Library enrichment** | ✅ Proposes candidates with match scores; never auto-applies. |
| **Covers, series, sorting, Drive** | 🟡 **Built on `feature/library-parity`, not deployed.** 114/115 covers, 101/115 series (78 automatic + 23 from series-overrides.json, local only), server-side sort and filters, Drive flip-out. `docs/info/covers-and-series.md`. |
| **Phase 3 — ebook pipeline** | ⏸️ **Built, run, then paused 2026-08-09.** The books it catalogued are kept. See below. |

## Not done

- Phase 4 (shelf photo) and phase 5 (research + index).
- `scan_job` is in the schema but no route touches it. The scan screen keeps
  results in React state, so a phone locking mid-sweep loses them. That matters
  much more for phase 4 — a shelf photo costs money, an ISBN is free to re-scan.
- No series browse page. The collection can be *filtered* to one series and
  sorted series-first, which covers most of what a browse page would, but there
  is no page that lists the 25 series with their volume counts.
- **13 of 117 works have no series, and that is the finished answer, not a gap.**
  It was 37; all 37 were researched on 2026-08-10 and every answer is in
  `scripts/series-overrides.json` with a source — 24 got a series, **11 are true
  standalones**, 2 are genuinely unknown (*Firstborn / Defending Elysium*, a
  bind-up whose halves belong in different places, and *Undead Knight*, which has
  essentially no metadata anywhere). The file records all 37, because "researched,
  no series" and "nobody has looked" are different facts and only one of them is
  worth re-researching. See `info/covers-and-series.md` §3.1.
  **Applied to production 2026-08-10** — 104 of 117 across 25 series.
- **The book page is a page, not a modal.** The audiobook site opens a book in a
  modal over the grid; this one swaps the whole screen and offers a back button.
  Left as-is deliberately: `App.tsx` has no router, and a modal that cannot be
  linked to or dismissed with the back button is worse on a phone than a screen
  that can.
- **No stats page.** There is a stat strip on the collection, counted live. The
  audiobook catalog's separate `stats.html` was not ported.
- **Light mode was checked by forcing the tokens, not by flipping the OS.** The
  palette renders correctly; the `prefers-color-scheme` switch itself has only
  been exercised in dark.
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

- **⚠️ `wrangler d1 execute --file` returns a SUMMARY, not rows, on `--remote`.**
  It hands back
  `[{results:[{"Total queries executed":1,"Rows read":2,…}]}]` — a well-formed
  array with a `results` array in it, so nothing throws and the caller just gets
  one row with none of its columns. The first remote cover backfill printed
  *"1 work(s) in the REMOTE database"* against a catalog of 117 and then died on
  `work_key` being undefined. **Locally the same `--file` returns real rows**,
  which is exactly why it survived a whole feature's worth of local measurement.
  Reads go through `--command` now; `scripts/lib/d1.mjs` `query()` refuses SQL
  over 6000 chars and throws if it ever sees a summary again. Writes still use a
  file, correctly — a shell cannot carry 117 UPDATEs full of apostrophes.
- **A destructive flag whose dry run does nothing looks exactly like success.**
  `--prune` was added to `scripts/import-ebooks.mjs` and, on the first run,
  silently did nothing without `--commit`: the import dry-run `process.exit(0)`s
  before the prune block was reached, so it printed "DRY RUN" and skipped the
  entire feature. Prune is a function called from both paths now. **When adding a
  flag, run it in the mode people will try first.**
- **Cache headers here are governed by a Cloudflare setting outside the repo.**
  `heygabi.ai` → Caching → Configuration → **Browser Cache TTL** was `4 hours`
  and overrode origin `Cache-Control` for every host in the zone — including
  this one, whose hashed `/assets/*` bundles are declared `immutable` for a year
  and were being silently cut to four hours. Now **Respect Existing Headers**. If
  `apps/web/public/_headers` ever appears to be ignored, check that first;
  `*.pages.dev` is outside the zone and will keep obeying `_headers`, which makes
  the discrepancy read as a routing problem when it is not.
- **`git commit -F`, never `-m`.** See `CLAUDE.md`.
- **`wrangler dev` does not tell you the port was already taken.** Port 8792 was
  bound by the Board Game Catalog's own dev server, so this app silently failed
  to bind and the browser served **that application** — title, data and all. It
  reads like a catastrophic build failure and is a port collision. Check
  `curl -s localhost:PORT/ | grep title` first.
- **It also silently moves on.** 2026-08-10: a killed-but-still-listening worker
  held 8787, so the new one came up on **8791** and said so only in its startup
  banner. Everything pointed at 8787 kept talking to the dead one. `netstat -ano
  | grep :8787` names the process; read the "Ready on" line, do not assume 8787.
- **The assets watcher dies on OneDrive.** `Watcher error: EPERM: operation not
  permitted, watch` after a rebuild, and from then on `GET /` returns 404 while
  `/api/*` keeps working — which looks exactly like a broken SPA build. Restart
  `wrangler dev` after `npm run build`; hot reload of `apps/web/dist` cannot be
  relied on here.
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
npm test                 # 40 core-rule tests
npm run db:migrate:local
npm run dev              # worker :8787, web :5174
curl -s localhost:8787/api/health
curl -s localhost:8787/api/isbn/9780765326355   # live Open Library

# The collection API, all of it new on feature/library-parity
curl -s "localhost:8787/api/stats"
curl -s "localhost:8787/api/collection/facets"
curl -s "localhost:8787/api/collection?sort=author&dir=desc&pageSize=10"
curl -s "localhost:8787/api/collection?q=cradle"      # 6 — a series-name search

# Both backfills are idempotent; a second run must report nothing to write.
npm run backfill:covers
npm run backfill:series
```

⚠️ `npm run check:fold` is **gone**, and correctly: the Python indexer that made
a second `work_key` implementation was removed with the ebook pipeline. If a
second language ever computes `work_key` again, bring the parity check back with
it — `packages/core/src/titles.ts` says so in its header.

## Kindle: metadata only, and the mechanism is the desktop app

The owner's requirement is that buying a book should show up without waiting.
That rules out the data export and points at **Kindle for PC's local metadata
cache**, which updates whenever the app syncs.

⚠️ **This imports names, not files.** Kindle books are DRM protected and this
repo does not circumvent that — the import produces `ebook_kindle` editions,
which migration 0002 defines as *a licence with no bytes*. `EBOOK_FILE_FORMATS`
deliberately excludes it, so nothing will ever offer to send one to a device.

**No books need to be downloaded.** The sync cache lists the whole account
library, not just downloaded titles, so signing in and letting it sync is enough
and nothing encrypted lands on disk.

Next steps, in order:

1. Owner installs Kindle for PC, signs in, lets it finish syncing.
2. Identify what it actually wrote. Older versions produced
   `KindleSyncMetadataCache.xml` — ASIN, title, authors, publication date, a
   trivial parse. **Kindle for PC 2.x reorganised its storage and the current
   format is unverified.** Look before writing the parser.
3. Parse → `ebook_kindle` editions through the existing API.

This does **not** depend on the paused ebook pipeline. It writes catalog rows,
not files, so it needs no CWA, no Docker and no ingest route — a script and the
API that is already deployed.

## Open questions

| # | Question | Blocks | State |
|---|---|---|---|
| 1 | Kindle metadata cache on this machine? | Kindle import | ✅ **Answered 2026-08-09: Kindle for PC is NOT installed.** Proven, not assumed — no `%LOCALAPPDATA%\Amazon`, no `%APPDATA%\Amazon`, no Program Files entry, no uninstall registry key under HKLM or HKCU, no Store appx. The earlier sweep that timed out left this "likely"; a targeted PowerShell check settled it. **Installing it is the chosen path** — see below. |
| 2 | Amazon "Request My Data" export | — | ❌ **Rejected by the owner, and rightly.** A batch export with days of latency cannot answer "I bought a book an hour ago". Superseded by the Kindle for PC cache, which is local and updates on sync. |
| 3 | Where do loose ebook files live — disk, Drive, or both? | Phase 3 | Not investigated. |
| 4 | Do the legacy passphrase users need Google accounts? | UX | Their reviews show up fine; they just cannot sign in here. A conversation, not a code change. |
| 5 | Should `edition.format` gain an audiobook value once the shared index lands? | Platform | **No.** `PLATFORM.md` §2.2 says nothing merges; audiobooks stay read-only in their own catalog and meet this one through `work_key`. Recorded because it will be asked. |
