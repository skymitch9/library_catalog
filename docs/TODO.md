# library_catalog — work log

> **Audience:** Claude sessions first, the user second. **Status:** TRACKED.
> Last verified: **2026-08-11 late**, against production.
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

## Production right now

Measured **2026-08-11 late**, live version `8c8b4e76`:

| works | editions | copies | audiobook_holding | audio rungs | series_volume | accessories | no cover |
|---|---|---|---|---|---|---|---|
| **233** | 241 | 117 | **53** live | **134** live | **147** | 32 | **6** |

Movement since the overnight run: works 224 → 233, audiobook holdings 46 → 53,
and two tables that did not exist that morning — `audiobook_series_holding`
(134 rungs) and `series_volume` grown to 147 attested volumes across 20 series.
Audio corroboration: **17 series confident (`AUDIO`), 2 hedged (`AUDIO?`)**.

`/api/health` 200; authed routes return 401 rather than 500.

⚠️ **`work.universe` is populated on 0 of 233 rows.** Migration 0080 is applied
to production and the write path is live, but **`npm run backfill:universes --
--remote` has never been run**, so every existing row is still NULL and the
universe UI has nothing to show. Dry-run it first. This is the single largest
"built but not switched on" item in the repo.

⚠️ These numbers move *during* sessions — works went 120 → 140 → 162 → 214 in one
afternoon of scanning. Any figure here is a measurement with a timestamp, never a
constant. Re-measure before relying on one.

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

## ⚠️ Read this first — state at the end of 2026-08-11

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
| **#43 preorder-arrival prompt** | new ask, not started |
| **#37 editable audiobook listings** | largest remaining build; cheaper now the corrections layer exists |
| **#29** how duplicates count · **#30** B&N covers · **#31** rating ⇒ read | unchanged |

**Wants a human — nothing here is waiting on more work:**

1. Four universe verifications — Will Wight (Cradle, Last Horizon), Turncoat's
   Truth, Cultivating Chaos + The Axe Falls, Tailored Realities.
2. Say what "+ Books" meant in the Words of Radiance tier — BackerKit holds no
   itemisation for that pledge at all.
3. Confirm the published title of the *Unstoppable* novel so it can be split out
   of the DCC RPG pledge.
4. Resolve *Secret Ingredient* vs *Pengrooms*, which claim contradictory series.
5. Give five reward lines a format — the hints name none, and `suggestFormat`
   rightly declined to guess.
6. Add subtitles to three board books so they become identifiable.
7. Decide whether the heygabi.ai `/todo` page should be public. Built and pushed,
   **deliberately not deployed** — the user has since said to keep it private.
8. Paste four cover links for the books no rung can reach.
9. **Sign in to BackerKit as `nbaslamking@gmail.com`** so the second account can
   be scanned. `aim.com` is signed in and holds only Words of Radiance.

✅ Cleared today: the Illumicrate Percy Jackson set was confirmed *and*
independently verified against the campaign photo.

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
| ⏸️ | **Three books the model refused to identify** | #141 *Touch and Explore* (Scholastic), #160 *Bizzy Bear* (Nosy Crow), #174 *I love you, little bear* (Judi Abbot) — bare **series-line** titles, so a lookup returns the range rather than the book. All three have ISBNs and they did not resolve. Declining beat guessing. **Re-running will not help; a subtitle will** — e.g. *Bizzy Bear: Fire Rescue*. | User, from the covers |
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

### Result — **14 unrecorded book pledges**. Full report in the session scratchpad.

| account | coverage |
|---|---|
| Kickstarter | ✅ all 61 successful + 1 active, after clicking "Show more pledges" 5× |
| Indiegogo | ✅ complete — only 3 pledges exist; 2 are books |
| BackerKit `aim.com` — **Surveys** | ✅ Completed p1+p2, Active, Needs action, Digital rewards |
| BackerKit `aim.com` — **Pledges** | ✅ re-verified after re-auth: one pledge, **no pagination**. Gap closed |
| BackerKit `gmail.com` | ⚠️ not signed in, not scanned |

The finds: **Completionist Chronicles 1-5 in physical Grimoire editions** (the
*Ritualist* box has SHIPPED), **five Tamer pledges** — book 7's tier is "WHOLE
SERIES SIGNED PAPERBACKS", so 1-7 in print, not one book — **Beneath the
Dragoneye Moons Complete Realmkeeper Set** ($670, shipped), *Worlds Beyond
Number* graphic novel, *Monster Empire 2*, *Ascend Online Book 1*, and from
Indiegogo **Space Knight 5 and 6** — which is where the existing Space Knight
EPUBs came from, provenance never recorded.

⚠️ **Nothing has been written to the database.** The owner asked to verify first.

Four questions for the owner: is the **Cosmere RPG** ($465 "The Collector")
carrying books? How many books came in **Tamer 7's** whole-series tier, and in
the **Realmkeeper Set**? Do the Grimoire "Legendary Book Box" tiers hold two
books each or two plus extras?

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
