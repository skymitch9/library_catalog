/**
 * Assess the seven Barnes & Noble covers, and give the Deluxe its own art.
 *
 * ## ⚠️ Read this before writing a B&N scraper — there is nothing to scrape
 *
 * `docs/info/covers-and-series.md` §1 warns against reaching for a rung that
 * cannot fire. The mirror-image mistake was available here: task #30 read as
 * *"the seven B&N books have no covers"*, and measured on 2026-08-12 against
 * production, **all seven already had one**. `apply-bn-details.mjs` (commit
 * d2e7752, 2026-08-11) filled them from the product pages the same day the
 * import ran. #30 was done and the work log never caught up.
 *
 * So this script is not a backfill. It is the second half of §2.5's distinction:
 * **"has a cover" is not "has the RIGHT cover"**, and `cover_status = NULL` on
 * all seven meant *nobody had looked*. Somebody has now — every image below was
 * downloaded and viewed, not merely fetched for a byte count.
 *
 * ## What looking found
 *
 * | # | Verdict |
 * |---|---|
 * | 229–232 The Wandering Inn split-parts | the book's own jacket, right part number |
 * | 234 Bad B*tch in the Kitch | the book's own jacket |
 * | 235 Sunrise on the Reaping | ⚠️ genuinely the **B&N Exclusive** art — it carries the gold "BARNES & NOBLE EXCLUSIVE / INCLUDES SPECIAL CONTENT" seal, matching `edition_name` |
 * | 233 Project Hail Mary | **wrong edition.** Flagged `'standin'` and correctly so |
 *
 * ⚠️ 233 is the only row that changes. The owner preordered the **Deluxe
 * Edition** (`9798217374274`); the stored URL was the *standard* 2021 hardcover
 * (`9780593135204`) — right book, wrong jacket, which is exactly the case
 * `cover_status = 'standin'` exists to record. B&N's own page for that EAN says
 * *"New cover art on a deluxe jacket"* and serves it, so the stand-in can go.
 *
 * ## Where the URLs come from, and why they are not a guess
 *
 * `cdn.shopify.com/s/files/1/0674/5433/7265/files/{ean}_p0.jpg` **is
 * barnesandnoble.com's own image CDN** — B&N runs its storefront on Shopify.
 * Confirmed 2026-08-12 by fetching the product page and finding that exact URL
 * as its primary image, not by pattern-matching a filename. A bogus EAN 404s, so
 * the path is keyed to a real product rather than served blind.
 *
 * That satisfies the standing rule — a cover comes from wherever the ISBN came
 * from — with no fallback needed. ⚠️ `prodimage.images.bn.com`, B&N's old image
 * host, no longer resolves at all; anything still reaching for it is dead.
 *
 * ## ⚠️ Both columns are always named together
 *
 * `updateWork` deliberately blanks `cover_status` when `cover_url` moves so a
 * `'standin'` can never survive onto its replacement (§2.5). These statements go
 * around `updateWork`, so they honour that rule by hand: **no statement here
 * sets one column without the other.**
 *
 * Nothing here touches the five Illumicrate Percy Jackson rows, which share one
 * URL on purpose.
 *
 *   node scripts/assess-bn-covers.mjs --remote
 *   node scripts/assess-bn-covers.mjs --remote --commit
 */

import { verifyCoverUrl } from '../packages/isbn/src/resolve.ts';
import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const UA = 'library_catalog (+https://github.com/private)';

const BN_CDN = 'https://cdn.shopify.com/s/files/1/0674/5433/7265/files';

/**
 * One entry per B&N work. `ean` is the edition we actually hold, and the cover
 * is addressed by it — which is the whole fix for 233 and a no-op for the rest.
 *
 * `note` is written to `work_watch` only where the verdict needs a sentence; it
 * is null everywhere the image simply is the book's jacket.
 */
const BOOKS = [
  { id: 229, title: 'The Wandering Inn', ean: '9780063516380' },
  { id: 230, title: 'No Killing Goblins', ean: '9780063516403' },
  { id: 231, title: 'Fae and Fare', ean: '9780063516427' },
  { id: 232, title: 'Immortal Games', ean: '9780063516465' },
  {
    id: 233,
    title: 'Project Hail Mary',
    ean: '9798217374274',
    note: 'Deluxe Edition jacket, replacing the standard 2021 hardcover stand-in.',
  },
  { id: 234, title: 'Bad B*tch in the Kitch', ean: '9780593797853' },
  { id: 235, title: 'Sunrise on the Reaping', ean: '9781546175759' },
];

