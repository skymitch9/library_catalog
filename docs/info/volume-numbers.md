# Volume numbers — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-21** — §3b's counts were read from
> `library-catalog-2nd --remote` that day; §1–§9's were read from
> `library-catalog` and `library-catalog-2nd` (both `--remote`) on 2026-08-19
> and have NOT been re-measured since.
>
> ⚠️ **This document is the CANONICAL answer to "the volume bug".** The owner's
> words when it was written: *"We're wasting all our buffer usage on solving
> nonsense we've solved many times."* If a session is about to reason from
> first principles about `series_index_sort` versus `series_index_display`,
> stop and read this instead. The code comments in
> `packages/core/src/gaps.ts` point here rather than restating it.
>
> ⚠️ **It has come back TWICE, and the second time the rules were already
> right.** §3 is the completeness predicate (2026-08-19); **§3b is the ASK
> list (2026-08-21)**, a different half of the same pipeline. If the queue is
> full of volume numbers again, check which half before touching either.

---

## 1. The rules, with dates and provenance

| # | Rule | Authority |
|---|---|---|
| **R1** | **`series` + `series_index_sort` = COMPLETE.** A work with both owes nothing on the volume number. | Owner, 2026-08-19: *"We don't need physical volume if we have series. Only a few things have it like the 2 part Sanderson. Make it optional."* |
| **R2** | **`series_index_display` is OPTIONAL DATA, never a gap.** It records the designation a particular printing *physically carries* — *"Volume 07"*, *"Prequel"*, *"Book Two"*. Most of this catalog is EPUB files, which mostly carry none. | Same. |
| **R3** | **Nothing derives a printed form.** Research writes it only when a finding **quoted one verbatim**; a bare number fills the sort and nothing else. | Owner, 2026-08-19, on the honesty of provenance. |
| **R4** | **Research findings for the volume number AUTO-APPLY**, like every other detail field. | Owner, 2026-08-19: *"this volume bug is annoying, you've been right every time about volume. Can we figure that out? Just apply it"* |
| **R5** | **`series_index_sort` IS the volume.** There is no second volume concept in the default case; the displayed position is the series index. | Owner, 2026-08-19: *"series == volume unless human intervention on the ui or by me telling you there is 2 books sharing 1 series slot as 2 volumes."* |
| **R6** | **The exception is a HUMAN-ONLY flag**, `work.multi_volume_printing` (migration 0360): *one position in the reading order, printed as more than one physical book*. Set by the checkbox in the book edit panel, or by the conductor on the owner's explicit word. ⚠️ **Research, the donor and every sweep are blind to it.** | Owner, 2026-08-19: *"make it a check box in the book edit for this book is the same spot in the series but has multiple volumes."* |
| **R7** | **Where R6 is true the printed form is MEANINGFUL** (*"Vol 1 of 2"*); where it is false the printed form is noise, because the index already said everything. | Same. |
| **R8** | **A sort with no series is still a gap.** *"Which volume is this?"* is not a question you can ask a standalone; a printed number that files nowhere sorts to the end as if unnumbered. | `detailFieldsFor`, unchanged since 2026-08-10. |

## 2. The two columns, and what each is for

| Column | Type | Job | Required? |
|---|---|---|---|
| `series_index_sort` | REAL | **Where the book files in the line.** `1`, `2`, `2.5` — a novella between two novels is why it is REAL and not INTEGER. | **Yes**, once a series is known. This is the whole question. |
| `series_index_display` | TEXT | **What a printing physically prints**, quoted. *"Volume 07"*, *"Prequel"*, the two-part Sanderson leatherbounds. | **No.** Kept where it exists, fillable by hand or by a finding that quotes one, never demanded. |

## 3. ⚠️ The history — and why the obvious fix is the wrong one

**Do not re-tighten the predicate to require both columns.** It was that way
from 2026-08-13 to 2026-08-19, the reasoning reads persuasively, and a future
session will re-derive it. Here is what happened.

