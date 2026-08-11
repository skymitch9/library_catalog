/**
 * Mark *The Divine Dungeon Complete Series* (work 106) as the bind-up it is,
 * and give its one epub a page count.
 *
 * The owner asked, 2026-08-11: *"add 2258 pages to that omnibus. make sure its
 * marked as an omnibus so it shows up with also owning each line item as
 * audio."* Three separate writes, because those are three different facts:
 *
 *   1. `edition.pages`    — how long this printing is
 *   2. `edition.collects` — what is bound inside it
 *   3. `work_relation`    — which OTHER ROWS in this catalog are inside it
 *
 * ## ⚠️ 2,258 is a convention, not a measurement
 *
 * The epub declares **no page count**: no `page-list` in its nav and zero
 * `epub:type="pagebreak"` markers, checked in the file. What *is* measured is
 * 564,399 words across 258 documents. 2,258 is that at 250 words/page, the
 * trade-paperback convention this genre is set at. The `collects` prose says so,
 * because a bare "2258" in a column reads like something someone counted.
 *
 * ## ⚠️ Only ONE of the five books is a row here
 *
 * Production holds *Dungeon Born* (work 7) and this omnibus (work 106). Books
 * 2-5 are not rows, so exactly one `contains` relation can be written honestly.
 * Migration 0060 is explicit that inventing the other four would be worse than
 * omitting them — *"a guessed title is a permanent duplicate, which is the one
 * failure POST /api/works not deduping makes unrecoverable"* — and `collects`
 * is the column that carries the full statement in the meantime.
 *
 * ⚠️ `contains` is DIRECTIONAL. from = container, to = contained. Reversed it is
 * not an untidy duplicate, it is the false claim that *Dungeon Born* contains
 * the omnibus. Migration 0004 calls this out by name, with this exact pair.
 *
 * ## Where "owns each line item as audio" actually comes from
 *
 * Not this script. `audiobook_series_holding` (migration 0090), written by
 * `backfill-audiobook-holdings.mjs`, which matched The Divine Dungeon at
 * `work_match` on all five rungs — the tier that requires title, author, series
 * AND volume to agree, so the ladder renders AUDIO rather than the AUDIO? hedge.
 * This script only makes the omnibus itself legible next to that.
 *
 *   node scripts/mark-divine-dungeon-omnibus.mjs            # dry run
 *   node scripts/mark-divine-dungeon-omnibus.mjs --commit
 *   node scripts/mark-divine-dungeon-omnibus.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();

const OMNIBUS_WORK = 106;
const EPUB_EDITION = 191;
const DUNGEON_BORN = 7;

const PAGES = 2258;

/**
 * Prose, not a range — migration 0060 chose free text precisely so a bind-up
 * can state its own caveat. The five titles are the published Divine Dungeon
 * run, corroborated by the household owning all five on audio.
 */
const COLLECTS =
  'Books 1-5 complete: Dungeon Born, Dungeon Madness, Dungeon Calamity, ' +
  'Dungeon Desolation, Dungeon Eternium. ~2,258 pages is 564,399 words at 250 ' +
  'words/page - the epub declares no page count of its own.';

const NOTE =
  'Book 1 of 5 in this bind-up. The other four are not rows in this catalog; ' +
  'edition.collects names them.';

const q = (sql) => query(sql, { remote: flags.remote });

const before = q(
  `SELECT e.id, e.pages, e.collects, w.title
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.id = ${lit(EPUB_EDITION)}`,
);

if (!before.length) {
  console.error(`edition ${EPUB_EDITION} does not exist in the ${flags.remote ? 'REMOTE' : 'local'} database.`);
  process.exit(1);
}

const row = before[0];
console.log(`\n${flags.remote ? 'REMOTE' : 'local'} database — edition ${EPUB_EDITION} of "${row.title}"\n`);
console.log(`  pages    : ${row.pages ?? 'NULL'}  ->  ${PAGES}`);
console.log(`  collects : ${row.collects ?? 'NULL'}`);
console.log(`             -> ${COLLECTS}`);

const rel = q(
  `SELECT id FROM work_relation
    WHERE from_work_id = ${lit(OMNIBUS_WORK)} AND to_work_id = ${lit(DUNGEON_BORN)}
      AND relation = 'contains'`,
);
console.log(`\n  contains : work ${OMNIBUS_WORK} -> work ${DUNGEON_BORN} (Dungeon Born)`);
console.log(`             ${rel.length ? 'already present, will not duplicate' : 'will be created'}`);

if (!flags.commit) {
  console.log('\nDRY RUN. Nothing written. Re-run with --commit.\n');
  process.exit(0);
}

const statements = [
  `UPDATE edition SET pages = ${lit(PAGES)}, collects = ${lit(COLLECTS)}, ` +
    `updated_at = datetime('now') WHERE id = ${lit(EPUB_EDITION)};`,
];

if (!rel.length) {
  statements.push(
    `INSERT INTO work_relation (from_work_id, to_work_id, relation, note) VALUES ` +
      `(${lit(OMNIBUS_WORK)}, ${lit(DUNGEON_BORN)}, 'contains', ${lit(NOTE)});`,
  );
}

execute(statements, { remote: flags.remote });

// Re-read rather than trust the writes — the same discipline the tag sweep and
// the omnibus backfill both use. A reported success that nobody checked is how
// a silent no-op survives.
const after = q(`SELECT pages, collects FROM edition WHERE id = ${lit(EPUB_EDITION)}`);
const relAfter = q(
  `SELECT wr.id, w.title FROM work_relation wr JOIN work w ON w.id = wr.to_work_id
    WHERE wr.from_work_id = ${lit(OMNIBUS_WORK)} AND wr.relation = 'contains'`,
);

console.log('\nverified by re-reading:');
console.log(`  pages    : ${after[0]?.pages}`);
console.log(`  collects : ${after[0]?.collects?.slice(0, 60)}...`);
console.log(`  contains : ${relAfter.length} relation(s) — ${relAfter.map((r) => r.title).join(', ')}`);

const ok = after[0]?.pages === PAGES && after[0]?.collects === COLLECTS && relAfter.length === 1;
console.log(ok ? '\nAll three writes confirmed.\n' : '\n⚠️ Re-read does NOT match what was written.\n');
process.exit(ok ? 0 : 1);
