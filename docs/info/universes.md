# Universes — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED. Wired 2026-08-11,
> surfaced in the UI the same day. Single-writer contract measured and guarded
> 2026-08-17 (§7).
> Last verified: **2026-08-17**.

⚠️ **The data is not in this repo.** It lives at
`catalog-platform/data/universes.json`. This file is about how *this* repo gets
at it, and what happens when it cannot. The decisions themselves — why a file
and not a table, the resolution order, the editor — are in
`catalog-platform/docs/UNIVERSES.md`.

## 1. Why it left

It was `library_catalog/data/universes.json` until 2026-08-11, and that
directory no longer exists. It was never library data:

- keyed on **series + author**, which both catalogs can compute;
- the same series exists in both collections under different rows, often in only
  one of them;
- `audiobook_catalog` is a **Python static build** with no route to D1, so this
  repo could never have been the source even if the table idea had won.

**Do not recreate a copy here.** Two copies of a decision list is exactly the
drift the move prevents.

## 2. ⚠️ catalog-platform is a BUILD DEPENDENCY now

Not documentation. `npm run build`, `npm test` and `npm run typecheck` each run
`scripts/sync-universes.mjs` first (`prebuild` / `pretest` / `pretypecheck`), and
that script **exits 1** if it cannot find the platform checkout.

| | |
|---|---|
| Resolution | `CATALOG_PLATFORM_DIR` → else `../catalog-platform`, `../../catalog-platform`, `../../../catalog-platform` from the repo root |
| Confirms it | The candidate must actually contain `data/universes.json` |
| On failure | Prints every path it tried and both shells' syntax for the env var, then exits 1 |
| Code | `scripts/lib/platform-repo.mjs` |

### Why failing the build is the right choice here

A Worker bundled with an empty universe list answers "no universe" to every
question, forever, and looks like a data problem. That is discovered months
later, by a wrong answer.

⚠️ **`audiobook_catalog` makes the OPPOSITE choice on purpose** — a loud `[WARN]`
and the build continues. Its pipeline runs unattended three times a day and must
not die over reference data, which is the same rule its corrections layer
already follows. Two different answers to the same question, each right for its
own failure mode. Do not "fix" one to match the other.

## 3. The generated copy is a build artifact

`packages/universes/generated/` is **gitignored** and rewritten on every build,
test and typecheck. It exists because a bundler needs a **static path** and
`../../catalog-platform/...` is only correct for one checkout layout —
resolution happens once, in JavaScript that can explain itself.

⚠️ **Editing `generated/universes.json` is lost work.** The next build overwrites
it silently. The editor is `node tools/universes.mjs` in the platform repo, and
it refuses an edit that cannot say why it happened.

A test asserts the generated copy is **byte-identical** to the source, so a
stale copy fails rather than passing quietly.

## 4. Using it

```ts
import { universeFor, universeIndex, membersOf, universesDocument } from '@lc/universes';

universeFor(universeIndex, { title: 'Fires of December', series: '' }); // 'The Cosmere'
membersOf(universesDocument, 'The Cosmere');                            // { series, titles }
```

`@lc/universes` is the **only** package here that depends on another repo, and
it is alone on purpose. `@lc/core` promises *"no I/O — safe to import anywhere"*;
a build-generated file with cross-repo provenance does not belong inside that
promise. `grep -r '@lc/universes'` finds every consumer.

`/api/health` reports `{ count, schemaVersion }`. That line exists so a missing
or empty list is visible in one curl instead of months later: a dependency
nobody exercises is a dependency that breaks quietly.

### 4.1 Books are filed on the way in — migration 0080

`work.universe` and `work.universe_how`, **derived on write in
`packages/db/src/works.ts`** beside `work_key` and `sort_title` — not in the add
path. Five callers create works (scan, manual Add, series-gap wishlist,
`/api/ingest`, `POST /api/works`) and the owner asked for *when a book enters*;
doing it in `catalog-add.ts` would have answered one of the five.

