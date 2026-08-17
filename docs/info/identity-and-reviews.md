# Identity & Reviews — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-09** against `audiobook_catalog` at that date —
> `site/identity.js`, `site/reviews.js`, `site/fb-env.js` and `firestore.rules`
> were read, and the backfill was dry-run against the live `reviews` collection
> (860 documents). What has **not** been verified: nothing here has run against
> a deployed library catalog, because there is not one yet.
>
> §5.1 re-verified **2026-08-14**: three dry runs against the live `reviews`
> collection (870 documents) and a read of the real
> `audiobook_catalog/scripts/catalog_overrides.json` (69 entries, **0** of them
> a title or author correction). **NOT verified:** no `--commit` run was made
> that day — there was nothing to write.

The owner's requirement, in their words:

> *"we need to port reviews from the audiobook firebase into the physical library
> and vice versa. We then need to link Google SSO on both so we dont recreate
> duplicate users"*

This document is how that is done, and — more usefully — the three things about
the audiobook catalog that make it harder than it sounds.

---

## 1. What the audiobook catalog actually does

Measured, not assumed. All three of these surprised the design.

### 1.1 It has Google SSO, but it throws the session away

`site/identity.js` signs in with Firebase Auth and then **immediately signs out
again**:

```js
// Google is only used to capture identity — the site's Firestore rules
// never check auth. Detach immediately so a persisted auth session can't
// later expire and poison Firestore writes with PERMISSION_DENIED
// (stale-token refresh failures, esp. mobile Safari).
try { await signOut(auth); } catch (e) { /* non-fatal */ }
```

What survives is `localStorage`: `ab_identity_name`, `ab_identity_email`,
`ab_identity_photo`, `ab_identity_method`.

There is also a **legacy passphrase method** — `users/{slug}` documents with a
SHA-256 `passphraseHash` — and those accounts have no email at all.

### 1.2 Its identity is presentation, not access control

Its own `isAdmin()` says so:

> *"PRESENTATION ONLY — this decides what the UI shows, nothing more. The session
> comes from localStorage, so anyone can set ab_identity_name and pass this
> check. It is not, and cannot be, an access control."*

`firestore.rules` contains no `request.auth` anywhere. Every collection is
world-readable and validated only on shape.

### 1.3 Its reviews are keyed on the title alone

`site/reviews.js`:

| | |
|---|---|
| collection | `reviews` (prod) / `reviews_dev` (dev lane, via `col()`) |
| document id | `` `${bookId}_${displayName.toLowerCase()}` `` |
| `bookId` | `bookIdFromTitle(title)` — a slug of the **title only** |
| fields | `bookId, displayName, rating, text, createdAt, updatedAt` |
| rating | 0.5 … 5, half stars, enforced in `firestore.rules` |

---

## 2. Identity: one account, and how

**The library catalog signs into the same Firebase project (`audiobook-catalog`)
and joins on `email`.**

| Decision | Why |
|---|---|
| Firebase Auth, **not** Cloudflare Access | Access is a second, unrelated Google SSO. The same person on both sites would be two records with nothing linking them — the exact duplicate the requirement forbids. `LIBRARY_CATALOG.md` §8 already specified Firebase auth for phase 1. |
| Join on `email`, not uid | The audiobook site has **no uid to join to** — it signs out of Firebase Auth before anything is stored. Email is what it keeps, and what its own `isAdmin()` keys on, deliberately, because a Google display name can change at any time. |
| `firebase_uid` stored but unused | The only identifier that survives an email change on the Google account. Nothing joins on it yet; it is there so that a future hardening is a migration and not an archaeology exercise. |
| Unverified emails refused | Firebase will mint a token for an unverified address, and email is our join key. Merging someone into an account they proved nothing about is worse than a failed sign-in. |
| **This app keeps the token live** | Here the token *is* the access control — the Worker verifies its signature against Google's keys. The audiobook site's detach-immediately trick is correct there and would break everything here. A 401 refreshes once and retries once; twice would be a loop. |

The verifier is `apps/worker/src/middleware/auth.ts`. It asserts
`FIREBASE_PROJECT_ID` in both `issuer` and `audience`, so a token from any other
Firebase project fails closed.

### ⚠️ Passphrase accounts cannot sign in here, and that is not a bug

