# Cross-catalog TBR — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
>
> ## ⚠️ UPDATED 2026-08-26 (later) — THE AUDIT. READ §10.
>
> The owner reported *"not all have sync'd"*. **They had.** §10 carries the
> read-only measurement against the live store and BOTH live D1 instances,
> per person: Samantha's 53 unmatched entries are audiobooks her catalogue holds
> no work for, and **zero** of them is a rung that should have fired and did
> not. What came out of it is a **sentence**, not a matcher.
> ⚠️ §10 also records that `readingLists` now measures **0 uid-less documents**,
> which MEETS §8's removal condition for the whole legacy display-name lane.
>
> Last verified: **2026-08-26** (§9 — the media fold: 31 new tests green, the
> suite at 1,878/0, and BOTH instances re-measured live after the deploy —
> `library.heygabi.ai` and `padhard.heygabi.ai` each 200 with `database: up`
> and each serving the new bundle `assets/index-Cu1y4gWG.js`. ⚠️ **What was
> NOT verified: the signed-in screen.** Nobody has loaded `/tbr` as the owner
> since the change, so the live count and the format links are still his to
> check — §9's own closing note says so, and §7's untested list still stands).
>
> ## ⚠️ UPDATED 2026-08-26 — ONE CARD PER BOOK. READ §9.
>
> The owner reported the list double-counting a book he owns in several media.
> Nothing about the STORE changed — the fold happens on the way out.
>
> §§1–8 were last verified **2026-08-18** and are unchanged; their evidence
> follows. §8 (the account migration): live rules smoked
> 17/17, the migration exercised end to end on the dev lane, prod measured
> before and after. §§1–7 last verified **2026-08-17** against
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

---

### ⚠️ Addendum, 2026-08-18 — the prod move is APPLIED (and one step is blocked)

§8 above was written while the 181-document move was still pending a promote.
It has now run. Recorded here rather than edited in, so the sequence stays
readable.

**The promote succeeded and prod was still serving the old client.** Both were
true at once. `audiobook_catalog`'s Deploy workflow gates `build`+`deploy` on
`lint`, and lint had been red on `main` since that repo's audio 0a/0b commits —
so every deploy since had been *skipped, not run*, and `promote.yml` moved the
`prod` branch and then dispatched a deploy that published nothing. Measured, not
assumed: prod served an 18,970-byte `reviews.js` against 26,161 on disk. Cleared
in `3bdf95a`; prod re-measured at **25,498 bytes with every uid marker** before
anything touched the data.

⚠️ **This is the general lesson, and it is not specific to that repo: a green
promote is not a published site.** Verify the deployed artifact.

**The move:** 181/181, conservation checked against before/after snapshots —
234 → 234 documents, 0 → 181 uid-keyed, **the owner's list identical** (1 title),
all three accounts' `bookId` sets unchanged, 0 doc-id shape mismatches, 53
remaining uid-less and all `status: 'read'`. Live rules re-smoked after the
move: **17/17**.

**What this means for this catalog:** `readingLists` now holds account-keyed
documents in production, so `ownsTbrDoc`'s uid branch is the live path and
`fetchMineFrom`'s `where('uid','==',…)` query is the one that reaches them. The
legacy branch is still load-bearing for **53** documents.

🔴 **The last 53 are decided but NOT yet moved.** The owner ordered them
reassigned to another household account, skipping duplicates;
`audiobook_catalog/scripts/reassign_tbr_owner.py` is dry-run verified (53 to
carry, **0 duplicates**) but ⚠️ **the run is refused by the operating
environment's permission classifier** and was deliberately not forced.

**So the removal condition in §8 is still 53, NOT 0** — do not delete
`legacyReadingListDocId`, the `legacyDocId` field, the `Tbr.tsx` fallback read,
or the uid-less branch of `ownsTbrDoc`. When the reassignment does run, that
becomes reachable — and removing the fallback is then a **separate pass with its
own test sweep**, not part of this one.

⚠️ **Still unwatched:** nobody has loaded either catalog signed in since the
change. The deployed bundle is confirmed to contain the code and the rules are
smoked live, but no one has seen `✓ On my TBR` render against a migrated
document. That remains the highest-value eyeball.

