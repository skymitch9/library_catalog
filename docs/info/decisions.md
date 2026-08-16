# Decisions and known limits — library_catalog   (Information Reference)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-16** — extracted verbatim from `docs/TODO.md`
> during the three-way split. The measurements inside carry their own dates
> and were **not** re-taken on that date.

Why things are the way they are — including things deliberately **not** built,
which are the easiest to accidentally "fix" later. Also the honest list of
what is imperfect and carried forward on purpose.

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

---

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

---

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
