/**
 * Give work #250 *Space Knight Book 2* the one alias its audiobook needs.
 *
 * ## The recorded case this closes
 *
 * `docs/TODO.md` (bridge-retirement observations) and
 * `docs/access/index-worker.md` § *Bridge retirement* both record the same
 * index-AHEAD find from the 2026-08-14 proof run: work **#250 "Space Knight
 * Book 2" is a bridge MISS** — the shared index's raw-title fold join hits it,
 * while `backfill-audiobook-holdings.mjs` cannot. Prescribed fix, verbatim:
 * *"add a `work_alias` and re-run the holdings backfill."*
 *
 * ## Why the miss happens — measured 2026-08-14 against the live CSV
 *
 * The audiobook row is raw **"Space Knight, Book 2"** (series "Space Knight",
 * vol 2). `cleanTitleWithSeries` strips the ", Book 2" decoration, so the
 * indexed title is bare **"Space Knight"**. Our printed title "Space Knight
 * Book 2" then fails every rung of `matchIndexedWork`:
 *
 *   - exact / volume-fold: "space knight book 2" ≠ "space knight"
 *   - containment: substring yes, but `numbersAgree` rejects — {2} vs {} —
 *     which is CORRECT and must not be loosened (it is the gate that stopped
 *     "Tamer Book 11" claiming a nonexistent audiobook).
 *
 * So the fix is an alias, exactly as `add-audio-corroboration-aliases.mjs`
 * did for Onyx Storm: ask under the name the other catalog uses.
 *
 * ## Why the alias is the bare "Space Knight" and what was verified
 *
 * The only string that reaches the indexed row is one folding to
 * "space knight". Verified with the project's own matcher before writing:
 * `lookup("Space Knight", "Michael-Scott Earle")` answers **exact, sim 1.00,
 * raw "Space Knight, Book 2", vol 2** — the right volume. (Book 1's audiobook
 * also folds to "Space Knight"; the vol-2 row happens to sit first in the
 * index. If the CSV ever reorders, the worst case is #250's holding row
 * showing vol 1's cover — a display blemish, not a wrong ownership claim,
 * since both volumes are genuinely owned on audio.)
 *
 * ⚠️ Work #249 *Space Knight Book 1* has the same miss but is NOT aliased
 * here: the recorded intent names #250 only (it is the one the index sees),
 * and giving both works the same alias would point two works at one row.
 *
 * ⚠️ The alias is also a bare series name. That is already a handled shape:
 * `warnBareSeries` in `scan-jobs.ts` keys off the *resolved title*, not the
 * match route, so a future OL record titled bare "Space Knight" still gets
 * the tier-2 review-only warning.
 *
 * `source = 'manual'` per migration 0001: a person's researched answer, which
 * a re-import must never delete.
 *
 *   node scripts/add-space-knight-alias.mjs                   # dry run, local
 *   node scripts/add-space-knight-alias.mjs --remote --commit
 *
 * Then re-run `npm run backfill:audiobooks -- --remote --commit`, which is
 * what actually asks under the alias and writes the holding row.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();

const ENTRY = {
  workId: 250,
  expectTitle: 'Space Knight Book 2',
  alias: 'Space Knight',
  kind: 'title',
};

const q = (sql) => query(sql, { remote: flags.remote });

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database\n`);

const works = q(
  `SELECT id, title, authors, series, series_index_sort FROM work WHERE id = ${lit(ENTRY.workId)}`,
);
const w = works[0];

// ⚠️ Guard on the title, so a shifted id can never alias the wrong book.
if (!w) {
  console.log(`  ⚠️ work ${ENTRY.workId} does not exist — refusing`);
  process.exit(1);
}
if (w.title !== ENTRY.expectTitle) {
  console.log(`  ⚠️ work ${ENTRY.workId} is "${w.title}", expected "${ENTRY.expectTitle}" — refusing`);
  process.exit(1);
}

const existing = q(
  `SELECT id FROM work_alias WHERE work_id = ${lit(ENTRY.workId)} AND alias = ${lit(ENTRY.alias)} AND kind = ${lit(ENTRY.kind)}`,
);

console.log(`  work ${ENTRY.workId}  ${w.title}`);
console.log(`     ${w.authors} · ${w.series} vol ${w.series_index_sort}`);
console.log(`     + ${ENTRY.kind} alias "${ENTRY.alias}"  ${existing.length ? '(already present — nothing to do)' : ''}`);

if (existing.length) process.exit(0);

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(0);
}

execute(
  [
    `INSERT INTO work_alias (work_id, alias, kind, source) VALUES ` +
      `(${lit(ENTRY.workId)}, ${lit(ENTRY.alias)}, ${lit(ENTRY.kind)}, 'manual');`,
  ],
  { remote: flags.remote },
);

const after = q(
  `SELECT work_id, alias, kind, source FROM work_alias WHERE work_id = ${lit(ENTRY.workId)}`,
);
console.log('\nverified by re-reading:');
for (const r of after) console.log(`  work ${r.work_id}  "${r.alias}"  kind=${r.kind} source=${r.source}`);
const ok = after.some((r) => Number(r.work_id) === ENTRY.workId && r.alias === ENTRY.alias && r.kind === ENTRY.kind);
console.log(ok ? '\nAlias confirmed.\n' : '\n⚠️ Re-read does not match what was written.\n');
process.exit(ok ? 0 : 1);
