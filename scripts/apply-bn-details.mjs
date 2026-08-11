/**
 * Fill in the seven Barnes & Noble books from their real product listings.
 *
 * ## Why they arrived empty
 *
 * An order history lists what you bought, not what the book *is*. The B&N order
 * pages carry no ISBN and no cover image at all — checked directly — so
 * `import-shop-orders.mjs` created seven works with a title, an author, a price
 * and nothing else. This is the second half: the product page.
 *
 * ## ⚠️ This script RETITLES, and a title is a stored key
 *
 * The order history records B&N's marketing title —
 * *"The Wandering Inn: Book One, Part One of The Wandering Inn Series"*. That is
 * the whole book's name as far as this catalog is concerned, and it is why the
 * free cover ladder found **0 of 11**: no upstream database has a book by that
 * name. The real title is *"The Wandering Inn"*.
 *
 * So the title changes, and `work_key` is derived from it — which CLAUDE.md
 * calls a migration, not an edit, because the key joins to Firestore reviews and
 * is what the matcher dedupes on.
 *
 * **It is safe in this exact case and nowhere near generally**:
 *   * these seven works were created hours ago by the B&N import and have no
 *     reviews, no read-state and no aliases — the script asserts this and
 *     refuses the row if anything references it;
 *   * `copy` and `edition` join on `work_id`, not the key, so holdings follow;
 *   * the key is recomputed with `workKeyFor`, never hand-built, so it matches
 *     what every other path would produce for the new title.
 *
 * The marketing subtitle is kept in `work.subtitle` rather than discarded — it
 * is how the order history refers to the book, and throwing it away would make
 * a future reconciliation against B&N harder than it needs to be.
 *
 *   node scripts/apply-bn-details.mjs --remote
 *   node scripts/apply-bn-details.mjs --remote --commit
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { workKeyFor } from '../packages/core/src/titles.ts';
import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();
const fileArg = process.argv.indexOf('--file');
if (fileArg < 0) {
  console.error('Pass --file <bn-product-details.json>');
  process.exit(1);
}
const data = JSON.parse(readFileSync(path.resolve(process.argv[fileArg + 1]), 'utf8'));
const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const entries = Object.entries(data)
  .filter(([k]) => /^\d+$/.test(k))
  .map(([, v]) => v)
  .filter((v) => !v.ambiguous);

const skipped = Object.values(data).filter((v) => v && v.ambiguous);

console.log(`\n${remote ? 'production' : 'local'}: ${entries.length} book(s) to fill in`);

const plan = [];
for (const b of entries) {
  const w = query(
    `SELECT id, title, subtitle, authors, work_key, cover_url FROM work WHERE id = ${Number(b.workId)}`,
    { remote },
  )[0];
  if (!w) {
    console.log(`  ⚠️ work ${b.workId} not found — skipped`);
    continue;
  }

  /*
   * ⚠️ Refuse to retitle a work anything already points at by key. A review in
   * Firestore is keyed on `work_key`; changing it would orphan the review with
   * no error anywhere. These seven are hours old and should all come back zero.
   */
  const refs = query(
    `SELECT (SELECT COUNT(*) FROM user_book ub WHERE ub.work_id = ${w.id}) AS reading,
            (SELECT COUNT(*) FROM work_alias a WHERE a.work_id = ${w.id}) AS aliases,
            (SELECT COUNT(*) FROM work_relation r WHERE r.work_id = ${w.id} OR r.related_work_id = ${w.id}) AS relations`,
    { remote },
  )[0];
  const tied = Number(refs?.reading ?? 0) + Number(refs?.aliases ?? 0) + Number(refs?.relations ?? 0);

  const newTitle = b.titleReal ?? w.title;
  const newKey = workKeyFor(newTitle, w.authors);
  const retitling = newTitle !== w.title;

  if (retitling && tied > 0) {
    console.log(`  ⚠️ ${w.id} "${w.title.slice(0, 40)}" has ${tied} reference(s) — NOT retitling. Other fields still applied.`);
  }

  plan.push({
    w,
    b,
    newTitle: retitling && tied === 0 ? newTitle : w.title,
    newKey: retitling && tied === 0 ? newKey : w.work_key,
    retitle: retitling && tied === 0,
  });
}

for (const p of plan) {
  console.log(`\n  ${p.w.id}  ${p.retitle ? `RETITLE → "${p.newTitle}"` : `keep "${p.w.title.slice(0, 40)}"`}`);
  console.log(`        isbn ${p.b.isbn13 ?? '—'}   ${p.b.publisher ?? '—'}   ${p.b.publicationDate ?? '—'}   ${p.b.pageCount ?? '—'}pp`);
  console.log(`        cover ${(p.b.coverImageUrl ?? '(none)').slice(0, 62)}  [${p.b.coverVerifiedPixels ?? 'unverified'}]`);
}
if (skipped.length) console.log(`\n⚠️ ${skipped.length} marked ambiguous by the scan and deliberately skipped.`);

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}

const stmts = [];
for (const p of plan) {
  const year = p.b.publicationDate ? Number(String(p.b.publicationDate).slice(0, 4)) : null;

  stmts.push(
    `UPDATE work SET title = ${sql(p.newTitle)}, work_key = ${sql(p.newKey)},
            subtitle = COALESCE(subtitle, ${sql(p.b.subtitleMarketing ?? null)}),
            series = COALESCE(series, ${sql(p.b.series ?? null)}),
            cover_url = COALESCE(NULLIF(cover_url, ''), ${sql(p.b.coverImageUrl ?? null)}),
            first_published = COALESCE(first_published, ${year ?? 'NULL'}),
            updated_at = datetime('now')
      WHERE id = ${p.w.id};`,
  );

  // ⚠️ COALESCE everywhere: an importer must never overwrite a value a person
  // set. The only field forced is the title, which is the point of the run.
  stmts.push(
    `UPDATE edition SET isbn13 = COALESCE(isbn13, ${sql(p.b.isbn13 ?? null)}),
            publisher = COALESCE(publisher, ${sql(p.b.publisher ?? null)}),
            published_year = COALESCE(published_year, ${year ?? 'NULL'}),
            pages = COALESCE(pages, ${p.b.pageCount ?? 'NULL'}),
            source_url = COALESCE(source_url, ${sql(p.b.productUrl ?? null)}),
            updated_at = datetime('now')
      WHERE work_id = ${p.w.id};`,
  );
}

execute(stmts, { remote });

/* ⚠️ Confirm by re-reading — `execute` returns statements run, not rows changed. */
const after = query(
  `SELECT w.id, substr(w.title, 1, 34) AS title,
          CASE WHEN w.cover_url IS NULL OR w.cover_url = '' THEN 'NO COVER' ELSE 'cover' END AS cov,
          COALESCE((SELECT e.isbn13 FROM edition e WHERE e.work_id = w.id AND e.isbn13 IS NOT NULL LIMIT 1), 'no isbn') AS isbn
     FROM work w WHERE w.id IN (${plan.map((p) => p.w.id).join(',')}) ORDER BY w.id`,
  { remote },
);
console.log('\nafter:');
for (const r of after) console.log(`  ${r.id}  ${String(r.cov).padEnd(9)} ${String(r.isbn).padEnd(14)} ${r.title}`);
const blank = after.filter((r) => r.cov === 'NO COVER').length;
if (blank) console.log(`⚠️ ${blank} still without a cover — investigate.`);
