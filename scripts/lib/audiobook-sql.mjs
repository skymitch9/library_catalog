/**
 * A `SweepPlan` rendered as the SQL this project's scripts have always written.
 *
 * ⚠️ **This file no longer decides anything, and that is the change.** It used
 * to hold its own copy of every INSERT and UPDATE the sweep writes, beside the
 * Worker's copy in `packages/db/src/audiobook-holdings.ts` — two renderers over
 * one plan, which was §2.3 of
 * `catalog-platform/docs/info/audiobook-association-route.md` read one step too
 * literally. The planner returns DATA because the two callers BIND differently;
 * it does not follow that they should each know their own column list. A second
 * copy of "which columns a sweep writes, in what order" is the shape
 * `matching.ts` opens by warning about, and here a drift would mean the cron and
 * the recovery script quietly disagreeing about what the catalog says.
 *
 * So the statements come from `audiobookSweepStatements` — ONE list, as
 * `{ sql, binds }` — and this file does the one thing that is genuinely
 * script-shaped: substitutes `lit()` for each `?` and terminates the statement.
 *
 * ## Why the script interpolates at all
 *
 * `scripts/lib/d1.mjs` runs SQL through `wrangler d1 execute` against a temp
 * FILE, never `--command`: this shell is PowerShell and a multi-line statement
 * passed as an argument arrives with literal `\n` sequences in it. There is no
 * bind interface on that path, so the values have to be in the text — and `lit`
 * is the doubling-and-quoting rule that makes that safe.
 *
 * ## Why this file still exists rather than the backfill inlining it
 *
 * `scripts/backfill-audiobook-holdings.mjs` reads two databases at import time,
 * so nothing can import it to test it. Extracting the rendering is what lets
 * `scripts/test/backfill-audiobook-holdings.test.mjs` pin the exact SQL for a
 * fixture plan — "the plan is right" and "the SQL written from it is right" are
 * two different claims and the second one had no test at all before that.
 *
 * ⚠️ **The rendered bytes are unchanged by the consolidation, and the pinned
 * strings in that test are what proves it.** The phase-0 gate was a
 * byte-identical `--remote` dry run; the SQL text in `audiobook-holdings.ts` is
 * written as the single-line text these concatenations produced, with `?` where
 * a `${lit(...)}` used to be.
 *
 * ⚠️ The statement ORDER is part of the contract — edition upserts, edition
 * stales, rung upserts, rung stales — and it is the shared list's order now, not
 * this file's.
 */

import { audiobookSweepStatements } from '../../packages/db/src/audiobook-holdings.ts';
import { lit } from './d1.mjs';

/**
 * Put the binds back into the text, in order.
 *
 * ⚠️ Positional and unescaped-by-construction: the shared SQL contains no `?`
 * inside a string literal (every literal in it is a column name or the word
 * `NULL`), so counting placeholders is exact rather than a parse. The count is
 * asserted rather than trusted — a mismatch would silently shift every value
 * one column to the left, which is the single worst thing this function could
 * do quietly.
 */
function fill(sql, binds) {
  const holes = sql.split('?').length - 1;
  if (holes !== binds.length) {
    throw new Error(`statement has ${holes} placeholder(s) and ${binds.length} bind(s): ${sql}`);
  }
  let i = 0;
  return sql.replace(/\?/g, () => lit(binds[i++]));
}

/**
 * Every statement for one plan, in the order the script has always run them.
 *
 * Idempotent by construction: every INSERT carries its `ON CONFLICT … DO UPDATE`
 * and sets `last_seen_at = datetime('now'), stale_at = NULL`, so a second run
 * inside one minute produces the same rows. **Marked, never deleted** —
 * migration 0010's rule: a row vanishing looks identical to the audiobook having
 * gone away.
 */
export function renderSweepStatements(plan) {
  return audiobookSweepStatements(plan).map((s) => `${fill(s.sql, s.binds)};`);
}