⚠️ **Correction, noted 2026-08-26:** the removal condition above ("still 53,
NOT 0") is **stale**. `audiobook_catalog/site/reviews.js` records that the
owner's reassignment ran and `migrate_tbr_to_uid.py --report` printed **0** on
2026-08-18, and that repo has since **deleted** its whole legacy lane —
`legacyReadingListDocId`, `isUidKeyedListId`, and the display-name branch of
`ownsReadingListDoc` are gone, and so is the legacy rule in `firestore.rules`.
This catalog's `legacyReadingListDocId` / `legacyDocId` / `ownsTbrDoc` uid-less
branch are therefore **dead weight rather than load-bearing**. ⚠️ Removing them
is a **separate pass with its own test sweep**, exactly as this section says —
it was not folded into the 2026-08-26 media-fold work. Re-run the `--report`
command before acting on this note; it is read off the sibling repo's source,
not re-measured against Firestore.

---

## 9. ⚠️ ONE CARD PER BOOK — the media fold, 2026-08-26

The owner, 2026-08-26, verbatim:

> *"for the tbr list, it's double counting if something is owned in multiple
> media sources. So if a book is audio, physical and ebook or any combination we
> need to have it single count with a link to all formats."*

### Why it happened

A `readingLists` document id is `` `${uid}_${bookId}` `` and `bookId` is
`bookIdFromTitle(title)` — **a slug of the title as THAT catalog spells it**
(§1). The audiobook site says *Firefight - The Reckoners, Book 2*; this one says
*Firefight*. One intention, two documents, and every surface that counts
documents counted it twice. Library-written documents carry `workKey` (§3);
audiobook- and ebook-written ones carry **nothing but a slug**.

### ⚠️ FOLDED AT READ TIME, NEVER BY RE-KEYING THE STORE

The obvious fix — make both catalogs write one id — is a **migration of a
persisted key**, and §8 already did one of those. It is also impossible on the
sibling side: that catalog has no author for most rows, so it cannot build the
composite key at all. **The documents stay exactly where they are.**

### The fold key — `tbrFoldKey`, `packages/core/src/tbr.ts`

| # | Key | Reaches |
|---|---|---|
| 1 | the matched **WORK's** `work_key` | anything D1 could resolve, including a sibling-written doc bridged through the holdings |
| 2 | the **DOCUMENT's** own `workKey` | library-written docs for books this catalog no longer holds |
| 3 | `workKeyFor(cleanAudiobookTitle(title), authors)` | a known author with no stored key |
| 4 | the doc's `bookId` — i.e. **no fold** | everything else |

⚠️ **Rung 4 is a REFUSAL, and it is the point.** There is deliberately **no
title-only rung**: `workKeyFor` always joins a folded title to a folded author,
so a key with no `|` is not one of ours and two books called *Gold* are two
books (the same rule `myTbrEntries` already applied). The asymmetry that decides
it: **a fold that is too eager is silent and permanent** — one book disappears
from the list and nothing anywhere says so — while a fold that is too shy leaves
the list slightly long, which is visible and reportable.

⚠️ **No new matcher or normaliser was written.** Every rung is `@lc/core`'s
existing `titles.ts` (`cleanAudiobookTitle`, `workKeyFor`) and `reviews.ts`
(`bookIdFromTitle`). A second similarity function would be a second definition
of "same book", which is the drift `matching.ts` exists to prevent.

### The bridge — a THIRD rung in `resolveTbrEntries` (`packages/db/src/tbr.ts`)

`resolveTbrEntries` had two rungs: the indexed `work_key IN (…)`, then a scan
slugging this catalog's own titles. Both fail on an audiobook-written entry. The
third rung slugs **the sibling catalogs' own spellings**, which this database
already caches:

| Source | Migration | Columns slugged |
|---|---|---|
| `audiobook_holding` (a VIEW, one best row per work) | 0010 → 0390 | `title` |
| `audiobook_edition_holding` (every recording) | 0390 | `title` **and** `raw_title` |
| `ebook_holding` | 0310 | `title` |

⚠️ **It is a THIRD rung, never a replacement.** It is consulted only for entries
the first two both missed, so **nothing that matched before can change** — pinned
by its own test. ⚠️ **Stale rows are excluded**: a recording the sibling catalog
has withdrawn must not merge two live entries, the same rule
`audioEditionCountSql` applies. `matchedVia` (`work_key` / `title_slug` /
`audio_bridge` / `ebook_bridge`) is recorded because a bridge match is a **weaker
claim** — a title match made by another system at another time — and the same
reasoning as `audiobook_holding.matched_via` says to keep it visible.

⚠️ **Both rungs 2 and 3 are conditional full scans**, in that order, each running
only if something is still unmatched. On a list written entirely from this
catalog neither ever runs.

### The formats row

Read off `copy`, `audiobook_holding` and `ebook_holding` for the matched work.
`physical.state` is the **household's** fact, decided by `HELD_STATUSES` and
`WISHLIST_STATUSES` from `@lc/core` rather than a second spelling of them — so
`lent` is owned (the book is ours, elsewhere) and `sold`/`borrowed` are neither.
`owned` beats `wanted` beats `none` when two documents in a group disagree,
because otherwise row order would decide whether the owner is told he owns his
own paperback. `'none'` is a real answer, not a gap: the catalog holds the work
without holding a copy.

⚠️ **Only formats that EXIST are rendered.** *"A link to all formats"* means the
ones he has, not three buttons two of which apologise.

⚠️ **The two off-site links carry the SIBLING catalog's spelling of the title**
(`audiobook_holding.title`, `ebook_holding.title`), not this one's. Both sites'
only per-book link is a title search-hash (`audiobookDetailUrl`,
`ebookShelfUrl`); searching them for this catalog's spelling lands far less
often — the same lesson `DriveLinks` records for Drive file names.

### Removal, and clearing, are by GROUP

**"Off the list" deletes every document in the fold.** The person meant the
book, not one catalog's copy of it, and leaving the other behind would light the
audiobook site's `✓ To Be Read` button for a book they just cleared — the exact
cross-catalog staleness §5 exists to remove. For the same reason `'read'` on
**any** document in a group spends the whole intention: §5's *"finishing one
format clears the intention"*, now that a book is several documents. `dnf` still
does not clear, unchanged and pinned.

The wheel (`TbrSpinner`) gets **one candidate per group**, so a book held in
three formats is no longer three times as likely to win.

### Where the fold is computed — and why it is in two places that cannot drift

`groupTbrEntries` is pure and lives in `@lc/core`. The **Worker** calls it over
the catalog's own answer and returns `groups` (keys, docIds, workId, readState,
formats) — ⚠️ **carrying no titles**, for the reason `TbrEntryRef` carries none:
the titles came from the browser's Firestore read, and a server that echoed them
back would let the page print a string nothing checked. The **page** calls the
same function over those entries merged with its own titles. One implementation,
so the count the route reports and the cards on screen cannot disagree.

