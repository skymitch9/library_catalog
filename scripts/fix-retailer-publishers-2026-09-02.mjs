/**
 * One-off: the RETAILER is not the PUBLISHER — `edition.publisher` on the seven
 * rows `import-shop-orders.mjs` created.
 *
 * Owner, 2026-09-02: *"fix the wandering inn publisher"*. The sweep of the other
 * six is the second half of the same defect, asked for in `TODO.md`: *"Worth
 * checking whether the other B&N-imported works carry the same wrong publisher —
 * `import-shop-orders.mjs` created seven of them and this was never the field
 * anyone looked at."*
 *
 * ## What went wrong, once, in one importer
 *
 * `scripts/import-shop-orders.mjs` imports a Barnes & Noble order. It is careful
 * about `format` (`suggestFormat`, never the retailer's marketing word) and about
 * `edition_name` (the retailer's own wording preserved so the assumption stays
 * visible) — and it writes the SHOP into `publisher`, which is a different field
 * answering a different question. All seven rows it created carry
 * *"Barnes & Noble"*; none of the seven books is published by Barnes & Noble.
 *
 * ⚠️ **B&N is also a real publisher, and two rows in this catalog are its.** The
 * query that finds this defect (`publisher LIKE '%Barnes%'`) returns nine rows on
 * production, and rows **511** and **557** are CORRECT:
 *
 * | edition | title | ISBN | prefix | verdict |
 * |---|---|---|---|---|
 * | 511 | The Children's Treasury of Classic Poetry | 9780760722664 | `978-0-7607` Barnes & Noble Books | ✅ correct — Open Library's own record says *"Barnes and Noble"* |
 * | 557 | Adventures of Huckleberry Finn | 9781593081126 | `978-1-5930` Barnes & Noble Classics | ✅ correct — the recorded value already names the imprint |
 *
 * Both came in from `openlibrary`, not from the shop importer, and neither is
 * touched. **A sweep that "fixes" every row matching the word would corrupt
 * two true records** — which is why this script edits an explicit id list with
 * asserted from-values rather than running an UPDATE over a LIKE.
 *
 * ## Where each new value comes from — measured 2026-09-02, never inferred
 *
 * | ed | work | ISBN | prefix registrant | to | attested by |
 * |---|---|---|---|---|---|
 * | 322 | 229 The Wandering Inn | 9780063516380 | `978-0-06` HarperCollins | Harper Voyager | `docs/info/serial-print-splits.md` §2.2 |
 * | 323 | 230 No Killing Goblins | 9780063516403 | `978-0-06` HarperCollins | Harper Voyager | §2.2 (ISBN-10 `0063516403`, Harper Voyager 2026-09-22) |
 * | 324 | 231 Fae and Fare | 9780063516427 | `978-0-06` HarperCollins | Harper Voyager | §2.2 (ISBN-10 `006351642X`, Harper Voyager 2026-10-20) |
 * | 325 | 232 Immortal Games | 9780063516465 | `978-0-06` HarperCollins | Harper Voyager | §2.2 (ISBN-10 `0063516462`, Harper Voyager 2026-11-10) |
 * | 326 | 233 Project Hail Mary (Deluxe) | 9798217374274 | `979-8` (no group structure) | Ballantine Books | **the publisher's own listing** — penguinrandomhouse.com/books/828207, on sale 2026-12-01 |
 * | 327 | 234 Bad B*tch in the Kitch | 9780593797853 | `978-0-593` Penguin Random House | Clarkson Potter | **the publisher's own listing** — penguinrandomhouse.com/books/752044 |
 * | 328 | 235 Sunrise on the Reaping (B&N Exclusive) | 9781546175759 | `978-1-5461` Scholastic Inc. | Scholastic Press | Scholastic's own product info (scholastic.com newsroom); ⚠️ B&N's retail listing gives the coarser *"Scholastic"* |
 *
 * ⚠️ **The `979-8` prefix proves nothing on its own** — it carries no registration
 * group, so #326 rests entirely on Penguin Random House's own page for that exact
 * ISBN, not on the number. Said out loud because the other six have a prefix
 * behind them and this one does not.
 *
 * ## What this deliberately does NOT touch
 *
 *   * **editions 511 and 557** — see above. B&N publishes books; these are them.
 *   * `edition.edition_name` — *"B&N Exclusive Edition"* and *"Deluxe Edition"*
 *     are the retailer's and publisher's own words for the printing and belong
 *     exactly where they are. This is the publisher column's defect, not theirs.
 *   * **padhard.** Measured 2026-09-02 on the friend D1: the same query returns
 *     **zero** rows there, so this is a main-instance batch and running it
 *     `--friend` would find nothing to do.
 *   * `import-shop-orders.mjs` itself. The importer would write the same wrong
 *     value on its next run; that is a code fix with its own review, filed in
 *     `TODO.md`, and putting it in a data-correction batch is how a batch stops
 *     being reviewable (the same line `fix-wandering-inn-volumes-2026-09-02.mjs`
 *     drew when it left THIS field alone).
 *
 * Same non-destructive shape as `scripts/fix-wandering-inn-volumes-2026-09-02.mjs`:
 * every prior value lands in `change_log.old_json` before its UPDATE, with
 * `changed_by NULL, changed_how 'human'` — a person's decision (the owner's word
 * plus published sources), executed by a script. Per R12 a hand fill is never
 * labelled `'auto'`; `'auto'` means a finding with a source object behind it.
 *
 *   node scripts/fix-retailer-publishers-2026-09-02.mjs --remote            # dry run
 *   node scripts/fix-retailer-publishers-2026-09-02.mjs --remote --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const flags = parseFlags();
const q = (sql) => query(sql, { remote: flags.remote, friend: flags.friend });

const BATCH = 'fix-retailer-publishers-2026-09-02';

/** The shared reason, so every one of the seven change_log rows carries it. */
const WHY =
  'The retailer is not the publisher (owner 2026-09-02: "fix the wandering inn publisher"). ' +
  'scripts/import-shop-orders.mjs wrote the SHOP into edition.publisher on all seven rows it ' +
  'created from the Barnes & Noble order; B&N sold these books and published none of them. ' +
  'Each replacement is attested by the ISBN prefix registrant and/or the publisher\'s own ' +
  'listing for that exact ISBN — the per-row evidence is in the header of ' +
  'scripts/fix-retailer-publishers-2026-09-02.mjs and, for the four Wandering Inn rows, in ' +
  'docs/info/serial-print-splits.md §2.2. Editions 511 and 557 match the same LIKE and are ' +
  'DELIBERATELY untouched: Barnes & Noble Books and Barnes & Noble Classics really are their ' +
  'publisher.';

