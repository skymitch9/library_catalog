# Universes — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED. Wired 2026-08-11.
> Last verified: **2026-08-11**.

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

**Nothing surfaces universes in the UI yet** — that is a separate job. The one
live consumer is `/api/health`, which reports `{ count, schemaVersion }`. That
line exists so a missing or empty list is visible in one curl instead of months
later: a dependency nobody exercises is a dependency that breaks quietly.

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

## 7. Not verified

The universe list's `measured` notes all cite `audiobook_catalog/site/catalog.csv`.
**This repo's own rows were never queried** — they are in remote D1. The series
spelling `Cradle` in the Will Wight refusal is asserted from the owner's
wording, not observed here.
