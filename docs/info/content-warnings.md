# Cross-catalog content warnings — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17**, the day it was built. Measured that day, not
> assumed: production D1 (351 works, 92 `audiobook_holding` rows, 1 stale) via
> `wrangler d1 execute --remote`; the **live** `content_warnings.json` on
> `audiobooks.heygabi.ai` (339 keys, `Access-Control-Allow-Origin: *`); both
> Firestore warning collections read over the REST API (**0 documents, prod and
> `_dev`**); and `audiobook_catalog`'s `site/user-warnings.js` +
> `firestore.rules` read line by line, including the delete tightening that
> landed on that same day.
>
> **NOT verified:** no signed-in round trip has been performed on either
> instance — see §8. The ebooks half of the owner's ask is deliberately **not
> built** — see §7.

The owner's ask, 2026-08-17:

> *"port content warning feature over to all physical book and the ebook site."*

This document is the library half. It exists mainly for **§2**, which is the one
thing about this feature that is easy to get wrong, impossible to notice in a
browser, and silently destroys the feature's entire point.

---

## 1. The store already existed — again

The third time this estate has joined a collection rather than inventing one
(`identity-and-reviews.md` §3 for reviews, `tbr.md` §1 for the TBR).

| | |
|---|---|
| collection | `user_content_warnings` (prod) / `user_content_warnings_dev` (dev lane, via `col()`) |
| document id | `` `${bookId}_${displayNameLower}_${bookIdFromTitle(label)}` ``, clamped to 900 chars |
| `bookId` | `bookIdFromTitle(title)` — a slug of the **title alone**, as the AUDIOBOOK catalog spells it |
| fields | `bookId, bookTitle, label, displayName, authorUid, createdAt` |
| this catalog adds | `workKey`, `source: 'library'`, `email` — additive, ignored by that site |
| writers | `audiobook_catalog/site/user-warnings.js`; now also this app |

⚠️ **The topic segment in the id is the dedupe rule**, not decoration: one
document per *(book, person, topic)*, so re-adding the same topic overwrites
rather than filing a second note. Two people may both warn about the same thing;
one person cannot warn about it twice. Ported verbatim in
`packages/core/src/warnings.ts` (`userWarningDocId`).

⚠️ **Three collections, three id orders, none interchangeable:**

```
review        `${bookId}_${displayNameLower}`                site/reviews.js
reading list  `${displayNameLower}_${bookId}`                index.html
warning       `${bookId}_${displayNameLower}_${topicId}`     site/user-warnings.js
```

`packages/core/test/warnings.test.ts` asserts the warning id equals neither of
the other two, so a well-meaning harmonisation fails a test instead of shipping.

### No rules change was needed, and none was made

`validUserWarning()` asserts `label` (1–80 chars), `bookId` and `displayName`
are strings and ignores unknown fields, exactly as `validReview()` and
`validReadingList()` do. ⚠️ **Do not touch `audiobook_catalog/firestore.rules`
from this repo**: a rules deploy changes that site's security posture, and this
feature does not need one. (It had *just* been changed on 2026-08-17 for the
delete split described in §4 — that work was theirs, not ours.)

---

## 2. ⚠️ THE IDENTITY JOIN — and why `workKey` could not do it

**The same book has different titles in the two catalogs.** Measured against
production D1, 2026-08-17:

| | |
|---|---|
| works | **351** |
| with an `audiobook_holding` row | **92** (1 stale) |
| whose two catalogs spell the title differently | **33** |
| …and therefore produce a **different `bookId`** | **27** |
| (the other 6 differ only in punctuation, which `bookIdFromTitle` folds away) | 6 |

```
ours  "Sunrise on the Reaping"          →  sunrise-on-the-reaping
them  "Sunrise on the Reaping - A Hunger Games Novel"
                                        →  sunrise-on-the-reaping-a-hunger-games-novel
```

So `bookIdFromTitle(work.title)` — the obvious implementation — writes notes
under a key the audiobook site never asks about, **and** finds none of the notes
written there. Both halves fail silently and both look exactly like *"nobody has
added a warning yet"*. There is no error to notice.