### The audiobook side — what it CAN fold, and what it cannot

That repo's surfaces get the best fold available to them client-side:
**`workKey` when the document carries one, else the document's own `bookId`.**
No matcher was invented in JS.

⚠️ **This is materially weaker than the library's, and it is worth knowing
exactly why.** Only library-written documents carry `workKey`; a document that
site wrote has a `bookId` and nothing else. And because the document id is
already `` `${uid}_${bookId}` ``, two documents of one person can never share a
`bookId` — so the `bookId` branch folds nothing that was not already one row.
**The fold there therefore only merges two documents that BOTH carry a
`workKey`** (the same book added from two library-side spellings). ⚠️ **A
paperback entry written here and an audiobook entry written there still count as
two on that site**, because the bridge that joins them is `audiobook_holding` —
a D1 table living in this repo, which that site cannot see. Closing it properly
needs either a `workKey` on the audiobook side's writes or a published
bridge/lookup, and both are separate asks.

### Verified — and what is NOT

- **Tests:** 31 new. 17 pure (`packages/core/test/tbr-fold.test.ts`) and 14
  against real SQL through the `node:sqlite` D1 shim
  (`packages/db/test/tbr-media-fold.test.ts`) — the shipped statements, the
  UNION, and the stale-row guard exercised rather than reasoned about. Suite
  **1,847 → 1,878 pass, 0 fail**; typecheck clean; web build clean.
