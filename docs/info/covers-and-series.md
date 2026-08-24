# Covers, Series & Drive Links — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-23 21:45 Phoenix** for §0 and §0.2 — the cover-needed
> table and the paid-rung run were re-measured against production at that hour.
> §0.1 keeps its **20:30 Phoenix** measurement, including the full re-fetch of
> every Google Books cover on both instances, and was NOT re-checked at 21:45.
> **Everything from §1 onward still carries its original 2026-08-10 measurement
> and was NOT re-checked.**
>
> 🔴 **Read §0 first. This document was written about 115 works in one
> catalogue. There are now two catalogues and 1,025 works between them**, and
> the ladder could not reach one of them at all until 2026-08-22. The rungs and
> the reasoning below are still correct; the NUMBERS are historical.
>
> Every figure from §1 onward was a **measured run on 2026-08-10**, against the
> 115 works in the local D1 (production held 117 at the same moment; the two
> differ by two hand-added test rows). None of it was an estimate then and none
> of it has been re-measured since.
>
> §3.1 (the series overrides) is a **second measured run** on the same date and
> the same database, after `scripts/series-overrides.json` was researched and
> filled. Its per-entry sources are in that file, one `source` array each.
>
> **Not verified:** none of these backfills has been run against production.
> ⚠️ This line used to send you to `docs/HANDOFF.md` for "the exact pending
> commands". Those were run long ago — see §0 and §5 for the current ones.

The owner's verdict on 2026-08-10 was *"library looks awful, no covers load, no
series, no sorting by author"*. All three had the same root cause and it was not
the UI: **the columns were empty.**

```
work.cover_url          0 of 117 set
work.series             0 of 117 set
edition.isbn13          0 of 117 set
edition.source_url    116 of 117 set   ← the only thing these rows actually knew
```

---

## 0. ⚠️ TWO catalogues now, and one of them was unreachable — 2026-08-22/23

Everything below §1 was measured against **115 works in `library-catalog`** on
2026-08-10. Measured **2026-08-23 21:45 Phoenix**, after the owner's-key run in
§0.2:

| | works | no cover | stand-in | **cover needed** |
|---|---|---|---|---|
| `library-catalog` (library.heygabi.ai) | **493** | 2 | 2 | **4** |
| `library-catalog-2nd` (padhard.heygabi.ai) | **532** | 13 | 2 | **15** |

⚠️ Main's split moved (3 + 1 → 2 + 2) while its total did not — one blank became
a stand-in. Nothing in this session wrote to main; the split is quoted as
measured, and where it moved was **not** investigated.

At **20:30 Phoenix**, before §0.2: main **4** (3 blank, 1 stand-in); padhard
**17** (15 blank, 2 stand-in). At 19:00, before §0.1's sweep: main **5**
(5 blank, 0 stand-in); padhard **32** (15 blank, 17 stand-in). The SQL every row
comes from:

```sql
SELECT COUNT(*) AS works,
       SUM(CASE WHEN cover_url IS NULL THEN 1 ELSE 0 END) AS blank,
       SUM(CASE WHEN cover_status = 'standin' THEN 1 ELSE 0 END) AS standin,
       SUM(CASE WHEN (cover_url IS NULL OR cover_status = 'standin')
                THEN 1 ELSE 0 END) AS needed
  FROM work;
```

**Cover health.** Re-run **2026-08-23 21:45 Phoenix**: `--friend --remote`
**1 broken of 519** — still work 356 *Evocation*, whose Open Library cover
redirects to an archive.org object answering **HTTP 503**, now on a fourth
probe. Not cleared: the script's own rule is that a dead URL may be an outage
and blanking it loses the only record of where the cover came from.
⚠️ `--remote` (main) was **0 broken of 490** at 20:30 and was **NOT re-run** at
21:45; nothing in between wrote to main.