/**
 * One edition, with the move and the evidence that decided it.
 *
 * `from` AND `isbn13` are both asserted before anything is written: the ISBN is
 * the identity of the printing, so a row that has been re-pointed, re-imported or
 * renumbered since this was researched stops the run rather than being
 * overwritten. Same refusal `fix-wandering-inn-volumes-2026-09-02.mjs` makes.
 */
const EDITS = [
  {
    id: 322,
    workId: 229,
    isbn13: '9780063516380',
    from: 'Barnes & Noble',
    to: 'Harper Voyager',
    evidence: '978-0-06 HarperCollins prefix; serial-print-splits.md §2.2',
  },
  {
    id: 323,
    workId: 230,
    isbn13: '9780063516403',
    from: 'Barnes & Noble',
    to: 'Harper Voyager',
    evidence: '978-0-06 HarperCollins prefix; serial-print-splits.md §2.2',
  },
  {
    id: 324,
    workId: 231,
    isbn13: '9780063516427',
    from: 'Barnes & Noble',
    to: 'Harper Voyager',
    evidence: '978-0-06 HarperCollins prefix; serial-print-splits.md §2.2',
  },
  {
    id: 325,
    workId: 232,
    isbn13: '9780063516465',
    from: 'Barnes & Noble',
    to: 'Harper Voyager',
    evidence: '978-0-06 HarperCollins prefix; serial-print-splits.md §2.2',
  },
  {
    id: 326,
    workId: 233,
    isbn13: '9798217374274',
    from: 'Barnes & Noble',
    to: 'Ballantine Books',
    // ⚠️ The prefix carries no registration group here — this rests on the
    // publisher's own page for this exact ISBN and nothing else.
    evidence: "publisher's own listing: penguinrandomhouse.com/books/828207 (979-8 prefix proves nothing)",
  },
  {
    id: 327,
    workId: 234,
    isbn13: '9780593797853',
    from: 'Barnes & Noble',
    to: 'Clarkson Potter',
    evidence: "978-0-593 Penguin Random House prefix; publisher's own listing: penguinrandomhouse.com/books/752044",
  },
  {
    id: 328,
    workId: 235,
    isbn13: '9781546175759',
    from: 'Barnes & Noble',
    to: 'Scholastic Press',
    evidence: '978-1-5461 Scholastic Inc. prefix; Scholastic product info (B&N retail lists the coarser "Scholastic")',
  },
];

