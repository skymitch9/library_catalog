/**
 * Backfill `workKey` onto the audiobook catalog's existing review documents —
 * and carry it when a correction moves it.
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
 * ## ⚠️ It is also the audiobook side's KEY-MOVE CEREMONY (2026-08-14)
 *
 * `catalog-platform/docs/info/edit-audit-design.md` §3.4: a title or author
 * override in `audiobook_catalog/scripts/catalog_overrides.json` changes the
 * published `catalog.csv` on the next build, which moves the derived `workKey`
 * for that book. Nothing on that side carries the reviews across, so the
 * library-side join and the read-state sweep quietly lose them. Re-running this
 * script is the carry, and two things here make it one:
 *
 * 1. **Aliasing.** Every retitle in the overrides file is folded in as an
 *    old-slug → new-slug alias (`overrideTitleAliases` in `@lc/core`), so a
 *    document still filed under the pre-correction slug finds its row. The
 *    overrides file is the one place that remembers the old spelling, because
 *    `edit_overrides.py` keys its entries on the pre-correction tags.
 * 2. **Restamping.** A document whose stored `workKey` no longer equals the key
 *    its catalog row derives is *moved*, not skipped. Before this, the script
 *    counted any keyed document as done — so after the 2026-08-12 commit run,
 *    re-running it could never have carried anything. That was the whole gap.
 *
 * A review written on the *library* side is never restamped from here: its key
 * comes from this catalog's own title and author, and that is the authority for
 * it. Those are reported, not touched.
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
 * ⚠️ From a git worktree, set `LC_AUDIOBOOK_ROOT` — `../` lands three
 * directories too deep and the sibling checkout is not there. The script exits
 * rather than reporting a tidy zero, for the reason `docs/info/
 * identity-and-reviews.md` §7.5 records.
 *
 * **Dry run is the default and there is no way to write by accident.** This
 * touches the live review data of a site other people use.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, getFirestore, setDoc } from 'firebase/firestore';

import {
  aliasedBookIdIndex,
  bookIdFromTitle,
  overrideTitleAliases,
  workKeyForAudiobookRow,
} from '../packages/core/src/reviews.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const COMMIT = process.argv.includes('--commit');
const DEV = process.argv.includes('--dev');
const COLLECTION = DEV ? 'reviews_dev' : 'reviews';

const AUDIOBOOK_ROOT = process.env.LC_AUDIOBOOK_ROOT
  ? path.resolve(process.env.LC_AUDIOBOOK_ROOT)
  : path.resolve(here, '../../audiobook_catalog');
const CATALOG = process.env.CATALOG_CSV ?? path.join(AUDIOBOOK_ROOT, 'site/catalog.csv');
const OVERRIDES =
  process.env.CATALOG_OVERRIDES ?? path.join(AUDIOBOOK_ROOT, 'scripts/catalog_overrides.json');

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

/**
 * The retitles recorded in the sibling repo's corrections layer.
 *
 * Absent file is survivable and reported: aliasing is off, and the run is the
 * pre-2026-08-14 behaviour. A file that will not parse is not survivable —
 * silently carrying nothing is the failure this phase exists to end.
 */
function loadOverrideAliases() {
  if (!existsSync(OVERRIDES)) {
    console.log(`overrides: none at ${OVERRIDES} — retitle aliasing is OFF for this run`);
    return { aliases: [], ambiguous: [] };
  }
  const parsed = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
  const { aliases, ambiguous } = overrideTitleAliases(parsed);
  console.log(`overrides: ${aliases.length} title correction(s) from ${OVERRIDES}`);
  for (const a of aliases) {
    console.log(`  alias ${a.fromBookId}  ->  ${a.toBookId}   (via ${a.via})`);
  }
  for (const id of ambiguous) {
    console.log(`  ⚠️ ambiguous old slug, refused: ${id} — two corrections claim it`);
  }
  return { aliases, ambiguous };
}

// --- run ---------------------------------------------------------------------
if (!existsSync(CATALOG)) {
  // ⚠️ Never a tidy zero. A missing sibling checkout reads exactly like "no
  // audiobook has any review", and that lie has cost a debugging session before
  // (docs/info/identity-and-reviews.md §7.5).
  console.error(
    `\ncatalog.csv not found at ${CATALOG}\n` +
      '   Fix: set LC_AUDIOBOOK_ROOT to the audiobook_catalog checkout, or CATALOG_CSV\n' +
      '   to the file itself. From a git worktree it is never the default path.\n',
  );
  process.exit(1);
}

