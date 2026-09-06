# ISBN & Title Lookup — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-09** for §§1–6. Every figure in those sections is a
> **live call made on that date**, not a recollection. Raw output is in the
> session scratchpad (`phase0-report.json`, `phase0b-report.json`); the numbers
> are reproduced here because the scratchpad is not durable.
>
> 🔴 **§7.5's FOURTH guard and the new §7.7 were added 2026-09-06 (W8-GUARD)
> and are measured on that date** against both production instances: the guard
> split is main **26 / 32 / 1 / 16** of 75 candidates and padhard **1 / 6 / 0 /
> 103** of 110; `namesAnIsbn`'s single hit is ed#321; the new volume gate refused
> **6** candidates on padhard and cost neither work its fill; and **0** works on
> either instance share an ISBN with another work. ⚠️ **Nothing else in this file
> was re-measured that day** — §§1–6 still carry 2026-08-09 and the rest of §7
> still carries 2026-09-05.
>
> 🔴 **§7 was added 2026-09-05 and is measured on that date** against production
> `library-catalog` and `library-catalog-2nd`. It is the post-mortem of the
> 2026-08-20 backfill run and the guards that came out of it. Nothing in
> §§1–6 was re-measured that day — in particular §4.4 predicted this failure in
> August and its numbers still carry their 2026-08-09 age.
>
> 🔴 **§7.6 was added 2026-09-05 ~18:45 Phoenix / 2026-09-06 01:45Z**, on the
> owner's ruling of 18:29, and everything in it is measured that evening: the 13
> tier C rows and their 10 evidenced `source` restores re-read live from
> production; #507's exclusion measured from its own row, its two copies and
> `openlibrary.org`; the guard exercised in a production dry run at 01:44Z.
> ⚠️ **Re-read §7.4's struck-through lines rather than skipping them** — the
> ruling REVERSED two "only the owner can answer this" verdicts, and the old
> text is left visible so nobody re-derives the superseded conclusion.
> ⚠️ **NOT re-measured on 2026-09-05 evening:** §§7.1–7.3 (the writer
> attribution and the 43-row blast radius) still carry their earlier-that-day
> readings, and nothing in §§1–6 was touched.

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
  row whose own `edition_name` says *"no per-volume ISBN recorded"*. ~~A judgement
  for the owner, not a measurement~~ — ✅ **the owner ruled on 2026-09-05 18:29
  Phoenix and tier B is approved**; see §7.6. It stays behind
  `--also-declared-no-isbn` (or `--all-tiers`) rather than becoming the default,
  so a tier can still be landed one at a time.
- ~~**14 (untouched)** — Kickstarter / collector's printings carrying a plausible
  trade ISBN and making no claim about having none. Whether a crowdfunded
  hardcover shares the trade ISBN is a question about the **physical object**;
  only somebody holding the book can answer it.~~ ✅ **He answered it** — §7.6.
  **13 of the 14 are now tier C** (`--also-crowdfunded`); the fourteenth, **#507
  *The Book of Mormon***, is excluded and is a different open question.

**padhard: 0.** The 2026-08-20 run could not reach it — `scripts/lib/d1.mjs`
gained `--friend` on **2026-08-22** (before that `DB_NAME` was a constant), and
her earliest edition writes are 2026-08-22 02:00Z. Re-measured rather than
argued: 0 rows there declare no ISBN yet carry one. Her one non-English
registration group is `9789358568417` (978-93, India) on edition #605
*Italian Affair* — **not** written by this run, and unresolved.

### 7.5 The guards, and where they live

All four are pure functions in `scripts/lib/backfill-safety.mjs`, pinned by
`scripts/test/backfill-safety.test.mjs` with the real ISBNs and the real
production `edition_name`s above as fixtures (**45 pass / 0 fail**, 2026-09-06).

