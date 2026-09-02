/**
 * One-off: rectify *The Wandering Inn*'s series-volume mapping (works 229–232).
 *
 * Owner, 2026-08-20: *"wandering inn needs to have its series and volumes
 * rectified because the author split the physical books."*
 *
 * ## The mapping, and where it is written down
 *
 * ⚠️ **Read `docs/info/serial-print-splits.md` before changing anything here.**
 * It carries the researched publication structure with its sources, the reason
 * the fractional scheme is `N` / `N.5` and not `N.1` / `N.2`, and the
 * `completeness.ts` arithmetic that decides it. This header is the summary.
 *
 * Harper Voyager's print line follows the ebook/audiobook **Book** numbering and
 * splits Books 1 and 2 into two paperbacks each (Books 3–19 are one each):
 *
 *   #229 The Wandering Inn   Book 1, Part 1  -> sort 1     (was 1.1)
 *   #230 No Killing Goblins  Book 1, Part 2  -> sort 1.5   (was NULL)
 *   #231 Fae and Fare        Book 2, Part 1  -> sort 2     (was NULL)
 *   #232 Immortal Games      Book 2, Part 2  -> sort 2.5   (was 4)
 *
 * Part 1 of Book N begins reading position N and takes the integer; Part 2 files
 * between N and N+1 and takes `N.5` — R5 and R9 of `docs/info/volume-numbers.md`,
 * applied. **No rule in that file changes; this is a mapping, not a design.**
 *
 * ## ⚠️ The bug this closes is arithmetic, not cosmetic
 *
 * `seriesCompleteness` scans the INTEGER line between the lowest and highest
 * position owned (`isPosition = Number.isInteger`). #232's `4` was the only
 * integer any of the four held, so the scan walked 1→4, found nothing at 1, 2 or
 * 3, and reported **three `earlier` gaps** — the strongest evidence class there
 * is — in a series where the household owns every printed book released. After
 * this, positions 1 and 2 are held and the scan produces nothing.
 *
 * #232's `4` was the print line's own sequential position (Amazon calls it "Book
 * 4 of 21"). That sequence diverges from the Book numbering permanently — it
 * would put *Flowers of Esthelm* at 5, colliding with Book 5 *The Last Light* —
 * so it is never the number to store. See §3.2 of the doc.
 *
 * ## The two gap_verdict rows
 *
 * #230 and #231 each carry `gap_verdict(field='seriesIndex', verdict='unknown')`
 * — *"somebody looked and nobody knows"*. Somebody now knows. `GAP_VERDICTS` in
 * `@lc/core` is explicit that there is deliberately no `found` verdict, because
 * *"a found value is written into the column it belongs in, and a verdict row
 * beside it would be a second copy of the same fact"* — so filling the column
 * and leaving the row would create exactly the contradiction that comment
 * forbids. Both rows are deleted, and each deletion is logged.
 *
 * They are logged as `entity='work'` with field `gap_verdict:seriesIndex`, NOT
 * as a new entity kind: `ChangeLogEntry.entity` is a four-value union in
 * `packages/db/src/changes.ts`, widening it is a typed change with a migration
 * note attached, and a correction script is not the place to do it. The fact is
 * a fact about the work either way.
 *
 * ## What this deliberately does NOT touch
 *
 *   * `work.multi_volume_printing` — R6 is HUMAN-ONLY and mechanically guarded.
 *     It may well belong on all four; that is the owner's checkbox, not this
 *     script's business. See §3.3 and §6 of the doc.
 *   * `edition.publisher`, which reads "Barnes & Noble" (the retailer) on all
 *     four rows where it should read "Harper Voyager". A real defect, a
 *     different one, and sweeping it in would make this batch unreviewable.
 *   * `work.title` / `work.authors` — those re-derive `work_key`, which is a
 *     migration and not a backfill (`scripts/lib/d1.mjs`).
 *
 * Same non-destructive shape as `scripts/fix-series-spelling-2026-08-15.mjs`:
 * every prior value lands in `change_log.old_json` before its UPDATE, with
 * `changed_by NULL, changed_how 'human'` — a person's decision (the owner's
 * word, plus researched publisher sources), executed by a script. Per R12 a
 * hand fill is never labelled `'auto'`; `'auto'` means a finding with a source
 * object behind it.
 *
 *   node scripts/fix-wandering-inn-volumes-2026-09-02.mjs --remote            # dry run
 *   node scripts/fix-wandering-inn-volumes-2026-09-02.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

const BATCH = 'fix-wandering-inn-volumes-2026-09-02';

/** The shared reason, so every one of the eight change_log rows carries it. */
const WHY =
  'The Wandering Inn print-split rectification, 2026-09-02 (owner 2026-08-20: ' +
  '"wandering inn needs to have its series and volumes rectified because the author ' +
  'split the physical books"). Harper Voyager\'s print line follows the ebook/audiobook ' +
  'BOOK numbering and splits Books 1 and 2 into two paperbacks each; Books 3-19 are one ' +
  'each. Part 1 of Book N begins reading position N and takes the integer, Part 2 files ' +
  'between N and N+1 and takes N.5 — volume-numbers.md R5 and R9 applied, no rule changed. ' +
  'Sources and the completeness.ts arithmetic that decides the scheme: docs/info/serial-print-splits.md.';