- **Deployed and re-measured:** `7a99067`, version ids
  `7a3ab743-3c03-42b8-9504-889c9f09b406` (main) and
  `e85b83fc-d2b3-4a9f-b9ec-39ed58c19dac` (friend). Both hosts answered **200**
  and both serve `assets/index-Cu1y4gWG.js` — the artifact, not the pipeline's
  word for it, per §8's addendum.
- 🔴 **NOT verified: the signed-in screen.** Nobody has loaded `/tbr` as the
  owner since the change. The live count, the format links and the *"N entries
  were repeats"* note are all his to check — the build environment cannot hold
  his session. §7's untested list still applies in full.
- **NOT verified: the audiobook site's surfaces in a browser.** Their fold is
  unit-tested and pushed to the `/dev/` lane; nobody has watched a count change
  there. **Prod promote is the owner's action and was not performed.**

---

## 10. ⚠️ THE AUDIT — "not all have sync'd" was the WORDING, not the matching (2026-08-26)

The owner, on his phone, 2026-08-26:

> *"in the tbr list, not all have sync'd — can we audit Diva's; also I don't see
> the tag for what type of media a book is."*

**"Diva" is Divaelf**, the retired v1 passphrase account whose 53 `read`
documents were reassigned to **Samantha Hardman** on 2026-08-18 (`DONE.md`,
`scripts/reassign_tbr_owner.py`). So "Diva's list" is Samantha's, and it belongs
to `padhard.heygabi.ai` / D1 `library-catalog-2nd`.

### How it was measured — and why the answer is trustworthy

Read-only, and through the **shipped code** rather than a re-implementation of
it: the live `readingLists` collection was dumped with the client/auth code from
`audiobook_catalog/scripts/migrate_tbr_to_uid.py` (the read-only precedent), the
six tables `resolveTbrEntries` touches were pulled out of **both** live D1
instances with `wrangler d1 execute --remote` `SELECT`s, loaded into `node:sqlite`
through the same D1 shim `packages/db/test/tbr-media-fold.test.ts` uses, and then
`myTbrEntries` → `resolveTbrEntries` → `groupTbrEntries` were run over them in
the page's own order. Nothing was written to Firestore or to either database.

### The store, 2026-08-26

| | |
|---|---|
| `readingLists` | **555** documents (was 234 on 2026-08-18) |
| `readingLists_dev` | **0** — still never written to |
| uid-less (legacy display-name keyed) | **0** |
| `status: 'tbr'` / `'read'` | **393** / **162** |

🔴 **`0` uid-less confirms §8's removal condition is MET.** `legacyReadingListDocId`,
the `legacyDocId` field on `/api/tbr/:workId/keys`, the fallback read in
`Tbr.tsx` and the uid-less branch of `ownsTbrDoc` are dead weight. Removing them
is still **a separate pass with its own test sweep** — it was not folded into
this one either.

### Per person

| Person | instance | docs | tbr | read | tbr written by the library (`workKey`) | tbr written by a sibling (`bookId` only) |
|---|---|---:|---:|---:|---:|---:|
| **Samantha Hardman ("Diva")** | padhard | 428 | 359 | 69 | **294** | **65** |
| **Skylar (owner)** | main | 52 | 2 | 50 | 2 | 0 |
| Solomon Hardman | padhard | 22 | 22 | 0 | 22 | 0 |
| Jamie Jeremiah Lievertz | ⚠️ no `app_user` row on either instance | 53 | 10 | 43 | 0 | 10 |

⚠️ **Every `read` document in the store was written by a sibling catalogue** —
162 of them, none carrying a `workKey`. This catalogue has never written a
`status: 'read'` reading-list document, and does not: it clears an intention by
DELETING the document (§5), which is why `spentTbrEntries` measured **0** spent
groups for everybody on the day of the audit.

### How each `tbr` entry resolves — the three rungs, measured

