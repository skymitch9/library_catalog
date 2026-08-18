# Cross-catalog TBR — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-18** (§8 — the account migration: live rules smoked
> 17/17, the migration exercised end to end on the dev lane, prod measured
> before and after). §§1–7 last verified **2026-08-17** against
> `audiobook_catalog` at that date —
> `app/web/templates/index.html` (the TBR button and the reading-list filter),
> `site/community.html` (the per-person TBR count) and `firestore.rules`
> (`validReadingList`, `/readingLists`, `/readingLists_dev`) were read line by
> line — and **exercised live the same day**, signed in on
> `library.heygabi.ai`: an entry recorded on the audiobook site appeared here,
> and a book marked read from an audiobook rating had its entry cleared. §7
> carries the evidence and the four things still untested.
>
> **Updated later the same day:** §6 is no longer a gap. The audiobook-side
> instant clear it specified was approved and BUILT — `audiobook_catalog`
> `2ff816f`, live on that site's `/dev/` lane (`/dev/reviews.js` fetched and
> read, 2026-08-17), prod promote pending. §6 now describes the mechanism;
> §7 says what about it is still unwatched.
>
> ## ⚠️ UPDATED 2026-08-18 — THE DOCUMENT ID CHANGED. READ §8 FIRST.
>
> The owner ordered *"Make tbr keyed to account"*. The id is now
> `` `${uid}_${bookId}` ``, not `` `${displayNameLower}_${bookId}` ``.
>
> **Three statements below are SUPERSEDED and are kept only so nobody
> re-derives them from scratch:**
>
> | Section | Said | Now |
> |---|---|---|
> | §1 table | id is `{displayNameLower}_{bookId}` | `{uid}_{bookId}` |
> | §1 "No rules change was needed" | tightening `readingLists` would strand legacy sessions | half right — the rules DID change, and the legacy lane was kept open precisely so nothing was stranded |
> | §2 "neither may be harmonised" | the id can never change | the ORDER never changed; the left-hand half did, via a migration |
>
> §2 was right that changing a persisted key orphans documents, and wrong
> that this made the key permanent. The answer was to **migrate** them.

The owner's ask, 2026-08-16:

> *"tbr like read should span all catalogs"*

and, the same evening, the scope:

> *"lets not make a to play list, most people except weirdos like me buy games
> they arent going to immediatly play where as books can stack up."*

So a TBR spans **audiobooks + ebooks + physical books**, and never games. An
unplayed game on a shelf is ordinary ownership; an unread book on a list is an
intention. If games ever want one, that is a new ask, not this feature grown
sideways.

---

## 1. ⚠️ The store already existed. Finding it is what made this small

The design discussion in `TODO.md` assumed a TBR would have to be **built**, and
weighed a per-user Firestore collection with per-user rules. It did not need to
be. `audiobook_catalog/app/web/templates/index.html` has had a per-person TBR
button for a long time:

| | |
|---|---|
| collection | `readingLists` (prod) / `readingLists_dev` (dev lane, via `col()`) |
| document id | ⚠️ `` `${uid}_${bookId}` `` since 2026-08-18 — see §8. Was `` `${displayName.toLowerCase()}_${bookId}` ``, and 53 documents still are |
| `bookId` | `bookIdFromTitle(title)` — the same slug the review store uses |
| fields | `displayName, uid, bookId, bookTitle, bookCover, status: 'tbr', addedAt` |
| readers | that site's own "Reading lists" filter, and `site/community.html`'s per-person TBR count |

So this catalog did what `identity-and-reviews.md` §3 did for reviews: **joined
the existing store and added fields to it**, rather than inventing a second one.
One store cannot diverge from itself. The consequence is the feature working in
both directions on day one — a book added on the audiobook site appears in the
library's My TBR, and clearing it here turns that site's `✓ To Be Read` button
back into `📋 Add to TBR`.

### ⚠️ The cover has to be an ABSOLUTE url, and that is not obvious

`work.cover_url` in this catalog is usually a site-relative path
(`/covers/killer-s-mind-….jpg`, an asset this Worker serves). Written straight
into a document the **other** site reads, that path would resolve against
*their* host and 404. Nothing over there renders `bookCover` today — it writes
the field and never reads it back, measured 2026-08-17 — so `absoluteCoverUrl`
closes a trap before it is sprung rather than fixing a live bug.

