# ISBN & Title Lookup — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-09** for §§1–6. Every figure in those sections is a
> **live call made on that date**, not a recollection. Raw output is in the
> session scratchpad (`phase0-report.json`, `phase0b-report.json`); the numbers
> are reproduced here because the scratchpad is not durable.
>
> 🔴 **§7 was added 2026-09-05 and is measured on that date** against production
> `library-catalog` and `library-catalog-2nd`. It is the post-mortem of the
> 2026-08-20 backfill run and the two guards that came out of it. Nothing in
> §§1–6 was re-measured that day — in particular §4.4 predicted this failure in
> August and its numbers still carry their 2026-08-09 age.

This is phase 0 of `catalog-platform/docs/LIBRARY_CATALOG.md`, which required
that *"everything about external book APIs is knowledge, not measurement"* be
replaced by live calls before anything was built on it. It has been. **Two of
the design's assumptions did not survive.**

---

## 1. The headline: the design was right about ISBNs and wrong about coverage

| Claim in the design | Measured | Verdict |
|---|---|---|
| ISBN lookup is deep and free | Open Library **9/10** with publisher, year, pages and a cover | ✅ confirmed |
| Google Books is the second free rung | **0/40 — HTTP 429 on every call** | ❌ **needs an API key** |
| "For 500 trade paperbacks Open Library is complete and research must never fire" | **14/30** of this household's own titles found | ❌ **half this library is not in Open Library** |

---

## 2. Rung 1 — Open Library by ISBN-13

Ten ISBN-13s, one call each to
`https://openlibrary.org/api/books?bibkeys=ISBN:…&format=json&jscmd=data`.

**9 of 10 resolved**, every one with title, author, publisher, publication date,
page count and a cover image. No key, no rate limiting encountered, no
registration. This is the strongest rung in either catalog.

### ⚠️ The trap: a wrong ISBN returns a confident, wrong book

Three of the ten ISBNs were typed from memory and were wrong. All three resolved
**successfully**, to entirely different books:

| Intended | Actually returned |
|---|---|
| Dungeon Crawler Carl | *Circe* — Madeline Miller, Little Brown, 393pp |
| Project Hail Mary | *Cloud Cuckoo Land* — Anthony Doerr, Scribner, 656pp |
| Ritualist | *One Piece, Vol. 93* — 尾田栄一郎, Viz Media, 200pp |

Full metadata. Correct covers. Nothing in the response marks them as wrong,
because they are not wrong — the *question* was. The checksum passed and the
database answered honestly.

**There is no API-side defence against this.** The only defence is that a scan
is a proposal a person confirms, which is why `scan_job` exists and why nothing
in `packages/isbn` writes to the catalog. It is also why you must never seed a
test fixture with an ISBN from memory.

---

## 3. Rung 2 — Google Books: needs a key, full stop

40 calls, **40 × HTTP 429**:

```
Quota exceeded for quota metric 'Queries' and limit 'Queries per day'
of service 'books.googleapis.com' for consumer 'project_number:624717413613'
```

That project number is Google's shared anonymous pool, and it is exhausted.
This is not intermittent and not a rate limit that backing off will clear —
**anonymous Google Books does not work at all from here.**

So it is gated on `GOOGLE_BOOKS_API_KEY`. With the key unset,
`resolveIsbn` skips the rung and records why in the trace, rather than spending
a Worker subrequest to be refused. A free key from the Google Cloud console with
the Books API enabled turns it back on; nothing else changes.

---

## 4. The finding that changes the plan: title search on *this* library

30 titles sampled deterministically across all 1,073 rows of
`audiobook_catalog/site/catalog.csv` — every 35th row, so it spans authors
rather than clustering.

| Query | Open Library hits |
|---|---|
| Title verbatim from `catalog.csv` | **5 / 30** |
| Title through `cleanAudiobookTitle` | **14 / 30** |
| Cleaned, free-text `q=` instead of fielded | 15 / 30 |

### 4.1 Cleaning the title nearly triples the hit rate