### Why the review bridge's mechanism is unavailable

Reviews span by a **second field**, `workKey`, stamped onto all 870 documents by
`backfill-review-keys.mjs` (`identity-and-reviews.md` §7.6). That is not
available here:

- a warning document carries no `workKey`, and the audiobook site will never
  write one;
- there is nothing to backfill — **both collections were measured empty** on
  2026-08-17, prod and `_dev`;
- and a backfill would in any case not cover notes written on that site
  tomorrow.

### What this catalog uses instead

**`audiobook_holding.title` — the other side's own spelling of the title**,
cached in D1 by `npm run backfill:audiobooks` (migration 0010).
`routes/audiobook-mapping.ts` already leans on exactly that sentence in the
opposite direction: *"what the AUDIOBOOK catalog itself calls the book"*.
Slugging it with the same `bookIdFromTitle` reproduces their `bookId` byte for
byte.

```
                      audiobook_holding.title
work.title  ─────┐         │
                 │         └──► bookIdFromTitle ──► writeBookId   ← notes are FILED here
                 └──────────────► bookIdFromTitle ──► fallback     ← and also READ from here
```

| | |
|---|---|
| **write key** | the audiobook spelling whenever this catalog knows it, else our own |
| **read keys** | both, write key first, deduplicated — one Firestore query each, unioned on document id (`fetchReviews`' shape) |
| **derived where** | `warningKeysFor` in `@lc/core`, called by `GET /api/warnings/:workId/keys`. ⚠️ **Nothing in the browser may compute a key** |

⚠️ **A stale holding is READ but never WRITTEN to.** Both halves have
precedent: `OtherVersions.tsx` shows a stale holding to a person rather than
hiding it (hiding looks identical to "never matched"), while
`routes/audiobook-mapping.ts` excludes stale rows from its unattended outbound
join. A note may already sit under the stale key, so reads keep it; filing a
*new* note under a spelling that side has stopped confirming would bury it.

### The test that matters

`packages/core/test/warnings.test.ts`, first `describe`. Its fixtures are **real
production pairs**, and it asserts both directions: the write key *is*
`bookIdFromTitle(their title)`, and it *is not* ours. Watched failing on a
deliberate mutation (`writeBookId = ours`) on 2026-08-17 — **5 tests went red**,
and green again on revert.

---

## 3. Published pipeline warnings — the join was free, so it was taken

The audiobook pipeline gathers warnings from StoryGraph / Hardcover / web
sources into `audiobook_catalog/site/content_warnings.json`. The brief's
condition was to surface these **only if the join needs no new plumbing**. It
does not:

| Question | Measured, 2026-08-17 |
|---|---|
| Fetchable cross-origin from `library.heygabi.ai`? | **yes** — `Access-Control-Allow-Origin: *` on the live response |
| Keyed by what? | the audiobook catalog's **full title string**, not a slug (339 keys) |
| Do we hold that string? | **yes** — `audiobook_holding.title` |
| Books reached, of 92 holdings | **15**, of which **8** carry ≥1 warning |
| Extra books reached by matching on OUR title | **0** — so that fallback buys nothing and could only mis-key two books with one name. Not implemented |

⚠️ **~200 KB, so it is fetched at most once per session and only for a book that
has a holding** (92 of 351). `fetchPublishedWarnings` caches the promise in
module scope; the response carries `Cache-Control: no-cache`, so later sessions
revalidate rather than re-download. A failure answers `null` — losing the
published extra must not take the reader notes down with it.

⚠️ **An empty `warnings` array is not the same as a missing entry.** "Published
sources have been checked and listed none" and "nobody has looked" are different
facts and the panel says which. `publishedWarningsFor` keeps them apart and a
test pins it.

⚠️ **The panel names the title it looked under.** Some holdings match by
*containment* — e.g. work "Tamer: King of Dinosaurs Book 11" is matched to the
series' base title "Tamer: King of Dinosaurs" — so the entry may belong to a
sibling volume. Printing "From published sources for *«their title»*" is the
same provenance-in-words rule `OtherVersions` follows, and costs no branch.

---

## 4. Deletes: whose note, and whose role

`firestore.rules` was tightened on 2026-08-17 (their work, owner-approved):
`allow delete: if canDeleteUserWarning()` — the document's `authorUid` equals
`request.auth.uid`, **or** the caller holds `moderator`/`admin` in the estate's
`site_roles/{uid}` collection.

| | |
|---|---|
| `authorUid` | stamped by **this Worker** from the verified token (`user.firebaseUid`), not claimed by the browser. The audiobook site must ask its own SDK (`liveUid()`) because its session is presentation-only; here the Worker has already verified the token the browser will write with |
| affordance | `warningDeleteVerdict` in `@lc/core` → `buildNoteRows` in `apps/web/src/lib/note-rows.ts` |
| capability | **`moderateContent`** (new, moderator+) — its own name rather than reusing `reviewFindings`, which holds the identical role set and would be indistinguishable in a refusal |

⚠️ **`moderateContent` and `site_roles` are DIFFERENT RECORDS, and this is the
one honest gap in the feature.** A library moderator with no `site_roles`
document will be offered the control and refused by Firestore.
`describeStoreError(err, { need: 'the estate-wide moderator role' })` is what
turns that into a sentence instead of the SDK's *"Missing or insufficient
permissions."*. Tightening this properly means the estate granting the role, not
a code change here.

⚠️ **A name match is not authorship.** Google lets anyone set their display name
to any string, which is precisely why the rules bind on the uid. A note carrying
somebody's name but no `authorUid` (a legacy session, or anything written before
that day) is **moderator-deletable only**, and the refusal says how to fix it:
*"Add it again and it becomes yours to remove."*

