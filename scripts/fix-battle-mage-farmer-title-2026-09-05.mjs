#!/usr/bin/env node
/**
 * One-off, from the owner ask of 2026-09-05 16:37 Phoenix:
 * *"I added battle mage farmer and it didn't associate the audiobook right away."*
 *
 * ## What was wrong — a title carrying its own series and volume
 *
 * Work 526 was added 2026-09-05 22:10:43Z as
 * **"Battle Mage Farmer, Book 1: Domestication"**, with
 * `series_index_display = 'Book 1'`. Both halves are decoration this catalog
 * puts in COLUMNS, not in the title:
 *
 *   * work 221 is `The Primal Hunter`, series `The Primal Hunter`, display `1`;
 *   * work 263 is `Dungeon Crawler Carl`, series `Dungeon Crawler Carl`, display `1`.
 *
 * `scripts/fix-series-spelling-2026-08-15.mjs` fixed the display half of exactly
 * this shape once already ("Book 2" -> "2"), for the same reason: an index that
 * carries its own label is the rendered string, not the ordering.
 *
 * ## Why it matters beyond tidiness — the audiobook match
 *
 * `audiobook_catalog/site/catalog.csv` files the recording as
 * `Domestication - A Fantasy LitRPG Adventure (Battle Mage Farmer, Book 1)`,
 * which `cleanAudiobookTitle` reduces to **`Domestication`**. Nothing in
 * `packages/core/src/matching.ts` can reach that from a work titled "Battle Mage
 * Farmer, Book 1: Domestication" — containment runs the other way — so the
 * 2026-09-05 dry run listed the work under "no audiobook found" and mapped the
 * SERIES on the folded name alone (`fold`, 9 new rungs), the weakest claim the
 * ladder makes. After this edit the work matches and the series mapping is
 * corroborated by a work (`work_match`).
 *
 * ## ⚠️ This MOVES `work_key`, which is normally a migration
 *
 * `scripts/lib/d1.mjs` says in as many words that `work.title` is the one column
 * a backfill must never write, because it re-derives `work_key` — the join to
 * the shared Firestore reviews and TBR (`docs/info/identity-and-reviews.md`).
 * The exception taken here is the SAME one taken for the Pokémon Primers retitle
 * on 2026-08-31 (`docs/DONE.md`, batch `owner-2026-08-31-pokemon-primers`): a
 * work hours old with nothing joined to its key. MEASURED against production
 * before writing, and re-asserted by this script at run time:
 *
 *   * `user_book` rows for the work: **0**
 *   * `peer_holding` rows for the old key: **0**
 *   * `work_alias` rows: **0**
 *   * `work.reviews_seen_count`: **0**, observed 2026-09-05 22:11:35 — the
 *     browser looked and saw none, which is the guard migration 0120 built for
 *     ("a key-moving edit that claims 'no reviews' against a positive count is
 *     refused").
 *
 * The new key is computed by the canonical `workKeyFor`, never by hand, and
 * `sort_title` by the canonical `sortTitleFor`. Copying either rule into this
 * file would be a second implementation of a persisted key.
 *
 * ## Instances
 *
 * The work exists on MAIN only, but the script is keyed on `work_key` rather
 * than on id so `--friend` is meaningful: it reports 0 matched on padhard rather
 * than editing whatever row happens to be id 526 there.
 *
 *     npx tsx scripts/fix-battle-mage-farmer-title-2026-09-05.mjs --remote
 *     npx tsx scripts/fix-battle-mage-farmer-title-2026-09-05.mjs --remote --commit
 *     ... --remote --friend [--commit]
 *
 * Idempotent: a second run finds no row at the OLD key and exits 0 having
 * written nothing.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';
import { sortTitleFor, workKeyFor } from '../packages/core/src/titles.ts';

const flags = parseFlags();
const q = (sql) => query(sql, flags);

const BATCH = 'owner-2026-09-05-battle-mage-farmer';
const NOTE =
  'Owner ask 2026-09-05 16:37 Phoenix: "I added battle mage farmer and it didn\'t ' +
  'associate the audiobook right away." The title carried its own series and volume, ' +
  'so the audiobook catalog\'s "Domestication" could not match it and the series ' +
  'mapped on the folded name alone. Bare title + numeric display index is this ' +
  "catalog's convention (works 221, 263). work_key moved with the title via the " +
  'canonical workKeyFor; safe because the work was hours old with 0 user_book rows, ' +
  '0 peer_holding rows at the old key and reviews_seen_count = 0 — the same ' +
  'exception as batch owner-2026-08-31-pokemon-primers.';

const OLD_KEY = 'battle mage farmer book 1 domestication|seth ring';
const OLD_TITLE = 'Battle Mage Farmer, Book 1: Domestication';
const NEW_TITLE = 'Domestication';
const OLD_INDEX_DISPLAY = 'Book 1';
const NEW_INDEX_DISPLAY = '1';

const label = flags.friend ? 'padhard (library-catalog-2nd)' : 'main (library-catalog)';

const rows = q(
  `SELECT id, title, sort_title, authors, series, series_index_display, series_index_sort,
          work_key, reviews_seen_count
     FROM work WHERE work_key = ${lit(OLD_KEY)}`,
);

if (rows.length === 0) {
  console.log(`${label}: 0 work(s) at the old key — nothing to do.`);
  process.exit(0);
}
if (rows.length > 1) {
  throw new Error(`${label}: ${rows.length} works share ${OLD_KEY} — refusing to guess`);
}

const row = rows[0];
if (row.title !== OLD_TITLE) {
  throw new Error(
    `${label}: work ${row.id} title is ${JSON.stringify(row.title)}, expected ` +
      `${JSON.stringify(OLD_TITLE)} — refusing to overwrite a value this script was not written against`,
  );
}

// ---------------------------------------------------------------------------
// The key-move guards, re-asserted at run time rather than trusted from a doc
// ---------------------------------------------------------------------------
const [guards] = q(
  `SELECT (SELECT COUNT(*) FROM user_book    WHERE work_id = ${row.id})       AS user_books,
          (SELECT COUNT(*) FROM peer_holding WHERE work_key = ${lit(OLD_KEY)}) AS peers,
          (SELECT COUNT(*) FROM work_alias   WHERE work_id = ${row.id})       AS aliases`,
);
const blockers = [];
if (Number(guards.user_books) !== 0) blockers.push(`${guards.user_books} user_book row(s)`);
if (Number(guards.peers) !== 0) blockers.push(`${guards.peers} peer_holding row(s) at the old key`);
if (Number(guards.aliases) !== 0) blockers.push(`${guards.aliases} work_alias row(s)`);
if (row.reviews_seen_count !== null && Number(row.reviews_seen_count) > 0) {
  blockers.push(`reviews_seen_count = ${row.reviews_seen_count}`);
}
if (blockers.length) {
  throw new Error(
    `${label}: refusing to move work_key on work ${row.id} — ${blockers.join(', ')}. ` +
      'A key move is only harmless while nothing joins on it; this is a migration now.',
  );
}

const NEW_KEY = workKeyFor(NEW_TITLE, row.authors);
const NEW_SORT_TITLE = sortTitleFor(NEW_TITLE);

const clash = q(`SELECT id FROM work WHERE work_key = ${lit(NEW_KEY)} AND id <> ${row.id}`);
if (clash.length) {
  throw new Error(`${label}: work ${clash[0].id} already holds ${NEW_KEY} — refusing to collide`);
}

const EDITS = [
  { field: 'title', from: row.title, to: NEW_TITLE },
  { field: 'sort_title', from: row.sort_title, to: NEW_SORT_TITLE },
  { field: 'series_index_display', from: row.series_index_display, to: NEW_INDEX_DISPLAY },
  { field: 'work_key', from: row.work_key, to: NEW_KEY },
].filter((e) => e.from !== e.to);

if (row.series_index_display !== OLD_INDEX_DISPLAY && row.series_index_display !== NEW_INDEX_DISPLAY) {
  throw new Error(
    `${label}: series_index_display is ${JSON.stringify(row.series_index_display)}, expected ` +
      `${JSON.stringify(OLD_INDEX_DISPLAY)} — refusing to overwrite an unexpected value`,
  );
}

console.log(`${label}: work ${row.id}, ${EDITS.length} field(s) to change\n`);
for (const e of EDITS) {
  console.log(`  ${e.field.padEnd(22)} ${JSON.stringify(e.from)} -> ${JSON.stringify(e.to)}`);
}
console.log(
  `\n  series ${JSON.stringify(row.series)} and series_index_sort ${row.series_index_sort} ` +
    'are already right and are NOT touched. Neither is any edition or copy row.\n',
);

if (EDITS.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const stmts = [];
for (const e of EDITS) {
  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
       VALUES (${lit(BATCH)}, 'work', ${row.id}, ${lit(e.field)}, ${lit(JSON.stringify(e.from ?? null))}, ${lit(JSON.stringify(e.to))}, 1, 'human', ${lit(NOTE)});`,
  );
}
stmts.push(
  `UPDATE work SET ${EDITS.map((e) => `${e.field} = ${lit(e.to)}`).join(', ')}, updated_at = datetime('now') WHERE id = ${row.id};`,
);

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, flags);

const [after] = q(
  `SELECT id, title, sort_title, series, series_index_display, series_index_sort, work_key
     FROM work WHERE id = ${row.id}`,
);
console.log('\nAfter:');
console.log(`  #${after.id} ${JSON.stringify(after.title)}`);
console.log(`      sort_title=${JSON.stringify(after.sort_title)}`);
console.log(`      series=${JSON.stringify(after.series)} display=${JSON.stringify(after.series_index_display)} sort=${after.series_index_sort}`);
console.log(`      work_key=${JSON.stringify(after.work_key)}`);
const bad = EDITS.filter((e) => after[e.field] !== e.to);
if (bad.length) throw new Error(`${bad.length} field(s) did not take the new value`);
const [logged] = q(`SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ${lit(BATCH)}`);
console.log(`\nOK: ${EDITS.length} field(s) live, ${logged.n} change_log row(s) in batch ${BATCH}.`);
