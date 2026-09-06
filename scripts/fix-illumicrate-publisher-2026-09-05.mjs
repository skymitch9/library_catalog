/**
 * Data repair: `edition.publisher` holding *"Illumicrate"* — the SHOP — on the
 * five Percy Jackson exclusive printings.
 *
 * The importer half is fixed in `scripts/import-illumicrate-percy-jackson.mjs`
 * (`PUBLISHER = null`, `editionSql`, pinned by
 * `scripts/test/illumicrate-import.test.mjs`). This is the data half, and it is
 * the second instance of one defect: `scripts/fix-shop-publisher-2026-09-05.mjs`
 * did the same job for the Barnes & Noble importer and **deliberately left these
 * five alone**, because three of them no longer read `source = 'manual'` and so
 * needed per-row evidence rather than a sweep. This script is that evidence.
 *
 * Rule of record: `docs/info/crowdfunding-and-accessories.md` §9.1 — the owner's
 * decision of 2026-09-05, both halves. *Where did I buy this?* is `copy.vendor`.
 * *Who published this printing?* is `edition.publisher`.
 *
 * ## 🔴 Why every row goes to NULL, and why that is EVIDENCE and not a shrug
 *
 * The brief for this repair asked for the real publisher per row, from the ISBN
 * prefix. **That evidence does not exist for these five, and the reason is
 * itself measured** — so NULL is what the sources say, exactly as §9.1
 * prescribes when a source names no publisher:
 *
 *   1. **The source page names no publisher.** The import was read off the
 *      Illumicrate announcement, and the importer's own header lists everything
 *      that page says: royal hardback, redesigned covers, foil, printed edges,
 *      illustrated endpapers, a digital signature, an author letter, £125. No
 *      publisher, and the page never even lists the individual volumes.
 *   2. **These printings carry no ISBN — the OWNER verified it.** Every one of
 *      the five holds the note *"no ISBN printed on this edition
 *      (owner-verified)"* (migration 0460's `edition.note`, split out of the
 *      name by `scripts/split-edition-note.mjs` on 2026-09-03). An edition with
 *      no ISBN has no prefix registrant to attest anything.
 *   3. 🔴 **The `isbn13` values three of the rows DO carry are other books', and
 *      that is measured, not suspected.** Read from openlibrary.org 2026-09-05:
 *
 *      | ed | isbn13 on the row | what that ISBN actually is |
 *      |---|---|---|
 *      | 307 | 9780786838653 | *The Lightning Thief*, **Disney-Hyperion Books, 2006** — the US trade printing, not a UK exclusive |
 *      | 308 | 9782226177612 | ***La mer des monstres*** — **Albin Michel**, 2007. A FRENCH edition. |
 *      | 311 | 9788362170043 | ***Ostatni Olimpijczyk*** — **Jaguar**, 2010. A POLISH edition. |
 *
 *      Two of the three are not even in English. Reading a publisher off those
 *      prefixes would put *Albin Michel* and *Jaguar* on a British subscription
 *      box's hardcover — a worse error than the one being repaired, and arrived
 *      at with more confidence. 309 and 310 carry no ISBN at all.
 *
 * ⚠️ **A guess that "the UK trade publisher is Puffin" was available and is NOT
 * taken.** Illumicrate exclusives are printed by the trade publisher, so the
 * true answer is a real name — but nothing in this repo, in these rows, or on
 * the source page attests WHICH, and §9.1 is explicit that the ISBN ladder
 * fills this column later rather than an importer or a sweep inventing it.
 * NULL is a known gap the ladder can find; a plausible name is a silent one.
 *
 * ## What it does to a row it claims
 *
 *   1. `edition.publisher` → NULL, on an explicit id list with **asserted
 *      from-values** — the `fix-retailer-publishers-2026-09-02.mjs` shape, never
 *      an UPDATE over a LIKE.
 *   2. `copy.vendor` → `'Illumicrate'` on copies of that edition whose vendor is
 *      empty. ⚠️ **Measured 2026-09-05: this fills ZERO copies**, because the
 *      importer already wrote the vendor correctly on all five (copies 104–108)
 *      — and because the join is `copy.edition_id`, which is NULL on all five
 *      anyway (see the note below). The step is kept so the script is complete
 *      if it is ever re-run after those links are repaired.
 *   3. one `change_log` row **per changed field**, batch
 *      `fix-2026-09-05-illumicrate-publisher`, `changed_how = 'auto'`.
 *
 * ⚠️ **The `copy.edition_id` join reaches nothing here, and that is the OTHER
 * defect, not a bug in this one.** Copies 104–108 all read `edition_id = NULL`
 * even though editions 307–311 were inserted nine seconds earlier in the same
 * run. `scripts/fix-copy-edition-links-2026-09-05.mjs` repairs that. A
 * work-level fallback (`copy.work_id = edition.work_id`) would reach them and is
 * deliberately NOT written: works 224–228 hold two or three printings each, so
 * it would hand the shop to copies of a printing nobody bought there.
 *
 * Idempotent: a second run finds nothing, because step 1 removes the value the
 * search matches on.
 *
 * ## Measured before it was written — 2026-09-05, both instances, production
 *
 * | | editions with `publisher = 'Illumicrate'` | copies with `vendor = 'Illumicrate'` |
 * |---|---|---|
 * | main (`library-catalog`) | **5** — 307, 308, 309, 310, 311 | **5** — 104–108, all already correct |
 * | padhard (`library-catalog-2nd`) | **0** | **0** |
 *
 * padhard has never run this importer, so `--friend` is expected to be a no-op,
 * and that zero is a result rather than a failure — it is only worth believing
 * because something measured it.
 *
 *   node scripts/fix-illumicrate-publisher-2026-09-05.mjs --remote            # dry run
 *   node scripts/fix-illumicrate-publisher-2026-09-05.mjs --remote --commit
 *   node scripts/fix-illumicrate-publisher-2026-09-05.mjs --remote --friend
 *   node scripts/fix-illumicrate-publisher-2026-09-05.mjs --remote --friend --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const BATCH = 'fix-2026-09-05-illumicrate-publisher';
const SHOP = 'Illumicrate';

/**
 * The five rows, with what each is asserted to look like BEFORE the write and
 * where its replacement value comes from.
 *
 * 🔴 **MAIN-INSTANCE IDS. They mean nothing on padhard, and checking them there
 * is a bug** — the two instances are separate D1 databases with separate
 * AUTOINCREMENT sequences. `fix-shop-publisher-2026-09-05.mjs` learned that on
 * its first `--friend` run, where the protected id was a different book
 * entirely. On padhard this list is not consulted at all; the safety there is
 * the measured zero, re-measured by every run.
 *
 * `to: null` on every row: see the header. The `evidence` column is what a
 * reviewer checks, and it is deliberately per row even though the answer is the
 * same five times — 309 and 310 rest on a different fact from 307/308/311.
 */