| | |
|---|---|
| Deciding | `universeFor` — **the** lookup, never reimplemented |
| Storing | `universeOnCreate` / `universeOnUpdate` / `universeAsserted` in `packages/universes/src/assign.ts` |
| Cost | one Map lookup against bundled JSON. No network. ⚠️ **Never a model** |
| Second format of a held book | **zero lookups** — an ebook, an audiobook and a paperback are editions of one `work`, which already carries the answer |
| Re-resolving when the list grows | `npm run backfill:universes` |

⚠️ **`assign.ts` has no Python twin, and that is correct.** Only `lookup.ts` is
the cross-repo contract (§5). Storage provenance is a question only a database
has, and the audiobook side is a static build with no rows to stamp.

⚠️ **`universe_how = 'human'` is never overwritten, including with a NULL
universe** — that pair is a person saying *in no verse*, and without the `how`
column the next title edit would silently put the list's opinion back over it.
The backfill guards on it twice: in the loop and in the `WHERE` clause.

⚠️ **A miss stores `{ null, null }`, not a stamped `'list'` miss.** Most books
are in no universe; that is the ordinary case and never a queue.

### 4.2 The runtime consumers, 2026-08-11

| Consumer | Reads |
|---|---|
| `apps/worker/src/lib/universes.ts` | the only place the list meets this catalog's rows — every route goes through it |
| `routes/catalog.ts` | `?universe=` on `/collection`, the `universes` key on `/collection/facets`, and `universe` on `GET /works/:id` |
| `routes/universes.ts` | `GET /api/universes/:name` — one world, everything held from it |
| `routes/health.ts` | the count and schema version |

⚠️ **No universe is ever resolved in SQL, and that is the point.** `@lc/db`
exposes `listUniverseKeys`, which returns `(id, title, series)` for the rows the
rest of the filter allows; the caller runs them through `universeFor` and hands
back ids, which become an inlined `w.id IN (…)` clause. So the filter, the facet
count and the page all come out of the one implementation. A WHERE clause
matching series names and titles would be a **third** implementation of §5's
contract, in a third language — exactly the shape of the
`resolve_author_link` / `_resolveAuthorFolder` bug this estate already shipped.

⚠️ `@lc/db` deliberately does **not** import `@lc/universes`. Keeping the join in
the worker is what stops a cross-repo build dependency sitting behind every
query in the app; the facets route spreads `collectionFacets`' object and adds
one key.

### ⚠️ Nothing renders the absence of a universe

Most books are in none and that is correct — **13 of 116 works** resolve. No
badge, no dash, no "not in a universe" filter option and no count of the
remainder exists anywhere in the UI. Adding one would turn a shelf of correctly
filed picture books into a worklist. Same reading as a NULL `cover_status`
("nobody looked") and a NULL `edition_kind` ("ordinary").

⚠️ **That 13-of-116 is a stale local snapshot, not production.** It was measured
in an agent worktree against a copied D1 that was several migrations behind, and
before `npm run backfill:universes` had ever run against real data. Re-measure
after the backfill before quoting it anywhere.

## 5. ⚠️ The lookup exists twice

`packages/universes/src/lookup.ts` (TypeScript) and
`audiobook_catalog/app/core/universes.py` (Python) must give the same answer.
There is no shared runtime between a Cloudflare Worker and a Python static
build, so there is no shared implementation.

`catalog-platform/data/universes.fixtures.json` is the contract, and **both**
repos run it — the mechanism `PLATFORM.md` §5.3 prescribes. This estate has
already shipped this class of bug once: `resolve_author_link` (Python) and
`_resolveAuthorFolder` (JS) split author strings identically until they did not,
and a promote failed **silently**.

Change the resolution order in one and you change it in: the other, the
fixtures, and `_lookup.order` in the data file.

## 6. Traps

