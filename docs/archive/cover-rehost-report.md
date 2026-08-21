# Cover rehost & cover hunt — run report

> ⚠️ **ARCHIVED 2026-08-21** during the docs-tree restructure. Kept for the
> reasoning and the evidence, **not as current fact** — do not act on anything
> here without re-measuring. Current state: this repo's `docs/TODO.md`,
> `docs/KNOWN_ISSUES.md` and the `access/` + `info/` indexes. Rules:
> `catalog-platform/docs/DOCS_STANDARD.md` §6.

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Run date: **2026-08-13**, against production D1 (`library-catalog`) and R2 (`library-covers`).
> SQL and R2 only — no repo source files were touched, no deploys, no migrations.

## Did the earlier census hold up?

Mostly. Re-measured before doing anything:

| work.cover_url pointed at | earlier census | measured |
|---|---|---|
| Open Library | ~108 | **107** work rows |
| Google Books | ~43 | **43** work rows |
| Self-hosted (R2 `bookcovers.` + audiobook `covers.heygabi.ai`) | ~33 | **34** (12 + 22) |

The census missed a fourth category: **22 work rows on miscellaneous retail/fan
hosts** (cdn.shopify.com, us.illumicrate.com, strandbooks, papersource,
hachettebookgroup, chroniclebooks, coppermind.net, bigcomicpage, atlanticbooks,
grandcanyon.org, sincerelystacie). Editions carried a further 102 OL + 23 Google
hotlinks (mostly the same URLs as their works). Also present but *not*
third-party and left alone: 115 `/covers/*.jpg` deployed-asset paths and the 22
audiobook-bucket URLs.

## Task 1 — rehost (done)

- **171 distinct third-party URLs** referenced by 172 work rows + 125 edition rows.
- **170 downloaded, byte-sniffed as real images (≥1000 bytes, ≤6MB), hashed and
  uploaded** to `library-covers` as `covers/{slug}-{sha256[0:16]}.{ext}` with
  `Cache-Control: public, max-age=31536000, immutable`. Zero upload failures.
  Key slugs use the exact `coverObjectKey` algorithm from `packages/core/src/covers.ts`.
- **295 rows updated** (171 work + 124 edition), every UPDATE guarded on the row
  still holding the old URL so a concurrent edit could not be clobbered. All
  guards matched.
- **`cover_status` untouched by construction** — the affected works were 160
  NULL / 7 `ok` / 5 `standin` and remain exactly that.
- **change_log batch `2cd0b163-1658-4c3e-863c-3e10f8048b7a`: 296 rows**, one per
  field change, `changed_how='auto'`, original URL preserved in `note` and
  `old_json`.
- The one URL that failed: `https://covers.openlibrary.org/b/id/-1-L.jpg` on
  work 280 / edition 391 — OL's "no cover" sentinel (cover id **-1**), serving
  HTTP 503. Edition 391's copy was cleared to NULL (logged in batch 1); work
  280 got a real cover under Task 2.
- End state: **zero third-party cover hotlinks remain** in `work` or `edition`.
  Work rows: 204 R2, 115 local assets, 22 audiobook bucket, 5 NULL.

## Task 2 — covers for the 25 works that had none (+ Ender's Game repair)

**21 found and applied** (20 of the 25, plus the work 280 repair). Every one
uploaded to R2 the same way; `cover_url` set only where it was still NULL (or
still the dead sentinel, for 280); **`cover_status` left NULL deliberately** —
nobody has assessed these. change_log batch
`0a0d8bb9-27df-40d4-a789-c9a50a324101`, 21 rows, evidence in each note.

| Source | Works |
|---|---|
| OL cover keyed by the exact ISBN | 267 Busy Busy Farm, 323 Animal Heroes, 339 Last Child in the Woods |
| Google Books volume keyed by the exact ISBN (metadata title matched) | 266 Don't Tickle the Dinosaur!, 297 AF Lost Colony, 335 Possibility & Promise (979-8 KDP — GB had it, no Amazon route needed) |
| OL search, title+author matched in result metadata | 294 AF Atlantis Complex, 304 My First Things That Go, 349–352 Dark Is Rising 1/3/4/5, 353–355 Speaker/Xenocide/Children of the Mind |
| Amazon image CDN keyed by ISBN-10 of the exact ISBN | 289 Artemis Fowl, 295 AF Last Guardian |
| Kyobo cover CDN keyed by the exact ISBN | 305 하츄핑의 눈물 |
| League of Comic Geeks (Skybound Prelude HC entry), visually verified | 258 The Wizard, The Witch, The Wild One |
| Amazon CDN, canonical Tor mass-market (visually verified) | 280 Ender's Game |