---

## 5. Where the code lives

| Layer | File | Job |
|---|---|---|
| Rules | `packages/core/src/warnings.ts` | the join, the doc id, the document, the delete verdict, the published lookup. **No I/O** |
| | `packages/core/src/constants.ts` | `MAX_WARNING_LABEL = 80` — the rules' bound, not a preference |
| | `packages/core/src/capabilities.ts` | `moderateContent` |
| Worker | `apps/worker/src/routes/warnings.ts` | `GET /:workId/keys`, `POST /:workId/draft`. Writes nothing |
| Browser | `apps/web/src/lib/warnings.ts` | Firestore I/O + the published file |
| | `apps/web/src/lib/note-rows.ts` | which control to draw. ⚠️ a leaf **so a test can import it** — see below |
| | `apps/web/src/components/ContentNotes.tsx` | the panel, above `Reviews` on the work page |
| Tests | `packages/core/test/warnings.test.ts` | the join (31 assertions) |
| | `apps/web/test/content-notes.test.ts` | the affordances and the Firestore wording |

⚠️ **`note-rows.ts` is a leaf on purpose.** The first draft of the web test
imported the component and crashed at module load with *"Cannot read properties
of undefined (reading 'VITE_FIREBASE_API_KEY')"* — `firebase.ts` reads
`import.meta.env` at module scope, which is `undefined` under `tsx`. Same trap
`error-wording.ts`'s header records. Keep that file importing `@lc/core` and
nothing else.

### The lane

`warningCollection(env)` — `ENVIRONMENT === 'production'` decides, mirroring
`reviewCollection` and `tbrCollection`. **Both live instances are
`production`**, so `library.heygabi.ai` and `padhard.heygabi.ai` read and write
the same `user_content_warnings` as the audiobook site's prod lane. The `_dev`
collection is reachable only from `npm run dev:worker` locally.

⚠️ So a note seeded in `user_content_warnings_dev` is **not** a cross-catalog
visibility check for the deployed library — it is only visible to a local dev
build. (Both lanes were empty anyway when this landed.)

---

## 6. Exercised locally, 2026-08-17

`npm run dev:worker` on :8891, dev-bypass auth, with one `audiobook_holding` row
seeded locally to reproduce the divergent-title case (removed afterwards):

