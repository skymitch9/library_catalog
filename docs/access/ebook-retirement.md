# Ebook split, phase 5 — retiring the ingest and the ebook rows

> **Audience:** the owner, and the Claude session standing beside him.
> **Status:** TRACKED. **Last verified: 2026-09-05** — every number on this page
> was **re-measured against production D1 that afternoon** (both instances), and
> the whole ceremony was **drilled end to end on a throwaway local D1 seeded
> from the remote catalog**: apply, then restore, returned all sixteen row
> counts to their starting values.
> ⚠️ **NOT verified, and it is the important one: the retirement has never been
> applied to either remote database.** Everything below is built and rehearsed;
> nothing has been removed. That step is the owner's, and this page exists so it
> is one command.
>
> Design of record: `catalog-platform/docs/info/ebook-split-design.md` §3 and §6.
> Work log: [`../TODO.md`](../TODO.md) → *Ebook split — PHASE 5*.

---

## 0. The one-paragraph version

Ebooks moved to **ebooks.heygabi.ai** in phases 1–4. What is left in this
catalog is residue: **86 works** that exist only because the 2026-08-09/10 ebook
import had nowhere else to put pool inventory, and **123 ebook editions**
representing files this catalog no longer speaks for. Phase 5 exports them to a
dated JSON (committed — it is the reversal path), removes them, and stops the
importer from putting them back by unsetting one secret. **padhard: 0 rows
matched — phase 5 is a no-op on the second instance**, except for the secret.

---

## 1. 🔴 Two things the design got wrong, both measured 2026-09-05

Read these before anything else. They are why this page exists rather than the
design's §6 row being followed as written.

### 1.1 The read-state precondition FAILS — it is 3, not 0

The design allows the works to be deleted only if **zero** `user_book` rows on
them are `read_state_how = 'human'`, and says outright: *"if it is nonzero at
execution time, re-measure and preserve those works"*.

| Work | Title | Typed |
|---|---|---|
| **358** | All The Skills: Book 2: A Deck-Building LitRPG | 2026-08-18 04:40:19 UTC |
| **359** | All The Skills: Book 4 | 2026-08-18 04:40:26 UTC |
| **360** | All The Skills: Book 6 | 2026-08-18 04:40:39 UTC |

⚠️ **They were typed fifteen minutes BEFORE the 04:55Z run whose figures
[`TODO.md`](../TODO.md) still quotes.** The reading was correct when taken about
the works it counted and stale about these three within the hour.

**So the committed export is the `--keep 358,359,360` one**, and a kept work
keeps **everything** — its row, its ebook editions, its holding. A read state
that says *"I read this"* about a work with no edition left is a worse record
than one carrying an ebook edition nothing serves any more.

🔴 **The owner's fork, and it is the only real decision on this page:**

| | What happens | How |
|---|---|---|
| **(a) keep them** — *recommended, and what is committed* | 86 works go, 3 stay as ebook-only works with their editions. The catalog keeps 3 rows it would otherwise not | already done — the committed export is this one |
| **(b) delete them too** | 89 works go; the three read states go with them and are **not derivable from anything** | he says so in writing, then re-run §4 step 1 **without** `--keep` and re-plan |

### 1.2 `--prune --force-prune` is now the WRONG instrument

The design's §6 row says to prune with `import-ebooks.mjs --prune`, whose
predicate is `source = 'file'`.

| | 2026-08-16 (design) | **2026-09-05 (measured)** |
|---|---|---|
| ebook editions total | 127 | **127** (unchanged — so no producer is still pointed here) |
| of those `source='file'` | **126** | **26** |
| `openlibrary` / `research` / `googlebooks` | 0 | **34 / 55 / 11** |

The **2026-08-20 details/ISBN sweep rewrote `edition.source`** on 101 of the
importer's own rows while leaving the manifest-relative path in `source_url`.
Same rows, same files, a different word in one column. **Running
`--force-prune` today would have removed 26 of 127 and reported success.**

⚠️ And the guard's *meaning* would have been abused even if the number were
right: the 20% ceiling exists to catch *"the manifest looks short"*. Phase 5
removes these rows because **the catalog no longer holds ebooks at all**, which
the manifest cannot tell you. So `import-ebooks.mjs` is left **exactly as it
is**, for the job it is actually for, and phase 5 has its own tooling below.

