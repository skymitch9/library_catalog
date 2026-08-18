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
> **Updated 2026-08-17 (same day):** §7 rewritten — the ebooks half is now
> **BUILT**, in `audiobook_catalog`, and it answered the identity question a
> third way that adds a keying class this document did not have a name for.
> Counts there are measured against that repo's live 168-row ebook manifest.
>
> ⚠️ **CORRECTED 2026-08-17, later the same day — §2 was WRONG about which
> column holds the key, and §9 is the correction.** This document asserted that
> `audiobook_holding.title` is "the other side's own spelling" and that slugging
> it reproduces their `bookId` byte for byte. Migration 0010 says otherwise in
> its own header: that column is stored **already stripped** by
> `cleanTitleWithSeries`. Read §2 for the shape of the join and §9 for the
> column it actually runs on. **18 of 92 holdings** were reaching the physical
> book with no published warnings because of it.
>
> **NOT verified:** no signed-in round trip has been performed on either
> instance — see §8. The ebooks shelf's own round trip is likewise unverified
> (it is behind a sign-in wall); see that repo's `docs/DONE.md`.

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

> ⚠️ **The paragraph below names the WRONG COLUMN. It is kept as written
> because the shape of the join it describes is right and is still what the
> code does — only the column changed. `audiobook_holding.raw_title`
> (migration 0340) is the key; `.title` is a read alias. See §9.**

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

## 7. The ebooks half — ✅ BUILT 2026-08-17, in `audiobook_catalog`

*Deferred when this document was written the same day (the ebooks page was
mid-rebuild into a permission-gated shim by another agent, so adding a feature
to a page being replaced meant doing it twice). Picked up once that shim
shipped (`ca85553`) and built in `audiobook_catalog` as
`7c2061a` — see that repo's `docs/DONE.md`.*

**What carried over, exactly as predicted:** everything in §1 and §4. The
store, the document id, the `authorUid` stamp, the author-or-moderator delete
and the 80-character bound are the estate's. The shelf **calls**
`audiobook_catalog/site/user-warnings.js` rather than forking it, and imports
`bookIdFromTitle` from `site/reviews.js`. No new normaliser, no
`firestore.rules` change.

### The identity join, answered differently again

§2's mechanism did not carry over — as predicted — but the ebooks page did not
need this Worker either. **That repo IS the audiobook catalog**, so the
question *"what does the audiobook catalog call this book?"* is answerable from
its own data, and something already answered it: the ebook manifest's
**sibling-cover join** (`scripts/build_ebook_manifest.sibling_catalog_match`)
matches an ebook to the audiobook it sits beside in order to reuse its cover.
That join was extended to hand back the matched row's **raw catalog title**,
published per row as `audiobook_title`. One join, two answers, so a cover and a
content note can never disagree about which audiobook a file is.

⚠️ **THREE keying classes, not two** — the third is this half's own
contribution to the vocabulary, and it is not a fallback but a correct answer:

| Class | Key | Measured on the live 168-row manifest |
|---|---|---|
| `audiobook` | the audiobook catalog's title, byte-for-byte | **56** — of which **31 spell it differently** from the ebook |
| `beside` | its own title; the join refused (ambiguous, or a different volume) | **100** |
| `ebook-only` | its own title — **that IS this catalog's spelling** for a file with no audiobook at all | **12** |

So a third of the resolvable shelf would have siloed on the ebook's own
spelling — the same failure §2 measured at 27-of-92 on this side, in a
different catalog. ⚠️ **`ebook-only` is the class this document previously had
no name for.** An ebook with no audiobook sibling is not a book whose "real"
key is missing; the estate has no other spelling of it, so its own title is
canonical and keying on it is right. The prohibition in §2 is narrower than it
sounded: *never key on your own title when another catalog's spelling is the
convention* — not *never key on your own title*.

⚠️ **The `beside` class says so in words.** A file in an audiobook's folder
whose join was refused prints *"Filed beside an audiobook, but not matched to
one"*, because a refused join is not a match and silence there would read as
one. Same rule as §3's "the panel names the title it looked under", which that
page also follows for the `audiobook` class.

### The published file, from the third site

`content_warnings.json` is fetched **relative first, then the public
`https://audiobooks.heygabi.ai/` copy** — that page is served from two origins
(its own `ebooks.heygabi.ai` door and the audiobook Pages deploy, `/dev/`
included), and relative-first keeps a lane reading its own file. Reach with the
new key: **21 books** (14 listing warnings, 7 checked-clean), against 12 keyed
by the ebook's own title. §3's empty-array-is-not-a-missing-entry rule is
reproduced there and pinned by a test.

### The open question in the old text is closed