| Trap | Detail |
|---|---|
| ⚠️ **`normaliseUniverseText` is not `normaliseTitle`** | `@lc/core`'s version strips leading articles and produces **stored keys** — `work.work_key`, Firestore document ids — so changing it is a migration. This one compares against a hand-written list where `The Cosmere` and `Cosmere` are deliberately different strings, and it writes nothing. Using either for the other's job is a bug |
| ⚠️ **The curly apostrophe** | `The Frugal Wizard’s Handbook…` is stored with U+2019 and is the single exclusion proving series-keying cannot work. A lookup that does not fold it gets that one row wrong and nothing else |
| **Titles match exactly** | Never prefix, never substring — that would make `Elantris` match `The Hope of Elantris`. The known cost is in the fixtures' `_knownGaps` |
| **Importing the platform lib by absolute path** | Node's ESM loader rejects `C:/…` as an unknown URL scheme. Use `pathToFileURL()`; `platformPaths().libUrl` already does |
| **A new workspace package needs `npm install`** | `@lc/universes` is not resolvable until npm links it |

## 7. ⚠️ The SINGLE-WRITER contract — one list, two instances

> Added 2026-08-17, from the owner's ask: *"I don't want duplicate universes."*
> Everything in this section is measured against the two live databases on that
> date; the numbers are readings, not constants.

### 7.1 The two halves that get confused

|  | The LIST | An ASSIGNMENT |
|---|---|---|
| Question | which universes exist, and how each is spelled | which universe *this instance's* work #41 is in |
| Lives in | `catalog-platform/data/universes.json` — **one writer, another repo** | `work.universe` / `work.universe_how` (migration 0080) |
| Reaches this repo by | `scripts/sync-universes.mjs` at build time → `packages/universes/generated/` → the bundle | nothing; it is written here, by this instance |
| Same on both instances? | **Always. By construction** | **No, legitimately** — different libraries hold different books |
| May be a D1 table? | ⚠️ **Never** | It already is (two columns on `work`) |

An assignment is keyed **by name** to the list. That is the whole join, and it
is why the list can move without a migration and the assignments can differ
without a conflict.

### 7.2 What the suspected duplication actually was — nothing

The report was that each library D1 carried its own seeded universe rows, and
that Samantha's fresh instance "got 16 universes at creation". Measured against
both live databases, 2026-08-17:

| | main `library-catalog` | friend `library-catalog-2nd` |
|---|---|---|
| tables matching `%universe%` | **0** | **0** |
| `/api/health` `universes.count` | 16 | 16 |
| works | 351 | 0 |
| stamped `work.universe` | 61, across 12 names | 0 |
| stored names **not** in the canonical 16 | **0** | — |
| stored names **disagreeing** with the current list | **0** | — |
| NULL rows the current list **would** resolve | **0** | — |
| `universe_how = 'human'` | 1 | 0 |

**There is no second writer and there never was one.** The 16 both instances
report is `universeNames.length` — the length of the *bundled* list, not a row
count. Both answer 16 because both run the same bundle over the same file.
Migration 0080 refused to create a universe table, deliberately and at length,
and no migration since has added one.

⚠️ So the fix was **not** a deletion or a sync step — there was nothing to
delete and nothing to reconcile. What was missing was *enforcement*: the
contract was upheld everywhere and guarded nowhere, held by prose in three
files. The estate's own rule is that a rule which matters gets promoted from
prose to a script.

### 7.3 The guard — `packages/core/test/universes-single-writer.test.ts`

Runs in `npm test`. Sixteen assertions in four groups:

| Group | Fails when |
|---|---|
| **No second registry** | any migration `CREATE TABLE`s a name matching `universe`, or `INSERT`s into one |
| **No resolution in SQL** | `listUniverseKeys` stops selecting exactly `(id, title, series)`, or any `packages/db` query filters on a universe **name** |
| **A new universe needs no migration** | a 17th universe added to the *document* fails to resolve by series, by title override, in the facet tally, or by URL alias — proving the path is data-only |
| **One bundle, two instances** | `wrangler.toml` grows a second `main`, the two `migrations_dir` values diverge, or `/api/health` stops deriving its count from `universeNames.length` |

Two traps that shaped it, both found by exercising it rather than reading it:

