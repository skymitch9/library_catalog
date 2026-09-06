/**
 * A `{ sql, binds }` statement list rendered as the SQL this project's scripts
 * have always written.
 *
 * ⚠️ **This file decides nothing.** The statements — which columns, in what
 * order, with which `ON CONFLICT` — come from `packages/db`, so the cron and the
 * recovery script cannot drift about what a sweep writes. This does the one
 * thing that is genuinely script-shaped: substitutes `lit()` for each `?` and
 * terminates the statement.
 *
 * ## Why the scripts interpolate at all
 *
 * `scripts/lib/d1.mjs` runs SQL through `wrangler d1 execute` against a temp
 * FILE, never `--command`: this shell is PowerShell and a multi-line statement
 * passed as an argument arrives with literal `\n` sequences in it. There is no
 * bind interface on that path, so the values have to be in the text — and `lit`
 * is the doubling-and-quoting rule that makes that safe.
 *
 * ⚠️ Extracted from `audiobook-sql.mjs` on 2026-09-05, when the series-volume
 * half of the audiobook cron needed the identical rendering. A second copy of
 * `fill` would be a second idea of how a value reaches SQL, which is the drift
 * `packages/core/src/matching.ts` opens by banning — met here in its most
 * dangerous form, since a placeholder miscount shifts every value one column to
 * the left in silence.
 */

import { lit } from './d1.mjs';

/**
 * Put the binds back into the text, in order.
 *
 * ⚠️ Positional and unescaped-by-construction: the shared SQL contains no `?`
 * inside a string literal (every literal in it is a column name, a source name
 * or the word `NULL`), so counting placeholders is exact rather than a parse.
 * The count is asserted rather than trusted — a mismatch would silently shift
 * every value one column to the left, which is the single worst thing this
 * function could do quietly.
 */
export function fill(sql, binds) {
  const holes = sql.split('?').length - 1;
  if (holes !== binds.length) {
    throw new Error(`statement has ${holes} placeholder(s) and ${binds.length} bind(s): ${sql}`);
  }
  let i = 0;
  return sql.replace(/\?/g, () => lit(binds[i++]));
}

/** Every statement of a list, rendered and terminated, in the list's order. */
export function renderStatements(statements) {
  return statements.map((s) => `${fill(s.sql, s.binds)};`);
}
