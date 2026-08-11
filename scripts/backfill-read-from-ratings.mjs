/**
 * Establish read state from the ratings that already exist.
 *
 * The owner's ask: *"if a book has a rating from the audiobook library mark it
 * as read"* — *"so if its a rating i left mark it read for me"* — *"mark all
 * copies of a book read"*.
 *
 * ## ⚠️ This does not fill gaps. It writes the read history from nothing.
 *
 * `user_book` held **zero rows** when this was written (measured against
 * production 2026-08-11): no book in the catalog had any read state, and no
 * rating was cached. The shared Firestore `reviews` collection held **860**
 * documents. Every read state this catalog will have on its first day comes from
 * this script, which is why the dry run is worth reading line by line rather
 * than glancing at the totals — the lesson `backfill-review-keys.mjs` records
 * from the other direction, where reading the *keys* rather than the counts is
 * what exposed a real defect.
 *
 * ## Why a backfill exists at all, when the browser already derives
 *
 * `Reviews.tsx` derives read state whenever somebody opens a book page, because
 * the browser is the only thing in this estate that sees both Firestore and this
 * API. That covers a book the moment it is looked at, and covers nothing
 * otherwise. Nobody is going to open 224 book pages to make the collection
 * filter honest. This is that, unattended, once.
 *
 * ## What it reads, and with what credential
 *
 * The Firebase **web** API key, which is public by design and already in this
 * repo. `audiobook_catalog/firestore.rules` has `match /reviews/{reviewId} {
 * allow read: if true }` — verified 2026-08-11 — so an ordinary client can read
 * the collection. There is no service account anywhere in this project and this
 * script does not introduce one; see `apps/worker/src/routes/reviews.ts` for
 * why that is the design and not an omission.
 *
 * It **writes nothing to Firestore**. Only D1.
 *
 * ## Its relationship to `backfill-review-keys.mjs`
 *
 * Independent, in either order. That script stamps `workKey` onto the review
 * documents; it has **not been run with --commit**, so today every one of the
 * 860 carries only `bookId`. Rather than depend on it, this script derives the
 * key the same way it would — `bookId` → the row in `catalog.csv` →
 * `workKeyForAudiobookRow` — using the one implementation in `@lc/core`. A
 * stored `workKey` is preferred where one exists, so running the other script
 * first changes nothing here.
 *
 * ## Running it
 *
 *     npm run backfill:read-states                      # dry run, LOCAL
 *     npm run backfill:read-states -- --remote          # dry run against prod (reads only)
 *     npm run backfill:read-states -- --remote --commit # writes
 *
 * Dry run is the default and there is no way to write by accident.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

import {
  bookIdFromTitle,
  reviewSourceOf,
  workKeyForAudiobookRow,
} from '../packages/core/src/reviews.ts';
import { deriveReadState, isMyReview } from '../packages/core/src/readstate.ts';
import { AUDIOBOOK_CSV } from './lib/audiobooks.mjs';
import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();
const DEV = process.argv.includes('--dev');
const COLLECTION = DEV ? 'reviews_dev' : 'reviews';

/**
 * ⚠️ `AUDIOBOOK_CSV` from `lib/audiobooks.mjs`, not a path built here.
 *
 * `backfill-review-keys.mjs` resolves `../../audiobook_catalog/...` from its own
 * directory, which is right in the main checkout and **wrong in a git
 * worktree** — those live under `library_catalog/.claude/worktrees/<name>`, so
 * the relative path lands three directories too deep. Found by running this:
 * the first dry run reported `0 distinct bookIds` and `no derivable workKey :
 * 412`, which looks exactly like a matching failure and was a missing file.
 * `lib/audiobooks.mjs` already owns that trap and the `LC_AUDIOBOOK_ROOT`
 * escape hatch for it, so this uses it rather than repeating the mistake.
 */
const CATALOG = process.env.CATALOG_CSV ?? AUDIOBOOK_CSV;

// Public by design — a Firebase web config ships to every browser. Same values
// as backfill-review-keys.mjs, and it must be the audiobook catalog's project.
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY ?? 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y',
  authDomain: 'audiobook-catalog.firebaseapp.com',
  projectId: 'audiobook-catalog',
};

