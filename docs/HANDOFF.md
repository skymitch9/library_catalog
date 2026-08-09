# Handoff

> Rewritten **2026-08-09**, replacing the 2026-08-08 "nothing is built" version.
> Phase 0 and phase 1 are done. Nothing is deployed.

## State in one paragraph

The monorepo exists and works: five workspaces, all typechecking, 26 passing
tests, a migrated local D1, and a Worker exercised end to end against live Open
Library. You can sign in, add books, browse them, scan an ISBN and draft a
review. **Nothing has been created in Cloudflare and the review backfill has not
been committed** — both are deliberately left for the owner.

## Done

| | |
|---|---|
| **Phase 0 — verify** | ✅ Live calls to Open Library and Google Books. Findings in `docs/info/isbn-ladder.md`. Two of the design's assumptions were wrong. |
| **Phase 1 — scaffold + manual** | ✅ Worker + D1 + Firebase auth + React shell. Add/browse works, editions, copies, read-state. |
| **Shared identity** | ✅ Firebase Google SSO on the `audiobook-catalog` project, joined on email. Design in `docs/info/identity-and-reviews.md`. |
| **Review bridge** | ✅ `workKey`, the draft endpoint, the client Firestore path, and the backfill script. Backfill **dry-run only**. |
| **Phase 2 — ISBN scan** | 🟡 Partly. The ladder, the gate and `GET /api/isbn/:code` work. The camera UI and `scan_job` queue are not wired. |

## Not done

- Phases 3 (ebook ingest), 4 (shelf photo), 5 (research + index).
- `scan_job` is in the schema but no route reads or writes it.
- `camera.ts` / `scanner.ts` are ported and rewired to the book gate, but no page
  uses them yet.
- No cover images, no series browse page, no work detail page in the UI.

## ⚠️ Commands the owner must run — nothing else can proceed without these

```bash
npm run db:create        # then paste the id into apps/worker/wrangler.toml
npm run db:migrate
npm run deploy
```

Then, in the Firebase console: **Authentication → Settings → Authorised domains
→ add the Worker's URL**, or Google sign-in fails with
`auth/unauthorized-domain`. Full detail in `docs/access/deploy.md`.

Optional but strongly worth it — the backfill that makes existing audiobook
reviews visible here:

```bash
npm run backfill:reviews                # dry run: 860 documents, 860 matched, 0 unmatched
npm run backfill:reviews -- --commit    # writes to the LIVE reviews collection
```

## The five things that cost real time, and what they cost

1. **Anonymous Google Books is dead.** 40 calls, 40 × HTTP 429 — the shared
   unauthenticated quota is exhausted. It needs a free API key or it is not a
   rung at all. The design listed it as a free second rung.
2. **A wrong ISBN returns a confident wrong book.** Three of ten ISBNs typed
   from memory resolved to *Circe*, *Cloud Cuckoo Land* and *One Piece Vol. 93* —
   full metadata, correct covers, nothing marking them. Never seed a fixture
   with a remembered ISBN.
3. **Half this library is not in Open Library.** 14/30 by title, and the misses
   are the Kindle Unlimited / Audible-native indie half. The design budgeted
   research to fire on ~5% of rows; that number is wrong for this collection.
4. **The audiobook site's review key has no author in it**, and its Google
   session is thrown away immediately after sign-in. Both facts shaped the whole
   identity design. Read `docs/info/identity-and-reviews.md` §1 before touching
   anything near auth.
5. **Reading the backfill's dry-run output caught a defect the counts hid.**
   860/860 matched looked perfect; the keys it *would* have written were
   `court of mist and fury part 1 of 2 dramatized adaptation …`, which no
   paperback could match. Fixed by using the `series` column. Read the keys, not
   just the totals.

## Gotchas that will bite the next session

- **`git commit -F`, never `-m`.** See `CLAUDE.md`.
- **`packages/core` import order is load-bearing** and typecheck does not catch a
  violation. `constants.ts` → `schemas.ts` → `index.ts`, and nothing under
  `src/` may import `index.ts`.
- **`bookIdFromTitle` ≠ `normaliseTitle`.** The first keeps the leading article
  and builds Firestore document ids; the second strips it and builds `work_key`.
  Swapping them writes a duplicate review instead of updating one.
- **`npm test` needs tsx** (a devDependency). Node's type stripping cannot
  resolve the `.js` specifiers the source uses.
- **`.dev.vars` is gitignored** and currently holds a real Google address so the
  dev bypass produces the right `app_user` row. Recreate from `.dev.vars.example`.
- Local D1 lives in `apps/worker/.wrangler/state` and already has two test works
  in it.

## Open questions

| # | Question | Blocks | State |
|---|---|---|---|
| 1 | Kindle metadata cache on this machine? | Phase 3 | `My Kindle Content` does not exist at either default path. A wider sweep timed out at 2 minutes without finishing, so "no Kindle for PC" is likely but **not proven**. |
| 2 | Amazon "Request My Data" export | Phase 3 | Not started. Needs the owner's Amazon login; takes days to arrive, so kick it off early. |
| 3 | Where do loose ebook files live — disk, Drive, or both? | Phase 3 | Not investigated. |
| 4 | Do the legacy passphrase users need Google accounts? | UX | Their reviews show up fine; they just cannot sign in here. A conversation, not a code change. |