⚠️ **"No cover" and "cover needed" are different questions.** §2.5 defines the
real one — `coverNeeded` in `@lc/core`, and `NEEDS_CLAUSE` in
`packages/db/src/works.ts`: a cover is needed when `cover_url IS NULL` **or**
`cover_status = "standin"`. A report quoting blanks alone will read as a
regression the day somebody uses the app's own number. They differed by 17 on
padhard until the evening of 2026-08-23; see the flag below.

### 🔴 No sweep in `scripts/` could reach the second instance at all

`scripts/lib/d1.mjs` hardcoded `DB_NAME = 'library-catalog'`, and every backfill
imports `query`/`execute` from there. So **covers, series, ISBNs and universes
could only ever be filled on the main catalogue** — padhard had never met any of
them. Fixed 2026-08-22 (commit `4a52589`): `dbName({remote, friend})`, plus a
`--friend` flag on every script.

```bash
npm run backfill:missing-covers -- --friend --remote          # dry run
npm run backfill:missing-covers -- --friend --remote --commit
```

⚠️ **The flag is `--friend`, NOT `--env friend`.** `--env` is wrangler's idiom
and these scripts do not take it; a note telling somebody to use it cost real
time already. ⚠️ `--friend` without `--remote` **throws** — there is no local
copy of the second instance (both bind `DB`), so it would otherwise silently
read MAIN and report about the wrong catalogue.

### ⚠️ `check-cover-health.mjs --friend` had never audited a padhard row

It switched the fetch base to `padhard.heygabi.ai` while still reading rows from
the MAIN database — so a clean run of it was being read as evidence about a
catalogue it had never looked at. Fixed in the same commit; both now come off
one `flags.friend`.

### ⚠️ A rung that could not be ASKED used to print as "no cover"

`resolveIsbn` records a failed rung in its trace; `backfill-missing-covers.mjs`
threw the trace away, so an exhausted or dead rung was indistinguishable from a
book no database holds. It now tallies them and says which. The first run found
the **Bookcover API answering HTTP 522 on every call** — still 522 twenty hours
later, recorded as `KNOWN_ISSUES.md` **KI-5**.

### The sweep that followed, and the honest limit

Kiro swept both catalogues on 2026-08-22/23 — **52 covers, 100% of them from
Google Books; Open Library returned 404 on every ISBN tried**, independently
reaching §2's own 2026-08-10 verdict that the obvious Open Library rung is worth
nothing here. ⚠️ That line used to end *"whether any of the 52 are placeholders has NOT been
checked"*. **It has been now** — every Google Books cover on both instances was
fetched and hashed on 2026-08-23 and Kiro's sweep brought in **none**. See §0.1,
which also records why `check-cover-health.mjs` is the WRONG instrument for
that question.

⚠️ **Both catalogues are loaded live and these figures move by the hour** —
padhard gained **163 works in 24 hours**. Re-measure before quoting any of them.

---

## 0.1 ⚠️ `--standins`, and the placeholder a byte count cannot catch — 2026-08-23

### The flag

`backfill-missing-covers.mjs` targeted `cover_url IS NULL` and **said so in its
own header**, so the one sweep that exists to close covers could never reach a
book the app itself was marking as still wanting one. Every stand-in was
stranded: `backfill-work-covers.mjs` cannot reach them either — it only fills
works with no cover at all.

```bash
npx tsx scripts/backfill-missing-covers.mjs --friend --remote --llm --standins
#   ... then --commit
```

`--standins` widens the target set to `NEEDS_COVER`, a **mirror** of the
`works.ts` fragment rather than a third definition of the question. Two rules
travel with it:

- a stand-in beaten by a **verified** cover is written with `cover_status='ok'`
  **in the same statement** (0040 pairs the columns; two statements leave a
  window where the row wears a real cover and a stale warning);
- a stand-in nothing could beat **stays a stand-in**. Never blanked. A stand-in
  is a recorded judgement; a blank is the absence of one.

**Measured, first run:** all 17 padhard stand-ins were closed by the **free**
rungs — 3 Open Library by ISBN, 3 Google Books, 11 Open Library by title —
for **$0.00**. None of them had ever been asked, because nothing could ask them.

### 🔴 The Google Books placeholder — 4,013 bytes, and every guard passes it