/**
 * The rows that match the same search and are RIGHT. Asserted, not ignored: if
 * one of them ever stops looking like this the run stops, because the thing that
 * changed it is the thing worth reading before touching anything else.
 */
const LEAVE_ALONE = [
  { id: 511, publisher: 'Barnes and Noble', isbn13: '9780760722664' },
  { id: 557, publisher: 'Barnes & Noble Classics', isbn13: '9781593081126' },
];

if (flags.friend) {
  throw new Error(
    'This batch is main-instance only. Measured 2026-09-02: padhard holds ZERO editions whose ' +
      'publisher mentions Barnes & Noble, so a --friend run would assert seven rows that do not exist.',
  );
}

const ids = EDITS.map((e) => e.id);
const rows = q(
  `SELECT e.id, e.work_id, e.isbn13, e.publisher, e.edition_name, w.title
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.id IN (${ids.join(',')})`,
);
if (rows.length !== ids.length) {
  throw new Error(
    `expected ${ids.length} editions, found ${rows.length} — refusing to guess which changed since this was written`,
  );
}
const byId = new Map(rows.map((r) => [r.id, r]));

for (const edit of EDITS) {
  const row = byId.get(edit.id);
  if (row.work_id !== edit.workId) {
    throw new Error(
      `edition #${edit.id} hangs off work #${row.work_id}, not #${edit.workId} — the printing has ` +
        'been re-pointed since this was researched; stop and re-read production',
    );
  }
  if ((row.isbn13 ?? null) !== edit.isbn13) {
    throw new Error(
      `edition #${edit.id} isbn13 is ${JSON.stringify(row.isbn13)}, expected ${JSON.stringify(edit.isbn13)} — ` +
        'the ISBN is the identity of the printing and every publisher above was verified against it',
    );
  }
  if ((row.publisher ?? null) !== edit.from) {
    throw new Error(
      `edition #${edit.id} publisher is ${JSON.stringify(row.publisher)}, expected ${JSON.stringify(edit.from)} — ` +
        'refusing to overwrite a value this script was not written against',
    );
  }
}

// The two true B&N imprints. Read and asserted, never edited.
const keepRows = q(
  `SELECT id, isbn13, publisher FROM edition WHERE id IN (${LEAVE_ALONE.map((k) => k.id).join(',')})`,
);
for (const keep of LEAVE_ALONE) {
  const row = keepRows.find((r) => r.id === keep.id);
  if (!row) {
    throw new Error(
      `edition #${keep.id} — a row this batch deliberately protects — is gone. Read why before running this.`,
    );
  }
  if ((row.publisher ?? null) !== keep.publisher || (row.isbn13 ?? null) !== keep.isbn13) {
    throw new Error(
      `edition #${keep.id} reads ${JSON.stringify(row.publisher)} / ${JSON.stringify(row.isbn13)}, expected ` +
        `${JSON.stringify(keep.publisher)} / ${JSON.stringify(keep.isbn13)} — one of the rows this batch is ` +
        'written to LEAVE ALONE has moved; re-read production before deciding anything',
    );
  }
}

