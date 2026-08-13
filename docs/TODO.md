# library_catalog — work log

> **Audience:** Claude sessions first, the user second. **Status:** TRACKED.
> Last verified: **2026-08-12 late**, against production — the audio-series
> confirmation (migration 0110) and the gaps-chip removal were both read back
> from the live site, not assumed. Live version `d441ecd1`.
>
> ⚠️ **Keeping this current is a standing instruction, not a courtesy.** Every
> ask goes in the moment it is made. The user relies on this file as the record,
> not on scrollback — an ask that is acted on but never written down looks
> exactly like one that was dropped.
>
> This is the living work log. Stable facts live in `docs/access/` and
> `docs/info/`; current state lives here. Cross-link, don't duplicate.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Done and verified |
| 🚢 | Deployed to production |
| 🔨 | In flight |
| ⏸️ | Blocked — the blocker is named |
| 💤 | Deliberately deferred |

## ⚠️ Read this first — state at 2026-08-13 08:00Z (end of the overnight run)

**Branch:** `main`, pushed through `b617c80`. **Working tree: NOT clean** — a Fable
build agent is mid-flight in *this* checkout (see below). Do not assume the tree
is yours until it lands.

**Usage at 08:00Z:** session **90%** (over the 89% threshold, resets in ~31 min),
weekly all-models **57%**, **weekly Fable 9%**. So the overnight plan worked as
intended — Fable's separate allowance is barely touched.

### What is DONE and committed

| Thing | Where | State |
|---|---|---|
| Frozen-field guard on `PATCH /works/:id` (title, authors) | `apps/worker/src/routes/catalog.ts` | **DEPLOYED** `1a78c0b8`; Fable exercised it with 13 live probes |
| Audio-hedge fix — owned audio no longer says "you might own this" | `packages/core/src/completeness.ts`, migration 0110 | deployed |
| Gaps chip removed from the collection stat strip | `apps/worker/src/routes/catalog.ts` `/stats` | deployed |
| Intake fixes: typed ISBN persists as an edition; `intent` defaults to `owned` | `apps/web/src/components/AddWork.tsx` | deployed |
| Board books count as hardcover | data | applied |
| Deploy guard (lock + git-ancestry) | `scripts/deploy-guard.mjs`, `scripts/deploy-done.mjs` | has now run on itself twice |
| **Migration 0120** — `change_log`, `reviews_seen_*`, authorless index | `migrations/0120_change_log_and_authorless.sql` | ⚠️ **LOCAL D1 ONLY — NOT applied to production** |
| All four edit-and-audit decisions approved by the owner | `docs/TODO.md` top, `catalog-platform/docs/PLATFORM.md` §4a | recorded |

### ⚠️ What is IN FLIGHT — read before touching code

A **Fable 5 agent is implementing the edit-and-audit design in this working
tree** (no worktree isolation — my dispatch error). It is working through
`docs/info/edit-and-audit-design.md` §7's "code changes riding along" table, in
priority order: `@lc/core` (`constants.ts` `UNKNOWN_AUTHOR`, `titles.ts`
`workKeyFor` sentinel branch, `reviews.ts` `reviewDocFor` throw, `schemas.ts`,
`core.test.ts`) → `@lc/db` `works.ts` → worker `catalog.ts`/`reviews.ts` → web UI.
It commits and pushes to `main`; **it must not deploy and must not run the remote
migration.** Its progress log is `docs/FABLE5.md` §7.

**If it did not finish:** finish fewer things completely rather than leaving a
half-written route. Check `git status` and `docs/FABLE5.md` §7 first.

### Pending commands the OWNER must run (nothing here is automated)

```bash
# 1. Production migration for 0120 — ONLY after reviewing the code that rides along,
#    so new code never meets an old schema (CLAUDE.md: migrate, THEN deploy).
npm run db:migrate            # remote; additive only, no table rebuild

# 2. Then, and only then:
node scripts/deploy-guard.mjs && npm run deploy && node scripts/deploy-done.mjs
```

Leaving 0120 unapplied is **safe indefinitely** — it is purely additive, so
production stays self-consistent (old schema + old code).

### ⚠️ Gotchas discovered that will cost you time

- **The sentinel's collision proof needs BOTH halves.** `normaliseTitle` emitting
  only `[a-z0-9 ]` (verified over an 8448-codepoint sweep) is necessary but **not
  sufficient**: `normaliseTitle('?unknown') == normaliseTitle('Unknown') ==
  'unknown'`. The proof also requires `workKeyFor` to **bypass the fold** for the
  sentinel. Deleting that branch reads as a harmless simplification and would
  silently collide every authorless book with real "Unknown"-credited ones.
- **The one-barcode-one-edition guard is specced but ABSENT FROM CODE** — no OL
  `/works/` refusal exists anywhere under `packages/`. This is the defect that
  corrupted #300/#301/#302 from single barcodes. ⚠️ **Scanning resumes today with
  ~100 books left, so fix this before scanning.**
- **A rescan writes a second copy + a second same-format edition**, silently. 71
  physical editions carry no ISBN and the documented answer ("a barcode scan will
  fill it in later") describes a path that does not exist. Residue is already live
  at work #139.
- **`wrangler dev` does not die with its parent and leaks badly** — 212 orphaned
  processes holding 15.6 GB, one leak per agent worktree. Kill by name.
- **Local D1 commands run from `apps/worker`,** not the repo root, and
  `--command` must be **single-line** — multi-line crashes wrangler with a libuv
  assertion and silently executes nothing.
- `curl -o /dev/null` reports status `000`/exit 43 on a healthy host in Git Bash.
  Use `-o NUL`, or PowerShell `Invoke-WebRequest`.

### Verification commands

```bash
npm test && npm run typecheck                    # core rules + types, both must be green
cd apps/worker && npx wrangler d1 execute library-catalog --local   --command "SELECT COUNT(*) FROM change_log"    # 0 rows locally; probes were cleaned up
curl -s localhost:8787/api/health                # dev worker, no sign-in needed
```

### The one thing still owed to the owner

The `/queue` residue research (~190 records) was claimed but **not started** — the
session threshold arrived first. The owner asked to be told about it today. Method
recorded: group by what is missing, publisher's own site first, apply only what a
source states, and write up the unfindable **with the dead ends** — what cannot be
found is a result, not a failure.

---

## Production right now

Measured **2026-08-12**, live version `d441ecd1`:

| works | editions | owned copies | preordered | audio rungs | series_volume |
|---|---|---|---|---|---|
| **258** | 288 | **152** | **12** | 134 | 147 |

Movement since the crowdfunding rescan landed: works 233 → 258, owned copies
117 → 152. Audio corroboration: **17 series confident, 2 hedged** — and the 2 are
now confirmable by hand, see below. Of the 70 live `audiobook_holding` rows,
**all 70 are `exact`**; zero rest on containment.

### 🚢 "You might own this on audio" — the owner can confirm it, 2026-08-12

**Shipped.** Commit `3d892d9`, migration 0110 applied to production, live version
`a06b2ead`. ⏳ **One manual step remains and it is the point of the feature:**
press the button on the two series pages — see the bottom of this section.

**The ask, in the user's words:** *"can we check the series gap, some of them say
you might own this on audio, its been right everytime i checked. I want it to
recognize i do own them on audio."*

**Measured against production 2026-08-12** — the hedge is **5 rungs in 2 series**,
and it is unreachable by the automatic rule:

| Series | Hedged rungs | We hold | They hold | Why `fold` |
|---|---|---|---|---|
| Arcane Pathfinder | 1, 2, 3, 4 | book **5** only | 1–4 | no volume in both catalogs |
| Legion | 4 | 1 and 2 | **4** only (the omnibus) | no volume in both catalogs |

⚠️ **Re-running `backfill:audiobooks` can never fix these.** `work_match`
requires one volume present in BOTH catalogs, matched by title *and* author, and
**agreeing on its number** — that pair is what corroborates the name mapping and
the numbering together. These two series have **zero overlap**, so there is no
volume for the rule to stand on. `fold` here is not weak evidence, it is *absent*
evidence. Both series names are byte-identical on the two sides.

Also measured: **all 70 live `audiobook_holding` rows are `exact`** — zero
`containment` — so these 5 rungs are the only source of "possibly on audio"
anywhere in production.

**The fix:** the same shape as `series_gap_skip` and `series_check.known_total` —
a decision the owner records, not a heuristic. Migration **0110**
`audiobook_series_link`, a third `AudioSeriesMatch` value `'owner'`, and a button
on the series page. ⚠️ **Not** a promotion to `work_match`: the page still says
who vouched for it, because "a work corroborated this" and "you told me" are
different facts and only one of them can be checked.

⚠️ **The confirmation cannot live in `audiobook_series_holding.series_matched_via`** —
`backfill-audiobook-holdings.mjs` upserts that column with
`series_matched_via = excluded.series_matched_via`, so the next script run would
erase it. A script-owned column cannot hold a human decision.

**What was built**

| File | What it does |
|---|---|
| `migrations/0110_audiobook_series_link.sql` | `audiobook_series_link` — one row per series, keyed on our spelling, storing **their** spelling as a guard |
| `packages/core/src/completeness.ts` | `AudioSeriesMatch` gains `'owner'`; `held()` rewritten as **"not the hedge"**; `gapAudioLabel` third branch |
| `packages/core/src/schemas.ts` | `confirmAudioSeriesSchema` — `audiobookSeries` required, `note` optional |
| `packages/db/src/series.ts` | loads the links, applies the guard in `toAudioRungInput`, `confirmAudioSeries` / `unconfirmAudioSeries`, `audioLink` on the report |
| `apps/worker/src/routes/series.ts` | `POST` / `DELETE /api/series/:name/audio-link` |
| `apps/web/src/pages/SeriesDetailPage.tsx` | the `AudioLink` panel, and two `=== 'work_match'` tests became `!== 'fold'` |

⚠️ **`held()` is now written as "not the hedge" rather than as a list of the
values that count**, and that is deliberate. The two failure modes are not
symmetric: a value missing from an allow-list silently keeps counting a book the
owner owns as missing — the exact bug this feature exists to remove — while an
unrecognised value is already forced to `'fold'` at the `@lc/db` boundary. Two UI
branches carried the same equality test and both would have silently kept a
confirmed rung red; both are fixed.

**Verified locally, 2026-08-12** — migration applied to local D1, the Legion
fixture seeded as `fold`, and the Worker driven through the whole flow:

| Step | Result |
|---|---|
| before | rung 4 `fold`, `maybeOnAudio 1`, attested gaps **2** |
| POST a mapping no rung carries | **404**, report unchanged — the guard holds |
| POST `{audiobookSeries: 'Legion'}` | rung 4 `owner`, `onAudio 1`, attested gaps **1** |
| DELETE | back to `fold` and **2** |
| rename the rung's `audiobook_series` behind it | reverts to `fold`, and the stale link stays on the report so the page can say it is holding nothing up |

`npm test` 313 pass (2 new), `npm run typecheck` clean across all 7 workspaces,
`npm run build` clean.

**✅ Run against production 2026-08-12** — `npm run db:migrate` (0110, schema
only, additive), then `npm run deploy`. Smoke-tested after: `/api/health` reports
`database: up`, `audiobook_series_link` exists in production, and all three
`/audio-link` routes answer 401 unauthenticated as they should.

**✅ Both confirmed by the owner in the browser, 2026-08-13 01:43** — and read back
from production. ⚠️ Confirmation was left manual on purpose: the owner IS the
evidence, so a migration that pre-confirmed these would be the app asserting a
mapping on its own authority, which is the thing `'fold'` exists to refuse.

Effective grades across all 135 live audio rungs, read from production
2026-08-13: **130 `work_match` (17 series) · 5 `owner` (2 series) · 0 `fold`.**
Nothing in the app says "possibly on audio" any more.

What the two pages now read, verified in the browser rather than inferred:

| Page | Sentence |
|---|---|
| `/series/Arcane Pathfinder` | *"1 book of at least 5 — **nothing here is missing**. 4 more you own on audio."* |
| `/series/Legion` | *"2 books of at least 4 — 1 more beyond it, on a source's word. **1 more you own on audio**."* |

Each rung reads *"you own this on audio, as “…” — you confirmed the series
match"*, and the panel offers **"Take that back"**.

⚠️ **The series list agrees with both detail pages** — checked deliberately,
because §1.4a and the `Holdings` header in `SeriesDetailPage.tsx` each record a
bug where those two screens disagreed about which books they were counting.
*Arcane Pathfinder* shows `4 ON AUDIO` and **no** MISSING chip; *Legion* shows
`1 MORE LISTED` + `1 ON AUDIO`.

Header counts moved as expected — **certainly missing 60 → 56** (the four
`earlier` Arcane rungs) and **on a source's word 3 → 2** (Legion's `attested`
rung 4).

⚠️ **"WITH GAPS" stayed at 26, and that is correct, not a bug.** It counts rungs
absent from *this* catalog, which is a different question from "missing" — those
four Arcane books genuinely have no ebook or printing here, and "buy the
paperback" is still a decision somebody might make. `gaps.length` vs
`certainGaps`/`attestedGaps` is exactly that distinction, and `completeness.ts`
keeps them apart on purpose.

### 🔨 #341 *He Who Fights with Monsters* book 1 — THREE hardcovers, TWO or THREE editions

Owner: *"we have the target edition with no dust jacket and the barnes and noble
one with a dust jacket that is signed, we also have a 2nd barnes and noble one
that is not signed with a dust jacket."*

**✅ Already done:** #341 is filed as **series "He Who Fights with Monsters",
volume 1**, so it now sits with the ebooks of 2, 3, 5, 6 and 10 and their matched
audiobooks. It previously had no series at all and was floating free.

**Researched 2026-08-13 — the editions, with sources read directly:**

| | Edition A — in hand, dust jacket | Edition B — Target exclusive, no dust jacket |
|---|---|---|
| ISBN | **9781638493457** (off the barcode) | **9781638494362** |
| publisher | AETHON: Vault (dist. Simon & Schuster) | same |
| published | 2026-07-07 | 2026-07-07 |
| pages | **768** ⚠️ contested, see below | not published |
| price | $32.00, list $35.00 | $24.50, MSRP $35.00 |
| features | bonus story *"When Farrah Met Gary"*, **sprayed edges (first two printings ONLY)**, spot-gloss dust cover, foil-stamped case + spine, custom art endpapers | **gold foil case wrap**, sprayed **and stencilled** edges, Target-exclusive letter from the author |

⚠️ **Edition B's ISBN is genuinely its own.** It was read out of Target's embedded
product data (`"primary_barcode":"9781638494362"`), and Target's *separate*
non-exclusive listing carries `9781638493457` — so Target itself distinguishes
the two. That is the strongest corroboration available.

⚠️⚠️ **THERE IS A THIRD HARDCOVER, AND IT MAY BE ONE OF THE OWNER'S TWO B&N
COPIES.** ISBN **9781638494355** — AETHON: Vault, published **2026-04-28**, **704
pages**, format label "Special", whose own blurb reads *"Now through July 6th, this
hardcover edition is only available at Barnes & Noble."* **B&N stocks exactly two
hardcovers — `…3457` and `…4355` — and nothing else.** The owner has **two** B&N
copies with dust jackets, so they are plausibly the two *different* B&N ISBNs
rather than two copies of one.

**→ Before creating edition rows: read the barcode on the SECOND B&N copy.** If it
is `…4355`, that is a third edition row, not a second copy. Recording two copies
of `…3457` when one is really `…4355` would merge two printings, which is the
`edition` table's one job to keep apart.

**What to record once that is known:**
- Edition `9781638493457` — hardcover, dust jacket → **1 signed copy** (and a second unsigned copy *only if* the 2nd B&N book is the same ISBN)
- Edition `9781638494362` — hardcover, no dust jacket, Target exclusive → **1 copy**
- Edition `9781638494355` — **only if** the 2nd B&N copy scans as this → 1 unsigned copy
- ⚠️ #341 currently has **one bare copy with no edition** and **no edition rows at all** — reuse or clear that copy rather than ending up with a phantom fourth.

**Also from the research, worth fixing:**
- ⚠️ **Book 1's subtitle is "Outworlder"** — the canonical hardcover title is *He Who Fights With Monsters, Book 1: Outworlder*. The catalog's other volumes use `…N: A LitRPG Adventure`, which belongs to the **older 2021 ebook/audio line**, not the hardcovers. Do not retro-fit "A LitRPG Adventure" onto book 1.
- **First published 9 March 2021** (Aethon, ebook). The 2026 date is this hardcover line.
- ⚠️ **#341's cover art is the TARGET edition** — the thumbnail carries an "only at Target" badge — while the record is meant to be the dust-jacket edition. Swap it once the editions are split.
- ⚠️ **Page count unresolved:** B&N, Goodreads and Book Loft say **768** for `…3457`; Target's non-exclusive listing for the same ISBN says **704**, as does the `…4355` variant. Record 768 and treat 704 as retailer data bleed — but it is not settled.
- ⚠️ **Sprayed edges are NOT a Target-only feature** — the trade hardcover has them on printings 1–2. So "sprayed edges" alone does not identify which edition a copy is; the ISBN does.

### 🔨 Cover swap — port it from the Board Game Catalog

Owner: *"like the board game site can we just get the cover swap feature if we
don't already have it."*

⚠️ **We do not have it.** What exists today (`routes/covers.ts`) is: `PUT` a URL,
`POST` an upload, `PATCH` a status, `DELETE`. All of those *replace* the one
`work.cover_url`. There is **no** notion of holding several candidate covers and
choosing between them, and no way to see the alternatives you are choosing from.

Why it matters here specifically: **147 of this catalog's covers are hotlinks** —
106 Open Library, 41 Google Books — which fetch fine server-side but render
unreliably in a browser, and only **11** live in our own R2. A swap UI is also the
natural place to move a hotlink into R2 permanently.

⚠️ Read the sibling implementation before designing: the Board Game Catalog has
this feature and this repo's cover rules were largely ported from it, so the
candidate-list shape and the "which one is canonical" decision are already solved
there. Also honour migration 0040 — **`cover_status` travels with `cover_url` or
not at all** — a swap must carry the status across, or a "stand-in" flag survives
onto its replacement.

### 🔨 Completionist Chronicles 12 & 13 — signed, in BOTH formats, 2026-08-13

Owner: *"These are a part of completionist chronicles. The pictures I uploaded are
paperback copies that are signed we also have hardcover versions of each of these
signed too."*

⚠️ **Both works already exist and both are ebook-only**, so this is four copies to
record, not two books to add:

| work | title | vol | has | needs |
|---|---|---|---|---|
| **#34** | Untapped | 12 | `ebook_epub`, **0 copies** | signed **paperback** + signed **hardcover** |
| **#33** | Unmapped | 13 | `ebook_epub`, **0 copies** | signed **paperback** + signed **hardcover** |

Both Dakota Krout / **Mountaindale Press**. No ISBNs — the photographs are front
covers and back blurbs, no barcodes — so the editions go in without one and a
barcode scan can fill them later.

⚠️ **`copy.is_signed` is the whole point of this entry.** It is one of the fields
`docs/info/crowdfunding-and-accessories.md` says *only a person can fill* — no
importer or lookup will ever set it — so if these four copies are recorded without
ticking **Signed**, the fact is lost and nothing will flag it. The **Record a copy**
panel is the right tool: it creates the edition, the copy, and carries the Signed
checkbox in one go.

⚠️ Note the rest of the series for contrast: works **238–242** (*Ritualist*…
*Ruthless*) each hold a hardcover with **`signed = 0`**.

**✅ And that question is now partly answered — #238 *Ritualist*'s hardcover IS
signed.** Owner, with a photo of the hardcover: *"Another for completionist
chronicles this book is hard cover signed."* So this is **not** a new copy to add
— #238 already holds the hardcover, and its existing copy needs `is_signed`
flipped to true.

⏳ **Still unknown for 239–242** (*Regicide*, *Rexus: Side Quest*, *Raze*,
*Ruthless*) — all four hold a hardcover with `signed = 0`. If the whole
Kickstarter set is signed then all four are wrong, but ⚠️ **do not infer it from
#238** — one confirmed book is not evidence about four others, and this is exactly
the kind of "it was probably the same" guess the catalog refuses elsewhere. Ask,
or look.

### ⚠️ THE 1PASSWORD OVERLAY WAS EATING THE SAVE CLICK — found 2026-08-13

**This explains most of tonight's "silent save failures", and it is not a bug in
the app.** Several books were typed into `/add?mode=type`, the form looked right,
Save looked enabled, the click landed — and no row appeared.

The accessibility tree carried
`status "1Password menu is available. Press down arrow to select."` while the
extension's autofill overlay sat over the form. The Save click went to the overlay.

⚠️ **The fix is one keystroke: press `Escape` first, then click Save.** *Animal
Heroes* failed twice and went in on the very next click after an Escape. Anything
driving this form — a person or an agent — should dismiss the overlay before
saving, and **a save that appears to do nothing should be suspected of this before
anything else.**

⚠️ It also explains the *earlier* misdiagnosis: the "hydration" theory recorded
below fits some cases, but the overlay fits all of them, including the ones with
long waits where hydration cannot have been the cause.

### ✅ Books added late in the session — 2026-08-13

**#323 *Animal Heroes*** — Karleen Bradford, Scholastic school-market edition.
⚠️ The back cover carries only an **ISBN-10, `0-590-18796-1`**; the ISBN-13
`9780590187961` was derived by computing the check digit and then **confirmed
against Open Library**, which lists it on the 1995 Scholastic Canada printing (90
pp). Landed with the paperback edition and an owned copy.

Still to enrich: **first published 1995**, a description (the back cover offers
"thirteen true stories of animals who saved lives"), and a cover. ⚠️ There is also
a sequel, ***More Animal Heroes*** (1998, `9780590187978`) — watch for it in the
stack, the ISBNs are adjacent and easy to confuse.

**#7 *Dungeon Born*** — owner: *"We have this as an epub. Add that we own a
paperback edition."* Done via the Copies panel's **Record a copy**, which is the
one UI that creates an edition and its copy together. It now holds `ebook_epub`
(from file) **and** `paperback` (from manual), with the paperback on the shelf.
⚠️ No ISBN on the paperback — the photograph was the front cover only, and
guessing which Mountaindale printing it is would be inventing. Scanning its
barcode will fill it in.