| Date | What | Result |
|---|---|---|
| 2026-08-13 | 22 works found with `sort` set and `display` NULL — filing correctly, printing nothing, and the gap test (then `sort == null`) reported **zero gaps** for all of them. | `seriesIndexIncomplete` widened to demand **both** columns. |
| 2026-08-13 → 08-19 | Nothing downstream of `routes/ingest.ts` ever wrote `display`. Not research (`applyFinding` wrote the sort only), not the donor (`donorDetailsFor` withholds it), no backfill. | Every research-filled volume number left its gap **permanently open**. |
| 2026-08-19 | Owner: *"Sam has 55 missing details, the button didnt fix."* Measured on `library-catalog-2nd`: **55 of 74 works on the queue, 55 of 55 of them `seriesIndex`.** ~45 paid lookups that afternoon had all succeeded. | The predicate was the bug. |
| 2026-08-19 | R1–R8 above, including the human-only multi-volume flag (§3a). | Predicate reads the sort alone. |

⚠️ **The 2026-08-13 diagnosis was correct; only the remedy was wrong.** The
mirror state it found — `display` set, `sort` NULL — really is a gap, and R8
still catches it. What was wrong was demanding a fact about a physical printing
from a catalog of files.

⚠️ **The `:07` sweep tick on 2026-08-19 is the evidence in one row.** On the old
code it spent real money on two books, succeeded on both —
`{"proposed":1,"applied":1,"detail":"Filled in 1 of 1: Volume number set to 1
(sorts correctly; the printed form still needs a person)."}` — and left both on
the queue. It also recorded `seriesIndex` as *asked*, so `planSweep` would never
have offered either book again: **a run that worked stranded the book it worked
on.** Both closed the moment R1 landed.

## 3b. ⚠️ The COMPANION ASK — the volume bug's second act (2026-08-21)

**Owner, 2026-08-21:** *"why we're getting messages in missing details about
missing volume number … didn't I already say to set it to series number unless
specified"*.

**The rules of §1 were intact and correctly implemented.** `seriesIndexIncomplete`
read the sort alone, the printed form was never demanded, the multi-volume flag
was still human-only. **The queue filled up with volume numbers anyway**, for a
reason §3 does not cover: not what is *owed*, but what is *asked*.

### What was measured, on `library-catalog-2nd` (padhard)

| | |
|---|---|
| works | 127 |
| rows still owing anything | **36** |
| of those, `seriesIndex` | **36 — every one** |
| `series` / `description` / `firstPublished` gaps | **0 / 0 / 0** |
| runs that had asked `series` | **126** |
| runs that had ever asked `seriesIndex` | **11** |
| of the 36, ever asked the volume question | **0** |

### The mechanism

`detailFieldsFor` will not ask *"which volume is this?"* of a book with no
series — correct, and §3 of `gaps.ts` explains why it must stay that way for the
OWED list. But the **ASK list was the same list**, so a run sent to find a
book's series came back, wrote the series, and thereby **created a brand-new
volume gap that needed a second paid lookup**. Fill 126 series, manufacture 126
volume questions. The queue could not converge; it could only change shape.

⚠️ **And the number had already been bought.** Run **#135**, work 100
*Summoned to the Wilds*, sent for `firstPublished, series, description`, wrote
this into its own `result_json`:

> `"Filled in 3 of 3: First published set to 2022. Series set to Villains and`
> `Virtues. Description saved. `**`Villains and Virtues #2`**` by A. K. Caggiano…"`

One search, one page fetch, **two invoices** — and the row still read *"missing
volume number"* on the queue afterwards. The volume number was in the answer
and was discarded because `seriesIndex` was not on that run's ask list.

### R13 — the series and its volume number are ONE question, bought once

`detailAsks` (`@lc/core`, `gaps.ts`) returns `detailGaps` **plus `seriesIndex`
whenever `series` is being asked in the same call**, in `DETAIL_FIELDS` order.

| Where | Uses | Why |
|---|---|---|
| `claimRun` → `gapsAndAsksFor` | `asks` for the fields sent and the `unfilled` stamp; **`missing`** to decide there is anything worth paying for | Gating on `asks` would let the companion question alone start a paid run |
| the sweep's donor rung | `asks` | A donor handing over the series hands the number with it, free |
| `planSweep`'s subrequest budget | `asks` | It must price what the run actually sends, or it undercounts by a field and blows the 50-subrequest ceiling |
| `gapsFor`, `listWorksNeedingDetails().missing`, `gapSummary`, the queue page | **`missing`, unchanged** | — |