It resolves against the **request's own origin** rather than a configured host,
which is what makes one bundle correct on both instances: `library.heygabi.ai`
stamps its own covers, `padhard.heygabi.ai` stamps hers. Absolute,
protocol-relative and `data:` values are passed through untouched, and anything
unresolvable becomes `null` — a coverless entry is honest, a broken one is not.

### ⚠️ No rules change was needed, and that is deliberate — SUPERSEDED 2026-08-18, see §8

`validReadingList()` asserts `displayName`, `bookId` and `status` are strings
and ignores unknown fields, exactly as `validReview()` does. `workKey`, `email`
and `source` ride along untouched. This matters for the same reason it did on
2026-08-09: **a rules deploy changes the audiobook site's security posture**,
and a to-read list is not worth one.

The brief for this build authorised a minimal, additive per-user rule if one
were needed. It was not, and adding one would have been worse than nothing: the
file's own header says reviews, club content, **TBR**, progress and profiles
"are MEANT to be writable by anyone who can load the page — including legacy v1
sessions and server-side tools… Do not 'fix' that openness." Tightening
`readingLists` from this repo would have broken the audiobook site's own button
for anyone on a legacy session.

---

## 2. ⚠️ The document id is REVERSED compared with a review's

```
review        `${bookId}_${displayNameLower}`      site/reviews.js
reading list  `${uid}_${bookId}`                   app/web/templates/index.html
```

The **order** is still reversed and still must not be harmonised: building one
with the other's order files a second document beside somebody's real entry, and
their button would disagree with this catalog forever.
`packages/core/test/tbr.test.ts` asserts the two orders differ, so a well-meaning
tidy-up fails a test instead of shipping.

⚠️ **What DID change, 2026-08-18: the left-hand half.** This section used to say
the id could *never* change because it is the identity of documents that already
exist. That reasoning was sound and its conclusion was wrong — the answer to
"changing the key orphans the documents" is to **move the documents**, which is
a migration and is exactly what happened. See §8.

---

## 3. Two keys, again — and this is why the identity key had to be theirs

`bookId` is a slug of the **title alone**, so `Firefight - The Reckoners, Book 2`
and the paperback `Firefight` never meet, and two books called "Gold" collide.
Everything `identity-and-reviews.md` §4 says applies unchanged.

So an entry this catalog writes carries **both**: `bookId` (their key, and the
document id) and `workKey` = `normaliseTitle(cleanTitle)|normaliseTitle(author)`
(the key that spans). `POST /api/tbr/resolve` matches on `workKey` first and
falls back to `bookIdFromTitle(work.title)` — the same weak fallback
`fetchReviews` uses, and just as weak.

⚠️ **An entry written on the audiobook site has only a `bookId`**, so it usually
matches nothing here. That is the ordinary case, not a failure: the household
owns ~1,075 audiobooks against a few hundred works in this catalog. The My TBR
screen shows those entries in a second group, says they are not on these
shelves, and links out to the audiobook site — hiding them would make a
cross-catalog list look complete while showing a fraction of itself.

---

## 4. The decision: a flag in the shared store, NOT a state in a ladder

`TODO.md` asked whether "read", wishlist and TBR are three names for one
per-person state machine (want → have → reading → read), and asked for the
smallest thing that satisfies "a TBR that spans and clears".

**Decided: TBR stays its own per-person fact, in Firestore. No new D1 column, no
migration, no fifth `read_state`.** The reasoning, in the order it decided the
question:

1. **A ladder state in `user_book` could not span.** `read_state` is this
   catalog's table; a want recorded there is invisible to the audiobook site,
   which is the entire requirement. The only per-person store both catalogs can
   see is Firestore — the same conclusion reviews reached.
2. **The ladder already exists across three stores, under three names**, and
   they are genuinely different facts:

   | Rung | Where it lives | Whose fact |
   |---|---|---|
   | want to READ it | Firestore `readingLists` | the person, across catalogs |
   | want to OWN it | D1 `copy.status = 'wanted'` | the household — a wish is about a *copy* (`completeness-wishlist-relations.md` §1) |
   | reading / read | D1 `user_book.read_state` | the person, this catalog |

   Folding them into one enum would have to answer "does wanting the hardcover
   of a book I have read put it back on my TBR?" — and the honest answer is that
   those are two different sentences about two different objects.
