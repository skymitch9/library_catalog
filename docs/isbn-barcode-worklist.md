# ISBN backfill — what needs the barcode — Information Reference

> **Audience:** the owner at the shelf, and Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-13** (all rows read from production D1 that morning;
> every claim below states its source or says "not found").

The 2026-08-13 research pass (Fable 5, `change_log` batch `isbn-backfill-20260813`)
split the 71 physical ISBN-less editions three ways:

| Outcome | Count | Meaning |
|---|---|---|
| **Written** | 6 | publisher-stated ISBN, edition uniquely pinned — now in `edition.isbn13` |
| **Settled without an isbn13** | 1 | Words of Radiance leatherbound: a two-volume set with two ISBNs; both recorded in `edition_name` (slipcase precedent), `isbn13` NULL on purpose |
| **Needs the barcode** | 64 | listed below, grouped for shelf work |

The 7 slipcase volumes (Cooper ×4, Card ×3) were skipped by rule — they carry the
set's ISBN in `edition_name` already and often no barcode of their own. The 117
ISBN-less ebooks are out of scope: a print ISBN on an epub row is a wrong fact,
and none of their `source_url`s (all local epub paths) yield an ASIN without
guessing which store listing matches the file.

## ⚠️ Rescanning is now SAFE — what the scan will do (2026-08-13)

The path this list waits on exists as of commit `634f4d8`. Scanning a barcode
the catalog has never seen, on a book it already holds, no longer writes a
duplicate edition and copy — it **stops and asks**, in the same shape as the
pre-order prompt:

1. **"This is the [printing] already on the shelf — record this ISBN on it"**
   — the answer for everything on this list. The ISBN lands on the ISBN-less
   row, the copy learns which printing it is, and nothing new is created.
2. "I have two of it" / "a different printing I own" / "a different book" —
   the other honest cases, each button saying what it writes.
3. **If the ISBN is already on another row** (the Realmkeeper case below), the
   scan does not dead-end: it names the row that holds it and offers to note
   the shared ISBN in this row's `edition_name` — the slipcase treatment.

Every write lands in `change_log` with who and how. A book with **several**
ISBN-less printings (the two Dungeon Crawler Carl V1 rows) shows one button
per row — pick by the edition name on the button.

## Why "needs the barcode" is the honest answer here

Almost everything below is a **crowdfunded or retailer-exclusive printing** —
Kickstarter editions, Illumicrate exclusives, campaign tiers. These mostly never
appear in Open Library or retail databases, and several may carry **no ISBN at
all** (a crowdfund-only printing needs none). Only the object on the shelf says.
While scanning: if there is no barcode, check the copyright page — KDP-printed
crowdfund copies often state a `979-8…` ISBN there that no barcode shows.

## The shelf list, by author

### Brandon Sanderson — 1 (not on the shelf yet)
| Title | Edition | What is known |
|---|---|---|
| Fires of December (HC) | Book with sticker and bookmark tier | ⚠️ This is the **Dragonsteel premium illustrated edition** from the Hoid's Storybook Collection campaign, shipping ~Dec 2026. Searches surface **9781250462657 — that is the Tor retail edition, a different object; do not use it.** Revisit at delivery. |

### Dakota Krout — 8
| Title | Edition | What is known |
|---|---|---|
| Ritualist, Regicide, Rexus: Side Quest, Raze, Ruthless (5× HC) | Kickstarter Grimoire Edition, faux leather | Kickstarter exclusives; no public ISBN listing found anywhere. Barcode or copyright page settles it. |
| Unmapped (HC + PB) | Mountaindale, Jan 2026 | One print ISBN exists publicly — **9781637663608** (checksum valid) — but **no source states whether it is the hardcover or the paperback**, and the sibling format's ISBN was not found at all. One scan of either book settles both. (Untapped's pair WAS determinable and is written.) |
| Dungeon Born (PB) | — | **At least two paperback printings exist**: the original 2016 printing and the Mountaindale reprint 9781950914050. The barcode says which one this is. |

### Jadzia Axelrod & Sarah Webb — 3 (likely not shipped yet)
| Title | Edition | What is known |
|---|---|---|
| The Wizard, The Witch, The Wild One (3× HC) | Wizard / Witch / Wild One variant covers, Skybound 2027 | Variant covers of one printing usually share **one** ISBN — and the UNIQUE index means only one row could carry it. Check at delivery; if they share an ISBN, record it slipcase-style in `edition_name` on the other two. |

