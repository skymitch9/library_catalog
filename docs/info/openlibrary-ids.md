# Open Library work ids — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10**. Every figure below is a **measured dry run
> against the production database** on that date — 116 works, ~300 live calls to
> openlibrary.org. Nothing here is an estimate.
>
> **Not verified:** nothing had been written to production when this was
> written — the run was `--remote` without `--commit`.
> ⚠️ **2026-09-02:** the pointer to `docs/HANDOFF.md` "for the pending command"
> is gone with that file. The command is `npm run backfill:openlibrary-ids --
> --remote --commit` and it is documented where it is run from,
> [`../access/README.md`](../access/README.md).

`work.openlibrary_work_id` was **0 of 116**, and that one empty column was the
named blocker in two places: `migrations/0003_series_completeness.sql` lists
`openlibrary` as a legal `series_volume.source` and then says *"No rows yet; no
work here has an `openlibrary_work_id`"*, and `scripts/backfill-series-volumes.mjs`
is stuck on a single rung — the sibling audiobook catalog, which has never heard
of **13 of this library's 25 series**.

---

## 1. The headline

`npm run backfill:openlibrary-ids -- --remote`, 2026-08-10:

| | |
|---|---|
| works | **116** |
| **matched, corroborated beyond title+author** | **35 (30%)** |
| searched, **not found** | **68 (59%)** |
| outliers for hand review | **13 (11%)** |

**30% is the honest number and it is close to the number to expect.**
`isbn-ladder.md` §4.2 measured that roughly half this library is absent from
Open Library, and that measurement was taken over a sample spanning the whole
*audiobook* catalog. This catalog's ebook half is skewed harder toward the
material Open Library covers worst — **38 of the 116 files name Baka-Tsuki as
their publisher**, which is to say a third of this catalog is light-novel fan
translation with no commercial English edition to have a record. The misses are not query failures; see §5.

⚠️ **Do not read 30% as a target to improve by loosening anything.** Every one of
the 35 has a fact about the *printing* agreeing, not just a name. The three
levers that would raise the number — free-text search, a lower similarity floor,
accepting title+author alone — are each measured elsewhere in these docs to buy
hits with wrong books.

---

## 2. The bar: what "matched" is allowed to mean

`isbn-ladder.md` §4.4 is the whole reason this file exists. Open Library answered
"Firefight" + "Brandon Sanderson" with a **different** book called Firefight —
Random House, 2001 — scoring **1.0 on title and 1.0 on author**. No threshold
separates that from the truth because there is nothing textual to separate. Only
the publisher and the year did.

So the rule, encoded in `packages/core/src/corroboration.ts`:

> **Title and author agreement is the entry ticket, never the verdict.**

| | Corroborator | Why |
|---|---|---|
| strong | `isbn` | the artefact naming itself, not a search result |
| strong | `publisher` | the discriminator §4.4 says was the only one that worked |
| strong | `series+volume` | our series name **and** our volume number on one edition label |
| weak | `series` | the name alone; a sequel or a boxed set shares it |
| weak | `year` | one year in a plausible range is a coincidence, not proof |

One strong, or two weak, is a match. One weak is an outlier. Zero is a rejection,
however perfect the name.

### ⚠️ The edition *title* is deliberately not a series corroborator

The first run reported, for *What If Everybody Said That?*:

```
an edition is labelled "What if everybody said that?" — our series
```

Its series in this catalog is *What If Everybody?*, which is a subset of its own
title, so the "series" corroborator was firing on the title match restated in the
voice of an independent one. `series` and `subtitle` feed that pool now; `title`
does not. That work is an outlier as a result, and correctly so — the only thing
agreeing beyond its name is the year.

The same tautology is refused on the other rung: an ISBN lookup does **not** count
"the ISBN matches" as corroboration, because the work was found *by* that ISBN.

---

## 3. The two rungs, and what each yielded

| Rung | Source | Matched |
|---|---|---|
| 1 | the EPUB's own `<dc:identifier>` ISBN → `/isbn/<isbn>.json` → `works[0]` | **16** |
| 2 | fielded title+author `search.json`, gated, then corroborated on `/works/<key>/editions.json` | **19** |

