/**
 * Data repair: `edition.publisher` holding a SHOP name, on both instances.
 *
 * The importer half of this defect is fixed in `scripts/import-shop-orders.mjs`
 * (owner decision 2026-09-05: `publisher` is NULL unless the source row carries
 * a real publisher, and the shop goes to `copy.vendor`). This is the data half:
 * anything already in the two databases wearing a shop's name in the publisher
 * column, put right the same way.
 *
 * ## What it does to a row it claims
 *
 *   1. `edition.publisher` → NULL.
 *   2. `copy.vendor` → the old publisher value, **only on copies of that edition
 *      whose vendor is empty**. A copy that already records where it was bought
 *      is left exactly alone — the shop it names is better evidence than the
 *      publisher column ever was, and overwriting it would destroy a fact to
 *      replace it with a guess.
 *   3. one `change_log` row **per changed field**, batch
 *      `fix-2026-09-05-shop-publisher`, `changed_how = 'auto'`.
 *
 * Idempotent: a second run finds nothing, because step 1 removes the very thing
 * the search matches on.
 *
 * ## 🔴 The trap this script is written around: a shop CAN be a publisher
 *
 * `Barnes & Noble Books` and `Barnes & Noble Classics` are real imprints and
 * **two rows in this catalog are theirs** — editions 511 and 557, both arrived
 * from `openlibrary`, both correct. `fix-retailer-publishers-2026-09-02.mjs`
 * found the same trap and refused to sweep a LIKE for it. Two guards here:
 *
 *   * only `edition.source = 'manual'` rows are eligible — that is the stamp the
 *     shop importer leaves, and a publisher that arrived from `openlibrary` or
 *     the ISBN ladder is the ladder's answer, not the importer's mistake;
 *   * `PROTECTED` names the two rows explicitly and **asserts** them. If either
 *     has moved, the run stops rather than deciding anything.
 *
 * ## What it deliberately leaves alone
 *
 * **Illumicrate.** Five editions (307–311, works 224–228) carry
 * `publisher = 'Illumicrate'`, written by `scripts/import-illumicrate-percy-jackson.mjs`
 * — the same defect from a different importer, reported separately 2026-09-05.
 * Three of the five read `source = 'openlibrary'`, so a later backfill has been
 * over them and the provenance is no longer clean; deciding those is a second
 * concern, and a batch that sweeps in a second concern stops being reviewable
 * (the line `fix-wandering-inn-volumes-2026-09-02.mjs` drew first).
 *
 * ## Measured before it was written — 2026-09-05, both instances, production
 *
 * | | editions whose publisher IS a shop name | of those, `source='manual'` |
 * |---|---|---|
 * | main (`library-catalog`) | **1** — ed#511, and it is CORRECT | **0** |
 * | padhard (`library-catalog-2nd`) | **0** | **0** |
 *
 * So this is expected to be a **no-op on both**, and that is the result, not a
 * failure: `fix-retailer-publishers-2026-09-02.mjs` already repaired the seven
 * rows the importer made, and padhard has never run the shop importer at all
 * (it holds **zero** copies with any vendor recorded). The script exists because
 * the importer can run again on either instance, and because "0 rows" is only
 * worth believing if something measured it.
 *
 *   node scripts/fix-shop-publisher-2026-09-05.mjs --remote            # dry run
 *   node scripts/fix-shop-publisher-2026-09-05.mjs --remote --commit
 *   node scripts/fix-shop-publisher-2026-09-05.mjs --remote --friend
 *   node scripts/fix-shop-publisher-2026-09-05.mjs --remote --friend --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const BATCH = 'fix-2026-09-05-shop-publisher';

/**
 * The shop names, and where each one comes from.
 *
 * The first group is what the importers actually write: `scan.vendor` in a shop
 * order, which is `Barnes & Noble` in the only order ever imported, plus the
 * spellings `copy.vendor` holds on production today (measured 2026-09-05:
 * `Crowdfunding` 38, `Kickstarter` 22, `Barnes & Noble` 7, `Illumicrate` 5 —
 * the last deliberately absent from this list, see the header).
 *
 * The second group is the obvious rest of the high street, named in the brief.
 * They match nothing today; they are here so that the day one of them DOES get
 * imported, this script finds it.
 *
 * ⚠️ Exact equality, never LIKE. `Barnes & Noble Classics` is a publisher and
 * `Barnes & Noble` is a shop, and a LIKE cannot tell them apart — which is
 * exactly how a sweep would have corrupted two true records in September.
 */
