#!/usr/bin/env node
/**
 * Derive `ebook_holding` rows (migration 0310) from this catalog's OWN ebook
 * edition rows, and report whether the two representations agree — phase 4 of
 * the ebook split (`catalog-platform/docs/info/ebook-split-design.md`).
 *
 * ## ⚠️ This is `backfill-audiobook-holdings.mjs`'s twin, minus the matcher —
 * and the minus is the point
 *
 * The audiobook backfill has to MATCH: its source is another catalog's CSV,
 * joined by title and author through the project's one matcher, with every
 * hedge that entails. This one does not. The ebook ingest already decided
 * which work each file belongs to — `edition.work_id` is that decision,
 * stored — so the derivation is a projection over stored keys and nothing
 * else. **No title is folded, no `work_key` recomputed, no matcher run.**
 * That is what makes the shadow comparison honest: the holding rows and the
 * edition rows record the SAME fact, so when the UI shows them side by side,
 * agreement means "the cache is faithful", not "two algorithms happened to
 * concur".
 *
 * After phase 5 prunes the editions, this script's source is gone and the
 * backfill must learn to read `site/ebooks.json` and match the way the
 * audiobook one does. That is a widening of `derived_via` (a CHECK change —
 * a decision, not a drift) and is deliberately NOT built yet.
 *
 * ## Why a script and not a route
 *
 * Same answer as the audiobook backfill: the Worker only ever reads the
 * table. One writer, and it is this file — migration 0310's header names it.
 *
 * ## The agreement report is the deliverable
 *
 * Phase 4's verification is "holding rows == works carrying an ebook edition,
 * and the chip agrees with the edition-derived display for every work". So
 * the end of every run — dry or committed — prints the agreement census:
 * how many works say ebook by edition, by holding, by both, and WHICH works
 * disagree, by id and title. Phase 5 must not start until the disagreement
 * lists are empty. (Read the rows, not the totals — the review backfill's
 * dry run once said 860/860 while writing keys nothing could match.)
 *
 * ## Usage
 *
 *     npm run backfill:ebooks                        # dry run, local
 *     npm run backfill:ebooks -- --commit
 *     npm run backfill:ebooks -- --remote            # dry run, READ THE LIST
 *     npm run backfill:ebooks -- --remote --commit
 *
 * Idempotent. A second run reports nothing new, and a work that no longer
 * carries an ebook edition is marked `stale_at` rather than deleted —
 * migration 0003's rule, because a row vanishing looks identical to the
 * ebook having been deleted from the library.
 *
 * ⚠️ Requires migration 0310. Against a database without it, every statement
 * fails with `no such table: ebook_holding`.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { deriveEbookHoldings, ebookAgreement } from '../packages/core/src/ebook-holding.ts';
import { EBOOK_FILE_FORMATS } from '../packages/core/src/constants.ts';

const flags = parseFlags();

// ---------------------------------------------------------------------------
// What the editions record
// ---------------------------------------------------------------------------

const formatList = EBOOK_FILE_FORMATS.map((f) => `'${f}'`).join(', ');

// One row per ebook file edition, with the work's own title and authors riding
// along — stored values, read to be STORED AGAIN in the holding, never folded.
const editionRows = query(
  `SELECT e.work_id, e.format, e.source, e.source_url, w.title, w.authors
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.format IN (${formatList})
    ORDER BY e.work_id, e.id`,
  flags,
);

const totalWorks = query('SELECT COUNT(*) AS n FROM work', flags)[0].n;
console.log(
  `${editionRows.length} ebook file edition(s) across the ${flags.remote ? 'REMOTE' : 'local'}` +
    ` database's ${totalWorks} work(s)`,
);

const existing = query('SELECT work_id, formats, stale_at FROM ebook_holding', flags);
const held = new Map(existing.map((r) => [Number(r.work_id), r]));

// ⚠️ Zero ebook editions with holdings already present is not "the library
// dropped its ebooks" — before phase 5 it means the query hit the wrong
// database, and running on would mark every holding stale. Fail loudly, the
// same guard the audiobook backfill and --prune both carry. (After phase 5
// prunes the editions this whole script is retired in favour of the
// manifest-reading form — see the header — so the guard never fires "wrongly".)
if (editionRows.length === 0 && existing.length > 0) {
  console.error(
    '\nNo ebook file editions were read, but ebook_holding has rows. Running on\n' +
      'would mark every holding stale. If phase 5 has pruned the editions, this\n' +
      "script's source is gone by design — do not run it; the manifest-reading\n" +
      'replacement is the phase 5+ deliverable.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Derive — pure, in @lc/core, tested without a database
// ---------------------------------------------------------------------------

const plans = deriveEbookHoldings(
  editionRows.map((r) => ({
    workId: Number(r.work_id),
    format: r.format,
    source: r.source,
    sourceUrl: r.source_url ?? null,
  })),
);

// title/authors by work, from the SAME rows — no second query to drift.
const workFacts = new Map();
for (const r of editionRows) {
  if (!workFacts.has(Number(r.work_id))) {
    workFacts.set(Number(r.work_id), { title: r.title, authors: r.authors ?? null });
  }
}

const statements = [];
for (const p of plans) {
  const facts = workFacts.get(p.workId);
  statements.push(
    `INSERT INTO ebook_holding (work_id, title, authors, formats, source_path, edition_source, derived_via)` +
      ` VALUES (${lit(p.workId)}, ${lit(facts.title)}, ${lit(facts.authors)},` +
      ` ${lit(p.formats.join(', '))}, ${lit(p.sourcePath)}, ${lit(p.editionSource)}, 'edition')` +
      ` ON CONFLICT(work_id) DO UPDATE SET` +
      ` title = excluded.title, authors = excluded.authors, formats = excluded.formats,` +
      ` source_path = excluded.source_path, edition_source = excluded.edition_source,` +
      ` derived_via = excluded.derived_via,` +
      ` last_seen_at = datetime('now'), stale_at = NULL;`,
  );
}

// A holding whose work no longer carries an ebook edition. Marked, never
// deleted — see the header.
const plannedIds = new Set(plans.map((p) => p.workId));
const goneStale = [...held.values()].filter(
  (r) => !plannedIds.has(Number(r.work_id)) && !r.stale_at,
);
for (const r of goneStale) {
  statements.push(
    `UPDATE ebook_holding SET stale_at = datetime('now')` +
      ` WHERE work_id = ${lit(r.work_id)} AND stale_at IS NULL;`,
  );
}

// ---------------------------------------------------------------------------
// ⚠️ Read the rows, not the totals — the agreement census
//
// This is the run's real output. `ebookAgreement` is the same function the
// work page's shadow chip calls, so the console and the UI cannot disagree
// about what "agree" means.
// ---------------------------------------------------------------------------

const fresh = plans.filter((p) => !held.has(p.workId));
const revived = plans.filter((p) => held.get(p.workId)?.stale_at);

console.log('');
console.log(`holding rows to upsert   ${plans.length}  (${fresh.length} new, ${revived.length} revived from stale)`);
console.log(`holdings going stale     ${goneStale.length}`);
console.log('');

for (const p of plans) {
  const facts = workFacts.get(p.workId);
  const mark = held.has(p.workId) ? (held.get(p.workId).stale_at ? 'revive' : '      ') : 'NEW   ';
  console.log(
    `  ${mark} #${String(p.workId).padEnd(4)} [${p.formats.join(', ')}] ${facts.title}` +
      (p.editionSource === 'manual' ? '  (manual edition — no file path)' : ''),
  );
}

if (goneStale.length) {
  console.log('');
  console.log('going stale (work no longer carries an ebook edition):');
  for (const r of goneStale) console.log(`  #${r.work_id}`);
}

// The census over EVERY work, computed as the database will stand AFTER this
// run — that is the number phase 5 gates on.
const worksWithEbookEdition = new Set(plans.map((p) => p.workId));
const liveHoldingsAfter = new Set(plans.map((p) => p.workId)); // upserts un-stale their rows
const allWorkIds = query('SELECT id, title FROM work ORDER BY id', flags);

const census = { both: 0, neither: 0, edition_only: 0, holding_only: 0 };
const disagreements = [];
for (const w of allWorkIds) {
  const id = Number(w.id);
  const verdict = ebookAgreement(
    worksWithEbookEdition.has(id) ? ['ebook_epub'] : [],
    liveHoldingsAfter.has(id),
  );
  census[verdict]++;
  if (verdict === 'edition_only' || verdict === 'holding_only') {
    disagreements.push({ id, title: w.title, verdict });
  }
}

console.log('');
console.log('agreement census, as the database will stand after this run:');
console.log(`  agree — ebook both ways     ${census.both}`);
console.log(`  agree — ebook neither way   ${census.neither}`);
console.log(`  DISAGREE — edition only     ${census.edition_only}`);
console.log(`  DISAGREE — holding only     ${census.holding_only}`);
if (disagreements.length) {
  console.log('');
  console.log('⚠️ disagreements — phase 5 must not start while this list is non-empty:');
  for (const d of disagreements) console.log(`  [${d.verdict}] #${d.id} ${d.title}`);
}

console.log('');
console.log(`${statements.length} statement(s) to run.`);

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.');
  process.exit(0);
}

const sent = execute(statements, flags);

// Confirm by re-reading. `execute` cannot report rows changed — miniflare
// omits `meta.changes` entirely; see scripts/lib/d1.mjs.
const after = query(
  `SELECT (SELECT COUNT(*) FROM ebook_holding) AS all_rows,
          (SELECT COUNT(*) FROM ebook_holding WHERE stale_at IS NULL) AS live_rows,
          (SELECT COUNT(DISTINCT work_id) FROM edition WHERE format IN (${formatList})) AS edition_works`,
  flags,
)[0];

console.log(
  `\n${sent} statement(s) run. ${after.live_rows ?? 0} live holding(s) of ${after.all_rows} row(s)` +
    ` against ${after.edition_works} work(s) carrying an ebook edition, in the` +
    ` ${flags.remote ? 'REMOTE' : 'local'} database.` +
    (Number(after.live_rows) === Number(after.edition_works)
      ? ' The two representations AGREE.'
      : ' ⚠️ COUNTS DIFFER — read the census above.'),
);