⚠️ **Two of the 19 covers written that evening were wrong, and NO automated
check could have told you.** Both were caught by *looking at the image*.

| Work | What was stored | Why it is wrong |
|---|---|---|
| padhard 113 *Summer in the City* (Alex Aster) | Google Books `zoom=1` thumbnail | It is Google's branded **"COVER COMING SOON"** card |
| main 516 *Sanctuary: The Art Book of Yuumei* | Goodreads image, LLM rung, **high** confidence | Right book — but a **3D product photo** annotated *11.5 in / 9 in / 124 Pages*, not the jacket |

⚠️ **The placeholder is a real 4,013-byte JPEG.** It clears `verifyCoverUrl`'s
`MIN_COVER_BYTES`, it clears `check-cover-health.mjs`'s 1,000-byte floor, and it
returns `200 image/jpeg`. §2's 43-byte Open Library pixel was catchable by size;
**this one is not**, and that is the whole lesson. The signature that *does*
work is that it is **byte-identical for every book**:

```
sha1  df2f2659f5047344388a855a041b671651a45d68   4013 B
```

**The audit that closes the standing question.** `docs/TODO.md` had carried
*"Padhard cover audit — did placeholders creep back in?"* open since 2026-08-22,
because Kiro's sweep took 100% of its 52 finds from Google Books. Every
`books.google.com` cover on both instances was fetched and hashed:

| | Google Books covers | exact placeholders |
|---|---|---|
| `library-catalog` | 25 | **0** |
| `library-catalog-2nd` | 222 | **1** — work 113, written that same evening |

So **Kiro's sweep brought none in**; the one hit was ours, and it is now a
stand-in. Six other padhard covers under 6 KB were checked and are genuine —
they have **distinct** hashes, which is the cheap test: the placeholder repeats,
a real thumbnail does not.

⚠️ **`cover_status = 'ok'` means a PERSON looked.** All three corrections below
were set by a look, and each kept its URL:

| | Work | Now | Because |
|---|---|---|---|
| main | 516 *Sanctuary* | `standin` | 3D product photo, not the jacket |
| padhard | 113 *Summer in the City* | `standin` | the Google placeholder |
| padhard | 268 *The Villa* (Nora Roberts) | `standin` | right book, **German** edition jacket *Im Sturm des Lebens* — the *Project Hail Mary* precedent in §2.5 |

### 🔴 Padhard's paid rung is BLOCKED, and blank is the drop-box's normal state

`--llm` now reads **`ANTHROPIC_API_KEY_FRIEND_SAM`** under `--friend` and
`ANTHROPIC_API_KEY` otherwise, printing which NAME it used. Padhard's spend goes
on Samantha's key — `apps/worker/.dev.vars` lines 79–85.

⚠️ That drop-box line lives **blank** (`= ""`): the runbook pastes a key, pipes
it to `wrangler secret put ANTHROPIC_API_KEY --env friend`, then blanks it. Her
Worker holds it and **a secret store cannot be read back**. So padhard's
remaining 15 blanks cannot be put through the paid rung until the owner pastes
it in again. The rung says exactly this and refuses to fall back to the main
key, which would bill her catalogue to him.

---

## 0.2 ⚠️ `--llm-key-from=main` — the one way out, and it is ugly on purpose

> Added **2026-08-23 21:00 Phoenix**. Owner decision, verbatim: *"Run those 15 on
> MY key instead."* His reason: *"it doesn't have limits and is from the same
> account as my key"*, so on his account this is **attribution, not a transfer of
> money**. ⚠️ That is his statement about his own billing and nothing in this
> repo can verify it — which is precisely why the flag is loud rather than quiet.

```bash
npx tsx scripts/backfill-missing-covers.mjs --friend --remote --llm --llm-key-from=main
#   ... then --commit
```

It makes a `--friend --llm` run read `ANTHROPIC_API_KEY` instead of
`ANTHROPIC_API_KEY_FRIEND_SAM`. **The default above is unchanged**: with the flag
absent the rung still refuses to fall back, and still says so.

