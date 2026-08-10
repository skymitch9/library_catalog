# Covers, Series & Drive Links — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-10**. Every figure below is a **measured run** on that
> date, against the 115 works in the local D1 (production held 117 at the same
> moment; the two differ by two hand-added test rows). Nothing here is an
> estimate.
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

## 3. Series — `npm run backfill:series`

| Rung | Source | Works |
|---|---|---|
| 1 | `scripts/series-overrides.json` — a person's answer | 0 *(ships empty)* |
| 2 | the book's own title, via `detectSeriesFromTitle` | **65** |
| 3 | the audiobook catalog's curated `series` column, via `matchIndexedWork` | **13** |
| — | no series found | **37** |
| | | **78 of 115, in 18 series** |

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

### The 37 misses are not a bug

They are books whose series is knowable and is written down **nowhere in either
repo** — the six unnumbered Cradle volumes, the Sanderson Cosmere novellas,
Dakota Krout's *Full Murderhobo*. `scripts/series-overrides.json` exists to hold
them, keyed on `work_key`, and it ships empty on purpose: filling it from memory
is precisely what `isbn-ladder.md` §2 says not to do.

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