⚠️ **This does not reopen anything in §1–§3.** It widens what gets *asked*,
never what is *owed*. `seriesIndexIncomplete` still reads the sort alone; the
printed form is still optional data and still never a gap. **Do not "simplify"
`detailAsks` into `detailFieldsFor`** — that puts *"missing volume number"*
under every standalone in the catalog and hands a model a blank to invent a
series for, which is the failure `detailFieldsFor` exists to prevent.

The apply side needed no change and never had: `applyFinding` already refuses a
`seriesIndex` whose work has no series, and `autoApplyFindings` already sorts by
`DETAIL_FIELDS` so `series` lands first. The comment there — *"`autoApplyFindings`
orders `series` ahead of this one so the ordinary case never lands here"* — was
describing a case that could not yet happen. Now it can, and it works.

**Guard:** `packages/core/test/detail-asks.test.ts`, 7 tests, including one that
pins `detailGaps` as untouched.

**What was NOT done:** the 36 already-stranded rows were left to the hourly
sweep, which asks the volume question of a book that already has a series and
was already draining them (runs #137, #141, #142 on 2026-08-22 UTC). At 2/hour
that is ~18 hours. Nothing was hand-filled and no backfill was run.

---

## 3a. ⚠️ The multi-volume flag — the one field no machine may write

`work.multi_volume_printing` (migration 0360, `INTEGER NOT NULL DEFAULT 0`,
`multiVolumePrinting` in app shape). **False on every existing row**, which is
the truth for all but a handful.

**What it means:** this entry sits at ONE series position and was printed as
more than one physical book. The two-volume leatherbound of *Words of Radiance*
is the standing example; *"part 1 of 2"* printings are the general class. It is
NOT "this is an omnibus", NOT "the audiobook is split in two", and NOT "there
are two editions" — each of those is a different fact with its own home.

⚠️ **It is human-only, and the guard is mechanical.** A model asked *"is this a
two-volume printing?"* answers confidently and wrongly for any book with a
part-1-of-2 audiobook, a boxed set or an omnibus, and nothing downstream could
catch it — no title string to compare, no second source to corroborate. Same
argument that keeps `isbn13` off the research list
([`research-and-gaps.md`](research-and-gaps.md) §2).

| Door | Open? | Pinned by |
|---|---|---|
| The checkbox in `WorkFields` | **Yes** — the only one in the product | — |
| `updateWorkSchema` | Yes, boolean, both directions | `multi-volume-flag.test.ts` |
| `createWorkSchema` | **No** — no importer, scan or ingest may originate it | same |
| `DETAIL_FIELDS` / `detailGaps` | **No** — it is never a gap and never reaches the queue or the sweep | same |
| `applyFinding` | **No** — its patch object names four columns and cannot name a fifth | `research-run.ts` header rule 3 |

**Candidates for the owner to tick — NOT ticked, deliberately.** Searched both
instances 2026-08-19 for `part 1/2`, `vol N of M`, `leatherbound`, and for two
works sharing one series slot:

| Instance | Row | Evidence | Verdict |
|---|---|---|---|
| main | **#220 *Words of Radiance*** (The Stormlight Archive 2) | **two `hardcover` editions** recorded on one work — consistent with the two-volume leatherbound, and it is the class the owner named | ⚠️ **Not ticked.** Two hardcovers is equally consistent with a trade hardcover *plus* a leatherbound, i.e. two printings rather than one printing in two volumes. Only somebody holding them can say. |
| main | — | no two works share a series slot; no title or edition path matches the part-of-N patterns | nothing to tick |
| friend | — | same searches, no matches | nothing to tick |

⚠️ Noted in passing, not touched: works **#3 (*Dragonsteel Prime*)** and **#8
(*Firstborn / Defending Elysium*)** both carry `series_index_sort = 1` with
`series` NULL. Harmless under R8 (no series, so the volume question is not
asked), and previously recorded as un-investigated in
[`research-and-gaps.md`](research-and-gaps.md) §3.1.

## 4. Where a printed form actually comes from

| Writer | Writes `display`? | Notes |
|---|---|---|
| `routes/ingest.ts` | **Yes — `Book <sort>`**, on every work it creates with a volume number | ⚠️ A **legacy default**, not the semantics. Kept because changing it would change how newly imported books read on the shelf. `seriesIndexDisplayFrom` in `@lc/core` holds the literal so it exists in one place; **nothing new may call it.** |
| `applyFinding` (research / donor) | **Only when the finding quoted one** — a value like `"Volume 07"` rather than `7` | The quoted string is stored verbatim; `asIndex` reads the number out of it for the sort. A value with no number at all (*"Prequel"*) is refused as unusable and left pending, because where it files is a judgement. |
| A person | Yes, via the work update contract | ⚠️ `WorkFields` deliberately offers no box for it — the sort is editable there and the display is not. See §6. |

**Measured on the main instance, 2026-08-19** — 270 works hold both columns:

| Shape of `display` | Count | Where it came from |
|---|---|---|
| the bare sort number (`3`) | 184 | ingest's legacy default |
| something else (`Volume 07`, `Book 1`) | 81 | the **title string** — `High School DxD - Volume 07 - …` |
| numerically equal, differently written | 5 | mixed |

⚠️ **None of it came from anybody reading a cover.** The older comments in this
repo describe `display` as *"what the cover actually says"*; that is what it is
*for*, not where it has ever come from. Do not cite it as provenance.

## 5. Provenance and undo

Nothing here changes the ordinary discipline:

- writes go through `updateWork`, so every one lands in `change_log`;
- machine writes are stamped `decided_how = 'auto'`;
- `revertFinding` clears the sort, and clears the display **only when it still
  holds that finding's own quoted value** — a hand-typed *"Prequel"* matches no
  finding and survives an undo;
- undoing a `series` takes the volume number with it, since a volume number
  cannot outlive its series.

## 6. Known, deliberate, and NOT to be "fixed" without asking

- **`WorkFields` has no display box.** Its comment: offering the two as one box
  invites typing *"Book 2"* into a numeric column. Under R2 that matters less
  than it did, but adding the box is a UI decision, not a tidy-up.
- **`routes/donor.ts` will not donate a display.** Its stated reason (*"the
  caller's copy of the book has its own cover"*) is now the odd one out, and the
  main catalog holds 81 hand-quoted forms that are strictly better than
  anything the friend instance can derive. Logged in `docs/TODO.md`; it needs a
  key wider than `DetailField`.
- **`seriesIndexDisplayFrom` has exactly one caller** and should keep exactly
  one. It is ingest's history, not a rule.

## 7. What to check before believing any of this again

```bash
# Works still owing a volume number, by the CURRENT rule (sort only):
npx wrangler d1 execute library-catalog-2nd --remote --env friend \
  --config apps/worker/wrangler.toml --command \
  "SELECT COUNT(*) FROM work w
    WHERE w.series IS NOT NULL AND trim(w.series) <> ''
      AND w.series_index_sort IS NULL
      AND NOT EXISTS (SELECT 1 FROM gap_verdict g
                       WHERE g.work_id = w.id AND g.field = 'seriesIndex')"
```

Drop the `--env friend` and use `library-catalog` for the main instance.

---

## 9. The hand-fill of 2026-08-19, and the four rules it added

Same day, hours after the rules above landed, the owner emptied the friend
instance's volume queue **by hand** rather than by lookup: *"Fix them by
hand"*. 49 books numbered, 1 recorded as standalone, 1 boxed set split into
three. **51 waiting to 0 waiting**, no research spend.

### R9 — a novella between two numbered books gets `.5`

Owner, asked one at a time and answered *"Yes 17.5 is fine, 3.5 is fine"*:

| Book | Sort | Why |
|---|---|---|
| *Side Jobs* (Dresden) | `12.5` | Collection published between *Changes* (12) and *Ghost Story* (13). |
| *Out Law* (Dresden) | `17.5` | Its own blurb places it after the Battle of Chicago — i.e. after *Battle Ground* (17). |
| *Spectacular* (Caraval) | `3.5` | An explicitly post-series holiday novella; *Finale* is 3. |

⚠️ This is a **convention, not a lookup**. A session that finds a novella with
no number should propose the `.5` and ask, not research it — the answer is a
decision about this catalog's ordering, and no source can settle it.

⚠️ **R9 also covers a printed book that is the SECOND HALF of a numbered one**
— a serial whose print line splits one Book into two paperbacks. Part 1 takes
the integer, Part 2 takes `N.5`, and the mapping that decides which is which is
a research question with an answer, not a convention. Worked case, with the
publisher's sources and the `completeness.ts` measurement that rules out the
obvious `N.1` / `N.2` alternative: [`serial-print-splits.md`](serial-print-splits.md)
(*The Wandering Inn*, 2026-09-02). **No rule here changed to accommodate it.**

### R10 — "standalone" is an ANSWER, recorded as a verdict, never a digit

*Tusk Love* is the Critical Role tie-in novel; **"Critical Role" is a shelf
label, not a numbered series**. It carries a `gap_verdict` row
(`field='seriesIndex'`, `verdict='none'`) rather than a fabricated `1`.

⚠️ **Why this matters more than it looks.** A blank is indistinguishable from
an unanswered question, so a genuinely unnumbered book would sit on the queue
for ever, and a fake `1` would read as fact. The verdict row is the only shape
that says *"asked and answered: there is no such number"*.

### R11 — a boxed set is a CONTAINER: split it, keep it, and let `collects` say so

Owner: *"We need to split the box set up most likely"*, then *"Look up the isbn
for the box set and then find the ISBNs inside of it and use that to split it
up"*. What was done to work 50, as the pattern for the next one:

1. **The set's own ISBN was looked up first.** Open Library returns
   `9781250259530` = *Caraval Paperback Boxed Set*, **subtitle "Caraval,
   Legendary, Finale"** — the container names its own contents, which is what
   makes the split evidence rather than a guess.
2. **Three new works**, keys from `workKeyFor()` itself — never hand-typed,
   because a wrong key silently fails to match her reviews and read states.
3. **One edition each, every ISBN verified before use** (Open Library,
   2026-08-19): Caraval `9781250095268` (2018, 448pp) · Legendary
   `9781250095329` (2019, 512pp) · Finale `9781250157683` (2020, 512pp).
   ⚠️ `9781250157669` was **rejected** for Finale — it is the hardcover, and
   this is a paperback set. A search summariser also volunteered
   `9781250157676` while only echoing the number back out of the question;
   that is not evidence and was not used.
4. **The set row STAYS**, joined by `work_relation` `contains` — deleting it
   would lose the fact that three books arrived as one purchase — and its
   edition's **`collects`** column now reads *"Caraval, Legendary, Finale"*.
   That column exists for exactly this (see `schemas.ts`, the White Sand rows).
5. **The set gets a `none` verdict** on `seriesIndex`: a container has no
   volume number, and per R10 that must be said rather than left blank.

### R12 — a hand fill is `changed_how = 'human'`, and says whose knowledge it was

All 49 numbers were written with `changed_how='human'`, batch
`hand-volumes-20260819`, one `change_log` row each so any single one can be
reverted. The note records the honest basis: *conductor knowledge of the
series, not a quoted source.*

⚠️ **Never label a hand fill `'auto'`.** `'auto'` means a finding with a source
behind it. Filing knowledge-from-memory under it would corrupt the one signal
that tells a later reader how much to trust a value — and R3 exists precisely
because provenance is the thing being protected.

**One fact came free.** *Twelve Months* needed no decision at all: the
description already in her catalog says *"The eighteenth Dresden Files
novel"*. ⚠️ Look at what the row already holds before proposing a lookup for
it — the answer had been sitting in the record.

### What the split left behind, on purpose

Splitting created three works with no description, so the queue read **3
waiting** immediately afterwards. That is correct and self-clearing: the
hourly sweep fills descriptions two an hour. ⚠️ Expect a small rise in the
queue after any split — it is new books arriving, not the fix failing.
