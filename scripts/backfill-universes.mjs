/**
 * Put every existing book in its universe, and re-run whenever the list grows.
 *
 * ## Why a backfill exists at all
 *
 * `createWork` resolves a universe for every book that arrives from now on
 * (migration 0080). This is the other half: the 224 works that were already here
 * when the column was added, and — the part that keeps mattering — the rows that
 * were resolved *before* the shared list knew about a universe they belong to.
 *
 * The list is hand-curated in `catalog-platform` and grows about monthly. Five
 * subjects are held out for the owner's verification right now (Will Wight,
 * Turncoat's Truth, Cultivating Chaos, The Axe Falls, Tailored Realities), and
 * the day any of them is approved, every book already in the catalog that
 * belongs to it is stale. That staleness is the *price* of storing the value
 * rather than recomputing it on read, and this script is what makes the price
 * bounded instead of permanent.
 *
 * ## ⚠️ What it will not touch
 *
 * **Any row where `universe_how = 'human'`.** That is a person's answer, and it
 * includes `universe IS NULL AND universe_how = 'human'` — somebody saying *this
 * book is in no verse*. Those two look identical to a query that reads only
 * `universe`, which is exactly why the `how` column exists and why this script
 * reads both. A backfill that could undo a correction is a bug with a schedule;
 * see the head of migration 0070, which makes the same argument for read states.
 *
 * Everything else is fair game: `'list'` rows re-resolve (that is the point), and
 * NULL rows are examined for the first time.
 *
 * ## ⚠️ It calls no model and no network
 *
 * `universeFor` against bundled JSON, the same function the add path uses, and
 * that is deliberate rather than a shortcut. A universe is invented by a person
 * through `catalog-platform/tools/universes.mjs`, which refuses an edit that
 * cannot say why it happened. A sweep over a catalog is not where one gets
 * invented — see `docs/info/universes.md`.
 *
 * ⚠️ Requires the platform checkout, like everything else that reads the list.
 * `node scripts/sync-universes.mjs` first if `generated/` is missing; it names
 * `CATALOG_PLATFORM_DIR` and every path it tried.
 *
 * ## Running it
 *
 *   npm run backfill:universes                            # dry run, local
 *   npm run backfill:universes -- --remote                # dry run, production
 *   npm run backfill:universes -- --remote --commit       # apply
 *
 * ⚠️ `tsx`, not `node` — it imports `@lc/universes` straight from TypeScript
 * source, the same way `backfill-edition-kinds.mjs` imports `@lc/core`.
 *
 * Idempotent: a second run with no change to the list writes nothing, because
 * every row already holds what the list says.
 */

import { universeIndex, universeOnUpdate } from '../packages/universes/src/index.ts';
import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const { commit, remote, limit, friend } = parseFlags();

/*
 * ⚠️ `universe_how` is selected, not just `universe`. Filtering the human rows
 * out in SQL would have been shorter and would have hidden them — and how many
 * rows a person has decided is worth printing every run, because it is the
 * number that says whether the guard is doing anything.
 */
const WORKS = `
  SELECT id, title, series, universe, universe_how AS how
    FROM work
   ORDER BY id
`;

const rows = query(WORKS, { remote, friend });

const changes = [];
const pinned = [];
let unchanged = 0;

for (const r of rows) {
  const current = { universe: r.universe ?? null, how: r.how ?? null };
  if (current.how === 'human') {
    pinned.push(r);
    continue;
  }
  const next = universeOnUpdate(universeIndex, current, {
    title: r.title,
    series: r.series ?? null,
  });
  if (next.universe === current.universe && next.how === current.how) {
    unchanged += 1;
    continue;
  }
  changes.push({ ...r, next });
}

const targets = Number.isFinite(limit) ? changes.slice(0, limit) : changes;

console.log(
  `\n${remote ? 'production' : 'local'}: ${rows.length} work(s); ` +
    `${unchanged} already correct, ${pinned.length} decided by a person`,
);

console.log(`\nwill set a universe (${targets.length}):`);
for (const r of targets) {
  const from = r.universe ? `${r.universe} → ` : '';
  const to = r.next.universe ?? '(none)';
  console.log(
    `  ${String(r.id).padStart(4)}  ${(from + to).padEnd(28)}${String(r.title).slice(0, 46).padEnd(48)}${String(r.series ?? '').slice(0, 24)}`,
  );
}

/*
 * ⚠️ Printed by name every run, never summarised away. These are the rows this
 * script deliberately refuses to touch, and "skipped silently" and "protected on
 * purpose" look identical in a log that does not list them. If one of these is
 * wrong, the fix is on the book page, not here.
 */
console.log(`\n⚠️ leaving alone — a person decided these (${pinned.length}):`);
for (const r of pinned) {
  console.log(
    `  ${String(r.id).padStart(4)}  ${(r.universe ?? '(no universe)').padEnd(28)}${String(r.title).slice(0, 46)}`,
  );
}

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.\n');
  process.exit(0);
}

const statements = targets.map(
  (r) =>
    `UPDATE work SET universe = ${lit(r.next.universe)}, universe_how = ${lit(r.next.how)}, ` +
    `updated_at = datetime('now') WHERE id = ${lit(r.id)} AND ` +
    // ⚠️ The guard is in the WHERE clause as well as in the loop above. The read
    // and the write are two round trips, and a person could answer on the book
    // page in between; this makes the race lose in the safe direction.
    `(universe_how IS NULL OR universe_how = 'list');`,
);

execute(statements, { remote, friend });

/*
 * ⚠️ Confirmed by re-reading, never by the writer's own count. `meta.changes` is
 * absent from the local D1's response entirely — see `execute` in lib/d1.mjs,
 * where a run that wrote 114 rows reported 0.
 */
const after = query(
  `SELECT universe_how AS how, COUNT(*) AS n FROM work
    WHERE universe IS NOT NULL OR universe_how IS NOT NULL
    GROUP BY universe_how`,
  { remote, friend },
);
console.log(`\nwrote ${statements.length} statement(s). Now stored:`);
for (const r of after) console.log(`  ${String(r.how ?? '(none)').padEnd(8)} ${r.n}`);
console.log();