| Person | rung 1 `work_key` | rung 2 `title_slug` | rung 3 `audio_bridge` | rung 3 `ebook_bridge` | **unresolved** |
|---|---:|---:|---:|---:|---:|
| Samantha (358 after the pre-resolve dedupe, 1 dropped) | 283 | 15 | **7** | 0 | **53** |
| Owner (2) | 2 | 0 | 0 | 0 | **0** |
| Solomon (22) | 21 | 1 | 0 | 0 | **0** |

### ⚠️ The 53 — and none of them is a matching failure

The 53 unresolved entries ARE "the ones that didn't sync", and every one of them
carries **no `workKey`** (all sibling-written) and matches **no `work.title`, no
fresh `audiobook_holding` / `audiobook_edition_holding` row, and no
`ebook_holding` row** in padhard's database. Cross-checked against the MAIN
instance as well:

| | |
|---|---:|
| absent from **both** library instances entirely | **48** |
| present in the **main** instance's `work` (not hers) | 4 — *Defiant*, *Isles of the Emberdark*, *Unmapped*, *Untapped* |
| present in the **main** instance's `audiobook_holding` (not hers) | 1 — *Fae and Fare - The Wandering Inn, Book 2* |
| a rung that should have fired and did not | **0** |

So: they are audiobooks Samantha put on her list from the audiobook site, for
books **her** catalogue has no row for. The five that the main instance knows
are not a defect either — `padhard` is her own library, and it is not supposed
to hold the owner's books. ⚠️ **`ebook_holding` is EMPTY on padhard (0 rows)**,
so an `ebook_bridge` match is impossible there by construction; the main
instance has 126.

### What the three surfaces count for the same person

| Person | library `/tbr` (folded, this catalogue) | audiobook **prod** at 22:05 UTC | audiobook **prod** after the 22:10 promote | audiobook **`/dev/`** |
|---|---:|---:|---:|---:|
| **Samantha** | **351** cards — 298 on her shelves, **53** *"Not on these shelves"* | **359** (documents — no fold) | **358** | **358** (its own weaker fold) |
| Owner | 2 | 2 | 2 | 2 |
| Solomon | 22 | 22 | 22 | 22 |
| Jamie | n/a — no library account | 10 | 10 | 10 |

⚠️ **THE PROD COLUMN MOVED WHILE THE AUDIT WAS RUNNING, and it is recorded as
two readings rather than overwritten.** At **22:05 UTC** prod's `reviews.js` was
26,521 bytes with **0** occurrences of `foldReadingList` and `/community` was
27,622 with 0 — genuinely unfolded, and counting Samantha's list at 359
documents. A **"Promote to Prod" run completed at 22:10:11 UTC** (`gh` run
`33018518477`, head `6a63710`) — **not by this session, and no promote was
performed here** — and by 22:40 prod served the same 31,504-byte `reviews.js`
and 28,991-byte `/community` the `/dev/` lane had, both with the fold. So prod's
number for Samantha is now **358**, matching `/dev/`.

⚠️ **This is the general lesson §8's addendum already records, from the other
side: a measurement has an age.** The 359 was correct when taken and false forty
minutes later, and the only reason anyone knows is that the artifact was
re-fetched rather than the earlier reading re-quoted.

⚠️ **Prod does NOT carry the 2026-08-26 media tags** — measured after the CI run
landed: prod's `reviews.js` has **0** occurrences of `readingListMediaTags`
against `/dev/`'s 3. That promote is still the owner's action, and none was
performed here.

### The fix this produced — Part B, and it is a SENTENCE

The matching was right and the page was quiet about it. `/tbr` already listed
these entries under *"Not on these shelves"*, but it never said **how many**,
and a card with no format chip on it reads as a book the sync lost. So:

| Where | Change |
|---|---|
| `apps/web/src/lib/tbr-elsewhere.ts` | new — `splitTbrGroupsByShelf` (the `workId === null` predicate, and nothing softer) and `notInCatalogueSentence` |
| `apps/web/src/pages/TbrPage.tsx` | renders the count, and gives every unmatched card **both** sibling links |

