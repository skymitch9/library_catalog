# Series pages — formats, alternate printings, audiobooks — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10**, against production D1 (read-only) and a local
> fixture driven in a browser.

What the series screens now answer, what was measured to get there, and the four
decisions that will look arbitrary if you only read the code.

---

## 1. What changed, in one table

| | |
|---|---|
| **Series list** | Search, four sort orders, gaps-only, all three in the URL. A holdings line per row. |
| **Series page** | Each held rung says what form we hold it in. A summary line above the ladder. |
| **Bought more than once** | A second section: one volume, several printings. The Target / Barnes & Noble case. |
| **Audiobooks** | `audiobook_holding` (migration 0010) + `npm run backfill:audiobooks`. **40 of 157 works, 25%.** |

---

## 2. ⚠️ The measurement that shaped the UI

Production D1, 2026-08-10:

| | |
|---|---|
| works | **157** (was 120 when this work was scoped — the catalog is moving) |
| editions | **156** — `ebook_epub` 117, `paperback` 38, `hardcover` 1 |
| works with 2+ editions | **2** — *White Sand* and *Dinosaur Dance!* |
| series | **27**, over 111 works |
| **physical editions on a work that has a series** | **0** |

That last line is the one that matters. Every physical edition in the catalog
belongs to a children's board book with no series, so **every series page today
is uniformly ebook**. A chip reading EBOOK on all 23 rungs of *Blade Dance* is a
label on the majority, which the sibling Board Game Catalog states outright is a
label nobody reads (`components/ui.tsx`, on `DigitalTag`).

So `SeriesDetailPage` computes `signatureShared`: when every held rung gives the
same answer it is said **once**, above the ladder, and the rungs stay clean. The
moment one volume differs the chips appear on every rung. The page says more as
the shelf gets more interesting, not less — which is the right way round for a
BackerKit import that is about to add a lot of hardbacks.

**Do not "fix" this into an unconditional chip.** It will look like a bug the
first time you read the code against today's data, and it is not.

---

## 3. "Bought more than once" is two printings *of one medium*

The obvious rule is `editions.length > 1`. It is wrong, and a local fixture
caught it before anything shipped.

A book held as an EPUB **and** a paperback has two edition rows and is not a book
anybody bought twice — it is one book in two formats, which the chips on its rung
already say. Listing it again underneath is the same fact told twice, and once
the BackerKit import lands it would sweep up nearly every book in the house.

`boughtTwice()` in `packages/db/src/series.ts` therefore requires a repeat
**within one medium**. Against production that is exactly:

| Work | Printings | In? |
|---|---|---|
| *White Sand* | 2 × `ebook_epub` ("Volume 1", "Omnibus - collects volumes 1-3") | ✅ — and it is in a series, so it shows |
| *Dinosaur Dance!* | `paperback` + `hardcover` | ✅ by the rule, but **has no series**, so no series page shows it |

So the section renders for exactly one series today, *White Sand*. That is
correct, not a bug.

---

## 4. Audiobooks: why a table, and what it cost

### 4.1 The Worker cannot read the CSV

`audiobook_catalog/site/catalog.csv` is 1,075 curated rows on disk beside this
repo. Every script in `scripts/` reads it directly. **A Cloudflare Worker
cannot** — no filesystem, no sibling repo, and the CSV is not a shipped asset.
`HANDOFF.md` records that an `alsoInAudio` flag was dropped from the scan screen
for exactly this: it would have answered `false` for every book in the house.

`audiobook_holding` is that flag, arrived at from the other side. A script does
the reading, the project's ONE matcher decides, the verdict lands in a table the
Worker can read. **It is a cache of another catalog's rows, never a source of
truth**; deleting every row loses nothing that one script run cannot rebuild.

⚠️ It is deliberately **not** an `edition`. Open question 5 of `HANDOFF.md` and
`PLATFORM.md` §2.2 both say nothing merges. Consequences that are the point, not
side effects: `copy` cannot reference one, so nothing can lend or price an
audiobook; and the collection's format filter cannot reach it, so "any format"
keeps meaning "any format of a book in *this* catalog".

### 4.2 The measured match rate — 40 of 157, 25%

Dry run against production, read-only, 2026-08-10:

| | |
|---|---|
| matched | **40 (25%)** — 27 exact title, 13 containment |
| of those, reached only through one of our aliases | **5** |
| no audiobook found | **117 (75%)** |

**25% is low and the reasons are known, not mysterious.** The misses fall into
four groups, and only the last is addressable here:

| Group | Roughly | Why |
|---|---|---|
| Children's board books | ~35 | *Goodnight Moon*, *Fox in Socks*. No audiobook exists, and none is wanted. Not a miss. |
| *Seirei Tsukai no Blade Dance* | 23 | Fan-translated light novels. No English audio exists. |
| *High School DxD* | 15 | Same. |
| **Cradle** | 12 | ⚠️ Audiobooks of these **are** owned in real life. The sibling catalog files them under titles this fold does not reach — the same series `backfill:series-volumes` records as `not_found`. |