A legacy passphrase user has no Google account and no verifiable identity. This
app requires one. Their existing **reviews still appear** — reviews are attributed
by `displayName`, and the backfill keys them like any other — they simply cannot
log in to write new ones from the library side. Migrating them means asking those
people to sign in with Google once, which is a conversation, not a code change.

---

## 3. Reviews: one store, no sync job

**Reviews live in Firestore. Both sites read and write the same documents.**

```
D1  (library_catalog)          Firestore  (shared, audiobook-catalog project)
────────────────────           ────────────────────────────────────────────
work / edition / copy          reviews/{bookId}_{displayNameLower}
  what we own                    what we thought
user_book
  read_state, dates, notes
  rating_cached  ◄── copy only, never authoritative
```

### Why not a sync

"Vice versa" plus two stores means a bidirectional sync between two schemas, and
that is the shape that drifts. This household has already shipped that bug once:
**four** author-splitting implementations across two languages, two of which
disagree (see `packages/core/src/titles.ts` for the table). One store cannot
diverge from itself.

### What the library catalog adds to a review document

Additive only. `bookId`, `displayName`, `rating`, `text` and `createdAt` are
never touched.

| Field | Purpose |
|---|---|
| `workKey` | `normaliseTitle(cleanTitle)\|normaliseTitle(primaryAuthor)` — the key both catalogs can compute |
| `source` | `'audio'` or `'library'` — see the honesty note below |
| `editionLabel` | 'paperback', 'kindle' — display only |
| `email` | the Google address, so a review can be joined to a real account later |

### ⚠️ `source` is an honesty guard, not bookkeeping

An audiobook review is partly a review of a **narrator**. A print review is not.
Porting them into one place without recording which is which would make "5 stars"
on a paperback mean something it never said. The UI renders "4.5 (audiobook)".

### No rules change is needed

`validReview()` asserts only `displayName is string` and a rating in 0.5…5, and
ignores unknown fields. Verified against the live `firestore.rules` on
2026-08-09. This matters: a rules deploy changes the audiobook site's security
posture, and this feature does not need one.

### No service account in THIS Worker, deliberately — one ratified exception elsewhere

The browser writes the document with the signed-in user's own credentials. A
Firebase service account would bypass `firestore.rules` entirely, and putting the
most powerful credential in the household behind the least important endpoint is
a bad trade. The Worker's job is to *derive the keys*
(`POST /api/reviews/:id/draft`), not to hold a key.

> **Ratified exception (owner, 2026-08-14):** the estate **auth Worker**
> (catalog-platform `apps/auth-worker`) now holds the service account
> (`FIREBASE_SERVICE_ACCOUNT` secret, `src/firebase-sa.ts`) to write
> `site_roles` and pre-seed directory rows — approver-gated, audit-logged,
> the UI-first role management the owner ordered. The reasoning above still
> governs THIS repo's Worker and every review-path endpoint: reviews are
> written by people with their own credentials, never by a key. The exception
> lives behind the estate's most-guarded surface, not its least.

---

## 4. `workKey` — why the audiobook site's own key cannot work

`bookIdFromTitle("Firefight - The Reckoners, Book 2")` →
`firefight-the-reckoners-book-2`.

A print copy of that book is called **Firefight** and slugs to `firefight`. They
never meet. And the key has no author in it, so two different books called
"Gold" share one.

So `workKey` is `normaliseTitle(cleanTitle) | normaliseTitle(primaryAuthor)`:

```
Firefight - The Reckoners, Book 2  (audiobook)  ─┐
                                                 ├─►  firefight|brandon sanderson
Firefight                          (paperback)  ─┘
```

### ⚠️ Two folds that look interchangeable and are not

| | `bookIdFromTitle` | `normaliseTitle` |
|---|---|---|
| "The Lake House" | `the-lake-house` | `lake house` |
| leading article | **kept** | stripped |
| diacritics | kept | folded |
| used for | the document **id** | the `workKey` |

Building a document id with the wrong one writes a **second review beside the
existing one** rather than updating it. `packages/core/src/reviews.ts` ports
`bookIdFromTitle` verbatim and says so in bold.

---

## 5. The backfill

`scripts/backfill-review-keys.mjs`. Dry run by default; `--commit` writes.

**Dry-run result, 2026-08-09 against live `reviews`:**

| | |
|---|---|
| review documents | **860** |
| matched to a catalog row | **860** |
| unmatched | **0** |
| already keyed | 0 |

⚠️ **It has not been run with `--commit`.** It writes to the live review data of
a site other people use, and that is the owner's call.

