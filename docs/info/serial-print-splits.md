# Serial-to-print splits — when one reading position is two physical books

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-09-02** — the publication structure in §2 was read that
> day from the author's own store, the publisher's listings and the four ISBNs
> already in our `edition` rows; the catalog state in §4 was read from
> `library-catalog --remote` the same day.
>
> ⚠️ **This document does NOT contain rules.** The volume rules are R1–R13 in
> [`volume-numbers.md`](volume-numbers.md) and live there only. This is the
> **mapping** — what a publisher actually did — plus the arithmetic that decides
> which sort value R5 and R9 imply for it. If you are about to reason from first
> principles about `series_index_sort`, read that file, not this one.

---

## 1. The class of problem

A web serial numbers itself in **Volumes**. Its commercial editions renumber
into **Books**, and its print line then splits a Book into **Parts**, because a
900-page paperback does not bind. Three numbering systems, all called "volume"
by somebody, none of them agreeing.

**The catalog holds one number per work**, `series_index_sort`, and R5 says that
number *is* the position in the reading order. So the job is always the same:
work out which reading position each physical book occupies, and give the second
and later parts a fractional position under R9.

⚠️ **The failure this prevents is not cosmetic.** `seriesCompleteness` scans the
**integer** line between the lowest and highest position owned
(`isPosition = Number.isInteger`, `completeness.ts`). Put a print book at the
wrong integer and the scan fabricates gaps for books the household owns. §5
carries the worked example, where it claimed three missing volumes.

**Known members of this class:** *The Wandering Inn* (below). The TODO entry
that opened this work asked whether there are others; **searched 2026-09-02,
this catalog holds no second one** — no other `work.subtitle` or
`series_index_display` in either instance carries a `Part N of` / `Part One`
designation. That is a measurement with a short shelf life: the next serial the
household buys in print will very likely join it.

---

## 2. The Wandering Inn — the real publication structure

pirateaba's *The Wandering Inn*, three numbering systems:

| System | Unit | Who uses it |
|---|---|---|
| **Volume** | Volume 1, 2, 3… | the web serial at `wanderinginn.com`, and Goodreads' listings of the self-published ebooks |
| **Book** | Book 1 *The Wandering Inn*, Book 2 *Fae and Fare*, Book 3 *Flowers of Esthelm*… | the Kindle ebooks, the Podium audiobooks, **and the Harper Voyager print line** |
| **Part** | Book 1 Part 1 / Book 1 Part 2 | the Harper Voyager print line **for Books 1 and 2 only** |

### 2.1 Volume → Book

Volumes 1 and 2 became Books 1 and 2 entire. From Volume 3 onward each Volume
was split into two Books:

| Web Volume | Books |
|---|---|
| Volume 1 | Book 1 — *The Wandering Inn* |
| Volume 2 | Book 2 — *Fae and Fare* |
| Volume 3 | Book 3 — *Flowers of Esthelm* (ch. 3.00–3.25) · Book 4 — *Winter Solstice* (ch. 3.26→) |
| Volume 4 | Book 5 — *The Last Light* (ch. 4.00–4.31) · Book 6 — *The General of Izril* (ch. 4.32–4.49) |

