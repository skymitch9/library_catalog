# Series completeness, the wishlist & related books — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10**.
>
> Every figure below is a **measured run on that date** against the local D1
> (115 works; production held 117 at the same moment, differing by two
> hand-added test rows) and against `audiobook_catalog/site/catalog.csv`
> (1,075 rows). Nothing here is an estimate.
>
> **Not verified:** none of this has run against production. Migrations 0003 and
> 0004 are applied **locally only**. See `docs/HANDOFF.md` for the pending
> commands.

Three features built on `feature/completeness-wishlist-relations`, bringing this
app closer to the Board Game Catalog's feature set. They share one theme, which
is worth stating before the details: **each of them can only be built honestly by
being precise about what is known and what is merely assumed.**

---

## 1. Series completeness — "what am I missing"

### 1.1 ⚠️ The three sentences, and which of them are free

| Sentence | Needs | Can it be wrong? |
|---|---|---|
| "You own Cradle 1, 2 and 4 — 3 is missing" | nothing | **No.** |
| "You own High School DxD 7–21 — 1–6 are missing" | nothing | **No.** A book 7 implies a book 1. |
| "You own 6 of 12" | an external source | **Yes**, catastrophically. |

`packages/core/src/completeness.ts` computes the first two and refuses the third
unless something attested it. Even then the claim it supports is a **lower
bound** — "of at least 16", never "of 16". A total may only ever be typed by a
person, with a source, and the API refuses the number without one.

**"We stop at book 13" is not "book 13 is missing."** The gap scan therefore ends
at the highest volume *we own* unless a source names a higher one, and
`openEnded` says out loud that we do not know whether the line continues.

### 1.2 The four verdicts on a missing volume

| Verdict | Meaning | Strength |
|---|---|---|
| `interior` | between two volumes we own | arithmetic |
| `earlier` | below the lowest we own | arithmetic |
| `attested` | a source names this exact volume | as good as the source |
| `implied` | not named, but below a volume a source names | the source, one step further |

`implied` exists because of a real row. The audiobook catalog lists **Legion book
4** — *The Many Lives of Stephen Leeds*, the omnibus — and says nothing about
book 3, which is *Lies of the Beholder*. Reporting 4 and skipping 3 would be
absurd; conflating them would claim a title we do not have.

### 1.3 What the collection actually looks like — measured

25 series, 115 works, 101 with a series, 91 with a volume number.

| | |
|---|---|
| Series with at least one gap | **15 of 25** |
| Gaps that are **certain** (interior + earlier) | **76** |
| Gaps that rest on a source (attested + implied) | **12** |
| Series with an unbroken run and no gap at all | **10** |
| Works in no series at all | **14** |

Of the 76 certain gaps, only **7 are interior** — holes inside a run — and they
sit in exactly two series:

* **Beneath the Dragoneye Moons** — own 1–6, 9, 10, 12, 13; missing **7, 8, 11**.
* **He Who Fights with Monsters** — own 2, 3, 5, 6, 10; missing **4, 7, 8, 9**.

The other 69 are `earlier`: volumes below the lowest owned. They are dominated by
a handful of series bought from the middle — LifeChange (own book 20 alone, so 19
earlier), Completionist Chronicles (own 12–14, so 11 earlier),
Rise of the Weakest Summoner (own 11, so 10 earlier), High School DxD (own 7–21,
so 6 earlier), Tamer (own 7–11, so 6 earlier).

⚠️ **The interior/earlier split is the number worth quoting.** "76 missing books"
is true and useless; "7 holes inside runs you own, and 69 volumes you never
started from the beginning" is the same data and an actionable one.

### 1.4 The one external source that works, and its measured yield

`npm run backfill:series-volumes` reads `audiobook_catalog/site/catalog.csv` —
1,075 rows, 331 curated series — and matches on `normaliseTitle`, the project's
one fold ("All The Skills" here, "All the Skills" there).

| | |
|---|---|
| Our series the sibling catalog knows | **12 of 25** |
| Our series it has never heard of | **13** — written as `not_found`, not left silent |
| Attested volumes recorded | **61**, across 12 series |

