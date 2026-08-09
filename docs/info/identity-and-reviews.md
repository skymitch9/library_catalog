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

## 7. Where each fact lives

| Fact | Home | Read by |
|---|---|---|
| Who you are | Google, via Firebase Auth | both |
| What you may do here | D1 `app_user.role` | this app |
| What you own, where it is | D1 `work`/`edition`/`copy` | this app |
| Whether *this copy* is read | D1 `user_book` | this app |
| Whether the book was any good | Firestore `reviews` | **both** |
| The rating, for sorting | D1 `user_book.rating_cached` | this app, never authoritative |
