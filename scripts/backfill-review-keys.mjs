/**
 * Backfill `workKey` onto the audiobook catalog's existing review documents.
 *
 * ## What this is for
 *
 * The audiobook site keys reviews on `bookId` — a slug of the title as *it*
 * spells it, decoration and all:
 *
 *     "Firefight - The Reckoners, Book 2"  ->  firefight-the-reckoners-book-2
 *
 * A print copy of the same book is called "Firefight" and slugs to `firefight`.
 * They never meet, and the key has no author in it at all, so two different
 * books called "Gold" share one. `workKey` is the composite key that fixes both:
 * `normaliseTitle(cleanTitle)|normaliseTitle(primaryAuthor)`.
 *
 * ⚠️ **This is not optional cleanup.** Without it the library catalog cannot see
 * a single existing audiobook review, because the fallback query on `bookId`
 * only matches when the two catalogs happen to spell the title identically —
 * and for anything in a series, they never do.
 *
 * ## What it does NOT touch
 *
 * `bookId`, `displayName`, `rating`, `text`, `createdAt`. A merge write adding
 * exactly two fields: `workKey`, and `source: 'audio'`. The audiobook site
 * ignores unknown fields, so nothing over there changes or breaks.
 *
 * ## Why it needs no service account and no rules change
 *
 * `firestore.rules` has `match /reviews/{reviewId} { allow write: if
 * validReview() }`, and `validReview()` asserts only that the *resulting*
 * document has a string `displayName` and a rating in 0.5…5. A merge that adds
 * a field leaves both intact, so the write passes as an ordinary client. No
 * admin credential is involved, which is the point — see
 * `apps/worker/src/routes/reviews.ts`.
 *
 * ## Running it
 *
 *     node scripts/backfill-review-keys.mjs                 # dry run, prints a plan
 *     node scripts/backfill-review-keys.mjs --commit        # writes to `reviews`
 *     node scripts/backfill-review-keys.mjs --commit --dev  # writes to `reviews_dev`
 *
 * **Dry run is the default and there is no way to write by accident.** This
 * touches the live review data of a site other people use.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, getFirestore, setDoc } from 'firebase/firestore';

import { bookIdFromTitle, workKeyForAudiobookRow } from '../packages/core/src/reviews.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const COMMIT = process.argv.includes('--commit');
const DEV = process.argv.includes('--dev');
const COLLECTION = DEV ? 'reviews_dev' : 'reviews';

const CATALOG =
  process.env.CATALOG_CSV ??
  path.resolve(here, '../../audiobook_catalog/site/catalog.csv');

// Public by design — a Firebase web config ships to every browser.
// ⚠️ Must be the audiobook catalog's project, or this writes into nothing.
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY ?? 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y',
  authDomain: 'audiobook-catalog.firebaseapp.com',
  projectId: 'audiobook-catalog',
};

// --- CSV ---------------------------------------------------------------------
// catalog.csv has quoted, multi-line description fields, so a split on newlines
// silently produces garbage rows. This is the same reader phase 0 used.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadCatalogIndex() {
  const rows = parseCsv(readFileSync(CATALOG, 'utf8'));
  const header = rows[0];
  const iTitle = header.indexOf('title');
  const iAuthor = header.indexOf('author');
  // The series column is not optional to read. Audible writes the same series
  // suffix three ways within one series, and only knowing the series name
  // strips all three — see cleanTitleWithSeries in packages/core.
  const iSeries = header.indexOf('series');
  if (iTitle < 0 || iAuthor < 0) throw new Error('catalog.csv has no title/author column');

  // bookId -> {title, author}. Built with the SAME slug the site used to create
  // the document ids, so the join is exact rather than fuzzy.
  const byBookId = new Map();
  for (const r of rows.slice(1)) {
    const title = r[iTitle];
    if (!title) continue;
    const id = bookIdFromTitle(title);
    // First wins. A duplicate slug means two audiobook rows share a title; the
    // review document could belong to either, and picking the later one at
    // random is worse than being deterministic about it.
    if (!byBookId.has(id)) {
      byBookId.set(id, {
        title,
        author: r[iAuthor] ?? '',
        series: iSeries >= 0 ? (r[iSeries] || null) : null,
      });
    }
  }
  return byBookId;
}

// --- run ---------------------------------------------------------------------
const catalog = loadCatalogIndex();
console.log(`catalog: ${catalog.size} distinct bookIds from ${CATALOG}`);

const db = getFirestore(initializeApp(firebaseConfig));
const snap = await getDocs(collection(db, COLLECTION));
console.log(`${COLLECTION}: ${snap.size} review documents`);

let already = 0, planned = 0, unmatched = 0, written = 0;
const unmatchedIds = [];

for (const d of snap.docs) {
  const data = d.data();
  if (typeof data.workKey === 'string' && data.workKey.includes('|')) {
    already++;
    continue;
  }

  const row = data.bookId ? catalog.get(data.bookId) : undefined;
  if (!row) {
    // A review of a book no longer in the catalog — a removed audiobook, or a
    // title that has since been renamed upstream. Reported, never guessed at:
    // inventing an author to complete the key is how a review lands on the
    // wrong book, which is the exact failure this whole key exists to prevent.
    unmatched++;
    if (unmatchedIds.length < 20) unmatchedIds.push(`${d.id} (bookId=${data.bookId})`);
    continue;
  }

  const workKey = workKeyForAudiobookRow(row.title, row.author, row.series);
  planned++;

  if (!COMMIT) {
    if (planned <= 15) console.log(`  ${d.id}\n      -> ${workKey}`);
    continue;
  }

  await setDoc(doc(db, COLLECTION, d.id), { workKey, source: 'audio' }, { merge: true });
  written++;
}

console.log('\n--- summary ---');
console.log(`already keyed : ${already}`);
console.log(`${COMMIT ? 'written' : 'would write'} : ${COMMIT ? written : planned}`);
console.log(`unmatched     : ${unmatched}`);
if (unmatchedIds.length) {
  console.log('  (no catalog row for these — left alone deliberately)');
  for (const u of unmatchedIds) console.log(`    ${u}`);
}
if (!COMMIT) console.log('\nDRY RUN. Nothing was written. Re-run with --commit.');

process.exit(0);