All 21 images were opened and visually confirmed to show the right title/author.

**Caveats a person may want to eyeball (all honest covers, noted in change_log):**
- **258** — the book is the Worlds Beyond Number graphic novel (Skybound
  Kickstarter, releases ~June 2027); this is the *announced* cover and could
  change before print.
- **269 Who Goes Roar?** — the owned ISBN 9781836422808 appears in **no database
  anywhere**; the applied cover is the 2019 Make Believe Ideas printing
  (9781788436878) of the same title/author/publisher — visually the tabbed
  dinosaur board book the listings describe.
- **280 Ender's Game** — cover is the canonical Tor mass-market; which printing
  the household owns is unknowable because the stored ISBN is wrong (below).
- **304** — OL's image is a photo of the Autumn Publishing shaped board book;
  title and publisher matched exactly, but Autumn reissues could differ.

## Not found — 5 works, and the dead end for each

All five are **Autumn Publishing (Bonnier/Igloo) supermarket-exclusive board
books whose ISBNs are absent from every database tried**: OL (43-byte
placeholder), Google Books (volume exists for four of them but has *no image*),
AbeBooks ("no exact matches"), Waterstones jacket CDN (404), B&N image CDN
(500 — that pattern appears dead entirely), Amazon US+UK+DE image CDN by
ISBN-10 (placeholder), and general web search (the ISBNs appear on zero pages).

- 274 My First Toys (9781839035944)
- 287 My First Farm Animals (9781839035920)
- 288 My First Wild Animals (9781839035951)
- 296 My First Ocean Animals (9781839035937)
- 303 My First Food (9781839035913)

**Deliberately skipped as untrustworthy:** Amazon/IglooBooks sells a *different*
"My First Toys" (9781499880366, IglooBooks US line) — same title, sister
imprint, but no way to confirm the art matches the Autumn printing, and a wrong
cover is worse than none. The realistic fix: these books are on a shelf in this
house — photograph them through the app's upload flow.

Also discarded: Google Books' image for ISBN 9780765362438 while repairing work
280 — GB says that ISBN is a different book (next section).

## Needs a person

1. **Edition 391 (attached to work 280, Ender's Game) has the wrong ISBN.**
   `9780765362438` is *Children of the Mind* (ISBN-10 0765362430) per Google
   Books; OL has no record of it. Meanwhile work 355 (Children of the Mind) has
   an edition with **no** ISBN. Likely the ISBN belongs on work 355's edition.
   Left untouched — identifier surgery is beyond the covers brief.
2. **Photograph the five Autumn board books** (above) — no online source exists.
3. Optional eyeball of 258 / 269 / 280 / 304 per the caveats.
4. **Naming nit for the next code session:** change_log rows here use
   `field='cover_url'` (as this task specified), while the app's edit routes
   write API-spelled `'coverUrl'` per migration 0120's comment. If the Changes
   panel filters by field name, it may want to treat the two as one.

## Verification

```bash
# from apps/worker — should return zero rows:
npx wrangler d1 execute library-catalog --remote --command \
  "SELECT id, cover_url FROM work WHERE cover_url LIKE '%openlibrary%' OR cover_url LIKE '%google%'"
# the two audit batches:
npx wrangler d1 execute library-catalog --remote --command \
  "SELECT batch_id, COUNT(*) FROM change_log WHERE changed_how='auto' AND field='cover_url' GROUP BY 1"
# spot-check an object serves with the immutable header:
curl -sI https://bookcovers.heygabi.ai/covers/ender-s-game-orson-scott-card-554bb5c215912642.jpg
```

R2 now holds 191 new objects (170 rehosted + 21 found). Rollback material for
every change is in `change_log.old_json`.