| Guard | Rule |
|---|---|
| **`declaresNoIsbn(editionName, note)`** | A printing whose own record states no ISBN exists is skipped and printed. ⚠️ Deliberately **narrow**, and it stays narrow: it matches a *statement about an absent ISBN*, never the words "Kickstarter" or "Collector's Edition" |
| 🔴 **`isCrowdfundedPrinting(editionName, note)`** | Added **2026-09-05 18:29 Phoenix** on the owner's ruling (§7.6). A crowdfunded / collector's / campaign printing the owner HOLDS is skipped, because an absent ISBN there is his recorded answer. ⚠️ This is the **widening** the row above refuses to make, and it is sound only because of a fact about this household's data entry — which is why it is a **second function**, not an edit to the first |
| 🔴 **`namesAnIsbn(editionName, note)`** | Added **2026-09-06** for ed#321 (the *"CLOSED 2026-09-06"* block at the foot of §7.6). A row whose own `edition_name`/`note` NAMES an ISBN has already stated which identifiers apply. Narrow by construction: the field must contain the WORD *ISBN* **and** an identifier-shaped run of at least ten digits near it — *"ISBN unknown"* names none, and a year or a tier number is not an identifier. ⚠️ It does **not** check the check digit: the claim is *"this row has already stated its identifiers"*, which a mistyped ISBN states just as loudly. Runs THIRD, so the rows the two above already refuse keep their existing reason and the counts in this section do not move |
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

---

### 7.6 🔴 The owner's ruling — *"the ISBNs are recorded if they exist"* — and tier C

> **Owner, 2026-09-05 18:29 Phoenix, verbatim:**
>
> ### *"For the kickstarters we have in stock the ISBNs are recorded if they exist."*

**This is a STANDING RULE about this catalogue's data, not a one-off approval,
and it should be read as one:**

> 🔴 **An in-stock crowdfunded printing with no ISBN has none.** On a Kickstarter,
> Indiegogo, campaign-tier, collector's or exclusive printing the owner holds,
> `edition.isbn13 IS NULL` is a **MEASURED ABSENCE** — he records the ISBN at
> entry when the object carries one. It is not a gap awaiting research, and
> anything that fills it is overwriting a fact with a guess.

⚠️ **That one sentence changes the classification of 30 rows, and it is worth
being precise about why.** §7.4 above said of the 14 untouched rows that *"whether
a crowdfunded hardcover shares the trade ISBN is a question about the physical
object; only somebody holding the book can answer it"*, and of tier B that it was
*"a judgement for the owner, not a measurement"*. Both were correct. **The person
holding the books answered**, so both stop being open questions and become the
same finding as tier A — a wrong object written over a recorded state. Tiers B
and C are therefore **approved**, and the flags stay separate only so a tier can
be landed at a time.

#### Tier C — 13 rows, re-read live from production 2026-09-05

| ed | work | isbn13 on the row | `edition_name` | source restore |
|---|---|---|---|---|
| 317 | Fires of December | 9781938570728 | Book with sticker and bookmark tier | — |
| 319 | The Primal Hunter | 9798426232426 | Collector's Edition Trilogy — Book 1 Numbered | — |
| 320 | Ascend Online: Legacy of the Fallen | 9781775241317 | Collector's Edition | — |
| 330 | The Dungeon Anarchist's Cookbook | 9798724495066 | Kickstarter limited edition hardcover | → `manual` |
| 331 | Ritualist | 9781986338509 | Kickstarter Grimoire Edition — faux leather | → `manual` |
| 332 | Regicide | 9781950914142 | Kickstarter Grimoire Edition — faux leather | → `manual` |
| 334 | Raze | 9781637660898 | Kickstarter Grimoire Edition — faux leather | → `manual` |
| 335 | Ruthless | 9781950914623 | Kickstarter Grimoire Edition — faux leather | → `manual` |
| 343 | Space Knight Book 2 | 9781951641856 | Crowdfunded print copy | → `manual` |
| 344 | Space Knight Book 3 | 9781986619233 | Crowdfunded print copy | → `manual` |
| 345 | Space Knight Book 4 | 9781721829316 | Crowdfunded print copy | → `manual` |
| 349 | Monster Empire Book 1 | 9781951641122 | Kickstarter paperback | → `manual` |
| 350 | Ascend Online | 9780995337800 | Kickstarter Collector's Edition | → `manual` |

**The 10 `source` restores are EVIDENCED, on the same standard tier A used** —
never inferred from the row looking hand-made:

- **#330** — created by `scripts/add-dcc-kickstarter.mjs`, whose INSERT writes
  `edition_name = 'Kickstarter limited edition hardcover'`,
  `edition_kind = 'collectors'`, `source = 'manual'` for exactly works 236/237.