It asked whether the ebooks page should call this Worker's
`GET /api/warnings/:workId/keys` (needing an `ebook_holding` work id) or derive
its own key. **Neither, in the end** — it needed no key derivation at all,
because the pipeline that builds its manifest already knew the answer and can
simply publish it. Nothing in the browser computes a key there either; it hands
a raw title to `user-warnings.js`, which owns the one `bookIdFromTitle` call.

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

---

## 9. ⚠️ THE CORRECTION — the key was the CLEANED title, and all three surfaces disagreed

*Added 2026-08-17, hours after §2 was written, on the owner's next ask:*

> *"lets also move all content warnings from audiobooks to physical books and
> not relook them up. and make sure any edition has the same content warnings."*

Chasing "why do so few physical books show a warning" landed on §2's own
premise. **`audiobook_holding.title` is not the audiobook catalog's spelling.**
Migration 0010's header says so outright — the column is stored *"already
stripped of Audible's series decoration by `cleanTitleWithSeries`"* — and
`scripts/lib/audiobooks.mjs` computes both, `rawTitle` and `title`, then the
backfill wrote only the second. The raw string was dropped on the floor at the
D1 boundary.

```
catalog.csv     "Onyx Storm - Empyrean, Book 3"   <- what BOTH other surfaces key on
holding.title   "Onyx Storm"                      <- what §2 keyed on
bookIdFromTitle  onyx-storm-empyrean-book-3   vs   onyx-storm
```

§2's claim is true only for a row whose raw title carried no decoration — and
the rows where the two catalogs disagree are the entire point of the join. So
the bug is §2's own failure mode, reintroduced one layer down, with the same two
silent halves and the same "nobody has added a warning yet" appearance.

### Measured, 2026-08-17, production D1 + the live published file

| | Before | After |
|---|---|---|
| holdings reaching an entry in `content_warnings.json` | **15** | **32** |
| published warning labels surfaced across the catalog | **57** | **164** |
| holdings whose write key equals the audiobook catalog's own | 36 | **90** |
| …of which the pre-0340 key was a different, siloed slug | — | **54** |
| `audiobook_holding` rows carrying `raw_title` | 0 | **90 of 92** |

The 18 books that gained a published entry are the whole Percy Jackson set,
*Words of Radiance*, *Onyx Storm*, *Quicksilver*, two *Dungeon Crawler Carl*
volumes, *The Wandering Inn* (and *No Killing Goblins*, which is aliased to it),
plus six that gained a **checked-clean** entry — a different fact from "nobody
looked", and §3's rule keeps them apart.

⚠️ **One book LOST an entry, and that is the correction working.** *Space Knight
Book 2* was showing the entry keyed *"Space Knight"* — which is **Book 1's**,
carrying zero warnings. Its raw title is *"Space Knight, Book 2"*, which the
published file has never held. The panel now says nobody has checked published
sources for it, which is true. A wrong answer replaced by an honest absence is
not a regression.

⚠️ **2 of 92 rows have `raw_title` NULL** — the two stale holdings (*Isles of
the Emberdark*, newly stale this run, and *Tamer: King of Dinosaurs Book 11*).
An unmatched row is not rewritten, so it keeps the old behaviour: NULL means
**not recorded**, never "same as `title`", and `warningKeysFor` falls back.

### The decision: an ALIAS layer, and no rekey — the store was re-measured empty

`user_content_warnings`, `user_content_warnings_dev`, `cw_requests` and
`cw_requests_dev` were **re-read over the REST API on 2026-08-17 and all four
hold 0 documents.** So moving the write key orphans nothing, and no persisted
Firestore id moves — the migration-with-blast-radius this estate is careful
about never arose.

It would not have arisen even with documents in there, and that is the point
worth keeping: **`WarningKeys.bookIds` is a union, so every spelling this
catalog has ever filed under stays in the read set forever.** The cleaned-title
slug is still queried, precisely *because* it used to be the write key. Add to
that list; never replace it.

A separate alias table was considered and refused. **The mapping already
exists** — one row per work in `audiobook_holding`, produced by this project's
ONE matcher, carrying its rung (`matched_via`), its score (`title_similarity`)
and the alias that unlocked it (`via_alias`), and printed in full by the
backfill. That is the reviewable stored mapping, not a read-time guess. A second
table would be a second answer to a question this one already answers.

### ⚠️ `matched_via` is deliberately NOT a write gate

Blocking writes on a containment match looked cautious. All four containment
rows, measured:

| work | matched to | verdict |
|---|---|---|
| Harry Potter and the Goblet of Fire | …*(Full-Cast Edition)* | the SAME work, another edition — the case the owner asked to unify |
| Harry Potter and the Sorcerer's Stone | …*(Full-Cast Edition)* | same |
| Tamer: King of Dinosaurs Book 11 | *Tamer: King of Dinosaurs* | wrong volume — but already **stale**, so already write-excluded |
| Space Knight Book 1 | *Space Knight* | ⚠️ said "over-shares with Book 2" — **wrong, corrected below** |

