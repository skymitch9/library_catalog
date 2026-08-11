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
| ⏸️ | **Importing any purchase data** | Nothing is in D1 yet. The importer exists and the tables are live, but the input file `scripts/crowdfunding-scan.json` has not been written from the scraped JSON. **The user gates the `--commit`.** | User approves, Claude runs |
| ⏸️ | **Percy Jackson / Illumicrate** | Vendor page never lists the individual titles; the five standard titles are *supplied by Claude*, not read off the page. Confirm it is the 5-book original series. | User |
| ⏸️ | **12 works still have no cover from any source** | Not stranded — the backfill reports 0 stranded. Needs a genuinely different cover source. | Unassigned |

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

## Open work, not blocked

| | Item |
|---|---|
| 🔨 | **Mark as arrived, manually** — port from the board game catalog. 4 B&N preorders and most pledges are waiting on exactly this transition. |
| 🔨 | **Keep GitHub current** — the user permits pushing straight to `main` while this site is pre-release, *provided a rollback id is recorded*. Contrast the board game catalog, which has real users now and where changes are "more damning". |
| 💤 | **Cross-project TODO page on heygabi.ai** — all projects, tagged one/some/all/landing. Explicitly deferred: "we will swap to it later". |
| 💤 | Gamefound — excluded, no books. |

---

## Purchase scan — staged, not imported

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

## Known-imperfect, carried forward

- ⚠️ **Audiobook match rate is 25% — 40 of 157.** Honest ceiling: ~35 misses are
  board books, 38 are fan-translated light novels with no English audio. **Cradle
  is the group worth chasing** — 12 owned on audio, needs aliases.
- ⚠️ **All five *Tamer* volumes matched one generic audiobook row.** The catalog
  holds individual volumes 7–10, so the matcher preferred a series-level row.
  Book 11 probably has no audiobook. Renders as `AUDIO?`, so it reads as
  uncertain rather than asserted — still wrong.
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