The audiobook catalog stores Audible's decorated titles —
`Firefight - The Reckoners, Book 2`, `Sharp Objects - A Novel`. None of that is
printed on a book. Stripping it moved 5→14. `cleanAudiobookTitle` in
`packages/core/src/titles.ts` is that function, and any importer or matcher that
skips it is not slightly worse — it is wrong about two thirds of the library.

### 4.2 ⚠️ Roughly half this library is simply not in Open Library

The 16 misses are not query failures. They are overwhelmingly Kindle Unlimited
and Audible-native indie titles with no ISBN and no library record anywhere:

> Selkie Myth · Shemer Kuznits · Mashton · Michael-Scott Earle · Nagato Yamata ·
> Invayne · Oleg Sapphire · T. L. Payne · Dakota Krout (*Lord January*) · Eric Vall

**This contradicts the design directly.** `LIBRARY_CATALOG.md` §5.1 budgets
research to fire only on *"the signed, numbered, Kickstarted and BookFunnel-
delivered minority"* — perhaps 5%. For a shelf of trade paperbacks that holds.
For this household's actual centre of gravity it does not: the LitRPG/progression-
fantasy half has no free metadata at all, so either the research tier fires far
more often than budgeted, or those rows stay hand-entered.

**Do not treat a title miss as an error.** It is the expected outcome for half
the catalog, and code that logs it as a failure will bury the real ones.

### 4.3 Free-text search is not the upgrade it looks like

It scored one hit higher and bought that with **wrong answers**:

| Asked | Free-text returned |
|---|---|
| "The Wandering Inn" — pirateaba | *Garden of Sanctuary* (same author, different book) |
| "Awaken Online: Flame" — Travis Bagwell | *Awaken Online* (**wrong volume of the right series**) |

It also *lost* a hit the fielded query found. The second row is the worst failure
this catalog can have: it files a book you do not own as one you do.

Fielded search is the default. Free text is a second rung whose results must
clear the same similarity gate as a spine read.

### 4.4 ⚠️ The similarity gate cannot catch the worst case

"Firefight" + "Brandon Sanderson" returns a **different book called Firefight**.
Captured verbatim from `/api/enrich/works/1/candidates` on 2026-08-09:

```json
{
  "title": "Firefight",
  "authors": "Brandon Sanderson",
  "publisher": "Random House Books for Young Readers",
  "publishedYear": 2001,
  "pages": 452,
  "similarity": 1,
  "authorSimilarity": 1
}
```

Sanderson's *Firefight* is Delacorte, 2015. This record is **not** it.

**Both similarity scores are 1.0**, because the title string and the author
string are exactly right. No threshold separates this from a correct answer —
there is nothing textual to separate. It is the same shape as the Catan problem
that forced the Board Game Catalog to add an alias table: *a fact about the
world, which has to be recorded rather than computed.*

Three consequences, and all three are already built in:

1. **`searchOpenLibrary` asks for 5 results, not 1.** The right answer is not
   reliably first.
2. **Nothing auto-applies.** `/api/enrich` proposes; a person presses Use.
3. **The year and publisher are rendered beside every candidate**, because they
   are the only discriminator that exists. A UI showing just title and author
   would make this record indistinguishable from the truth.

Do not "improve" the enrichment flow by auto-selecting the top candidate. The
top candidate here scores a perfect 1.0 and is wrong.

### 4.5 It happened again, and only the publisher caught it — 2026-08-10

Filling `work.openlibrary_work_id` over all 116 works turned up a second
independent instance, in a different series: a fielded search for *Unsouled* by
Will Wight (Hidden Gnome Publishing, 2016) returned `OL32733864W` — a **different
2023 book also called Unsouled**, published by Riyria Enterprises LLC — with
**title 1.0 and author 1.0**.

The corroboration rule in `packages/core/src/corroboration.ts` refused it, on
exactly the discriminator this section names. That run's full numbers, the other
nine refusals, and what "corroborated" is allowed to mean are in
[`openlibrary-ids.md`](openlibrary-ids.md).

---

## 5. What this settles for the build