---

## 2. What phase 5 counts as an ebook row

| Term | Predicate | Main | padhard |
|---|---|---|---|
| **ebook edition** | `format IN` the five file formats `AND source_url IS NOT NULL` — a manifest-relative path is the importer's signature, and nothing rewrote it (measured: **0** ebook editions carry an `http…` url) | **126** | 0 |
| **ebook-only work** | has a non-physical edition · has **no** physical edition · has **no** copy — the same three tests as `EBOOK_ONLY_CLAUSE` in `packages/db/src/works.ts`, so the site's "Recently added" filter already hides exactly these | **89** (86 after `--keep`) | 0 |

**Never in scope, by predicate:**

- **anything physical** — `hardcover`, `paperback`, `mass_market`;
- **`ebook_kindle`** — an Amazon licence with no bytes on our side; there is no
  file for the ebooks site to have taken over (0 rows on either instance today);
- **hand-added ebook editions** — one exists on main (edition **318**,
  `source='manual'`, no `source_url`) and it is somebody's judgement, not the
  importer's output. `--include-manual` widens the predicate and says so on
  screen and in the export's header. **The committed export does not use it.**

---

## 3. What the numbers should become

Measured on production main, 2026-09-05, and re-measured by
`npm run ebooks:plan` every time it runs — the generated `.sql` carries its own
copy in its header.