const published = loadCatalogIndex();
console.log(`catalog: ${published.size} distinct bookIds from ${CATALOG}`);

const { aliases } = loadOverrideAliases();
const { index: catalog, applied, shadowed, dangling } = aliasedBookIdIndex(published, aliases);
if (applied.length || shadowed.length || dangling.length) {
  console.log(
    `aliases: ${applied.length} applied, ${shadowed.length} shadowed by a live row, ` +
      `${dangling.length} pointing at a title no catalog row has`,
  );
  for (const a of dangling) {
    console.log(`  ⚠️ dangling: "${a.fromTitle}" -> "${a.toTitle}" is in no catalog row.`);
    console.log('     Has the audiobook site been rebuilt since the override landed?');
  }
}

const db = getFirestore(initializeApp(firebaseConfig));
const snap = await getDocs(collection(db, COLLECTION));
console.log(`${COLLECTION}: ${snap.size} review documents`);

let already = 0, planned = 0, unmatched = 0, written = 0, viaAlias = 0, skippedLibrary = 0;
const moves = [];
const unmatchedIds = [];

for (const d of snap.docs) {
  const data = d.data();
  const stored = typeof data.workKey === 'string' && data.workKey.includes('|')
    ? data.workKey
    : null;

  const row = data.bookId ? catalog.get(data.bookId) : undefined;
  if (!row) {
    // A review of a book no longer in the catalog — a removed audiobook, or a
    // title renamed upstream with no override recording the old spelling.
    // Reported, never guessed at: inventing an author to complete the key is how
    // a review lands on the wrong book, which is the exact failure this whole
    // key exists to prevent.
    unmatched++;
    if (unmatchedIds.length < 20) unmatchedIds.push(`${d.id} (bookId=${data.bookId})`);
    continue;
  }
  const alias = published.has(data.bookId) ? null : data.bookId;

  const workKey = workKeyForAudiobookRow(row.title, row.author, row.series);
  if (stored === workKey) {
    already++;
    continue;
  }

  if (stored && data.source === 'library') {
    // ⚠️ This catalog wrote it, from its own title and author. Those are the
    // authority for a print review; the audiobook row's spelling is not.
    skippedLibrary++;
    console.log(`  library-written, left alone: ${d.id}\n      keeps ${stored}`);
    continue;
  }

  if (alias) viaAlias++;
  if (stored) {
    // A KEY MOVE: the review is being carried from the key it holds to the key
    // its book now derives. Always printed in full — these are the ones a person
    // should read before `--commit`, and there are never many.
    moves.push(`  ${d.id}${alias ? `  (matched via alias ${alias})` : ''}\n      ${stored}\n   -> ${workKey}`);
  } else {
    planned++;
    if (!COMMIT && planned <= 15) {
      console.log(`  ${d.id}${alias ? `  (via alias ${alias})` : ''}\n      -> ${workKey}`);
    }
  }

  if (!COMMIT) continue;

  await setDoc(doc(db, COLLECTION, d.id), { workKey, source: 'audio' }, { merge: true });
  written++;
}

if (moves.length) {
  console.log(`\n--- key moves (${moves.length}) ---`);
  for (const m of moves) console.log(m);
}

console.log('\n--- summary ---');
console.log(`already correct : ${already}`);
console.log(`${COMMIT ? 'newly keyed' : 'would key'} : ${planned}`);
console.log(`${COMMIT ? 'keys moved' : 'would move'} : ${moves.length}`);
console.log(`matched via a retitle alias : ${viaAlias}`);
console.log(`library-written, untouched : ${skippedLibrary}`);
console.log(`unmatched     : ${unmatched}`);
if (COMMIT) console.log(`documents written : ${written}`);
if (unmatchedIds.length) {
  console.log('  (no catalog row for these — left alone deliberately)');
  for (const u of unmatchedIds) console.log(`    ${u}`);
}
if (!COMMIT) console.log('\nDRY RUN. Nothing was written. Re-run with --commit.');

process.exit(0);