3. **`read_state_how` would have been muddied.** That column records whether a
   *person* or a *rating* decided the state (migration 0070), and a TBR value
   arriving through the same enum would need a fourth `how` nobody asked for.
4. **It is smaller.** The whole feature is one Firestore collection this estate
   already writes, two read-only endpoints and a button.

---

## 5. How clearing works, end to end

> *"finishing one format clears the intention"* — one intention per **person
> per work**, however many formats the household holds.

There are two clearing paths and neither is a duplicate of the other:

| Path | Where | Fires when |
|---|---|---|
| **Per book** | `components/Tbr.tsx` on the work page | the work's read state is `'read'` when the panel loads — so it catches a press of the Read chip, a state set on an earlier visit, and one derived from a rating |
| **The list** | `pages/TbrPage.tsx` on open | `POST /api/tbr/resolve` reports the read state of every entry; `spentTbrEntries` selects the finished ones and they are **deleted, not hidden** |

⚠️ **A rating written on the AUDIOBOOK site reaches this through two steps that
already existed**, which is why no audiobook-side code changed:

```
rating on the audiobook site
  → Firestore `reviews` document
  → the collection page's sweep (lib/read-sync.ts → POST /api/reviews/observed)
      marks the work read in D1, per identity-and-reviews.md §7.7
  → next open of My TBR (or of that book): the entry is deleted
```

The library is the only side that has a read state at all, so it is the only
side that can retire an intention. See §6 for the one gap this leaves.

⚠️ **Only `'read'` clears.** `dnf` and `reference` deliberately do not: a
did-not-finish is a *more specific* truth than "done with it" — the same reading
`deriveReadState`'s precedence rule 5 applies — and somebody who has genuinely
given up presses **Off the list**. `reading` obviously stays.

---

## 6. The audiobook-side hook — BUILT 2026-08-17

**The gap this section used to describe:** rating a book on the audiobook site
did not clear that site's own `✓ To Be Read` button *at that moment*. It cleared
when the person next opened the library (§5), and in between the audiobook site
showed a book on their TBR that they had just rated.

