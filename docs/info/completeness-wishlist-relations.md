# Series completeness, the wishlist & related books — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10**, except §3.2a (the scan-time overlap warning),
> verified **2026-08-11** through a running Worker against a local fixture —
> both directions, and a wished-for container correctly producing no warning;
> and §§1.4a–1.4b, added **2026-08-11** and verified the same day by driving the
> real `getSeriesReport` against a fresh local D1 with migrations 0090 and 0100
> applied. See §5's third trap for why that went through `@lc/db` rather than
> through a running Worker.
>
> **§1.4c added 2026-08-12** (migration 0110, the owner-confirmed series link) and
> verified that day through a **running Worker** against a local D1 carrying the
> production Legion fixture. ⚠️ Its measured counts — 5 hedged rungs in 2 series,
> 17 corroborated, 70 `exact` audiobook holdings and zero `containment` — are a
> **production** read, unlike §1.4a's, which came from the CSV.
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

### 1.4a ⚠️ A "missing" book the household already owns — fixed 2026-08-11

**The app was telling the owner they lacked books that are in the house.** That is
the one failure a completeness feature cannot survive, because it ends with
somebody buying a second copy.

`audiobook_holding` (migration 0010) is keyed
`work_id INTEGER PRIMARY KEY REFERENCES work(id)`. That key is not a backfill
gap, it is a structural one: **a book owned only on audio has no work row here,
so it cannot be represented at all.** Measured against
`audiobook_catalog/site/catalog.csv` on 2026-08-11:

| | |
|---|---|
| Stormlight Archive audiobooks the household holds | **7** — 1, 2, 2.5, 3, 3.5, 4, 5 |
| …of those, catalogued here | **1**, *Words of Radiance*, as an EPUB |
| what `/series/The Stormlight Archive` said | *"1 book of at least 5 — **6 missing** from the run itself"* |
| audiobook rows with no work row at all | **~397**, so this is systemic |

**Migration 0090 (`audiobook_series_holding`) is the fix, and it is a second
cache table rather than ~400 new `work` rows.** Minting works was the obvious
option and contradicts all three of migration 0010's stated rules — an audiobook
is *a different object in a different catalog*, the table is *a cache, never a
source of truth*, and *`copy` deliberately cannot reference it* — plus §2.3's
lesson below, that a `work` row already means two things and must not be made to
mean a third.

The key is `(series, index_sort)`, **which is the whole safety argument**: a gap
rung is a series and a number and nothing else, so there is no title to compare
and therefore **no containment guessing** — the rung that produced the old flat
*"All 5 held on audio"* lie on `/series/Tamer: King of Dinosaurs`.

⚠️ **The table adds no rungs to any ladder; it annotates existing ones.** Every
row it writes has a matching `series_volume` row by construction — same CSV, same
fold, same one-row-per-index rule — so `highestKnown`, the ceiling
`completeness.ts` calls "what stops this fabricating", is untouched.

**The fold is `normaliseTitle`**, at script time only, and nothing folded is
stored: `audiobook_series_holding.series` holds *our* spelling, so the Worker
joins `work.series` exactly. Three folds exist and only one is right here:

| Fold | Verdict |
|---|---|
| `normaliseTitle` | ✅ Already the series-name fold — `backfill-series-volumes.mjs` has resolved "All the Skills" onto "All The Skills" with it since it was written, and this table annotates the rows that produces. A second rule would be the second-matching-function mistake `matching.ts` opens with. |
| `normaliseUniverseText` | ❌ Keeps leading articles **on purpose** (the universe list holds "The Cosmere" and "Cosmere" as different entries). Measured, that is disqualifying: `Dark Healer` and `The Dark Healer` are one series written twice. |
| `bookIdFromTitle` | ❌ A Firestore document id, not a comparison. |