Series where it adds something **above** our top: Beneath the Dragoneye Moons
(+3), He Who Fights with Monsters (+2), The Divine Dungeon (+4), Legion (+2),
All The Skills (+1).

Series where its highest volume is **below** ours — Arcane Pathfinder, Space
Knight, The Completionist Chronicles. That is not an error and not a gap; the
script prints it as a warning because a source topping out below the shelf is
also the shape of a bad name match, and the two need telling apart by eye.

### 1.5 Sources that cannot fire here, and why

| Source | Why not |
|---|---|
| Open Library `/works/<key>/editions.json` | It is the right endpoint (`covers-and-series.md` §3.1 — 12 of 24 series gaps came from it), but **no work in this catalog has an `openlibrary_work_id`**. `series_volume.source` already allows `'openlibrary'` so the importer that fills that column needs no migration. |
| Open Library `search.json` | `series` is empty on it for all 37 rows tested. Reading it is the wrong-endpoint mistake. |
| Google Books | 40 of 40 calls returned HTTP 429 anonymously (`isbn-ladder.md` §4.1). |
| ISBN lookups | 0 ISBNs in this catalog. |

⚠️ **A blank in the audiobook catalog is not "no series".** Its curation is
incomplete — it stops at *Invent* (Completionist Chronicles 7) while this library
holds 12–14. That is exactly why 13 series are recorded as `not_found` rather
than as "checked, complete".

### 1.6 Where a person fills the gap

Two hand-entry paths, both `editCatalog`, both requiring evidence:

* `POST /api/series/:name/volumes` — "this series has a book 14". Forced to
  `source = 'manual'` whatever the body claims. The form will not submit without
  either a link or a note saying how it is known.
* `PUT /api/series/:name/total` — "this series is 12 books". `setSeriesTotalSchema`
  **refuses the number without a source string.** This is the only way the app can
  ever say "complete" rather than "of at least N".

Withdrawing works only on `manual` rows. An imported row is **marked, never
deleted** — migration 0016's rule in the sibling project, and it transfers
exactly: a row vanishing from the missing list looks identical to the owner
having bought the book.

---

## 2. Wishlist

`copy.status` has allowed `'wanted'` since migration 0001 and **nothing in
`apps/web/src` ever referenced it** — the column was unreachable. Measured
2026-08-10 before the work started: **0 copies of any status**, in local and
production alike.

### 2.1 ⚠️ It is a list of copies, not of books

`GET /api/wishlist` returns `copy` rows, not `work` rows, and the reason is the
case that is about to become normal here. This catalog is 117 works and 118
editions, **all ebooks**, and physical books are being added shortly. "We have
the EPUB and want the hardcover" is a wish against a book that is *already in the
collection* — a work-level filter would simply show the book and say nothing
about the wish. The wishlist row carries the formats already held so the
distinction is visible rather than confusing.

The work-level filter still exists (`?status=` on `/collection`, wired to the
existing facet) because "show me the books with something lent out" is a real
question it answers. It is not the wishlist.

### 2.2 Promotion is a PATCH, never a delete-and-recreate

A wish records when it was wanted, from whom, and for how much.
`PATCH /api/copies/:id` with `{"status":"owned"}` is the whole request; every
other field is left alone. Re-creating the row would reset `created_at` to the
day the book arrived and make "how long was this on the list" permanently
unanswerable.

### 2.3 ⚠️ Two bugs found by driving it, that nothing else would have caught

Both are about the same thing: **a `work` row means "the catalog knows this
book", which stopped being the same as "we have it" the moment a wishlist
existed.**

1. **Wishing for a missing volume closed the gap.** The series ladder marked any
   work with a volume number as owned, so clicking *Want it* on Beneath the
   Dragoneye Moons 14 immediately reported that you had it.
2. **Wanting a second format made a held book missing.** The first fix was "all
   copies are wishlist statuses ⇒ not held". Wanting a *hardcover* of Cradle 1 —
   held as an EPUB — then made the series read *"11 of 12, 1 to go"*.