const ROWS = [
  {
    id: 307, work: 224, title: 'The Lightning Thief', from: SHOP, to: null,
    evidence:
      "no publisher on the source page; owner-verified 'no ISBN printed on this edition'; " +
      'the isbn13 it carries (9780786838653) is the 2006 Disney-Hyperion US printing — a different object',
  },
  {
    id: 308, work: 225, title: 'The Sea of Monsters', from: SHOP, to: null,
    evidence:
      "no publisher on the source page; owner-verified 'no ISBN printed on this edition'; " +
      'the isbn13 it carries (9782226177612) is *La mer des monstres*, Albin Michel 2007 — a FRENCH edition',
  },
  {
    id: 309, work: 226, title: "The Titan's Curse", from: SHOP, to: null,
    evidence:
      "no publisher on the source page; owner-verified 'no ISBN printed on this edition'; " +
      'the row carries no isbn13 at all, so there is no prefix registrant to read',
  },
  {
    id: 310, work: 227, title: 'The Battle of the Labyrinth', from: SHOP, to: null,
    evidence:
      "no publisher on the source page; owner-verified 'no ISBN printed on this edition'; " +
      'the row carries no isbn13 at all, so there is no prefix registrant to read',
  },
  {
    id: 311, work: 228, title: 'The Last Olympian', from: SHOP, to: null,
    evidence:
      "no publisher on the source page; owner-verified 'no ISBN printed on this edition'; " +
      'the isbn13 it carries (9788362170043) is *Ostatni Olimpijczyk*, Jaguar 2010 — a POLISH edition',
  },
];

const WHY =
  'The shop is not the publisher. Owner decision 2026-09-05: edition.publisher must be NULL when ' +
  'the source has no publisher, and the shop belongs in copy.vendor. ' +
  'scripts/import-illumicrate-percy-jackson.mjs wrote its VENDOR constant into edition.publisher on ' +
  'every row it created; the importer is fixed and this is the data half. NULL rather than a real ' +
  'publisher because no source attests one: the announcement page names none, the owner verified ' +
  'that no ISBN is printed on these editions, and the isbn13 values three of the rows carry belong ' +
  'to other printings (one French, one Polish). The ISBN ladder fills the column later. ' +
  'Per-row evidence: scripts/fix-illumicrate-publisher-2026-09-05.mjs. ' +
  'See docs/info/crowdfunding-and-accessories.md §9.';

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

