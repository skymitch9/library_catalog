# ISBN & Title Lookup — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-09**. Every figure below is a **live call made on that
> date**, not a recollection. Raw output is in the session scratchpad
> (`phase0-report.json`, `phase0b-report.json`); the numbers are reproduced here
> because the scratchpad is not durable.

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
