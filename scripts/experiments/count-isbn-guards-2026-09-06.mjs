/**
 * Throwaway measurement, kept because a number in a report has to be
 * re-checkable: how the ISBN backfill's candidate set splits across the three
 * guards, WITHOUT making a single network call.
 *
 * It reuses `CANDIDATES_SQL`'s shape and the three real guard functions, so it
 * cannot drift from `scripts/backfill-missing-isbns.mjs` in the direction that
 * matters (the guards themselves are imported, not copied). The SQL is a copy
 * and could drift — if these numbers ever disagree with a live dry run's banner,
 * trust the dry run.
 *
 *   node scripts/experiments/count-isbn-guards-2026-09-06.mjs --remote
 *   node scripts/experiments/count-isbn-guards-2026-09-06.mjs --remote --friend
 */
import { parseFlags, query } from '../lib/d1.mjs';
import {
  declaresNoIsbn,
  isCrowdfundedPrinting,
  namesAnIsbn,
} from '../lib/backfill-safety.mjs';

const flags = parseFlags();
const target = { remote: flags.remote, friend: flags.friend };
const where = flags.friend ? 'padhard' : flags.remote ? 'production' : 'local';

const candidates = query(
  `SELECT w.id AS work_id, w.title, e0.id AS edition_id, e0.edition_name, e0.note
     FROM work w
     LEFT JOIN edition e0
       ON e0.id = (SELECT e.id FROM edition e WHERE e.work_id = w.id ORDER BY e.id LIMIT 1)
    WHERE NOT EXISTS (
      SELECT 1 FROM edition e WHERE e.work_id = w.id AND e.isbn13 IS NOT NULL
    )
    ORDER BY w.id`,
  target,
);
const total = query('SELECT COUNT(*) AS n FROM work', target)[0].n;

let declared = 0;
let crowdfunded = 0;
const named = [];
let searchable = 0;
for (const r of candidates) {
  if (declaresNoIsbn(r.edition_name, r.note)) { declared++; continue; }
  if (isCrowdfundedPrinting(r.edition_name, r.note)) { crowdfunded++; continue; }
  const id = namesAnIsbn(r.edition_name, r.note);
  if (id) { named.push({ ...r, id }); continue; }
  searchable++;
}

console.log(`\n${where}: ${total} work(s), ${candidates.length} with no ISBN on any edition`);
console.log(`  guard 1  declaresNoIsbn        ${declared}`);
console.log(`  guard 1b isCrowdfundedPrinting ${crowdfunded}`);
console.log(`  guard 1c namesAnIsbn           ${named.length}`);
for (const n of named) {
  console.log(`             work #${n.work_id} ed#${n.edition_id} ${n.title} — names ${n.id}`);
}
console.log(`  reaching the ladder            ${searchable}`);
console.log(
  `  (without guard 1c the ladder would search ${searchable + named.length})`,
);