| | before | after |
|---|---|---|
| `work` | 497 | **411** |
| `edition` | 568 | **445** |
| ebook editions | 126 | **3** (the kept works') |
| `ebook_holding` | 126 | **40** |
| `copy` | 449 | **449** — nothing physical is reachable |
| `change_log` | 1,644 | **1,644** — see §7 |
| `user_book` | 171 | 162 |

⚠️ **The catalog is live and these two numbers move.** `work` read **496** at
14:23 Phoenix and **497** at 15:17 the same afternoon; `edition` 567 → 568. The
figures above are the committed `.sql` header's (497/568), and the drill numbers
in §5 are the earlier snapshot's (496/567) because that is what the local mirror
was seeded from. Neither is wrong; both have a time.

**The rule this implies: regenerate the plan immediately before applying it.**
`ebooks:plan` re-measures, so a stale number on this page is cosmetic — a stale
number in the `.sql` header you are about to trust is not.

---

## 4. The ceremony — main instance

Every step is a command. Steps 1–3 change nothing.

### Step 1 — export (read-only)

```bash
npm run ebooks:export -- --remote --keep 358,359,360
```

Writes `docs/archive/ebook-rows-library-<date>.json`: the works, all ebook
editions, every dependent row from fifteen tables, and the `change_log` rows
about them. It re-measures the read-state precondition and prints it.

🔴 **COMMIT that file.** It is the reversal path, and step 3 refuses without it.

### Step 2 — plan

```bash
npm run ebooks:plan -- --from docs/archive/ebook-rows-library-2026-09-05.json --remote
```

Re-measures **five preconditions against the live database in this sitting** and
refuses on any failure, naming the rows:

| # | Check | Why it is here |
|---|---|---|
| 0 | every `work(id)` and `edition(id)` reference in the schema is on the allowlist | a sixteenth table with a `work_id` is a hole in the reversal path; an allowlist goes stale the day a migration lands |
| 1 | human-asserted read states on the listed works == 0 | §1.1 — a read state a person typed is derivable from nothing |
| 2 | every listed work is still ebook-only | a work that grew a physical edition or a copy since the export is somebody's book now |
| 3 | every listed edition still matches the export's own predicate | a row re-formatted or already gone means the reviewed list is not the live list |
| 4 | no row on a **surviving** work hangs off a listed edition | §7.2 — those rows are not in the export, so a restore would not bring them back |

Then it writes `docs/archive/ebook-retirement-library-<date>.sql` — plain,
chunked, commented SQL. **Nothing runs it.**

🔴 **READ IT.** That is the whole point of a file instead of a flag.

### Step 3 — apply (🔴 the owner's go/no-go)

```bash
npx wrangler d1 execute library-catalog --config apps/worker/wrangler.toml --remote --file docs/archive/ebook-retirement-library-2026-09-05.sql
```

Then check the counts against §3 (or the header of the file just applied).

### Step 4 — stop the ingest

```bash
npx wrangler secret list --config apps/worker/wrangler.toml               # names only
npx wrangler secret delete EBOOK_INGEST_TOKEN --config apps/worker/wrangler.toml
npx wrangler secret delete EBOOK_INGEST_TOKEN --config apps/worker/wrangler.toml --env friend
```

⚠️ **Both instances.** The token is one value with two holders (`SHARED_OPT_IN`
in `scripts/push-secrets.mjs`); the owner set it on padhard by hand on
2026-08-25, and until it is unset there her `/api/ingest/ebook` is a live door
even though she has no ebook rows.

⚠️ **A Worker secret cannot be read back**, so no script can verify this — it is
the one step nothing here can measure for you. What CAN be checked is the name
disappearing from `wrangler secret list`, and the route answering:

```bash
curl -s -D - -X POST https://library.heygabi.ai/api/ingest/ebook -H 'content-type: application/json' -d '{}' | head -20
```

⚠️ `-I` and `-o NUL` misreport on these hosts — use `-D -`. Expect **404**
`{"error":"ingest_disabled"}`.

✅ **Measured 2026-09-05 22:27 UTC, before any unset: both hosts answer 401** —
`library.heygabi.ai` and `padhard.heygabi.ai` alike. That is the proof the token
is live on **both** instances today and that step 4 has two halves. **401 → 404
is the whole verification of step 4**, and it is the only thing that can be
checked from outside, since a Worker secret cannot be read back.

Unset means *disabled*, not *open*: a 404 invites
less probing than a 401, and it is pinned by
`apps/worker/src/routes/capability-wiring.test.ts` (*"with EBOOK_INGEST_TOKEN
unset this must 404, never open"*), which passes today with no code change.

### Step 5 — padhard

**Nothing to remove.** Measured 2026-09-05: `library2` holds **0** ebook-only
works, **0** ebook editions, **0** `ebook_holding` rows. Her export is committed
anyway (`docs/archive/ebook-rows-library2-2026-09-05.json`) so the pair is on the
record, and `npm run ebooks:plan -- --friend` exits saying *"0 rows matched"*.
Her half of phase 5 is the secret unset in step 4.

### Step 6 — nothing to unschedule

⚠️ **`import-ebooks.mjs` is not scheduled anywhere.** Searched the whole estate
2026-09-05 — every repo, plus `schtasks /query`: there is **no** Task Scheduler
entry, **no** pipeline step in `audiobook_catalog`, **no** CI job. The only
invocation is a person typing `npm run import:ebooks`. So "stop running the
importer" is the secret unset in step 4 and this line saying so.

The **producer** side is untouched, exactly as design §7 requires: the audiobook
pipeline's step 1b keeps building `site/ebooks.json`, unconditionally. Only the
consumer retires.

---

## 5. Putting it back

```bash
npm run ebooks:export -- --restore docs/archive/ebook-rows-library-2026-09-05.json --commit --remote
```

Dry-run first by leaving `--commit` off. It re-reads afterwards and says how
many of the works and editions came back.

⚠️ **Every row is re-inserted with its ORIGINAL id**, which is why this is the
reversal path and not the design's stated one. Re-importing through
`/api/ingest/ebook` mints new ids, and fifteen tables join on the old ones —
`ebook_holding`, `user_book`, `research_finding`, `gap_verdict`,
`audiobook_edition_holding` and the rest would all come back pointing at works
that no longer wear those numbers. `INSERT OR IGNORE`, so a second restore is a
no-op.

### The drill, and what it measured

Rehearsed 2026-09-05 against a **throwaway** local D1 — `LC_D1_PERSIST_TO` set
to a scratch path so the developer's own local database was never touched —
migrated to `0460` and seeded with a faithful copy of the remote catalog (5,806
rows across 20 tables).

| | work | edition | ebook editions | ebook_holding | user_book | research_finding | change_log |
|---|---|---|---|---|---|---|---|
| before | 496 | 567 | 126 | 126 | 171 | 1,192 | 1,644 |
| after applying the `.sql` | **410** | **444** | **3** | **40** | 162 | 1,020 | **1,644** |
| after the restore | **496** | **567** | **126** | **126** | **171** | **1,192** | **1,644** |

All sixteen counters returned to their starting values, and a re-export of the
restored rows was **row-for-row identical** to the remote one across works,
editions and all fifteen dependent tables.

**Two real bugs were caught by the drill and fixed before anything shipped:**

1. the dependent-table list was in an order that violates
   `gap_verdict.run_id → research_run` on restore — the seed died on it;
2. nothing was checking the four columns that point at `edition(id)`. See §7.2.

---

## 6. ⚠️ After the retirement: do NOT run `npm run backfill:ebooks`

`scripts/backfill-ebook-holdings.mjs` derives `ebook_holding` **from
`edition`**, which phase 5 empties of ebooks. Its own header says so: *"After
phase 5 prunes the editions, this script's source is gone and the backfill must
learn to read `site/ebooks.json` and match the way the audiobook one does. That
is a widening of `derived_via` (a CHECK change — a decision, not a drift) and is
deliberately NOT built yet."*

It has a loud guard for the zero case, but the survivors are the danger: the
**40 holdings on works with physical presence** are the "we have this as an
ebook" chip on those work pages, and a post-phase-5 run would mark them
`stale_at`.

⚠️ **A second, quieter one that is true even today:** the backfill sets
`edition_source = 'file'` only when a deriving edition has `source='file'`, and
§1.2's sweep left only 26 that do. A re-run **now** would flip ~99 holdings from
`file` to `manual` — a silent provenance downgrade, not a data loss. The rows
were derived 2026-08-17, before the sweep, which is why they still read `file`.

---

## 7. What is deliberately left alone

### 7.1 `change_log`

The audit rows about these works and editions are **exported and not touched**.
They carry no foreign key to `work`, they are the record of what people did to
these rows, and an audit trail that disappears with its subject is not an audit
trail. Measured: **33** such rows in the committed export (57 in the variant
that also retires works 358–360), and `change_log` is 1,644 before and after.

### 7.2 The four columns that point at `edition(id)`

| Column | On delete | What it would do |
|---|---|---|
| `research_run.edition_id` | CASCADE | the run disappears with the edition |
| `research_finding.edition_id` | CASCADE | the finding disappears |
| `copy.edition_id` | SET NULL | a copy silently forgets which printing it is |
| `pledge_item.edition_id` | SET NULL | same, for a crowdfunding pledge line |

⚠️ **The export is keyed on the retired WORKS, so none of this is in it.** For
rows on works that are also going, it does not matter — they are exported by
work. For rows on the **36 ebook editions sitting on works that SURVIVE**, it
would be a hole in the reversal path.

Measured 2026-09-05: **all four are 0**. `plan-ebook-retirement.mjs`
precondition 4 re-measures and **refuses** rather than assuming, and precondition
0 refuses if a fifth such column ever appears.

### 7.3 The producer, Firestore, and padhard's ebook story

Design §7, unchanged: the Drive pipe, every pipeline step, the promote lanes,
Firestore (no rules deploy, no document writes — the 878 review docs are never
touched; the 7 docs on retired works keep working on the audiobook site, which
keys on `workKey`, not on any row id here), OpenAudible and `catalog.csv`.

---

## 8. The files

| Path | What |
|---|---|
| `scripts/lib/ebook-rows.mjs` | the predicates, both FK allowlists, both statement builders. **No top-level side effects** — it is a lib because the first draft had one CLI import the other, which *ran* it and silently overwrote a `--keep` export on the way to planning from it |
| `scripts/export-ebook-rows.mjs` | `npm run ebooks:export` — export (read-only) and `--restore` |
| `scripts/plan-ebook-retirement.mjs` | `npm run ebooks:plan` — the five preconditions and the `.sql` |
| `scripts/test/ebook-rows.test.mjs` | 41 tests, no database. Pins the predicates, the order and the two tripwires |
| `docs/archive/ebook-rows-library-2026-09-05.json` | 🔴 **the reversal path** — 86 works, 123 editions, 430 dependent rows |
| `docs/archive/ebook-rows-library2-2026-09-05.json` | padhard's, empty, on the record |
| `docs/archive/ebook-retirement-library-2026-09-05.sql` | what step 3 applies. Regenerate it if the export changes |

Related: [`second-instance.md`](second-instance.md) · [`secrets.md`](secrets.md)
(`EBOOK_INGEST_TOKEN` is `SHARED_OPT_IN`) · [`deploy.md`](deploy.md) —
⚠️ **phase 5 needs no deploy and no migration**: it is data and one secret.
