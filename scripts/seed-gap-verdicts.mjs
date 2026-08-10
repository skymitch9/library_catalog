#!/usr/bin/env node
/**
 * Move the answers already in `scripts/series-overrides.json` into the database,
 * so the details queue stops asking questions this household has answered.
 *
 *   npm run seed:verdicts                     # dry run, LOCAL
 *   npm run seed:verdicts -- --remote         # dry run, production — READ THE LIST
 *   npm run seed:verdicts -- --remote --commit
 *
 * ## What it copies, and what it deliberately does not
 *
 * `series-overrides.json` records three verdicts: `series`, `standalone`,
 * `unknown`. Only the last two come here.
 *
 * - **`series`** (24 entries) is a *value*, and `npm run backfill:series` has
 *   already written it into `work.series`. A verdict row beside it would be a
 *   second copy of the same fact, free to drift.
 * - **`standalone`** (11) and **`unknown`** (2) are answers *about an absence*.
 *   The column stays null and the catalog needs to know why, or it re-researches
 *   them on every pass — with a paid model in the loop, literally re-buys them.
 *
 * Measured 2026-08-10: production holds 116 works, **13 with no series**, and
 * those 13 are exactly these 13 entries.
 *
 * ## ⚠️ Idempotent, and it must stay so
 *
 * `gap_verdict` has UNIQUE (work_id, field) and `setGapVerdict` upserts, so a
 * second run rewrites the same thirteen rows rather than adding thirteen more.
 * A re-run prints "13 already recorded, unchanged".
 *
 * ## ⚠️ The key is `work_key`, and it is read from the database
 *
 * The file is keyed on `normaliseTitle(title) + '|' + normaliseTitle(primaryAuthor)`.
 * This script never computes one — it selects `work_key` out of `work` and joins
 * on the string. `workKeyFor` is the ONE implementation (CLAUDE.md) and a second
 * one here, in a script, is exactly the drift this repo keeps warning about.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, execute, lit, parseFlags, query } from './lib/d1.mjs';

const { commit, remote } = parseFlags();
const where = remote ? 'REMOTE' : 'local';

const overrides = JSON.parse(
  readFileSync(path.join(ROOT, 'scripts', 'series-overrides.json'), 'utf8'),
);

/** `_doc`, `_why`, `_shape` … the file documents itself in keys that are not works. */
const entries = Object.entries(overrides).filter(([key]) => !key.startsWith('_'));

const answers = entries
  .filter(([, v]) => v.verdict === 'standalone' || v.verdict === 'unknown')
  .map(([workKey, v]) => ({
    workKey,
    // 'standalone' is this file's word for the same thing `gap_verdict` calls
    // 'none'. Translated here rather than in the table, because the file's
    // vocabulary is about series specifically and the table's is about any field.
    verdict: v.verdict === 'standalone' ? 'none' : 'unknown',
    sources: Array.isArray(v.source) ? v.source : v.source ? [v.source] : [],
    note: v.note ?? null,
  }));

console.log(`series-overrides.json: ${entries.length} entries, ${answers.length} of them answers about an absence.`);

// ⚠️ An entry with no source is a bug, not a shortcut — the file says so itself,
// and `gap_verdict.source` is NOT NULL. Refuse rather than invent one.
const unsourced = answers.filter((a) => a.sources.length === 0);
if (unsourced.length) {
  console.error(`\n${unsourced.length} entr${unsourced.length === 1 ? 'y has' : 'ies have'} no source:`);
  for (const a of unsourced) console.error(`  ${a.workKey}`);
  console.error('\nFix series-overrides.json. A verdict with no source cannot be told from data.');
  process.exit(1);
}

const rows = query(
  'SELECT id, work_key AS workKey, title, series FROM work WHERE series IS NULL OR series = \'\'',
  { remote },
);
console.log(`${rows.length} work(s) with no series in the ${where} database.`);

const byKey = new Map(rows.map((r) => [r.workKey, r]));
const existing = new Map(
  query("SELECT work_id AS workId, field, verdict FROM gap_verdict WHERE field = 'series'", {
    remote,
  }).map((r) => [r.workId, r.verdict]),
);

const statements = [];
let matched = 0;
let unchanged = 0;
const missing = [];

for (const a of answers) {
  const work = byKey.get(a.workKey);
  if (!work) {
    missing.push(a.workKey);
    continue;
  }
  matched += 1;
  if (existing.get(work.id) === a.verdict) {
    unchanged += 1;
    continue;
  }
  // The provenance the file carries, kept whole. Truncating it here would be
  // throwing away the one thing that makes the verdict checkable later.
  const source = a.sources.join(' · ');
  statements.push(
    `INSERT INTO gap_verdict (work_id, field, verdict, source, note)
     VALUES (${work.id}, 'series', ${lit(a.verdict)}, ${lit(source)}, ${lit(a.note)})
     ON CONFLICT (work_id, field) DO UPDATE SET
       verdict = excluded.verdict, source = excluded.source, note = excluded.note,
       decided_at = datetime('now');`,
  );
  console.log(
    `  ${a.verdict === 'none' ? 'no series  ' : 'unknown    '} ${work.title}  [${a.sources.length} source${a.sources.length === 1 ? '' : 's'}]`,
  );
}

if (missing.length) {
  console.log(`\n${missing.length} answer(s) have no matching work here (expected on a local database):`);
  for (const key of missing) console.log(`  ${key}`);
}

console.log(
  `\n${matched} matched, ${unchanged} already recorded and unchanged, ${statements.length} to write.`,
);

if (!commit) {
  console.log(`\nDRY RUN against the ${where} database. Re-run with --commit to write.`);
  process.exit(0);
}

if (statements.length === 0) {
  console.log('Nothing to write.');
  process.exit(0);
}

execute(statements, { remote });

// ⚠️ Confirmed by re-reading, never by the statement count. `execute` returns how
// many statements ran, not how many rows changed, and miniflare's D1 omits
// `meta.changes` entirely — see the note on `execute` in scripts/lib/d1.mjs.
const after = query(
  "SELECT COUNT(*) AS n FROM gap_verdict WHERE field = 'series'",
  { remote },
);
console.log(`Written. ${after[0]?.n ?? '?'} series verdict(s) now recorded in the ${where} database.`);