There is deliberately **no free-text rung.** §4.3 measured it buying one extra hit
with two wrong answers, one of them the wrong *volume* of the right series — the
worst failure this catalog can have, and the last thing to invite into a script
that writes a column unattended.

### ⚠️ 3.1 The finding that made rung 1 possible: the files have ISBNs

Every doc in this repo says this catalog has no ISBNs, and every one is right
about the **database**: `edition.isbn13` is 0 of 117. But `covers-and-series.md`
§1's lesson — *the file knows more than the catalog does* — holds here too.
Measured over all 116 EPUBs on 2026-08-10:

| The EPUB's OPF declares | Files |
|---|---|
| `dc:publisher` | **111** |
| `dc:date` with a four-digit year | **108** |
| `dc:identifier` that is a **checksum-valid ISBN-13** | **24** |

**23 of those 24 ISBNs resolved to an Open Library work.** That is the strongest
rung in the project (9/10 by ISBN, §2) firing on rows everyone had written off as
unreachable. `scripts/lib/epub.mjs` now returns `publisher`, `year`,
`identifiers` and `isbn13`; nothing else changed in it.

And note what the other two columns bought: with 111 publishers and 108 years,
**the discriminators §4.4 demands exist for almost every row** — but only inside
the files. `work.first_published` is null on all 116.

### 3.2 How the 35 break down

| Corroborated by | Works |
|---|---|
| `isbn(file)` + publisher + year + title | 8 |
| publisher + series+volume | 7 |
| publisher + year | 5 |
| `isbn(file)` + title | 5 |
| publisher + series+volume + year | 4 |
| `isbn(file)` + publisher + series + year + title | 2 |
| publisher | 2 |
| `isbn(file)` + publisher + series+volume + year + title | 1 |
| publisher + series + year | 1 |

`publisher` appears in **30 of 35**. It is doing most of the work, exactly as
§4.4 predicted it would have to.

---

## 4. ⚠️ Matches rejected despite a perfect title AND author score

These are the most valuable lines in the run, because every one of them is the
Firefight shape and every one would have been written by a matcher that stopped
at similarity:

| We hold | Open Library offered | Why it was refused |
|---|---|---|
| *A Killer's Mind* — Mike Omer, Thomas & Mercer | `OL24214563W` "Killer's Mind, A", **Brilliance Audio** 2018 | the **audiobook** edition as a separate work; only the year agreed |
| *The King Tides* — James Swain | `OL19751912W`, **Brilliance Audio** 2018 | same shape; year only |
| *Dungeon Born* — Dakota Krout, Mountaindale Press | `OL32779438W`, **CreateSpace** 2016 | nothing agreed at all |
| *Dungeon Born* | `OL24344466W` "Dungeon Born Lib/E", **Tantor Audio** 2017 | the library-edition audiobook; nothing agreed |
| *Unsouled* — Will Wight, Hidden Gnome Publishing, 2016 | `OL32733864W`, **Riyria Enterprises LLC**, Mar 2023, ISBN 9781943363339 | ⚠️ a **different 2023 book also called Unsouled**. Title **1.0**, author **1.0**, and nothing about the printing agreed. **This is §4.4 happening again, live, in a different series two days later.** |
| *The Emperor's Soul* — Brandon Sanderson | `OL44902227W`, no publisher, no year | a stub record with nothing to check |
| *John* — The Navigators | `OL29246567W`, **TH1NK** 2013 | wrong imprint edition; nothing agreed |
| *What If Everybody Said That?* | `OL19749952W`, **Two Lions** 2018 | our file says no publisher; year only |
| *Beautiful Exiles* — Meg Waite Clayton | `OL19753291W`, **Amazon Publishing** 2018 | our file says **Lake Union Publishing**, which *is* an Amazon imprint — but nobody has written an imprint table, so the honest answer is no |
| *Undead Knight* — Erik Colombe | `OL29904548W`, Independently Published 2019 | year only. `covers-and-series.md` §3.1 already recorded this title as having essentially no metadata anywhere |

