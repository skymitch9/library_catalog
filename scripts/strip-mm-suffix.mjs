/**
 * Strip the stray `- MM` suffix from eight Beneath the Dragoneye Moons titles.
 *
 * The owner spotted it, 2026-08-12. Eight of the sixteen Dragoneye works read
 * *"Oathbound Healer - MM"*, *"Under Ashen Skies- MM"* (no space — they were not
 * even applied consistently). It rode in from the EPUBs' INTERNAL metadata: the
 * filenames are clean, e.g. `BtDEM 1 Oathbound Healer - Selkie Myth.epub`.
 *
 * ## ⚠️ This is a migration, not an edit — and that is why it is a script
 *
 * `title` derives `work_key`, which is the bridge to the sibling audiobook
 * catalog and to Firestore review documents. Unlike the title-case pass earlier
 * today, this is NOT case-only: `oathbound healer mm|selkie myth` becomes
 * `oathbound healer|selkie myth`. The key genuinely moves.
 *
 * **Checked before writing, and this is what makes it safe:**
 *
 *   user_book       0 on all eight  -> no rating, no read state, so no Firestore
 *                                      review document can be orphaned
 *   audiobook_holding  1 each       -> keyed on work_id, NOT work_key. Survives
 *   work_alias         0            -> nothing aliased to the old spelling
 *   work_relation      0            -> no containment or companion links
 *
 * `work_key` also lives in exactly one place — one column and one index on
 * `work` (migration 0001). No other table stores it as a foreign key.
 *
 * ⚠️ Had `user_book` been non-zero for any row, the right move would have been
 * a `work_alias` carrying the old title instead, exactly as the two audio
 * corroboration aliases did — never a silent rename.
 *
 * ## What it deliberately does not do
 *
 * Only the suffix goes. `Phoenix Peaks` stays `Phoenix Peaks` even though the
 * audiobook catalog calls it *The* Phoenix Peaks — that is a different question
 * and a second key move, and bundling it here would hide it.
 *
 *   node scripts/strip-mm-suffix.mjs                 # dry run
 *   node scripts/strip-mm-suffix.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote });

/** Trailing " - MM", "- MM", " MM" and nothing else. Anchored to the end. */
const MM = /\s*-?\s*MM\s*$/;

const rows = q(
  `SELECT w.id, w.title, w.authors, w.work_key,
          (SELECT COUNT(*) FROM user_book ub WHERE ub.work_id = w.id) ub,
          (SELECT COUNT(*) FROM work_alias a WHERE a.work_id = w.id) al,
          (SELECT COUNT(*) FROM work_relation r WHERE r.from_work_id = w.id OR r.to_work_id = w.id) rel
     FROM work w
    WHERE w.title LIKE '%MM'
    ORDER BY w.id`,
);

const allKeys = new Set(q('SELECT work_key FROM work').map((r) => r.work_key));

console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database — ${rows.length} title(s) match\n`);

const todo = [];
const refused = [];
for (const r of rows) {
  const next = r.title.replace(MM, '').trim();
  if (!next || next === r.title) { refused.push([r, 'suffix did not match cleanly']); continue; }
  // ⚠️ Any of these being non-zero means the key is load-bearing for this row.
  if (Number(r.ub) > 0) { refused.push([r, `has ${r.ub} user_book row(s) — a review could be orphaned`]); continue; }
  if (Number(r.al) > 0) { refused.push([r, `has ${r.al} alias(es)`]); continue; }
  if (Number(r.rel) > 0) { refused.push([r, `has ${r.rel} relation(s)`]); continue; }

  const key = workKeyFor(next, r.authors);
  // A rename that lands on a key another work already owns would be a merge,
  // not a rename, and the UNIQUE-ish semantics of work_key do not survive it.
  if (key !== r.work_key && allKeys.has(key)) {
    refused.push([r, `new key ${key} is already taken by another work`]);
    continue;
  }
  todo.push({ id: Number(r.id), from: r.title, to: next, key, oldKey: r.work_key, sort: sortTitleFor(next) });
}

for (const t of todo) {
  console.log(`  ${String(t.id).padStart(4)}  ${t.from}`);
  console.log(`        -> ${t.to}`);
  console.log(`        key ${t.oldKey}  ->  ${t.key}`);
}
for (const [r, why] of refused) console.log(`  ⚠️ REFUSED  ${r.id} ${r.title} — ${why}`);

console.log(`\n${todo.length} to rename, ${refused.length} refused\n`);
if (!flags.commit) { console.log('DRY RUN. Nothing written. Re-run with --commit.\n'); process.exit(0); }
if (!todo.length) { console.log('Nothing to do.\n'); process.exit(0); }

execute(
  todo.map(
    (t) =>
      `UPDATE work SET title = ${lit(t.to)}, sort_title = ${lit(t.sort)}, work_key = ${lit(t.key)},
              updated_at = datetime('now')
        WHERE id = ${t.id} AND work_key = ${lit(t.oldKey)};`,
  ),
  { remote: flags.remote },
);

const after = q(
  `SELECT id, title, work_key FROM work WHERE id IN (${todo.map((t) => t.id).join(',')}) ORDER BY id`,
);
const byId = new Map(after.map((r) => [Number(r.id), r]));
const wrong = todo.filter((t) => byId.get(t.id)?.title !== t.to || byId.get(t.id)?.work_key !== t.key);

console.log('verified by re-reading:');
for (const t of todo) {
  const got = byId.get(t.id);
  console.log(`  ${t.id}  ${got?.title}   [${got?.work_key}]`);
}
const left = q(`SELECT COUNT(*) n FROM work WHERE title LIKE '%MM'`);
console.log(`\n${wrong.length} mismatch(es); ${left[0]?.n ?? '?'} title(s) still ending in MM`);
console.log(wrong.length === 0 ? 'All renames confirmed.\n' : '⚠️ Re-read does not match.\n');
process.exit(wrong.length ? 1 : 0);
