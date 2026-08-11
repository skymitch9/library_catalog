# library_catalog — work log

> **Audience:** Claude sessions first, the user second. **Status:** TRACKED.
> Last verified: **2026-08-10**.
>
> This is the living work log: what is in flight, what is blocked, and on whom.
> Stable facts live in `docs/access/` and `docs/info/`; current state lives here.
> Cross-link rather than duplicate.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Done and verified |
| 🚢 | Done and deployed to production |
| 🔨 | In flight right now |
| ⏸️ | Blocked — the blocker is named |
| 💤 | Deliberately deferred |

---

## Done this session

| | Item | Evidence |
|---|---|---|
| 🚢 | **Newest scanned book appears at the top of the queue** | Deployed `6732f331`. A sweep appends, so the book just scanned sat below the fold — the one you most want to confirm while it is still in your hand. ⚠️ The row/index pairing happens *before* the reverse: `index` is the array offset the server patches, so a display-order index would confirm the wrong book. |
| ✅ | **Covers reach the work, not just the edition** | Commit `74ddd86`. The add path created the work from `{title, authors}` alone while the edition beside it took `line.coverUrl`. Every list renders `work.cover_url`, so scanned books stored a good cover one table away and showed a blank tile. Not yet deployed — see blockers. |
| ✅ | **Stranded covers backfilled in production** | `scripts/backfill-work-covers.mjs`, commit `2c59196`. 35 works filled, **0 left stranded**, 150 works had a cover afterwards. Safe to re-run: fills empty covers only, never overwrites. |
| 🚢 | **Series restructure** | Merged, migrated (`0010_audiobook_holding`), deployed as `2995ff70`. Per-rung Print/Ebook/Audio chips, a "Bought more than once" section, and a searchable/sortable series list. 95 tests. Verified live: `/api/health` 200, `/api/series` 401 (auth, not 500). |
| ✅ | **Audiobook holdings backfilled** | `npm run backfill:audiobooks -- --remote --commit`. **40 holdings written**, confirmed by re-read. ⚠️ From a worktree this needs `LC_AUDIOBOOK_ROOT`; from the main checkout it does not. |
| 🚢 | **Format filter + preorder tag** | Commits `1fcf2c7`, `d887438` — merged with the above. Filter means **"has a physical edition"**, not "physical only", because a book held on the shelf *and* on the Kindle is the ordinary case and an exclusive filter would hide exactly those from both sides. Fixed a real bug: `stats.wanted` was summing `wanted + preordered` under one word. |
| 🚢 | **Editing an edition** | Merged and deployed as `d0a6c3ce`. `updateEditionSchema` had existed in `@lc/core` since day one with **no route, no query and no control**, so `edition.format` was effectively write-once. Now `PATCH`/`DELETE /api/editions/:id` + an Editions panel. 105 tests. ⚠️ `.partial()` on a schema with `.default()`s wraps them as `ZodOptional<ZodDefault<…>>`, so an absent key short-circuits and defaults never fire — without that, every one-field PATCH would have silently rewritten `source` to `manual`. Now under test. |
| ✅ | **Board books corrected to hardcover** | `scripts/fix-scanned-formats.mjs`. **99 editions** corrected; production is now 117 epub + 100 hardcover + **0 paperback**. Dated on purpose — this is not "all paperbacks are hardcovers"; real paperbacks are arriving from B&N. |
| 🚢 | **Drive links hidden for physical books** | Rule implemented: show only when the work has **at least one non-physical edition**. ⚠️ ISBN is deliberately *not* consulted — `edition.isbn13` is written back by every successful scan, so hiding on ISBN would eventually blank the links on the ~140 imported ebooks that are the only reason they exist. |
| ✅ | **Kickstarter enumerated in full** | 62 of 62 pledges (1 active + 61 successful). 15 contain library books, 45 board games, 2 neither, **8 mixed across catalogs**, 6 flagged ambiguous rather than guessed. |
| ✅ | **The "unclaimed" manager-role work is resolved** | It was the people/roles feature from earlier in the session. It committed itself as `a138019` + `c75d174`; main is clean and typechecks. Not a rogue agent. |

## In flight — five agents, parallel worktrees