// ---------------------------------------------------------------------------
// 1. Measure. Everything wearing the shop name on THIS instance, by value and
//    not by id — so padhard is measured rather than assumed, and so a row that
//    moved shows up instead of being silently skipped.
// ---------------------------------------------------------------------------
const all = q(
  `SELECT e.id, e.work_id, e.publisher, e.source, e.edition_name, e.isbn13, e.note, w.title
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.publisher = ${lit(SHOP)}
    ORDER BY e.id`,
);
console.log(`\n${where}: ${all.length} edition(s) whose publisher IS ${JSON.stringify(SHOP)}`);
for (const r of all) {
  console.log(
    `  ed#${r.id} work#${r.work_id} source=${r.source} name=${JSON.stringify(r.edition_name)} ` +
      `isbn13=${r.isbn13 ?? '—'} — ${r.title}`,
  );
}

if (all.length === 0) {
  console.log('Nothing to do. That is a result, not a failure — see the header table.');
  process.exit(0);
}

/*
 * ⚠️ Assert the id list against what is actually there, on MAIN only.
 *
 * `source` is deliberately NOT a filter here, and that is the whole reason this
 * is a separate script from fix-shop-publisher: three of the five read
 * `source = 'openlibrary'` because a backfill has been over them, so "the
 * importer wrote this" is no longer provable from the row. The evidence is the
 * id list plus the asserted from-value, which is stronger than a source stamp.
 */
let claimed = all;
if (flags.friend) {
  console.log('  (no id list on padhard — ids are per-database; the safety here is the measured value)');
} else {
  const byId = new Map(all.map((r) => [r.id, r]));
  for (const row of ROWS) {
    const live = byId.get(row.id);
    if (!live) {
      throw new Error(
        `edition #${row.id} (${row.title}) no longer reads publisher = ${JSON.stringify(SHOP)}. ` +
          'Either it was already repaired or something else moved it — read why before running this.',
      );
    }
    if ((live.publisher ?? null) !== row.from) {
      throw new Error(
        `edition #${row.id} reads ${JSON.stringify(live.publisher)}, expected ${JSON.stringify(row.from)}.`,
      );
    }
  }
  const strangers = all.filter((r) => !ROWS.some((x) => x.id === r.id));
  for (const r of strangers) {
    console.log(
      `  ⚠️ ed#${r.id} wears the shop name and is NOT in this batch's evidence list — SKIPPED. ` +
        'A new row needs its own evidence, not this one.',
    );
  }
  claimed = all.filter((r) => ROWS.some((x) => x.id === r.id));
}

// ---------------------------------------------------------------------------
// 2. Plan.
// ---------------------------------------------------------------------------
const copies = q(
  `SELECT id, work_id, edition_id, vendor FROM copy WHERE edition_id IN (${claimed.map((r) => r.id).join(',')})`,
);

const stmts = [];
let vendorFills = 0;
for (const ed of claimed) {
  const row = ROWS.find((x) => x.id === ed.id);
  const to = row ? row.to : null;
  console.log(`\n  edition #${ed.id} (work #${ed.work_id} ${ed.title})`);
  console.log(`      publisher ${JSON.stringify(ed.publisher)} -> ${to === null ? 'NULL' : JSON.stringify(to)}`);
  if (row) console.log(`      evidence: ${row.evidence}`);
  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'edition', ${ed.id}, 'publisher', ${lit(JSON.stringify(ed.publisher))}, ${lit(JSON.stringify(to))}, ${CHANGED_BY}, 'auto', ${lit(WHY)});`,
    `UPDATE edition SET publisher = ${lit(to)}, updated_at = datetime('now') WHERE id = ${ed.id};`,
  );

  const mine = copies.filter((c) => c.edition_id === ed.id);
  for (const c of mine) {
    const has = c.vendor != null && String(c.vendor).trim() !== '';
    if (has) {
      console.log(`      copy #${c.id} vendor already ${JSON.stringify(c.vendor)} — untouched`);
      continue;
    }
    console.log(`      copy #${c.id} vendor NULL -> ${JSON.stringify(SHOP)}`);
    vendorFills++;
    stmts.push(
      `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
        VALUES (${lit(BATCH)}, 'copy', ${c.id}, 'vendor', ${lit(JSON.stringify(c.vendor ?? null))}, ${lit(JSON.stringify(SHOP))}, ${CHANGED_BY}, 'auto', ${lit(WHY)});`,
      `UPDATE copy SET vendor = ${lit(SHOP)}, updated_at = datetime('now') WHERE id = ${c.id};`,
    );
  }
  if (mine.length === 0) {
    console.log(
      '      no copies LINKED to this edition — publisher only. ' +
        '(⚠️ the work does own an Illumicrate copy; it carries edition_id NULL — see fix-copy-edition-links-2026-09-05.mjs)',
    );
  }
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