| Decision | Because |
|---|---|
| ISBN scan is phase 2 and is the strong path | 9/10, free, instant |
| Google Books is behind a key, skipped when absent | 40/40 × 429 |
| `cleanAudiobookTitle` runs on every title query, always | 5/30 → 14/30 |
| Fielded search first; free text only as a gated fallback | free text returns the wrong volume |
| The similarity gate is not optional | both search modes return confident wrong books |
| Ebook/Kindle ingest matters more than budgeted | the missing half is ASIN-only |

---

## 6. Still open

| # | Question | Blocks | State |
|---|---|---|---|
| 1 | Does a Kindle metadata cache exist on this machine? | Phase 3 | **Unresolved.** `C:\Users\nbasl\Documents\My Kindle Content` and the OneDrive equivalent do **not** exist. A wider profile sweep timed out at 2 minutes without completing, so "no Kindle for PC install" is *likely but not proven*. Re-check with a targeted `Get-ChildItem` before designing phase 3. |
| 2 | Amazon "Request My Data" export | Phase 3 | **Not started.** The design says kick it off during phase 0 because it takes days. Nobody has — it needs the owner's own Amazon login and cannot be done from here. |
| 3 | Where do loose ebook files live? | Phase 3 | Not investigated. |

---

## ⚠️ DECIDED: epub editions are NOT backfilled with identifiers

**Owner's decision, 2026-08-13.** The **117 `ebook_epub` editions carrying no
`isbn13`/`isbn10`/`asin` are a settled state, not a backlog.** Do not treat that
count as a gap, and do not start a project to close it.

**Why it is right rather than merely tolerated — three separate reasons:**

1. ⚠️ **A print ISBN on an epub row is a WRONG fact, not a partial one.** An
   ISBN identifies an edition *in a specific format*. The paperback's ISBN does
   not identify the epub, so "filling in" the column would assert something
   false in a column whose whole purpose is precision.
2. **Much of this library legitimately has no ISBN at all.** This document's own
   measurements found about half the collection absent from Open Library,
   dominated by Kindle Unlimited and Audible-native titles — formats that are
   frequently published without one.
3. ⚠️ **Not even the ASIN is research-determinable here, which is the
   non-obvious part.** These rows' `source_url` values are **local epub file
   paths**. Matching a file on disk to a particular Kindle store listing is
   *itself* a which-object guess — the same class of error as picking a printing
   for a physical book you have not seen. So the ASIN column is not an escape
   hatch for the ISBN column; it has the same problem wearing a different name.

**If this is ever revisited**, the only honest routes are ones that read the
object rather than infer it: metadata embedded in the epub files themselves, or
the owner's own Amazon "Request My Data" export (open question 2 above). Both
observe the actual item. Neither is a research task.

**The general rule this is an instance of:** a first-published year is a fact
about the **work** and has one right answer; an **identifier is a fact about an
object** and has as many answers as there are editions. Research settles the
first and usually cannot settle the second.

---

## 7. 🔴 The 2026-08-20 backfill filed 12 wrong ISBNs — the post-mortem, and the two guards

> **Measured 2026-09-05** against production `library-catalog` and
> `library-catalog-2nd`, by agent W6-ISBN, on the owner's decision of that day.
> Section 4.4 above called this failure in August — *"the similarity gate cannot
> catch the worst case"* — and it happened anyway, in a script, unattended, with
> no `change_log` row to find it by.

### 7.1 What happened

`scripts/backfill-missing-isbns.mjs` was run `--remote --commit` twice on
**2026-08-20**: at **15:33:26Z** (free rungs, 45 rows in one batch) and at
**18:03–18:04Z** (the `--llm` rung, 19 rows). Between them they filled **43
editions that still carry an ISBN today**.