The *Unsouled* line is the one to remember. It is a second, independently
observed instance of the exact failure §4.4 documents — and the only thing that
stopped it was a publisher comparison.

### 4.1 Contested — Open Library holds real duplicate work records

Ten works had **two** corroborating Open Library records. All ten are Will
Wight's, and in every case both records are genuine duplicates of the same book
in Open Library's own data, not two different books:

```
Blackflame   won OL39444044W [publisher, series+volume]   lost OL22094140W [publisher, year]
Unsouled     won OL20781727W [publisher, series+volume, year]  lost OL36392741W [publisher, series+volume]
Dreadgod     won OL28158998W [publisher, series+volume, year]  lost OL44581456W [publisher, series+volume]
…and Bloodline, Ghostwater, Reaper, Uncrowned, Underlord, Waybound, Wintersteel
```

The winner is the one with **strictly more** evidence agreeing, and the runner-up
is written into that entry's `evidence` array so the choice is auditable. A true
tie is **not** broken: *Skysworn* is recorded `ambiguous` rather than guessed,
because edition count and record age are facts about Open Library's housekeeping,
not about which book we own.

⚠️ The residual risk here is low but real: we may have picked the less canonical
of two records for the *same* book. That costs a slightly worse editions list; it
does not file the wrong book.

---

## 5. The 68 misses are misses, not query failures

Grouped by author, they are almost entirely the population `isbn-ladder.md` §4.2
predicted:

| Author | Missing | What they are |
|---|---|---|
| Ichiei Ishibumi | 15 | *High School DxD* — Baka-Tsuki fan translations |
| Shimizu Yuu | 12 | *Blade Dance* volumes with no ISBN in the file |
| Selkie Myth | 12 | *Beneath the Dragoneye Moons* — Kindle-native |
| Michael-Scott Earle | 8 | self-published LitRPG |
| Dakota Krout | 5 | Mountaindale Press titles Open Library lacks |
| Travis Deverell | 5 | *He Who Fights with Monsters* — see below |
| everyone else | 11 | one each |

**66 of the 68 returned literally zero search results.** The query is not the
problem; the record does not exist.

### Three misses that are ours, not Open Library's

These are worth fixing in *this* catalog rather than re-querying:

1. **He Who Fights with Monsters (5 works)** — filed here under **Travis
   Deverell**. Open Library files the series under the pen name **Shirtaloon**,
   and the author gate correctly refuses to connect them. This is precisely what
   `work_alias` and an author alias exist for; it is a fact about the world, not
   something to compute.
2. **White Sand** — `work.authors` is *"Julius Gopez Rik Hoskin"*, the artist and
   the scriptwriter. Open Library returned three candidates and the author gate
   refused all three, correctly. Brandon Sanderson is not in the field.
3. **Onyx Storm** — stored as *"Onyx Storm (The Empyrean)"*. The fielded query
   goes out with the parenthetical still attached and returns **zero**;
   `cleanAudiobookTitle` only strips a parenthetical containing "Book"/"Volume"/
   "Series", and `cleanTitleWithSeries` only strips a *trailing separator* form,
   not a bracketed one. `covers-and-series.md` §3.1 already recorded this exact
   title defeating `matchIndexedWork` for the same reason. Even with a clean
   query the gate would refuse: "Onyx Storm" against our stored title scores
   0.67, under the 0.7 spine floor.

None of the three was worked around in code. Widening a strip or dropping a floor
to catch three rows is how the wrong-book bugs in `matching.ts`'s header got
shipped.

---

## 6. The 13 outliers, and the one decision that settles seven of them

`scripts/openlibrary-ids.json` carries all of them with `verdict: "needs_review"`
or `"ambiguous"`, a named candidate id, and what was tried.

**Seven are one question.** Volumes 5, 8, 9, 11, 12, 13 and 14 of *Seirei Tsukai
no Blade Dance* each carry the **Japanese original's** ISBN in a Baka-Tsuki
English fan translation. Each resolved cleanly to an Open Library work — but
those works are the Japanese editions, titled in Japanese, published by
Media Factory, and **nothing textual or bibliographic agrees** with what this
catalog holds.

