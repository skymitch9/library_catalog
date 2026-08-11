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

**214 works · 217 editions · 103 copies · 40 audiobook holdings · 0 paperback.**
Live version `86e453ed`. All of `/api/health` 200; `/api/series`, `/api/me`,
`/api/crowdfunding` return 401 (auth) rather than 500.

⚠️ These numbers move *during* sessions — works went 120 → 140 → 162 → 214 in one
afternoon of scanning. Any figure here is a measurement with a timestamp, never a
constant. Re-measure before relying on one.

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
| 2026-08-10 | `4d19ae4` (16 commits: five agent branches, covers, formats, work log) | **`c75d174`** | `86e453ed` |

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
| ⏸️ | **Two pledge manifests never itemised** | The Words of Radiance tier says "+ Books" plural plus Radiant/Backer Packs and does not list them; the four Secret Novels titles are inferred from the well-known set, not read off a page. | Claude — needs pledge detail pages |
| ⏸️ | **Kickstarter "DCC RPG + Unstoppable"** | Not on the Kickstarter account at all — 62 of 62 rows enumerated and it is absent. Almost certainly an Indiegogo pledge. | Claude — needs a second Indiegogo pass |
| ⏸️ | **10 reward lines have no printing** | Lines matched their works but no `edition` exists for the specific printing a campaign delivered, so they landed with `edition_id NULL`. The importer never mints an edition — by design. | Create the editions in the app, then re-run the import |
| ⏸️ | **Confirm the Percy Jackson set is the 5-book original series** | Imported, but the vendor page never lists the individual titles — the five are *supplied by Claude*, not read off the page. Low risk, still an assumption. | User, when awake |
| ⏸️ | **25 works have no cover the free rungs can reach** | Measured over 224 works: **57 blank**, of which 12 are stranded again (re-run `backfill-work-covers`), 20 are gettable from **Google Books**, and 25 are not. Of those 25, 13 have an ISBN neither database holds a cover for and 12 have no edition at all. The `--llm` rung is built; yield unmeasured, ~$1.50 for 25. | Claude — running overnight under the user's standing spend approval |

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

---

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
| 🔨 | **Mark as arrived, manually** — port from the board game catalog. 4 B&N preorders and most pledges are waiting on exactly this transition. |
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
- ⚠️ **Two branches can add the same export and git will merge both silently.**
  `EDITION_MEDIA` was declared twice with no conflict marker; it surfaced only as
  `TS2451`. After any multi-branch merge, run typecheck *and* count the tests.
- ⚠️ **Check the test count after merging.** Expected arithmetic caught a real
  loss before: 91 → 95 → 105 → 118 → 134.
- Assign migration numbers with **wide gaps** when several agents run at once.
  Two agents were both told "0010 or higher" and both took it; one was already
  applied to production. Renumbered to `0020`/`0021`.