| | Item | Notes |
|---|---|---|
| 🔨 | **Series restructure** | Owned + missing inside each series, ebook vs physical per rung, an *alternate copies* section (Target vs B&N editions), and audiobook ownership pulled across from the audiobook catalog. ⚠️ The Worker has **no runtime access** to audiobook data — needs a table + backfill, mirroring how `series_volume` already imports `source='audiobook_catalog'` rows. Also making the 27-series flat list scale. |
| 🔨 | **Accessories + crowdfunding provenance** | Plushies, pins, prints per book, full add/edit/delete. ⚠️ Count must **not** appear on the main page — book page only. Provenance must represent one campaign delivering **both** a physical and a digital edition without collapsing them. Includes an import script + documented JSON shape. |
| 🔨 | **Edition editing + Drive-link gating** | No edit-edition control exists anywhere today, which is how a hardcover got stuck as a paperback. Root cause: `catalog-add.ts` hardcodes `format: 'paperback'` for every barcode. Also: physical books should not show a Google Drive link — gate on the existing `PHYSICAL_FORMATS`, do not write a second list. |
| 🔨 | **Physical/ebook filter + preorder tag** | Format filter on the collection view. Plus a preorder tag ported from the board game site — ⚠️ no migration needed, `copy.status` already allows `'preordered'`. |
| 🔨 | **Automatic first-pass lookup** | Lookup currently has to be engaged by hand per line. The board game catalog always did the first pass automatically; port that rather than inventing one. Auto-*lookup* only — adding stays a human action, and a low `similarity` must still be carried honestly rather than enforced. |

## Blocked

| | Item | Blocker |
|---|---|---|
| ⏸️ | **Deploy of the cover fix and everything after it** | The **main checkout is dirty with work nobody has claimed** — an uncommitted `migrations/0008_manager_role.sql` plus edits to `capabilities.ts`, `constants.ts`, `PeoplePage.tsx`, `styles.css` adding a "manager" role. It is actively being written (files touched minutes apart) and causes two `PeoplePage.tsx` typecheck errors. `npm run deploy` refuses a dirty tree by design. **Do not commit it blindly and do not delete it.** |
| ⏸️ | **Kickstarter / Indiegogo / BackerKit ×2 scan** | Sign-in. Kickstarter is logged in as *Skylar M* but demands password re-verification; BackerKit and Indiegogo need a fresh login. Claude cannot enter credentials. The second BackerKit account needs the user to switch. |
| ⏸️ | **Barnes & Noble scan** | Logged in ✅. Extraction in progress — its order list already carries a `Preorder` status, which is what prompted the preorder tag. |

## Scan-path defects — one agent owns all four

All four share a root cause: **button gating treats "the system has no answer" as
"the user has no options."** Fixed together, not as four special cases.

| | Item | The user's words |
|---|---|---|
| 🔨 | **First lookup pass must be automatic** | *"we keep having to manually engage the lookup feature, in the board game project the first pass was always automatic"* |
| 🔨 | **A duplicate scan must offer a second copy** | *"instead of rejecting it right away, ask the user if they want to add another owned copy… its up to the end user to deal with duplicates not just the system"* — today `state === 'owned'` renders **zero** buttons, so the only route is to leave the scan page. |
| 🔨 | **An unresolved barcode must still be addable** | *"Some baby boardbooks are showing up with isbn numbers but when scanned they arent populating with a title or author. we need these to be able to still be added"* — `Look up` and `Edit` are gated on `via === 'spine'`, so a barcode line gets neither; `Add` is gated on `state === 'found'`. Dead row. |
| 🔨 | **SKU-only books** | *"some books have SKUs and not isbns, are these scannable to?"* — non-Bookland codes classify as `ignore/not_bookland` and are dropped. Question answered in the agent's report; treatment TBD. |

## Purchase scan — findings

Staged as JSON in the session scratchpad (never committed — it carries order
data). Nothing imported to D1 yet; the provenance model has to land first.

| Source | State | Books found |
|---|---|---|
| **Barnes & Noble** | ✅ Complete | 7 importable: 4× *The Wandering Inn* (paperback, 3 preordered), *Project Hail Mary* Deluxe, *Bad B\*tch in the Kitch*, *Sunrise on the Reaping* B&N Exclusive. 1 cancelled order skipped. |
| **BackerKit acct 1** | ✅ Complete | 4 pledges + 28 survey entries. Books: Hoid's Storybook Collection, Primal Hunter trilogy, DCC CROCODILE, *Ascend Online: Legacy of the Fallen*. |
| **Indiegogo** | ✅ Complete | *Space Knight* books 5 and 6, each bundling ebook + print + audiobook. |
| **Kickstarter** | 🔨 Delegated | 61 successful pledges, 10 rendered at a time. Agent enumerating all. |
| **BackerKit acct 2** | ⏸️ | Needs the user to switch logins. |
| Gamefound | 💤 | Excluded — the user says it holds no books. |