### What the dry run found, and changed

Reading the keys it *would* write exposed a real defect. Audible titles carry
packaging that no print edition has, and the series suffix is written three
different ways **within one series**:

```
A Court of Mist and Fury (Part 1 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses 2
A Court of Mist and Fury (Part 2 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses, Book 2
A Court of Mist and Fury (Part 2 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses
```

The first pass produced
`court of mist and fury part 1 of 2 dramatized adaptation a court of thorns and roses 2`
— a key no paperback could ever match. Two fixes followed:

1. `Part N of M` and `Dramatized Adaptation` are stripped as Audible packaging.
2. **`cleanTitleWithSeries` uses the `series` column** from `catalog.csv` to
   delete the suffix exactly, instead of pattern-matching a bare trailing
   numeral — which would also have eaten the tail of a genuine subtitle.

All three now produce `court of mist and fury|sarah j maas`.

**The lesson is the process, not the regex:** the dry run is what made a silent
wrongness visible. Read the keys, do not just read the counts.

### 5.1 A retitle on the audiobook side — the carry (phase A3, 2026-08-14)

`catalog-platform/docs/info/edit-audit-design.md` §3.4 names the hazard this
closes. A `title` correction in `audiobook_catalog/scripts/catalog_overrides.json`
changes the *published* `catalog.csv` on the next build. `bookId` is a slug of
the published title, so the correction silently detaches every existing review
of that book: the backfill stops finding a catalog row for it, and the `workKey`
it still carries names a spelling that no longer exists. §6's join and §7.7's
sweep both lose those reviews and nothing reports it.

**Re-running the backfill is the whole carry ceremony on that side** — no site
JS is touched and no second store is invented. Two changes make it one:

| | |
|---|---|
| **Aliasing** | `overrideTitleAliases` + `aliasedBookIdIndex` (`packages/core/src/reviews.ts`) fold every retitle in the overrides file into an old-slug → new-slug alias, so a document filed under the pre-correction slug still finds its row. The overrides file is the only place that remembers the old spelling, because `edit_overrides.py` **keys its entries on the pre-correction tags** — `match.title` is the old title by construction. An ASIN-keyed entry has no match title, so `evidence.tags_read['©nam']` is the documented fallback |
| **Restamping** | a document whose stored `workKey` no longer equals the key its row derives is now **moved**, not skipped. ⚠️ Before this, any document carrying a key counted as done — so after §7.6's commit run the script could never have carried anything. That was the real gap; aliasing alone would have fixed nothing |

Three refusals, all measured by tests in `core.test.ts`:

- **A live catalog row always beats an alias.** If another book is published
  under the old slug today, the alias is dropped (`shadowed`). Pointing a real
  book's reviews at a different book is worse than leaving a rename unmatched.
- **Two corrections claiming one old slug are refused, not resolved.**
- **A review this catalog wrote (`source: 'library'`) is never restamped from
  here.** Its key comes from this catalog's own title and author, which are the
  authority for a print review; the audiobook row's spelling is not.

#### Measured, 2026-08-14, dry run against the live `reviews` collection

| Run | matched | unmatched | keys moved |
|---|---|---|---|
| Production as it stands | **870** | 0 | **0** |
| Simulated retitle, aliasing OFF | 866 | **4** | 0 |
| Simulated retitle, aliasing ON | **870** | **0** | **4** |

The middle row *is* the hazard, reproduced against real documents: the
simulation retitles "Harry Potter and the Sorcerer's Stone (Full-Cast Edition)"
to "Harry Potter and the Sorcerer's Stone" in a copy of the CSV, and four real
reviews go unmatched — and, before this phase, would also have been reported as
"already keyed" and left holding
`harry potter and the sorcerer s stone full cast edition|j k rowling` forever.
With the alias they are carried to `harry potter and the sorcerer s stone|j k
rowling`, and the other 866 are untouched.

⚠️ **No `--commit` run was warranted on 2026-08-14.** Production carries **zero**
title overrides today — all 69 entries correct `series`/`series_index`, which
move no `bookId` — so the first row above says every stored key is already the
key its row derives. A commit run would have written nothing. The guard is in
place *before* the first retitle, which is the order §7 of the design asks for.

**The command, for the day a retitle lands** (after the audiobook site rebuilds):

