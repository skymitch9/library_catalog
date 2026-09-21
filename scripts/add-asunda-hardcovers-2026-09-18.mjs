/**
 * The Asunda hardcovers — six Stranger Comics collected editions, received
 * 2026-09-18 (owner: *"I received these 6 books as hardcovers. Can you add them
 * in"*, with a photo of the "Asunda Reading Order — Hardcovers and Trades"
 * insert that ships with the set).
 *
 * The set is exactly Stranger Comics' "Asunda Hardcover Bundle"
 * (https://www.strangercomics.com/products/asunda-hardcover-bundle, read
 * 2026-09-18): The Untamed 1–2, Niobe 1–2, Dusu, Erathune.
 *
 * ## What is MEASURED and what is not
 *
 * Every title, format, page count and credit below was read off the
 * hardcover's own product page on strangercomics.com on 2026-09-18
 * (`source_url` on each edition). ⚠️ **No ISBN is written, on purpose.** The
 * product pages show none, and the only ISBNs Open Library holds for these
 * titles are the TRADE PAPERBACKS' (e.g. 9781939834294 = Killing Floor TP,
 * 9781939834324 = Erathune TP) — writing one of those onto a hardcover row is
 * the wrong-medium defect `docs/info/isbn-ladder.md` §7 exists for. The
 * barcode on the physical book is the only honest source; the owner reads it
 * (✎ Edit this book → Editions & copies → ISBN) and the `note` says so.
 *
 * ⚠️ Until then the hand-run ISBN sweep (`scripts/backfill-missing-isbns.mjs`)
 * would consider these rows. Its title gate cannot tell a TP from a HC of the
 * same book, so the note carries the phrase the sweep's `declaresNoIsbn` guard
 * does NOT match on purpose — this is *not recorded*, not *does not exist* —
 * and whoever runs that sweep next reads the plan before `--commit`, as always.
 *
 * ## Shape
 *
 * One `work` per book (series = the sub-title's series, the reading-order
 * sheet's "(Volume N)" as the index), one `edition` (hardcover, publisher
 * Stranger Comics, the measured page count, `source 'manual'`), one `copy`
 * (`owned`, linked to the edition). `illustrator` carries the interior artist;
 * `authors` carries the credited writer(s) only — the same split the catalog
 * uses everywhere (`work.illustrator`, migration 0400 era).
 *
 * "Asunda" is the UNIVERSE these share, not a series. It is not in
 * `catalog-platform/data/universes.json` today, and a universe cannot be
 * created from here (it is the "+ Add a verse" request flow), so
 * `work.universe` stays NULL and that is a follow-up, not a guess.
 *
 * MAIN instance only — this is the owner's shelf. `--friend` is refused.
 *
 *   npx tsx scripts/add-asunda-hardcovers-2026-09-18.mjs --remote            # dry run
 *   npx tsx scripts/add-asunda-hardcovers-2026-09-18.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { primaryAuthor, sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
if (flags.friend) {
  console.error('refused: these are the OWNER\'s copies — main instance only, never --friend.');
  process.exit(2);
}
const target = { remote: flags.remote, friend: false };
const q = (sql) => query(sql, target);

const PUBLISHER = 'Stranger Comics';
const RECEIVED = '2026-09-18';
const COPY_NOTE =
  'Asunda Hardcover Bundle (6 hardcovers), received 2026-09-18. Added from the ' +
  '"Asunda Reading Order" insert that shipped with the set.';
const ISBN_NOTE =
  'Hardcover collected edition with 96 pages of bonus material. ISBN NOT RECORDED ' +
  'at entry (2026-09-18): the product page shows none and the only ISBNs online are ' +
  "the trade paperback's — read this printing's barcode off the book and enter it here.";

/** Reading order, top row then bottom row of the insert. */
const BOOKS = [
  {
    title: "The Untamed: A Sinner's Prayer",
    authors: 'Sebastian A. Jones',
    illustrator: 'Peter Bergting',
    series: 'The Untamed',
    vol: 1,
    pages: 304,
    url: 'https://www.strangercomics.com/products/the-untamed-a-sinners-prayer-vol-1-hardcovers',
  },
  {
    title: 'The Untamed: Killing Floor',
    authors: 'Sebastian A. Jones',
    illustrator: 'Peter Bergting',
    series: 'The Untamed',
    vol: 2,
    pages: 224,
    url: 'https://www.strangercomics.com/products/the-untamed-killing-floor-vol-2-hardcovers',
  },
  {
    title: 'Dusu: Path of the Ancient',
    authors: 'Sebastian A. Jones, Christopher Garner',
    illustrator: 'James C. Webster',
    series: 'Dusu',
    vol: 1,
    pages: 224,
    url: 'https://www.strangercomics.com/products/dusu-path-of-the-ancient-vol-1-hardcovers',
  },
  {
    title: 'Niobe: She is Life',
    authors: 'Sebastian A. Jones, Amandla Stenberg',
    illustrator: 'Ashley A. Woods',
    series: 'Niobe',
    vol: 1,
    pages: 224,
    url: 'https://www.strangercomics.com/products/niobe-she-is-life-vol-1-hardcovers',
  },
  {
    title: 'Niobe: She is Death',
    authors: 'Sebastian A. Jones',
    illustrator: 'Sheldon Mitchell',
    series: 'Niobe',
    vol: 2,
    pages: 224,
    url: 'https://www.strangercomics.com/products/niobe-she-is-death-vol-2-hardcovers',
  },
  {
    title: 'Erathune',
    authors: 'Sebastian A. Jones, Darrell May',
    illustrator: 'Sheldon Mitchell',
    series: 'Erathune',
    vol: 1,
    pages: 224,
    url: 'https://www.strangercomics.com/products/erathune-vol-1-hardcovers',
  },
];

