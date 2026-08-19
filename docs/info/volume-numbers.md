# Volume numbers — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-19** — every count was read from `library-catalog`
> and `library-catalog-2nd` (both `--remote`) that day.
>
> ⚠️ **This document is the CANONICAL answer to "the volume bug".** The owner's
> words when it was written: *"We're wasting all our buffer usage on solving
> nonsense we've solved many times."* If a session is about to reason from
> first principles about `series_index_sort` versus `series_index_display`,
> stop and read this instead. The code comments in
> `packages/core/src/gaps.ts` point here rather than restating it.

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
