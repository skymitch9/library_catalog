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

## Deferred

| | Item | Notes |
|---|---|---|
| 💤 | **Cross-project TODO page on heygabi.ai** | All projects, with tags for one project / some projects / all projects / the landing site. User's instruction: do it *after* categorising this project's todos — "we will swap to it later". Do not start early. |

## Known-imperfect, carried forward

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