// --- CSV ---------------------------------------------------------------------
// catalog.csv has quoted, multi-line description fields, so a split on newlines
// silently produces garbage rows. Same reader as backfill-review-keys.mjs.
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
  let text;
  try {
    text = readFileSync(CATALOG, 'utf8');
  } catch {
    // ⚠️ Not fatal, and not silently ignored either. Without the CSV the only
    // reviews reachable are the ones already carrying `workKey`, which today is
    // none of them. Say so loudly rather than reporting "0 to write" as if that
    // were the answer.
    // ⚠️ Fatal, not a warning. Measured 2026-08-11: **0 of the 869** review
    // documents carry a stored `workKey`, so without this file not one review
    // can be matched — and the run would print a tidy "would mark read: 0" that
    // is indistinguishable from "these ratings say nothing". Refusing is the
    // only honest answer.
    console.error(
      `\n⚠️ Could not read ${CATALOG}.\n` +
        '   Every review document is keyed on `bookId`, a slug of the title as the\n' +
        '   AUDIOBOOK catalog spells it, and only this file turns one into a workKey.\n' +
        '   None of the 869 carries a stored `workKey` (backfill-review-keys has not\n' +
        '   been run with --commit), so without the CSV nothing can match.\n' +
        '   Fix: set LC_AUDIOBOOK_ROOT to the audiobook_catalog checkout, or CATALOG_CSV\n' +
        '   to the file itself. ⚠️ In a git worktree the default WILL be wrong.\n',
    );
    process.exit(1);
  }

  const rows = parseCsv(text);
  const header = rows[0];
  const iTitle = header.indexOf('title');
  const iAuthor = header.indexOf('author');
  // Not optional to read: Audible writes the same series suffix three ways
  // within one series, and only the exact name strips all three.
  const iSeries = header.indexOf('series');
  if (iTitle < 0 || iAuthor < 0) throw new Error('catalog.csv has no title/author column');

  const byBookId = new Map();
  for (const r of rows.slice(1)) {
    const title = r[iTitle];
    if (!title) continue;
    const id = bookIdFromTitle(title);
    // First wins, deterministically — same rule as backfill-review-keys.mjs.
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

// --- D1 ----------------------------------------------------------------------
const where = remote ? 'REMOTE' : 'LOCAL';

const works = query('SELECT id, title, work_key FROM work ORDER BY id', { remote });
const users = query(
  'SELECT id, email, display_name, review_name FROM app_user ORDER BY id',
  { remote },
);
const existing = query(
  `SELECT work_id, user_id, read_state, read_state_how, read_format, rating_cached
     FROM user_book`,
  { remote },
);

console.log(`${where}: ${works.length} works, ${users.length} people, ${existing.length} user_book rows`);

// ⚠️ A zero-row read is a FAILURE here, not an answer — and it has happened.
// `docs/TODO.md` records `scripts/lib/d1.mjs` returning an empty result over 99
// live rows, with a second run behaving; this script's own first remote dry run
// reported `0 works` against a catalog of 231, and a run later the same minute
// read all 231. A catalog with no works cannot be backfilled, so there is no
// legitimate case where continuing is useful, and every illegitimate one ends in
// "nothing to do" over a live database.
if (works.length === 0) {
  console.error(
    '\n⚠️ Read 0 works. A catalog with no books is not a state this can act on, and\n' +
      '   an empty read from wrangler is a known, intermittent failure here. Re-run.',
  );
  process.exit(1);
}

if (users.length === 0) {
  console.log('\nNobody has signed in yet, so no rating can belong to anybody. Nothing to do.');
  process.exit(0);
}

/** work_key -> [work]. ⚠️ NOT unique, and that is the "all copies" half. */
const worksByKey = new Map();
for (const w of works) {
  const list = worksByKey.get(w.work_key);
  if (list) list.push(w);
  else worksByKey.set(w.work_key, [w]);
}

const existingByPair = new Map();
for (const r of existing) existingByPair.set(`${r.work_id}:${r.user_id}`, r);

// --- Firestore ---------------------------------------------------------------
const catalog = loadCatalogIndex();
console.log(`catalog.csv: ${catalog.size} distinct bookIds`);

const fdb = getFirestore(initializeApp(firebaseConfig));
const snap = await getDocs(collection(fdb, COLLECTION));
console.log(`${COLLECTION}: ${snap.size} review documents\n`);

// --- decide ------------------------------------------------------------------
const stats = {
  notARating: 0,
  noOwner: 0,
  noKey: 0,
  noWork: 0,
  wouldMark: 0,
  wouldCacheOnly: 0,
  alreadyRight: 0,
  refusedHuman: 0,
  refusedExisting: 0,
  inferredAudio: 0,
};
/** Rows left alone because they already say something more specific than 'read'. */
const refusals = [];
/** displayName -> count, for reviews nobody in app_user claims. */
const orphanNames = new Map();
/** Reviews whose key matches no work in this catalog. */
const unreachable = [];
const plan = [];
const samples = [];
const multi = [];

for (const d of snap.docs) {
  const doc = d.data();

  if (typeof doc.rating !== 'number') {
    stats.notARating++;
    continue;
  }

  const owner = users.find((u) =>
    isMyReview(doc, { email: u.email, reviewName: u.review_name }),
  );
  if (!owner) {
    stats.noOwner++;
    const name = String(doc.displayName ?? '(no name)');
    orphanNames.set(name, (orphanNames.get(name) ?? 0) + 1);
    continue;
  }

  // Prefer the stored key; derive it the same way backfill-review-keys would if
  // that script has not run. ⚠️ Never invent an author to complete a key — a
  // guessed key lands a rating on the wrong book, which is the exact failure the
  // composite key exists to prevent.
  let workKey = typeof doc.workKey === 'string' && doc.workKey.includes('|') ? doc.workKey : null;
  if (!workKey) {
    const row = doc.bookId ? catalog.get(doc.bookId) : undefined;
    if (row) workKey = workKeyForAudiobookRow(row.title, row.author, row.series);
  }
  if (!workKey) {
    stats.noKey++;
    continue;
  }

  const matched = worksByKey.get(workKey);
  if (!matched) {
    // Overwhelmingly ordinary: the household owns ~1,075 audiobooks and 224
    // print/ebook works, so most audiobook reviews are of books this catalog
    // does not hold. NOT a failure and not a worklist.
    stats.noWork++;
    if (unreachable.length < 10) unreachable.push(`${workKey}  (${d.id})`);
    continue;
  }

  // ⚠️ The three-copies answer. One rating, every work row sharing the key.
  if (matched.length > 1) multi.push({ workKey, titles: matched.map((w) => w.title) });

  // ⚠️ `reviewSourceOf`, not `doc.source`. Measured 2026-08-11: not one of the
  // 869 documents carries `source`, so reading the field alone would write 869
  // read states with no format at all — for an owner whose reading is
  // overwhelmingly audio. The function's header carries why the absence is
  // itself proof of origin.
  const observed = { rating: doc.rating, source: reviewSourceOf(doc) };
  if (observed.source === 'audio') stats.inferredAudio++;

  for (const w of matched) {
    const row = existingByPair.get(`${w.id}:${owner.id}`) ?? null;
    const next = deriveReadState(
      observed,
      row
        ? {
            readState: row.read_state,
            readStateHow: row.read_state_how,
            readFormat: row.read_format,
          }
        : null,
    );

    if (!next) {
      // ⚠️ Three different reasons for "no change", and collapsing them would
      // hide the one worth reading. A refusal is a decision the run made; an
      // already-right row is the run having nothing to say.
      if (row?.read_state_how === 'human') stats.refusedHuman++;
      else if (row && row.read_state !== 'unread' && row.read_state !== 'read') {
        stats.refusedExisting++;
        if (refusals.length < 10) {
          refusals.push(`  ${String(w.id).padStart(4)}  ${w.title.slice(0, 46).padEnd(46)} is '${row.read_state}'`);
        }
      } else stats.alreadyRight++;
      // The rating still wants caching even where the read state must not move.
      if ((row?.rating_cached ?? null) !== doc.rating) {
        stats.wouldCacheOnly++;
        plan.push({ kind: 'cache', workId: w.id, userId: owner.id, rating: doc.rating });
      }
      continue;
    }

    stats.wouldMark++;
    plan.push({
      kind: 'mark',
      workId: w.id,
      userId: owner.id,
      rating: doc.rating,
      readState: next.readState,
      readFormat: next.readFormat,
    });
    if (samples.length < 20) {
      samples.push(
        `  ${String(w.id).padStart(4)}  ${w.title.slice(0, 46).padEnd(46)} ` +
          `${String(doc.rating).padStart(3)}★  ${next.readFormat ?? '—'}  ${owner.email}`,
      );
    }
  }
}

// --- report ------------------------------------------------------------------
console.log('--- what these ratings say ---');
console.log(`would mark read       : ${stats.wouldMark}`);
console.log(`would cache only      : ${stats.wouldCacheOnly}  (rating stored, read state left alone)`);
console.log(`already right         : ${stats.alreadyRight}`);
console.log(`⚠️ refused, human-set : ${stats.refusedHuman}  (a person set this; never overruled)`);
console.log(`⚠️ refused, more specific: ${stats.refusedExisting}  ('dnf' / 'reference' outrank 'read')`);
console.log(`not a rating          : ${stats.notARating}`);
console.log(`nobody in app_user    : ${stats.noOwner}`);
console.log(`no derivable workKey  : ${stats.noKey}`);
console.log(`book not in this catalog: ${stats.noWork}`);
console.log(
  `reviews read as audiobook: ${stats.inferredAudio}  (no source + no workKey ⇒ the audiobook site wrote it)`,
);

if (samples.length) {
  console.log('\n--- READ THESE, not just the counts ---');
  for (const s of samples) console.log(s);
  if (stats.wouldMark > samples.length) console.log(`  … and ${stats.wouldMark - samples.length} more`);
}

if (refusals.length) {
  console.log('\n--- rated, but already saying something more specific ---');
  for (const r of refusals) console.log(r);
}

if (multi.length) {
  console.log('\n--- one rating reaching more than one work row ---');
  console.log('(the "3 copies of Percy Jackson" case: same book, scanned twice, two rows)');
  for (const m of multi.slice(0, 10)) console.log(`  ${m.workKey}\n      ${m.titles.join(' / ')}`);
} else {
  console.log('\nNo work_key is shared by two work rows — every rating reaches exactly one work.');
}

if (orphanNames.size) {
  console.log('\n--- reviews nobody signed in here can claim ---');
  console.log('(household members who review on the audiobook site but have never');
  console.log(' signed into this catalog. Skipped deliberately, never guessed at.)');
  for (const [name, n] of [...orphanNames].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(n).padStart(4)}  ${name}`);
  }
  const noReviewName = users.filter((u) => !u.review_name);
  if (noReviewName.length) {
    console.log(
      `\n  ⚠️ ${noReviewName.length} signed-in ${noReviewName.length === 1 ? 'person has' : 'people have'} ` +
        'no `review_name`, so only an email on the',
    );
    console.log('     document can match them — and audiobook-site reviews carry none.');
    for (const u of noReviewName) console.log(`     ${u.email} (display_name: ${u.display_name ?? '—'})`);
    console.log('     If a name above is theirs, set `review_name` and re-run.');
  }
}

if (unreachable.length) {
  console.log('\n--- sample keys with no work here (expected, and fine) ---');
  for (const u of unreachable) console.log(`  ${u}`);
}

if (!commit) {
  console.log('\nDRY RUN. Nothing was written. Re-run with --commit.');
  process.exit(0);
}

// --- write -------------------------------------------------------------------
const statements = [];
for (const p of plan) {
  if (p.kind === 'cache') {
    // ⚠️ Rating columns ONLY. Never touches read_state — this is the path for a
    // row a person has asserted, and clobbering it here would defeat the guard
    // that made the whole feature safe.
    statements.push(
      `INSERT INTO user_book (work_id, user_id, rating_cached, rating_synced_at)
         VALUES (${p.workId}, ${p.userId}, ${lit(p.rating)}, datetime('now'))
       ON CONFLICT (work_id, user_id) DO UPDATE SET
         rating_cached = excluded.rating_cached,
         rating_synced_at = excluded.rating_synced_at,
         updated_at = datetime('now');`,
    );
  } else {
    statements.push(
      `INSERT INTO user_book (work_id, user_id, rating_cached, rating_synced_at,
                              read_state, read_format, read_state_how)
         VALUES (${p.workId}, ${p.userId}, ${lit(p.rating)}, datetime('now'),
                 ${lit(p.readState)}, ${lit(p.readFormat)}, 'rating')
       ON CONFLICT (work_id, user_id) DO UPDATE SET
         rating_cached = excluded.rating_cached,
         rating_synced_at = excluded.rating_synced_at,
         read_state = excluded.read_state,
         read_format = excluded.read_format,
         read_state_how = 'rating',
         updated_at = datetime('now');`,
    );
  }
}

console.log(`\nwriting ${statements.length} statement(s) to the ${where} database…`);
execute(statements, { remote });

// ⚠️ Confirm by re-reading. `execute()` returns statements run, not rows changed
// — and the local D1 does not report `meta.changes` at all, so a counter here
// would be a number that cannot be wrong and cannot be right either.
const after = query(
  `SELECT COUNT(*) AS n,
          SUM(CASE WHEN read_state = 'read' THEN 1 ELSE 0 END) AS reads,
          SUM(CASE WHEN read_state_how = 'rating' THEN 1 ELSE 0 END) AS derived,
          SUM(CASE WHEN read_state_how = 'human' THEN 1 ELSE 0 END) AS human,
          SUM(CASE WHEN read_format = 'audio' THEN 1 ELSE 0 END) AS audio
     FROM user_book`,
  { remote },
)[0];

console.log('\n--- confirmed by re-reading the database ---');
console.log(`user_book rows        : ${after.n}`);
console.log(`read                  : ${after.reads}`);
console.log(`  of which from a rating: ${after.derived}`);
console.log(`  of which set by hand  : ${after.human}`);
console.log(`read_format = audio   : ${after.audio}`);

if (Number(after.derived) < stats.wouldMark) {
  console.log(
    `\n⚠️ Expected at least ${stats.wouldMark} rows stamped 'rating' and found ${after.derived}. ` +
      'That is not the arithmetic expected — read the statements above before re-running.',
  );
}

process.exit(0);