⚠️ **The unmatched card's links are SEARCHES, not claims.** `workId === null`
means the catalogue cannot name the format, so the row says *"Look for it on:"*
with 🎧 Audiobooks and 📖 Ebooks, against the matched row's *"You have it:"*.
Both use the existing `audiobookDetailUrl` / `ebookShelfUrl` helpers — a third
URL builder would be a third place for the sibling sites' `#q=` shapes to drift.

⚠️ **The sentence never says "sync", "failed" or "missing"**, and its test
asserts all three absences. Those entries are in the shared store exactly as
recorded; blaming the sync would send the next session hunting a bug that
measured clean.

### The media tag — what the SIBLING side can and cannot do

The second half of the ask ("I don't see the tag for what type of media a book
is") is the audiobook site's, and its answer is in that repo's KI-7. The short
version, because it constrains anything built here later:

- 📕 **Library** is derivable there client-side — only this catalogue writes a
  `workKey`.
- 🎧 **Audiobook** is derivable — the page already holds its own catalogue.
- 📖 **Ebook is NOT.** ⚠️ `site/ebooks.json` is gitignored *and left the
  deployment* by owner directive (*"I don't want people scraping my books"*);
  the manifest is served only behind a Firebase token and the estate's `ebooks`
  grant. Publishing a title list to power a chip would be **access-increasing**,
  so it was not built. 🔴 **The route that closes it is this catalogue writing
  the formats onto the document it already writes** — which is a new field on a
  shared store and therefore its own ask, not a side effect of a chip.

### Verified — and what is NOT

- **Measured 2026-08-26** against the live Firestore collection and both live D1
  instances, through the shipped functions. Read-only throughout.
- **Tests:** 8 new (`apps/web/test/tbr-elsewhere.test.ts`). Suite
  **1,889 → 1,897 pass, 0 fail**; typecheck clean.
- 🔴 **NOT verified: the signed-in screen, still.** Nobody has loaded `/tbr` as
  the owner or as Samantha since the change — §9's closing note stands unchanged,
  and the build environment cannot hold either session.
- **NOT verified: whether the 53 titles exist in the household's audio library
  at all.** The audit proves they are absent from both *library* catalogues; it
  did not ask the audiobook catalogue's own `catalog.csv` about them.

---

## 11. SEARCHING the list, and FILTERING BY it — 2026-08-26

The owner, on his phone, two messages apart:

> *"can we also add a filter in each of the search bars for tbr and other read
> states"*
>
> *"can we also add a search bar in the /tbr route too so people can search tbr
> books there too with the wheel"*

### ⚠️ The vocabulary was MEASURED before anything was built

*"and other read states"* is an open-ended phrase and the store is not. Counted
read-only against the live collection through the audiobook repo's service
account, **2026-08-26 ~15:55 Phoenix**:

| | |
|---|---:|
| `readingLists` documents | **555** |
| `status: 'tbr'` | **393** |
| `status: 'read'` | **162** |
| anything else | **0** |
| `readingLists_dev` | **0** — still never written to |

So the answer is **two**, and `READING_LIST_STATUSES` (`packages/core/src/
constants.ts`) is that reading with its date on it. A test asserts the list is
exactly those two, so a third value cannot arrive without a fresh measurement.

⚠️ **Every one of the 162 `'read'` documents was written by a sibling
catalogue.** This one has never written a `status: 'read'` reading-list
document and does not: it clears an intention by DELETING the document (§5).
That fact is what makes the next section necessary.

### ⚠️ TWO "read" FILTERS ON ONE SCREEN, AND THEY ARE NOT THE SAME QUESTION

The collection page now carries both, side by side:

| Control | Param | Store | Values |
|---|---|---|---|
| **Read** | `?read=` | `user_book.read_state` — this catalogue's own column | `unread` `reading` `read` `dnf` `reference` |
| **My list** | `?list=` | `status` on a `readingLists` document, shared with the audiobook site | `tbr` `read` |

**They disagree for the same book, and both answers are correct.** A book the
owner marked read here has a `user_book` row and no reading-list document at
all; a book he marked read on the audiobook site has a document and may have no
row here. Folding them into one dropdown would make *"Read"* mean whichever
store the last person to touch the code had in mind — the same class of
mistake `ownsTbrDoc` vs `isMyReview` records in `packages/core/src/tbr.ts`, and
recorded here for the same reason.

⚠️ **`?list=` and not `?readState=`**, for two reasons: `?read=` was already
taken by the column filter, and `list` is **the audiobook site's own spelling** —
`#list=tbr&user=…` has worked there for months and now answers `#list=read` too.
One vocabulary across the estate rather than a third, the rule
`READING_LIST_MEDIA` already follows for the format emoji.

### The resolve path — no second store, no second matcher

```
browser reads its own readingLists documents   (myReadingListEntries)
      -> POST /api/tbr/resolve                 (the SAME resolveTbrEntries /tbr uses)
      -> work ids
      -> GET /api/collection?list=tbr&listIds=1,2,3
```

`myTbrEntries` is now `myReadingListEntries(…, 'tbr')` — one ownership rule (the
2026-08-18 account gate), one dedupe, one `bookId` guard between them. **No new
route and no new matcher were added**; the three rungs that place an entry are
the ones §9 describes.

⚠️ **The browser resolves because nothing else can.** The list is in Firestore
and there is no service account anywhere in this project on purpose
(`apps/worker/src/routes/reviews.ts` carries that argument). This is exactly the
shape `universeIds` already had — a set the server cannot derive, resolved by
the caller and handed over as ids — so `universeClause` was renamed
`workIdsClause` and now serves both. Two callers, one clause.

### ⚠️ TWO PARAMS FOR ONE FILTER, and the pair is the design

| Param | Says | Travels in |
|---|---|---|
| `?list=tbr` \| `read` | a reading-list narrowing is IN FORCE | the address bar |
| `?listIds=1,2,3` | the work ids this browser resolved | the API call only |

**The address bar carries the QUESTION, never one person's answer.** A shared
`/?list=tbr` link opens the recipient's OWN list. Putting the ids in the URL
would make a link a snapshot of somebody else's reading list, going stale the
moment they added a book.

🔴 **And the pair is what tells an EMPTY list from an ABSENT one.** `?list=tbr`
with no ids is *"asked, and this catalogue holds none of them"* →
`readingListIds: []` → `0 = 1` → no rows. Read only the ids and an empty TBR
becomes indistinguishable from no filter at all, and the page answers it with
**the entire collection** — which reads as the control being broken rather than
as a filter that found nothing. Both sides of the wire have tests for it
(`collection-reading-list-param.test.ts`, `collection-reading-list.test.ts`),
because no type can catch it: both params are strings.

⚠️ **The facets carry both params** — F3 (2026-08-25) in a new place, and the
worst place for it. A to-read list narrows harder than any other control on the
page, so *"Cradle (6)"* beside it would be six books almost certainly not on the
list. `apps/web/test/facet-list-agreement.test.ts` pins the rule.

### Four ways the grid comes back empty, four sentences

`apps/web/src/lib/reading-list-filter.ts`, following the precedent
`lib/tbr-elsewhere.ts` set: a sentence a person reads is a pure function with
its own tests, so the wording can be argued about in a test file.

| Cause | What happens |
|---|---|
| not signed in | ⚠️ **the control is not rendered at all** — a reading list is attributed by uid ALONE since 2026-08-18, so there is genuinely nothing to filter by, and a control that answers "nothing" to every choice is worse than none |
| session not settled | a worded notice. Firebase publishes a restored session asynchronously (~340 ms, measured on the sibling app) and `ownsTbrDoc` fails CLOSED, so pressing it early is an ordinary race that would otherwise render as an empty list |
| list genuinely empty | says so, and says where a book is added from — the list is written in two places and neither is that screen |
| on the list, not in this catalogue | the COUNT, plus that they are audiobooks or ebooks held elsewhere |
| matched, excluded by another control | `null` — the page's own *"Nothing matches that"* is right again. Blaming the reading list for a Series dropdown would be worse than saying nothing |

⚠️ **None of them says "failed", "missing" or "sync", and the tests assert those
absences.** §10 is why: 53 of Samantha's 358 entries are the fourth row, they
measured completely clean, and the absence was already read once as a sync that
had dropped books.

### The `/tbr` search box — and the wheel

`narrowTbrGroups` (`apps/web/src/lib/tbr-search.ts`) is pure and runs over the
groups the page **already holds** — it fetched every document and resolved them
in one round trip, so there is nothing to fetch and nothing to debounce.

⚠️ **`TbrSpinner` is handed the NARROWED groups.** That is the owner's *"so
people can search tbr books there too with the wheel"*, and it is free: the
spinner already took `groups.map(toSpinnerRow)`, and `groupTbrEntries` had
already made that one candidate per BOOK (§9), so narrowing cannot reintroduce
the double count the fold removed. The wheel is not drawn at all over an empty
pool — a control that cannot work.

⚠️ **The *"Not on these shelves"* half narrows with the same query**, count
included. Filtering one half and leaving the other at full length would read as
the search being broken, and that section is the one already misread once.

⚠️ **It matches EVERY spelling the group was recorded under**, not just the one
on the card: a group folded from a paperback entry and an audiobook entry
carries *Firefight* and *Firefight - The Reckoners, Book 2*, and somebody typing
"reckoners" means that book. **Folding the MATCH set would HIDE a book** — the
same rule the audiobook site's `matchTitles` states in its own comment, and a
different and worse bug than showing one twice. The series is in the haystack
too, for the reason the collection's `?q=` searches `w.series`.

⚠️ **It is NOT a matcher, and it deliberately does not use `normaliseTitle`.**
That function builds a piece of a PERSISTED KEY (`work_key`, Firestore document
ids), so changing it is a migration rather than an edit — and a search box is
exactly the caller that later wants one more small tweak to how it folds.
Keeping them apart is what stops a tweak to the search bar becoming a silent
change to how two books are decided to be one.

⚠️ **The query is not in the URL**, unlike the collection's `?q=`. This screen is
a view of one person's own list, read from their Firebase session;
`/tbr?q=sanderson` would open a stranger's list narrowed by a word they never
typed. The collection's box is shareable because the collection is the same for
everybody.

### The audiobook side

`/dev/` lane only; no promote was performed.

- **My Read List** beside **My TBR List** in the same search-bar dropdown, and
  `#list=read&user=…` beside `#list=tbr&user=…`.
- The key → status mapping lives **once**, in `readingListStatusFor`
  (`site/reviews.js`). The hash reader's old inline `listType === 'tbr'` was the
  third copy of it and is gone.
- ⚠️ An unknown list name gets a **sentence**, not a blank catalogue, and
  `readingListStatusFor` refuses to default to `'tbr'`: a typo in a deep link
  showing the wrong list silently is the class of wrong that looks right.
- ⚠️ A module that will not load is worded as an **OUTAGE**, distinct from the
  three empty-list sentences that were already there.
- ⚠️ `site/index.html` is a **rendered artifact**; the template edit was
  re-rendered with `python -m app.tools.rebuild_site_html` and the diff is 93
  lines with no catalogue churn (`docs/info/gotchas.md` in that repo).

### Verified — and what is NOT

- **Tests:** 64 new here (10 pure, 10 real SQL through the `node:sqlite` D1
  shim, 11 on the Worker's two-param reader, 33 on the two web modules). Suite
  **1,897 → 1,961 pass, 0 fail**, and **1,979 / 0** after rebasing onto the
  concurrent #348 work. Typecheck clean, web build clean. Audiobook: 9 new,
  vitest **765 → 774**; pytest 1,825 pass with the same 2 pre-existing
  `test_universes.py` failures this repo's other 2026-08-26 entries record.
- 🔴 **NOT verified: the signed-in screen, still.** Nobody has loaded the
  collection or `/tbr` as the owner or as Samantha. The control is only rendered
  for a session with a uid, so the *whole* filter is in the half of this feature
  the build environment cannot reach — §9 and §10 left the same gap and it is
  now the highest-value eyeball by some distance.
- **NOT verified: the audiobook site's dropdown in a browser.** The mapping and
  the vocabulary are unit-tested and the rendered artifact was grepped for the
  new option; nobody has watched a `#list=read` link resolve with a session.
