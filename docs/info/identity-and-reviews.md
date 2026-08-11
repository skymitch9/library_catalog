# Identity & Reviews — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-09** against `audiobook_catalog` at that date —
> `site/identity.js`, `site/reviews.js`, `site/fb-env.js` and `firestore.rules`
> were read, and the backfill was dry-run against the live `reviews` collection
> (860 documents). What has **not** been verified: nothing here has run against
> a deployed library catalog, because there is not one yet.

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

### No service account exists, deliberately

The browser writes the document with the signed-in user's own credentials. A
Firebase service account would bypass `firestore.rules` entirely, and putting the
most powerful credential in the household behind the least important endpoint is
a bad trade. The Worker's job is to *derive the keys*
(`POST /api/reviews/:id/draft`), not to hold a key.

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

### 7.6 Running the review-key backfill would improve this

`scripts/backfill-review-keys.mjs --commit` has still never been run. Doing so
stamps `workKey` **and** `source: 'audio'` onto all 869, after which the browser
path gets the audio signal from the field instead of by inference, and
`fetchReviews` can eventually drop its legacy `bookId` query (§6). The two
backfills are independent and may run in either order.

## 8. Where each fact lives

| Fact | Home | Read by |
|---|---|---|
| Who you are | Google, via Firebase Auth | both |
| What you may do here | D1 `app_user.role` | this app |
| What you own, where it is | D1 `work`/`edition`/`copy` | this app |
| Whether *this copy* is read | D1 `user_book` | this app |
| **How that read state was decided** | D1 `user_book.read_state_how` | this app |
| Whether the book was any good | Firestore `reviews` | **both** |
| The rating, for sorting | D1 `user_book.rating_cached` | this app, never authoritative |
