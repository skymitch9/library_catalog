# Covers, Series & Drive Links — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10**. Every figure below is a **measured run** on that
> date, against the 115 works in the local D1 (production held 117 at the same
> moment; the two differ by two hand-added test rows). Nothing here is an
> estimate.
>
> §3.1 (the series overrides) is a **second measured run** on the same date and
> the same database, after `scripts/series-overrides.json` was researched and
> filled. Its per-entry sources are in that file, one `source` array each.
>
> **Not verified:** none of these backfills has been run against production.
> See `docs/HANDOFF.md` for the exact pending commands.

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