### Luke Chmilenko — 2
| Title | Edition | What is known |
|---|---|---|
| Ascend Online (HC) | Kickstarter Collector's Edition | Kickstarter exclusive; nothing public found. |
| Legacy of the Fallen (HC) | Collector's Edition | Same. |

### Matt Dinniman — 5
| Title | Edition | What is known |
|---|---|---|
| Dungeon Crawler Carl (2× HC) | V1 Limited / V1 Standard | Both from the V1 Kickstarter (URL on the rows); no public ISBNs. The two rows need distinguishing at the shelf anyway — scan both. |
| Carl's Doomsday Scenario (HC) | Kickstarter limited edition | V2+V3 campaign; nothing public. |
| The Dungeon Anarchist's Cookbook (HC) | Kickstarter limited edition | Same campaign. |
| Dungeon Crawler Carl: Crocodile (HC) | Campaign-only exclusive, signed extras | Campaign exclusive; nothing public. |

### Michael-Scott Earle — 22
All crowdfunded print copies (Kickstarter/Indiegogo); MSE has no retail print
channel, so nothing is publicly indexed. These are the likeliest of the whole
list to carry **no ISBN at all** — check the copyright page when the barcode is
missing and record "none" as a finding, not a failure.

| Series | Volumes here |
|---|---|
| Space Knight | Books 1–9 (nine copies: 1–4 and 7–9 Kickstarter, 5–6 Indiegogo) |
| Tamer: King of Dinosaurs | Books 1–11 (eleven copies) |
| Monster Empire | Books 1–2 (signed Kickstarter paperbacks) |

### Rick Riordan — 5
| Title | Edition | What is known |
|---|---|---|
| Percy Jackson 1–5 (5× HC) | Illumicrate Exclusive | Illumicrate runs are publisher-produced exclusives that usually carry their own ISBNs printed on the jacket — but which ISBN is on *these* jackets cannot be settled remotely. Scan them. |

### Sandra Boynton — 1
| Title | Edition | What is known |
|---|---|---|
| Dinosaur Dance! (HC) | — | Exactly **two** Little Simon candidates: **9781481480994** (2016 board book) and **9781665907903** (2021 oversized Lap Edition). If the barcode is unreadable, size decides — the Lap Edition is the oversized one. |

### Selkie Myth — 16
Beneath the Dragoneye Moons, the Realmkeeper Kickstarter set: **8 physical
omnibus volumes, each holding 2 books**, so these 16 edition rows describe 8
objects. Kickstarter exclusive; nothing public found.

⚠️ **Structural note before scanning these:** two edition rows share each
physical volume. If a volume carries an ISBN, the UNIQUE index means only ONE
row can hold it — record it like the slipcases (volume ISBN into both rows'
`edition_name`, or isbn13 on one and a note on the other). The scan fill
handles the collision itself: a fill that hits a row already holding the ISBN
offers "note the shared ISBN on this printing's name" instead of failing.
Each volume's scan resolves to ONE of its two books, though — after filling
that one, note the volume's *other* row by hand (book page → Editions →
Edit → edition name), since no second scan will ever reach it.

### Zogarth — 1
| Title | Edition | What is known |
|---|---|---|
| The Primal Hunter (HC) | Collector's Edition Trilogy — Book 1, signed & numbered | Kickstarter exclusive; nothing public found. |

## What was written (for the record)

All six carry `change_log` rows (batch `isbn-backfill-20260813`) with source URLs.

| Edition | ISBN-13 | Source |
|---|---|---|
| Tress of the Emerald Sea — YoS premium HC | 9781938570322 | Dragonsteel product page |
| Frugal Wizard's Handbook — YoS premium HC | 9781938570339 | Dragonsteel product page |
| Yumi and the Nightmare Painter — YoS premium HC | 9781938570377 | Dragonsteel product page |
| The Sunlit Man — YoS premium HC | 9781938570391 | Dragonsteel product page |
| Untapped — Mountaindale HC | 9781637663295 | Thriftbooks (binding+pages) + Amazon listing |
| Untapped — Mountaindale PB | 9781637663301 | AbeBooks (binding stated) |

Words of Radiance signed leatherbound: Vol 1 **9781938570308**, Vol 2
**9781938570315** (Dragonsteel page), preserved in `edition_name`; `isbn13`
stays NULL because one row cannot carry two ISBNs.