// ⚠️ Anything else wearing a retailer's name is a FINDING, not a row to sweep.
// A new one means the importer ran again, and the fix is upstream.
const others = q(
  `SELECT e.id, e.publisher, e.isbn13, w.title
     FROM edition e JOIN work w ON w.id = e.work_id
    WHERE (e.publisher LIKE '%Barnes%' OR e.publisher LIKE '%Noble%')
      AND e.id NOT IN (${[...ids, ...LEAVE_ALONE.map((k) => k.id)].join(',')})`,
);
if (others.length) {
  throw new Error(
    `${others.length} unexpected Barnes & Noble publisher row(s) — ` +
      others.map((r) => `#${r.id} ${r.title} (${r.publisher})`).join('; ') +
      ' — read them before running this; they are neither the seven the importer made nor the two that are correct',
  );
}

console.log(
  `${flags.remote ? 'production' : 'local'}: ${EDITS.length} edition(s) to correct, ` +
    `${LEAVE_ALONE.length} correct B&N row(s) verified and left alone\n`,
);

const stmts = [];
for (const edit of EDITS) {
  const row = byId.get(edit.id);
  console.log(`  edition #${row.id} (work #${row.work_id} ${row.title})`);
  console.log(`      publisher ${JSON.stringify(edit.from)} -> ${JSON.stringify(edit.to)}`);
  console.log(`      because: ${edit.evidence}`);
  stmts.push(
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
      VALUES (${lit(BATCH)}, 'edition', ${row.id}, 'publisher', ${lit(JSON.stringify({ publisher: edit.from }))}, ${lit(JSON.stringify({ publisher: edit.to }))}, NULL, 'human', ${lit(`${WHY} This row: ${edit.evidence}.`)});`,
    `UPDATE edition SET publisher = ${lit(edit.to)}, updated_at = datetime('now') WHERE id = ${row.id};`,
  );
  console.log('');
}

for (const keep of LEAVE_ALONE) {
  console.log(`  edition #${keep.id} publisher ${JSON.stringify(keep.publisher)} — CORRECT, untouched`);
}

console.log('');
if (!flags.commit) {
  console.log(`[dry run] ${stmts.length} statement(s) would run. Pass --commit to write.`);
  process.exit(0);
}

execute(stmts, { remote: flags.remote });

// Confirm by re-reading. `execute` returns statements run, never rows changed —
// the local D1 does not report `meta.changes` at all, so a counter here would be
// a lie in exactly the direction that hides a no-op.
const after = q(
  `SELECT e.id, e.publisher, w.title FROM edition e JOIN work w ON w.id = e.work_id
    WHERE e.id IN (${[...ids, ...LEAVE_ALONE.map((k) => k.id)].join(',')}) ORDER BY e.id`,
);
console.log('\nAfter:');
for (const row of after) {
  console.log(`  #${String(row.id).padStart(3)}  ${JSON.stringify(row.publisher)}  — ${row.title}`);
}

const wrong = [];
for (const edit of EDITS) {
  const row = after.find((r) => r.id === edit.id);
  if ((row?.publisher ?? null) !== edit.to) {
    wrong.push(`#${edit.id} publisher = ${JSON.stringify(row?.publisher)}`);
  }
}
for (const keep of LEAVE_ALONE) {
  const row = after.find((r) => r.id === keep.id);
  if ((row?.publisher ?? null) !== keep.publisher) {
    wrong.push(`#${keep.id} was protected and reads ${JSON.stringify(row?.publisher)}`);
  }
}
if (wrong.length) throw new Error(`${wrong.length} value(s) did not take: ${wrong.join('; ')}`);

console.log('\nOK: seven retailer publishers corrected, two real B&N imprints untouched.');