```bash
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:reviews                # dry run — READ THE KEY MOVES
LC_AUDIOBOOK_ROOT=... npm run backfill:reviews -- --commit
```

---

## 6. Reading reviews before the backfill has run

`fetchReviews` issues **two** queries — `workKey` and the legacy `bookId` — and
deduplicates on document id.

⚠️ The legacy query is a weak fallback, not a substitute. It only matches when
both catalogs spell the title identically, which for anything in a series they
never do. Verified locally: a work entered as "Firefight" produces
`legacyBookId = "firefight"`, while the audiobook review sits under
`firefight-the-reckoners-book-2`. **The backfill is required, not optional.**

Drop the second query once the backfill has run and the count is stable.

---

## 7. A rating is evidence the book was read

> *"if a book has a rating from the audiobook library mark it as read"* —
> *"ratings should be for the logged in person. so if its a rating i left mark it
> read for me"* — *"mark all copies of a book read so if i own percy jackson 3
> times … mark all 3 read"*

Built 2026-08-11. Migration **0070** adds `user_book.read_state_how`.

### 7.1 Where the derivation happens, and why it cannot happen anywhere else

**In the browser, on the book page.** The Worker cannot see Firestore — there is
no service account and §3 explains why that is the design. The browser is the
only thing in this estate that sees both stores, and `Reviews.tsx` already
fetches every review of a book when the page opens. Recognising the signed-in
person's own rating among them and posting it to
`POST /api/reviews/:workId/observed` is the whole mechanism.

The three alternatives, and why each was rejected:

| Option | Why not |
|---|---|
| A cron | There is none, deliberately (§3). Adding one to reach Firestore needs the service account this project refuses to hold. |
| Server-side from `rating_cached` | Forbidden by the contract on `cacheRating`, and useless anyway — the cache only ever contains what this app already wrote, so it can never learn about a review written on the audiobook site. |
| Inside `POST /draft` | `/draft` runs **before** the browser writes to Firestore. `cacheRating` there knowingly accepts being wrong if the write fails, because a sort key can be stale. A read state cannot: it is shown to a person as a fact about their own life. `/observed` reports what Firestore *actually holds*, read back afterwards. |

A **backfill** covers what the browser cannot: nobody will open 224 book pages.
`scripts/backfill-read-from-ratings.mjs`, dry run by default. See §7.5.

### 7.2 ⚠️ A derived read state stays distinguishable, forever

`user_book.read_state_how`, the same move as `research_finding.decided_how`
(0013) and `work.cover_status` (0040):

| Value | Meaning |
|---|---|
| `'human'` | Somebody pressed a read-state chip. **`setReadState` is the only writer, and it stamps unconditionally.** |
| `'rating'` | Derived, by `deriveReadState` in `packages/core/src/readstate.ts`. |
| `NULL` | Predates the column, or the row exists only because `cacheRating` minted it. Deliberately not backfilled. |

The precedence never overrules a person, which is the point: a `'human'` row is
refused outright, so **marking a book unread is permanent** and a re-sync cannot
put 'read' back over it. A `'rating'` row may be refined by better evidence. A
`'dnf'` or `'reference'` row with no recorded how is left alone — those are
*more* specific than 'read', and overwriting one trades a precise truth for a
vague one. The book page prints "Marked read from your audiobook rating" so
nobody is told they asserted something they did not.

### 7.3 `read_format` is the main signal, not a nicety

The owner reads far more audiobooks than physical books; most of the shelf is
collection pieces. So an audiobook review is evidence of a **listen**, and that
is the most accurate thing this app will ever know about how a book was
consumed. `source: 'audio'` ⇒ `read_format = 'audio'`. A library review is
evidence of no particular format — this catalog holds EPUBs and Kindle editions
too — and guessing `'print'` would be a fabrication. An existing format is never
overwritten.

⚠️ **And `source` is absent from every existing review.** Measured against the
live collection 2026-08-11: **869 documents, 0 with `source`, 0 with `workKey`,
0 with `email`.** Reading `doc.source` alone answers "unknown" for the entire
corpus. `reviewSourceOf` in `packages/core/src/reviews.ts` closes that: this
catalog's `reviewDocFor` **always** writes both `workKey` and `source`, so a
document carrying neither cannot have come from here, and the only other writer
of that collection is the audiobook site. Absence is the evidence. The invariant
that makes it sound is asserted in `core.test.ts`, not left as a comment.