The spelling is deliberate — long, explicit, no short form, no env var, and
nothing resembling `--llm-key=…` that could be mistaken for passing a key on the
command line. ⚠️ **A custody rule you can opt out of by accident is not a custody
rule**, so the only safe exception is one that has to be typed out in full.

| It refuses | Because |
|---|---|
| any value but `main` | there is nothing else to point it at |
| without `--llm` | that is the only rung that spends |
| without `--friend` | a main run already reads `ANTHROPIC_API_KEY`; a silent no-op would read as "the flag did something" |

All three are checked **before the free rungs run**, so a typo in the one flag
that redirects a bill costs nothing. The banner names the key in use, says
`OVERRIDE ACTIVE`, and names the key that is *not* being used; the spend line
repeats it. Measured live:

```
  key in use: ANTHROPIC_API_KEY  (the OWNER's key — billed to him, for padhard's books)
  ⚠️ OVERRIDE ACTIVE — --llm-key-from=main.
     This is a --friend run (library-catalog-2nd, padhard) and it is NOT using
     ANTHROPIC_API_KEY_FRIEND_SAM. Every cent below lands on ANTHROPIC_API_KEY.
```

⚠️ **`--llm` spends whether or not `--commit` is passed.** The paid loop runs on
the dry pass; `--commit` only decides whether the SQL is executed. So "dry then
commit" is **two** bills, and because each pass re-asks, the dry pass is not a
preview of what the committing pass will write. Budget for it or run once.

⚠️ **The same flag, the same spelling, now exists on `scripts/research-queue.mjs`**,
which had the identical defect and one worse besides — see [`DONE.md`](../DONE.md),
2026-08-23. One name for one idea; do not invent a second.

## 1. ⚠️ The strongest rung in the project cannot fire here

`docs/info/isbn-ladder.md` measured Open Library by ISBN at **9/10** with a cover
every time, and called it "the strongest rung in either catalog". It is, and it
is **irrelevant to this data**: not one of these rows has an ISBN. They are ebook
files imported from a manifest that carries a title, an author and a path.

Anything reaching for the ISBN ladder to fix covers here is solving the wrong
problem. What these rows have is a **file on disk**, and the file knows more than
the catalog does.

⚠️ **Updated 2026-08-10 — the second half of that sentence went further than
anybody checked.** The files also carry **24 checksum-valid ISBN-13s**, 111
publishers and 108 years in their OPF metadata, none of which is in the database.
23 of the 24 ISBNs resolved against Open Library. The claim "0 ISBNs" is true of
`edition.isbn13` and false of the files. See [`openlibrary-ids.md`](openlibrary-ids.md) §3.1.

---

## 2. Covers — `npm run backfill:covers`

| Source | Works it can cover |
|---|---|
| the EPUB named by `edition.source_url` | **114** |
| the audiobook catalog's `site/covers/` | 27 *(all also covered by the EPUB)* |
| Open Library by ISBN | 0 |
| **result** | **114 of 115** |

The one miss is *What If Everybody Said That?* — a picture book whose EPUB
carries no cover image at all. It renders the deliberate title-on-spine
placeholder, not a broken image.

### The three decisions worth not re-litigating

**Extracted, not hot-linked.** Pointing at the audiobook site's cover URLs would
cover a quarter of the rows and break whenever that site redeploys.

**Resized, not stored raw.** The 114 originals are **106MB**; at 360px wide and
JPEG quality 78 they are **4.2MB**. This household has already had a 377MB `.git`
force a hosting migration (`.gitignore` says so at length). 360px covers a 2×
display at the 150px the grid renders and the 190px the detail panel does.

**A dependency-free zip reader.** `scripts/lib/epub.mjs` is ~70 lines against a
well-specified format, for a job that runs over 116 local files. Stored and
deflate only; zip64 throws rather than returning wrong bytes.

### Where the files live

`apps/web/public/covers/*.jpg`, committed, served by the Worker's assets binding
at `/covers/…`. The name is `slug(work_key)` plus 8 hex of `sha1(work_key)` —
stable across a database rebuild, and collision-proof.