const SHOPS = [
  // what the importers write
  'Barnes & Noble', 'Barnes and Noble', 'B&N', 'BN',
  'Kickstarter', 'BackerKit', 'Indiegogo', 'Crowdfunding',
  // the rest of the high street
  'Amazon', 'Amazon.com', 'Bookshop.org', 'Bookshop', 'ThriftBooks', 'Thriftbooks',
  'Book Outlet', 'Pango', 'Pango Books', 'Target', 'Walmart',
  'Books-A-Million', 'BAM', 'Waterstones', 'Blackwell’s', "Blackwell's",
  'Better World Books', 'AbeBooks', 'eBay', 'Costco',
];

/**
 * Rows that match the search and are RIGHT. Asserted, never edited.
 *
 * They are excluded by the `source = 'manual'` rule anyway — both read
 * `openlibrary`. Naming them a second time is deliberate belt and braces: if a
 * backfill ever restamps one to `manual`, the exclusion silently stops working
 * and this list is what turns that into a stop instead of a corruption.
 *
 * 🔴 **MAIN-INSTANCE IDS. They mean nothing on padhard, and checking them there
 * is a bug** — caught by this very guard on the first `--friend` dry run
 * (2026-09-05): padhard's edition #511 is *Harper Paperbacks* on a different
 * book entirely, and the assertion stopped a run that had nothing to do. The
 * two instances are separate D1 databases with separate AUTOINCREMENT
 * sequences; an id is only meaningful beside its database. On padhard the
 * safety is the `source = 'manual'` rule plus the measured zero.
 */
const PROTECTED = [
  { id: 511, publisher: 'Barnes and Noble', why: 'Barnes & Noble Books — 978-0-7607, a real imprint' },
  { id: 557, publisher: 'Barnes & Noble Classics', why: 'Barnes & Noble Classics — 978-1-5930, a real imprint' },
];

const WHY =
  'The shop is not the publisher. Owner decision 2026-09-05: edition.publisher must be NULL when ' +
  'the source has no publisher, and the shop belongs in copy.vendor. ' +
  'scripts/import-shop-orders.mjs wrote scan.vendor into edition.publisher on every row it created; ' +
  'the importer is fixed and this is the data half. See docs/info/crowdfunding-and-accessories.md ' +
  '(shop orders) and docs/DONE.md.';

const flags = parseFlags();
const target = { remote: flags.remote, friend: flags.friend };
const q = (sql) => query(sql, target);
const where = flags.friend ? 'padhard' : flags.remote ? 'production' : 'local';

/**
 * ⚠️ `changed_by` is a real `app_user(id)` and the instances do NOT share one.
 * On main, 1 is the owner. On padhard, user 1 is HER, and stamping her name on a
 * repair she did not make would be a lie in the one table written to be trusted.
 */
const CHANGED_BY = flags.friend ? 'NULL' : '1';

const list = SHOPS.map((s) => lit(s)).join(', ');

// ---------------------------------------------------------------------------
// 1. Measure. Everything wearing a shop name, before any filtering — so the
//    report can say what was skipped and why, not just what was claimed.
// ---------------------------------------------------------------------------
const all = q(
  `SELECT e.id, e.work_id, e.publisher, e.source, w.title
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.publisher IN (${list})
    ORDER BY e.id`,
);
console.log(`\n${where}: ${all.length} edition(s) whose publisher IS a known shop name`);
for (const r of all) {
  console.log(`  ed#${r.id} work#${r.work_id} source=${r.source} publisher=${JSON.stringify(r.publisher)} — ${r.title}`);
}