The same measurement fixed a live display defect: `Reviews.tsx` rendered
`r.source === 'audio' ? 'audiobook' : 'this library'`, which labelled **every**
audiobook review "this library" — precisely the thing that component's own
header says must never happen.

### 7.4 ⚠️ The "three copies" half needed no code, and the half that did is not deduplication

Read state is `UNIQUE (work_id, user_id)` — it hangs off the *work*, not the
copy. **Three `copy` rows of one work have always shared one read state.**

What needed code is three copies that arrived as three *works*, which is what
scanning does when a title is spelled two ways. The join is `work.work_key`,
which is indexed and **not unique**, and which is the same key the review
documents carry. So "which works is this rating about" and "which works does this
review belong to" are one question. A second work row for the same book is swept
in for free.

⚠️ This merges nothing, mints no `work_relation` and changes no title. Two works
sharing a `work_key` are the same book by the only definition this catalog has.
If they should be one row, that is a person's decision and a different feature —
see the omnibus/`edition.collects` work.

Measured against production 2026-08-11: **no `work_key` is shared by two work
rows**, so the fan-out currently reaches exactly one work every time. It is
correct in advance rather than after the duplicate appears.

### 7.5 What the backfill would write — staged 2026-08-11, NOT run

```bash
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:read-states -- --remote            # dry run, reads only
LC_AUDIOBOOK_ROOT=... npm run backfill:read-states -- --remote --commit
```

Dry run against production, 231 works and 2 signed-in people:

| | |
|---|---|
| review documents | **869** (was 860 on 2026-08-09) |
| claimed by a signed-in person | **412** — Skylar 383, Amber Mitchell 29 |
| nobody in `app_user` claims them | **457** — Samantha Hardman 225, Jamie Jeremiah Lievertz 213, Sparkling Ember 11, Solomon Hardman 8 |
| no derivable `workKey` | **0** |
| book not in this catalog | **397** |
| **would mark read** | **15**, every one `read_format = 'audio'` |
| would refuse (human-set) | 0 — `user_book` is empty |

⚠️ **15 is not a shortfall.** 397 of the 412 are audiobooks the household owns
and has no print or ebook copy of; the catalog holds 231 works against ~1,075
audiobooks. And most of the physical shelf is collection pieces that were never
read, so a blank read state there is the correct answer, not a gap. Nothing in
this feature turns an unread physical book into a worklist, a badge or a count.

⚠️ **Two `LC_AUDIOBOOK_ROOT` traps**, both hit while building this. In a git
worktree the default path lands three directories too deep, and the first dry
run reported `0 distinct bookIds` / `no derivable workKey: 412` — which looks
exactly like a matching failure and was a missing file. The script now **exits**
rather than reporting a tidy zero. Second, `scripts/lib/d1.mjs` returned **0
works** against a live 231 on one run and 231 a minute later; the script now
refuses to proceed on a zero-row read for the same reason.

### 7.6 ~~Running the review-key backfill would improve this~~ — ✅ RUN 2026-08-12

`scripts/backfill-review-keys.mjs --commit` was run for the first time on
2026-08-12: **870 written, 0 unmatched**, ratings and text untouched. Every
review document now carries `workKey` and `source: 'audio'`, so the browser path
reads the audio signal from the field instead of inferring it, and `fetchReviews`
could drop its legacy `bookId` query (§6) once the count is stable.

⚠️ **Do not drop it yet.** The audiobook site writes no `workKey`, so every
review written there *after* that backfill has only `bookId` again. The legacy
query is what finds those, and §7.7 depends on nobody having removed it.

### 7.7 The whole shelf at once — the sweep, 2026-08-12

§7.1 covers a book the moment somebody opens it and covers nothing otherwise.
Nobody opens 258 book pages, and the unattended answer (§7.5) needs a checkout
of the sibling repo to turn a `bookId` into a `workKey` — a maintainer's tool,
not something the household has. So production had **zero** derived read states.

The sweep closes that. One Firestore query for the signed-in person's own
reviews, once per browser session, and one call that applies all of them.

