# Series pages — formats, alternate printings, audiobooks — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-23** for §4.4 and §4.6 (migration 0390, the view, and
> the recording count), against a LOCAL D1 — §4.6 with the second *Elantris*
> edition inserted BY HAND, because `KI-6` stops the sweep writing it.
> §3 (the duplicate rule) was last verified **2026-08-11** against a local D1
> fixture through a running Worker. §2, the rest of §4 and below were last
> verified **2026-08-10** against production D1 (read-only) and a browser, and
> their counts have moved since — the catalog held 224 works on 2026-08-11.
> ⚠️ Nothing here was re-checked against PRODUCTION on 2026-08-23; migration
> 0390 has not been applied remotely.

What the series screens now answer, what was measured to get there, and the four
decisions that will look arbitrary if you only read the code.

---

## 1. What changed, in one table

| | |
|---|---|
| **Series list** | Search, four sort orders, gaps-only, all three in the URL. A holdings line per row. |
| **Series page** | Each held rung says what form we hold it in. A summary line above the ladder. |
| **Owned more than once** | A second section: one volume, **two or more copies on the shelf**. ⚠️ Renamed and re-pointed 2026-08-11 — see §3, and do not restore the edition-based rule. |
| **Audiobooks** | `audiobook_holding` (migration 0010, a VIEW since 0390 — see §4.4) + `npm run backfill:audiobooks`. **40 of 157 works, 25%.** |

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

## 3. "Owned more than once" counts COPIES — rewritten 2026-08-11

> ⚠️ **This section replaces the old rule and its heading. Both were wrong.**
> The section used to be called *"Bought more than once"* and fired on
> **editions**; it now says *"Owned more than once"* and fires on **copies**.
> `ownedMoreThanOnce` in `packages/core/src/holdings.ts` is the rule, and it has
> tests. `boughtTwice()` in `packages/db/src/series.ts` is gone.

### 3.1 Three questions, one badge

| The question | The table that answers it |
|---|---|
| Do I own the same **object** twice? | `copy` — and this is what the badge means |
| Do I own the same **book** in two printings? | `edition`, one `work` |
| Do I own the same **text** twice, via a bundle? | two `work`s and `work_relation.contains` |

The old rule answered the middle question under a heading that asked the first.

### 3.2 What was measured, 2026-08-11

Nine works have 2+ editions, in three shapes:

| Shape | Works | Verdict |
|---|---|---|
| **Two media** — ebook + hardcover | 5 (Tress, Yumi, The Sunlit Man, The Frugal Wizard's Handbook, Fires of December) | Ordinary. Never a duplicate. The old rule already excluded these, which is why it was the *second* attempt. |
| **Two printings, one medium** | 3 (*Dinosaur Dance!*, *The Pout-Pout Fish*, *How the Grinch Stole Christmas*) | ⚠️ **All three fired, and all three were wrong** |
| **Superseded file** | 1 (*White Sand*) | Two `ebook_epub` rows, **0 copies** |

⚠️ **The middle group is not real.** All three have 0 or 1 copies:

- *Dinosaur Dance!* — one edition with an ISBN and **no copy**, one with no ISBN
  and **one copy**. One board book, recorded twice by two different scan paths.
- *Pout-Pout Fish* and *Grinch* — two genuine ISBNs each, **zero copies**.

**So the badge was firing on scan artifacts, not purchases, and nothing in the
catalog is genuinely owned twice today.** The section renders for **no series**
until a second copy exists, which is the honest answer.

### 3.3 The rule now

Two or more copies whose `status` is in `HELD_STATUSES` (`owned`, `lent`). Not
editions, not formats, not media.

- **`lent` counts.** The book is ours, it is just in someone else's hands.
- **A wish does not.** "We have the EPUB and want the hardcover" is the ordinary
  wishlist case and shows as a `wanted` copy against a book that is also owned.
- **`sold` and `borrowed` do not.** One has left and the other never arrived.

The panel lists the **copies**, not the printings — a copy that names its
printing borrows that printing's format and name, one that does not says where it
is instead. `copy.edition_id` is nullable by design (migration 0001: *"a copy can
exist before its exact printing is known"*), so the un-named case is ordinary.

⚠️ The copies query in `loadAll` binds `HELD_STATUSES` **first**, so the series
name is `?3` and not `?1`. Reusing the shared `joinScope` there would filter the
catalog to a series called "owned" and silently return nothing.

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

### 4.5 ⚠️ `audiobook_holding` is a VIEW now — migration 0390, 2026-08-23

The table's rows moved to **`audiobook_edition_holding`**, keyed
`(work_id, audio_key)` instead of `work_id` alone, and `audiobook_holding` was
recreated as a **view** over it with the same name, the same columns and the
same column order. Every existing reader — `packages/db/src/series.ts`,
`works.ts`, `apps/worker/src/routes/audiobook-mapping.ts`, `reviews.ts`,
`warnings.ts` — was untouched, and there is exactly one writer
(`scripts/backfill-audiobook-holdings.mjs`), which is what made the swap safe.

**Why.** `work_id` as a lone primary key means one work holds one audio row, and
the household owns two *Elantris* recordings — `catalog.csv:995`, full cast, no
series; `catalog.csv:996`, the Tenth Anniversary edition, series *Elantris*,
volume 1, read by Jack Garrett. Last write won, and the edition that KNEW the
series is the one that lost. Work 514 showed an audiobook with no series while
the fact that would fill the column sat in a row that could not be stored.

**The view picks a WHOLE row**, ranked `(series IS NULL)`, then
`(index_display IS NULL)`, then `audio_key` — never merged fields. Stitching one
edition's title onto another's series would describe no audiobook anybody owns,
and `title` exists precisely so a wrong match is noticeable by eye.

**`audio_key` is `raw_title`** — the sibling catalog's verbatim string, the same
one migration 0340 added as the content-warning key. The edition identity here
and the warning identity there are therefore one string and cannot drift.

**What to write, and what to read.** Write `audiobook_edition_holding`; a view
cannot be written. Read the view for the per-work question every existing caller
asks, and `listAudioEditions` in `@lc/db` for the set. New columns `audio_key`
and `narrator` are deliberately absent from the view.

⚠️ **Measured, and the reason work 514 is not fixed by this alone:** the schema
now stores two editions, but the MATCHER still finds only one. Folded, our side
is `elantris` (8 chars) against `elantris tenth anniversary special edition`
(42) — a ratio of 0.19 against the 0.6 containment floor, the same floor that
stops *Mistborn* reaching *Mistborn: The Final Empire*. `matchIndexedWorkAll`
removes the early return and changes no gate, so row 996 is still refused.
Closing it needs a decision nobody has made — see `docs/KNOWN_ISSUES.md`.

Across the whole 1,081-row sibling catalog, exactly one pair is a genuine second
edition that the unchanged gates admit: *The Fellowship of the Ring*, dramatized
against standard.

### 4.6 The count is SAID, not implied — 2026-08-23

Owner: *“have it say 2 on the physical and ebook libraries; on audiobook have
them be different since they're different files being served.”* So the work page
says *“You own 2 audiobooks of this book”* and the ladder chip reads **AUDIO 2**,
both from `audioEditionCountSql` in `packages/db/src/works.ts` — the one
definition, reused, never a second COUNT at a second call site.

⚠️ **It counts RECORDINGS; the ladder's *“N of M on audio”* counts RUNGS**, and a
volume owned twice is still one rung — the view above guarantees it, and
`packages/db/test/audio-edition-count.test.ts` pins it.

⚠️ **It is not `listAudioEditions(…).length`.** That list carries stale rows on
purpose; the count filters `stale_at IS NULL`, so one live and one withdrawn
edition is legitimately two rows and the number one.

⚠️ **And the count had to reach `signatureOf`, not just the chip** — chips are
suppressed when every held rung agrees, and *Elantris* is one held volume, so a
chip-only change would have rendered nothing at all. Same shape as the
`matched_via` trap in §5.1's neighbourhood; see `components/RungMedia.tsx`.

The ebook library (`ebooks.heygabi.ai`) is `audiobook_catalog`'s
`site/ebooks.html` and was deliberately left alone — `docs/TODO.md` names the
two files and why its join cannot count yet.

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

---

## ⚠️ A board book is `hardcover` — standing rule, 2026-08-13

Owner: *"consider all board books hard cover since theyre physically hard."*

**So `format = 'hardcover'` for every board book, without exception.** The reason is
physical and needs no lookup: board pages and a rigid case are what a board book
*is*. This resolves a question that had been left open rather than guessed.

⚠️ **It is a correction to two defaults that both point the wrong way for this
shelf**, and neither announces itself:

| Where the wrong value comes from | What it does |
|---|---|
| `edition.format` has `DEFAULT 'paperback'` (migration 0001) | anything created without naming a format lands as paperback |
| The scan path's own convention — *"a scanned book is recorded as a paperback until someone says otherwise"* | every scanned board book, and this house is full of them |

**Corrected on the day the rule was made** — 10 editions moved `paperback` →
`hardcover`: the six Autumn Publishing *My First* board books, and *There's a Mouse
About the House!*, *Don't Tickle the Dinosaur!*, *Richard Scarry's Busy Busy Farm*
and *Who Goes Roar?*.

⚠️ **Applies going forward to anything that creates an edition without a person
choosing** — `AddWork`, the scan-add path, and any importer. A board book arriving
through those still lands as `paperback` today; the rule says it should not. Fixing
the *default* is not right either, since most non-board books really are paperback —
so this wants the **edition picker** (`docs/FABLE5.md` §4.2a) or a format question at
intake, not a changed default.

⚠️ **One book was NOT changed on evidence**: *There's a Mouse About the House!* is a
Richard Fowler **lift-the-flap**, and a lift-the-flap is not necessarily board — it
was included above because the owner's rule is unconditional, but if it turns out to
be a paper-paged flap book, that one row is wrong. Checkable only from the physical
copy.
