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
 * `{ sql, binds }` — and the one genuinely script-shaped step, substituting
 * `lit()` for each `?` and terminating the statement, is `renderStatements` in
 * `sweep-sql.mjs`. ⚠️ It moved there on 2026-09-05 when the series-volume half
 * of the same cron needed the identical rendering; a second copy of `fill` would
 * be a second idea of how a value reaches SQL.
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
import { renderStatements } from './sweep-sql.mjs';

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
  return renderStatements(audiobookSweepStatements(plan));
}
