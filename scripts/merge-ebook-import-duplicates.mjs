/**
 * Merge the 13 duplicate works the 2026-08-14 ebook import minted.
 *
 * The first full manifest import (18 works created) ran before the ingest
 * route had its alias / series-prefix fallbacks, and 13 of the 18 are existing
 * books under a different OPF spelling. Two classes, verified against
 * production row by row:
 *
 *   - **Series prefix** (4): OPF says "Beneath the Dragoneye Moons: Immortal
 *     War", the catalog holds "Immortal War" with the series in its own
 *     column. The new edition is a genuinely new file (the owner's new loose
 *     EPUBs) → REPARENTED to the kept work.
 *   - **Old title left behind by a rename** (9): the eight "- MM" titles were
 *     stripped from works 39/40/41/78–82 on 2026-08-12 (strip-mm-suffix.mjs —
 *     a deliberate key move), and the White Sand omnibus EPUB re-read its OPF.
 *     Every one of these editions points at THE SAME FILE the kept work
 *     already holds → edition DELETED, not reparented (reparenting would put
 *     two rows of one file on one work). The OPF spelling is recorded as a
 *     `work_alias` (kind 'title') on the kept work, so the ingest route's
 *     alias fallback attaches future re-imports instead of re-minting.
 *
 * The four series-prefix works get NO alias on purpose: the route's
 * series-prefix fallback is the durable mechanism there (it also covers BtDEM
 * volumes that do not exist yet), and the import dry-run probe proving those
 * rows attach through it is the regression test for the whole class.
 *
 * ## The proven pattern (merge-284-into-291, merge-299-into-333, 2026-08-13)
 *
 *   - KEEP the existing work — it carries audiobook holdings, Realmkeeper
 *     hardcover editions, review-join history. The day-old duplicate dies.
 *   - Whole rows land in `change_log` as `__row__` undo material BEFORE the
 *     mutation, batch_id `merge-<dup>-into-<keep>`, changed_how 'human'.
 *   - Children are dealt with BEFORE the work row is deleted, in the same
 *     batch — one `--file` per merge, and a file is atomic in D1.
 *   - Counts verified by re-reading afterwards, never trusted from meta.
 *
 * Every pair is verified against live rows before anything is built: the dup
 * must still look exactly like the import left it (one file edition, no
 * copies, no read states, no aliases, no relations, no holdings), and the
 * keep must hold / not hold the file as the action expects. Any surprise
 * refuses that pair loudly.
 *
 *   node scripts/merge-ebook-import-duplicates.mjs --remote            # dry run
 *   node scripts/merge-ebook-import-duplicates.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

/**
 * dup: the work the import minted. keep: the existing work.
 * action 'reparent' moves the dup's edition to keep; 'delete' drops it as a
 * duplicate row of a file keep already holds. alias: OPF title to record on
 * keep (delete-class only — see header).
 */
const PAIRS = [
  { dup: 361, keep: 262, action: 'reparent', class: 'series-prefix' },
  { dup: 362, keep: 261, action: 'reparent', class: 'series-prefix' },
  { dup: 363, keep: 260, action: 'reparent', class: 'series-prefix' },
  { dup: 364, keep: 259, action: 'reparent', class: 'series-prefix' },
  { dup: 365, keep: 90, action: 'delete', class: 'stale-title', alias: true },
  { dup: 366, keep: 39, action: 'delete', class: 'stale-title', alias: true },
  { dup: 367, keep: 40, action: 'delete', class: 'stale-title', alias: true },
  { dup: 368, keep: 41, action: 'delete', class: 'stale-title', alias: true },
  { dup: 369, keep: 78, action: 'delete', class: 'stale-title', alias: true },
  { dup: 370, keep: 79, action: 'delete', class: 'stale-title', alias: true },
  { dup: 371, keep: 80, action: 'delete', class: 'stale-title', alias: true },
  { dup: 372, keep: 81, action: 'delete', class: 'stale-title', alias: true },
  { dup: 373, keep: 82, action: 'delete', class: 'stale-title', alias: true },
];

