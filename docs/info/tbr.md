# Cross-catalog TBR — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** against `audiobook_catalog` at that date —
> `app/web/templates/index.html` (the TBR button and the reading-list filter),
> `site/community.html` (the per-person TBR count) and `firestore.rules`
> (`validReadingList`, `/readingLists`, `/readingLists_dev`) were read line by
> line — and **exercised live the same day**, signed in on
> `library.heygabi.ai`: an entry recorded on the audiobook site appeared here,
> and a book marked read from an audiobook rating had its entry cleared. §7
> carries the evidence and the four things still untested.

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
| document id | `` `${displayName.toLowerCase()}_${bookId}` `` |
| `bookId` | `bookIdFromTitle(title)` — the same slug the review store uses |
| fields | `displayName, bookId, bookTitle, bookCover, status: 'tbr', addedAt` |
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

### ⚠️ No rules change was needed, and that is deliberate

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
reading list  `${displayNameLower}_${bookId}`      app/web/templates/index.html
```

Both are ported verbatim into `packages/core` (`reviewDocId`,
`readingListDocId`) and **neither may be harmonised**. The id is the identity of
documents that already exist in production; building one with the other's order
files a second document beside somebody's real entry, and their button would
disagree with this catalog forever. `packages/core/test/tbr.test.ts` asserts the
two orders differ, so a well-meaning tidy-up fails a test instead of shipping.

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

## 6. What is NOT built — the audiobook-side hook, with its exact spec

**The gap:** rating a book on the audiobook site does not clear that site's own
`✓ To Be Read` button *at that moment*. It clears when the person next opens the
library (§5). Between the two, the audiobook site shows a book on their TBR that
they have just rated.

**Why it was left:** the change is small in lines and not small to ship.

1. The button lives in `app/web/templates/index.html`, and `site/index.html` is
   **generated** from it — the change only reaches production through that
   repo's build pipeline and its own promote, which this build was scoped away
   from ("touch NOTHING else in the audiobook repo").
2. It is a **product decision, not a repair**: rating a book you are halfway
   through would silently drop it off your list. That is the owner's call.

**The spec, for the day it is wanted** (≈10 lines, in `site/reviews.js`'s
`submitReview` or beside `renderReadingListButtons`):

```js
// After a successful review write, retire the intention it settles.
const { deleteDoc, doc } = await import('…/firebase-firestore.js');
const listId = `${session.displayName.toLowerCase()}_${bookIdFromTitle(title)}`;
try { await deleteDoc(doc(db, col('readingLists'), listId)); } catch (e) { /* non-fatal */ }
```

⚠️ Three things it must not do: build the id with the review order
(`${bookId}_${name}` — see §2); delete on a *failed* review write; or fire on a
rating edit that was already counted (a delete of an absent document is a no-op,
so re-running is harmless).

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
- **No `bookCover` written by the audiobook site has rendered here.** The one
  entry that came from there has no cover on the document, so the placeholder
  drew instead — which is itself the correct behaviour, just not a test of
  `resolveAudiobookCover`.
- **`readingLists_dev` has never held a document.** The rules block exists and
  mirrors prod; nothing has written to it.
- **Nobody without `trackReading` has visited.** The chip is hidden and `/tbr`
  answers "Not a page" for them by the same guard `/export` uses; that path was
  read, not exercised.