| | |
|---|---|
| **Where** | `apps/web/src/lib/read-sync.ts`, called from the collection page — the landing screen, and the owner of both things the answer changes: the "read" stat and the Read filter |
| **The rule** | `observedRatingsFromReviews` in `@lc/core`. Keeps mine via the existing `isMyReview`, drops anything off the half-star scale, drops a document with no `workKey` |
| **The write** | `POST /api/reviews/observed` → `applyObservedRatings` in `@lc/db`. `applyObservedRating` (§7.1's endpoint) now **delegates** to it rather than keeping a second copy |
| **The lane** | `GET /api/reviews/collection`. A sweep has no `workId` to ask it from, and a dev browser reading the live collection would look exactly like the feature working |
| **Migration** | **None.** `read_state_how` is 0070 and nothing new is stored |

#### ⚠️ Why this could not have been built before 2026-08-12

It joins on the `workKey` **stored on the document**, and until §7.6 ran there
was not one. The per-book path can paper over a missing key because it knows
which book it is looking at, so it has a legacy `bookId` to ask with. A sweep
starts from the *person*: a document with no `workKey` names no book it can
reach, and is skipped.

⚠️ **Which means a review written on the audiobook site since that backfill is
invisible to the sweep** until §7.6 is run again. It is still picked up the
moment its book page is opened. **The per-book derivation is the safety net, not
a duplicate of this**, and neither may be deleted as redundant.

#### What did not change

Every protection in §7.2 holds unaltered, because the sweep reaches the database
through the same `deriveReadState`: a `'human'` row is refused outright, a `dnf`
is never promoted, an existing `read_format` is never overwritten, `finished_on`
is never invented, and the returned list is only what actually changed — empty
on every session after the first, which is what keeps a per-session sweep from
redrawing anything or writing twice.

⚠️ **The `workKey` comes from the client here**, which §7.1's endpoint does not
allow. It is matched, never trusted: it joins against `work.work_key`, an
unknown key is a silent no-op — the ordinary case, since the household owns
~1,075 audiobooks against 258 works — and every write is scoped to the `user.id`
on the verified token. The same capability already permits `PUT
/works/:id/reading`, which sets 'read' outright.

#### Said out loud

The collection page prints *"Marked N books read, from M ratings you have
written on the audiobook site"* only when something actually changed, and names
where to undo it. Same reasoning as the book page's caption: a read state that
appears without explanation reads as the app claiming you asserted something you
did not.

⚠️ **Somebody with no `review_name` sweeps nothing.** The audiobook site writes
no `email`, so the folded display name is the only key that reaches those
documents. That is a data problem with a screen for it (People), not a code one,
and `backfill-read-from-ratings.mjs` prints the same warning.

## 8. Where each fact lives

| Fact | Home | Read by |
|---|---|---|
| Who you are | Google, via Firebase Auth | both |
| What you may do here | D1 `app_user.role` | this app |
| What you own, where it is | D1 `work`/`edition`/`copy` | this app |
| Whether *this copy* is read | D1 `user_book` | this app |
| **How that read state was decided** | D1 `user_book.read_state_how` | this app |
| Which book a review is about | Firestore `reviews.workKey` — stamped 2026-08-12 | **both**, and §7.7 cannot work without it |
| Whether the book was any good | Firestore `reviews` | **both** |
| **Whether you mean to read it** | Firestore `readingLists` — the audiobook site's own TBR store, joined 2026-08-17 | **both**; see [`tbr.md`](tbr.md) |
| **What is IN the book** | Firestore `user_content_warnings` — the audiobook site's own warning store, joined 2026-08-17 | **both**; see [`content-warnings.md`](content-warnings.md) |
| The rating, for sorting | D1 `user_book.rating_cached` | this app, never authoritative |

⚠️ **`reviews` is not the only shared collection any more.** The cross-catalog
TBR follows every rule in this document — one store, browser-written, keyed by
`bookIdFromTitle` with a `workKey` added — but its document id is the **reverse
order** of a review's, because that is what the other site already writes.
[`tbr.md`](tbr.md) carries the whole design; §7.7's read-state sweep is what
clears an intention settled by a rating.

⚠️ **And content warnings are the third — with a join this document's mechanism
could NOT supply.** `user_content_warnings` (joined 2026-08-17) follows every
rule here except one: a warning document carries no `workKey`, the other site
will never write one, and both lanes were measured **empty**, so §5's backfill
has nothing to stamp and §6's two-query trick has no second field to ask about.
It joins on `audiobook_holding.title` instead — the other catalog's own spelling
of the title, cached in D1 by migration 0010 — and **27 of 92 matched works
spell it differently enough to matter**. [`content-warnings.md`](content-warnings.md)
§2 carries the whole argument. Do not reach for `workKey` there and assume it
works because it works for reviews.