So the honest summary is: **the ceiling is nowhere near 100%, and the one group
worth chasing is Cradle.** Twelve works, one series, and the fix is aliases — the
mechanism that already exists and already works (see below), not a looser
matcher.

### 4.3 ⚠️ Our aliases are asked, and they are where the yield came from

The index is built over the *audiobook* rows, which carry no aliases. Ours live
in `work_alias`. So the printed name alone matched **35**; asking under the ten
recorded aliases as well reached **40**.

The five it added are exactly the *He Who Fights with Monsters* volumes, which
Audible files under **Shirtaloon** and this catalog files under Travis Deverell.
`matching.ts`'s author gate rejects them outright under the printed name, and
that rejection is correct — widening it would be the wrong fix. Asking a second
time under a recorded pen name is the right one.

The script tries the printed pair first and it wins ties, so a work with aliases
can only ever *gain* a match. `audiobook_holding.via_alias` records which alias
was spent, because a match that needed an alias disappears silently if that alias
is ever removed.

### 4.4 `matched_via` is stored and shown

13 of the 40 rest on containment — the rung `matching.ts` opens by blaming for
three wrong-game matches in the sibling project. All 13 are the same benign
shape, a `- MM` suffix this catalog adds and the audiobook catalog does not:

```
"Oathbound Healer - MM"   ←→  "Oathbound Healer"        0.80
"Under Ashen Skies- MM"   ←→  "Under Ashen Skies"       0.86
"Tamer: King of Dinosaurs Book 7" ←→ "Tamer: King of Dinosaurs"  0.89
```

⚠️ The five *Tamer* rows all match the **same** audiobook row — the series' base
title. That is a real weakness of containment and it is visible rather than
hidden: the chip renders `AUDIO?` with a tooltip saying the match was partial.
Read the dry run's containment list before every `--commit`.

---

## 5. Why the series list filters in the browser

`CollectionPage` pushes every decision to SQL, and its comment explains why: it
holds one page of a 157-row catalog, so a client-side sort would order the page
rather than the collection.

`/api/series` is the opposite shape. It returns **every** series in one response,
because computing completeness needs all the rows anyway. There is no page to be
wrong about, and a round trip per keystroke would re-run five queries and a
group-by to filter a list the browser already holds. So the search box is instant
and needs no debounce.

**The day this list wants paging is the day the endpoint should page** — not the
day the filter moves to the server.

### 5.1 Sort defaults to name, and must keep doing so

"Most missing first" looks like the more useful default and is not: it reorders
itself every time a book is bought or a source is consulted, so a list you cannot
form a habit about has to be read end to end every time.

⚠️ Every comparator falls back to the name. Twelve of 27 series hold exactly one
book, so "most books" leaves a dozen rows tied, and `Array.prototype.sort` is
stable only *within* one call — without the tiebreak the tied block reshuffles as
you type.

`audio` sorts **fewest** first: the useful question is which series you have on
the shelf but not in your ears.

---

## 6. Traps

- **⚠️ Migrate before deploying.** `/api/series` now selects from
  `audiobook_holding`. Deploying first makes **every** series request a 500 —
  both the list and every detail page. Migrations 0003 and 0005 each carried this
  same trap; it is the one that keeps recurring here.
- **`audiobook_holding` is deliberately NOT in the export.** `packages/db/src/export.ts`
  carries "every table that holds a decision"; this one holds a cache. Adding it
  would also add a second 500 surface before the migration lands.
- **⚠️ A worktree cannot find the sibling catalog.** `scripts/lib/audiobooks.mjs`
  resolves `ROOT/../audiobook_catalog`, which in
  `library_catalog/.claude/worktrees/<name>` is three directories too deep.
  `loadAudiobooks()` then returns `[]` — a zero-row read that looks exactly like
  "the sibling catalog knows nothing". Set **`LC_AUDIOBOOK_ROOT`**. The backfill
  now refuses to run on zero rows rather than marking every holding stale.
- **A worktree also has no `node_modules`,** and Node resolution walks *up* — so
  `@lc/core` silently resolves to the **main checkout's** copy. `npm run typecheck`
  then validates code you did not write and misses code you did. Run
  `npm install` in the worktree first. Seen 2026-08-10: a typecheck reported
  errors in `PeoplePage.tsx` from another session's uncommitted work.
- **Four processes were listening on one dev port.** With several agents running,
  `netstat -ano | grep ":8795 "` showed four LISTENING rows and every request
  hung with no log line. `wrangler dev` says "Ready on" regardless. Pick a port
  and *check it is free first*.
- **`.fmt` is not `.mark`.** `.mark` is `position: absolute` from its first life
  in the corner of a cover, and every inline use since has had to undo it. The
  format chips are their own class for that reason.