/**
 * One work, with every column this batch moves on it.
 *
 * `from` is asserted before anything is written. A row that has drifted since
 * this was researched stops the run rather than being overwritten — the same
 * refusal `fix-series-spelling-2026-08-15.mjs` makes, for the same reason.
 */
const EDITS = [
  {
    id: 229,
    designation: 'Book 1, Part 1',
    fields: {
      // 1.1 was an undocumented fractional scheme. Under it NO work here sits on
      // an integer, so the first source to attest Book 3 would make the range
      // scan claim positions 1 and 2 missing — books we own.
      series_index_sort: { from: 1.1, to: 1 },
    },
  },
  {
    id: 230,
    designation: 'Book 1, Part 2',
    fields: {
      series_index_sort: { from: null, to: 1.5 },
      series_index_display: { from: null, to: 'Book 1, Part 2' },
    },
  },
  {
    id: 231,
    designation: 'Book 2, Part 1',
    fields: {
      series_index_sort: { from: null, to: 2 },
      series_index_display: { from: null, to: 'Book 2, Part 1' },
    },
  },
  {
    id: 232,
    designation: 'Book 2, Part 2',
    fields: {
      // The print line's own sequential position, which is not the Book number.
      series_index_sort: { from: 4, to: 2.5 },
      series_index_display: { from: '4', to: 'Book 2, Part 2' },
    },
  },
];

/** The stale `unknown` verdicts, asserted by (work, field, verdict) rather than by id. */
const VERDICTS_TO_DROP = [
  { workId: 230, field: 'seriesIndex', verdict: 'unknown' },
  { workId: 231, field: 'seriesIndex', verdict: 'unknown' },
];

const ids = EDITS.map((e) => e.id);
const rows = q(
  `SELECT id, title, subtitle, series, series_index_sort, series_index_display
     FROM work WHERE id IN (${ids.join(',')})`,
);
if (rows.length !== ids.length) {
  throw new Error(
    `expected ${ids.length} works, found ${rows.length} — refusing to guess which changed since this was written`,
  );
}
const byId = new Map(rows.map((r) => [r.id, r]));

// The subtitle is this catalog's own independent copy of the publisher's
// designation (written by apply-bn-details.mjs from the retailer's product
// pages, 2026-08-11). Checking the mapping against it means a mis-typed edit
// here cannot quietly file a book under the wrong part.
const SUBTITLE_FORM = { 1: 'One', 2: 'Two' };
for (const edit of EDITS) {
  const row = byId.get(edit.id);
  const [, book, part] = edit.designation.match(/^Book (\d), Part (\d)$/);
  const expected = `Book ${SUBTITLE_FORM[book]}, Part ${SUBTITLE_FORM[part]} of The Wandering Inn Series`;
  if (row.subtitle !== expected) {
    throw new Error(
      `#${edit.id} subtitle is ${JSON.stringify(row.subtitle)}, but this script files it as ` +
        `${JSON.stringify(edit.designation)} and therefore expected ${JSON.stringify(expected)}. ` +
        'The mapping and the row disagree — stop and re-read docs/info/serial-print-splits.md.',
    );
  }
  if (row.series !== 'The Wandering Inn') {
    throw new Error(`#${edit.id} series is ${JSON.stringify(row.series)}, expected 'The Wandering Inn'`);
  }
}