| Call | Answer |
|---|---|
| `GET /api/warnings/1/keys` (holding, titles differ) | `bookIds: ["a-killer-s-mind-zoe-bentley-mystery-book-1", "a-killer-s-mind"]`, `writeBookId` = the first |
| `GET /api/warnings/2/keys` (no holding) | one id, our own; `publishedTitle: null` |
| `POST /api/warnings/1/draft` | doc id `…-book-1_skylar_animal-cruelty`, `authorUid` stamped from the token, `workKey` + `source: 'library'` present |
| label of 81 chars / of spaces | 400 with a field-level reason, never a bare code |
| unknown work | 404 |
| `GET /api/me` | `moderateContent` present for `owner` |

⚠️ **The authorless-work "held" branch was NOT exercised**: the local D1 predates
migration 0120, so `work.authors` is still `NOT NULL` there and the row could not
be created. The branch is a line-for-line mirror of the two live ones in
`routes/reviews.ts` and `routes/tbr.ts`, and `warningDocFor`'s refusal is pinned
by a test — but it has not been run.

---

## 7. ⚠️ The ebooks half is DEFERRED, on purpose

The owner's ask named *"all physical book and the ebook site"*. Only the library
half was built. The ebooks page (`ebooks.heygabi.ai`) was **mid-rebuild by
another agent** on the day of this work — it is being turned into a
permission-gated shim (`docs/TODO.md`, the 2026-08-17 ebooks directive) — and
adding a feature to a page that is being replaced would have been work done
twice, or a merge conflict, or both.

**When it is picked up, this is what carries over and what does not:**

- **Carries over unchanged:** everything in §1, §4 and the whole of
  `packages/core/src/warnings.ts`. The store, the id, the delete rules and the
  80-character bound are the estate's, not this repo's.
- **Does NOT carry over:** §2's join. The ebooks site has no
  `audiobook_holding` cache to read the other catalog's spelling out of, so it
  needs its own answer to *"what does the audiobook catalog call this book"* —
  the ebook manifest's titles are a third spelling again. **Do not let it key on
  its own title**; that is the exact silo this document exists to prevent.
- **Open question for whoever builds it:** whether the ebooks page can reach
  this Worker's `/api/warnings/:workId/keys` (it would need a work id in *this*
  catalog, which `ebook_holding` — migration 0310 — may be able to supply), or
  whether it needs its own key derivation. The first is strictly better if the
  join exists.

---

## 8. Verified, and NOT verified

**Verified:** everything in §6 (locally exercised), the measurements in §2 and
§3 (production D1 and the live published file), the empty state of both Firestore
collections (REST read), `npm test` green apart from a pre-existing unrelated
failure (below), `npm run typecheck` clean across all workspaces, and the join
test watched failing on a deliberate mutation.

**NOT verified — needs the owner's own signed-in session:**

- **The add/delete round trip, on either instance.** Nothing has written a
  document to the live `user_content_warnings` collection from the library. The
  collection was empty when this shipped and — unless somebody has used the
  audiobook site since — still is.
- **That a note written here appears on the audiobook site's book page.** The
  key equality is asserted by test and by the local `/keys` response; nobody has
  loaded that page to watch it render.
- **The moderator path.** Whether the owner's uid has a `site_roles` document at
  all is unknown from here; if it does not, the Remove control on somebody
  else's note will be refused (with the §4 sentence) rather than working.
- **`padhard.heygabi.ai` signed in as her.** Same bundle, same Firebase project,
  same `ENVIRONMENT`, so it writes the same collection under her own email —
  but that is inference from configuration, not a round trip.
- **⚠️ A pre-existing, unrelated test failure was present in the tree**: 5
  assertions in `packages/estate-auth/test/gate.test.ts` about a
  `downloadEbooks` field. That package is a **gitignored sync of
  `catalog-platform`** (`generated/SOURCE.txt` stamped 2026-08-17T17:47Z), and
  the field belongs to the concurrent ebooks-gate work. Not touched, not fixed —
  it is that agent's zone.
