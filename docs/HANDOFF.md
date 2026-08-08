# Handoff

> Created 2026-08-08. **Nothing is built.** This file exists so the first real
> session starts with context instead of rediscovering it.

## What this is

A clone-in-spirit of `boardbuddy/Board_Game_Catalog` — Cloudflare Worker + D1 +
Access, scanning-first — for physical books and ebooks.

## Start here, in this order

1. **Read `catalog-platform/docs/LIBRARY_CATALOG.md` end to end.** It is a full
   system design, not notes. Do not re-derive it.
2. **Do its phase 0 first.** ⚠️ Everything that document says about external
   book APIs is **knowledge, not measurement** — its own header says so. Phase 0
   exists to replace that with live calls to Open Library and Google Books
   before anything is built on it.
3. **Copy `CLAUDE.md`'s Windows section** from the Board Game Catalog before the
   first commit: `git commit -F <file>` never `-m`; PowerShell has no heredocs;
   sweep for UTF-8 corruption with `grep -rn 'â€\|Â·\|Ã' --exclude-dir=dist`.
   Each of those bit that project repeatedly.

## The single most important design fact

**Barcodes invert.** In board games they are a weak primitive — GameUPC resolved
2 of 4 real games, and crowdfunded editions often carry no retail barcode at all.
For books that reverses: near-universal ISBN-13 since ~2007, and far deeper free
databases. So **barcode-first is the strategy here**, and vision is the fallback
for pre-ISBN books, ebooks and bulk shelf intake.

## What ports verbatim, per the design

`camera.ts` and `scanner.ts` (every line is a WebKit constraint, not a
preference) · `docs/info/ios-camera.md` · the `scan_job` queue with
`scan-ownership.ts` and `withFreshView` · the ladder *shape* · the photo
dimension constants · `packages/research` including `tiers.ts`.

## What must change

- **`matchIndexedTitle`** — matching on title alone is unsafe for books. Titles
  collide across authors constantly, and Kindle rows carry `B0…` ASINs no ISBN
  database knows, so they can only reach a work by name.
- **`classifyShelfResults`** — rewrite as *series* detection. "Mistborn: The
  Final Empire" is a volume, not an expansion. `audiobook_catalog` already
  models series properly; reuse that shape.
- **`SHELF_SYSTEM`** — book spines are rotated 90° and carry author and
  publisher colophon. It must return **title and author** per spine.

⚠️ **Do not write a second similarity function.** `isConfidentMatch` carries the
0.7 spine floor and the fragment rule.

## ⚠️ The stated blocker, and how much of it is left

The design says this is *"blocked on finishing the Board Game Catalog"*, for one
specific reason: fix the matcher **there** so this fork inherits a correct one.
It cites `BOSS MONSTER` → `Super Boss Monster 2` as the failure.

**Re-read that section against the matcher as it stands now, not as it was on
2026-08-07.** On 2026-08-08 the Board Game Catalog gained an `item_alias` table
(migration 0021) backfilled from BoardGameGeek's alternate names, a punctuation
fold on the search path, and the 0.7 fragment guard was re-confirmed rather than
loosened. That blocker may be partly or wholly discharged. Measure before
assuming either way.

## Open question to settle early

From the design: **should read-state and ratings live here, or in Firestore
beside the audiobook reviews?** It is the one thing that genuinely spans all
three formats, and it is cheaper to decide before the schema than after.

## Not merging with audiobook_catalog — decided

`PLATFORM.md` §2.2: each catalog keeps its own database; a shared index holds a
projection for cross-cutting queries; nothing is merged. Audiobooks are
read-only because they are pipeline-fed 3×/day; books and games are added by
hand, which is what the scanning is for.

"I own this in audio and paperback" is answered by a **format column plus the
index**, joined on a key the index normalises **once, on write** — because this
household has already shipped the bug where Python and JS both split author
strings, drifted, and failed a promote silently.