***Possibility & Promise*** — Matthew "Momo" Modrow, ISBN `9798278220268`. A
friend's self-published book. **Researched, and the question is settled: it is a
standalone with a SUBTITLE, not a series** — so leaving `series` blank was right.

| field | value |
|---|---|
| subtitle | **Echoes of the Unknown** ⏳ still to add |
| publisher | Independently published (Amazon KDP) |
| published | **14 December 2025** (paperback; Kindle 27 Dec) |
| pages | **446** |
| ASINs | `B0G7PQ845R` paperback · `B0GCTQFFBC` Kindle |
| genre | hard SF · AI/robots · first contact |

⚠️ **Why "not a series" is a real finding and not an absence of effort:** neither
Amazon listing carries a "Part of series" element or a "Book 1 of N" banner — KDP
surfaces those prominently when an author sets them — the interior title page is a
plain title-colon-subtitle stack with no "Book One of…" line, and **it is the
author's only published book**, so no sibling volume exists to define a series.
A sequel could retro-fit the name later; nothing published says so today.

⚠️ **Two corrections to the transcription I made from the photo:** the character is
**Miku** (Miku Amarah), not "Mike", and the world is named **Trevek**. Also worth
knowing: the book is **not in Open Library**, and Google Books returned 429 rather
than a negative — so it is untested there, not absent.

⚠️ Amazon's author field reads **Matthew Roland Modrow** (paperback) and *Matthew
Modrow* (Kindle) while the cover byline is *Matthew "Momo" Modrow*. Same person,
legal name vs. byline. The catalog holds the **cover byline**, which is the right
call — but it is a candidate for an author **alias** if lookups ever need it.

***Last Child in the Woods*** — Richard Louv, ISBN `9781565126053`, Algonquin
Books (Workman / Hachette), $18.99 US. ⚠️ Subtitle **"Saving Our Children from
Nature-Deficit Disorder"** still to add — the type-a-title form has no subtitle
box, so it needs the new field on the book page. The copy is the 2020 printing
(`Printed in the USA 0220`, cover © 2020) of a much older title.

**⏳ Queued on #7 *Dungeon Born* specifically** — owner: *"Dungeon born also has
an audiobook so make sure that's linked. This is the divine dungeon series in the
Cal verse."* Two separate jobs: confirm the `audiobook_holding` row is present and
showing, and file the series into the **Cal** universe. ⚠️ Do **not** invent the
universe name — `packages/universes` is generated from `catalog-platform`, which
owns the canonical list, and `normaliseUniverseText` deliberately keeps leading
articles. Check what the list actually calls it before assigning.

### ⚠️⚠️ ONE BARCODE, SIX EDITIONS AND SIX COPIES — the OL work-record bug, 2026-08-13

**The worst bug of the session.** The owner: *"Space knight barcode scanned caused
a weird duplicate record… we have all of space knight and tamer already
recorded."* It is not a duplicate — it is an **aggregate**.

Scanning one Space Knight barcode produced work **302**, titled with the bare
series name *Space Knight*, carrying **six editions with six unrelated ISBNs and
six copies**:

`9781951641061` · `9781951641078` · `9781951641085` · `9781951641139` ·
`9781951641696` · `9781951641719` — 2020 and 2024 printings, all
`source = openlibrary`.

⚠️ **So the catalog claimed the household owned six copies of a book that does not
exist**, while the nine real volumes (works 249–255, 69, 70 — *Space Knight Book
1*…*9*) sit there with **no ISBNs at all**. The scan hoarded their identifiers
onto a phantom.

**Same bug, same author's barcodes, three works:**

| id | title | editions | copies | verdict |
|---|---|---|---|---|
| 302 | Space Knight | 6 | 6 | ✅ deleted |
| 301 | Tamer | 1 | 1 | ✅ deleted — authors even read *"Brian King, Michael-Scott Earle"*, a giveaway that the record is an aggregate and not one book |
| 300 | Monster Empire | 2 | 2 | ⏳ **still present** — same shape, awaiting the owner's word |

**Diagnosis.** The ISBN ladder resolved to an Open Library **work-level** record
rather than a specific edition, and the add path then created *an edition for
every ISBN that OL attaches to that work*, plus **a copy per edition**. The rule
it breaks: **one barcode is one edition and at most one copy.** A work record on
Open Library aggregates every printing of every volume in a series, so any series
whose OL work is filed that way will do this again.

⚠️ **Suspect any work whose title is a bare series name with several editions.**
That is the signature — *Space Knight*, *Tamer*, *Monster Empire* all had it, and
all three were created by scanning within a few minutes.

**Deleted by SQL, because there is no other way** — see the item below.

### 🔨 Add a record-delete button — asked 2026-08-13

Owner: *"Add a todo to add a record delete button."*

⚠️ **`DELETE /api/works/:id` already exists** (`routes/catalog.ts:305`, gated on
`editCatalog`) and **nothing in the web app calls it** — `grep deleteWork` across
`apps/web/src` returns nothing. So a junk row can only be removed with
`wrangler d1 execute`, which is exactly the remedy `WorkFields`' own header says
this app exists to avoid. Removing works 301 and 302 tonight required raw SQL.

Safe to build: all **15** foreign keys to `work(id)` are `ON DELETE CASCADE`
(verified across every migration), so a delete cleans up its editions, copies,
aliases, watches and read-state without orphans.

⚠️ Wants a confirm step that **says what will go with it** — the 302 case would
have read "6 editions and 6 copies", which is precisely the information that makes
the delete obviously right. And it belongs with the audit log in the edit-any-detail
item below: a delete is the one edit that cannot be undone by re-editing.

### 📋 Opus progress log — ⚠️ Fable reads this to avoid collisions

Owner, 2026-08-13: *"make sure you are committing to your todo doc so fable can
check your progress."* So this section is the mirror of `docs/FABLE5.md` §7.

**Protocol, symmetric with Fable's:** claim an item **before** starting, commit and
**push** every claim and result, and record what could not be solved along with
what was tried. ⚠️ Both runs share one filesystem and one `origin` — an
uncommitted note is invisible to the other run.

```
[ISO timestamp] CLAIM|DONE|BLOCKED|UNSOLVED  <item>  — <detail>
```

⚠️ Do not rewrite earlier entries; an abandoned claim followed by an `UNSOLVED`
records that it was attempted, which a tidy log does not.

<!-- entries start here -->

- `2026-08-13T20:50Z` ⚠️ **DO NOT CANONICALISE THE SAMG AUTHOR STRINGS — the split is load-bearing, and the obvious "fix" is the bug.** Measured, not inferred: `normaliseTitle` reduces **any wholly non-Latin title to the EMPTY STRING** — Korean, Japanese, Chinese, Cyrillic and Greek all fold to `""`. (Accented Latin is fine: *Amélie* → `amelie`. Mixed keeps the Latin part: *Naruto 나루토 7* → `naruto 7`.)
  So the two Korean works carry keys that are **nothing but the author**: #195 `|samg` and #305 `|samg entertainment`. ⚠️ **Merging those two author spellings — exactly what an author-canon pass would do — would give two different books the identical `work_key`**, and the ~860-review join would treat them as one book. The estate survey flagged this; measuring it makes it sharper: **the guard is accidental, and it is one tidy-up away from failing.**
  **Current exposure: 2 works with an empty title half, 0 duplicate keys.** But this is general, not a quirk of these two — every future book titled wholly in a non-Latin script lands in the same state, and the library is growing.
  ⚠️ **Three ways out, and the owner should pick, because none is free:**
  1. **Fix `normaliseTitle`** to transliterate rather than strip. Correct, and ⚠️ **it is a migration of every stored key in BOTH catalogs plus every Firestore review document carrying one** — `CLAUDE.md` already says changing that function is a migration, not an edit. Cross-repo, coordinated, not a quiet afternoon.
  2. **Leave the author split as the guard.** Free, and fragile: it survives only while nobody tidies it, and its load-bearing role is invisible at the point where someone would "clean it up". Now written down, which is the only thing making it safe.
  3. **Give those works Latin-containing titles** (romanised or English), so the title half is non-empty. Cheap and local, no shared-function change — but it is a **title edit, i.e. a key move**, and it loses the fidelity of the printed Korean title unless a romanised form is added alongside.
  **My read: (3) for these two now, (1) recorded as the real fix for when the estate next coordinates a key migration.** Doing nothing is (2) by default, which is the option that fails silently.

- `2026-08-13T20:30Z` **FIXED — and it was invisible to the queue** ⚠️ **22 works had `series_index_sort` set with `series_index_display` NULL: they sorted into exactly the right position and PRINTED NOTHING.** This is the two-column trap flagged this morning, found live. ⚠️ **`detailGaps` could not see it**, because the gap test is `seriesIndexSort == null` — so the details queue reported **zero gaps** while 22 books showed no volume number on the page.
  ⚠️ **Two items had been sitting on this list for days as "needs a volume number" — #341 (sort 1) and #195 (sort 8) — and the number was there the whole time.** The work was never missing; it was unprintable. All 22 backfilled from their sort values with audit rows. **The LOGIC is still wrong** and will silently readmit the state — sent to Fable: the field is missing if sort is null **OR** the display is blank.
  Same class as the `copy.edition_id` NULL problem: **a field whose absence is only visible from one direction.** Both were found by looking at the object from the other side rather than by any check.
- `2026-08-13T20:30Z` **DONE** Four running-list items cleared: **#7 Dungeon Born → universe `CAL Verse`** (⚠️ matched to the **exact existing production spelling**, which 12 works carry — `normaliseUniverseText` treats spellings as distinct, so "Cal Verse" would have silently created a **second universe beside the real one**); **#186 Bizzy Bear: Dinosaur Safari → volume 11**, with its stale `unknown` verdict deleted in the same batch because a verdict beside a value is contradictory; **#339 *Last Child in the Woods*** → subtitle *Saving Our Children from Nature-Deficit Disorder*; **#341** → subtitle *Outworlder*.

- `2026-08-13T20:05Z` **DECIDED — do not relitigate** **The book number stays ABOVE the title.** Owner approved 2026-08-13. Fable had flagged this as *"the decision to revisit"* if the owner had pictured a floating corner chip — they had not. ⚠️ **Recorded because that flag would otherwise sit in `FABLE5.md` §7 as an open invitation**, and a future session reading it would "fix" a placement that was deliberately chosen: a corner chip collides with title wrap on phones, while above-the-title reads as a catalog number.

- `2026-08-13T19:55Z` **DONE** ✅ **Details queue empty again — 0 descriptions, 0 gaps of any kind.** The 7 outstanding were **not residue**: they were the works *created today* by splitting the Cooper and Card slipcase sets, which arrived with titles, authors, series, volumes and years but no descriptions — the expected consequence of turning 2 records into 9. Written as **brief factual summaries in the catalog's own voice** (matching #269's style), ⚠️ **deliberately not publisher jacket copy**, which is copyrighted text and not something to paste into a database by reflex.

- `2026-08-13T19:41Z` **DEPLOYED** ✅ **Version `dded6f29`** — the illustrator credit and the book number are live. Health green, **347 tests pass**, typecheck clean.
  **Illustrator** renders as *"Illustrated by Shannon Hays"* directly under the byline — same serif, smaller and muted so the author stays primary — and a null renders **nothing at all**. Editable from **About → Edit**, deliberately **not** from the ceremony panel: putting a Free field behind the key-move UI would mislabel it as dangerous.
  ⚠️ **The one rule held with ZERO route changes**, which is the good kind of outcome: an illustrator-only PATCH computes `newKey === oldKey`, so the plain path takes it and **the ceremony never fires**. A new core test pins **`workKeyFor.length === 2`** as a tripwire — a literal guard against anyone widening the signature to include the illustrator.
  **Book number** sits above the title: monospace, muted, `#269`. Built as `<code role="button">` rather than `<button>` ⚠️ **because button text is unselectable in several browsers**, which would defeat the entire purpose — the number exists to be quoted. `user-select: all` makes one tap grab the whole token; a click copies it.
  **Placement to revisit if wrong:** the id went **above** the title rather than in a corner, because a corner chip collides with title wrap on phones. Five lines of CSS if the owner pictured a floating corner.
  ⚠️ **Not browser-verified:** the rendering and the copy tap were checked by typecheck and build only. **One attended look at production #269 settles both** — and #269 is the ideal page for it, being the one book carrying an author, an illustrator, a publisher and an ISBN in four separate homes.
  Production #53 was checked and is **intact** — the agent's probe misstep that cleared a `series` was local-D1 only, as it reported.

- `2026-08-13T19:00Z` ⚠️ **POST-MORTEM: the session limit was hit and the usage check did not stop it. My failure, and the rule had a real hole.**
  **What happened:** a read was taken at **55%**. Immediately after it I dispatched the rescan agent, which cost **279k tokens**, then dispatched a second agent, and **took no further read**. The limit was hit mid-build and killed the illustrator/book-number agent.
  ⚠️ **Every sentence of the existing rule was followed and the run still died.** "Pulse-check whenever anything is running" names **no moment**, so it is satisfiable by a read taken *before* the expensive thing — which measures the one interval guaranteed to contain none of the spend. The global rule already warned that *"a subagent's cost is invisible until it lands"* and that *"the granularity of risk is one agent, not one tool call"*; what it lacked was a required read at the moment the cost becomes knowable.
  **Fixed in `~/.claude/CLAUDE.md` — two MANDATORY trigger reads, plus a doubled cadence at the owner's instruction:**
  1. **AFTER every agent lands** — the completion notification is the first moment the number is knowable.
  2. **BEFORE dispatching any agent** — dispatch is the irreversible commitment; after it the cost is already being incurred.
  They answer different questions (*"can I afford to start this?"* vs *"what did that actually cost?"*) and neither substitutes for the other. Periodic cadence while anything is in flight is now **at least twice as often as feels necessary**.
  **Damage: none.** The killed agent died after committing its claim (`b70ddc2`) and **before writing any code**, so the tree was clean and nothing needed salvaging — it simply had to start over. Verified by `git status`, not assumed.
- `2026-08-13T19:00Z` **DONE** **#269 *Who Goes Roar?* is fully resolved** — author **Christie Hainsby** (owner-confirmed; Make Believe Ideas omits writers from covers, which is why the object names only the illustrator), illustrator **Shannon Hays**, publisher **Make Believe Ideas Ltd** on the edition, ISBN `9781836422808`, first published 2019. **Three credits, three homes, none displacing another** — two hours earlier the publisher sat in the author field because there was nowhere else to put anything. The illustrator column landing first is what freed `authors` for the actual writer.

- `2026-08-13T18:20Z` **DONE** **The Illumicrate Percy Jackson five carry no discernible ISBN** — owner checked the objects. Recorded on all five editions and in `change_log`. ⚠️ **This disproves a research expectation rather than merely failing to confirm one:** the worklist reasoned that "Illumicrate runs are publisher-produced exclusives that usually carry their own ISBNs printed on the jacket". The object says otherwise, so the blank `isbn13` is now **observed**, not open. **That closes the last of the 9 "worth scanning" candidates** — the remaining ~70 physical editions without an ISBN are overwhelmingly Kickstarter printings that never had one.
- `2026-08-13T18:20Z` **DONE + DEPLOYED-PENDING** **Migration `0130_work_illustrator.sql` applied to local AND production**, adding nullable `work.illustrator`, backfilled with the two credits that forced it: **#174 Judi Abbot**, **#269 Shannon Hays** — both previously surviving only as `change_log` notes, which is not a place anyone reads. Both books name **no writer anywhere on the object**, so `authors` holds the publisher and the illustrator was the only human credited.
  ⚠️ **The one rule, written into the migration header so it cannot be lost: `illustrator` MUST NEVER ENTER `work_key`.** The key is `title|primaryAuthor` and joins ~860 reviews across two catalogs — folding the illustrator in would mean **correcting an illustrator moves the key and orphans reviews**. `workKeyFor`'s two-argument signature is the guard. Display and edit only; a **Free field**, never key-moving, never frozen.
  Not backfilled beyond those two: an unrecorded illustrator is *"nobody has looked"*, not *"there is none"* — 0040's rule. Most novels stay NULL and there is no not-applicable sentinel, because absence already says it.
- `2026-08-13T18:20Z` **CLAIM (Fable)** **Put the book number on the detail page.** The owner: *"since we use book number so frequently can we get book number somewhere on the page?"* — the work id (`#269`) is currently **invisible in the UI**, obtainable only from the URL or from me, despite being how we refer to books constantly. Near the title or in a corner, visually quiet, and ⚠️ **selectable / click-to-copy**, since its entire purpose is being quoted into a conversation.

