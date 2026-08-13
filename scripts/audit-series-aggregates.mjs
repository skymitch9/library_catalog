/**
 * The standing alarm for Open Library work-level aggregates — tier 3 of the
 * bare-series-name rule (`catalog-platform/docs/info/matching-thresholds.md`
 * §6).
 *
 * ## What it looks for, and why exactly this
 *
 * Any work whose title equals a known series name AND which carries two or
 * more editions. That is the signature the 2026-08-13 corruption wore: a
 * scanned barcode resolved to an OL record titled bare *Space Knight*, and
 * the phantom work it minted absorbed six editions with six unrelated ISBNs
 * and six copies (works #300–#302, all cleaned up by hand that night). After
 * the cleanup this set is EMPTY in production — which is precisely what makes
 * it the right standing alarm: any row this prints is either the bug
 * recurring or a genuine edition-picker case, and both deserve an eyeball.
 *
 * ⚠️ A hit is a QUESTION, not a defect. *The Wandering Inn* is legitimately
 * titled with its series name and legitimately owned in two printings. This
 * script never writes anything; it exists so the question gets asked.
 *
 * ## Running it
 *
 *   npm run audit:series-aggregates                # local dev database
 *   npm run audit:series-aggregates -- --remote    # production, read-only
 *
 * Exits 1 when anything is flagged, 0 when the set is empty, so it can sit
 * at the end of a scanning session or in any future CI without ceremony.
 *
 * Runs under tsx (it imports the ONE normalisation implementation from
 * `@lc/core`'s source — a re-implemented fold here is how the sibling project
 * shipped three wrong games).
 */

import { foldSeriesNames, isBareSeriesTitle } from '../packages/core/src/matching.ts';
import { query } from './lib/d1.mjs';

const remote = process.argv.includes('--remote');

const seriesNames = query(
  `SELECT series FROM work WHERE series IS NOT NULL AND series <> ''
   UNION SELECT series FROM series_volume WHERE series IS NOT NULL AND series <> ''
   UNION SELECT series FROM series_check WHERE series IS NOT NULL AND series <> ''`,
  { remote },
).map((r) => r.series);

const seriesKeys = foldSeriesNames(seriesNames);

const works = query(
  `SELECT w.id AS id, w.title AS title, w.authors AS authors,
          COUNT(DISTINCT e.id) AS editions, COUNT(DISTINCT c.id) AS copies
     FROM work w
     JOIN edition e ON e.work_id = w.id
     LEFT JOIN copy c ON c.work_id = w.id
    GROUP BY w.id
   HAVING COUNT(DISTINCT e.id) >= 2
    ORDER BY editions DESC, w.id`,
  { remote },
);

const flagged = works.filter((w) => isBareSeriesTitle(w.title, seriesKeys));

const where = remote ? 'production' : 'local';
console.log(
  `${where}: ${seriesKeys.size} known series name(s), ` +
    `${works.length} work(s) with 2+ editions, ${flagged.length} flagged.`,
);

if (flagged.length === 0) {
  console.log('Clean — no series-titled work carries multiple editions.');
  process.exit(0);
}

console.log(
  '\n⚠️ Series-titled works with 2+ editions. Each is either the OL work-level\n' +
    'aggregate bug recurring (docs/TODO.md, 2026-08-13) or a real multi-printing\n' +
    'volume 1. A person should eyeball each one:\n',
);
for (const w of flagged) {
  console.log(
    `  #${String(w.id).padStart(4)}  ${w.title} — ${w.authors} ` +
      `(${w.editions} editions, ${w.copies} copies)`,
  );
}
process.exit(1);
