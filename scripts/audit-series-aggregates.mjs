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
 * ## ⚠️ THE ALARM HAS A CLOCK NOW — 2026-09-06
 *
 * This file called itself *"the standing alarm"* and had no cadence at all;
 * nothing ran it, and nothing noticed that nothing ran it. The platform
 * inventory named that exactly (§7 row #5: *"a standing alarm with no clock is
 * the exact failure this ask is about"*), so it also fires daily in the Worker
 * on both instances now — `apps/worker/src/lib/series-aggregates-run.ts`,
 * reported on `/api/health` under `detail.seriesAggregates`. Runbook:
 * `docs/access/audits.md`.
 *
 * **This script is not retired.** It is the attended form: run it after a
 * scanning session and read the answer immediately, instead of waiting for
 * 02:47. What it no longer does is keep its own copy of the rule — the filter
 * and the report text both live in `packages/core/src/audits.ts` and are shared
 * with the route, so the two cannot drift. The printed output is byte-identical
 * to the pre-conversion script, and that is measured:
 * `packages/core/test/audits.test.ts` keeps the old inline logic verbatim as an
 * oracle and compares.
 *
 * ## Running it
 *
 *   npm run audit:series-aggregates                          # local dev database
 *   npm run audit:series-aggregates -- --remote              # main, read-only
 *   npm run audit:series-aggregates -- --remote --friend     # padhard, read-only
 *
 * ## 🔴 `--friend` was MISSING until 2026-09-06, and that is the 2026-08-22 bug again
 *
 * This script passed `{ remote }` to `query()` and nothing else, so `dbName()`
 * resolved to the MAIN database on every run and **the alarm had never once
 * looked at padhard**. It is the same shape as the defect fixed in
 * `check-cover-health.mjs` on 2026-08-22 (that one switched the fetch BASE to
 * padhard while still reading main's rows) and the same shape as
 * `scripts/lib/d1.mjs`'s hardcoded `DB_NAME`, which is why the second instance
 * could not be maintained at all until that day.
 *
 * ⚠️ It was invisible because the alarm's normal answer is EMPTY. A clean run
 * against main looks exactly like a clean run against a catalog nobody read —
 * and it was found only because the ROUTE half runs on both instances, which
 * made the script the lagging one.
 *
 * ⚠️ `--friend` needs `--remote`; `dbName()` refuses the combination rather
 * than silently reading main. See its comment for why.
 *
 * Exits 1 when anything is flagged, 0 when the set is empty, so it can sit
 * at the end of a scanning session or in any future CI without ceremony.
 *
 * Runs under tsx (it imports the ONE normalisation implementation from
 * `@lc/core`'s source — a re-implemented fold here is how the sibling project
 * shipped three wrong games).
 */

import {
  auditSeriesAggregates,
  formatSeriesAggregateReport,
} from '../packages/core/src/audits.ts';
import { parseFlags, query } from './lib/d1.mjs';

// ⚠️ The whole flag object, not a hand-made `{ remote }` — that is what made the
// alarm blind to padhard. `query()` picks the DATABASE off `friend`, so the two
// must travel together and be read from one place.
const flags = parseFlags();
const remote = flags.remote;

const seriesNames = query(
  `SELECT series FROM work WHERE series IS NOT NULL AND series <> ''
   UNION SELECT series FROM series_volume WHERE series IS NOT NULL AND series <> ''
   UNION SELECT series FROM series_check WHERE series IS NOT NULL AND series <> ''`,
  flags,
).map((r) => r.series);

const works = query(
  `SELECT w.id AS id, w.title AS title, w.authors AS authors,
          COUNT(DISTINCT e.id) AS editions, COUNT(DISTINCT c.id) AS copies
     FROM work w
     JOIN edition e ON e.work_id = w.id
     LEFT JOIN copy c ON c.work_id = w.id
    GROUP BY w.id
   HAVING COUNT(DISTINCT e.id) >= 2
    ORDER BY editions DESC, w.id`,
  flags,
);

const findings = auditSeriesAggregates({ seriesNames, works });

// ⚠️ `production` and `local` are unchanged for the two invocations that
// existed before 2026-09-06, so their printed output is still byte-identical.
// The third label is new because the third target is.
const where = flags.friend ? 'padhard (production)' : remote ? 'production' : 'local';
console.log(formatSeriesAggregateReport(findings, where));

process.exit(findings.flagged.length === 0 ? 0 : 1);