- ⚠️ **The migration guard parses statements, not text.** 0080 and 0004 discuss
  universe tables *in comments* precisely to explain why they do not create one.
  A raw grep fires on the explanation, and a guard that must be deleted to get a
  green suite is a guard that gets deleted. `statementsOf()` strips comments
  first; one assertion exists solely to prove 0080 still passes.
- ⚠️ **`universe IN ('The Cosmere')` slipped through the first regex** — it
  caught `= ?` and `LIKE ?` but not the parenthesis before the quote, which is
  the exact form a hand-written registry query takes. Probed against synthetic
  violations, not reviewed.

Verified by probe, 2026-08-17: a scratch migration creating `universe` and
seeding two names failed exactly the two registry assertions and nothing else.

### 7.4 How a new universe reaches both instances

No migration, no per-instance step, no hand-edit of any list in this repo:

1. add it in catalog-platform via `node tools/universes.mjs` (it refuses an edit
   that cannot say why);
2. here: `npm test` → `sync-universes.mjs` rewrites `generated/`. ⚠️ **The pinned
   list in `universes.test.ts` fails, on purpose** — that is a decision landing,
   not an obstacle, and it is not a migration;
3. `npm run deploy` **and** `npm run deploy:friend` — the list travels in the
   bundle, so an instance that is not redeployed keeps the old list. **That is
   the only real drift vector left, and it is a deploy-lag, not two writers.**
   `/api/health` on each host is how you see it;
4. re-resolve existing rows with `npm run backfill:universes` per instance —
   optional, and it never touches a `universe_how = 'human'` row.

⚠️ **Renames are the case to think about.** The list can rename a universe; rows
stamped with the old name would then be orphans, and an orphan name is what a
"duplicate universe" would actually look like here. Nothing renames stored
assignments automatically. Measured today: **0 orphans on both instances.** If a
rename ever lands upstream, run the backfill on both instances after deploying —
the stored name is machine-decided (`'list'`) for 60 of the 61 stamped rows, so
the backfill is the whole fix.

## 8. Not verified

The universe list's `measured` notes all cite `audiobook_catalog/site/catalog.csv`.
The series spelling `Cradle` in the Will Wight refusal is asserted from the
owner's wording, not observed here.

⚠️ **The local 2026-08-11 snapshot that stood here (116 works, 13 resolving) is
superseded — it was measured in an agent worktree against a copied D1 several
migrations behind, and before the backfill had ever run.** Replaced with
PRODUCTION figures, 2026-08-17, `library-catalog` remote:

| | production main, 2026-08-17 |
|---|---|
| works | 351 |
| stamped with a universe | 61 |
| Willverse | 15 |
| CAL Verse | 12 |
| The Cosmere | 11 |
| Dungeon Crawler Carl | 6 · Riordanverse 5 · Innworld 4 |
| Disney · Star Wars | 2 each |
| Cytoverse · Maasverse · Marvel · Reckoners | 1 each |
| Solaria · Runnerverse · Alliances · Middle-earth | 0 |

The friend instance holds **0 works**, so every figure there is zero and nothing
about it is evidence yet.

⚠️ **`npm run backfill:universes -- --remote` has evidently run on main since**
— docs/TODO.md carried "5 of 258, the backfill has never been run" and the rows
now say otherwise. What the rows *cannot* say is whether the backfill or the
ordinary `createWork`/`updateWork` traffic stamped them; both write
`universe_how = 'list'` and neither leaves a mark. Not verified, and not worth a
column to find out.

The Cosmere split recorded in the old snapshot is still worth keeping: some of
its books have **no series value**, and the server's series sort interleaves
them alphabetically rather than grouping them — which is why `UniversePage`
groups by key and not by consecutive runs.

⚠️ **Still not verified:** nothing has been rendered at 360px —
`resize_window` reports success without resizing on this machine, so the phone
layout rests on the new controls reusing `.field`, `.controls--filters` and
`.stat-strip` unchanged, not on an observation. Nor has any universe page been
opened in a browser on either host; §7's figures come from D1 and
`/api/health`, which is the API's answer and not the UI's.