const verdictRows = q(
  `SELECT id, work_id, field, verdict FROM gap_verdict
    WHERE work_id IN (${ids.join(',')}) AND field = 'seriesIndex'`,
);
for (const want of VERDICTS_TO_DROP) {
  const found = verdictRows.find((r) => r.work_id === want.workId && r.field === want.field);
  if (!found) {
    throw new Error(
      `expected a gap_verdict row for work #${want.workId} field ${want.field} and found none — ` +
        'it may already have been cleared; re-read production before re-running',
    );
  }
  if (found.verdict !== want.verdict) {
    throw new Error(
      `gap_verdict for work #${want.workId} reads ${JSON.stringify(found.verdict)}, expected ` +
        `${JSON.stringify(want.verdict)} — refusing to delete a verdict this script was not written against`,
    );
  }
  want.id = found.id;
}
const unexpected = verdictRows.filter((r) => !VERDICTS_TO_DROP.some((v) => v.workId === r.work_id));
if (unexpected.length) {
  throw new Error(
    `${unexpected.length} unexpected seriesIndex verdict(s) on works ` +
      `${unexpected.map((r) => '#' + r.work_id).join(', ')} — read them before running this`,
  );
}

console.log(`${flags.remote ? 'production' : 'local'}: ${EDITS.length} work(s), ${VERDICTS_TO_DROP.length} stale verdict(s)\n`);

const stmts = [];
for (const edit of EDITS) {
  const row = byId.get(edit.id);
  console.log(`  #${row.id} ${row.title} — ${edit.designation}`);
  const sets = [];
  for (const [field, move] of Object.entries(edit.fields)) {
    const current = row[field] ?? null;
    if (current !== move.from) {
      throw new Error(
        `#${edit.id} ${field} is ${JSON.stringify(current)}, expected ${JSON.stringify(move.from)} — ` +
          'refusing to overwrite a value this script was not written against',
      );
    }
    console.log(`      ${field} ${JSON.stringify(move.from)} -> ${JSON.stringify(move.to)}`);
    sets.push(`${field} = ${lit(move.to)}`);
    stmts.push(
      `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
        VALUES (${lit(BATCH)}, 'work', ${row.id}, ${lit(field)}, ${lit(JSON.stringify({ [field]: move.from }))}, ${lit(JSON.stringify({ [field]: move.to }))}, NULL, 'human', ${lit(WHY)});`,
    );
  }
  if (sets.length) {
    stmts.push(`UPDATE work SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ${row.id};`);
  }
  console.log('');
}

for (const v of VERDICTS_TO_DROP) {
  console.log(`  gap_verdict #${v.id} (work #${v.workId}, ${v.field} = '${v.verdict}') -> deleted`);
  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'work', ${v.workId}, ${lit('gap_verdict:' + v.field)}, ${lit(JSON.stringify({ verdict: v.verdict }))}, 'null', NULL, 'human', ${lit("The volume number is now known and is stored in series_index_sort, so this 'somebody looked and nobody knows' verdict is a second, contradicting copy of the same fact. GAP_VERDICTS has no 'found' value for exactly this reason. " + WHY)});`,
    `DELETE FROM gap_verdict WHERE id = ${v.id};`,
  );
}

console.log('');
if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, { remote: flags.remote });

// Confirm by re-reading. `execute` returns statements run, never rows changed —
// the local D1 does not report `meta.changes` at all, so a counter here would
// be a lie in exactly the direction that hides a no-op.
const after = q(
  `SELECT id, title, series_index_sort, series_index_display FROM work
    WHERE id IN (${ids.join(',')}) ORDER BY series_index_sort`,
);
console.log('\nAfter, in stored sort order:');
for (const row of after) {
  console.log(`  ${String(row.series_index_sort).padStart(4)}  #${row.id} ${row.title} — ${JSON.stringify(row.series_index_display)}`);
}

const wrong = [];
for (const edit of EDITS) {
  const row = after.find((r) => r.id === edit.id);
  for (const [field, move] of Object.entries(edit.fields)) {
    if ((row[field] ?? null) !== move.to) wrong.push(`#${edit.id} ${field} = ${JSON.stringify(row[field])}`);
  }
}
if (wrong.length) throw new Error(`${wrong.length} value(s) did not take: ${wrong.join('; ')}`);

const leftover = q(
  `SELECT id, work_id FROM gap_verdict WHERE work_id IN (${ids.join(',')}) AND field = 'seriesIndex'`,
);
if (leftover.length) throw new Error(`${leftover.length} seriesIndex verdict(s) survived the delete`);

console.log('\nOK: four volumes numbered 1 / 1.5 / 2 / 2.5, both stale verdicts cleared.');