⚠️ **The Pledges tab showed 4 items; the Surveys tab showed 28.** *Ascend Online*
appears only under Surveys. Any future BackerKit scan must read
`/c/users/active_projects` under **all three** filters (Active / Needs action /
Completed), not just `/c/users/pledges`.

### Classification rules the user set (2026-08-10)

- **RPG and D&D material → board game catalog, not here** — even bound hardcovers.
  Affects Ryoko's Guide ($315), Starlight Arcana (€160), Cosmere RPG ($465),
  $1 One Shot.
- **Graphic novels → in the library, but tagged** so they don't distort series
  completeness for prose series.
- **Audiobooks → not categorised here.** Record that a pledge included one;
  the cross-catalog pull handles the rest. See the series work above.
- **Mixed pledges must be split**, never collapsed. *DCC RPG + Unstoppable* is an
  RPG (board games) bundled with a novel (library).

### Shapes the provenance model has to survive

- One pledge routinely delivers ebook **+** print **+** audiobook (Space Knight ×2,
  Tamer Bk 11, Fires of December).
- A single line item can cover several works — "Collector's Edition Trilogy" is
  three books.
- Signed/numbered status arrives as reward *text*, not a field → `copy.is_signed`.
- High-value pledges are mostly **accessories**: Primal Hunter is 1 book product
  and ~23 pins, standees, plushies and bookmarks.
- Some accessories are digital (an STL file, a concept-art PDF).

## Deferred

| | Item | Notes |
|---|---|---|
| 💤 | **Cross-project TODO page on heygabi.ai** | All projects, with tags for one project / some projects / all projects / the landing site. User's instruction: do it *after* categorising this project's todos — "we will swap to it later". Do not start early. |

## Known-imperfect, carried forward

- ⚠️ **Audiobook match rate is 25% — 40 of 157 works.** Honest ceiling: ~35 misses
  are children's board books and 38 are fan-translated light novels with no
  English audio. **The group worth chasing is Cradle** — 12 works owned on audio
  that need `work_alias` rows, not a looser matcher. 5 matches already come only
  through existing aliases.
- ⚠️ **The five *Tamer* volumes all matched the same generic audiobook row** by
  containment. The audiobook catalog does hold individual volumes (7, 8, 9, 10),
  so the matcher preferred a series-level row over the correct numbered one, and
  Book 11 probably has no audiobook at all. These render as `AUDIO?` with a
  tooltip rather than a flat claim, so the uncertainty is visible — but it is
  wrong and wants an alias fix.
- **"Digitally signed" is not signed.** The Illumicrate Percy Jackson set is
  digitally signed by Riordan; setting `copy.is_signed` would overstate it.
  Recommend `edition_notes`. Ask before importing.
- **Two multi-edition works now exist**, not one: *White Sand* and *Dinosaur
  Dance!*.
- **Format chips are hidden when every rung in a series matches**, replaced by one
  sentence, because all physical editions currently sit on works with no series.
  One condition in `SeriesDetailPage` reverses it.

- **12 works still have no cover at all** (of 162). These are books with no cover anywhere upstream, not stranded ones — the backfill reports 0 stranded. Needs a genuine second cover source, not another backfill.
- **Gamefound is explicitly excluded** from the purchase scan — the user says it has no books.
- **`work_relation` is live but empty** (0 rows); relationships are hand-entered.
- **Single-cover vision path has never been run against a real photo.**
- **The catalog is growing during sessions.** Work counts moved 120 → 140 → 162 in one afternoon of scanning. ⚠️ Any figure quoted here is a measurement with a timestamp, not a constant — re-measure before relying on one.

## House rules that keep biting

- Commit with `git commit -F <file>`, never `-m`. PowerShell mangles quotes and em dashes; the observed failure is `error: unknown option` with the commit silently not happening.
- Migrate before deploying, so new code never meets an old schema.
- `packages/core` has a load-bearing import order — nothing under `src/` may import from `index.ts`, or `z.enum()` receives `undefined` and every write endpoint 500s. **Typecheck does not catch it.**
- Backfills must **confirm by re-reading the database**. `execute()` returns statements run, not rows changed, and local D1 omits `meta.changes` entirely — a previous backfill reported "0 rows updated" over a run that had just written 114.