Measured over that CSV's **331 distinct series spellings**: the fold produces
**329 keys**, and both collisions — `Star Justice, Book`/`Star Justice Book` and
`Dark Healer`/`The Dark Healer` — are one series spelled two ways. **Nothing
distinct was conflated.**

⚠️ **The honesty rail is `series_matched_via`.** A folded name is not proof that
two catalogs mean one series, or that they number it alike.

| Value | Earned by | Rendered |
|---|---|---|
| `work_match` | a work we hold was matched by `matching.ts` on **title and author**, is filed under that audiobook series, **and carries the same volume number on both sides** | `AUDIO`, and the rung stops counting as missing |
| `fold` | the names merely fold onto one key | `AUDIO?`, and the rung **stays counted as missing** |

A hedge does not cross a book off a list — `maybeOnAudio` is reported separately
and stays inside `certainGaps`/`attestedGaps`.

Verified end to end on 2026-08-11 against a fresh local D1 (both migrations
applied) seeded with *Words of Radiance*, after `backfill:series-volumes` and
`backfill:audiobooks`:

```
1 book of at least 5 — nothing here is missing. 6 more you own on audio.
onAudio=6  certainGaps=0  attestedGaps=0
```

and, for a series with no corroborating work, the hedge holding:

```
1 book of at least 9 — 8 missing from the run itself. 6 possibly on audio.
onAudio=0  maybeOnAudio=6  certainGaps=8
```

**Not verified:** nothing has run against production, and neither migration is
applied there. The local D1 in the main checkout is behind the repo and holds no
Stormlight rows, so the seven-audiobook figure comes from the CSV, not from a
production read.

### 1.4b "I am never buying that one" — migration 0100

The Completionist Chronicles has three Patreon-era shorts — **6.5** *Havoc in the
Deathyards*, **11.5** *Jaxon's New Clients*, **13.5** *Poppy's Promise* — that
will never be bought, so the series read incomplete for ever.

⚠️ **`gap_verdict` cannot answer this.** It is keyed `(work_id, field)` and
answers a **detail** gap on a book we own. A series gap is definitionally a
volume with **no work row** — that is what makes it a gap — so the key has to be
`(series, index_sort)`, the only thing a rung is guaranteed to have. Skips also
reach rungs that exist in no table at all: an `earlier` gap is pure arithmetic.

⚠️ **It is the one write in this feature that costs no source.** Every other
assertion here could be false; a preference cannot be. `reason` is still
required, as the answer to "why is 11.5 greyed out" six months from now.

**How completion reads afterwards.** Two phrasings were on the table and only one
is honest:

| | |
|---|---|
| *"you own 12 of 12, 3 skipped"* | ❌ Shortens the series. Only a sourced `series_check.known_total` may say how long a series is, and skipping a book does not un-publish it. |
| *"12 of 15 — 3 deliberately skipped, so nothing else is missing"* | ✅ Keeps the length, moves the three out of *missing*. |

Mechanically, a skipped rung **leaves `SeriesCompleteness.gaps` for `skipped`**,
so every count derived from `gaps` — both chips on the series list, the
"only series with gaps" filter, `certainGaps`, `attestedGaps` — stops seeing it
with no edit to any of them. The ladder still draws it, greyed, with the reason
and a *Put it back*. With a total recorded the sentence becomes
`All 15 accounted for, per … — 12 here. 3 deliberately skipped.`; without one,
`"unbroken"` is withdrawn in favour of `"nothing else is missing"`.

### 1.4c ⚠️ The hedge that could never lift itself — migration 0110, 2026-08-12

**`work_match` is unreachable for exactly the series that most need it, and that
is the rule eating itself.** It requires one volume present in **both** catalogs,
matched on title and author, agreeing on its number. The entire purpose of
`audiobook_series_holding` is the volumes the two catalogs do **not** share. So a
series whose overlap is empty can never corroborate itself, no matter how many
times `backfill:audiobooks` runs.

Measured against **production** on 2026-08-12 — this is a production read, unlike
§1.4a's figures:

| Series | Hedged rungs | We hold | They hold |
|---|---|---|---|
| Arcane Pathfinder | 1, 2, 3, 4 | book **5** only | 1–4 |
| Legion | 4 | 1 and 2 | **4** only, the omnibus *The Many Lives of Stephen Leeds* |

Five rungs, two series, **17 series corroborated** — and both hedged series have
an empty overlap and byte-identical names on the two sides. Also measured: **all
70 live `audiobook_holding` rows are `exact`, zero `containment`**, so those 5
rungs were the only source of "possibly on audio" anywhere in production.

The owner had checked each one by hand and been right every time. That is a
source, so migration 0110 is where it goes: `audiobook_series_link`, one row per
series, and a button on the series page.

⚠️ **A third `AudioSeriesMatch` value, `'owner'` — NOT a promotion to
`work_match`.** Both stop a rung being counted as missing; only one of them is
re-checkable. *A book was independently identified in both catalogs* and *somebody
vouched for it* are different facts, and laundering the second into the first is
what every rail in this feature exists to prevent. `gapAudioLabel` says which.

| Value | Earned by | Rendered |
|---|---|---|
| `work_match` | a corroborating work — see §1.4a | `AUDIO` · *"you own this on audio, as …"* |
| `owner` | the owner confirmed the two series names mean one series | `AUDIO` · *"…— you confirmed the series match"* |
| `fold` | the names merely fold onto one key | `AUDIO?`, still counted as missing |

⚠️ **It could not live in `audiobook_series_holding.series_matched_via`.**
`backfill-audiobook-holdings.mjs` upserts that column with
`series_matched_via = excluded.series_matched_via`, so a value written there
survives until the next script run and then silently reverts. **A script-owned
column cannot hold a human decision.** `series_volume` protects `source =
'manual'` with a CASE in its own upsert for the same reason; a separate table
needs no such guard.

⚠️ **`audiobook_series` is stored as a GUARD, not a label.** The confirmation is
about a **pair of names**. A rung is upgraded only while the stored spelling still
matches the live row, so a rename in the sibling catalog reverts those rungs to
`AUDIO?` and asks again rather than silently authorising a mapping nobody has
looked at. Verified: renaming the rung behind a standing confirmation dropped
`onAudio` 1 → 0 and put `maybeOnAudio` back to 1, with the stale link still on the
report so the page can say it is holding nothing up.

⚠️ **`held()` in `completeness.ts` is now "not the hedge", not a list of the values
that count.** The failure modes are asymmetric: a value missing from an allow-list
silently keeps counting a book the owner owns as missing — §1.4a's whole bug —
whereas an unrecognised value is already forced to `'fold'` at the `@lc/db`
boundary, which is the one place the narrowing happens. Two UI branches carried
the same equality test and both would have kept a confirmed rung painted red.

Verified end to end against a local D1 with the production Legion fixture: the
hedge before, **404 on a mapping no live rung carries**, `owner` and attested gaps
2 → 1 after confirming, and back to 2 after the undo. 313 core tests pass.

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
| `contains` | **directional** | *The Divine Dungeon Complete Series* (work 103) contains *Dungeon Born* (work 24). ⚠️ Read by the scanner since 2026-08-11 — see §3.2a |
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

### 3.2a ⚠️ `contains` is now READ at scan time — added 2026-08-11

A relation used to be display only. `contains` is not: `loadContainmentIndex` in
`packages/db/src/relations.ts` reads every `contains` row and the scan path
attaches the answer to the line, so **"you already own this inside something
else" is said while the person is holding the book**, not in a report afterwards.

| Which end you scanned | What the row says |
|---|---|
| the volume, and the omnibus is held | *"You already own this inside The Divine Dungeon Complete Series."* |
| the omnibus, and a volume is held | *"This collects Dungeon Born, which you already own."* |

Three things about it that are decisions rather than details:

- **It never blocks.** The review screen raises the prompt it already has for
  duplicates — *add it, or leave it* — and the buttons are unchanged. Owning
  volume 1 **and** the omnibus is a choice people make on purpose.
- **It is not `state`.** `state === 'owned'` is about the *object* and comes from
  `edition.isbn13`; this is about the *text*. A line can be neither, either, or
  both.
- **Wishes are excluded**, by the §2 rule above. "You already own this inside
  *X*" is a lie if *X* is a book we only want. Verified against a fixture: a
  wished-for omnibus containing a held volume produces **no** warning.

⚠️ **It costs one query while `work_relation` is empty**, which it is today. With
no `contains` rows the index is empty and `overlapsFor` returns immediately
without touching the work matcher. Do not replace it with a per-line query — a
shelf photograph is a dozen lines.

### 3.3 It is hand-entered, and that is the design

No source knows these connections, and given that half this library is absent
from Open Library (`isbn-ladder.md` §4.2), none ever will. The picker searches
**the catalog** and refuses a typed name: a relation is between two rows, and
`POST /api/works` deliberately does not dedupe, so accepting free text would let
a typo mint a second copy of a book already on the shelf.

---

## 4. Running it

```bash
npm run db:migrate:local                       # 0003 + 0004, and now 0090 + 0100
npm run backfill:series-volumes                # dry run, LOCAL — read the per-series lines
npm run backfill:series-volumes -- --commit
npm run backfill:audiobooks                    # dry run — ⚠️ READ THE `fold` LIST
npm run backfill:audiobooks -- --commit
npm test                                       # 266 core-rule tests
```

⚠️ From a git worktree both backfills need `LC_AUDIOBOOK_ROOT` pointing at the
`audiobook_catalog` checkout — `../audiobook_catalog` lands three directories too
deep and a zero-row read looks exactly like "the sibling catalog knows nothing".
`backfill:audiobooks` fails loudly on that rather than marking every holding
stale; `backfill:series-volumes` does not.

⚠️ **Read the `fold` list in `backfill:audiobooks` before committing.** Those are
the series whose only connection to the audiobook catalog is a folded name; every
rung of one renders `AUDIO?` and is still counted as missing. The
`work_match` list needs no such reading — each of those had a book identified by
title, author and volume number.

Idempotent: a second run reports `0 volume(s) this run has not seen before`.
It never overwrites a `manual` row.

⚠️ **Migrate before deploying.** New code must never meet an old schema, and
`/api/series` queries three tables that do not exist in production yet.

## 5. Three traps found while building this

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

**⚠️ `curl localhost:<port>` can reach SOMEBODY ELSE'S worker.** Found
2026-08-11, and it cost an hour of chasing a phantom wrangler bug. A worktree
`wrangler dev` on port 8791 answered `/api/health` with 200 and then failed every
query with `no such table: audiobook_holding` — a table that demonstrably existed
in the database it had been pointed at. The conclusion drawn was "`wrangler dev`
ignores `--persist-to` in a worktree". **It does not.** Several parallel agents
were each running `wrangler dev` from the *main* checkout, whose local D1 is
behind the repo, and the curl was being answered by one of theirs. `/api/me`
returning a fully populated user nobody had seeded was the clue that went unread.

Two things follow, and both are cheap:

- **Check what is already listening before believing a local response**:
  `netstat -ano | grep LISTENING | grep :<port>`. More than one PID on your port
  means the answer is not necessarily yours.
- **Kill by command line, never by port.** `Get-CimInstance Win32_Process` and
  match on your worktree path — killing whatever holds the port kills another
  agent's session.

Where a Worker cannot be trusted, drive `@lc/db` directly: a ~40-line shim giving
`prepare/bind/all/first` over `wrangler d1 execute` runs every real query, join
and row converter, and is what verified §1.4a. ⚠️ Strip `--` line comments before
flattening the SQL to one line, or the first comment swallows the statement.