**42 of those 43 were SPECIAL printings** — Kickstarter exclusives,
leatherbounds, subscription-box hardcovers, crowdfunded copies, and volumes of
slipcase sets. Only one (#507, *The Book of Mormon*) was an ordinary printing.

⚠️ **That is structural, not bad luck.** `CANDIDATES_SQL` asks for works with no
ISBN on ANY edition and writes to `ORDER BY e.id LIMIT 1` — the **oldest**
edition row. On this catalogue the works with no ISBN anywhere are precisely the
crowdfunded and exclusive ones, and their oldest row IS the special printing.
The backfill's target set and the set of rows that legitimately have no ISBN are
almost the same set.

### 7.2 The two mechanisms

| Hole | What it did |
|---|---|
| Rung 1 read `doc.isbn` off an Open Library **work** search result — its own comment says *"an array of ALL isbns from all editions of this work"* — and `pickBestIsbn13` took the first that parsed | Every translation is a candidate. The title gate scores the **work's** title, so a translation passes at `sim 1.00`; the surviving log shows exactly that for a Korean printing of *Understanding the Old Testament* |
| Rung 2 had `volumeInfo.language` in the response all along and never read it | A German `978-3` and an Italian `979-12` printing went in from Google Books |
| Rung 2.5 (LibraryThing) had nothing to gate on at all — `thingTitle` returns bare ISBNs with no title, author or language | Documented as the lowest-trust rung since 2026-08-24, but the write was still unconditional |
| `isbn13 IS NULL` was the only write guard | It cannot tell a **gap** from a recorded **fact**. Three rows carried an owner-verified note saying no ISBN is printed on them, and 17 more said *"no per-volume ISBN recorded"* in their own name |
| No `change_log` row, anywhere | The whole run had to be reconstructed a fortnight later from `updated_at` clustering and three stdout logs that happened to survive in the repo root |

### 7.3 How the writer was identified (five lines of evidence)

1. Three of its own stdout logs are still in the repo root —
   `isbn-backfill-llm.log`, `isbn-backfill-llm2.log`, `isbn-final.log`
   (⚠️ **UTF-16LE**; `iconv -f UTF-16LE` to read them) — each opening
   `> library-catalog@0.1.0 backfill:missing-isbns` /
   `tsx scripts/backfill-missing-isbns.mjs --remote --llm --commit`.
2. The ISBNs those logs report finding are the ISBNs now on the rows
   (`9781981818648` → ed#336, `9781039470224` → ed#486, …).
3. The version in force that day wrote `source = <rung>` **bluntly** — the exact
   `manual → openlibrary` flip seen on the Illumicrate rows. The `CASE` that
   preserves `manual` landed four days later in `fd705b0`.
4. Its rung→source mapping produces all three source values seen across both
   batches (`openlibrary`, `googlebooks`, `research`), and **nothing else in this
   repo writes `edition.source = 'research'` beside an `isbn13`**.
5. It writes no `change_log` row — matching the absence.

⚠️ **Honest gap:** the 15:33:26Z batch has **no surviving log of its own**. It is
attributed by code-path signature, not by a log line naming it.

### 7.4 The 12 wrong objects (tier A)

Verified through the repo's own `lookupOpenLibraryByIsbn` plus the per-edition
`/isbn/<isbn>.json` record, 2026-09-05.

| ed | work | isbn13 on the row | what that ISBN actually is | verdict |
|---|---|---|---|---|
| 307 | The Lightning Thief | 9780786838653 | Disney-Hyperion **2006 US trade** printing | wrong object (row is owner-verified as having no ISBN) |
| 308 | The Sea of Monsters | 9782226177612 | *La mer des monstres*, Albin Michel — **FRENCH** | wrong language |
| 311 | The Last Olympian | 9788362170043 | *Ostatni Olimpijczyk*, Jaguar — **POLISH** | wrong language |
| 316 | DCC: Crocodile | 9791281656383 | group **979-12 = Italy**; Open Library has no record at all | unattested |
| 321 | Words of Radiance | 9781399622073 | Orion/Gollancz **2024 UK trade hardcover** | the row is the Dragonsteel leatherbound, and its own `edition_name` names the two real ISBNs |
| 329 | Carl's Doomsday Scenario | 9783596712496 | FISCHER Tor — **GERMAN** | wrong language |
| 584 | Starsight | 9788381168830 | *Wśród gwiazd*, Zysk i S-ka — **POLISH** | wrong language |
| 585 | Cytonic | 9781713664017 | Audible Studios on Brilliance Audio — an **AUDIOBOOK** | wrong medium |
| 587 | Oathbringer | 9786052382349 | Akılçelen Kitaplar, group 978-605 — **TURKISH** | wrong language |
| 589 | The Son of Neptune | 9788424664558 | *El fill de Neptú*, La Galera — **CATALAN** | wrong language |
| 595 | The Tyrant's Tomb | 9788417773090 | *La tumba del tirano*, Montena — **SPANISH** | wrong language |
| 596 | The Tower of Nero | 9780593290941 | Listening Library — an **AUDIOBOOK** | wrong medium |

**The other 31**, split by what can be said about them:

- **17 (tier B)** — right book, wrong printing: a real English trade ISBN on a
  row whose own `edition_name` says *"no per-volume ISBN recorded"*. A judgement
  for the owner, not a measurement, so it sits behind
  `--also-declared-no-isbn` rather than in the default batch.
- **14 (untouched)** — Kickstarter / collector's printings carrying a plausible
  trade ISBN and making no claim about having none. Whether a crowdfunded
  hardcover shares the trade ISBN is a question about the **physical object**;
  only somebody holding the book can answer it.

**padhard: 0.** The 2026-08-20 run could not reach it — `scripts/lib/d1.mjs`
gained `--friend` on **2026-08-22** (before that `DB_NAME` was a constant), and
her earliest edition writes are 2026-08-22 02:00Z. Re-measured rather than
argued: 0 rows there declare no ISBN yet carry one. Her one non-English
registration group is `9789358568417` (978-93, India) on edition #605
*Italian Affair* — **not** written by this run, and unresolved.

### 7.5 The guards, and where they live

Both are pure functions in `scripts/lib/backfill-safety.mjs`, pinned by
`scripts/test/backfill-safety.test.mjs` with the real ISBNs above as fixtures.

| Guard | Rule |
|---|---|
| **`declaresNoIsbn(editionName, note)`** | A printing whose own record states no ISBN exists is skipped and printed. ⚠️ Deliberately **narrow**: it matches a *statement about an absent ISBN*, never the words "Kickstarter" or "Collector's Edition". Refusing every exclusive would trade one silent-wrong-fill for a silent-never-fill |
| **`isbnLanguageVerdict({ isbn13, languages, expected })`** | `foreign` refuses; `ok` and `unknown` proceed. An **attested** language beats the registration group, because a group only says who registered the prefix — `979-8` (KDP) and `978-1` self-published books are English. A non-English group with no attested language is `foreign`; an English group is `unknown`, never a confirmation |

Wired in as: rung 1 now walks the work's ISBN list (up to
`MAX_LANGUAGE_PROBES = 5`) and takes the first candidate whose **per-edition**
`/isbn/<isbn>.json` record survives the gate — ⚠️ the per-edition endpoint, not
the work-level one, which aggregates every translation and is the shape that
caused this; rung 2 reads `volumeInfo.language`, at no extra call; rung 2.5
gets the same per-edition probe, being the rung with no gate of its own.
**And every write now logs a `change_log` row per changed field**, batch
`isbn-backfill-<ISO timestamp>`, `changed_how = 'auto'`, `changed_by` 1 on main
and NULL on padhard.

**Exercised on production, dry run, 2026-09-05** (`--remote`, no `--commit`):
34 works with no ISBN → **1 skipped by `declaresNoIsbn`** (#450 *Dungeon Born*,
*"No barcode printed on this copy (owner-verified)"*), 33 searched, **1 refused
by the language gate** — `9784047336582` (**978-4 = Japan**) proposed by
LibraryThing for *Sanctuary: The Art Book of Yuumei*, the exact rung that had no
gate at all. 15 found, 5 dropped on the UNIQUE conflict, **10 updates + 10
`change_log` rows**.

⚠️ **Not fixed here, and visible in that same run:** Google Books proposed the
**same** ISBN `9781986619233` for *Space Knight* books 5, 6, 7, 8 and 9. The
UNIQUE index catches it and the rows are skipped, so it is safe — but a rung
answering five different books with one ISBN is a title-gate problem
(`sim 0.80` on a numbered series), and §4.4's warning applies to it.