- `2026-08-13T16:38Z` **DEPLOYED** ✅ **Version `97c0d762` — "a rescan is a question, not a second copy" is LIVE. Scanning a book already in the catalog no longer creates a duplicate.** Health green. 346 tests pass (11 new), typecheck clean everywhere.
  **What the shelf now looks like:** scanning a slipcase volume raises a prompt — *"'Title' is already in the catalog, but the barcode you scanned is not on any of its printings. Which is it?"* — with one primary button per ISBN-less printing that **records the ISBN and creates nothing**, plus honest alternatives for "I have two of it", "a different printing I own" (the #341 case), "a different book", and "never mind". ⚠️ **Nothing is written before a question is answered**, so walking away leaves the catalog untouched.
  ⚠️ **The Realmkeeper dead-end is handled**: a fill that hits the catalog-wide UNIQUE index returns a 409 **naming the printing that holds the ISBN**, and the client offers the slipcase treatment instead of failing at a person holding a book.
  **It also closes the 67%-NULL defect at its source:** every fill links the owned copy to the printing the scan just proved, and "Add 2nd copy" now sets `copy.edition_id` too — that was the minting point.
  ⚠️ **All edition and copy mutations now write `change_log` with an actor in the same `db.batch`. They logged NOTHING before**, so the audit log only covered works until this deploy.
- `2026-08-13T16:38Z` **NEEDS ONE ATTENDED TEST BEFORE TRUSTING** ⚠️ Two browser flows are verified by typecheck, build and precedent — **not by being driven**: the **rescan prompt** and the **key-move ceremony** (`countReviewDocs → restampReviews → PATCH`). Both need one attended run on the **dev lane** before being trusted on live data. The ceremony matters more: it is the only path that touches the ~860-review join, and every key move made today deliberately went around it via SQL for exactly that reason.

- `2026-08-13T17:55Z` **RESOLVED** ⚠️ **#269 *Who Goes Roar?* was never wrong — the catalog's ISBN is correct and the WEB is what is missing.** The owner photographed the back cover: it prints **ISBN13 978-1-83642-280-8** and a barcode reading **9781836422808**, exactly the value already stored, check digit valid. Earlier research reported that this ISBN *"resolves to nothing anywhere on the open web"* and that every listing used `9781788436878` — **that was true of the web and false about the book.**
  ⚠️ **The lesson generalises and belongs beside the ladder's measured hit rates: an ISBN's absence from every index is NOT evidence the ISBN is wrong.** Copyright is 2019 but the `978-1-83642` prefix is a newer Make Believe Ideas range, so this is a **later printing of a 2019 title** — precisely the case that is real, in hand, and unindexed. The instinct to "fix" the record would have replaced a correct ISBN with a different edition's.
  Added from the photographs: **ISBN10 `1836422806`** (printed `1-83642-280-6`, check digit valid), **publisher Make Believe Ideas Ltd**, **published year 2019**.
  **ILLUSTRATOR: Shannon Hays**, credited on the back cover, recorded in `change_log` — the second book today whose illustrator survives only in the audit log. That is now two independent votes for the `illustrator` column.
  ⚠️ **Still open, and the photo does NOT settle it:** this repo previously recorded that **Christie Hainsby** is the credited writer, on the basis that Make Believe Ideas omits writers from covers. **No writer is named anywhere on the object** — consistent with that claim rather than proof of it. `authors` is currently the publisher, which matches the #174 precedent. Changing it to Hainsby is a **key move** and needs the owner's word plus a source, not an inference.

- `2026-08-13T17:35Z` **DONE** **The Autumn Publishing six all carry `first_published = 2025`** (#274, #287, #288, #296, #303, #304) — owner's call, from the shared *June 2025, Third Edition* printing line. Their stale `unknown` verdicts were deleted, since a verdict and a value together are contradictory. **No copyright page needed after all**; the shelf task is cancelled.
  ⚠️ **Two honesty notes attached in `change_log` rather than left implicit.** First, **this is the PRINTING date, not the work's first publication** the column normally wants — the same distinction that had Cooper at 2007 and Card at 1991. It is recorded knowingly as the best available fact, because these are set-internal ISBNs marked *"not for resale"*, absent from Open Library entirely, so **no work-level date is findable anywhere**. Second, stored as the bare year `2025` and not `2025-06`: ⚠️ **every one of the 313 dated rows in this table uses a 4-digit year**, so a month-qualified value would be the sole exception and the odd one out for sorting. The month survives in the audit note.

- `2026-08-13T17:20Z` **DONE** **#174 *I Love You, Little Bear* is finished** — author **Parragon Books**, `primary_author` and `work_key` moved with it, subtitle *Peek-a-Boo Adventure*, first published **2013**. No writer is credited anywhere; the publisher's editorial staff wrote it collectively, which is the case the owner's standing "use the publisher" rule exists for.
  ⚠️ **"Judi Abbot" was never a wrong attachment** — she is credited on this exact ISBN as the **ILLUSTRATOR** (Giuditta Gaviraghi, same person under a pen name). Her credit is preserved in `change_log` **because the schema has no illustrator field**, so the alternative was losing it silently.
  Done as SQL rather than through the ceremony Fable just shipped, deliberately: ⚠️ **that ceremony's browser flow is explicitly UNTESTED end-to-end** and Fable's own note asks for one attended retitle on the **dev lane** first. Using an unexercised path for the first time on live data would be the opposite of careful.
- `2026-08-13T17:20Z` **TODO** ⚠️ **The schema has no illustrator field, and this library is full of picture and board books where the illustrator is the credit that matters.** #174 forced the choice between recording the writer-less publisher and keeping the illustrator; both are true and only one column exists. Today the illustrator survives only in an audit-log note. ⚠️ **An `illustrator` column must NOT be folded into `work_key`** — the key is `title|primaryAuthor` and joins ~860 reviews across two catalogs, so widening it is a migration of every stored key, not a column addition. Straightforward as a nullable display field; the discipline is keeping it out of the key.
- `2026-08-13T17:20Z` **NOTE for the rescan flow** ⚠️ **A duplicate EDITION and a duplicate COPY are different bugs, and #139 proves it.** Its second edition was pure rescan residue, while its **two copies are real** — the owner confirmed owning two *Dinosaur Dance!* books. A flow that collapses both on the assumption they travel together would **silently delete owned books**. The four outcomes must keep that distinction straight.

- `2026-08-13T17:00Z` **DONE** ⚠️ **The owner's Dinosaur Dance answer did not fill a gap — it exposed the duplicate.** "Ends with 480994" identified `ed225`, which **already held** `9781481480994` (Little Simon 2016, from Open Library). The blank row beside it, `ed232`, was a `manual` edition with no ISBN, publisher or year: **rescan residue**, and the exact case the estate survey cited for work #139. Consolidated onto ed225 (it carried no fact ed232 lacked), with ed232's whole row kept in `change_log`. Both copies are now linked to the real edition — two of the 177 that named none.
  ⚠️ **OPEN QUESTION FOR THE OWNER: #139 has TWO copies.** Is that two physical *Dinosaur Dance!* books, or a rescan artefact? **I deliberately did not guess** — guessing a copy count is the error already made once today, and deleting a copy is not reversible from the log alone.
- `2026-08-13T17:00Z` **DONE** **Unmapped: the one known ISBN went on the hardcover.** `9781637663608` (check digit valid) is the only public *Unmapped* print ISBN and ⚠️ **no source states its binding**. `idx_edition_isbn13` is UNIQUE, so it fits exactly one row. Owner: *"just pick one, I can swap it later."* Chose the hardcover from a **weak sibling-pattern inference** — Untapped's determinable pair ran hardcover-first numerically (…295 HC before …301 PB) — and the `change_log` note says outright that this is an inference, not a sourced fact, with the swap recipe: clear ed471, then set ed470. The paperback stays NULL because **there is no second ISBN to assign, and inventing one would be a wrong fact rather than a missing one.**
- `2026-08-13T17:00Z` **SETTLED** **"No barcode on the object" is now recorded, not left blank.** Owner checked the physical books: **Dungeon Born PB and Unmapped PB carry no printed barcode.** Written into `edition_name` so the blank `isbn13` reads as an **observed** fact rather than an unanswered question — the same distinction 0040 draws between NULL and an assessed value. No future pass should re-ask these.

- `2026-08-13T16:30Z` **DECIDED — do not reopen** ⚠️ **epub editions are NOT backfilled with identifiers.** Owner, 2026-08-13. The **117 `ebook_epub` rows with no `isbn13`/`isbn10`/`asin` are a settled state, not a backlog** — recorded properly in `docs/info/isbn-ladder.md` so a future session does not read that count as a gap and start closing it. Three reasons: a print ISBN on an epub row is a **wrong** fact rather than a partial one; much of this library genuinely has none (about half is absent from Open Library, dominated by KU and Audible-native titles); and ⚠️ **not even the ASIN is research-determinable**, because those rows' `source_url`s are **local epub file paths** and matching a file on disk to a Kindle listing is itself a which-object guess. Fable raised that third point against my own framing and was right. Fable wrote **zero** ASINs, which was the correct call.

- `2026-08-13T16:00Z` **CLAIM (Fable)** **Backfill ISBNs where determinable.** Measured: **195 editions carry no `isbn13`/`isbn10`/`asin`** — but that number is misleading. **117 are `ebook_epub`**, 46 hardcover, 32 paperback; minus the **7 deliberately ISBN-less slipcase volumes** created today, the real target is **71 physical editions**, matching the estate survey exactly.
  ⚠️ **This task is a DIFFERENT SHAPE from the details backfill, and treating them alike would produce confident wrong data.** A first-published year is a fact about the **WORK** — one right answer, any good source gives it. **An ISBN is a fact about an OBJECT**: one work has dozens of editions, each printing and territory carrying its own, so *"find the ISBN for The Grey King"* has **no single correct answer** and only the book on the shelf says which. Research can prove an ISBN *exists*; it usually cannot say *which one is on the shelf*.
  **So the deliverable is the SPLIT, not the coverage:** editions where the ISBN is genuinely determinable (written, each with a `change_log` row carrying its source), versus editions that can only be settled by reading the barcode — delivered as a shelf-ready list grouped by author/series. ⚠️ **A short correct list plus an honest "these need the barcode" beats 71 plausible guesses**, and since the owner is actively scanning, "needs the barcode" is actionable advice rather than a failure.
  ⚠️ **Traps named in the brief:** a print ISBN on an ebook edition is a WRONG fact, not a partial one (an ISBN identifies a format-specific edition; Kindle books want the **ASIN** column the schema already has); the 7 slipcase volumes must be skipped; never pick the most popular printing when several match; validate check digits, because a transposed digit is a valid-looking entirely different book.

- `2026-08-13T15:45Z` **DONE** **Two slipcase sets split into their real books — 9 works now, was 2.** *The Dark Is Rising Sequence* (#349 Over Sea Under Stone 1965, #298 The Dark Is Rising 1973, #350 Greenwitch 1974, #351 The Grey King 1975, #352 Silver on the Tree 1977) and *The Ender Saga* (#280 Ender's Game 1985, #353 Speaker for the Dead 1986, #354 Xenocide 1991, #355 Children of the Mind 1996). Each has an owned copy and a slipcase note.
  ⚠️ **Both stored years were the BOX printing, not the work.** Cooper's said **2007** and Card's said **1991** — and 1991 is *Xenocide*'s year, which had leaked onto the set record and would have been inherited by *Ender's Game*. `first_published` wants the work's first publication, and for reissued sets those differ by decades.
  ⚠️ **Volumes are deliberately ISBN-LESS.** The scanned barcode belongs to the SET, and slipcase volumes frequently carry none of their own. A missing ISBN is honest; the set's ISBN copied onto five novels would be five wrong facts. The set ISBN is preserved in `edition_name` and the copy notes.
  **The Card key move IMPROVES the review join** rather than risking it: the old key was `ender quartet|orson scott card`, a *set* name no review could ever carry, and the new `ender s game|orson scott card` is what a real review would use.
- `2026-08-13T15:45Z` ⚠️ **A heuristic worth keeping, and it would have saved today's mix-up: a reported PAGE COUNT means one bound volume; its absence points to a box of separate books.** Open Library gave Cooper's ISBN **1088 pages** — which reads as an omnibus, and is what an automated pass would have concluded — while Card's set reported none. The owner has the physical object: Cooper is a **slipcase of five**. So the page count is a good FIRST FILTER and never a verdict. ⚠️ The same question got Narnia wrong in the other direction (thought separate, actually an omnibus), which is the real lesson: **for a set, ask the shelf before writing SQL.**

- `2026-08-13T15:18Z` **DEPLOYED** ✅ **Version `8433e561`. The one-barcode-one-edition guard is LIVE, so scanning is protected.** Health check green (`database: up`, 7 universes). Shipped together: Fable's three guard tiers, the key-move ceremony and gate, the evidence floor, `change_log` writes, the strict-schema fix ending the strip-lie, the sentinel containment pass, and the web surface. **335 tests pass, typecheck clean in every workspace.**
- `2026-08-13T15:18Z` ⚠️ **The deploy guard has a wart, found by it blocking me.** `predeploy` already runs `deploy-guard.mjs`, so running the guard **manually first** takes the lock and then the deploy's own guard refuses — *"opus started a deploy 0.0 min ago"*, a deadlock against yourself. **Correct usage is `npm run deploy` alone**, never `deploy-guard && npm run deploy`. Either teach the guard to recognise its own holder within the same run, or delete the manual step from the docs.
- `2026-08-13T15:18Z` **NOT DONE, and nothing to undo** ✅ **The Narnia split was NOT applied.** It failed on a wrong column name — `edition_notes` lives on `copy`, not `edition` — and ⚠️ **D1 rolled the whole `--file` batch back atomically**: 0 `change_log` rows, still one Narnia work, title untouched. The owner then corrected the premise (**it IS an omnibus**; the seven-separate-books memory belonged to a different, unscanned set). So the mistake in my SQL happened to save the work — but the lesson is the atomicity, which is now demonstrated rather than assumed: **a failed `--file` batch leaves nothing behind.** #324's `gap_verdict` note was rewritten to record the correction; the `none` verdict stands either way, because an omnibus is not volume N of its own series.

- `2026-08-13T11:50Z` **DONE** ✅ **THE DETAILS QUEUE IS EMPTY — 0 works owing anything, down from 62 works / 80 gaps.** Every gap was answered from a source, or recorded as `none`/`unknown` so it stops being asked. Nothing was invented to fill a blank.
- `2026-08-13T11:50Z` **DONE** **#299 merged into #333 (*The Maze Runner*) rather than repaired in place**, and the reason is structural rather than stylistic: ⚠️ **`work_key` is NOT unique** — 0001 gives it a plain index, not a unique one. Correcting #299's misspelt title and author *in place* would have produced **two works carrying the identical key `maze runner|james dashner`**, both matching the same reviews — a worse defect than the unmatchable key it replaced. The merge keeps **two paperback editions and two owned copies**, and #299's whole row is in `change_log` as undo material. ⚠️ Deleting it was never an option once the copy count was corrected: it stood for a real physical book.
- `2026-08-13T11:50Z` **DONE** **#328 retitled *Keepers of the Light* with volume 1.** Its stored title asserted *“Book Two of the Broken Prophecies”* while its ISBN `9780999264201` is **Book One** (Book Two is *Destroyers of the Light*), so writing the researched index beside the stored title would have left the record **contradicting itself**. Title, `sort_title` and `work_key` moved together. Also unified #327's series string — the same series was stored as both `Broken Prophecies` and `The Broken Prophecies`, so the series page saw two series of one book each.
- `2026-08-13T11:50Z` **NOTE for the ceremony Fable is building** ⚠️ **Two key moves (#141, #328) were made WITHOUT restamping reviews.** The Worker cannot read Firestore by policy, so “zero reviews” cannot be *proven*; the owner wanted them cleared. Both are recorded in `change_log` with the old key in `old_json` and a note saying no restamp occurred. **The ceremony must not assume every historical key move was carried properly.** This is also the strongest argument yet for the `reviews_seen_*` floor: it is NULL everywhere, which is precisely why there was no evidence either way.

- `2026-08-13T11:15Z` ⚠️ **CORRECTION — I reported "zero owned copies" for several books and that was WRONG.** `copy` carries **both** `work_id` and `edition_id`, and I counted by joining through `edition`. **177 of 265 copies have a NULL `edition_id`**, so every one of them read as zero. #284, #291, #299, #333, #141, #174 and #335 each hold an owned copy. ⚠️ **This inverts the reasoning on #299:** it is not an unowned stray that can simply be deleted — it stands for a real physical book, so deleting it would lose a copy. Fix its title/author instead. The right count is `SELECT COUNT(*) FROM copy WHERE work_id = ?`.
- `2026-08-13T11:15Z` **TODO** ⚠️ **Systemic, and the root of the correction above: 177 of 265 copies (67%) are not linked to an edition.** A copy that names no edition cannot answer "which printing is this?", which is the question the edition picker and the signed/variant work both depend on. Same family as "a rescan must be a question, not a second copy" — fold it into that work rather than fixing it twice.
- `2026-08-13T11:15Z` **DONE** **The Opal Deception duplicate is merged, on the owner's decision that both are owned.** #284 folded into **#291** *Artemis Fowl and the Opal Deception*, which now holds **two paperback editions** (9781423124559 Disney/Hyperion, 9780241434666 Puffin) and **two owned copies**, each now linked to its own edition. Children were reparented **before** the delete so `ON DELETE CASCADE` could not take them.
  ⚠️ **`change_log` recorded its first real entries, and this is exactly what it was built for:** the deletion row stores #284's **entire row as JSON** under `field='__row__'` — the undo material — plus one row per reparented child. Migration 0120 went to production earlier today, so the audit log existed in time to catch the first destructive change made after it.
- `2026-08-13T11:15Z` **DONE** #335 *Possibility & Promise* now carries the subtitle **"Echoes of the Unknown"** (owner approved; confirmed against the Amazon listing for ISBN 9798278220268).

- `2026-08-13T10:45Z` **DONE** ⚠️ **Europa (#348) has a cover, and it went into R2 rather than being hotlinked.** `https://bookcovers.heygabi.ai/covers/europa-d-l-houpt-5abcf91beea5786c.jpg` — verified live: **200, `image/jpeg`, 174,528 bytes, `max-age=31536000, immutable`**, byte length matching the source exactly. `cover_status` set to `'ok'`, matching what the upload route does deliberately: a person who went and found the image has assessed it more thoroughly than any rung of the ladder, so leaving it unassessed would put the book straight back on the "cover needed" list it just left.
  **Why the normal ladder was never going to find it:** the ISBN is `9798317365769`, and a **`979-8` prefix means Amazon KDP** — those titles are typically absent from Open Library altogether. ⚠️ So an Open Library miss on a `979-8` book means **"KDP, look elsewhere"**, not "no cover exists". The winning route was **ISBN → ASIN via retailer search-result titles → image CDN**, which sidesteps the Amazon product pages that are currently returning 500 to automated fetch.
  Identity confirmed rather than assumed — *Europa* is a common title, so: the ASIN `B0F5BRLJR9` maps to exactly this ISBN, and **the author's name is printed on the cover art itself**. The image was also read visually, not just fetched, so it is the real cover and not a placeholder.
  ⚠️ **The object key hashes the IMAGE BYTES, not the work key** — which is what lets the cache header be a year and immutable. Replacing a cover is a new URL, never the same URL serving different bytes.

- `2026-08-13T10:20Z` **DONE** ⚠️ **A false premise in this document, repeated in four places, is corrected above** — and the distinction it hides is worth keeping. This doc recorded that #141/#160/#174 “have ISBNs that did not resolve” and that “re-running research will not help”. **That is wrong for #141 and #174**: both resolve on the first call to Open Library's `/api/books` endpoint, and **six of the nine answers found for those two books came from those two calls.** The original conclusion appears to have come from **web-searching the ISBN string**, which returns garbage — searching `9781472327314` returns an unrelated book called *Cut*. ⚠️ **API lookup and web search are not the same operation, and a failure of the second says nothing about the first.** Belongs in `docs/info/isbn-ladder.md` beside the measured hit rates.
- `2026-08-13T10:20Z` **DONE** ⚠️ **A premise *I* supplied to a research agent was also wrong, and it pushed back with evidence — which is the behaviour to keep.** I briefed that #141's “Touch and Explore” is a Twirl/Chronicle line. True, but **irrelevant**: that is Nathalie Choux's line (ISBN 9782745976192, 2016). **Scholastic runs its own separate “Touch and Explore” format line inside *Scholastic Early Learners*,** which is what this book is. Searching the title surfaces the Choux book first, so accepting my brief would have attached the **wrong publisher, wrong year and wrong creator** — a confident, fully-sourced error.
- `2026-08-13T10:20Z` **ANSWERED** ⚠️ **The Autumn Publishing six are unfindable *by construction*, and that is a final answer rather than a gap.** ISBN prefix **978-1-83903 is registered to Igloo Books** (Autumn Publishing is its imprint, so the credit is right), and the six ISBNs are **exactly consecutive** — `978183903590`→`595`, all check digits valid, no gaps — which is the signature of **one simultaneous six-title release**, i.e. components of a boxed set, not a series accumulating volumes. Their back covers read **“Sold as part of a set, not for resale”**, and they are absent from Open Library entirely (`/isbn/` 404, `numFound 0`). So all 12 of their gaps are `unknown` **permanently**, and the volume-number answer is `none` at high confidence.
  ⚠️ **Named trap: do NOT turn the consecutive ISBN block into volumes 1–6.** That is *assembly* order and carries no reading order — and it would look **more** credible than an ordinary guess precisely because it has identifiers behind it. The invented-number failure in its most persuasive costume.
  **Cheapest real fix: read one copyright page.** #274 *My First Toys* is the one physically on the shelf (`copies=1`), and “First published YYYY” usually sits directly under the printing line — that single page could close all six year gaps at once.

- `2026-08-13T09:40Z` **NEEDS YOUR DECISION** ⚠️ **The queue research found DATA DEFECTS, not just missing numbers.** Three, none of which I will act on unilaterally because two involve deleting production records:
  1. **#284 and #291 are the same book twice** — *Artemis Fowl and the Opal Deception*, both Eoin Colfer, both sourced from Open Library, **both with ZERO owned copies**, differing only by edition (#284 = 9781423124559 Disney-Hyperion, #291 = 9780241434666 Puffin). Not a graphic-novel/novel pair — one novel entered twice. Volume 4 either way. **Which one do you want kept?**
  2. ⚠️ **#299 is a corrupt record.** Title `the mazeruner`, author `James Dasher` — both misspelt — which has produced the `work_key` **`mazeruner|james dasher`**, a key that can never match anything, in a catalog whose whole review join runs on that key. Its ISBN (9780385737951) is nonetheless the correct Delacorte paperback, and **#333 appears to be the good record**. 0 copies, no cover. **Fix the title/author, or delete it?** Note it needs exactly the title/author edit the frozen-field guard currently blocks — but with no reviews behind that garbage key it is a **free move** under the design's §5.1 test.
  3. **"My First" is probably not a series at all** — six works (#274, #287, #288, #296, #303, #304), all credited to Autumn Publishing, all with **consecutive ISBNs** `978-1-83903-5906/13/20/37/44/51`. The research suggests the series value was **mechanically derived from the shared title prefix** rather than being a real ordered series, which would make the right answer `none` for all six volume numbers *and* a correction to the series field itself.
- `2026-08-13T09:40Z` **DONE** ⚠️ **My dispatch error, found by an agent's dead-end note and worth recording as a method rule.** I built the research worklist from title + author + series and **left out the ISBNs, which were in the database the whole time.** An agent reported it could not locate six books and wrote "physical ISBNs would settle it in one lookup" — they were one join away. Regenerated as `queue-worklist-with-isbns.txt`; **61 of 62 rows carry an ISBN**, and all three agents were given it. **Rule for next time: any research worklist out of this catalog ships with the ISBN and the copy count.** The ISBN is the only identifier in a row that is trustworthy when the title is wrong — which #299 above proves is a real condition, not a hypothetical.

- `2026-08-13T09:10Z` **IN PROGRESS** ⚠️ **The `/queue` residue — measured, and the shape changes the job.** Production holds **62 works owing 80 individual detail gaps** (the owner's "80 missing details" is the *field* count, not the work count — 9+3+59+9 = 80, which confirms the SQL replicates `detailGaps` exactly). Breakdown: **volume number 59**, first published 9, description 9, series 3. So **74% of the entire backlog is one field.**
  ⚠️ **And it splits into two classes that need opposite answers:**
  - **Real numbered series** — Artemis Fowl (9), Grey Griffins (3), Harry Potter, Hunger Games, Maze Runner, Dungeon Crawler Carl, Ellie Engle. The volume number is a *fact* to look up.
  - **Publisher imprints and box sets wearing a series name** — "My First" (6), "Little Golden Book" (2), and **#325 "Court of Thorns and Roses Hardcover Box Set"**. These have **no volume number at all**; the correct answer is a `gap_verdict` of `'none'`, which is a recorded ANSWER that stops the field being asked again. Inventing a number here is the documented failure mode, and `gap_verdict`'s three-way split exists for precisely this.
  Three research agents dispatched — clusters, singletons, and the non-volume fields. ⚠️ **They propose with sources; they do NOT write.** I apply in one reviewed batch, so nothing writes to production concurrently.
  ⚠️ **Trap found before any write: the volume number is TWO columns**, `series_index_sort` (REAL, so 2.5 orders correctly) and `series_index_display` (TEXT). Writing the sort key without the display value sorts correctly and **prints nothing** — a silent inconsistency. Both together or neither.
- `2026-08-13T09:10Z` **DONE** Three of Fable's logged UNSOLVED items are now **closed**, and it has been told so: (1) the carry's dependence on Firestore's shape-only rules — **decided** by the owner, recorded in `PLATFORM.md` §4a; (2) "the migration SQL was never dry-run against local D1" — **it has been now**, including the proof that `old_json` rejects SQL NULL; (3) the title-edit doc-id drift — **accepted** as a known wart, so the read-before-write dedupe is explicitly NOT to be built.
- `2026-08-13T09:10Z` **TODO → promoted into the live build** ⚠️ **The strip-lie is no longer out of scope.** Fable logged that `updateWorkSchema` **silently strips any unknown key** — `{"Title": …}` or a misspelled field returns **200 having changed nothing**. That was fine to defer when logged; it is not now, because "edit any detail" is *built on sending field names*. ⚠️ **An audit log makes this defect worse rather than better:** the `change_log` correctly records that nothing changed, the caller correctly reads success, and the two disagree forever with no error anywhere — the log manufactures evidence that the save happened. Same defect class the repo already caught by exercising rather than reasoning (zod silently stripping a stray `rating`). Sent to Fable to fold into the current commit, with the caveat that a blanket `.strict()` must be checked against what the web app actually sends first — `Editions.tsx` sends `isbn13`/`isbn10`/`asin` on every save, and 400-ing every edition edit would be worse than the strip-lie.

- `2026-08-13T07:55Z` **CLAIM (next, before scanning resumes)** ⚠️ **PRIORITY — the one-barcode-one-edition guard is SPECCED BUT ABSENT FROM CODE.** Fable's estate survey verified there is **no Open Library `/works/` refusal anywhere under `packages/`**. This is the exact defect that corrupted #300/#301/#302 from single barcodes (6 phantom editions + 6 copies in one evening). ⚠️ **Scanning resumes today with ~100 books left, so every new scan is exposed.** The rule is written in `catalog-platform/docs/info/matching-thresholds.md` §6 — implement it there-as-specced. **Do this first thing, ahead of the rest of the survey.**
- `2026-08-13T07:55Z` **TODO** ⚠️ **A rescan must be a question, not a second copy.** 71 physical editions carry no ISBN, and the docs' standing answer — "a barcode scan will fill it in later" — describes a path that **does not exist**: `catalog-add.ts` unconditionally writes a new owned copy plus a second same-format edition. Residue is already live: work #139 holds an OL hardcover beside a `manual` ISBN-less hardcover for one physical book. Reuses the shipped preorder-prompt pattern; **merge this with the already-specced edition picker** rather than building twice. (Same root cause family as the item above — both are "the scanner assumes it is seeing a new thing".)
- `2026-08-13T07:55Z` **TODO** Rehost third-party cover hotlinks into R2. Census: **108 Open Library + 43 Google hotlinks vs 33 self-hosted**; the bucket and `bookcovers.heygabi.ai` are already live, and every new scan adds more. A batch script plus one intake change. Complements the owned cover-swap feature rather than duplicating it.
- `2026-08-13T07:55Z` **TODO** Author-string canon + dedupe report. Production holds `Make Believe Ideas` vs `Make Believe Ideas  Ltd.`, and `SAMG` vs `SAMG Entertainment`. ⚠️ **That second split is the only thing preventing a full `work_key` collision between the two Hangul-stripped Korean works** — so the canon list must land BEFORE any author merge, and merges go one at a time through the now-approved edit-and-audit machinery, because every merge moves the ~860-review join.
- `2026-08-13T07:55Z` **TODO (larger, platform)** Stand up the shared index Worker, **games first**. No longer speculative: two hand-built library↔audiobook bridges already exist and **drift between script re-runs**, while the 836-item games catalog has zero. All of stage 2's prerequisites (domain, Pages, R2) have landed since PLATFORM.md was written. Unlocks own-in-any-format, pledge routing across catalogs, and push-on-change replacing re-run backfills.
- `2026-08-13T07:55Z` **TODO (small)** Board game catalog: `play` and `sleeve_requirement` are **dead schema** — 0 rows and no write path anywhere in that repo; only `export.ts` reads them. Also refresh PLATFORM.md's stale §1/§8, which still lists "which domain?" as open. `user_item` ratings are live code with 0 rows — **watch, do not retire yet** (the gaps-chip precedent).

- `2026-08-13T07:40Z` **DONE** ⚠️ **OWNER APPROVED ALL FOUR** edit-and-audit decisions ("do them all"). Recorded below; build dispatched.
  1. **Sentinel design + migration 0120 — APPROVED.** Build it.
  2. **`reviews_seen_*` — KEEP.** Fable left this to the owner's taste; kept as defence behind the client attestation.
  3. **Firestore `reviews` stays shape-only — DECIDED and recorded in `catalog-platform/docs/PLATFORM.md` §4a.** ⚠️ The carry procedure depends on it; hardening those rules later would silently break the restamp for other people's review docs.
  4. **Title-edit sibling review doc — ACCEPTED for now.** Reading stays correct; the fix costs a read before every review write, so it waits for evidence that retitles on reviewed books actually happen.

- `2026-08-13T06:55Z` **DONE** reviewed Fable's threshold report — verified both side findings against production. **One confirmed, one corrected.** See the section below.
- `2026-08-13T06:55Z` **UNSOLVED (new, real)** ⚠️ `normaliseTitle` **strips Hangul entirely**, so every Korean book's `work_key` is author-only. Needs a migration; see below.

- `2026-08-13T06:15Z` **DONE** deploy overlap guard — lock + ancestry check, both tested; `docs/deploys.log` seeded and un-ignored
- `2026-08-13T06:15Z` **DONE** all four owner-blocked items (#341 editions, Krout signed copies, #238–242, #300 deleted)
- `2026-08-13T06:15Z` **CLAIM** watch `/queue`, research the residue — see the section below
- `2026-08-13T06:30Z` **DONE** ISBN backfill on 265, 266, 267, 269, 274 — all five now carry their edition, and every copy is linked to it rather than dangling
- `2026-08-13T06:30Z` **DONE** #269 *Who Goes Roar?* gained the owned copy it was missing
- `2026-08-13T06:35Z` **DONE** ⚠️ RESOLVED the format question — owner's rule: *all board books are hardcover, since they are physically hard.* 10 editions moved paperback → hardcover; standing rule written into `docs/info/series-formats-and-audiobooks.md`
- `2026-08-13T06:30Z` **~~UNSOLVED~~ superseded** format on those five editions — recorded as `paperback`, which is the app's own documented convention (*"a scanned book is recorded as a paperback until someone says otherwise"*). ⚠️ Four of the five are **board books**, so paperback is probably wrong; the catalog's other board books came from Open Library as `hardcover`. I did not assert a format I had not verified. Worth a sweep once the edition picker exists.
- `2026-08-13T06:30Z` **CLAIM** Fable dispatched on (a) edit-any-detail + audit-log design, (b) re-measuring the matching thresholds — see FABLE5.md §7 for their side

### ⚠️ Reviewing Fable's threshold report — one finding confirmed, one corrected

Fable's measurement pass (`catalog-platform/docs/info/matching-thresholds.md`) ended
with two side findings. Both were checked against production rather than taken on
trust, which is the point of the gate running in both directions.

#### ✅ CONFIRMED, and worse than a curiosity: `normaliseTitle` strips Hangul

Fable reported *"Korean titles normalise to `""` — works #195/#305 share the empty
key."* **The bug is real; the specific claim is wrong.** Measured:

| work | title | `work_key` |
|---|---|---|
| #195 | 슈팅 스타 캐치! 티니핑: 약속 의 오로라핑 | `\|samg` |
| #305 | 하츄핑의 눈물 | `\|samg entertainment` |

They do **not** currently collide — the keys differ on the author half (`SAMG` vs
`SAMG Entertainment`). What they share is an **empty title half**, and that is the
actual defect: `normaliseTitle` removes every Hangul character, so a Korean book's
key is its author and nothing else.

⚠️ **Consequences, which are broader than one collision:**
- **Two Korean books by the same author would collide completely** — same author
  string, both titles empty. #195 and #305 escape only because the author is spelled
  two different ways, which is itself a thing to fix and would *cause* the collision.
- Korean titles can never be **matched by title** at all — so the ISBN is the only
  handle, and `9791165384678` is not in Open Library.
- ⚠️ It presumably applies to **any non-Latin script**, not just Hangul. Untested.

**Fixing it moves stored keys, so it is a migration, not an edit** — `work_key` is
the join to 860 audiobook reviews. It belongs with the edit-any-detail/audit-log
design, which is already solving "how do we move a key safely". **Do not fix it
piecemeal.**

#### ❌ CORRECTED: #258's three hardcovers are right, not duplicates

Fable flagged *"#258 carries 3 hardcover editions — edition-picker case in the wild
or leftover dupes; needs a human eyeball."* It is **not** dupes:

| edition | name |
|---|---|
| 359 | The Wizard variant cover |
| 376 | The Witch variant cover |
| 377 | The Wild One variant cover |

*Worlds Beyond Number: The Wizard, The Witch, The Wild One* was published with
**three variant covers**, and this catalog already recorded that deliberately — it is
in the work log as "one book, three variant covers". Fable lacked that context, so
the flag was reasonable; the answer is that the data is correct.

⚠️ **But its instinct was right for the other half:** this is a **real instance of
the edition-picker case already in production** — three editions of one format on one
work, which `Copies.tsx` cannot express. It is the second known case after #341, and
it strengthens `FABLE5.md` §4.2a. ⚠️ Note #258 is still **pre-ordered, 0 held**, so
whoever builds the picker gets a test case that must not be mistaken for owned.

### ⚠️ THE SCANNING IS NOT FINISHED — more books arrive tomorrow

Owner, on going to bed 2026-08-13: *"be aware we're not done scanning books, just
done for the night, more will come tomorrow."*

**This reprioritises the overnight list.** The catalog went 258 → 342 works in one
evening and will keep growing, so **a fix on the intake path pays off repeatedly
while a one-off data correction pays off once.** Prefer, in this order:

1. **Intake-path fixes** — the edition picker, a format question at intake (a board
   book still lands as `paperback` through `AddWork`, the scan path and any
   importer — see the standing rule in `docs/info/series-formats-and-audiobooks.md`),
   and anything that stops the Open Library **work-level aggregate** bug recurring.
   ⚠️ That last one corrupted three works tonight and *will* fire again on the next
   series whose OL record is filed that way.
2. **Cover swap** — 147 covers are third-party hotlinks and every new book adds more.
3. **One-off data cleanup** — last, and never at the cost of 1 or 2.

⚠️ **Do not treat the catalog as final.** Anything that assumes a fixed row count, a
complete series, or an empty queue will be wrong by tomorrow afternoon. The
`/queue` residue in particular will grow again — an empty queue tonight is not a
finished job.

### 🌙 OVERNIGHT AUTONOMOUS RUN — the plan, 2026-08-13

Owner: *"once i go to bed you'll work through all the remaining todos with
subagents."* Usage at hand-off: **session 34%, weekly 52%** (resets Sun 16:00).

⚠️ **Guardrails, from the global usage rules — these are not optional.**
Pause the *session* at **89%**. On the **weekly** limit, **stop starting new
subagents at 93%** and keep working conversationally only to 97%. ⚠️ A subagent's
cost is invisible until it lands — one landed at 372k tokens in a single lump — so
**the granularity of risk is one agent, not one tool call**. Pulse-check usage
whenever an agent is in flight and state the figure when reporting. A full session
≈ 9 weekly points, so ~5 sessions of headroom remain at 52%.

#### 🎭 Fable 5 gets its own allowance — spend it, 2026-08-13

Owner: *"we haven't used any fable 5 usage this month, we should plan to use that
for something. its waste to leave our powerhouse on the table unused."* The usage
page carries **Fable weekly at 0%** as a **separate line from the 52% all-models
pool**, so Fable work does not draw down the main budget. Dispatch it with the
`Agent` tool's `model: 'fable'`.

**Chosen split — a review gate, not just more building:**

| Fable 5 | Opus (me) |
|---|---|
| **Adversarially review every change before it deploys** | Build **cover swap** and the **record-delete button** |
| **Design the edit-any-detail + audit log** feature | ISBN backfills, #269, the two Goodreads covers, subtitles, volume numbers, Cal universe |
| **Review migration 0110+ before it runs** | Apply Fable's design **only after the owner approves it** |

⚠️ **Why review and not only building — stated plainly, because it is the reason
this split was chosen.** In one attended evening I got three things wrong and
caught each only afterwards: I diagnosed the silent save failures as React
hydration when it was the **1Password overlay**; I told the owner retitling a work
was safe when `WorkFields` explicitly guards against it (`work_key` ↔ 860
audiobook reviews); and I entered *Who Goes Roar?* with the publisher as author
when **Christie Hainsby** is credited. All were cheap because the owner was awake
to correct them. **Unattended, that class of error compounds** — which is exactly
what an independent model on a separate budget is for.

⚠️ **The migration does NOT go to production unattended.** The edit-any-detail
feature needs `authors`/`primary_author` nullable and a decision about what
`work_key` is with no author — the schema's own comment warns title-only keys
"collide across authors constantly". Design it overnight, have Fable review it,
present it in the morning, apply on the owner's word. Nothing else in this plan
touches the schema.

#### ✅ Agent-safe — no physical book, no owner decision

1. **Cover swap feature** (see its own entry) — read the Board Game Catalog's implementation first. Biggest win, and it also unblocks moving 147 hotlinked covers into R2.
2. **Record-delete button** — route already exists, nothing calls it, all 15 FKs cascade. Wants a confirm that names what goes with it.
3. **ISBN backfill** on works **265, 266, 267, 269, 274** — ISBNs are all recorded in this file.
4. **#269** — add the missing copy (it is owned) and correct the author to **Christie Hainsby**.
5. **Covers for #266 and #267** from the Goodreads URLs in the queue — download, then upload to R2 rather than hotlinking.
6. **#186 volume 11**, **#195 volume 8** — both verified against publishers.
7. **Subtitles** — *Last Child in the Woods* → "Saving Our Children from Nature-Deficit Disorder"; *Possibility & Promise* → "Echoes of the Unknown"; #341 → "Outworlder".
8. **#7 *Dungeon Born*** — confirm the audiobook link shows, and file the series into the **Cal** universe ⚠️ using whatever name `catalog-platform` actually holds; do not invent it.
9. **#174** author → **Parragon Books** — needs the authors-edit capability, so it lands with item 10.
10. **Edit-any-detail + audit log** — the large one. Read its entry for the measured constraints before designing.

#### 🔭 Watch `/queue` and finish what the automatic pass could not

Owner, 2026-08-13: *"while im sleeping can you watch the /queue and manually look
up anything that didn't finish. if you cant find it i'll resolve it when i awake."*

The details queue stood at **~190 works** when they went to bed. The automatic pass
resolves what a source will answer; this job is the residue.

**How to work it:**
1. Read the queue, and group by *what* is missing — a batch of 40 board books all
   missing a year is one research shape, not forty.
2. Research from primary sources: the publisher's own site first, then retailers,
   then Open Library / Google Books. ⚠️ The publisher's own page has been right and
   the aggregators wrong repeatedly tonight — *The Wonderful World of Bizzy Bear*
   is the publisher's series name and the volume numbers came off their page.
3. Apply only what a source states. **Prefer the API or a script over the book
   page** — per-field UI edits cost 5–10 tool calls each and land about half the
   time.
4. ⚠️ **What cannot be found is a result, not a failure.** Write it here with what
   was tried, so the owner can settle it in seconds rather than repeat the search.
   `docs/TODO.md` is already full of that pattern and it is the pattern that works.

⚠️ **Do not fill a field to empty the queue.** A guessed year or an invented series
makes the count go down and the catalog worse — and *nothing revisits these
columns*, so a wrong value is permanent in a way a blank is not. The queue being
non-empty in the morning is an acceptable outcome; a queue emptied with fiction is
not.

#### ✅ ALL FOUR OWNER-BLOCKED ITEMS CLEARED before bed — 2026-08-13

The owner stayed up to answer them, so none of these are pending any more.

| Was blocked on | Owner's answer | Done |
|---|---|---|
| #341 — 2nd B&N barcode: 2nd copy or 3rd edition? | *"A and C seem to be the same except C was an early bird thing. So lets say I have A and B to be safe"* | 2 editions (`…3457` dust jacket, `…4362` Target), **3 copies** — signed B&N, unsigned B&N, Target |
| *Untapped* / *Unmapped* signed copies | already stated: paperbacks signed, hardcovers signed too | #34 and #33 each gained a **paperback + hardcover edition with a signed copy** |
| #238 *Ritualist* hardcover signed | *"probably the one from that kickstarter, I don't own 2 copies of it signed"* | existing copy flipped to `is_signed = 1` — **not** a second copy |
| Are 239–242 signed too? | **yes, all four** | *Regicide*, *Rexus*, *Raze*, *Ruthless* flipped — the whole Kickstarter set 1–5 now reads signed |
| Monster Empire #300 | **delete it** | gone, with its 2 phantom editions and 2 phantom copies |

⚠️ **Recorded because the conservative choice on #341 loses information on purpose.**
Both B&N copies are filed as edition `9781638493457`. If the second one is really
the `…4355` B&N-early-exclusive, the catalog understates how many *printings* are
owned — which a barcode scan fixes later — whereas guessing `…4355` would assert a
printing that may not be in the house. That was the owner's call and it is the
recoverable direction.

⚠️ **The copy form cannot express this case**, which is why the two editions were
written with SQL: `Copies.tsx` deliberately **reuses an existing edition of the
same format** (the comment cites an importer that made 83 duplicate editions), so
"a second, different hardcover printing" is unsayable through the UI. `edition` and
`copy` carry no derived columns — no `work_key`, no `primary_author` — so SQL is
safe here in a way a `work` edit never is. **A cover-swap-style edition picker
would remove the need.**

#### ⛔ Still needs the physical book

- **Subtitles and cover photos** on the pull-list items — the board books in the stack.
- ⚠️ #341's **cover art is the Target edition's** (it carries an "only at Target" badge) while the record's primary edition is the dust-jacket one. Swap once the cover-swap feature exists.

#### ⚠️ Two working notes for whoever picks this up

- **Press `Escape` before clicking Save** in the web UI. The 1Password overlay swallows the click; this caused most of the session's silent failures.
- **Per-field edits through the book page cost 5–10 tool calls each and land maybe half the time.** Prefer the API or a script for bulk data. The UI is for things only the UI can do.

### 🔨 LIVE QUEUE — the scanning session of 2026-08-13

⚠️ **Standing instruction from the owner:** *"Keep adding whatever I queue for you
to the todo list so nothing is lost and keep working through them as I queue them
up."* So this list is appended to as things are called out, and ticked as they
land. It is the session's working queue, not a summary.

**Done**

- ✅ Tamer 2–6 print covers uploaded to R2 (works 244–248), each verified against its volume number
- ✅ #265 *There's a Mouse About the House!* added — Richard Fowler verified
- ✅ #266 *Don't Tickle the Dinosaur!* added — Sam Taplin / Ana Martín Larrañaga
- ✅ #267 *Richard Scarry's Busy Busy Farm* added — Richard Scarry
- ✅ #269 *Who Goes Roar?* added ⚠️ but see the repair list — wrong author, no copy, no ISBN
- ✅ Subtitles: #141 Ocean Tails · #160 Ambulance Rescue · #186 Dinosaur Safari
- ✅ #213/#215 Pringle & Finn resolved and verified; both `work_watch` notes cleared
- ✅ #132 + #186 moved to the publisher's series name, *The Wonderful World of Bizzy Bear*
- ✅ **Entry-form fixes deployed** (`54a1c94f`) — typed ISBN now stored, "have it" now the default
- ✅ #274 *My First Toys*, #287 *My First Farm Animals* — #287 confirms the fix: copy **and** ISBN both recorded

**Still queued**

- ⏳ 3 of the Autumn set: *My First Wild Animals* `9781839035951`, *My First Ocean Animals* `9781839035937`, *My First Food* `9781839035913`
- ⏳ The Korean *하츄핑의 눈물* — `9791165384678`, author **SAMG Entertainment**, series **하츄핑 마음 동화**, volume **2**
- ⏳ Cover for **#266** from `goodreads.com/en/book/show/48837075-don-t-tickle-the-dinosaur`
- ⏳ Cover for **#267** from `goodreads.com/book/show/43744333-richard-scarry-s-busy-busy-farm`
- ⏳ ISBN backfill: #265 `9781601304193`, #266 `9780794549503`, #267 `9781984894236`, #269 `9781836422808`, #274 `9781839035944`
- ⏳ #269 needs a **copy** (it is owned) and its author corrected to **Christie Hainsby**
- ⏳ #160 series → *The Wonderful World of Bizzy Bear*, volume **15**; #186 volume **11**; #132 volume 2 already right
- ⏳ #195 volume → **8** of *마음을 채우는 동화*
- ⏸️ #174 author → **Parragon Books** — blocked on the authors edit
- 💤 *Fire Rescue* title pattern — owner said leave it

### ⚠️ Two research findings that CORRECT earlier assumptions — 2026-08-13

Both came back from a research agent and both reverse something already recorded.

**1. ⚠️ The two Korean Teenieping series are DIFFERENT. Do not merge them.**
The publisher 아이휴먼 runs a separately numbered 동화 line per sub-brand:
| sub-brand | series | 
|---|---|
| 슈팅스타 캐치! 티니핑 | 마음을 **채우는** 동화 |
| 하츄핑 캐치! 티니핑 | **하츄핑 마음 동화** |
| 프린세스 / 반짝반짝 / 알쏭달쏭 | 마음을 가꾸는 / 마음 성장 / 마음을 여는 동화 |

So **#195** (`9791165384548`) is *마음을 채우는 동화* — its current filing is
**correct** — and it is **volume 8**, not unnumbered. The new book
(`9791165384678`) is *하츄핑 마음 동화* **volume 2**, a different line only two
volumes deep. The shared `979-11-6538` prefix is a **publisher block, not a series
marker** — that was the trap.

**2. ⚠️ *Who Goes Roar?* is NOT publisher-authored — the writer is Christie Hainsby.**
Make Believe Ideas' own site credits "Writer: Christie Hainsby, Illustrator:
Shannon Hays". MBI's house style omits the writer from the cover while crediting
the illustrator, so the physical book showing only "Illustrated by Shannon Hays"
is **expected, not evidence of publisher authorship**. My `Make Believe Ideas` on
#269 is wrong and should be **Christie Hainsby**.

Series is probably **Busy Bees** (MBI's UK site titles it so) but ⚠️ unnumbered,
and possibly UK-edition-only — our copy carries no Busy Bees branding, so treat it
as probable, not settled.

⚠️ ISBN `9781836422808` returns **zero** results anywhere, yet both check digits
are valid and `978-1-83642` is MBI's current prefix — so it is a **2024–25 reprint
too new to be indexed**, not a bad number. Catalog the year as **2019** (first
publication, and what the copyright page says).

### ⚠️⚠️ THREE BUGS found while adding books by hand — 2026-08-13, two now FIXED

Discovered by adding five books and then reading the rows back. **Read this before
typing in a scanning backlog**, because two of the three lose data silently.

**1. ⚠️ The typed ISBN is NOT stored. `/add?mode=type` has an ISBN box, and
nothing persists it.** Measured: works **265, 266, 267, 269, 274** all have
`editions = 0`, so no ISBN, no publisher, no year — for books whose ISBN was typed
in or scanned. Compare the owner's own adds (#268, #270–273, #275, #276), which
all resolved through a lookup and all have `editions = 1`.

The ISBN box appears to feed the **Look up** button only. So for exactly the books
that need hand-entry — the ones no service knows — **the one hard identifier the
book carries is thrown away.** That is the worst possible place to drop it: a
board book with no ISBN row can never be re-matched later, and the barcode is the
only thing that would have made it findable.

**2. ⚠️ "AND WE…" defaults to "just catalogue it — record no copy".** For a
scanning session — where every book is physically in your hands — the default is
the one answer that is always wrong. It produced **#269 *Who Goes Roar?* with
`copies = 0`**, i.e. catalogued but not owned. The other options are "have it" and
"want it — put it on the wishlist". Default should almost certainly be "have it"
when reached from a scan.

**3. ⚠️ A save can fail silently, and the cleared form looks like success.**
*My First Farm Animals* (9781839035920) was typed, saved, and the form went blank
— and **no row exists**. Cause is almost certainly hydration: the fields were
filled before React had attached, so its state stayed empty, `Save` stayed
disabled, and the click did nothing. The blank form after was the *un-filled* form,
not a reset one. Nothing distinguishes that from a successful save.

**Rows needing repair** (all created 2026-08-13):

| work | title | what is missing |
|---|---|---|
| 265 | There's a Mouse About the House! | ISBN 9781601304193 |
| 266 | Don't Tickle the Dinosaur! | ISBN 9780794549503 |
| 267 | Richard Scarry's Busy Busy Farm | ISBN 9781984894236 |
| 269 | Who Goes Roar? | ISBN 9781836422808 **and a copy — it is owned** |
| 274 | My First Toys | ISBN 9781839035944 |

⚠️ Also: #269 was entered as author **"Make Believe Ideas"** while the catalog
already holds #144 *Never Touch a Dinosaur!* as **"Make Believe Ideas  Ltd."**
(with a double space). Two author spellings for one publisher — pick one.

### 🔨 Books whose ISBN resolves to NOTHING — transcribed from photographs, 2026-08-13

⚠️ **Growing list, one root cause.** The owner is scanning and these keep landing:
the ISBN is real and printed on the book, and **every rung of the ladder returns
no answer at all** — so the scan row has no title, no author, and `isAddable`
refuses it. Children's board books, publisher-branded, are the whole population.

**Transcribed off the owner's photographs, so this survives the books going back
on the shelf.** Enter via `/add?mode=type` ("Type a title"), which needs no lookup.

**"Who Goes Roar?"** — a tabbed board book of dinosaur sounds
| field | value |
|---|---|
| ISBN13 / ISBN10 | **9781836422808** / 1-83642-280-6 |
| publisher | **Make Believe Ideas** (make believe ideas ltd, Berkhamsted, Herts UK · 557 Broadway, New York) |
| copyright | 2019 · $4.99 US / $6.99 CAN |
| illustrator | **Shannon Hays** — the ONLY credit on the book |
| author | ⚠️ none named. Publisher-as-author, per the catalog's convention (*Scholastic* #141, *Bendon* #137) |

**하츄핑의 눈물** — Korean *Catch! Teenieping* tie-in
| field | value |
|---|---|
| ISBN | **9791165384678** (979-11-6538-467-8) · 15,000원 |
| franchise | 캐치! 티니핑 (Catch! Teenieping) |
| series badge on cover | **하츄핑 마음 동화 2** — so volume **2** of that series |
| credits | 원작·그림 **SAMG** · 엮음 **아이휴먼 편집부** (compiled by the iHuman editorial dept) |
| publisher | **아이휴먼 / iHuman** |

⚠️ **Open question, and it decides how these two file together:** the catalog
already holds **#195** — *슈팅 스타 캐치! 티니핑: 약속 의 오로라핑*, ISBN
9791165384548 — under series **마음을 채우는 동화**. The new book's cover says
**하츄핑 마음 동화**. Are those the same series or two different ones? Filing them
together on a guess would merge two series; filing them apart would split one.
Under research 2026-08-13; **do not resolve by guessing the Korean.**

⚠️ Also note **#195 is on the cover-photo pull list** — do not confuse the two
Korean books, they are different ISBNs (…4548 vs …4678).

### 🔨 The Autumn Publishing 6-book set — cannot be scanned in, 2026-08-13

⚠️ **Read the back covers: "Sold as part of a set, not for resale."** These are
set-internal ISBNs. No retailer lists them individually, so **every rung of the
ISBN ladder returns nothing** — not a wrong answer, no answer. The scan row gets
no title and no author, so `isAddable` refuses it and the row has only *Edit* and
*Not wanted*. This is the same gate as the authorless books, one step worse.

**They must be typed in** — `/add?mode=type` ("Type a title"), which needs no
lookup. Transcribed from the owner's photographs of the fronts and backs, so this
survives even if the books go back on the shelf:

| Title | ISBN-13 |
|---|---|
| My First Farm Animals | 9781839035920 |
| My First Toys | 9781839035944 |
| My First Things That Go | 9781839035906 |
| My First Wild Animals | 9781839035951 |
| My First Ocean Animals | 9781839035937 |
| My First Food | 9781839035913 |

Common facts, all read off the books: **Autumn Publishing**, an imprint of Igloo
Books Ltd (owned by Bonnier Books, Sweden), **Third Edition, June 2025**, board
books with polyurethane-foam covers, series line on the covers is **My First** —
which is already a series in this catalog.

⚠️ **Author: `Autumn Publishing`.** No person is credited anywhere on these books.
That is the catalog's existing convention for publisher-branded board books —
*Scholastic* on #141, *Bendon* on #137 — not a placeholder.

### ⚠️ #174 *I Love You, Little Bear* — the author on file is probably another book's

Owner: *"the publishing company editorial stuff wrote it together… use the
publisher as the author."* They are right, and it is worse than a blank.

Researched 2026-08-13: **at least four different books share this exact title** —
Claire Freedman's, Angela Navarra's, a Scholastic edition, a Phoenix
International edition — and **none of them carries our ISBN 9781472327314**. So
the `Judi Abbot` currently in `work.authors` was almost certainly lifted from a
*different book of the same name*, which is precisely the failure
`docs/info/research-and-gaps.md` warns about.

The edition's publisher is **Parragon Books**, consistent with the `978-1-4723`
prefix. That is the honest attribution.

⚠️ **Blocked on the same guard as the title:** `WorkFields` deliberately cannot
reach `authors`, because `work_key` derives from it. #174 has **no reviews on
either site**, so the key move is harmless here — which is exactly the
"gated on no-review-join" design in the item below.

### ⏸️ Edit any detail, an audit log, and adding a book with no author — 2026-08-13

**Three asks from one scanning session, and they are the same feature.** Recorded
together because solving any one of them badly makes the others harder.

**The owner, verbatim:**

> *"add an edit title button on the ui. More than that we need a way to edit
> basically any detail about a book except core details like ISBN. We'd also need
> an audit log and stuff. Audiobook catalog will need this as well."*

> *"Let us add books without an author and immediately flag them for
> remediation. That way we're not hard blocked."*

**Why it came up.** Four books in one evening could not be added without hand-
typing an author — *There's a Mouse About the House!*, *Don't Tickle the
Dinosaur!*, *Richard Scarry's Busy Busy Farm*, and every bare-titled board book
on the pull list. `isAddable` (`packages/core/src/scanjobs.ts`) requires a title
**and** an author; children's board books are the common case in this house and
they resolve worst upstream, so the gate lands exactly where it hurts.

#### ⚠️ The constraints, all measured — read before designing

| Constraint | Where | Why it bites |
|---|---|---|
| `work.authors`, `primary_author`, `work_key` are all **NOT NULL** | `migrations/0001_init.sql:87,90,108` | "add with no author" is a **migration**, not a UI change |
| **`work_key` contains the author on purpose** | `0001_init.sql:99` — *"Title-only keys collide across authors constantly"* | a title-only key for authorless rows is a known-bad idea in this schema, not a shortcut |
| `work_key` is the join to **860 audiobook reviews** | `WorkFields.tsx` header | editing a title or author moves the key and orphans the reviews |
| `WorkFields` **deliberately** cannot reach `title`/`authors` | same header | this is the guard, not an oversight — do not simply remove it |

⚠️ **The trap:** "flag for remediation" means the author gets filled in *later*,
which moves `work_key` — the exact thing the guard exists to prevent. It is
harmless for a book that entered the catalog seconds ago with no reviews, and
destructive for one that has them. **So the remediation path must know the
difference**, and that is precisely what an audit log plus a "has this ever been
review-joined" test would give.

#### The shape this probably wants

1. **Migration:** `authors`/`primary_author` nullable, plus a documented answer
   for what `work_key` is while the author is unknown (a provisional key that is
   *expected* to move, marked as such, is better than a colliding title-only one).
2. **Add with no author** → row is created *and* a `work_watch` row is written in
   the same call, so it lands in `Needs → To check` and cannot be silently
   forgotten. Migration 0040's rule: the flag travels with the write.
3. **An edit surface for everything else** — title included — gated on "this work
   has no review join yet", or accompanied by an explicit "this will move the
   review link" confirmation.
4. **Audit log**: who changed what, when, and the old value. This is the thing
   that makes 3 safe rather than brave, and it is also what lets a bad bulk edit
   be undone.

⚠️ **`audiobook_catalog` needs the same treatment** and shares the identity and
review store, so the audit-log table and the `work_key`-move rules should be
designed once, across both — see `catalog-platform` / `PLATFORM.md` §2.2 on what
may and may not cross the boundary. Noted in that repo's work log too.

**Meanwhile, the zero-code unblock** (used twice tonight, ~3 taps): on the scan
row press **Edit**, type the author, **Save and look up**, then **Add**. The
lookup re-runs with the author and usually returns a close match at 1.00. For
publisher-branded board books the catalog's existing convention is the publisher
as the author — *Scholastic* on #141, *Bendon* on #137 — so that is a legitimate
answer, not a placeholder.

### 🔨 Scanning session — 2026-08-13

**The pull list is built and verified against production.** 14 books, grouped by
what each needs; published as a phone checklist artifact for the owner to work
through at the shelf. Two corrections to the old notes, both from live reads:

- ⚠️ **All 14 already have ISBNs.** The older note in this file claimed three of
  them had none — wrong. The ISBNs are on file and the lookups already failed on
  them, so **a barcode rescan returns the same nothing**; what is needed is the
  printed subtitle, or a photo.
- ⚠️ **#258 *The Wizard, The Witch, The Wild One* is NOT a shelf job.** It has no
  cover and was on the coverless list, but all three copies are still
  `preordered` — nothing has arrived. Do not send anyone hunting for it.

Verified: 9 works need a cover photo (the 4 originals + Tamer 2–6, all held), 3
need a subtitle (#141, #160, #174 — all already have covers), 2 need the series
line (#213/#215, the two live `work_watch` rows).

**⏳ In flight: ISBN 9781601304193, *There's a Mouse About the House!*** Added by
hand through `/add?mode=scan`. The ladder resolved **the title but no author**, so
the row has no **Add** button — `isAddable` in `ScanLines.tsx` requires a title
*and* an author. The proposal is parked in **scan job #20** (server-side, so it
survives a reload; reachable from "Unfinished sweeps"). ⚠️ **Waiting on the owner
for the author off the cover — deliberately not guessed**, since a wrong author is
a permanent wrong fact and `POST /api/works` does not dedupe.

### ⚠️ `wrangler dev` leaks — 212 processes, 15.6 GB, cleared 2026-08-13

The owner noticed the local dev server still up "almost 3 hours" after this
session had stopped using it. ⚠️ I had reported it stopped: the harness task did
stop, the `workerd` behind it did not. It was also much worse than one server.

**Diagnosis:** `wrangler dev` does not die with whatever started it. Killing the
shell/task/agent leaves `wrangler` **and** its `workerd` child alive, still
holding the port. Accumulated over days: **212 processes, 15.64 GB**, ~30 leaked
dev servers on ports 8787–8910 — **124 from the main checkout, 20 from another
session's scratchpad, and the rest one per `.claude/worktrees/agent-*`**, i.e.
every subagent that ever started a dev server left one behind.

**Cleared:** 191 killed, 21 already gone as children of a killed parent. 0
node/workerd left, no dev port held, **16.34 GB free of 63.18 GB**.

⚠️ Claude Code runs as **`claude.exe`, not `node.exe`** — verified by walking the
parent chain — so a node/workerd sweep cannot kill the session. The editor's
language servers *are* node, so `kiro|tsserver|extensionHost` were excluded.
The kill one-liner is now in `CLAUDE.md` under "Verifying anything".

### 🚢 Gaps chip removed from the collection stat strip — 2026-08-12

**The ask:** *"I thought we had opted to move all information from that gap
section into the individual book series… just get rid of the gaps button and
count in the top sections."*

They are right, and the chip was a partial reversal of their own earlier
instruction. `0253f64` removed the top-bar Series button on 2026-08-11 —
*"place that information inside of each clickable series instead"* — and
`78bbd04`, five commits later, put a **"N series with gaps"** link back on the
collection page pointing at `/series?gaps=1`. Approved at the time as "Option B";
withdrawn now.

Removed in full, not just the visible half:

| File | What went |
|---|---|
| `apps/web/src/pages/CollectionPage.tsx` | the chip |
| `apps/web/src/api.ts` | `Stats.seriesWithGaps` |
| `apps/worker/src/routes/catalog.ts` | the `listSeries` call in `/stats`, and its now-dead import |
| `apps/web/src/styles.css` | `a.stat--link`, whose only user it was |

⚠️ **Removing it also deleted the most expensive query in the app.** `/stats` is
fetched on every visit to the collection page, and that one integer cost a full
`listSeries` — every work, `series_volume` row, edition, copy, audio rung, link
and skip, with `completeness.ts` run over all 81 series. Not the reason it went,
but worth knowing if anyone reconsiders.

⚠️ **`/series` is still a live route** and must stay one — deep links, bookmarks,
the back button out of a series page and `backTarget('/series')` all resolve to
it. This removed an *entry point*, not the page. Both removals did.

**The standing decision is now written down in
`docs/info/completeness-wishlist-relations.md` §1.7**, with both build-and-remove
cycles in a table, because a bare count of what you lack reads as a missing
feature to anyone who has not seen it removed twice.

**✅ Deployed and read back from the live site**, version `d441ecd1`:

- The stat strip is now **259 books · 81 series · 104 authors · 290 editions ·
  15 on the way · 34 read** — no gaps chip.
- `/series?gaps=1` still works as a deep link: 26 of 81 series, the gaps-only
  filter active with its "Clear" button. The page survived; only the way in went.

### 💤 Gap info on the BOOK page — considered, recommended against, 2026-08-12

Raised by Claude as the other half of the removal above and then argued out of:
should `WorkPage` show the series' gap summary inline, so clicking a book answers
"what am I missing" without the hop to `/series/:name`? The owner asked *"what do
you think"*; the answer was **no**, and this records why so it is not proposed a
fourth time.

**Measured against production 2026-08-12: 37 of 259 works — 14% — are in a series
with anything genuinely missing.** The other 86% would carry a line saying nothing
actionable, or worse the words *"nothing here is missing"*, which is a sentence
about the absence of a problem.

Two rules already in the code say not to:

- `SeriesDetailPage` suppresses the media chips when every held rung agrees,
  because a label on the majority "is a label nobody reads".
- `WorkPage`'s own universe tag: *"Nothing is rendered when there is none, and
  that is the whole rule… a dash, an 'unknown' or a quiet badge would turn the
  majority of the shelf into a worklist."*

⚠️ And the pattern: **a count of what you lack has now been removed from a
what-you-have screen twice** — the top-bar Series button, then the stat chip. A
gap line on the book page is the same idea a third time, one level down. The
series tag already carries the signal ("Legion **1**" says there is a series and
where this sits), and one click from the book is where the question is actually
asked.

**If it is ever revisited, the only shape worth building** is a count on the
series tag itself, drawn only when non-zero — `Legion 1 · 1 missing` — the same
minority-only rule as `wanted` and `preordered` on the stat strip. ~37 books would
show it; 222 would not.

⚠️⚠️ **And it MUST be `certainGaps + attestedGaps`, never `gaps.length`.** The
naive version reintroduces the exact bug migration 0110 was built to remove: with
`gaps.length` every *Arcane Pathfinder* book reads "4 missing", four books that
are in the house. That would be the **third** surface carrying this rule, and
§1.4a plus the `Holdings` header each record a bug caused by two screens
disagreeing about which books they were counting. Reuse the number the series page
prints; do not recompute it.

### ✅ 870 review keys backfilled — 2026-08-12

`scripts/backfill-review-keys.mjs` had **never** been run with `--commit`, and
every review the household had written was invisible to this catalog:
`bookIdFromTitle` slugs the audiobook's decorated title, so the print
*Oathbound Healer* and `oathbound-healer-beneath-the-dragoneye-moons-book-1`
never met. **870 written, 0 unmatched**, ratings and text untouched.

⚠️ Stripping the `- MM` suffix was the PREREQUISITE, discovered by accident.
Oathbound Healer's reviews key to `oathbound healer|selkie myth`; with the
suffix still on, the work's key was `oathbound healer mm|selkie myth` and all
three would have stayed orphaned. This also unblocks **#31** (a rating means
you read it), which needed exactly this bridge.

### ✅ #31 — a rating marks the book read, for the whole shelf — 2026-08-12

The rule, the column and the per-book derivation all shipped on 2026-08-11 (see
the section further down) and were **unreachable**: every review was keyed on
the audiobook site's `bookId`, so nothing but a coincidence of spelling ever
matched. The key backfill above is what turned that on, and this is the half
that was still missing — **reach, not rule**.

`Reviews.tsx` derives a read state when somebody opens a book page. Nobody opens
258 book pages, and `backfill-read-from-ratings.mjs` needs a checkout of the
sibling repo to run, so production had **zero** derived read states. Now: one
Firestore query for the signed-in person's own reviews, **once per browser
session**, and one call that applies all of them.

| | What |
|---|---|
| ✅ | **`observedRatingsFromReviews`** in `@lc/core` — the pure half. Keeps mine via the existing `isMyReview`, drops anything off the half-star scale, drops a document with no `workKey` |
| ✅ | **`applyObservedRatings`** in `@lc/db`, and **`applyObservedRating` now delegates to it** rather than keeping a second copy of the same join. Chunked at 90 keys a statement — D1 caps bound parameters at 100 — so 400 ratings are five SELECTs, not four hundred round trips |
| ✅ | **`POST /api/reviews/observed`** and **`GET /api/reviews/collection`** |
| ✅ | **`apps/web/src/lib/read-sync.ts`**, run from the collection page, guarded by `sessionStorage` and silent on every failure |
| ✅ | The page says *"Marked N books read, from M ratings you have written on the audiobook site"* — **only when something changed** — and names where to undo it |
| ✅ | **No migration.** `read_state_how` is 0070 and nothing new is stored |

⚠️ **A sweep has no legacy key to fall back on.** It starts from the person, not
from a book, so a review written on the audiobook site *since* the key backfill
carries no `workKey` and is skipped — and is still picked up when its own book
page is opened. **The per-book path is the safety net, not a duplicate**, and
`fetchReviews`' legacy `bookId` query must not be dropped. Full reasoning in
[`docs/info/identity-and-reviews.md`](info/identity-and-reviews.md) §7.7.

**Measured:** 299 tests (was 287). Typecheck clean for `@lc/core`, `@lc/db` and
`@lc/worker`; the web build bundles. The SELECT and the write pair were run by
hand against the local D1 — a three-key `IN` list matched its two works and
ignored the unknown one, the pair produced `read` / `rating` / `audio` / 4.5,
and the probe row was deleted afterwards.

⚠️ **Not verified:** nothing has been run against production and no browser has
executed the sweep. The numbers it will write are the ones the 2026-08-11 dry
run predicted — **15 works, every one `read_format = 'audio'`** — and that dry
run predates 25 new works and the key backfill, so expect it to differ.

**Pending, in this order — nothing below has been run:**

```bash
# 1. Code only. There is NO migration for this one.
npm run deploy

# 2. Then simply open the collection page while signed in. The sweep runs
#    itself, once per session, and says what it did.
```

Running `npm run backfill:read-states -- --remote --commit` is still an
alternative to step 2 and is no longer needed — it writes the same rows by the
same rule. ⚠️ It is **not** redundant for the household members who have never
signed in here: the sweep only ever runs for whoever is looking at the screen.

### ✅ #43 — an arriving pre-order is a question, not a guess — 2026-08-12

*"We also need a feature where if I add a book that's in pre-order status there
is a prompt asking me if this is the received pre-order or different."* Built on
`feature/preorder-arrival-prompt`. **Not deployed, no migration.**

Production holds **12 pre-ordered copies** — Completionist Chronicles 2–5, Tamer
11, three *Worlds Beyond Number* variant covers — several shipping within months,
so this gets exercised soon.

| Answer | Write | The failure it prevents |
|---|---|---|
| the pre-order arrived | that copy `preordered` → `owned`, via `arrivedPatch` | a phantom pre-order inflating "on the way" for ever, because nothing re-checks it |
| a different copy | a new `owned` copy; pre-order untouched | silently losing a copy the household owns |

⚠️ **Asked before the first write, not between two of them.** `addLineToCatalog`
returns `{ status: 'ask-preorder' }` and writes nothing; answering re-runs it
from the top, and the work match is idempotent. A prompt nobody answers leaves
the catalog exactly as it was.

⚠️ **One button per pre-ordered copy.** *Worlds Beyond Number* is **one work with
three pre-orders**, one per variant cover — "the pre-order" cannot be resolved
without asking which, so each choice is labelled with its edition name.

| | |
|---|---|
| covered | the scan review row (`ScanLines`), and the manual Add form's **have it** intent |
| ⚠️ not covered, deliberately | `POST /api/works` — it writes no copy, so there is no arrival to confuse. The Copies panel and the arrivals checklist already show the pre-order on screen; nothing there is a guess |
| cost | one `GET /api/works/:id`, **on the Add tap only** — not per row |
| ⚠️ `wanted` stays apart | `preorderedCopies` tests one status. `CollectionStats` in `@lc/db` carries the sibling's 262-vs-25 bug |
| new files | `packages/core/src/preorders.ts` (rule + wording, 9 tests), `apps/web/src/lib/preorders.ts`, `components/PreorderPrompt.tsx` |

⚠️ **The manual Add form now matches before saving, and only for "have it".** It
still creates a work per save otherwise — `POST /api/works` does not dedupe on
purpose — so answering *a different copy* does exactly what Save did before.
General de-duplication of that form is a separate, larger change.

### ⚠️ `work.universe` — 5 of 258, and that is not the backfill

The five Completionist Chronicles works carry `CAL Verse` / `universe_how =
'list'`, stamped when the research queue called `updateWork`. So the #33 write
path is proven live — it simply only fires on works that pass through
`createWork`/`updateWork`, and rows inserted by script do not.

**`npm run backfill:universes -- --remote` has still never been run.** 253 rows
are NULL and the universe UI has almost nothing to show. Dry-run it first.

## Universes — the list has MOVED OUT of this repo, 2026-08-11

Flag a shared fictional universe **only where it says something the series does
not already say**. The list holds every decision and its reasoning, including
refusals so they are not re-litigated.

⚠️ **IT NO LONGER LIVES HERE.** It is at
**`catalog-platform/data/universes.json`**, and `library_catalog/data/` is gone
with it. It was never library data: it is keyed on series + author, both
catalogs need it, and the audiobook side is a Python static build that cannot
query D1. **Do not recreate a copy in this repo** — a copy is how two lists
drift, and that is the failure the move exists to prevent.

| Want to | Do |
|---|---|
| Read or edit the list | `cd ../../catalog-platform && node tools/universes.mjs` — the CLI refuses an edit that carries no reason |
| Use it in this repo | `import { universeFor, universeIndex } from '@lc/universes'` |
| Understand the wiring | [`docs/info/universes.md`](info/universes.md) |
| Understand the decisions | `catalog-platform/docs/UNIVERSES.md` |

⚠️ **`catalog-platform` is now a build dependency of this repo.** `prebuild`,
`pretest` and `pretypecheck` all run `scripts/sync-universes.mjs`, which fails
loudly — naming `CATALOG_PLATFORM_DIR` — if it cannot find that checkout.

### ✅ A book is filed in its verse when it enters — migration 0080, 2026-08-11

The owner: *"when a book enters it's automatically added to its verse especially
if it's a copy of an ebook audiobook or physical."*

`work.universe` + `work.universe_how`, **derived on write in
`packages/db/src/works.ts`**, so all five ways a book can enter are covered
rather than only the scan path. Details in
[`docs/info/universes.md`](info/universes.md) §4.1.

| case | cost |
|---|---|
| another format of a book already held | **zero lookups** — formats are editions of one `work`, and the work already carries it |
| a new book in a known series | one Map lookup in bundled JSON, no network |
| a series or title the list has never heard of | resolves to nothing, which is the **correct answer** |

⚠️ **A scan carries no series**, so a scanned book is filed on its title alone at
add time and re-resolved when `backfill:series` supplies the series. ⚠️
`universe_how = 'human'` is never overwritten, including a human *"in no
verse"*. ⚠️ The add path never calls a model — a universe is invented by a
person in `catalog-platform/tools/universes.mjs`, not by a sweep.

Not run yet: **`npm run backfill:universes --remote`** (dry run first). It
re-resolves machine rows when the list grows and skips human ones.

### ✅ On screen since 2026-08-11 — three surfaces, and one rule between them

| Where | What it says |
|---|---|
| A book page | `Part of <universe>`, under the series line, linking into it. ⚠️ **Nothing at all when there is none** |
| `/universe/:name` | Everything held from one world, grouped by series, each heading a link out to that series' own ladder |
| `/?universe=` | A filter beside the others, with counts, and a link across to the page above |

⚠️ **The rule the three share: absence is never drawn.** Measured on the local
snapshot 2026-08-11 — **13 of 116 works resolve** (6 Cosmere, 7 CAL Verse). The
other 103 are mostly children's picture books that belong to no shared world and
are correctly filed, so there is no "no universe" badge, no such filter option,
and no count of them anywhere. Same settled reading as a NULL `cover_status`
("nobody looked") and a NULL `edition_kind` ("ordinary").

⚠️ **A universe is the tier above a series, never a replacement for one.**
`/universe/:name` computes no completeness and draws no ladder: a universe has
no volume numbering to be complete against. Anything about *what is missing*
belongs on the series page.

The lookup never runs in SQL. `listUniverseKeys` (`@lc/db`) hands
`(id, title, series)` to `universeFor`, and the ids come back as a WHERE clause
— so the filter and the count labelling it are produced by one function and
cannot disagree. `@lc/db` still does not import `@lc/universes`; the join lives
in `apps/worker/src/lib/universes.ts`, which is what keeps the cross-repo build
dependency out from behind every query.

**Feasibility was proved by hand, at no API cost.** A 15-case probe
(`scripts/probe-universes.mjs`) scored **13/15 with zero false positives** at
~21¢/100, no web search — search cost 5× and was *worse*, inventing a name
rather than finding one. Then the classification itself was done by hand because
the owner asked to check feasibility first. Scope is small: **418 deduplicated
subjects across both catalogs, but only 52 authors have 2+ series**, and ~6
universes cover the real cases.

### ⚠️ The finding that decides the design

**A series→universe mapping is NOT sufficient.** Three counterexamples, all real:

| case | why it breaks series-keying |
|---|---|
| **Secret Projects** | 4 of 5 are Cosmere; **Frugal Wizard is not** |
| **Otherlife trilogy** | no series value at all — the name is inside each title |
| **Fires of December** | standalone, no series, *is* Cosmere |

So per-book overrides are required, and the auto-assign-on-add path cannot read
the series and stop.

### Settled

| universe | state |
|---|---|
| **The Cosmere** | ✅ approved — 5 series, 10 book overrides, 8 exclusions |
| **Runnerverse** | ✅ approved — 11 series + the Otherlife trilogy, 40 of 43 Arand/Darren books |
| **CAL Verse** | ✅ approved — all 9 Dakota Krout series, grouped broadly by instruction |
| **Maasverse · Riordanverse · Solaria** | ✅ approved — 3, 3 and 2 series |

Every count above is asserted by `packages/core/test/universes.test.ts`, so an
edit in the other repo that changes one fails here.

**Held out for owner verification:** Will Wight (Cradle, Last Horizon),
Turncoat's Truth, Cultivating Chaos, The Axe Falls, Tailored Realities.

⚠️ The refusals are now **enforceable**, not just prose: each carries the exact
series values it holds out, and a test proves none of them resolves. Doing that
turned up a discrepancy worth knowing — the refusal says *The Axe Falls*, and
the series value in `site/catalog.csv` is **`The Axe Falls Series`**. Testing the
wrong spelling would have passed while protecting nothing.

### Data problems this surfaced — not universe work, but found by it

- ⚠️ **`Cosmere` and `The Cosmere` are SERIES values** on two different works —
  a universe masquerading as a series, spelled two ways.
- ⚠️ **The Completionist Chronicles is filed as 7 and should be 14.** Four the
  owner named (Implode, Tenacity, Thesaurize, Thunderplump) plus **Uncapped,
  Unmapped and Untapped — which the LIBRARY already files correctly while the
  audiobook catalog leaves them seriesless.** The two catalogs disagree and the
  library is right; neither side is authoritative by default.
- **Otherlife** sorts Awakenings/Dreams/Nightmares — that is book 3, 1, 2.
- Strays: *Everything* → Full Murderhobo; *World's Only Hero* → Chance Encounter.
- **Firstborn / Defending Elysium is an omnibus**, not a broken row — one real
  two-novella volume, neither novella Cosmere. Belongs in `edition.collects`.
- ⚠️ **A universe flag belongs on the WORK, never the edition** — an omnibus can
  collect works from different universes.

## ⚠️ GitHub Actions minutes — diagnosed 2026-08-11, fix deferred by the user

**Only `audiobook_catalog` runs any workflows.** `library_catalog`,
`Board_Game_Catalog` and `catalog-platform` have **no `.github/workflows` at
all**, so the user's assumption was right.

Seven workflows there, and **two of them are pure cron**:

| Workflow | Schedule | Share of the last 100 runs |
|---|---|---|
| **Club Discord Notifications** | `*/15 * * * *` — **every 15 min** | 25 |
| **Content-warning requests** | `17 * * * *` — hourly | 21 |
| Deploy / Lint / Tests / promote | push or manual | the rest |

Measured: **100 runs in 26 hours ≈ 92/day ≈ 2,760/month.** The two crons alone
are ~46% of that and run whether or not anything changed.

⚠️ **The root cause is not the crons — it is that the repo went private on
2026-08-10.** Public repos get unlimited Actions minutes; private repos are
metered (2,000/mo Free, 3,000 Pro). Those two schedules were free the day before
and metered the day after. Nothing about the workflows changed.

Cheapest fixes, in order: lengthen the Discord poll from 15 min to 30–60 (saves
~50–75% of the largest consumer on its own), fold the hourly CW check into the
same job, or move both to Cloudflare Cron Triggers — the estate already runs
Workers, and Cloudflare's scheduler is free.

## Read this — state at the end of 2026-08-11 (SUPERSEDED by the 2026-08-13 section above)

> The "the run is finished" banner that used to sit here was written at the end
> of the overnight run and was **stale within hours**. A full day of work
> followed it. Treat any "everything is done" claim in this file as a timestamp,
> not a status.

**In flight right now:** a full crowdfunding rescan (§Crowdfunding rescan
below). Nothing else is running.

**Open and actionable without the user:**

| | |
|---|---|
| **`backfill:universes` has never run against production** | 0 of 233 rows have a universe. Biggest built-but-not-switched-on item |
| **Crowdfunding rescan** | Kickstarter shows **61** successful pledges; we hold **11** pledge items. In progress |
| ✅ ~~**#43 preorder-arrival prompt**~~ | **Built 2026-08-12** on `feature/preorder-arrival-prompt`, not deployed. Section below |
| **#37 editable audiobook listings** | largest remaining build; cheaper now the corrections layer exists |
| **#29** how duplicates count · **#31** rating ⇒ read | unchanged |
| ✅ ~~**#30** B&N covers~~ | **Done 2026-08-12, and mostly already done.** All 7 had covers on 2026-08-11 from `apply-bn-details.mjs`; #30 was a stale entry. What was left was §2.5's other half — all seven images were *viewed*, six are the book's own jacket, and Project Hail Mary's stand-in was replaced with the **Deluxe Edition's own art**. `scripts/assess-bn-covers.mjs`, written to production. "Cover needed" among the seven: **0, was 1.** |

**Wants a human — nothing here is waiting on more work:**

1. Four universe verifications — Will Wight (Cradle, Last Horizon), Turncoat's
   Truth, Cultivating Chaos + The Axe Falls, Tailored Realities.
2. Say what "+ Books" meant in the Words of Radiance tier — BackerKit holds no
   itemisation for that pledge at all.
3. ~~Confirm the published title of the *Unstoppable* novel~~ — ✅ **RETIRED
   2026-08-11. There is no novel.** *Dungeon Crawler Carl: Unstoppable* is a
   card-crafting deck-builder; the pledge is two tabletop games and is out of
   scope entirely.
4. Resolve *Secret Ingredient* vs *Pengrooms* — **see THE PHYSICAL STACK below.**
5. ~~Give five reward lines a format~~ — ✅ **RETIRED 2026-08-12: nothing to do.**
   Checked three places: all 11 `pledge_item` rows carry a `format_hint`, all 11
   book lines in the staged scan carry an `editionFormat`, and nothing is marked
   unresolved. The only formatless line is the Fires of December AUDIOBOOK, which
   is deliberate — `editionVerdict: "none"`, because an audiobook is not a
   printing and would otherwise sit in the no-printing queue forever.
6. Add subtitles to three board books — **see THE PHYSICAL STACK below.**
7. Decide whether the heygabi.ai `/todo` page should be public. Built and pushed,
   **deliberately not deployed** — the user has since said to keep it private.
8. ~~Paste four cover links~~ — **moved into the scan backlog 2026-08-12.** The
   owner has those four pulled in a physical stack to re-scan, so they are not a
   paste-a-URL job. ⚠️ Separately, coverless works went 6 → 32 because scripts
   that mint works bypass the cover pipeline; 21 were then filled from the
   sibling audiobook catalog as **stand-ins**, leaving 11 — the four originals
   plus Tamer 2-6, Space Knight 7 and Worlds Beyond Number, all print-only or
   unreleased so there is no audiobook art to borrow.

   **✅ Done 2026-08-12 — Space Knight 7 was never print-only.** The m4b was
   sitting loose at the `books/` root instead of in `Michael-Scott Earle/`, so
   the library walk never saw it and every listing read the series as 1–6, 8–10.
   Ran `scripts/sync_to_drive.py` by hand: sorted, 612.7 MB to Drive, 25
   chapters, cover to R2, catalog 1076 → **1077**.

   It still landed seriesless, for the same reason its six siblings did — the
   file is ffmpeg-made (`©too=Lavf61.1.100`), so it carries no `SRNM`/`SRSQ` and
   no `CDEK`, only `©alb` and `trkn`, neither of which the pipeline reads. Only
   books 1 and 2 are real Audible downloads with genuine `SRNM`. Added the
   matching `catalog_overrides.json` entry; all ten volumes now carry series and
   volume. Then, downstream: `covers-from-audiobooks.mjs` → **11 coverless works
   → 10**, and `backfill-audiobook-holdings.mjs` → Space Knight rungs
   **[1,2,3,4,5,6,7,8,9,10], 1 new**, every other series `0 new`.

   ⚠️ **Two lessons, and the second one cost the most time.**

   1. *"No audio for this volume"* was inferred from a catalog listing, and the
      catalog only sees files the sorter has filed. A loose file in the drop
      folder is invisible and looks exactly like an absent one. **Check the raw
      `books/` root before recording an audio gap.**
   2. The owner reported the live site showing series for only books 1–2 while
      the deployed `catalog.csv` demonstrably had 1–6 and 8–10 correct. That was
      a **stale browser cache of `catalog.csv`**, not a data fault — it cleared
      on the next deploy. ⚠️ Before debugging a data bug from what the page
      shows, fetch the underlying CSV with a cache-buster and compare. The two
      disagreeing is itself the diagnosis.
9. **Sign in to BackerKit as `nbaslamking@gmail.com`** so the second account can
   be scanned. `aim.com` is signed in and holds only Words of Radiance.

✅ Cleared today: the Illumicrate Percy Jackson set was confirmed *and*
independently verified against the campaign photo.

### ✅ Four items closed 2026-08-12 — and two of them were already done

The owner asked what was still outstanding, said *"30 i thought we did this"* and
*"31 I thought we did this too"*, and was right on both counts. Checked against
the live database rather than the task list, which is the point of writing this
down: **two of the four open items had been finished and never marked.**

| # | Outcome |
|---|---|
| **30** B&N covers | **Already done.** All 7 works bought from Barnes & Noble carry `cover_status='ok'` and a real URL. None outstanding. |
| **31** rated → read | **Already done.** All 35 `user_book` rows are `read_state='read'`, `read_state_how='rating'`, synced 18:01:39. |
| **44** Realmkeeper pairing | **Confirmed by the owner** — "1,2/3,4/etc." The stored `collects` strings were already right, so no data changed; only the provenance moved from *assumed* to *verified*. |
| **29** duplicate counting | **Decided and implemented** (commit `8099bb7`). ⚠️ **Not deployed** — the worker deploy is manual. |

⚠️ **On #31, do not mistake this for incomplete:** 47 works sit under a series
with an audio rung but carry no read state. That is correct. The signal is a
**rating**, not ownership — an unrated audiobook says nothing about whether it
was read, and inferring "read" from "owned on audio" would be inventing data.

**The #29 rule, in two halves that look alike and are opposites:**

1. **Own it N times → it counts N times.** The owner's reason is the design
   brief: *"This will make giving books away."* So it is an inventory count, not
   a bibliography — and it counts `copy` rows, so two copies of ONE edition
   still count as two. This half needed **no change**: `heldCopies` already
   counts copies rather than editions, and `WorkList` already renders the ×N
   mark. DCC shows ×2 and becomes ×3 when the third is scanned.
2. **An omnibus of five books is still ONE object.** It counts once, on its own
   line; the volumes inside are not counted again but each carries a
   *non-counted* cross-reference. The `contains` relation already existed and
   rendered as "Part of" — but a bare "Part of" chip reads as *another thing on
   the shelf*, the exact misreading the rule exists to prevent. It now states
   the consequence from both ends.

⚠️ **The Divine Dungeon omnibus collects books 1–5, but books 2–5 do not exist
as works in this catalog** — only *Dungeon Born* does, and it already has the
link. The whole catalog has exactly **one** `contains` relation, so there were
no missing overlap notes to write.

Also fixed while in there: `collectionStats` counted `status='owned'` while
every other "do we have it" decision routes through `HELD_STATUSES`, which also
counts `lent`. Lending a book would have shrunk the shelf total while the ×N
mark beside it kept saying two. No row is lent today, so no number moved — the
disagreement was waiting for a first loan.

⚠️ **Build trap, now recorded in the code:** that stats SQL is a template
literal, so a backtick inside a `-- comment` closes it. It broke the build on
the first attempt.

### ⚠️ THE PHYSICAL STACK — one trip clears all of it

The owner has these pulled as a physical stack. Consolidated 2026-08-12 so
they are answered together rather than raised one at a time. **Remind them of
this whole list when they next mention the pulled books.**

| | needs | why nothing else will do |
|---|---|---|
| #141 *Touch and Explore* · #160 *Bizzy Bear* · #174 *I love you, little bear* | a **subtitle** | bare series-line titles; a lookup returns the range, not the book. ⚠️ **CORRECTED 2026-08-13: “all three ISBNs did not resolve” was FALSE for #141 and #174** — both resolve on the first call to Open Library's `/api/books`, and six of nine answers for those two came from those two calls. The original conclusion came from **web-searching the ISBN string**, which returns garbage (searching `9781472327314` returns an unrelated book called *Cut*). The claim now stands only for #160 |
| #137 Paw Patrol shaped board book · #171 *Home Sweet Home* · #195 Korean Tinyping · #197 *The Nightmare Before Christmas* | a **rescan** | no cover any rung can reach, and no audiobook to borrow one from. Not a paste-a-URL job |
| #215 *Pengrooms* · #213 *Secret Ingredient* | the **series name off the cover or spine** | contradictory auto-fills. Both star Pringle and Finn; "Pengrooms" reads as the 2021 book's TITLE, not a series. Theory: series is *Pringle & Finn*, books 1 and 2 — unverified, and a self-published picture book may have no formal series at all. Both wear a Check mark; clear the `work_watch` rows when resolved |

## Overnight autonomous run — started 2026-08-10 ~22:35

The user went to bed with: *"keep the working going until everything on the todo
list is done, take breaks as necessary to not hit usage limit but everytime it
refreshes you keep going. if you need me to intervene set it aside and keep going
on with other things."*

Rules being followed: stop starting agents at **93% weekly**, keep working
conversationally to **97%**; the session window is the cheap one (it resets in
hours) and the weekly is the real ceiling. Anything needing the user goes in
**Blocked** above rather than stalling the run.

Five agents were in flight at bedtime: mark-as-arrived (+ clickable series on
cards), audiobook matching + automatic covers, a browser verification sweep,
and the bulk details-queue clear. ⚠️ The queue agent was told to **report the
cost before spending it** — the research path is a paid API and the backlog is
in the hundreds.

## Rollback points

The user permits pushing straight to `main` while this site is pre-release, **on
condition that a rollback id is recorded**. Contrast the board game catalog,
which has real users now and where changes are "more damning".

| Date | Pushed | Roll back to | Worker version |
|---|---|---|---|
| 2026-08-10 | `4d19ae4` — five agent branches, covers, formats | `c75d174` | `86e453ed` |
| 2026-08-11 | `3848593` — collector's-edition and bare-ebook format rules | `bb836dd` | `444d4562` |
| 2026-08-11 | `75e650f` — cover status, watches, upload path, migration `0040` | **`3848593`** | **`05fdf2e3`** |

To undo the code: `git reset --hard c75d174 && git push --force-with-lease`.
⚠️ **That does not undo the database.** Migrations `0013`, `0020` and `0021` are
applied to production and are additive; leaving them in place is safe and is the
right call. The 99 board-book format corrections and the 40 audiobook holdings
are data changes with no down-migration — re-running the scripts is the remedy,
not a revert.

To roll the Worker back without touching git, redeploy a prior version id from
the Cloudflare dashboard.

---

## Blocked — the live list

| | Item | Blocker | Who clears it |
|---|---|---|---|
| ⏸️ | **BackerKit `nbaslamking@gmail.com` is not signed in** | The browser holds `aim.com`, which has only *Words of Radiance*. The gmail account has at least the DCC Croc Box and probably more. ⚠️ **Never sign in on the user's behalf.** | User — said "we will do nbaslamking@gmail.com next" |
| ⏸️ | **Four universe calls held for verification** | Will Wight (Cradle, The Last Horizon) — the author has *hinted* at a multiverse and nothing is established; Turncoat's Truth; Cultivating Chaos + The Axe Falls; Tailored Realities. All recorded in `_refused` in the shared list so they are not re-litigated. | User |
| ⏸️ | **Two series stay hedged at AUDIO?, and cannot be fixed by code** | *Arcane Pathfinder* (we hold 5, audio has 1–4) and *Legion* (we hold 1–2, audio has only the omnibus at rung 4). No volume is owned in both formats, so nothing can corroborate the numbering. ⚠️ Loosening the matcher would turn a hedge into a lie. | User — a purchase, or nothing |
| 💤 | **~100 physical books unscanned** | Standing backlog, **explicitly not a blocker**: *"Don't wait for books to be scanned to move on."* A book missing from the catalog usually means unscanned, ranked above "not owned" and well above "bug". | User, over time |
| ✅ | ~~**Percy Jackson covers: no per-book images exist**~~ | **Answered and built.** User: *"use the marketing image now but put a label on them."* Migration `0040` sets all five to the plain-background lineup and flags them `cover_status = 'standin'`, so they wear the picture **and** stay on the "Cover needed" list. ⚠️ The five identical URLs are deliberate — nothing may dedupe them. Selected by `edition_name`, not by id. | Done |
| ⏸️ | **Two books claim contradictory series** | #213 *Secret Ingredient* records series "The Pengrooms"; #215 *Pengrooms* records "Pringle & Finn". Both by Paul Castle, both auto-filled, both sourced — and they cannot both be right. **Both now carry a `work_watch` row**, so they wear a **Check** mark and appear under `Needs → To check`. The question is recorded; it still wants the user's eyes. | User — said they will verify later |
| ⏸️ | **Three books the model refused to identify** | #141 *Touch and Explore* (Scholastic), #160 *Bizzy Bear* (Nosy Crow), #174 *I love you, little bear* (Judi Abbot) — bare **series-line** titles, so a lookup returns the range rather than the book. Declining beat guessing. ⚠️ **CORRECTED 2026-08-13: the “ISBNs did not resolve” premise was FALSE for #141 and #174** — the API resolves both; only *searching* the ISBN fails. **Re-running DOES help when it queries the API rather than the web**; a subtitle also helps — e.g. *Bizzy Bear: Fire Rescue*. | User, from the covers |
| ⏸️ | **4 works have no cover any rung can reach** | A Paw Patrol shaped board book, *Home Sweet Home*, a Korean Tinyping board book, *The Nightmare Before Christmas*. **There is now a way in**: the book page's Cover panel accepts a link to any image, verified before storing. Uploading a *file* additionally needs the R2 binding below. | User — paste four links |
| ✅ | ~~**Cover file upload needs an R2 binding**~~ | **Done 2026-08-11.** Bucket `library-covers` created, `COVERS` binding + `COVERS_BASE_URL` wired, deployed `0ab1e18e`. ⚠️ The hostname is **`bookcovers.heygabi.ai`, not `covers.heygabi.ai`** — that one is already attached to the sibling's `audiobook-covers` bucket, and a custom domain belongs to exactly one bucket. Checked before choosing. Still worth adding a Cache Rule (`bookcovers.heygabi.ai/*` → Edge TTL 1 year); safe because object names hash the file contents, so a replaced cover is a different URL. | Done |
| ✅ | ~~**Barnes & Noble was never imported**~~ | **Found 2026-08-11 while answering "what's labelled deluxe edition".** The scan was staged on 2026-08-10 and never imported, because the only importer was for pledges and rightly refused a shop order — so **zero of its 7 books were in production**. `scripts/import-shop-orders.mjs` is the missing half. Now: **3 owned, 4 preordered**. ⚠️ This is also why the preorder tag had never rendered — it was correct all along with nothing to show. | Done |

### Answered by the user 2026-08-11

- **Percy Jackson set confirmed** — and independently verified: the group photo
  on the Illumicrate page shows exactly *The Lightning Thief*, *The Sea of
  Monsters*, *The Titan's Curse*, *The Battle of the Labyrinth*, *The Last
  Olympian*. No longer an assumption.
- **Words of Radiance "+ Books" is solved.** The leatherbound shipped as **two
  physical volumes**, because the book is too large to bind as one. So it is one
  edition delivered as two objects — not two different books, and not a mystery.
- **"DCC RPG + Unstoppable" — dropped.** The user says it is a D&D book, so the
  whole pledge belongs to the board game catalog. Nothing to split out, and no
  work should be minted. Removed from Blocked entirely.
- **The `/todo` page must NOT be public.** It stays built and pushed but
  undeployed. heygabi.ai has no auth and never will, so if it is wanted live it
  has to move to a host that does — the catalog sites already sit behind
  Firebase sign-in.

### Cleared since the last revision

- ~~Main checkout dirty with unclaimed manager-role work~~ — it was the
  people/roles feature from earlier in the session; it committed itself as
  `a138019` + `c75d174`.
- ~~Deploy blocked by a dirty tree~~ — main is clean; five branches merged.
- ~~Barnes & Noble sign-in~~ — done, scanned, complete.
- ~~Kickstarter password verification~~ — user fixed; all 62 pledges enumerated.
- ~~Indiegogo sign-in~~ — done; only 3 pledges exist.
- ~~Worktrees typechecking against the main checkout~~ — no `node_modules` in a
  worktree made Node resolve `@lc/core` upward. `npm install` in the worktree
  fixes it. All five agents confirmed.

---

## 2026-08-11, second half — series, audio and the duplicate cleanup

Everything below is **live**. Data-only items needed no deploy; code items are
in version `8c8b4e76`.

### ✅ Three agent branches merged, and a migration collision caught

Universe auto-assign (0080), the universe UI, and the audio-gap fixes. ⚠️ **Two
agents independently created `migrations/0080`** — git merged both cleanly
because the filenames differ, but wrangler tracks migrations by NAME, so it
would have marked 0080 applied and **silently skipped** the audiobook one.
Renumbered to `0090_audiobook_series_holding` and `0100_series_gap_skip`. All
three applied to production. 287 tests.

### ✅ The ladder now tells the truth about audio — 0090

`audiobook_series_holding`, keyed `(series, index_sort)`. `work_match` renders
**AUDIO** and stops counting as missing; `fold` renders **AUDIO?** and *stays*
missing, because a hedge does not cross a book off a list.

⚠️ **Agent a3a4426 claimed "every row has a matching `series_volume` row by
construction, and there is a test".** That was true of its fixture and **false
in production** — 52 of 113 rungs had no backing, and Percy Jackson had none at
all, so the page read *"5 of at least 5, nothing missing"* while books 6 and 7
sat in the audiobook catalog. Fixed by running `backfill:series-volumes`, which
already existed. **Lesson: a subagent's "verified" can be true of its fixture
and false of production.**

### ✅ Series completed from the audiobook side

A full sweep of all 1,075 audiobook rows: 85 books were seriesless while their
own `©alb` held a series the pipeline never reads. 71 were standalones (correctly
seriesless). The rest completed six series — Lion's Quest 1–6, Space Knight
1–10, Jackal Among Snakes 1–3, Millennial Mage 1–2, Monster Empire 1–2, Tamer
7–10 — plus the Full Murderhobo #3 gap.

- **Lion's Quest volume 5 is spelled `Lions Quest`** in its `©alb`, the only book
  in the series spelled that way, which is why it split off and looked like a
  hole. Now fixed **at source**: `SRNM`/`SRSQ` written to all six files so the
  `canonical_series` fold is no longer load-bearing.
- **Tamer volume 1 exists twice and that is correct** — two narrations, 762.8 MB
  and 333.8 MB. Recorded in `_not_corrected_on_purpose`; the sweep will keep
  reporting `DUPLICATE_VOLUME` for them and **that report should be ignored**.

### ✅ Dungeon Crawler Carl promoted, without touching the matcher

Added the Kickstarter V2 & V3 limited hardcovers (*Carl's Doomsday Scenario* #2,
*The Dungeon Anarchist's Cookbook* #3). That was the missing corroboration — all
8 rungs went `AUDIO?` → `AUDIO`. The hedge had been **correct**: the only DCC row
we held was *Crocodile*, a Florin DuPont side-story, deliberately unnumbered.

### ✅ Smaller, all live

- **24 children's titles title-cased** (`123s of art` → `123s of Art`). Safe
  because `normaliseTitle` lowercases, so `work_key` and the Firestore review id
  are byte-identical — and the script **checks** that rather than asserting it.
- **Series button removed from the top bar**; a series is reached from its book.
  `/series` is still a live route.
- **"N series with gaps" stat** on the collection page, linking to
  `/series?gaps=1` — computed by `listSeries`, not a `COUNT(*)`.
- **Divine Dungeon omnibus**: 2,258 pages (a *convention* — the epub declares no
  page count), `collects`, and a `contains` relation.

### ✅ 34.9 GB of duplicate audio removed

58 files across four causes: two stray nested folders, and two co-author folders
already handled by `author_aliases.json` (`Dennis Vanderkerken → Dakota Krout`,
`Alexey Kovtunov → Oleg Sapphire`). Every deletion was preceded by a byte-level
check that an identical twin survives — **zero unique, zero mismatches**.
⚠️ `zzzz_Books_to_be_Converted` is a staging pile of part-files and must always
be excluded from sweeps.

### 💤 The uncurated m4b repair path is DISARMED

Scrapped by the owner after the full dry run proposed 128 writes of which **7**
were plausible. `--commit` without `--from-overrides-only` now exits 2.
Reasoning in `audiobook_catalog/docs/info/catalog-corrections.md` §8.2.

## Crowdfunding rescan — 2026-08-11, IN PROGRESS

The owner: *"I'm feeling dodgey about our scanned material from kickstarter and
related sites. Let's just do a full rescan and present me the list for
verification. Do a thorough reading not just high level."*

They are right. **Kickstarter shows 1 active + 61 successful pledges; the
database holds 11 pledge items.**

⚠️ **The list view paginates — there is a "Show more pledges" button and it must
be clicked until exhausted.** A first pass read only the visible 10 and would
have reported a fraction as if it were the whole.

Already visible and **not** recorded: *Raze & Ruthless: The Grimoire Editions*
($190, Legendary Book Box, uniquely numbered), *Regicide & Rexus: The Grimoire
Editions* ($164), *Tamer: King of Dinosaurs Book 11* ($90, signed paperback),
*Worlds Beyond Number: The Official Graphic Novel* ($435).

Scope: books only; board games belong to the sibling catalog but get listed as
excluded so the judgement can be checked.

### Result — **14 unrecorded book pledges**. COMPLETE. Report in the session scratchpad.

| account | coverage |
|---|---|
| Kickstarter | ✅ 61 successful + 1 active, after "Show more pledges" ×5 |
| Indiegogo | ✅ all 3 pledges; 2 are books |
| BackerKit `aim.com` | ✅ Pledges (1, no pagination) + Surveys p1+p2 + Active + Digital rewards |
| BackerKit `gmail.com` | ✅ Pledges (4) + Surveys Completed p1+p2 + Active p1+p2 + Digital rewards |

⚠️ **Two pagination traps.** Kickstarter renders 10 of 61 by default; **every**
BackerKit survey list is `1 / 2`. Trusting the first screen would have reported
a sixth of the truth. Look for pagination on every list, every time.

**The finds:** Completionist Chronicles **1–5 in physical Grimoire editions**
(*Ritualist* box SHIPPED) · **Tamer 1–10 in paperback plus 11 on preorder** —
the book-7 tier was "WHOLE SERIES SIGNED PAPERBACKS", confirmed by the owner,
and no hardcover exists · **Beneath the Dragoneye Moons Complete Realmkeeper
Set** ($670, shipped) · *Worlds Beyond Number* graphic novel · *Monster Empire 2* ·
*Ascend Online Book 1* · and from Indiegogo **Space Knight 5 and 6** — which is where the
existing unattributed Space Knight EPUBs came from. ⚠️ The owner confirms print
copies exist and they own **Space Knight 1–9**, so that is 9 paperbacks, not 2.

**Tamer audio, settled by the owner 2026-08-12:**

| Volumes | Audio | Note |
|---|---|---|
| 2–6 | **not owned** | Confirmed correct — a real gap, not a filing error. Stop re-checking. |
| 11 | **owned** | ⚠️ But **BookFunnel will not serve the download at this time**, so no m4b exists locally and the audiobook catalog cannot see it. |

⚠️ Tamer 11 is the case the schema handles badly: *owned but unobtainable*. It
is not a gap to chase and not a file the pipeline can ever acquire — any audit
that walks the library will keep reporting it missing. Treat a future "Tamer 11
audio missing" finding as already answered, and retry BookFunnel occasionally
rather than the acquisition pipeline.

⚠️ **Nothing has been written to the database.** The owner asked to verify first.

Still needs the owner: how many volumes in the Realmkeeper Set; what the two
Grimoire "Legendary Book Box" tiers contain; whether *Unstoppable* is the published title; and what "+ Books" meant
in the Words of Radiance tier — that order detail refused to open twice.

## Shipped this session

| | Item | Evidence |
|---|---|---|
| 🚢 | Newest scanned book at the top of the queue | `6732f331`. ⚠️ Row/index pairing happens *before* the reverse — `index` is the offset the server patches. |
| 🚢 | Covers reach the work, not just the edition | `74ddd86`. Cover was landing one table away from where every list renders it. |
| ✅ | Stranded covers backfilled | `scripts/backfill-work-covers.mjs`. 35 filled, 0 stranded. |
| ✅ | **Board books corrected to hardcover** | `scripts/fix-scanned-formats.mjs`. 99 editions; production now has **0 paperback**. Dated on purpose — real paperbacks are arriving from B&N. |
| 🚢 | Series restructure | Print/Ebook/Audio chips, "Bought more than once", searchable series list. Migration `0010`. |
| ✅ | Audiobook holdings backfilled | 40 written, confirmed by re-read. |
| 🚢 | Format filter + preorder tag | Filter means **"has a physical edition"**, not "physical only". Caught `stats.wanted` silently summing wanted + preordered. |
| 🚢 | Editing an edition | `PATCH`/`DELETE /api/editions/:id` + Editions panel. `updateEditionSchema` had existed since day one with no route behind it. |
| 🚢 | Drive links hidden for physical books | Rule: show only when a **non-physical edition** exists. ISBN deliberately not consulted. |
| 🚢 | Automatic first-pass lookup | Ported from the sibling. **Concurrency is 1** — an 8-way `Promise.all` funnels through a 1100 ms serialising queue; measured 8885 ms for 8. |
| 🚢 | In-queue duplicates, unresolved barcodes, SKUs | Duplicates were deduped server-side at append time and the flag was never read. Non-Bookland codes are now addable rows carrying the raw code. |
| 🚢 | **Auto-apply missing details** | The queue writes what it finds instead of asking. Migration `0013` adds `decided_how`, so machine-written values stay distinguishable from asserted ones. `GET /auto-applied` + `POST /undo` give bulk recoverability. |
| 🚢 | Accessories + crowdfunding provenance | Migrations `0020`, `0021`. Four tables; campaign/pledge split so **two BackerKit accounts** can back one campaign. |
| ✅ | All 62 Kickstarter pledges enumerated | 15 library, 45 board games, 2 neither, 8 mixed, 6 flagged ambiguous rather than guessed. |
| ✅ | **Mark as arrived, in batches** | `6593a7e`. Ported from the sibling onto the **wishlist**, not a book page — a pledge delivers several *works*, so no work page can hold the batch. No migration, no bulk endpoint: N × `PATCH /api/copies/:id`, `allSettled`. ⚠️ `arrivedPatch` also dates the copy, which the sibling does not — it dropped `acquired_on`; we kept it. Only when empty, so a known date is never overwritten. |
| ✅ | A card's series is a link | `6593a7e`. ⚠️ The card had to stop being a `<button>` first — an `<a>` inside one is invalid HTML. Title is now a stretched link; series sits above it on z-index. |

---

## Covers you can fix yourself, and one label — 2026-08-11

Three asks, one feature: *"this cover is not really the right cover, and I know
it."* Built on `worktree-agent-ab5f1d6d24c0a09ed`. Typecheck clean, **150 tests
pass (was 140)**, exercised end-to-end against a local D1 with the migration
applied — including the real Illumicrate URL, which fetched **198,624 bytes**.

| | What |
|---|---|
| ✅ | **`work.cover_status`** — `'ok'` / `'standin'` / NULL. ⚠️ NULL is *unassessed*, not *fine*. Migration `0040`, no CHECK (`gap_verdict.field`'s idiom). |
| ✅ | **"Cover needed"** on cards and the book page = no cover **or** a known stand-in. One rule, `coverNeeded` in `@lc/core`, shared by the mark and the SQL. |
| ✅ | **`work_watch`** — "needs my eyes, and here is why". Note required; resolved rather than deleted; `raised_how` is `decided_how`'s counterpart so a run can later flag its own guesses. |
| ✅ | **`Needs` filter** on the collection — *Cover needed* / *To check* / *Either*, with counts, in the URL like every other filter. |
| ✅ | **Cover panel** on the book page: link an image, mark it a stand-in, remove it, or upload a file. |
| ✅ | **Percy Jackson** — five works set to the Illumicrate lineup and flagged `standin`, by the migration. |
| ✅ | **#213 / #215** — both get a `work_watch` row explaining the contradiction, by the migration. |
| ⏸️ | **Uploading a file needs an R2 binding this Worker does not have.** The route is complete and answers **501** with a sentence naming what is missing; the UI hides the picker. |

### ⚠️ The R2 question, and why §7 does not forbid it

`wrangler.toml` and `docs/access/cloudflare.md` §7 say "no R2 bucket,
deliberately". **That decision is about scan photographs** — write-only objects
whose only purpose was to be deleted later. A cover is the opposite: read on
every page load, forever, and deleting it is the bug. Both rules now stand
side by side in §7, and §7.1 has the exact `wrangler r2 bucket create`,
custom-domain and Cache Rule steps. ⚠️ The `r2.dev` URL is rate-limited and
uncacheable — the custom domain is the whole point, as it is on the audiobook
catalog.

Nothing was half-wired: with no binding, every other part of the feature works.

### Run these — ⚠️ migration BEFORE deploy

```bash
# 1. Schema + the two data corrections, against production.
npx wrangler d1 migrations apply library-catalog --remote --config apps/worker/wrangler.toml

# 2. Then the code.
npm run deploy

# 3. Confirm. Expect enabled:false until the bucket exists — that is correct.
curl -s https://library.heygabi.ai/api/cover-storage
```

⚠️ **Migration `0040` carries data, exceptionally**: the five Percy Jackson
covers and the two watches. Both are guarded (`edition_name`, and id + title
together), so they write nothing in a database that does not hold those rows.
Applied and re-run locally to confirm the selector picks the right works.

## Every special edition in one bucket — 2026-08-11

The ask, in the owner's words: *"Let's normalize any edition to collectors
edition. Keep the original name on the visible listing but for our sanity all
editions should be collectors and we can fix them one off if needed."*

Built on `worktree-agent-a40181996e01c3a59`. Typecheck clean, **164 tests pass
(was 150)**, exercised end to end against a local D1 with migration `0050`
applied — the filter, the facets, `POST`/`PATCH /api/editions`, and the backfill
run twice to prove it is idempotent.

| | What |
|---|---|
| ✅ | **`edition.edition_kind`** — `'collectors'` or NULL. Migration **`0050`**, schema only, no CHECK (`gap_verdict.field`'s idiom). Partial index on the non-null side. |
| ✅ | **`edition_name` is untouched** and stays what every listing prints. The kind sits beside it; the book page shows both. |
| ✅ | **`classifyEdition`** in `@lc/core`, beside `suggestFormat` — the same reward prose, a different question. `suggestFormat('Deluxe Edition')` is null and `classifyEdition` is `'collectors'`, and both are right. |
| ✅ | **Printing filter** on the collection — *Collector's edition* / *Named, not sorted*, with counts, in the URL as `?kind=` like every other filter. |
| ✅ | **A select on the Editions panel**, so any row can be re-filed by hand. |
| ✅ | The shop-order and pledge-edition importers set it on insert. |

⚠️ **NULL means an ORDINARY printing here, NOT "unclassified"** — the opposite of
`cover_status` one table over, deliberately. 220 editions have no name and are
plain; filing them as unknown would mint 220 jobs nobody will do. The cost is
that an unrecognised special edition is filed as ordinary in silence, and the
thing that pays for it is the **"Named, not sorted"** filter: a special printing
is always *named*, so that two-row list is the whole risk surface. Do not remove
that control thinking it is a spare option.

### ⚠️ Three rows deliberately NOT swept in

- **"Omnibus - collects volumes 1-3"** and **"Volume 1"** — both *White Sand*.
  They describe **what is inside the book**, not how it was printed. White Sand
  is the original "alternate copies of stuff we already own" case the series
  restructure was built around. Left NULL; they are the "Named, not sorted" list.
- **"ebook"** — junk out of a reward name, on a row whose `format` is already
  `ebook_epub`. The backfill **clears the name**, guarded on the format.
- One extra: **"Book with sticker and bookmark tier"** is classified **by hand**
  in the script, because no honest keyword reaches it — a bookmark is not a
  binding, and adding 'sticker' to the rule would misfile the next
  paperback-with-a-freebie.

⚠️ **The brief's own figures do not reconcile** — it states 17 named rows across
13 distinct names, then enumerates 12 names whose counts sum to 19. So a
thirteenth name exists that has never been seen. **Read the dry run**; if it
lands under "leaving as an ORDINARY printing", that is a decision worth a look.

### Run these — ⚠️ migration BEFORE deploy

```bash
# 1. Schema only. No data in this one, unlike 0040.
npx wrangler d1 migrations apply library-catalog --remote --config apps/worker/wrangler.toml

# 2. Rehearse against production and READ THE THREE LISTS it prints.
npm run backfill:edition-kinds -- --remote

# 3. Apply. Confirms by re-reading the database, and fails loudly on bad arithmetic.
npm run backfill:edition-kinds -- --remote --commit

# 4. Then the code.
npm run deploy
```

## A rating means you read it — 2026-08-11

The ask: *"if a book has a rating from the audiobook library mark it as read"*,
refined to *"ratings should be for the logged in person"* and *"mark all copies
of a book read"*.

Built on `worktree-agent-afef029056ca7bdab`. Typecheck clean, **197 tests pass
(was 180)**, exercised end to end against a local D1 with migration `0070`
applied — the backfill run twice to prove idempotence, and the Worker's exact
statement sequence run by hand (see the note on `wrangler dev` below).

Full reasoning in **`docs/info/identity-and-reviews.md` §7**. The short version:

| | What |
|---|---|
| ✅ | **`user_book.read_state_how`** — `'human'` / `'rating'` / NULL. Migration **`0070`**, schema only, no CHECK (`gap_verdict.field`'s idiom). Partial index on the non-null side. |
| ✅ | **The derivation is in the BROWSER**, on the book page. The Worker cannot see Firestore — no service account, deliberately — so `Reviews.tsx` is the only thing in the estate that sees both stores. It posts what it read back to `POST /api/reviews/:workId/observed`. |
| ✅ | **`deriveReadState` in `@lc/core`** — one rule, three callers (Worker, browser, backfill). Never overrules `'human'`; never promotes a `dnf`; refines its own earlier answer; returns null for a no-op so a second run is free. |
| ✅ | **`setReadState` stamps `'human'` unconditionally.** That is the entire protection: touch the chips once and no sync can ever move it again. |
| ✅ | **`read_format = 'audio'`** from an audiobook review. The owner listens to far more than they read, so this is the main signal rather than a nicety. |
| ✅ | **`scripts/backfill-read-from-ratings.mjs`** — `npm run backfill:read-states`. Dry run by default. |
| ✅ | The book page prints *"Marked read from your audiobook rating"*, so nobody is told they asserted something they did not. |

### ⚠️ The multi-copy half needed no code, and here is why

Read state is `UNIQUE (work_id, user_id)` — it hangs off the **work**, not the
copy. Three `copy` rows of one work have always shared one read state. What
needed code is three copies that arrived as three *works*, and the fan-out for
that is by `work.work_key` (indexed, **not** unique), which is also the key the
reviews carry. Measured: **no `work_key` is shared by two work rows in
production today**, so it is correct in advance rather than after the fact.
It merges nothing and mints no `work_relation` — that stays with the
omnibus/`edition.collects` work.

### ⚠️ Three things found by running it

1. **All 869 review documents carry no `source`, no `workKey` and no `email`.**
   So reading `doc.source` would have derived 869 read states with **no format
   at all**. `reviewSourceOf` closes it: `reviewDocFor` always writes both
   `workKey` and `source`, so a document with neither cannot have come from
   here, and the only other writer is the audiobook site. The invariant that
   makes that sound is asserted in `core.test.ts`, not left as a comment.
2. **A live display defect.** `Reviews.tsx` rendered `r.source === 'audio' ?
   'audiobook' : 'this library'` — which labelled **every** audiobook review
   "this library", the one thing that component's own header says must never
   happen. Fixed by the same function.
3. ⚠️ **`wrangler dev` in a git worktree writes to the MAIN CHECKOUT**, and
   `--persist-to` does not override it. A worktree's `.git` is a file, so
   wrangler walks up past it and resolves `.wrangler/state` under
   `library_catalog/apps/worker/`. Symptom: the dev server served a stale
   116-work database and 500'd on `cover_status`. Only the local miniflare dev
   D1 was touched (gitignored, not production), and the run was stopped as soon
   as it was diagnosed. **`d1 execute --local --persist-to` IS honoured** — that
   is the pair, and it is why the same asymmetry is worth remembering.

### Staged — ⚠️ migration BEFORE deploy, and the backfill is the user's call

```bash
# 1. Schema only. No data in this one, unlike 0040.
npx wrangler d1 migrations apply library-catalog --remote --config apps/worker/wrangler.toml

# 2. Then the code.
npm run deploy

# 3. Rehearse against production. Reads only. READ THE SAMPLE LIST it prints.
#    ⚠️ LC_AUDIOBOOK_ROOT is NOT optional — see the trap below.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:read-states -- --remote

# 4. Apply. Confirms by re-reading the database and warns on bad arithmetic.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:read-states -- --remote --commit
```

**Dry run against production 2026-08-11 — nothing was written:**

| | |
|---|---|
| review documents | **869** (860 on 2026-08-09) |
| claimed by a signed-in person | **412** — Skylar 383, Amber Mitchell 29 |
| nobody in `app_user` claims | **457** — Samantha Hardman 225, Jamie Jeremiah Lievertz 213, Sparkling Ember 11, Solomon Hardman 8 |
| no derivable `workKey` | **0** |
| book not held here | **397** |
| **would mark read** | **15**, every one `read_format = 'audio'` |

The 15: all five Percy Jackson volumes, *Project Hail Mary* (for **both**
people), *Dungeon Born*, *Moonfall*, *Words of Radiance*, *Yumi and the
Nightmare Painter*, *The Wandering Inn*, and four others.

⚠️ **15 is the right answer, not a shortfall.** 397 of the 412 are audiobooks
with no print or ebook copy here — the household owns ~1,075 audiobooks against
231 works in this catalog. And most of the physical shelf is collection pieces
that were never meant to be read, so a blank read state there is correct.
**Nothing in this feature turns an unread physical book into a worklist, a badge
or a count** — the same trap `cover_status` NULL and `edition_kind` NULL were
each shaped to avoid.

⚠️ **Two zero-reads that look like answers**, both hit while building this and
both now fatal rather than tidy: the default `catalog.csv` path lands three
directories too deep in a worktree (first dry run: `0 distinct bookIds`, `no
derivable workKey: 412`), and `scripts/lib/d1.mjs` returned **0 works** against
a live 231 on one run and 231 a minute later — the flaky read `docs/TODO.md`
already records. The script exits on either.

### Worth running alongside, not required

`npm run backfill:reviews -- --commit` (the review-**key** backfill, written
2026-08-09 and still never run) stamps `workKey` **and** `source: 'audio'` onto
all 869. After it, the browser reads the audio signal from the field instead of
inferring it, and `fetchReviews` can eventually drop its legacy `bookId` query.
The two are independent and may run in either order.

## Staged, waiting on the user to run — 2026-08-10

All dry-run and verified against production. **Nothing below has been written.**
Every one needs `LC_AUDIOBOOK_ROOT` only where noted, and all are idempotent.

Run **in this order** — the first is free and the second deliberately skips what
the first fixes.

```bash
# 1. Lift 12 stranded edition covers onto their works. No network.
node scripts/backfill-work-covers.mjs --remote --commit

# 2. Fetch the 20 covers Google Books holds. ~2 min, free (keyed).
npm run backfill:missing-covers -- --remote --commit

# 3. Three asserted audiobook aliases: Tamer 9, Tamer 10, The Primal Hunter.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run seed:audiobook-aliases -- --remote --commit

# 4. Re-run the audiobook match so the Tamer fix and the aliases both land.
LC_AUDIOBOOK_ROOT=C:/Users/nbasl/OneDrive/Documents/vs-code-repos/bookbuddy/audiobook_catalog \
  npm run backfill:audiobooks -- --remote --commit
```

⚠️ **Step 4 rewrites `audiobook_holding`.** It marks the five wrong Tamer rows
and the wrong Primal Hunter row `stale_at` rather than deleting them (migration
0003's rule), and writes the correct rows for Tamer 7–10. Expect **six fewer
false claims** and the honest total to land near 45.

### Optional and **paid** — not run, gate separately

```bash
# ⚠️ COSTS MONEY. ~6c/book × 25 books ≈ $1.50, estimated from list prices.
npm run backfill:missing-covers -- --remote --llm            # dry run first
npm run backfill:missing-covers -- --remote --llm --commit
```

Yield is **unmeasured** — no sweep has been run. Every URL it proposes is fetched
and size-checked before it can be written, so the failure mode is "found
nothing", not "stored a dead link".

## Open work, not blocked

| | Item |
|---|---|
| 🔨 | **Keep GitHub current** — the user permits pushing straight to `main` while this site is pre-release, *provided a rollback id is recorded*. Contrast the board game catalog, which has real users now and where changes are "more damning". |
| 💤 | **Cross-project TODO page on heygabi.ai** — all projects, tagged one/some/all/landing. Explicitly deferred: "we will swap to it later". |
| 💤 | Gamefound — excluded, no books. |

---

## BackerKit import — RUN against production 2026-08-10

`npm run import:crowdfunding -- --remote --commit`. Written: **6 campaigns, 6
pledges, 4 reward lines across 4 books, 0 accessories.**

Per-pledge, verified by re-reading the database:

| Campaign | Account | Lines |
|---|---|---|
| Surprise! Four Secret Novels | acct 2 | **4** ✅ |
| Hoid's Storybook Collection | acct 1 | 0 |
| The Primal Hunter Deluxe Box | acct 1 | 0 |
| DCC: CROCODILE | acct 1 | 0 |
| Ascend Online: Legacy of the Fallen | acct 1 | 0 |
| Words of Radiance Leatherbound | acct 2 | 0 |

⚠️ **The five zeroes are the importer working as designed, not failing.** It
creates no `work` and no `edition`, because a campaign's spelling of a title is
exactly what mints a duplicate. Five books must be created by hand first, then
the import re-run — it is an idempotent upsert keyed on campaign `externalId`,
so a second run adds the missing lines without duplicating the six pledges.

Books to create: *Fires of December* (Sanderson), *The Primal Hunter* (Zogarth),
*Dungeon Crawler Carl: Crocodile* (Dinniman), *Ascend Online: Legacy of the
Fallen* (Chmilenko), *Words of Radiance* (Sanderson).

Kickstarter, Indiegogo and Barnes & Noble are **deliberately not in the input
file**. B&N is a shop, not a promise — `copy.vendor` covers it. Four Kickstarter
pledges are the same pledges as BackerKit account 2's, so *Four Secret Novels*
is recorded once, under `platform: kickstarter`.

## Purchase scan — staged

JSON lives in the session scratchpad and is **never committed** (it carries order
data). `scripts/crowdfunding-scan.json` is gitignored for the same reason.

| Source | State | Books |
|---|---|---|
| Barnes & Noble | ✅ | 7 importable, 1 cancelled skipped, **4 are preorders** |
| BackerKit acct 1 | ✅ | 4 pledges + 28 survey entries |
| Indiegogo | ✅ | Space Knight 5 and 6 |
| Kickstarter | ✅ | 15 pledges containing books |
| BackerKit acct 2 | ✅ | The games-heavy account. 3 books: **Words of Radiance Leatherbound** ($650, genuinely signed), **Surprise! Four Secret Novels** ($620, one line = four works), **Ascend Online Bk 1 Collector's** |
| Illumicrate | ✅ | One-off Percy Jackson set — do NOT scan the rest of that site |

⚠️ **The two BackerKit accounts and Kickstarter overlap.** *Four Secret Novels*,
*Ascend Online Book 1*, *An Unexpected Wedding Invitation* and *Coral Island*
appear in **both** the Kickstarter enumeration and BackerKit account 2 — same
pledges, campaign run on Kickstarter and fulfilled through BackerKit. Importing
both sources naively double-counts every one. The importer must match on campaign
`externalId`, and a pledge's `platform` should record where *our pledge* lives
separately from where the survey lives.

⚠️ **The BackerKit trap:** the Pledges tab showed 4 items; the Surveys tab showed
28. *Ascend Online* appears only under Surveys. Any BackerKit scan must read
`/c/users/active_projects` under **all three** filters, not just `/c/users/pledges`.

### Classification rules the user set

- **RPG and D&D material → board game catalog**, even bound hardcovers.
- **Graphic novels → library, but tagged.**
- **Audiobooks → not catalogued here.** Record that a pledge included one.
- **Mixed pledges must be split**, never collapsed.

### Shapes the model has to survive

One pledge routinely delivers ebook + print + audiobook. One line item can cover
several works ("Collector's Edition Trilogy" is three books). Signed/numbered
arrives as reward *prose*, not a field. High-value pledges are mostly
accessories — Primal Hunter is 1 book and ~23 pins, standees and plushies. Some
accessories are digital.

---

## Details queue emptied — 2026-08-10

**224 works · 3 still holding a gap · 0 findings pending.** Two passes, on branch
`feature/apply-pending-findings`.

| | Pass | Cost |
|---|---|---|
| ✅ | **162 findings that predate auto-apply, applied.** 61 works. Already bought and paid for by 61 past runs and simply never written down — this is what the owner was hand-clicking "use it" on. `scripts/apply-pending-findings.mjs` | **$0.00** |
| ✅ | **69 lookups run to clear what was left.** `scripts/research-queue.mjs`, 0 failed | **$1.11** (estimated $1.41) |

Research has now cost **$6.06** over 301 runs. Tokens only — Anthropic bills its
server-side web searches separately.

⚠️ **The count went UP before it went down, and that is the pipeline working.**
After the backlog landed, the queue read *66 works / 78 questions* — more
questions than before, of which **57 were volume numbers**. Filling in 32 series
names is what created them: `detailFieldsFor` refuses to ask "which volume is
this?" of a book with no series, so the question does not exist until the series
is known. The queue got **longer in count and shorter in kind**. Do not "fix" a
rising number here without reading which field it is in.

⚠️ **The page's own bulk button cannot finish this job**, and its count is
misleading rather than wrong. `outstanding` filters on `runs[workId] === undefined`
and `runs` is `latestRuns` — one row per work *ever* looked up. With 66 works
still owing an answer it offered **"Look up 5"**. The other 61 had been looked up
weeks earlier, before they had a series to be a volume of. The per-row button
reaches them; the script is that, unattended.

**Three works could not be identified and are deliberately left open** — the model
declined rather than guess, which is the behaviour we want: #141 *Touch and
Explore* (Scholastic), #160 *Bizzy Bear* (Nosy Crow), #174 *I love you, little
bear* (Judi Abbot). All three are bare series-line titles with no subtitle, ISBN
or year, where any match would attach another book's facts. Fix by adding the
subtitle, not by re-running.

**Everything is machine-decided and reversible.** All 311 values carry
`decided_how = 'auto'`, so `GET /api/research/auto-applied` lists them and
`POST /api/research/undo` takes them back, ten at a time. Nothing a person had
asserted was touched: `applyFinding` writes only into blanks, and the 162-finding
pass additionally refused any finding whose work+field already carried a
human verdict (zero did).

### Two things found by running it

- ⚠️ **`updateWork` rewrites `sort_title`, `primary_author` and `work_key` from
  title/authors on *every* update**, whatever the patch asked for. So a stored
  value that has drifted gets silently corrected by a write that only meant to
  fill in a year. Measured across all 224 works: `sort_title` disagreed on **5**
  (works 224–228, the crowdfunding-import ones, which kept their leading article
  and sort under "The"); `primary_author` and `work_key` disagreed on **none**.
  The five are now corrected. **`work_key` drifting would be the serious one** —
  it is the join to 860 audiobook reviews, so a silent rewrite moves a book's
  reviews instead of failing visibly.
- ⚠️ **Two books in one series ended up with two different series names.** #213
  *Secret Ingredient* is "The Pengrooms" vol 2; #215 *Pengrooms* is "Pringle &
  Finn" vol 1. Both findings cite a real source (the author's Kickstarter, and
  Goodreads' series page) and both are plausible — Paul Castle's series is
  indexed under both names. They cannot both be right in one catalog. Needs a
  person to pick one.

Every volume number written as a *value* (15 of them) carries a source URL and a
basis that names the page. None hedge. Checked on purpose: a wrong volume number
is worse than a blank, because a filled column is never re-asked.

---

## Browser verification sweep — 2026-08-10

The first real browser pass over everything five agent branches shipped. **Zero
console errors** across every screen. Verdicts:

**Works:** scan picker and its four tabs · queue newest-first · duplicate,
unresolved-barcode and SKU rows · Editions panel with two-click delete ·
accessories (23 rows with kind chips, quantity, DIGITAL tag) · crowdfunding
provenance · `WorkFields` in-place editing · series list search/sort/gaps ·
"Bought more than once" · Edition and Print/Ebook filters with recomputing
counts · details-queue auto-apply with per-row and bulk undo · Drive links
correct in both directions.

**Two correctness bugs found and fixed** (`6344cc4`, deployed `95af9fbd`):

1. ⚠️ **The series page asserted audio it had only guessed at.** Tamer read
   *"All 5 held as ebooks and on audio"* when all five matched the same generic
   series-level row by containment. The per-rung chip *does* hedge with a `?`,
   but that chip is suppressed when every rung agrees — and folding
   `matchedVia` away in `signatureOf` is what made them agree. Both the chip and
   the sentence were individually correct, which is why only a browser caught it.
2. ⚠️ **"All N held…" overstated.** The count came from the whole series while
   the signature behind it came from ladder rungs only, which exclude wishlist
   entries and off-number-line works. *The Completionist Chronicles* said "All 4
   … on audio" while the series list said 3. Now gated on the counts agreeing.

Also corrected: the "Type a title" blurb promised *"Looks the rest up as you
type"* over a tab that makes no such request, and contradicted itself by
promising "no code" when the only lookup offered is by ISBN.

**Still open from the sweep:**
- ⚠️ **Mobile is UNVERIFIED and cannot currently be verified.** `resize_window`
  returns `Successfully resized … to 390x844` and the viewport does not move —
  `read_page` reports it unchanged every time. Two separate agents hit this.
  **Distrust any mobile verdict from this tooling.**
- The route is **`/add`, not `/scan`**.
- Per-rung Print/Ebook/Audio chips have never actually rendered — every series
  in production has a uniform ladder, so they are suppressed by design.
- The preorder tag has never rendered either: zero preordered and zero wanted
  copies exist. It will first appear when the 4 B&N preorders are imported.
- Cosmetic: two stacked "Cancel" buttons in the accessories panel; an
  `UNCLASSIFIED` chip that is accurate but the only jargon in an otherwise
  plain-English panel.

## ✅ An omnibus is not an edition — done 2026-08-11, three parts

The user was holding off scanning any book that would hit the omnibus/duplicate
case — *"we're waiting to scan books that will meet this criteria until we
decide"* — so this was blocking real work, not tidying.

**One badge was answering three different questions.** Do I own the same
*object* twice (`copy`), the same *book* in two printings (`edition`), or the
same *text* via a bundle (two works and a `contains`)? Three tables, one badge.

### 1. ✅ The duplicate badge counts COPIES now

"Bought more than once" → **"Owned more than once"**, and the rule is 2+ copies
in `HELD_STATUSES`. `ownedMoreThanOnce` in `packages/core/src/holdings.ts`, with
tests; `boughtTwice()` in `@lc/db` is deleted.

⚠️ **Measured before changing it: the badge was firing on scan artifacts, and
nothing in the catalog is genuinely owned twice today.** *Dinosaur Dance!* is one
board book recorded twice by two scan paths; *Pout-Pout Fish* and *Grinch* have
two real ISBNs each and **zero copies**. The five ebook+hardcover works were
already excluded and stay excluded. Full table in
`docs/info/series-formats-and-audiobooks.md` §3.

The section therefore renders for **no series** until a real second copy exists.
That is the honest answer and not a regression.

### 2. ✅ White Sand: the omnibus fact recorded, no volumes invented

Migration **0060** adds `edition.collects` — *what is printed inside this
object*. `scripts/backfill-omnibus-collects.mjs` (dry-run by default) sets
edition 206 to `Volumes 1-3` and edition 107 to `Volume 1`, matched on the
edition name rather than the id.

⚠️ **No works and no `work_relation` rows were created, deliberately.** White
Sand's three volumes are not rows in this catalog, and minting them means
guessing three titles — `POST /api/works` does not dedupe, so a guessed title is
a *permanent* duplicate that collects its own copies and reviews. The honest
statement ("this printing has volumes 1-3 in it") is recorded now; the statement
that needs two rows waits until there are two rows, at which point the Related
panel makes it one tap. `edition_name` is untouched; the Editions panel now shows
and edits a **Contains** field beside it.

0050 predicted this exactly: *"If that axis is ever wanted it is a new column,
not a new value here."* 0060 is that column.

### 3. ✅ The overlap warning fires AT SCAN TIME

`work_relation.contains` is no longer display-only. Every scan line carries an
`overlap`, and the review screen raises **the prompt it already had for
duplicates** — one more reason, not a second mechanism:

- scan a volume whose omnibus is held → *"You already own this inside …"*
- scan the omnibus of a held volume → *"This collects …, which you already own."*

⚠️ **It does not block.** Same buttons as before: *Add* / *Add 2nd copy* /
*Leave it*. Owning volume 1 and the omnibus on purpose is a real choice.

Costs **one query** while `work_relation` is empty (which it is), because the
index short-circuits. Wishes are excluded — a wished-for omnibus produces no
warning. Both directions verified through a running Worker against a fixture.

## Known-imperfect, carried forward

- ⚠️ **Audiobook match rate is 19% — 43 of 224.** The rate fell because the
  catalog grew, not because matching got worse: matches went 42 → 43 while works
  went 219 → 224. Honest ceiling: ~35 misses are board books and 38 are
  fan-translated light novels with no English audio.
- ❌ **"Cradle is the group worth chasing" was wrong — retire it.** Searched all
  1,075 audiobook rows for every Cradle title (Unsouled, Soulsmith, Blackflame,
  Skysworn, Ghostwater, Underlord, Uncrowned, Wintersteel, Bloodline, Reaper,
  Dreadgod, Waybound) and for "cradle" anywhere in the file including
  descriptions: **zero hits**. Will Wight's only audiobooks here are *The Last
  Horizon* 1–3, which already match exactly. No alias can create a match for an
  audiobook the household does not own. Those 12 works are a genuine miss.
- ✅ **The five *Tamer* volumes are fixed.** Diagnosis: containment is a
  *substring* test, and our "Book 7" vs their "7" differ by a word in the middle,
  so the correct numbered row was never a candidate — only the series-level
  "Tamer: King of Dinosaurs" was. Fixed in `matching.ts` with a volume-marker
  fold plus a rule that containment may differ in words but never in numbers.
  Books 7 and 8 now match their own rows; 9 and 10 need the alias seed (the
  audiobook titles carry "Kickstarter Edition", 0.56 against a 0.6 floor); **11
  correctly matches nothing.** Same fix removed a second false positive: *The
  Primal Hunter* (book 1) had matched *The Primal Hunter 10*.
- ⚠️ **A false positive that was caught:** "An Unexpected Wedding Invitation (5e)"
  has add-ons literally labelled "(Book)" that are 5e modules. Would have
  polluted the library silently.
- ⚠️ **The top bar overflows at 360px** — pre-existing, found while measuring the
  arrivals panel. At a 356px viewport `Sign out` sits at `right: 414`, so the
  document scrolls sideways on every screen. The `@media (max-width: 26rem)` rule
  shrinks `.topbar__brand` and that is not enough. Deliberately **not** fixed
  here: the owner has asked that the header and nav stay identical to the board
  game catalog's, so it is a decision, not a tidy-up.
- **"Digitally signed" is not signed** — Illumicrate. Goes in `edition_notes`, per
  the user, not `copy.is_signed`.
- **The "Type a title" tab is unfinished** — its blurb promises lookup-as-you-type
  and there is no title-search endpoint behind it.
- **`work_relation` is live but empty.**
- **No browser verification** of the accessories panels, the undo UI, `WorkFields`,
  or the 390px phone layout of the series page.
- An agent killed 56 `workerd` processes with a blanket match while chasing a
  stuck port — restart any dev worker from around then.

---

## House rules that keep biting

- `git commit -F <file>`, never `-m`. PowerShell mangles quotes and em dashes.
- Migrate **before** deploying, so new code never meets an old schema.
- `packages/core` has a load-bearing import order — nothing under `src/` may
  import from `index.ts`. **Typecheck does not catch it.**
- Backfills must **confirm by re-reading the database**. `execute()` returns
  statements run, not rows changed. ⚠️ Worse: the read helper in
  `scripts/lib/d1.mjs` returned an **empty result** on one run and the script
  reported "nothing to do" over 99 live rows. A second run behaved.
- ⚠️ **Never pipe a long background job through `tail` or `grep`.** They buffer
  until exit, so a running job writes an empty log and looks dead. This cost
  real money: a cover run was judged dead and restarted, and **both copies then
  processed the full set — 36 paid lookups where 25 would have done, about 94c
  where ~60c was needed.** The `UPDATE … WHERE cover_url IS NULL` guard meant no
  data was harmed, and the script's own "that is not the arithmetic expected"
  warning is what exposed it. Redirect to a file and `tail` the file instead.
- ⚠️ **Two branches can add the same export and git will merge both silently.**
  `EDITION_MEDIA` was declared twice with no conflict marker; it surfaced only as
  `TS2451`. After any multi-branch merge, run typecheck *and* count the tests.
- ⚠️ **Check the test count after merging.** Expected arithmetic caught a real
  loss before: 91 → 95 → 105 → 118 → 134.
- Assign migration numbers with **wide gaps** when several agents run at once.
  Two agents were both told "0010 or higher" and both took it; one was already
  applied to production. Renumbered to `0020`/`0021`.