- **#331 #332 #334 #335 #343 #344 #345 #349 #350** — created by
  `scripts/add-crowdfunding-rescan-books.mjs`, which writes `source = 'manual'`
  with a comment explaining why (`'crowdfunding'` fails the `edition.source`
  CHECK). ✅ **Corroborated in the data, not just the code:** that batch is
  `created_at = '2026-08-12 06:21:00'`, and of its **28** edition rows the **13
  the backfill never touched** (`updated_at == created_at`) read `source =
  'manual'` **unanimously** — #339 #341 #346 #347 #348 #351 #352 #353 #354 #355
  #356 #357 #358.
- **#317 #319 #320 get NO restore.** Their batch (`created_at = '2026-08-11
  13:32:46'`) has no untouched sibling of the same shape, and
  `scripts/import-crowdfunding.mjs` — the only script reading
  `crowdfunding-scan.json`, where these three campaigns live — **creates no
  `edition` rows at all, deliberately**. Nothing evidences their prior `source`,
  and restoring an unevidenced `manual` would repair a provenance bug with a
  provenance lie.

#### ⚠️ #507 is NOT tier C, and the reason is measured

Edition **#507** (*The Book of Mormon*, work 375, `9780929753249`) was the
fourteenth of the "untouched" rows. It is **left out**:

| Checked 2026-09-05 | Reading |
|---|---|
| `edition_name` | **NULL** |
| `note` | **NULL** |
| `format` | `paperback` |
| its two owned copies (#283, #291) | no `edition_notes`, and `leatherbound` / `slipcase` / `sprayed_edges` all 0 |
| any crowdfunding importer in `scripts/` naming it | **none** |
| §7.1 above, written before the ruling | *"Only one (**#507**, The Book of Mormon) was an ordinary printing"* |

The ruling is about **"the kickstarters we have in stock"**. Nothing on this row
says it is one, and stretching the ruling to cover a row with no evidence would
be exactly the inference-dressed-as-measurement this whole section exists to
kill.

⚠️ **It is still wrong, just differently, and this is an OPEN question for the
owner.** `9780929753249` is Stratford Books' *"Hand Leather Bound Pocket
Edition"* (Open Library `OL8358629M`, 2007, English, `physical_format:
Leather-bound`) sitting on a row whose `format` is `paperback` — **wrong medium**.
🔴 And because it is English and `978-0`, `isbnLanguageVerdict` returns
`unknown` and **the language gate would never catch it**. Tracked in
[`../TODO.md`](../TODO.md).

#### ✅ The guard, exercised — and what it caught

`isCrowdfundedPrinting` was exercised against production, dry run
(`npx tsx scripts/backfill-missing-isbns.mjs --remote`, no `--commit`),
**2026-09-06 01:44Z**: 411 works, **45** with no ISBN on any edition →
**9 skipped by `declaresNoIsbn`**, **19 skipped by `isCrowdfundedPrinting`**,
**17 searched**, 10 found, 20 statements planned. (Before the new guard the same
run searched 34.)

🔴 **Two of the 19 are editions #316 and #329 — tier A rows the owner had
repaired barely two hours earlier.** Without this guard the very next run of the
backfill would have re-filled them, and the repair would have had a half-life of
one sweep. That, not the count, is the result worth keeping.

#### ✅ CLOSED 2026-09-06: ed#321 *Words of Radiance* — the third guard was built

⚠️ **Measured in that same dry run** — the writer proposed `9780575097421`
(Gollancz UK) for work #220, whose only edition is **#321**, the Dragonsteel
leatherbound repaired as tier A. **Neither guard catches it:**

- `declaresNoIsbn` — the row does not say it has *no* ISBN.
- `isCrowdfundedPrinting` — its `edition_name` is
  *"Leatherbound (two-volume set: Vol 1 ISBN 9781938570308, Vol 2 ISBN
  9781938570315)"*, and **"leatherbound" is a binding material, not campaign
  vocabulary**. It was deliberately NOT added: whether a leatherbound counts as
  "a kickstarter we have in stock" is a question about a physical object, and the
  answer to that kind of question belongs to the owner (that is the whole lesson
  of this section).

~~The candidate fix, if he wants one, is a **third** narrow guard rather than a
wider second~~ ✅ **BUILT 2026-09-06 as `namesAnIsbn`, exactly that shape:** *a row
whose own `edition_name` or `note` NAMES an ISBN has already stated which
identifiers apply, so `isbn13 IS NULL` there is a recorded state.*

**And it catches #321 and nothing else** — measured, not predicted. Production
dry run 2026-09-06 05:01Z (`--remote`, no `--commit`): 411 works, **75** with no
ISBN on any edition → **26** `declaresNoIsbn`, **32** `isCrowdfundedPrinting`,
**1** `namesAnIsbn`, **16** reaching the ladder (17 without it). The one is

```
   work #220 ed#321  Words of Radiance  — names 9781938570308
```

`--remote --friend` the same hour: 677 works, **110** candidates → 1 / 6 / **0**
/ 103. No padhard row names an ISBN in its own record. Tier B's *"set ISBN …"*
rows do match this guard too, exactly as predicted — but guard 1 runs first, so
they keep being reported under *"no per-volume ISBN recorded"* and the counts
above do not move. Re-measurable with no network calls:
`node scripts/experiments/count-isbn-guards-2026-09-06.mjs --remote [--friend]`.

### 7.7 🔴 One ISBN for five volumes — the title gate cannot see a number

⚠️ **Found in the same 2026-09-06 dry run, and it is a different defect from
everything above.** Google Books proposed the **same** ISBN `9781986619233` for
*Space Knight* books **5, 6, 7, 8 and 9**.

**Why the gate passed it.** `titleSimilarity` is word membership with words of
one character dropped, so *"space knight book 5"* against *"space knight book 7"*
shares **every word it can see** and scores **1.00** — far above the rung's
`0.80` floor. A digit is weighed like any other word, and on a long title one
wrong digit costs a fraction of a point. ⚠️ **The similarity function cannot see
a volume number at all**, and no threshold change would fix that.

**What stopped four of the five writes was the DATABASE, not a gate.**
`migrations/0001_init.sql:234` makes `idx_edition_isbn13` UNIQUE catalog-wide.
🔴 **An index is a backstop, not a gate**: it refuses the SECOND write and says
nothing about whether the FIRST was right. Measured 2026-09-06 on both
production instances: **0** works share an ISBN with another work — which is
what the index guarantees, and is *not* evidence the ladder was right.

**The fix, canonical in `packages/core/src/matching.ts`** beside `numbersAgree`,
which makes the same argument inside the work index:

| Function | Rule |
|---|---|
| `seriesVolumeNumber(title)` | An explicit marker wins wherever it sits (`book 5`, `Book #5`, `Vol. 5`, `part 5`, `#5`); otherwise the **first** standalone number, because a trailing annotation in a search result is more often a year than a volume; `null` when no digit survives. Half-volumes (`8.5`) survive, per [`serial-print-splits.md`](serial-print-splits.md). ⚠️ Roman numerals are deliberately not read |
| `numberedTitleAgrees(candidate, ours)` | Refuse a candidate whose volume number contradicts ours; **accept one carrying no number**. ⚠️ Asymmetric on purpose: a candidate that names a volume our row does not is the *Primal Hunter* shape `numbersAgree` already refuses |

⚠️ **Not a second similarity function**, which `matching.ts`'s header bans: it
reads a NUMBER, which `titleSimilarity` cannot see. Wired into **rungs 1 and 2**
beside the `0.80` floor, each refusal printed. ⚠️ **Rung 2.5 cannot have it** —
`thingTitle` returns no per-item title to compare against, which is already why
it is last and lowest-trust.

**It fires on real data.** The 2026-09-06 `--remote --friend` dry run refused
**6** candidates — 4 for *He Who Fights with Monsters* (`Book 1`, `Book 3`,
`Book 4`, ` 2`) and 2 for *Storm Breaker* (`#2`, ` 2`). ⚠️ **Neither work lost
its fill**: both were answered in the same run by a candidate carrying no volume
number (`9781950912612`, `9781649379931`). The main-instance run refused none.

**The data half** is `scripts/fix-same-isbn-series-2026-09-05.mjs` — dry-run
default, `--commit` gated, `change_log` per cleared field. Its rule, when a group
ever appears: keep the row a PERSON typed (`source = 'manual'`) and clear the
automated rest; with none or several manual members **refuse the group and print
it**, because guessing which volume owns an identifier is the failure that
created the defect. ✅ **Established 2026-09-06: `9781986619233` is *Space
Knight 3*** (Open Library edition `OL54710350M`, CreateSpace 2018; isbnsearch.org
agrees; Google Books answered 429 that day). The one row that did carry it
(ed#344, *Book 3*) was cleared for an unrelated reason, tier C at 2026-09-06
02:32:09Z — and §7.6 is why it does NOT go back on by itself: ed#344 is a
crowdfunded print copy, so whether the object carries the trade ISBN is the
owner's to read off the barcode, then `source = 'manual'`.