const ids = PAIRS.flatMap((p) => [p.dup, p.keep]);
const workRows = q(`SELECT * FROM work WHERE id IN (${ids.join(',')})`);
const editionRows = q(`SELECT * FROM edition WHERE work_id IN (${ids.join(',')})`);
const childCounts = q(
  `SELECT w.id,
          (SELECT COUNT(*) FROM copy c WHERE c.work_id = w.id) copies,
          (SELECT COUNT(*) FROM user_book ub WHERE ub.work_id = w.id) user_books,
          (SELECT COUNT(*) FROM work_alias a WHERE a.work_id = w.id) aliases,
          (SELECT COUNT(*) FROM work_relation r WHERE r.from_work_id = w.id OR r.to_work_id = w.id) relations,
          (SELECT COUNT(*) FROM audiobook_holding h WHERE h.work_id = w.id) holdings,
          (SELECT COUNT(*) FROM work_watch ww WHERE ww.work_id = w.id) watches
     FROM work w WHERE w.id IN (${PAIRS.map((p) => p.dup).join(',')})`,
);

const workById = new Map(workRows.map((r) => [Number(r.id), r]));
const editionsByWork = new Map();
for (const e of editionRows) {
  const list = editionsByWork.get(Number(e.work_id)) ?? [];
  list.push(e);
  editionsByWork.set(Number(e.work_id), list);
}
const countsById = new Map(childCounts.map((r) => [Number(r.id), r]));

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database — verifying ${PAIRS.length} pair(s)\n`);

const plans = [];
const refused = [];
for (const p of PAIRS) {
  const dup = workById.get(p.dup);
  const keep = workById.get(p.keep);
  const refuse = (why) => refused.push({ p, why });

  if (!dup) { refuse('duplicate work is gone (already merged?)'); continue; }
  if (!keep) { refuse('kept work not found'); continue; }

  // The dup must look exactly like the import left it: one file edition,
  // nothing a person has touched. Anything else means the world moved.
  const c = countsById.get(p.dup) ?? {};
  const dirty = ['copies', 'user_books', 'aliases', 'relations', 'holdings', 'watches']
    .filter((k) => Number(c[k]) > 0);
  if (dirty.length) { refuse(`dup carries ${dirty.join(', ')} — not the untouched import row`); continue; }

  const dupEds = editionsByWork.get(p.dup) ?? [];
  if (dupEds.length !== 1) { refuse(`dup has ${dupEds.length} edition(s), expected exactly 1`); continue; }
  const ed = dupEds[0];
  if (ed.source !== 'file' || !ed.source_url) { refuse(`dup edition ${ed.id} is not a file edition`); continue; }

  const keepEds = editionsByWork.get(p.keep) ?? [];
  const sameFile = keepEds.find((e) => e.source_url === ed.source_url);
  if (p.action === 'delete' && !sameFile) {
    refuse(`keep #${p.keep} does not hold ${ed.source_url} — expected a duplicate file row`);
    continue;
  }
  if (p.action === 'reparent' && sameFile) {
    refuse(`keep #${p.keep} ALREADY holds ${ed.source_url} — reparent would duplicate it`);
    continue;
  }

  plans.push({ ...p, dupRow: dup, keepRow: keep, edition: ed, sameFile });
}

for (const pl of plans) {
  console.log(
    `  #${pl.dup} "${pl.dupRow.title}"  ->  #${pl.keep} "${pl.keepRow.title}"` +
      `\n      edition ${pl.edition.id} (${pl.edition.source_url})` +
      (pl.action === 'reparent'
        ? `  REPARENT -> work #${pl.keep}`
        : `  DELETE (same file as edition ${pl.sameFile.id})`) +
      (pl.alias ? `\n      alias on #${pl.keep}: "${pl.dupRow.title}" (title)` : ''),
  );
}
for (const r of refused) console.log(`  ⚠️ REFUSED  #${r.p.dup} -> #${r.p.keep}: ${r.why}`);