// The two true imprints, asserted — MAIN ONLY, because the ids are main's.
const protectedIds = new Set(flags.friend ? [] : PROTECTED.map((p) => p.id));
if (flags.friend) {
  console.log('  (no protected-id list on padhard — ids are per-database; safety here is source=\'manual\')');
} else {
  const keepRows = q(`SELECT id, publisher FROM edition WHERE id IN (${PROTECTED.map((p) => p.id).join(',')})`);
  for (const keep of PROTECTED) {
    const row = keepRows.find((r) => r.id === keep.id);
    if (!row) {
      throw new Error(
        `edition #${keep.id} — a row this batch protects (${keep.why}) — is gone from main. Read why before running this.`,
      );
    }
    if ((row.publisher ?? null) !== keep.publisher) {
      throw new Error(
        `edition #${keep.id} reads ${JSON.stringify(row.publisher)}, expected ${JSON.stringify(keep.publisher)} — ` +
          `a row this batch protects (${keep.why}) has moved. Read why before running anything.`,
      );
    }
    console.log(`  ed#${keep.id} PROTECTED and unchanged — ${keep.why}`);
  }
}
const claimed = all.filter((r) => r.source === 'manual' && !protectedIds.has(r.id));
const skippedRows = all.filter((r) => !claimed.includes(r));
for (const r of skippedRows) {
  const reason = protectedIds.has(r.id) ? 'protected: a real imprint' : `source='${r.source}', not the shop importer`;
  console.log(`  ed#${r.id} SKIPPED — ${reason}`);
}

console.log(`\n${where}: ${claimed.length} edition(s) to repair`);
if (claimed.length === 0) {
  console.log('Nothing to do. That is a result, not a failure — see the header table.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Plan. Per edition: null the publisher, and fill copy.vendor only where it
//    is empty.
// ---------------------------------------------------------------------------
const copies = q(
  `SELECT id, work_id, edition_id, vendor FROM copy WHERE edition_id IN (${claimed.map((r) => r.id).join(',')})`,
);

const stmts = [];
let vendorFills = 0;
for (const ed of claimed) {
  const shop = ed.publisher;
  console.log(`\n  edition #${ed.id} (work #${ed.work_id} ${ed.title})`);
  console.log(`      publisher ${JSON.stringify(shop)} -> NULL`);
  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'edition', ${ed.id}, 'publisher', ${lit(JSON.stringify(shop))}, 'null', ${CHANGED_BY}, 'auto', ${lit(WHY)});`,
    `UPDATE edition SET publisher = NULL, updated_at = datetime('now') WHERE id = ${ed.id};`,
  );

  const mine = copies.filter((c) => c.edition_id === ed.id);
  for (const c of mine) {
    const has = c.vendor != null && String(c.vendor).trim() !== '';
    if (has) {
      console.log(`      copy #${c.id} vendor already ${JSON.stringify(c.vendor)} — untouched`);
      continue;
    }
    console.log(`      copy #${c.id} vendor NULL -> ${JSON.stringify(shop)}`);
    vendorFills++;
    stmts.push(
      `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
        VALUES (${lit(BATCH)}, 'copy', ${c.id}, 'vendor', ${lit(JSON.stringify(c.vendor ?? null))}, ${lit(JSON.stringify(shop))}, ${CHANGED_BY}, 'auto', ${lit(WHY)});`,
      `UPDATE copy SET vendor = ${lit(shop)}, updated_at = datetime('now') WHERE id = ${c.id};`,
    );
  }
  if (mine.length === 0) console.log('      no copies linked to this edition — publisher only');
}

console.log(
  `\n${where}: ${claimed.length} publisher(s) to null, ${vendorFills} copy vendor(s) to fill, ` +
    `${claimed.length + vendorFills} change_log row(s).`,
);

if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, target);

// ---------------------------------------------------------------------------
// 3. Confirm by re-reading. `execute` returns statements run, never rows
//    changed — the local D1 omits `meta.changes` entirely, so a counter here
//    would lie in exactly the direction that hides a no-op.
// ---------------------------------------------------------------------------
const after = q(
  `SELECT id, publisher FROM edition WHERE id IN (${claimed.map((r) => r.id).join(',')}) ORDER BY id`,
);
const stillWrong = after.filter((r) => r.publisher != null);
if (stillWrong.length) {
  throw new Error(
    `${stillWrong.length} publisher(s) did not clear: ` +
      stillWrong.map((r) => `#${r.id} = ${JSON.stringify(r.publisher)}`).join('; '),
  );
}

const logged = q(`SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ${lit(BATCH)}`);
console.log(`\nAfter: ${after.length} edition(s) now publisher NULL; change_log holds ${logged[0]?.n} row(s) for ${BATCH}.`);