⚠️ **The name hashes the work key, not the image bytes.** Replace a source EPUB,
re-run with `--force`, and the same URL serves different bytes. That is why
`_headers` gives `/covers/*` one day rather than `immutable`.

---

## 2.5 ⚠️ "Has a cover" and "has the RIGHT cover" — migration 0040

> Added **2026-08-11**. Verified against a local D1 with the migration applied
> and the Worker running; **not** yet applied to production. The Illumicrate URL
> below was fetched from the Worker on that date and returned **198,624 bytes**
> of `image/jpeg`.

Everything above this section, and every check written before it, treats
`cover_url IS NOT NULL` as *done*. `collectionStats` counts it, the backfills
skip it, `Enrich` refuses to overwrite it. That is right for a **missing** cover
and silently wrong for a **wrong** one.

The case that forced it: the owner holds the **Illumicrate exclusive** Percy
Jackson set. The vendor page has no per-title images — all seven were downloaded
and inspected on 2026-08-10 and every one is a styled marketing shot. The
instruction was *"use the marketing image now but put a label on them"*. So five
works now share one photograph on purpose:

```
https://us.illumicrate.com/cdn/shop/files/ef4a309d-7981-48e0-b0b2-db9456075c9a__00407_1.jpg?width=1000
```

⚠️ **The five identical cover URLs are deliberate. Do not dedupe them.** Anything
that later notices "five books, one image" and tidies it away is destroying the
record, not cleaning it.

### ⚠️ The Barnes & Noble seven — the same distinction, from the other side

> Measured **2026-08-12** against **production**, and written there. Every URL
> below was fetched *and the image viewed*, not merely byte-counted.

Task #30 was on the work log as *"pull covers for the 7 B&N books"*. Measured
first: **all seven already had one.** `apply-bn-details.mjs` filled them from
the product pages on 2026-08-11, hours after the import, and the log never
caught up. ⚠️ **This is §1's mistake with the sign flipped** — §1 warns against
reaching for a rung that cannot fire; here a whole scraper was nearly built for
a job already finished. Measure before building.

What *was* left is this section's distinction. `cover_status` was NULL on all
seven, which means **nobody had looked**:

| Works | Verdict on looking |
|---|---|
| 229–232 The Wandering Inn split-parts, 234 *Bad B\*tch in the Kitch* | the book's own jacket → `'ok'` |
| 235 *Sunrise on the Reaping* | ⚠️ genuinely the **B&N Exclusive** art — it carries the gold "Barnes & Noble Exclusive / includes special content" seal, matching `edition_name` → `'ok'` |
| 233 *Project Hail Mary* | **wrong edition**, and correctly flagged `'standin'`. Owner preordered the **Deluxe** (`9798217374274`); the stored jacket was the standard 2021 hardcover (`9780593135204`). Replaced with the Deluxe's own art → `'ok'` |

"Cover needed" among the seven went **1 → 0**. `work.cover_status` in production
is now `ok` 7, `standin` 5 (the Percy Jackson set, untouched), NULL for the rest.

### ⚠️ B&N's covers come from a Shopify CDN, and that is not a typo

```
https://cdn.shopify.com/s/files/1/0674/5433/7265/files/{ean}_p0.jpg
```

**That host is barnesandnoble.com's own image CDN** — B&N runs its storefront on
Shopify. It looks exactly like a guessed URL and is not: the product page for
each EAN was fetched and serves precisely that path as its primary image, and a
**bogus EAN 404s**, so the path is keyed to a real product rather than served
blind. `_p1` … `_p5` are the additional product shots.

⚠️ **`prodimage.images.bn.com` — B&N's old image host, and the one every cached
snippet still uses — no longer resolves at all.** Fourteen probes, all DNS
failures. Anything reaching for it is dead code.

So the standing rule (*a cover comes from wherever the ISBN came from*) is
satisfiable for any B&N book with one fetch and no fallback rung. ⚠️ It is
**not** in `backfill-missing-covers.mjs`'s ladder, deliberately: that script only
looks at works with **no** cover, and these had one. The B&N rung belongs in a
scan-time path, not a backfill, if it is ever wanted generally.