console.log(`\n${plans.length} merge(s) planned, ${refused.length} refused`);
if (!flags.commit) { console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n'); process.exit(refused.length ? 1 : 0); }
if (refused.length) { console.log('\nREFUSING to commit while any pair fails verification.\n'); process.exit(1); }

const before = q('SELECT (SELECT COUNT(*) FROM work) works, (SELECT COUNT(*) FROM edition) editions, (SELECT COUNT(*) FROM work_alias) aliases')[0];

for (const pl of plans) {
  const batch = `merge-${pl.dup}-into-${pl.keep}`;
  const stmts = [];
  const log = (entity, entityId, field, oldJson, newJson, note) =>
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
     VALUES (${lit(batch)}, ${lit(entity)}, ${entityId}, ${lit(field)}, ${lit(oldJson)}, ${lit(newJson)}, NULL, 'human', ${lit(note)});`;

  const workNote =
    pl.class === 'series-prefix'
      ? `Merged into #${pl.keep} ("${pl.keepRow.title}"). The OPF title carries the series prefix the catalog's title keeps in its own column; the 2026-08-14 ebook import minted this duplicate before the ingest route's series-prefix fallback existed. Ebook edition ${pl.edition.id} reparented to #${pl.keep}. Full row kept as undo material.`
      : `Merged into #${pl.keep} ("${pl.keepRow.title}"). This OPF title was removed from #${pl.keep} by the 2026-08-12 rename (strip-mm-suffix / omnibus retitle), so the 2026-08-14 import re-minted it as a new work. Its edition ${pl.edition.id} pointed at the same file #${pl.keep} already holds as edition ${pl.sameFile?.id} and was deleted; the OPF title is recorded as a title alias on #${pl.keep} so the ingest alias fallback attaches future imports. Full row kept as undo material.`;

  // Undo material first, mutations after — one batch, atomic per --file.
  stmts.push(log('work', pl.dup, '__row__', JSON.stringify(pl.dupRow), 'null', workNote));

  if (pl.action === 'reparent') {
    stmts.push(
      log('edition', pl.edition.id, 'work_id', String(pl.dup), String(pl.keep),
        `merge: reparented from duplicate work #${pl.dup} to #${pl.keep}`),
      `UPDATE edition SET work_id = ${pl.keep}, updated_at = datetime('now')
        WHERE id = ${pl.edition.id} AND work_id = ${pl.dup};`,
    );
  } else {
    stmts.push(
      log('edition', pl.edition.id, '__row__', JSON.stringify(pl.edition), 'null',
        `merge: duplicate of edition ${pl.sameFile.id} on work #${pl.keep} (same source_url); its work #${pl.dup} merged away`),
      `DELETE FROM edition WHERE id = ${pl.edition.id} AND work_id = ${pl.dup};`,
    );
  }

  if (pl.alias) {
    stmts.push(
      `INSERT OR IGNORE INTO work_alias (work_id, alias, kind, source)
        VALUES (${pl.keep}, ${lit(pl.dupRow.title)}, 'title', 'manual');`,
    );
  }

  stmts.push(`DELETE FROM work WHERE id = ${pl.dup};`);

  execute(stmts, { remote: flags.remote });
  console.log(`  merged #${pl.dup} -> #${pl.keep}  [${batch}]`);
}

// Confirm by re-reading — execute() reports statements run, not rows changed.
const after = q('SELECT (SELECT COUNT(*) FROM work) works, (SELECT COUNT(*) FROM edition) editions, (SELECT COUNT(*) FROM work_alias) aliases')[0];
const leftover = q(`SELECT id FROM work WHERE id IN (${plans.map((p) => p.dup).join(',')})`);
const reparented = q(
  `SELECT id, work_id FROM edition WHERE id IN (${plans.filter((p) => p.action === 'reparent').map((p) => p.edition.id).join(',')})`,
);
const aliasRows = q(
  `SELECT work_id, alias FROM work_alias WHERE work_id IN (${plans.filter((p) => p.alias).map((p) => p.keep).join(',')}) AND kind = 'title'`,
);

console.log(`\nworks:    ${before.works} -> ${after.works}   (expected ${before.works - plans.length})`);
console.log(`editions: ${before.editions} -> ${after.editions}   (expected ${before.editions - plans.filter((p) => p.action === 'delete').length})`);
console.log(`aliases:  ${before.aliases} -> ${after.aliases}   (expected ${before.aliases + plans.filter((p) => p.alias).length})`);
console.log(`duplicate works remaining: ${leftover.length} (expected 0)`);
for (const e of reparented) {
  const pl = plans.find((p) => p.edition.id === Number(e.id));
  const ok = pl && Number(e.work_id) === pl.keep;
  console.log(`  edition ${e.id} now on work #${e.work_id} ${ok ? 'OK' : '⚠️ WRONG'}`);
}
console.log(`title aliases present on kept works: ${aliasRows.length}`);

const good =
  Number(after.works) === Number(before.works) - plans.length &&
  Number(after.editions) === Number(before.editions) - plans.filter((p) => p.action === 'delete').length &&
  leftover.length === 0 &&
  reparented.every((e) => plans.find((p) => p.edition.id === Number(e.id))?.keep === Number(e.work_id));
console.log(good ? '\nAll merges confirmed.\n' : '\n⚠️ Verification mismatch — read the numbers above.\n');
process.exit(good ? 0 : 1);
