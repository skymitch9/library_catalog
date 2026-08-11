# library_catalog — work log

> **Audience:** Claude sessions first, the user second. **Status:** TRACKED.
> Last verified: **2026-08-10**, against production.
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

Measured 2026-08-11 at the end of the overnight run, live version `b82ac811`:

| works | editions | copies | audiobook holdings | accessories | no cover | paperback |
|---|---|---|---|---|---|---|
| **224** | 227 | 108 | **46** live | 32 | **6** | **0** |

Overnight movement: covers **57 → 6**, details queue **78 questions → 7**,
audiobook holdings **40 → 46** with the false claims removed.

`/api/health` 200; `/api/series`, `/api/me`, `/api/crowdfunding` return 401
(auth) rather than 500.

⚠️ These numbers move *during* sessions — works went 120 → 140 → 162 → 214 in one
afternoon of scanning. Any figure here is a measurement with a timestamp, never a
constant. Re-measure before relying on one.

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

## ⚠️ Read this first: the run is finished

**Every actionable item on this list is done.** What is left in **Blocked**
below is blocked on the *user* — questions only they can answer about physical
objects in their house, or judgement calls about their own data. Nothing there
is waiting on more work, and re-running the tooling will not clear any of it.

Seven things want a human:

1. Confirm the Illumicrate Percy Jackson set is the 5-book original series.
2. Say what "+ Books" meant in the Words of Radiance tier — BackerKit holds no
   itemisation for that pledge at all.
3. Confirm the published title of the *Unstoppable* novel so it can be split out
   of the DCC RPG pledge.
4. Resolve *Secret Ingredient* vs *Pengrooms*, which claim contradictory series.
5. Give five reward lines a format — the hints name none, and `suggestFormat`
   rightly declined to guess.
6. Add subtitles to three board books so they become identifiable.
7. Decide whether the heygabi.ai `/todo` page should be public. It is built and
   pushed but **deliberately not deployed**.

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