The rule would refuse two matches it should welcome, add nothing to the one
staleness already catches, and still miss the real over-share: **Space Knight
Book 2 reaches the same title on the `exact` rung, through an owner-authored
`work_alias`.** Three titles are each held by two works this way — *Space
Knight*, *Fae and Fare*, *The Wandering Inn* — two of them deliberately (a
volume aliased to its series' catalog row). ⚠️ **This is the one open
over-share, and it is a mapping question, corrected in `work_alias`, not with a
read-time heuristic here.**

### ⚠️ THE OVER-SHARE ABOVE DOES NOT EXIST — re-measured 2026-08-17, evening

The paragraph and table row above were written from the *cleaned* title, which
is the exact mistake §9 exists to correct — reintroduced one more layer down, in
prose this time. **Both works already resolve to their own audiobook row**, and
they did so before this was ever written down. Production D1, read the same day:

| work | `raw_title` | `title` (cleaned) | `matched_via` | `via_alias` | `index_sort` |
|---|---|---|---|---|---|
| 249 *Space Knight Book 1* | **Space Knight** | Space Knight | containment (0.80) | — | 1 |
| 250 *Space Knight Book 2* | **Space Knight, Book 2** | Space Knight | exact (1.00) | Space Knight | 2 |

Two different `raw_title`s, so two different keys — and `warningKeysFor` has
preferred `raw_title` since migration 0340:

```
#249  writeBookId space-knight          published "Space Knight"         -> checked, 0 warnings
#250  writeBookId space-knight-book-2   published "Space Knight, Book 2" -> NO entry (nobody has looked)
```

Verified on the **live signed-in pages** (`/work/249`, `/work/250`) the same
evening: 249's panel says *"Published sources have been checked for this book
and listed none"*; 250's says only *"No content notes yet"*, with no published
line at all. Their write spellings are named on the page and differ, exactly as
above. So the correction §9 announces for *Space Knight Book 2* — a wrong answer
replaced by an honest absence — is the whole of the fix, and no mapping edit was
outstanding.

**What settles the volume is `disambiguateByVolume`, not row order.** The
`add-space-knight-alias.mjs` header worried that "the vol-2 row happens to sit
first in the index"; that stopped being true when the volume rule landed.
Exercised against the live `catalog.csv`:

```
lookup("Space Knight Book 2", author, vol 2)  -> containment  raw "Space Knight, Book 2"   <- alias not needed
lookup("Space Knight",        author, vol 2)  -> exact        raw "Space Knight, Book 2"
lookup("Space Knight",        author, vol 1)  -> exact        raw "Space Knight"            <- the volume decides
lookup("Space Knight",        author, null)   -> NO MATCH                                   <- refuses to guess
```

⚠️ **So `work_alias` row 26 was left in place, and that is deliberate.** It is
`source='manual'` (a person's researched answer, which migration 0001 says a
re-import must never delete), it changes nothing about which row #250 reaches —
only the rung it reaches it on — and it is **not warnings-only**: `work_alias` is
also read by `routes/ingest.ts`, `routes/scan-jobs.ts` and `routes/enrich.ts`, so
removing it would change what an incoming bare *"Space Knight"* scan folds into.
It is visible and removable by the owner under *Also known as* on `/work/250`.

**The one residual, and it is CODE, not mapping.** `warningKeysFor` keeps every
spelling in `bookIds` forever, so #250's read set is
`["space-knight-book-2", "space-knight"]` — and `space-knight` is #249's write
key. A *reader-contributed* note on Book 1 would therefore also render on Book
2's page. It is irreducible in data: `space-knight` is genuinely #250's own
pre-0340 key **and** #249's current one. Both lanes of the store were re-read
over the REST API on 2026-08-17 and hold **0 documents**, so nothing is
mis-rendered today. Narrowing the union is a read-set design change with its own
orphaning risk; it was not made, and it is recorded in §10 rather than guessed
at.

### The queue: one work is answered ONCE — `audiobook_catalog`, commit `17ec82d`

"Not relook them up" is enforced in `app/tools/fetch_content_warnings.py`, not
at the button, because that file is the one choke point every producer flows
through: `cw_requests`, `cw_requests_dev` and `cw_requests.txt`. One
implementation covers any future surface that learns to queue — including a
library-side request button, which **does not exist today** (this catalog has no
CW request surface at all; see §10).

⚠️ **No fifth title-fold was written.** `titles.ts` records the rule — a second
language needing those folds brings the cross-language parity check with it — so
the dedupe uses only vocabulary that file already owned: `main_title()`, the
"Main Title - Subtitle" split written for Hardcover, plus the catalog's own
author column, case-folded. Two rungs, ambiguity dropped on both:

| Rung | Key | Measured on the live 1,079-row catalog |
|---|---|---|
| `by_author` | `(main title, author)` | 1,069 buckets, **5 ambiguous → dropped** |
| `by_title` | main title alone, across all authors | 1,066 buckets, **5 ambiguous → dropped** |

⚠️ **The title-only rung is the one the real queue lands on**, and the first
draft did not have it: a `cw_requests` document carries a `bookTitle` and **no
author**, so an author-gated rung fired on nothing. Found by running it, not by
reading it — the tripwire proof entered the paid chain on the first attempt.
That rung is *stricter* about collisions, not looser: it drops any main title
two different authors share, which keeps the two different books called *Wicked*
apart. **117 books** are reachable by their bare main title.

`carry_over` writes the canonical answer under the requested title with a
`carried_from` field — a **copy, not a pointer**. An `{"alias_of": …}` entry
would need all three front ends taught to follow it, two of them in another
repo, and any that was missed would render a book with no warnings. The copy
keeps the canonical entry's own `source` and `checked_at`, because those are
facts about when *that* answer was found; only `carried_from` is new, so the
join is reviewable in the file itself and undone by deleting the copies.

Exercised over the real `catalog.csv` and a copy of the real
`content_warnings.json`, with `check_book` replaced by a tripwire that raises if
entered — four requests, none of them a key in the file:

```
fulfilled: 4        PAID CHAIN ENTERED: NEVER — 0 lookups
Onyx Storm -> 10 warnings, carried_from "Onyx Storm - Empyrean, Book 3"
canonical entries untouched: True
SECOND run over the same queue — fulfilled: 4, paid chain: NEVER
```

### Where the change landed

| Repo | File | What |
|---|---|---|
| library | `migrations/0340_audiobook_holding_raw_title.sql` | the column, and why it is not a rekey |
| library | `scripts/backfill-audiobook-holdings.mjs` | writes `raw_title` — the value it already had |
| library | `packages/db/src/works.ts` | `AudiobookHolding.rawTitle` |
| library | `packages/core/src/warnings.ts` | raw preferred; cleaned kept as a read alias |
| library | `apps/worker/src/routes/warnings.ts` | passes it, and names the raw spelling to the panel |
| library | `packages/core/test/warnings.test.ts` | 24 assertions, real production rows |
| audiobook | `app/tools/fetch_content_warnings.py` | the two-rung queue dedupe + `carry_over` |
| audiobook | `tests/test_content_warnings.py` | 10 assertions |

---

## 10. Still open after §9

- ⚠️ **The ebooks shelf is CORRECT and needs no change** — it already keys on
  the manifest's raw `audiobook_title`. It was the surface that proved which
  spelling is canonical. Nothing was deferred there. (Its own page was being
  rebuilt by another agent while §9 was written, and no template or `site/*.js`
  in that repo was touched.)
- **This catalog has no "request an AI check" button.** The audiobook site has
  one; the library does not, so nothing here can queue a lookup. If one is ever
  added it must write `cw_requests/{bookIdFromTitle(rawTitle)}` with
  `bookTitle` = the **raw** audiobook title, so the fulfiller's exact-key path
  answers it with no fold at all.
- ~~**The `work_alias` over-share**: *Space Knight Book 1* and *Book 2* resolve
  to one audiobook row and therefore share one warning set.~~ ✅ **CLOSED
  2026-08-17 — the premise was false.** They resolve to two different rows
  (`raw_title` *"Space Knight"* vs *"Space Knight, Book 2"*), so their published
  warnings already differ; measured in production D1 and confirmed on both live
  signed-in pages. No mapping edit was made and none was needed — see §9's
  *"THE OVER-SHARE ABOVE DOES NOT EXIST"*.
- ⚠️ **What IS still open is a read-set collision, and it is code.** #250's
  `bookIds` contains `space-knight`, which is #249's write key, so a
  reader-contributed note on Book 1 would also show on Book 2's page. **0
  documents in either lane today**, so it is unobservable; and it cannot be
  fixed in data, because that id is legitimately #250's pre-0340 key as well.
  Any fix narrows `warningKeysFor`'s union, which is the one thing that comment
  says never to do without weighing the orphaning it prevents.
- **The friend instance holds 0 `audiobook_holding` rows**, so nothing bridges
  there and every work keys on its own title. Migration 0340 is applied to that
  D1 anyway, so the shared bundle cannot meet an old schema.
- **`content_warnings.json` has not yet been swept** to carry answers onto the
  spellings the pipeline has never been asked about. The dedupe fires on the
  next request, sync or `--all` run; nothing backfills the file today.
- The round trips in §8 remain unverified for the same reason: they need a
  signed-in session. §9's own live check was `/api/health` (`database: up`,
  version `bd72dbcf`), not a rendered panel.