### The column

`work.cover_status`, nullable, no CHECK (`gap_verdict.field`'s idiom — the set
may grow and a CHECK would make each addition a table rebuild).

| Value | Means |
|---|---|
| `'ok'` | somebody looked, and this is the book's own cover |
| `'standin'` | we know it is not, and are holding it until a real one exists |
| `NULL` | **nobody has assessed it.** Not the same as `'ok'` |

Nothing was backfilled to `'ok'`, for the reason §3.1 gives about series
verdicts and migration 0013 gives about `decided_how`: it would be accurate and
it would still be a value nothing observed.

**"Cover needed" = `cover_url IS NULL OR cover_status = 'standin'`.** One
function — `coverNeeded` in `@lc/core` — and one SQL fragment, `NEEDS_CLAUSE` in
`packages/db/src/works.ts`; the card mark and the server's filter go through them
so they cannot drift.

⚠️ **`updateWork` pairs the two columns.** A patch that moves `cover_url` without
naming a status sets the status to NULL rather than inheriting the old one — so
a `'standin'` can never survive onto the image that replaces it. Fails in the
direction that loses a warning rather than inventing one.

### Where a cover can now come from

| Route | | Needs R2 |
|---|---|---|
| `PUT /api/works/:id/cover` | link an image somebody else hosts | no |
| `PATCH /api/works/:id/cover-status` | "that is a stand-in" | no |
| `POST /api/works/:id/cover` | upload a file we serve | ⚠️ **yes — not bound** |

Every one verifies before writing, because **nothing in this system ever revisits
a cover column**. The link path fetches the URL (`verifyCoverUrl`); the upload
path reads the file's own **magic bytes** and ignores the `Content-Type` the
browser declared. Both share `MIN_COVER_BYTES`, which now lives in `@lc/core` so
the 43-byte Open Library placeholder cannot be refused down one path and stored
down the other.

⚠️ **The upload route is complete and inert.** There is no `COVERS` binding on
this Worker; it answers 501 with a sentence naming what is missing, and the UI
hides the control. `docs/access/cloudflare.md` §7.1 has the exact commands — and
§7 explains why a *covers* bucket is not the *scan-photo* bucket that must never
exist.

⚠️ **An uploaded object's name hashes the FILE CONTENTS**, deliberately the
opposite of §2's committed `apps/web/public/covers/` names, which hash the work
key — and which is why those can only be given one day of cache. A
content-addressed object can be cached forever, and replacing a cover is simply
a different URL.

---

## 3. Series — `npm run backfill:series`

| Rung | Source | Works |
|---|---|---|
| 1 | `scripts/series-overrides.json` — a person's answer | **23** |
| 2 | the book's own title, via `detectSeriesFromTitle` | **65** |
| 3 | the audiobook catalog's curated `series` column, via `matchIndexedWork` | **13** |
| — | no series found | **14** |
| | | **101 of 115, in 25 series** |

Rung 1 was 0 until 2026-08-10, when the 37 misses were researched one at a time.
§3.1 records what that turned up and what it cost.

### ⚠️ The importer was throwing the answer away

`scripts/import-ebooks.mjs` runs `cleanAudiobookTitle` over every title before
storing it, so `Blackflame (Cradle Book 3)` became `Blackflame` and the series
went in the bin. That is *correct* for `work_key` — the print edition is called
"Blackflame" and the two must meet — and it is why the backfill reads the series
back out of the **file's** `<dc:title>` rather than out of `work.title`.

`calibre:series` metadata was checked first and is present in **0 of 117** files.

### Six title shapes, and the one rule they share

`detectSeriesFromTitle` in `packages/core/src/titles.ts`, all six taken from real
titles in this catalog:

| Shape | Example |
|---|---|
| trailing parenthetical | `Blackflame (Cradle Book 3)` |
| infix volume | `High School DxD - Volume 07 - Ragnarok After the School` |
| marker before a subtitle | `Arcane Pathfinder Book 5: Daunting` |
| trailing marker | `Tamer: King of Dinosaurs Book 10` |
| numeral before a subtitle | `He Who Fights with Monsters 10: A LitRPG Adventure` |
| numeral after a spaced dash | `All The Skills - 5` |

⚠️ **A bare trailing number is never a volume.** `cleanAudiobookTitle` already
records why: Eric Vall's books really are called "Summoner 6", and a rule that
read that as volume 6 of "Summoner" would collapse six distinct works into one.
Every pattern needs a marker word, or a separator a title does not contain by
accident. There is a test for it.

`parseVolumeNumber` handles Arabic, leading-zero, decimal, word and **Roman**
numerals — *Rise of the Weakest Summoner: Volume XI* is printed that way. It
returns null rather than guessing for a label with no place on a number line
("Extra.3", "BR SS Compilation"), and every series-aware SQL sort puts nulls
**last** for exactly that reason.

### What is NOT touched, ever

**`work.title` and `work.authors`.** Both re-derive `work_key` on write, and
`work_key` is what the shared Firestore reviews are filed under. Retitling
"Blackflame" to "Blackflame (Cradle Book 3)" would silently detach the book from
its reviews on both sites. The series goes in the series columns.

---

## 3.1 The 37 misses, researched — 2026-08-10

They were books whose series is knowable and written down **nowhere in either
repo**. All 37 were looked up one at a time and the answers recorded, with a
source per entry, in `scripts/series-overrides.json`.

| Verdict | Works |
|---|---|
| a series, named and sourced | **24** |
| a **true standalone** — researched, belongs to no series | **11** |
| **unknown** — researched, not settled | **2** |

The overrides file carries all 37, because "researched and there is no series"
and "nobody has looked" are different facts and only one of them is a reason to
look again. Its `verdict` field is the distinction; `series: null` means the
backfill writes nothing either way.

⚠️ 24 of 37 filled is the *good* outcome, not a shortfall. `isbn-ladder.md` §4.2
measured that half this library has no free metadata at all, and the standing
rule is that an empty field is correct where a guessed one is a lie that sorts
the shelf wrong and looks exactly like data.

### The four sources, in the order they were tried

| Source | Works it settled |
|---|---|
| the **EPUB's own metadata or text** | 4 |
| the **audiobook catalog's** curated `series` column | 1 |
| **Open Library edition records** | 12 |
| the **publisher's or retailer's** own series label | 7 |

The counts are "which source settled it first"; most entries carry two or three.

### ⚠️ Open Library's `series` is empty in search and populated in editions

`search.json` returned `series: null` for **all 37**, including *Unsouled*, whose
first edition record says `series: ["Cradle, Volume 1"]` in as many words. The
data is on the **edition**, not the work, and not in the solr index:

```
GET /works/<key>/editions.json?limit=50   →  entries[].series, entries[].subtitle
```

That one endpoint is where 12 of the 24 came from, including all six Cradle
volumes and three of the four Secret Projects. Anything that concludes "Open
Library does not know" from `search.json` alone is reading the wrong endpoint —
this is the same shape of mistake as §1's, reaching for a rung that cannot fire.

**Confirmed again 2026-08-10** while filling `work.openlibrary_work_id`:
`search.json` still returns `series: null` for everything, and every series
corroborator in that run came from `editions.json`'s `series` and `subtitle`.
That backfill also reached the endpoint *by id* for the first time — the twelve
above were reached by hand, one at a time, because there was no id to call with.
See [`openlibrary-ids.md`](openlibrary-ids.md).

`subtitle` matters as much as `series`: Hidden Gnome files the volume number
there (`"Ghostwater" :: "Cradle, Volume Five"`) on more editions than it uses the
`series` field at all.

### The other three things that turned up

**One file in 117 carries EPUB3 `belongs-to-collection`.** *World's Only Hero*
declares `Chance Encounter` with `group-position 1`, and `scripts/lib/epub.mjs`
does not read it — it reads `calibre:series`, which is present in **0 of 117**.
One file is not a rung worth building. If Vellum-produced ebooks ever arrive in
bulk, that is the metadata to read.