Source: The Wandering Inn Wiki, [Ebook](https://wiki.wanderinginn.com/Ebook) and
[Audiobook](https://wiki.wanderinginn.com/Audiobook).

### 2.2 Book → printed paperback — ⚠️ only Books 1 and 2 split

The author's own store lists the print line in order. **Books 1 and 2 are each
two paperbacks; Books 3 through 19 are one paperback each.**

| Printed paperback | Designation it carries | Book | ISBN-13 |
|---|---|---|---|
| *The Wandering Inn* | **Book 1, Part 1** | 1 | 9780063516380 |
| *No Killing Goblins* | **Book 1, Part 2** | 1 | 9780063516403 |
| *Fae and Fare* | **Book 2, Part 1** | 2 | 9780063516427 |
| *Immortal Games* | **Book 2, Part 2** | 2 | 9780063516465 |
| *Flowers of Esthelm* | Book 3 | 3 | — |
| *Winter Solstice* | Book 4 | 4 | — |
| … through *Couriers Outbound* | Book 19 | 19 | — |

Publisher: **Harper Voyager** (HarperCollins — the `978-0-06` prefix on all four
ISBNs is theirs). ⚠️ Our four `edition` rows record the publisher as
*"Barnes & Noble"*, which is the **retailer**, not the publisher — see §6.

**Sources, all read 2026-09-02:**

- [store.wanderinginn.com — The Wandering Inn print collection](https://store.wanderinginn.com/collections/thewanderinginn)
  — the author's own store, and the authority for the part designations. It
  titles them *"The Wandering Inn: Book 1, Part 1"*, *"Fae and Fare: Book 2,
  Part 1"*, and lists Books 3–19 with no part suffix.
- [*No Killing Goblins: Book One, Part Two of The Wandering Inn Series*](https://us.amazon.com/No-Killing-Goblins-Book-Wandering/dp/0063516403)
  — ISBN-10 `0063516403` = our `9780063516403`. Harper Voyager, 2026-09-22.
- [*Fae and Fare: Book Two, Part One of The Wandering Inn Series*](https://us.amazon.com/Fae-Fare-Book-Part-Wandering/dp/006351642X)
  — ISBN-10 `006351642X` = our `9780063516427`. Harper Voyager, 2026-10-20.
- [*Immortal Games: Book Two, Part Two of The Wandering Inn Series*](https://www.amazon.com/Immortal-Games-Book-Part-Wandering/dp/0063516462)
  — ISBN-10 `0063516462` = our `9780063516465`. Harper Voyager, 2026-11-10.
- [Goodreads: *No Killing Goblins*](https://www.goodreads.com/book/show/250223255-no-killing-goblins)
  — files it as **"The Wandering Inn, #1.5"**, which is independently the
  fractional convention §3 arrives at.

⚠️ **The strongest corroboration was already in our own database and needed no
web search at all.** All four `work.subtitle` values — written by
`apply-bn-details.mjs` on 2026-08-11 from the retailer's product pages — read
*"Book One, Part One of The Wandering Inn Series"*, *"…Part Two…"*, *"Book Two,
Part One…"*, *"…Part Two…"*. The mapping was sitting in the row the whole time.
**Look at what the record already holds before proposing a lookup** — the same
lesson *Twelve Months* taught in `volume-numbers.md` §9.

---

## 3. The sort values this implies — R5 and R9, applied

**R5:** `series_index_sort` is the position in the reading order.
**R9:** something that files *between* two numbered books takes a fraction.

Part 1 of Book N **begins** reading position N, so it takes the integer `N`.
Part 2 of Book N files between N and N+1, so it takes `N.5`.

| Work | Printed as | `series_index_sort` | `series_index_display` |
|---|---|---|---|
| #229 *The Wandering Inn* | Book 1, Part 1 | **1** | `Book 1, Part 1` |
| #230 *No Killing Goblins* | Book 1, Part 2 | **1.5** | `Book 1, Part 2` |
| #231 *Fae and Fare* | Book 2, Part 1 | **2** | `Book 2, Part 1` |
| #232 *Immortal Games* | Book 2, Part 2 | **2.5** | `Book 2, Part 2` |
| *Flowers of Esthelm*, when bought | Book 3 | 3 | `Book 3` |

The display strings are quoted from the author's store, per R2/R3 — the arabic
`Book 1, Part 1` form the store uses, not the retailer's spelled-out *"Book One,
Part One"*. #229 already carried exactly that string, so the four are
consistent.

### 3.1 Why not 1.1 / 1.2 / 2.1 / 2.2

That is what #229 actually held (`1.1`), so it is the scheme a session would
reach for. **It is wrong, mechanically, and `completeness.ts` is what makes it
wrong.** `isPosition` is `Number.isInteger`, so under that scheme *none* of the
four works occupies an integer position. The consequences:

- `ownedPositions` is empty, so `lowestOwned`, `highestOwned` and `highestKnown`
  are all null and the range scan never runs. Today that merely reports all four
  as `unnumbered`.
- ⚠️ **But the moment any source attests Book 3**, `highestKnown` becomes 3, the
  scan runs from floor 1, and positions **1 and 2 are not in `ownedSet`** — so
  the series page lists the two books the household owns four copies of as
  missing. A latent version of the bug §5 describes, one step milder: with
  `lowestOwned` null they come out as evidence `implied` rather than `earlier`,
  so they are rendered as a claim rather than as arithmetic. Still wrong, still
  on the page.

Under `1 / 1.5 / 2 / 2.5`, positions 1 and 2 are held, the scan finds no hole,
and Book 3 arriving at `3` continues the line cleanly.

**Measured 2026-09-02**, by running `seriesCompleteness` from `@lc/core` against
the real production rows with a Book 3 attestation added:

| Scheme | gaps reported |
|---|---|
| `1.1 / 1.2 / 2.1 / 2.2` + Book 3 attested | **3** — `1:implied`, `2:implied`, `3:attested` |
| `1 / 1.5 / 2 / 2.5` + Book 3 attested | **1** — `3:attested`, which is the truth |

⚠️ One honest cost of the chosen scheme: `unnumbered` reads **2**, because
`1.5` and `2.5` are off the integer line and `isPosition` counts only integers.
That is the same treatment R9's `12.5` *Side Jobs* already gets, and it is a
count of "positions not on the line", not a claim that anything lacks a number.

### 3.2 Why not the print line's own sequential numbering (1, 2, 3, 4)

Amazon's series widget numbers the *printed* books sequentially — it calls
*Immortal Games* "Book 4 of 21". Following that would put *Flowers of Esthelm*
at 5 and collide head-on with *The Last Light*, which is Book 5. The print
sequence and the Book sequence diverge permanently after the second split.
**The Book number is the stable one; the print sequence is not.**

### 3.3 What this does NOT decide — `multi_volume_printing`

R6's flag (*one series position, printed as more than one physical book*) looks
made for this, and it may well be right here. **It is deliberately not set**, and
that is left for the owner:

- R6 is **human-only** and the guard is mechanical — no script, finding or sweep
  may write it. A correction script setting it would be the exact bypass R6
  exists to prevent.
- The shape is not quite R6's worked example either. R6 was written for *one
  work* printed as two physical books (the two-volume leatherbound *Words of
  Radiance*). Here there are **two works**, one physical book each, sharing a
  reading position. Whether the flag means "this work spans volumes" or "this
  position does" is a judgement, not a lookup.

The correction below is complete and correct without it: the sort values file
the books in true order and the display strings carry what each cover says. See
§6 for what to hand the owner.

---

## 4. What the catalog held before the correction

Read from `library-catalog --remote`, 2026-09-02:

| Work | `series` | `series_index_sort` | `series_index_display` | `gap_verdict` |
|---|---|---|---|---|
| #229 *The Wandering Inn* | The Wandering Inn | `1.1` | `Book 1, Part 1` | — |
| #230 *No Killing Goblins* | The Wandering Inn | **NULL** | **NULL** | `seriesIndex` = `unknown` |
| #231 *Fae and Fare* | The Wandering Inn | **NULL** | **NULL** | `seriesIndex` = `unknown` |
| #232 *Immortal Games* | The Wandering Inn | **`4`** | **`4`** | — |

Three separate defects in four rows: a fractional scheme on #229 that no
document explains, two rows with nothing at all, and #232 sitting on the
**print-sequence** number 4 — which is §3.2's mistake, made once.

`audiobook_holding` holds **no row** for any of the four (measured, empty), so
nothing in the audiobook join moves either way.

---

## 5. The visible bug this was causing

Run the old numbers through `seriesCompleteness`: the only integer position
owned was #232's `4`, so `lowestOwned = highestOwned = highestKnown = 4`, the
floor is 1, and the scan walks 1→4. Positions **1, 2 and 3** are not in
`ownedSet` and each is below `lowestOwned`, so each came out as evidence
`earlier` — the strongest kind, the kind rendered as arithmetic rather than as
a claim.

**The series page was therefore asserting three certain gaps in a series where
the household owns every printed book released.** Not a formatting wrinkle: it
is the *"you own 6 of 12" is a lie unless something said 12* failure from
`info/README.md`'s finding 7, arriving through the numbering rather than through
a bad source.

After the correction, positions 1 and 2 are both held, `highestKnown` is 2, and
the scan produces nothing.

**Measured 2026-09-02**, `seriesCompleteness` run against the actual production
rows before and after:

| | `owned` | `lowestOwned` | `highestOwned` | `gaps` | `certainGaps` |
|---|---|---|---|---|---|
| before (`1.1`, NULL, NULL, `4`) | 2 | 4 | 4 | **3** — `1:earlier`, `2:earlier`, `3:earlier` | **3** |
| after (`1`, `1.5`, `2`, `2.5`) | 4 | 1 | 2 | **0** | **0** |

⚠️ **Not verified: the rendered page.** `GET /api/series/The Wandering Inn`
returns 401 to an unauthenticated caller, so this is the function the page calls,
run on the rows the page reads — not the pixels. See §7.

---

## 6. Left for the owner, deliberately

| Item | Why it is not done here |
|---|---|
| **`work.multi_volume_printing`** on #229–#232 | R6 is human-only and mechanically guarded; §3.3 has the argument and the two readings of what the flag would mean. One checkbox each in the book edit panel, or one word from the owner. |
| **`edition.publisher` = "Barnes & Noble"** on editions 322–325 | The retailer, not the publisher; it is **Harper Voyager**, confirmed by the `978-0-06` prefix on all four ISBNs and by every listing in §2.2. Real, but a *different* defect from the volume mapping, and widening a correction batch to sweep it in is how a batch stops being reviewable. Logged in `TODO.md`. |
| **Books 3–19** | The household owns none of them. §3's scheme says what their numbers will be when they arrive; nothing is pre-created, because a catalog row for a book nobody owns is a wish, not a fact. |

---

## 7. What was NOT verified

- ⚠️ **The rendered series page.** `/api/series/:name` requires an authenticated
  owner session and returned **401** to this session, so nothing here was read
  through the product. The arithmetic in §5 is `seriesCompleteness` from
  `@lc/core` invoked directly on the production rows — the right function on the
  right data, but not the pixels. **The owner should open
  <https://library.heygabi.ai/series/The%20Wandering%20Inn> and confirm.**
- **Which chapters each printed Part actually covers.** §2.1's Volume→Book
  chapter spans come from the wiki; the Book→Part split point inside Books 1 and
  2 is stated by nobody consulted, and nothing in this catalog needs it.
- **The audiobook catalog's own numbering for this series.** The TODO asked
  whether `audiobook_catalog` has the same problem. Not checked — this repo's
  `audiobook_holding` has **no row** for any of the four works, so there was
  nothing to reconcile from this side, but that is not the same as having looked
  at the other repo.
- **Publication dates.** The three retailer listings give 2026-09-22, 2026-10-20
  and 2026-11-10 for Books 1 Part 2 through 2 Part 2. Recorded here as context
  only; `work.first_published` was not touched and still reads `2026` for three
  of the four.
- **`edition.pages`** disagrees between sources for *Fae and Fare* (our row says
  848, one listing said 688, another 848). Not touched, not resolved.
