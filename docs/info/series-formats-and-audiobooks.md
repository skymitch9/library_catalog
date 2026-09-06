# Series pages — formats, alternate printings, audiobooks — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-09-05** for the **NEW §4.11** only — the byte-identical
> dry-run diffs it quotes were run that evening against BOTH production
> instances (`--remote` and `--remote --friend`, dry only, never `--commit`),
> and the test counts were read off `npm run test`. ⚠️ **NOT verified in §4.11:
> anything rendered, anything deployed, and any Worker behaviour** — phase 0
> ships no route, no cron and no migration, and nothing under `apps/worker` was
> touched.
> Last verified before that: **2026-09-05** for the **NEW §4.10** only — every number in it
> was measured that evening against production `library-catalog` and the live
> `catalog.csv`: the containment ratios were computed by RUNNING
> `cleanAudiobookTitle` on the real CSV row, and the 121 → 122 / `fold` →
> `work_match` change is the diff between two real `--remote` dry runs taken
> before and after the alias landed. The sweep was then committed on both
> instances. ⚠️ **NOT verified: anything rendered** — `/work/526` and
> `/series/Battle Mage Farmer` need a signed-in eye and have not been looked at.
> ⚠️ Nothing else here was re-checked on 2026-09-05.
> Last verified before that: **2026-09-03** for the **NEW §4.9** only — migration 0450 was
> written and applied `--remote` to BOTH D1s that day (`library-catalog` and
> `library-catalog-2nd`, both ✅), and the counts it quotes were measured against
> both live databases that afternoon. ⚠️ **NOT verified that day: anything
> rendered.** The code is committed and **NOT deployed**, so no live page has
> been seen with the `?` off the chips or with the Audio tab on it.
> ⚠️ Nothing else here was re-checked on 2026-09-03. §4.4's `AUDIO?` sentence
> was corrected in place because it became false; that correction and §4.9 are
> the only edits.
> Last verified before that: **2026-08-26** for **§4.7 and §4.8** — measured against the
> LIVE `catalog.csv` and BOTH production D1s that day (the backfill was run
> `--remote` on each, dry then `--commit`; the cross-instance table is a
> simulation over both catalogs' real works and aliases, not a live donor call).
> ⚠️ **What was NOT verified on 2026-08-26:** the rendered work pages (the
> `/api/works/:id` read needs a session), and the donor route change is
> committed but **its deploy state is recorded in `docs/TODO.md`, not here**.
> Nothing else in this file was re-checked that day.
> Previously **2026-08-23** for §4.4 and §4.6 (migration 0390, the view, and
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
[`decisions.md`](decisions.md) §2 records that an `alsoInAudio` flag was dropped
from the scan screen for exactly this: it would have answered `false` for every
book in the house.

`audiobook_holding` is that flag, arrived at from the other side. A script does
the reading, the project's ONE matcher decides, the verdict lands in a table the
Worker can read. **It is a cache of another catalog's rows, never a source of
truth**; deleting every row loses nothing that one script run cannot rebuild.

⚠️ It is deliberately **not** an `edition`. [`decisions.md`](decisions.md) §1
(the retired handoff's open question 5) and `PLATFORM.md` §2.2 both say nothing
merges. Consequences that are the point, not
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
hidden. ⚠️ **AMENDED 2026-09-03: the chip no longer renders `AUDIO?`.** It reads
a flat `AUDIO`, and the partial-title fact lives in the tooltip, in the work
page's provenance sentence, and — the part that makes the change honest — in a
verdict the owner can record. See **§4.9**. Read the dry run's containment list
before every `--commit`; nothing about that changed.

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

### 4.7 🔴 "The alias exists and it STILL didn't link" — an EDITION SET, 2026-08-26

**The symptom to search for.** A work has a `work_alias` row spelling the
audiobook's title *exactly*, the backfill reports the alias rows as read, and the
work is still filed under **"no audiobook"**. Or the quieter half: a link that
used to exist is silently `stale_at`, and nothing says why.

**What it is.** ⚠️ **Two rows in `catalog.csv` that fold to the same title.**
The matcher treats every multi-member fold as rows it cannot tell apart and
refuses — correctly for different volumes (§4.5, and `KI-9`), and **wrongly for
two recordings of one book.** The alias never failed; it reached the right
string and the fold refused it.

**Measured 2026-08-26** — `catalog.csv` rows 98 and 99, *Isles of the
Emberdark*, both `Secret Projects` #5, both Brandon Sanderson:

| | narrator | year | cover |
|---|---|---|---|
| row 98 | Kaleo Griffith, Jennifer Jill Araya | 2025-07-10 | `Isles of the Emberdark - A Cosmere Novel Secret Projects, Book 5.jpg` |
| row 99 | **Brandon Sanderson** | 2025 | `Isles_of_the_Emberdark_by_Brandon_Sanderson.png` |

`disambiguateByVolume` saw a two-member fold and asked which one carries our
volume number. **Both carry 5**, so `withVolume.length === 2` and it refused.
Consequences on both instances: padhard **#348** filed under "no audiobook"
(0 `audiobook_edition_holding` rows), and main **#4**'s row marked
`stale_at 2026-08-17` — *the day the second recording landed in the CSV*, with
no signal anywhere that a link had gone away.

**The rule now — `isEditionSet` in `packages/core/src/matching.ts`.** A fold
whose members all state the **same non-null series AND the same non-null volume
number** cannot be different volumes; they are recordings of one book, which is
exactly what migration 0390's per-edition key exists to hold. Such a group is
returned whole by `matchIndexedWorkAll` and as its first member by
`matchIndexedWork`, so `lookupAll(...)[0] === lookup(...)` still holds.

⚠️ **Nothing else loosened.** The author gate, `numbersAgree`, the 0.6
containment floor and every different-VOLUME refusal are untouched — *The
Eminence in Shadow*, *Space Knight* and *Reincarnated as a Sword* still refuse,
and `packages/core/test/core.test.ts` pins each. Requiring the SERIES to agree
as well as the number is what stops two unrelated books sharing a title, an
author and a volume number from being called editions of each other.

**Measured effect, both instances, 2026-08-26 (`--remote` dry run, then
committed):**

| | matched works | audio editions |
|---|---|---|
| main, before → after | 131 → **135** | 132 → **140** |
| padhard, before → after | 115 → **119** | 115 → **123** |

Every one of the eight new editions on each side is `matched_via = 'exact'`.

**⚠️ It also supersedes `DONE.md`'s 2026-08-25 note *"do not try to fix this in
the matcher"*** about the dramatized ACOTAR volumes. Audible splits one
dramatization across `(Part 1 of 2)` / `(Part 2 of 2)`; `cleanTitleWithSeries`
strips the part and series decoration, and the halves fold to one title, one
series, one volume — an edition set. They now link directly instead of only
through an `audiobook_series_link`. The series-link is still the right tool for
a whole series; it is no longer the *only* tool here.

⚠️ **The consequence to know:** a two-part dramatization now counts as **two
recordings** in §4.6's *"You own N audiobooks"*, because that is what the rows
say. They are two files of one performance, not two performances. Nothing in the
data distinguishes them from a genuine second edition, and inventing a
`Part N of M` rule would put a second title-parsing heuristic beside
`cleanAudiobookTitle` — the drift `matching.ts` opens by banning.

#### ⚠️ The half this does NOT close: two recordings with the SAME raw title

`audiobook_edition_holding` is keyed `(work_id, audio_key)` and **`audio_key` is
`raw_title` verbatim** (§4.5). The two *Isles of the Emberdark* rows have the
**identical** `raw_title`, so they collide on that key: the matcher hands back
both, the backfill's per-edition map collapses them, and **one row is stored,
not two.** Works #4 and #348 each show *one* audiobook — right for the owner's
question, and short of the truth.

Storing both would need `audio_key` to carry something more (the narrator, or the
cover file) — and ⚠️ **`audio_key` is a persisted key deliberately equal to the
content-warning key**, so changing it is a **migration with its own review**, not
an edit. Written up for the owner in `docs/TODO.md`. The ACOTAR parts are
unaffected: their raw titles differ, so both halves store.

### 4.8 Cross-instance "same book" — the donor asks BOTH sides' aliases, 2026-08-26

The other half of the same owner report. `work_key` is
`normaliseTitle(title)|normaliseTitle(primaryAuthor)`, so **the printed title is
baked into it** — and the two instances hold different print editions:

| | padhard #348 | main #4 |
|---|---|---|
| title | `Isles of the Emberdark: A Cosmere Novel` | `Isles of the Emberdark` |
| `work_key` | `isles of the emberdark a cosmere novel\|brandon sanderson` | `isles of the emberdark\|brandon sanderson` |
| edition | `9781250415394` hardcover (Tor) | `9781938570506` hardcover (Dragonsteel) + epub |

Neither `work_key` nor the folded title reaches the other, and ⚠️ **`work_key`
is a persisted key — re-deriving it is a migration, not an edit**
(`packages/db/src/works.ts`). Identity is therefore bridged with **aliases**,
which is what `work_alias` has been for since migration 0005:

- **Responder** (`apps/worker/src/routes/donor.ts`): on a fold miss it builds a
  `WorkIndex` over its works **and its title aliases** and asks
  `matchIndexedWork` — the one matcher, author gate and ambiguity refusals
  intact.
- **Asker** (`apps/worker/src/lib/details-sweep.ts`): sends its own recorded
  title aliases as repeated `alias=` parameters in the **same** request. ⚠️ One
  fetch whatever the count, so the donor step still costs exactly **one**
  subrequest and `estimateSubrequests` / `FREE_LADDER_SUBREQUESTS` are unchanged.

**Measured over both live instances, 2026-08-26** (works that match today: 38
each way):

| Rung | padhard → main | main → padhard |
|---|---|---|
| responder's own aliases | **+3** | **+4** ¹ |
| asker's aliases sent on the wire | **+3** | **+3** |
| subtitle-stripped (**not built**) | +2 | 0 |

¹ ⚠️ One of those four was a **containment** match and is now **refused**: main
#222 *"Dungeon Crawler Carl: Crocodile"* reaching padhard #25 *"Dungeon Crawler
Carl"* at 0.86 — two different books. The rung takes `exact` and `alias` only,
because the donor's findings are applied with **no person in the loop**.
Containment stays right for the audiobook backfill, whose output a person reads
before committing.

⚠️ **The subtitle-stripped rung was measured and deliberately NOT built.** Of
its two hits, *"Keepers of the Light: Book Two of the Broken Prophecies"*
(padhard #489) reaching *"Keepers of the Light"* (main #328) **cannot be settled
without the owner** — the subtitle says book two while BOTH rows record
`series_index_sort = 1`. That is the *"Tamer: King of Dinosaurs"* shape
`splitSeriesPrefix`'s own header warns about, arriving in real data. Both
candidates are in `docs/TODO.md` for confirmation; the durable fix for a pair he
confirms is **one `work_alias` row**, which this rung then matches for free — the
same mechanism the 2026-08-25 near-miss audit used, at one INSERT and no code.

---

### 4.9 The `?` came off the chips, and the answer went in the edit box — 2026-09-03

**Owner, ~14:37 Phoenix, verbatim:**

> "Also I see a lot of books asking if this is the right audio, can we make all
>  of those question ones show the audio even if not sure and then we can confirm
>  if it's right in the edit menu later? Any dramatic misses ping me about"

Approved as the two-part change below at **15:03** — *"Yes do it"*.

#### What "a lot" actually was — measured 14:40, both live D1s

| | MAIN | padhard |
|---|---|---|
| work-level `containment`, live | **8** (all 0.80–0.82: seven *Harry Potter … (Full-Cast Edition)*, plus *Space Knight Book 1* → "Space Knight") | 0 |
| work-level `containment`, stale | 1 — ⚠️ work **#72** *Tamer Book 11* → "Tamer: King of Dinosaurs", the §4.4 shape, and the ONE genuine miss. Already stale, so already shown lighter | 0 |
| series-level `fold`, live | 6 | **27** (DCC ×8, He Who Fights with Monsters ×12, + 7 singles) |
| series links already confirmed (0110) | 8 | 1 |

⚠️ **So "a lot" was padhard's SERIES pages, not the work-level matches** — and
the two halves have different mechanisms. Nothing in this section changes the
series-level one; §4.9.3 says why.

#### 4.9.1 Display — the hedge moved, it did not vanish

`audioToken` returns `'audio'` for a containment match, so a hedged rung signs
exactly as a certain one does; `Media` and `GapMedia` render no `?`;
`mediumPhrase` says *"on audio"* for both tokens; and `matchProvenance`'s
containment sentence became **"Matched on a partial title (81% title match) —
confirm it in ✎ Edit this book."**

⚠️ **Migration 0010's rule is intact.** Provenance is still SHOWN — reworded
into a pointer, never removed. The doubt now lives in three places that can act
on it (the chip tooltip, that sentence, the Audio tab) instead of one that
could not (a `?` nobody could answer).

⚠️ The retired `'audio?'` branches in `mediumPhrase` are **kept, not deleted**:
it is exported and takes a plain string, so an old token must produce the
current words rather than falling through to a literal "audio?" mid-sentence.

#### 4.9.2 Confirm — migration 0450, `audiobook_match_review`

`(work_id, audio_key, verdict, decided_at, decided_by)`, PK `(work_id,
audio_key)`, verdict `'confirmed' | 'rejected'`.

⚠️ **A table and not a fourth `matched_via` value**, for migration 0110's reason
one grain finer: `backfill-audiobook-holdings.mjs` upserts `matched_via =
excluded.matched_via` three times a day, so a verdict kept there survives
exactly until the next run. **A script-owned column cannot hold a human
decision.**

`audio_key` is the sibling catalog's **verbatim** title —
`audiobook_edition_holding.audio_key` = 0340's `raw_title`, falling back to
`title` where that is NULL, exactly as 0390's own copy statement derives it.
⚠️ A verdict recorded against the fallback key stops matching once a backfill
run fills in the real `raw_title`; the row survives and the recording simply
reads un-reviewed again. That is deliberate — the alternative, keying on
`work_id` alone, cannot tell the two *Elantris* recordings apart, which is the
whole reason 0390 exists.

Rows are never deleted (0003); re-deciding is an UPSERT.

**Write path:** `POST /api/works/:id/audio-review`, `editCatalog` — the same
gate every other edit-box write carries, and the same one the series-level twin
`POST /api/series/:name/audio-link` uses. Guarded against a key no cache row
carries, and that refusal is a worded 404.

**What a `rejected` verdict hides, and where the decision was made:**

| Reader | Filtered? | Why |
|---|---|---|
| shelf Audio rows (`shelf-view.ts`) | **yes** | done in the WEB, not server-side: one payload feeds both the shelf and the edit box, and the tab needs the rejected row |
| series ladder audio chip (`packages/db/src/series.ts`) | **yes** | the chip is now a flat claim — leaving it would assert what the owner said is false |
| `audioEditionCountSql` | **yes** | it is a claim of OWNERSHIP; a judged-wrong match is not a book we hold |
| `BINDING_CLAUSE.audiobook` (collection filter) | **yes** | "show me what I have on audio" |
| `free-details.ts` rung 1 | **yes** | it must not believe a rejected recording's series/volume — and it says so out loud in `skipped[]` |
| `routes/audiobook-mapping.ts` (machine export) | **yes** | its own header: *"better to answer nothing than to propagate a fact this catalog has already flagged as doubtful"* — applies harder to a match a person judged wrong than to a stale one |
| `getAudiobookHolding` / `listAudioEditions` | **no** | they CARRY the verdict. The edit box is where it is taken back, so it must see the row |
| `workDeletionReport`'s cache count | **no** | that dialog is about what CASCADE removes, and a rejected row is still removed |
| `reviews.ts` `/bookid-index`, `packages/db/src/tbr.ts` bridge | **no — open** | identity bridges into another catalog's documents. Arguably they should be filtered too; not changed here because it would silently move existing reviews/TBR entries and nobody has measured what it touches. ⚠️ Left as a known follow-up rather than done half-checked |

A `confirmed` verdict changes **words only**: the provenance sentence becomes
*"Confirmed by you as the right recording."* and the tooltip drops its hedge. It
cannot add a holding, raise a count or close a gap — like 0110, it only ever
annotates something already there.

#### 4.9.3 ⚠️ Two grains, two controls — and why the series half was left alone

| | grain | confirmed where |
|---|---|---|
| `audiobook_series_link` (0110) | one SERIES | `/series/<name>` — "Same series — I own these" |
| `audiobook_match_review` (0450) | one RECORDING of one WORK | the book's edit box → **Audio** tab |

A `fold` rung has **no `work_id`** — it is a volume this catalog does not hold —
so nothing in 0450 can reach it, and nothing in 0450 can move `maybeOnAudio`.
The Audio tab therefore **links** to the series page rather than growing a
second control.

⚠️ **`completeness.ts`'s *"N possibly on audio"* and `gapAudioLabel`'s fold
caption were deliberately NOT reworded**, even though the chip above them lost
its `?`. Those rungs are still counted as **MISSING** by the arithmetic, and
that file's own header warns that a rung the arithmetic has stopped calling
missing beside a caption that still hedges is one screen contradicting itself —
the inverse holds just as hard. Unhedging the words there is a change to the
COUNT, not to the wording, and it was not asked for.

---

### 4.10 🔴 A BARE title can be FURTHER from the audiobook than a decorated one — *Battle Mage Farmer*, 2026-09-05

**Owner, 16:37 Phoenix, verbatim:** *"I added battle mage farmer and it didn't
associate the audiobook right away."*

Two separate things were true, and the obvious fix was only the first of them.

**1. The title carried its own series and volume, against convention.** Work
526 was added as *"Battle Mage Farmer, Book 1: Domestication"* with
`series_index_display` `'Book 1'`. This catalog keeps both of those in COLUMNS:
work 221 is `The Primal Hunter` / series `The Primal Hunter` / display `1`, work
263 is `Dungeon Crawler Carl` / display `1`. Corrected to the bare title (batch
`owner-2026-09-05-battle-mage-farmer`, four fields including a `work_key` move —
`DONE.md` for why that was safe here).

**2. ⚠️ The retitle did NOT make the sweep match, and could not.** Measured
immediately after it landed: the dry run still listed the work under *"no
audiobook found"*. `cleanAudiobookTitle` reduces the CSV's *"Domestication - A
Fantasy LitRPG Adventure (Battle Mage Farmer, Book 1)"* to **"Domestication - A
Fantasy LitRPG Adventure"** — it strips the parenthetical series+volume and
keeps the publisher's subtitle, which is not decoration it knows about. So
containment compares 13 characters against 40:

| ours | theirs | ratio | vs the 0.6 floor |
|---|---|---|---|
| `battle mage farmer book 1 domestication` (39) | `domestication a fantasy litrpg adventure` (40) | — | not contained at all |
| `domestication` (13) | the same (40) | **0.325** | further under it |

🔴 **The lesson worth keeping: shortening a title moves it AWAY from a
containment match, not towards one.** "Fix the title and the sweep will find
it" is intuitive and wrong on this shape — the floor is a *ratio*, so the
shorter side of a substring pair is penalised. Both changes were needed and
neither substitutes for the other.

**The bridge is an asserted alias, not a lowered floor** — `seed-audiobook-
aliases.mjs`, whose header already argues this for the identical *"The Primal
Hunter - A LitRPG Adventure"* row (0.41) from the same publisher's subtitle
habit. One row added, `work_alias` 41 → 42, and the script proves an alias
reaches something before storing it. Result: matched 121 → 122, and the series
mapping went **`fold` → `work_match`** with 9 rungs, so *Battle Mage Farmer*
stopped being one of the two series that "map on the folded name alone".

⚠️ **This is why the answer to "it didn't associate right away" is never a
threshold change.** §4.3 and `matching.ts`'s header record what a second, looser
similarity rule cost the sibling Board Game Catalog: three wrong games shipped.

---

### 4.11 ⚠️ ONE PLANNER, TWO CALLERS — the sweep's decisions left `scripts/` — 2026-09-05

**The sentence to carry away:** `npm run backfill:audiobooks` no longer *makes*
the audiobook association decisions. It **renders** them. The decisions live in
`packages/core/src/audiobook-sweep.ts`, and the Worker route being built in the
later phases calls the same function over the same rows.

This is phase 0 of
[`catalog-platform/docs/info/audiobook-association-route.md`](../../../../catalog-platform/docs/info/audiobook-association-route.md),
which exists because of §4.10's owner report: *"I added battle mage farmer and
it didn't associate the audiobook right away."* The diagnosis there is that the
trigger is on the wrong side — the sweep fires when the AUDIOBOOK catalog
changes, and the owner changed the LIBRARY. Phase 0 builds nothing that fires;
it makes the decision code reachable from a place that can.

#### What moved, and what deliberately did not

| | Now lives in | Was |
|---|---|---|
| CSV parse + row mapping | `packages/core/src/audiobook-csv.ts` — `parseAudiobookCsv` | `scripts/lib/audiobooks.mjs` |
| The series-canon fold RULE | `packages/core/src/series-canon.ts` — `normText`, `buildSeriesCanonMap`, `canonicalSeriesIn` | `scripts/lib/series-canon.mjs` |
| The canon DATA, bundle-ready | `packages/universes/src/series-canon.ts` — `seriesCanonMap`, `seriesCanonEntryCount` | (new) |
| Phases 1 and 2 — every decision | `packages/core/src/audiobook-sweep.ts` — `planAudiobookSweep` | `scripts/backfill-audiobook-holdings.mjs` |
| The `lit()` SQL rendering | `scripts/lib/audiobook-sql.mjs` — `renderSweepStatements` | same script, inline |
| 🔴 **The matcher** | `packages/core/src/matching.ts` — **unchanged, unwrapped** | — |
| The disk read, the two D1 reads, the zero-row refusal, the printed report | **still the script** | — |

🔴 **The plan is DATA, not SQL,** and that is the hinge. The script interpolates
`lit()` strings through `wrangler d1 execute`; a Worker binds prepared
statements. A planner that returned SQL could only ever have had one caller — and
two callers deciding separately which audiobook belongs to which book is exactly
the drift `matching.ts` opens by blaming for three wrong games.

#### The measurement that says it worked

The acceptance test is that the script's dry-run output does not change by one
character. Captured before the first commit, re-run after the last, `--remote`
on **both** instances:

| | lines | works | matched | editions | series | statements | diff |
|---|---|---|---|---|---|---|---|
| main | 561 | 411 | 122 | 127 | 31 | 317 | **EMPTY** |
| padhard | 843 | 677 | — | — | — | 263 | **EMPTY** |

⚠️ **Byte-identical, not "identical apart from timestamps"** — the report block
prints no clock, which is what makes it usable as a diff instrument at all.
Dry runs only; `--commit` was not passed at any point.

#### ⚠️ The one behaviour difference, and which side is stale

`scripts/lib/series-canon.mjs` reads `catalog-platform/data/series-canon.json`
**live out of the sibling checkout**, because a hand-run script has no `prebuild`
step. A Worker cannot read across repos at runtime, so it reads the copy
`scripts/sync-universes.mjs` materialises into `packages/universes/generated/`.

**They can disagree, and when they do the ROUTE is the stale one** — its canon is
as fresh as the last deploy, the script's as fresh as the last `git pull`. That
is accepted, because the canon governs only phase 2's `fold`-vs-`work_match`
hedging and a missing canon already degrades to plain `normaliseTitle` by design.
The guard is `seriesCanonEntryCount`, which the sweep's `/api/health` line will
report: **zero is the number that means something**, because it says the bundle
shipped with no canon at all.

#### 🔴 `scope` — the guard that only matters once there is a route

`planAudiobookSweep` takes `scope: { kind: 'all' } | { kind: 'works', ids }`, and
the stale phases run **only** under `all`. The per-work hook will have looked at
one book, so it has no standing to say any other row is gone — and on a Worker
that mistake would mark every holding on both instances stale while looking
exactly like success. `packages/core/test/audiobook-sweep-scope.test.ts` pins it,
with a control test proving the same fixture *does* stale five rows under `all`,
so the guard test cannot pass vacuously.

⚠️ **A scoped run also refuses to write a `fold` rung**, which the design did not
cover and which is not the same question. A scoped run holds a fraction of the
evidence, so its `fold` verdict is an *absence* of proof rather than a weaker
proof — and `series_matched_via = excluded.series_matched_via` on every upsert
means writing it would **downgrade** a `work_match` rung a full sweep had already
earned. Those series are named in `report.foldSeriesDeferred` and left to the
cron.

#### What phase 0 does NOT do

**No route, no cron, no migration, no deploy.** Nothing under `apps/worker`
changed. ⚠️ The new modules are re-exported from `@lc/core`'s barrel, so they may
ride into the Worker bundle as dead code on the next unrelated deploy; nothing
calls them until phase B. 🔴 **The script is never retired** — it is the only path
that works when the Worker is down, it is the recovery tool
[`access/RECOVERY.md`](../access/RECOVERY.md) assumes, and it runs offline and
before a deploy against a checkout.

**Commits:** `965d226` (CSV) · `e307bc3` (loader) · `bb7af18` (canon) · `e2f4aee`
(planner) · `8f38125` (script + gate).

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