The rule that survives both is deliberately narrow, and it is narrow because
`copy` is an empty table:

> A work is a **wish** only when it has **no editions at all** and **every** copy
> it has is a wishlist status.

A work with no copies counts as held — that is what all 115 imported rows look
like, and the opposite rule empties the entire shelf. This is why
`components/Copies.tsx` **creates no edition for a wanted copy** and records the
desired format on `copy.edition_notes` instead: minting an edition for a wish
would make a brand-new wished-for book read as owned.

Both cases have regression tests in `packages/core/test/core.test.ts`.

---

## 3. Related books

Modelled on board game migration 0008 (`item_relation`), vocabulary rewritten
from pairs actually in this catalog rather than from a taxonomy.

| Relation | Direction | The real case here |
|---|---|---|
| `same_universe` | symmetric | Nine Sanderson works, Cosmere, no series between them |
| `companion` | symmetric | *Invent Short Story* — a five-chapter sampler of Completionist Chronicles 7 |
| `contains` | **directional** | *The Divine Dungeon Complete Series* (work 103) contains *Dungeon Born* (work 24) |
| `precedes` | **directional** | Reading order across a series boundary |

### 3.1 ⚠️ Direction, and the pair that proves it matters

A symmetric relation is stored with the lower work id first, so A↔B and B↔A
collapse onto one row and the unique index catches the duplicate. **A directional
one must not be sorted.** *Dungeon Born* is work **24** and the omnibus is work
**103**, so sorting ids would store "24 contains 103" — the chapter containing
the book that contains it — purely because it was catalogued first.

One row reads as two sentences: `outgoing` says which end you are standing on, so
the omnibus's page says *Contains* and *Dungeon Born*'s says *Part of*. Verified
against the running worker in both directions.

### 3.2 `same_universe` is NOT transitive, unlike the sibling project's `same_family`

That project closes over its family links because a family is a statement about
what a game *is* — link three Catans and all three are Catans. The Cosmere is 40+
published works; a transitive closure would make every Cosmere page a table of
contents, and one wrong link would silently absorb an unrelated book into the
whole set.

### 3.3 It is hand-entered, and that is the design

No source knows these connections, and given that half this library is absent
from Open Library (`isbn-ladder.md` §4.2), none ever will. The picker searches
**the catalog** and refuses a typed name: a relation is between two rows, and
`POST /api/works` deliberately does not dedupe, so accepting free text would let
a typo mint a second copy of a book already on the shelf.

---

## 4. Running it

```bash
npm run db:migrate:local                       # 0003 + 0004
npm run backfill:series-volumes                # dry run, LOCAL — read the per-series lines
npm run backfill:series-volumes -- --commit
npm test                                       # 55 core-rule tests
```

Idempotent: a second run reports `0 volume(s) this run has not seen before`.
It never overwrites a `manual` row.

⚠️ **Migrate before deploying.** New code must never meet an old schema, and
`/api/series` queries three tables that do not exist in production yet.

## 5. Two traps found while building this

**A backtick inside SQL inside a template literal.** `packages/db/src/series.ts`
had a comment reading ``-- the `copy` table``, which closed the template string.
`tsc` caught it, `npm run build` did **not** (the web build does not typecheck
`@lc/db`), and the dev worker silently kept serving the previous module — so the
API answered with pre-fix results and looked like a logic bug. No backticks in
SQL comments.

**The assets watcher dies on OneDrive, and the failure has two faces.**
`HANDOFF.md` records `GET /` returning 404. It also fails a subtler way: the
worker keeps 200ing but serves **index.html for every hashed asset**, so
`/assets/index-*.js` comes back as 1.2kB of HTML and the page renders a blank
body with no console error at all. Check
`curl -s -o /dev/null -w '%{size_download}' localhost:PORT/assets/index-*.js`
against the real file size before debugging anything else. The fix is the same:
restart `wrangler dev` after `npm run build`.