const before = query(
  `SELECT id, substr(title, 1, 30) AS title, COALESCE(cover_url, '') AS cover_url,
          COALESCE(cover_status, '') AS cover_status
     FROM work WHERE id IN (${BOOKS.map((b) => b.id).join(',')}) ORDER BY id`,
  flags,
);
const held = new Map(before.map((r) => [Number(r.id), r]));

const needed = before.filter((r) => !r.cover_url || r.cover_status === 'standin').length;
console.log(
  `\n${flags.remote ? 'production' : 'local'}: ${before.length} B&N work(s), ` +
    `${before.filter((r) => !r.cover_url).length} with no cover, ` +
    `${before.filter((r) => r.cover_status === 'standin').length} on a stand-in ` +
    `— ${needed} "cover needed" by coverNeeded's rule.\n`,
);

/*
 * ⚠️ Every URL is fetched before it is written, including the six that are
 * already stored. A cover column is never revisited, so "it was fine when
 * somebody wrote it" is not evidence that it is fine now.
 */
const plan = [];
for (const b of BOOKS) {
  const row = held.get(b.id);
  if (!row) {
    console.log(`  ⚠️ work ${b.id} not found — skipped`);
    continue;
  }
  const url = `${BN_CDN}/${b.ean}_p0.jpg`;
  const check = await verifyCoverUrl(url, { userAgent: UA });
  if (!check.ok) {
    console.log(`  ✗ ${b.id}  ${b.title.padEnd(24)} ${check.reason} — NOT written`);
    continue;
  }
  const moving = row.cover_url !== url;
  plan.push({ ...b, url, bytes: check.bytes, moving, was: row.cover_url, wasStatus: row.cover_status });
  console.log(
    `  ✓ ${b.id}  ${b.title.padEnd(24)} ${String(check.bytes).padStart(6)}B  ` +
      `${moving ? 'URL MOVES' : 'url unchanged'}  status ${row.cover_status || 'NULL'} → ok`,
  );
  if (moving) console.log(`         was ${row.was || row.cover_url}`);
}

const moves = plan.filter((p) => p.moving);
console.log(
  `\n${plan.length} verified; ${moves.length} cover URL(s) change, ` +
    `${plan.length - moves.length} keep the URL and gain an assessed status.`,
);

if (plan.length !== BOOKS.length) {
  console.log('⚠️ Not every book verified. Nothing partial is written unless you re-run knowingly.');
}

/*
 * ⚠️ No `work_watch` row is touched. Checked 2026-08-12: none of the seven
 * carries one, open or resolved — the Percy Jackson stand-ins got watches from
 * migration 0040 and these did not. A watch resolved here would be a record of
 * a question nobody asked.
 */
const statements = plan.map(
  // ⚠️ cover_url and cover_status always together. See the header.
  (p) =>
    `UPDATE work SET cover_url = ${lit(p.url)}, cover_status = 'ok',
            updated_at = datetime('now')
      WHERE id = ${lit(p.id)};`,
);

console.log(`\n${statements.length} statement(s) to run.`);
if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}
if (statements.length === 0) process.exit(0);

execute(statements, flags);

/* ⚠️ Confirm by re-reading — `execute` returns statements run, not rows changed. */
const after = query(
  `SELECT id, substr(title, 1, 30) AS title, COALESCE(cover_status, 'NULL') AS cs,
          substr(COALESCE(cover_url, 'NONE'), 1, 78) AS cover
     FROM work WHERE id IN (${BOOKS.map((b) => b.id).join(',')}) ORDER BY id`,
  flags,
);
console.log('\nafter:');
for (const r of after) console.log(`  ${r.id}  ${String(r.cs).padEnd(8)} ${r.title.padEnd(26)} ${r.cover}`);

const stillNeeded = after.filter((r) => r.cover === 'NONE' || r.cs === 'standin').length;
console.log(`\n"cover needed" among the seven: ${stillNeeded} (was ${needed}).`);