⚠️ Four sibling volumes — 4, 6, 7 and 10 — *were* matched, only because their
Open Library records happen to carry a bracketed English subtitle
(`[The Awakening of the Demon King]`) that scored against our title. **That
inconsistency is an artefact, not a judgement.** All eleven are the same
question, which is a question for a person and not for a script:

> Is the English fan translation of volume N the same *work* as the Japanese
> volume N, for the purpose of this column?

Open Library's own model says yes — a work spans its translations. If the owner
agrees, all eleven belong in the ledger as `"manual": true` entries and the four
automatic ones should be relabelled to match. If not, all eleven should be
`not_found` and the four current matches removed.

The remaining six: *Beautiful Exiles*, *John*, *The King Tides*, *Undead Knight*,
*What If Everybody Said That?* (each one weak corroborator only — see §4) and
*Skysworn* (a genuine two-way tie).

---

## 7. What the 35 ids unlock

The point was never the column. It was the rung that could not fire without it.

`scripts/backfill-series-volumes.mjs` can now call
`/works/<key>/editions.json` — `editionsOfWork()` in `packages/isbn/src/works.ts`
— for the works that have an id, and `series_volume.source = 'openlibrary'` is
already legal in migration 0003. Coverage of *series*, which is what that rung
actually needs:

| Series | Works with an id | The sibling catalog knows it? |
|---|---|---|
| **Cradle** | 11 of 12 (*Skysworn* is the tie) | **no** — one of the 13 it has never heard of |
| Secret Projects | 5 of 5 | no |
| The Last Horizon | 1 of 3 | no |
| The Completionist Chronicles | 1 of 4 | yes |
| The Divine Dungeon | 1 of 2 | yes |
| Legion | 2 of 2 | no |
| Blade Dance | 4 of 23 (see §6) | no |
| **all series** | **8 of 25 have at least one id** | 12 of 25 |

**Cradle is the case that matters.** Twelve works, no audiobook counterpart, and
`covers-and-series.md` §3.1 recorded that Open Library's edition records were
what settled all six Cradle series labels during the series backfill — reached by
hand, one at a time, because there was no id to call with. There is now.

⚠️ It still cannot assert a series *length*. `series_check.known_total` stays NULL:
Open Library lists the printings it happens to hold, which is a floor and not a
total, exactly as the sibling catalog's highest volume is a floor. Migration
0003's rule does not bend because a new source arrived.

---

## 8. Running it

```bash
npm run backfill:openlibrary-ids                    # dry run, LOCAL database
npm run backfill:openlibrary-ids -- --remote        # dry run, production, read-only
npm run backfill:openlibrary-ids -- --remote --commit
npm run backfill:openlibrary-ids -- --retry-misses  # re-ask only the 68 not_founds
npm run backfill:openlibrary-ids -- --refresh       # re-ask about everything
```

**Idempotent, and it means it.** A second run reads `scripts/openlibrary-ids.json`,
makes **zero** network calls and writes nothing — verified 2026-08-10.

⚠️ **The ledger is written by a dry run**, unlike the database. It is research
notes, and the whole point of writing down a dead end is that you did not have to
commit anything to learn it. `--no-ledger` opts out.

⚠️ **An entry with `"manual": true` is never overwritten**, not even by
`--refresh`, and it wins a collision outright. Same rule as
`scripts/series-overrides.json`.

### Two traps this run paid for

**`edition.source_url` is not the same shape in both databases.** Production
stores `Author Folder/Title.epub`; the local dev database stores the bare
filename. Resolving only the stored path made every EPUB lookup fail locally —
**silently**, returning `{}`, which deleted every publisher and year
discriminator and made the script reject a correct Thomas & Mercer match as
"corroborated by NOTHING". There is a basename index fallback now, and the run
prints a loud count of works whose file it could not read, because "we could not
check" must never be reported as "Open Library does not have it".

**Open Library's `search.json` still returns `series: null` for everything.**
`covers-and-series.md` §3.1 measured this over 37 works and it has not changed.
Every series corroborator in this run came from `/works/<key>/editions.json`,
from the `series` and `subtitle` fields.