It was left because it is a **product decision, not a repair** — rating a book
you are halfway through drops it off your list — and because the button lives in
a generated file in another repo. The owner approved it on 2026-08-17 (*"Do 8,
promote heart thing"*), and it landed as `audiobook_catalog` commit **`2ff816f`**
on `main`.

**What it does now**, in the one place every rating surface already went
through:

```js
// site/reviews.js — called from submitReview's SUCCESS path only
export async function clearTbrForRating(db, bookId, displayName) {
  const docId = `${(displayName || '').toLowerCase()}_${bookId}`;
  try {
    await deleteDoc(doc(db, col('readingLists'), docId));
    return { cleared: true };
  } catch (e) {
    return { cleared: false, error: describeActionError(e) };
  }
}
```

That is the **same delete the button's own toggle performs**, against the same
lane-suffixed collection — so the button falls back to `📋 Add to TBR` rather
than being separately talked into looking unset. The flip needed no new wiring:
`app/web/templates/index.html` already re-rendered the reading-list button after
a successful review, and that call is now load-bearing and carries a comment
saying so. Because the delete sits in `submitReview`, the club rating surfaces
(`club.html`, `club-read.html`) get it too, and get it identically.

⚠️ Three things it must not do, all three now pinned by tests: build the id with
the review order (`${bookId}_${name}` — see §2; a decoy document seeded at the
wrong key must survive a rating, and reversing the order fails six of ten
cases); delete on a *failed* review write; or fail a saved review because the
delete was refused — `clearTbrForRating` swallows its own error and describes it
in words. Firing on a rating **edit** is fine and deliberate: deleting an absent
document is a no-op, so re-running is harmless.

No `firestore.rules` change was needed, for the reason §1 gives.

---

## 7. Verified live — and what still is not

### Measured 2026-08-17, signed in as the owner on `library.heygabi.ai`

Shipped and verified are tracked separately, per item. These were exercised in a
real signed-in browser against the **live `readingLists` collection**, not
reasoned about:

| Claim | Evidence |
|---|---|
| **A TBR recorded on the audiobook site shows up here** | `/tbr` opened with *"Rise of the Living Forge - A LitRPG Adventure"* already on it — a document this catalog never wrote — filed under **Not on these shelves** with the link out, because the library holds no copy of it |
| Adding from a book page writes the document | *A Killer's Mind* (#84): the button flipped to **✓ On my TBR** and the book appeared on `/tbr` with its cover, author and series index |
| ⚠️ **Finishing clears the intention, across catalogs** | *Adventures in the Argo* (#78) is marked read **from an audiobook rating** (the page says so). Adding it to the TBR and reloading deleted the entry and printed *"Taken off your TBR — you have read it."* That is the whole cross-catalog path: rating on the other site → read state here → intention retired |
| Removing works from the list screen | **Off the list** removed the test entry; the pre-existing audiobook one was left untouched |
| The nav chip and the route | **My TBR** renders in the top bar; `/tbr` is a real address |

⚠️ **The test data was cleaned up.** Both entries this verification created were
removed; the owner's own pre-existing entry was not touched.

### Still NOT verified

- **The second instance (`padhard.heygabi.ai`) has not been exercised
  signed-in.** Its bundle is confirmed live and identical (same asset hash), and
  it shares the Firebase project and `ENVIRONMENT = "production"`
  (`apps/worker/wrangler.toml`), so it writes the same collection under her own
  email — but that is inference from configuration plus a bundle check, not a
  round trip performed as her.
- **The audiobook site's own view of a clear has not been looked at.** Deleting
  the document is the same delete its toggle performs, so its button must fall
  back to `📋 Add to TBR` — but nobody has loaded that page to watch it happen.
  ⚠️ **This now covers §6's instant clear as well**, and it is the one thing
  that build could not verify: rating a book signed-in and watching the button
  change at that moment needs the owner's own session. Everything either side of
  it was verified — the target document, the id order, the lane, the failure
  modes (ten unit cases, watched failing on a deliberate mutation), and the
  shipped code's presence in the audiobook site's `/dev/` bundle.
- **No `bookCover` written by the audiobook site has rendered here.** The one
  entry that came from there has no cover on the document, so the placeholder
  drew instead — which is itself the correct behaviour, just not a test of
  `resolveAudiobookCover`.
- **`readingLists_dev` has never held a document.** The rules block exists and
  mirrors prod; nothing has written to it.
- **Nobody without `trackReading` has visited.** The chip is hidden and `/tbr`
  answers "Not a page" for them by the same guard `/export` uses; that path was
  read, not exercised.

---

## 8. ⚠️ The TBR is keyed to the ACCOUNT — 2026-08-18

The owner, in answer to the measured finding that a shared display name means a
shared list:

> *"Make tbr keyed to account"*

### What was wrong

```
readingLists/{displayNameLower}_{bookId}
```

A display name is a string anybody can choose. Two members who pick the same one
had **one document per book between them**: each saw the other's intentions on
their own list, each could delete the other's, and nothing could tell them apart.
`audiobook_catalog/firestore.rules` says so in its own header — *"no rule can
bind a display name to a person"* — so this was never fixable with a rule. The
key had to move, and moving a persisted key is a **migration**.

```
readingLists/{uid}_{bookId}      + a `uid` field
```

That id is `positionDocId` in `audiobook_catalog/site/reading-position.js`
verbatim — the estate's uid-keyed precedent. No second idiom was invented.

### ⚠️ The measurement that changed the design

Taken live, 2026-08-18, before anything was written:

| | |
|---|---|
| `readingLists` | **234** documents |
| `readingLists_dev` | **0** — the dev lane has never held one |
| migratable (name resolves to exactly one account) | **181** |
| ambiguous (two accounts, one name) | **0** |
| **unmappable** | **53** |
| already account-keyed | 0 |

**The 53 are one retired v1 passphrase account** (`users/…`, no Firebase
identity at all). The migration **refuses to guess an owner** — a wrong guess
puts somebody's reading list on another person's screen forever, and is
invisible afterwards. They stay under the old id, and every one of them is
`status: 'read'` rather than `'tbr'`, so **no live to-read entry was left
behind**.

### ⚠️ What actually maps a name to an account — and what does NOT

The obvious candidates all fail, so they are written down here rather than
re-tried:

| Store | Result |
|---|---|
| `reviews` | 884 documents, **zero** carry an `authorUid` |
| `user_content_warnings` (+`_dev`) | empty, both lanes |
| `profiles` | ⚠️ the **doc id is the display NAME**, not a uid |
| `site_roles` | ✅ doc id **is** the uid, and it carries a `displayName` |
| Firebase Auth | ✅ the authoritative account list |

### ⚠️ One collection, TWO models — told apart by the shape of the id

`firestore.rules` now runs both at once. A **28-character alphanumeric** id head
is an account; anything else is a legacy display name.

| Lane | Write / delete |
|---|---|
| account-keyed | **owner only** — the id head must be the caller's uid, *and* the `uid` field must name the same account. Either half alone is a hole. |
| legacy | shape-only, exactly as before — or those 53 become unreachable to the only person entitled to them |

**Reads stay world-open**, deliberately and unchanged: three surfaces list this
collection (this catalog's My TBR, the audiobook site's Reading-lists filter,
`community.html`'s per-person counts). The order was to key the list to an
account, and that is what fixes the reported bug — attribution is now exact, so
a name-sharer's entries no longer land on your list and cannot be deleted by
them. Making the collection unlistable is a larger, separate change.

The predicate lives in three places and **they must agree**:
`tbrIdIsUidKeyed` (firestore.rules), `isUidKeyedListId`
(`audiobook_catalog/site/reviews.js`), and the 28-character constant in
`migrate_tbr_to_uid.py`.

### This catalog's side

| File | Change |
|---|---|
| `packages/core/src/tbr.ts` | `readingListDocId(uid, bookId)`; `legacyReadingListDocId` added (read-only); `tbrDocFor` **requires** a `uid` and throws without one; **`ownsTbrDoc`** replaces `isMyReview` as the TBR ownership rule |
| `apps/worker/src/routes/tbr.ts` | `uid` off the **verified token** (`user.firebaseUid`), never the body; `legacyDocId` rides along read-only; a uid-less account gets a worded `held`, not a 500 |
| `apps/web/src/lib/reviews.ts` | `fetchMineFrom` gained a `where('uid','==',…)` query |
| `apps/web/src/pages/TbrPage.tsx` | passes `currentUid()` — the live session, the same value the rules compare |
| `apps/web/src/components/Tbr.tsx` | reads the account id, falls back to the legacy one, and deletes **whichever holds it** |

⚠️ **`ownsTbrDoc` is NOT `isMyReview` and they are not interchangeable.** Reviews
have no account key to prefer (884 documents, zero uids), so that store still
uses the weak one. Applying the name fallback to an account-keyed TBR document
would undo the whole migration while every other test still passed — pinned by
its own test.

### Removal condition for the legacy fallback

Not "when it feels safe" — a number, from one command:

```bash
python scripts/migrate_tbr_to_uid.py --report   # in audiobook_catalog
```

When *uid-less documents remaining* prints **0**, delete
`legacyReadingListDocId`, the `legacyDocId` field, the fallback read in
`Tbr.tsx`, and the uid-less branch of `ownsTbrDoc`.

### Verified

- **Live rules smoke: 17/17** (`scripts/smoke_reading_list_rules.py`), asserting
  both lanes — that another account cannot overwrite or delete your entry, that
  the id and the `uid` field must agree, and that the legacy lane still works.
- **Migration exercised end to end** on the dev lane against a replica of the
  owner's real documents: 51/51 moved, his list **identical before and after**
  (1 title, *Rise of the Living Forge*), prod untouched (234 documents, 0 uids).
- Tests: audiobook 1,247 pytest + 712 vitest; library 1,178.

### ⚠️ NOT done, and deliberately

- **The 181-document prod move has NOT been applied.** It rides the audiobook
  site's next promote, with the code that reads it. Applying it first would
  leave the live site's per-book button reading an id that no longer exists.
- **Browsing ANOTHER person's list is still name-addressed** (the audiobook
  community page links by name, and nothing listable maps a name to an account).
  That is a public read-only view of a world-readable collection: two
  name-sharers' *public* lists read as one, but neither can write or delete the
  other's. Closing it needs a listable name→account directory — a separate ask.
- Nobody has exercised the signed-in flow in a browser on either instance since
  the change; §7's untested list still applies.