const plan = BOOKS.map((b) => ({ ...b, key: workKeyFor(b.title, b.authors), primary: primaryAuthor(b.authors) }));

// Idempotent: a work that already exists by work_key is reported and skipped whole.
const held = new Map(
  q(`SELECT id, work_key FROM work WHERE work_key IN (${plan.map((p) => lit(p.key)).join(',')})`).map((r) => [
    r.work_key,
    r.id,
  ]),
);

const where = flags.remote ? 'production (MAIN)' : 'local';
console.log(`\n${where}: ${plan.length} Asunda hardcovers\n`);
for (const p of plan) {
  const at = held.has(p.key) ? `EXISTS work ${held.get(p.key)} — skip` : 'NEW work + hardcover edition + owned copy';
  console.log(`  ${p.title.padEnd(34)} ${p.series} #${p.vol}  ${String(p.pages)}pp  ${at}`);
  console.log(`    authors: ${p.authors}  |  illustrator: ${p.illustrator}  |  work_key: ${p.key}`);
}
console.log('\n  isbn13: NULL on every edition (see the header) · publisher: Stranger Comics · copy: owned, linked');

const fresh = plan.filter((p) => !held.has(p.key));
if (!fresh.length) {
  console.log('\nNothing to do — all six already exist.');
  process.exit(0);
}
if (!flags.commit) {
  console.log(`\nDRY RUN. Nothing written. ${fresh.length} to add. Re-run with --commit.\n`);
  process.exit(0);
}

execute(
  fresh.map(
    (p) =>
      `INSERT INTO work (title, authors, primary_author, work_key, sort_title, illustrator, series, series_index_sort, series_index_display)
       VALUES (${lit(p.title)}, ${lit(p.authors)}, ${lit(p.primary)}, ${lit(p.key)}, ${lit(sortTitleFor(p.title))},
               ${lit(p.illustrator)}, ${lit(p.series)}, ${p.vol}, ${lit(String(p.vol))});`,
  ),
  target,
);
const ids = new Map(
  q(`SELECT id, work_key FROM work WHERE work_key IN (${fresh.map((p) => lit(p.key)).join(',')})`).map((r) => [
    r.work_key,
    r.id,
  ]),
);
for (const p of fresh) p.workId = ids.get(p.key);
const missing = fresh.filter((p) => !p.workId);
if (missing.length) {
  console.error(`⚠️ ${missing.length} work(s) did not read back after INSERT; stopping before editions.`);
  process.exit(1);
}

execute(
  fresh.map(
    (p) =>
      `INSERT INTO edition (work_id, format, publisher, pages, language, source, source_url, note)
       VALUES (${p.workId}, 'hardcover', ${lit(PUBLISHER)}, ${p.pages}, 'en', 'manual', ${lit(p.url)}, ${lit(ISBN_NOTE)});`,
  ),
  target,
);
const eds = new Map(
  q(
    `SELECT id, work_id FROM edition WHERE source = 'manual' AND format = 'hardcover'
      AND work_id IN (${fresh.map((p) => p.workId).join(',')})`,
  ).map((r) => [r.work_id, r.id]),
);

execute(
  fresh.map(
    (p) =>
      `INSERT INTO copy (work_id, edition_id, status, acquired_on, notes)
       VALUES (${p.workId}, ${eds.get(p.workId) ?? 'NULL'}, 'owned', ${lit(RECEIVED)}, ${lit(COPY_NOTE)});`,
  ),
  target,
);

/* Confirm by re-reading — `execute` reports statements run, not rows changed. */
const after = q(
  `SELECT w.id, w.title, w.series, w.series_index_display AS vol, e.id AS edition, e.format, e.pages, e.isbn13, c.id AS copy, c.status, c.edition_id
     FROM work w LEFT JOIN edition e ON e.work_id = w.id LEFT JOIN copy c ON c.work_id = w.id
    WHERE w.id IN (${fresh.map((p) => p.workId).join(',')}) ORDER BY w.id`,
);
console.log('\nwrote — read back:');
for (const r of after) {
  console.log(
    `  work ${r.id}  ${String(r.title).padEnd(34)} ${r.series} #${r.vol}  edition ${r.edition} ${r.format} ${r.pages}pp isbn13=${r.isbn13 ?? 'NULL'}  copy ${r.copy} ${r.status} → edition ${r.edition_id}`,
  );
}
console.log(`\nreview: ${after.map((r) => `https://library.heygabi.ai/work/${r.id}`).join('  ')}\n`);
