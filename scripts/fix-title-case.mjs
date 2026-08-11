/**
 * Title-case the children's-book titles that were stored in sentence case.
 *
 * The owner, 2026-08-11: *"a lot of the ABC books and 123 books are have lower
 * case titles. Can we fix that? 123s of art needs a cap, ABCs of mathmatecis
 * etc."*
 *
 * ## ⚠️ Why this is safe to run, and the check that proves it
 *
 * `work.title` is load-bearing: `work_key` is derived from it and is the column
 * the audiobook bridge joins on, and `bookIdFromTitle` derives the Firestore
 * review document id. Changing a title is normally a migration, not an edit.
 *
 * A **case-only** change is the exception, because both derivations lowercase
 * first — `normaliseTitle` at `titles.ts:55`, `bookIdFromTitle` at
 * `reviews.ts:73`. So "ABCs of mathematics" and "ABCs of Mathematics" produce
 * the same `work_key` and the same review id, and no review can be orphaned.
 *
 * ⚠️ That is a claim, so the script CHECKS it rather than asserting it: any
 * proposal whose `normaliseTitle` differs from the original is refused and
 * reported, not written. If a rule here ever does more than change case, the
 * run stops instead of quietly renaming a book.
 *
 * ## What it deliberately does NOT touch
 *
 * - **Romaji particles.** *Seirei Tsukai **no** Blade Dance* — 23 rows — is
 *   correctly lower-case and is the single largest group the naive scan flags.
 *   `no` is in SMALL, so it stays down.
 * - **Anything already carrying an interior capital**: `ABCs`, `B*tch`,
 *   `McDonald`, `iPhone`. A token with a capital anywhere but position 0 is
 *   passed through untouched — that is what keeps `ABCs` from becoming `Abcs`.
 * - **Inside hyphens.** `di-no-saur` becomes `Di-no-saur`, not `Di-No-Saur`.
 *   Seuss meant that, and a hyphen is not a word boundary for casing.
 * - **Titles already in title case.** No row is written unless it changes.
 *
 *   node scripts/fix-title-case.mjs                  # dry run
 *   node scripts/fix-title-case.mjs --commit
 *   node scripts/fix-title-case.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { normaliseTitle } from '../packages/core/src/titles.ts';

const flags = parseFlags();

/** Down unless first or last. Includes the romaji particle `no` on purpose. */
const SMALL = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor',
  'no', 'of', 'on', 'or', 'the', 'to', 'up', 'vs', 'with', 'over',
]);

/** True if the token already says how it wants to be cased. */
function selfCased(word) {
  return /[A-Z]/.test(word.slice(1)) || /^[^A-Za-z]*[A-Z]/.test(word);
}

function capitalise(word) {
  const i = word.search(/[A-Za-z]/);
  if (i < 0) return word;
  // ⚠️ A letter directly after a digit is an ordinal or a plural, not the start
  // of a word: 123s, 30th, 1st, 2nd. Capitalising it produced "123S of Art" and
  // "30Th Anniversary" on the first run — both caught in the dry run.
  if (i > 0 && /[0-9]/.test(word[i - 1])) return word;
  return word.slice(0, i) + word[i].toUpperCase() + word.slice(i + 1);
}

export function titleCase(raw) {
  const tokens = raw.split(/(\s+)/);
  const wordIdx = tokens.map((t, i) => (/\s/.test(t) || t === '' ? -1 : i)).filter((i) => i >= 0);
  const first = wordIdx[0];
  const last = wordIdx[wordIdx.length - 1];

  return tokens
    .map((tok, i) => {
      if (/^\s*$/.test(tok)) return tok;
      if (selfCased(tok)) return tok; // ABCs, B*tch, McDonald
      const bare = tok.replace(/[^A-Za-z']/g, '').toLowerCase();
      if (i !== first && i !== last && SMALL.has(bare)) return tok.toLowerCase();
      return capitalise(tok);
    })
    .join('');
}

const rows = query('SELECT id, title, series FROM work ORDER BY id', { remote: flags.remote });

const changes = [];
const refused = [];
for (const r of rows) {
  const next = titleCase(r.title);
  if (next === r.title) continue;
  // ⚠️ The safety check. Case-only, or it does not get written.
  if (normaliseTitle(next) !== normaliseTitle(r.title)) {
    refused.push({ ...r, next });
    continue;
  }
  changes.push({ ...r, next });
}

console.log(`\n${rows.length} works in the ${flags.remote ? 'REMOTE' : 'local'} database`);
console.log(`${changes.length} title(s) would change, ${refused.length} refused\n`);

for (const c of changes) {
  console.log(`  ${String(c.id).padStart(4)}  ${c.title}`);
  console.log(`        -> ${c.next}`);
}

if (refused.length) {
  console.log('\n⚠️ REFUSED — these would change more than case, so work_key would move:');
  for (const r of refused) console.log(`  ${r.id}  ${r.title}\n      -> ${r.next}`);
}

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(0);
}

if (!changes.length) {
  console.log('Nothing to do.\n');
  process.exit(0);
}

// sort_title is derived on write in packages/db, but this script writes SQL
// directly, so it updates both. work_key is deliberately NOT touched — it is
// unchanged by construction, and the check above is what guarantees that.
execute(
  changes.map(
    (c) =>
      `UPDATE work SET title = ${lit(c.next)}, sort_title = ${lit(c.next)}, ` +
      `updated_at = datetime('now') WHERE id = ${lit(c.id)};`,
  ),
  { remote: flags.remote },
);

const after = query(
  `SELECT id, title FROM work WHERE id IN (${changes.map((c) => c.id).join(',')})`,
  { remote: flags.remote },
);
const byId = new Map(after.map((r) => [Number(r.id), r.title]));
const wrong = changes.filter((c) => byId.get(Number(c.id)) !== c.next);

console.log(`\nverified by re-reading ${after.length} row(s): ${changes.length - wrong.length} correct, ${wrong.length} wrong`);
if (wrong.length) {
  for (const w of wrong) console.log(`  ⚠️ ${w.id} reads "${byId.get(Number(w.id))}", expected "${w.next}"`);
  process.exit(1);
}
console.log('All title changes confirmed.\n');