**Rung 3 missed one it should have caught.** The audiobook catalog knows *Onyx
Storm* is *The Empyrean* book 3, and `matchIndexedWork` did not connect this
library's `Onyx Storm (The Empyrean)` to the audiobook row's cleaned `Onyx
Storm`. The override is the cheap fix, not the diagnosis; worth a look if the
matcher is revisited.

**A blank in the audiobook catalog is not "no series".** Its curated column stops
at *Invent* (Completionist Chronicles book 7) and is empty for books 12–14, all
three of which this library holds and all three of which Mountaindale Press
numbers on its own store page.

### What was deliberately left empty

*Firstborn / Defending Elysium* — a two-novella bind-up whose halves sit in
different places (one uncollected, one Cytoverse), so neither answer is honest.
*Undead Knight* — a self-published 2019 GameLit title with essentially no
metadata anywhere, which is exactly what `isbn-ladder.md` §4.2 predicts.

Both are recorded as `verdict: "unknown"` with what was tried, so the next
session spends its effort somewhere new.

Two more are *partly* empty on purpose. Both *White Sand* rows get the series and
**no volume**: all three volumes are 160pp, so the file's 162 page images cannot
separate them (they do rule out the 496pp omnibus). *Invent Short Story* gets the
series and no volume because it is a five-chapter sampler of book 7 — claiming 7
would collide with the real book if it is ever imported.

⚠️ **`work.title` was not touched for any of this**, and `series-overrides.json`
cannot touch it: the backfill only ever writes the three series columns.

---

## 4. Google Drive links

The ebooks are in the **same tree** the audiobook catalog publishes:
`edition.source_url` is a path under `OpenAudible/books`, and that repo's
`scripts/sync_to_drive.py` uploads that tree to Drive. So its
`author_drive_map.json` (508 folders, 2026-08-09) answers this app's question
unchanged. `npm run sync:drive-map` copies it to
`apps/web/public/author-drive-map.json`.

### ⚠️ Ask the directory, not the author

| Rung | Works with a direct folder link |
|---|---|
| the first path segment of `edition.source_url` | **81** |
| the author's name | 19 |
| neither — Drive **search** only | 15 |

The map is keyed on folder *name*, and only **9 of 23** distinct author strings
in this catalog are in it. The fourteen misses include Ichiei Ishibumi (15
volumes) and Shimizu Yuu (22) — because those light novels are not shelved under
a person at all. They live in `Highschool DXD` and `Seirei Tsukai no Blade
Dance`, which *are* in the map, as folders.

Asking "who wrote this" could never have found them. Asking "where is this file"
does.

Every book always gets the two search links, which need no map, so a stale or
missing map costs precision and never function.

---

## 5. Running them

```bash
npm run backfill:covers                    # dry run, LOCAL database
npm run backfill:covers -- --commit
npm run backfill:series -- --commit
npm run sync:drive-map

npm run backfill:covers -- --remote        # dry run against production
npm run backfill:covers -- --remote --commit
```

Both are idempotent: a second run writes nothing. Both leave alone anything a
person set — a hand-chosen cover from `/api/enrich`, an existing series —
unless `--force`.

⚠️ **`--remote --commit` for covers writes `/covers/…` paths that only resolve
once the built assets are deployed.** Deploy in the same sitting, or production
shows broken images where it currently shows placeholders.

### Two traps these scripts already work around

**`meta.changes` is absent from local D1.** Miniflare returns
`{"meta":{"duration":0}}` for every statement, so summing it reported "0 rows
updated" over a run that had just written 114. Both scripts confirm by
**re-reading the database**, never by trusting the write's own report.

**Never `wrangler d1 execute --command` with multi-line SQL.** It goes through
PowerShell and arrives with literal `\n` two-character sequences in it. Every
statement goes through a temp file — the same rule `CLAUDE.md` gives for
`git commit -m`.
