/**
 * Give every edition-less work ONE edition, and link its copy to it.
 *
 * ## Why this exists
 *
 * Owner, 2026-10-28 14:2x Phoenix: *"Can we make sure all works have editions
 * in both libraries?"*
 *
 * Until `cf2020f` / `edf561a` (2026-10-27) the add path minted an edition only
 * when the scan line carried an ISBN-13 — a spine match, a photo add or a typed
 * add wrote work + copy and no edition at all. Measured 2026-10-28 14:2x:
 * **4 works on main (531–534) and 16 on padhard** have a copy each and no
 * edition row, so the shelf has no format to show for them and the copy has
 * nothing to point at.
 *
 * The add path now settles what such a book gets (`new-book-edition.ts`,
 * owner 2026-10-27 23:5x "Build now"): ONE edition in the panel's format —
 * paperback when nobody chose — with `isbn13 NULL` and `source 'manual'`, and
 * the copy linked to it. This script does for the old rows exactly what the
 * fixed add path would have done at the time.
 *
 * ## ⚠️ The format is a DEFAULT, not a claim
 *
 * `copy` carries no format column and these rows have no ISBN, so nothing in
 * the catalog says whether the book is a paperback. The minted edition says so
 * in its `note` (shown on the edit page) so the next person to hold the book
 * corrects it from the barcode rather than trusting it. This is the same
 * posture as `NO_BARCODE_NOTE`: a labelled fact, never a silent guess.
 *
 * ## What it deliberately does NOT do
 *
 * Copies whose work ALREADY has one or more editions are untouched. Linking a
 * copy to its work's sole edition is a separate, owner-gated decision —
 * `fix-copy-edition-links-2026-09-05.mjs --all-unambiguous` — because a copy
 * the catalog never described can be a paperback linked to the work's only
 * hardcover, and the shelf already resolves a sole-edition work without the
 * link. Nothing here changes that.
 *
 * Every minted edition writes a `__row__` change_log row and every link writes
 * an `edition_id` row, batch `backfill-missing-editions-2026-10-28`,
 * `changed_how = 'auto'`. Idempotent: a work with an edition no longer matches.
 *
 * ## Running it
 *
 *   node scripts/backfill-missing-editions.mjs --remote                    # dry run, main
 *   node scripts/backfill-missing-editions.mjs --remote --commit
 *   node scripts/backfill-missing-editions.mjs --remote --friend           # dry run, padhard
 *   node scripts/backfill-missing-editions.mjs --remote --friend --commit
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

const { commit, remote, limit, friend } = parseFlags();

const BATCH = 'backfill-missing-editions-2026-10-28';
const FORMAT = 'paperback'; // DEFAULT_SCAN_FORMAT in apps/web/src/lib/scan-format.ts
const NOTE =
  'Format is the catalog default (paperback), not verified against the book — ' +
  'minted 2026-10-28 by backfill-missing-editions for a book added without an ISBN. ' +
  'Correct the format and add the ISBN from the barcode.';

const MISSING = `
  SELECT w.id    AS workId,
         w.title AS title,
         (SELECT COUNT(*) FROM copy c WHERE c.work_id = w.id) AS copies,
         (SELECT MIN(c.id) FROM copy c WHERE c.work_id = w.id AND c.edition_id IS NULL) AS copyId
    FROM work w
   WHERE NOT EXISTS (SELECT 1 FROM edition e WHERE e.work_id = w.id)
   ORDER BY w.id
`;

const rows = query(MISSING, { remote, friend });
const targets = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
const total = query('SELECT COUNT(*) AS n FROM work', { remote, friend })[0]?.n ?? '?';

console.log(
  `\n${remote ? (friend ? 'padhard' : 'main') : 'local'}: ${rows.length} work(s) of ${total} have no edition row`,
);
console.log(`\nwill mint ONE ${FORMAT} edition (isbn NULL, source manual) and link the copy (${targets.length}):`);
for (const r of targets) {
  const link = r.copyId ? `copy ${r.copyId}` : r.copies ? `${r.copies} cop(ies), none unlinked` : 'no copy';
  console.log(`  work ${String(r.workId).padStart(4)}  ${String(r.title).slice(0, 48).padEnd(50)}${link}`);
}

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}
if (targets.length === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

const statements = [];
for (const r of targets) {
  const rowJson = JSON.stringify({
    workId: r.workId,
    isbn13: null,
    isbn10: null,
    asin: null,
    format: FORMAT,
    editionName: null,
    editionKind: null,
    collects: null,
    note: NOTE,
    publisher: null,
    publishedYear: null,
    pages: null,
    language: null,
    coverUrl: null,
    source: 'manual',
    sourceUrl: null,
    cwaBookId: null,
  });
  // The edition first; the change_log row reads its id off last_insert_rowid()
  // exactly as `createEdition` in packages/db does.
  statements.push(
    `INSERT INTO edition (work_id, format, source, note)
       SELECT ${lit(r.workId)}, ${lit(FORMAT)}, 'manual', ${lit(NOTE)}
        WHERE NOT EXISTS (SELECT 1 FROM edition WHERE work_id = ${lit(r.workId)});`,
    `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
       SELECT ${lit(BATCH)}, 'edition', e.id, '__row__', 'null', ${lit(rowJson)}, NULL, 'auto',
              'minted for an edition-less work (owner ask 2026-10-28)'
         FROM edition e
        WHERE e.work_id = ${lit(r.workId)} AND e.note = ${lit(NOTE)}
          AND NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.batch_id = ${lit(BATCH)}
                             AND cl.entity = 'edition' AND cl.entity_id = e.id);`,
  );
  if (r.copyId) {
    statements.push(
      `UPDATE copy
          SET edition_id = (SELECT e.id FROM edition e WHERE e.work_id = ${lit(r.workId)} AND e.note = ${lit(NOTE)} LIMIT 1),
              updated_at = datetime('now')
        WHERE id = ${lit(r.copyId)} AND edition_id IS NULL;`,
      `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json, changed_by, changed_how, note)
       SELECT ${lit(BATCH)}, 'copy', c.id, 'edition_id', 'null', CAST(c.edition_id AS TEXT), NULL, 'auto',
              'linked to the edition minted for its work (owner ask 2026-10-28)'
         FROM copy c
        WHERE c.id = ${lit(r.copyId)} AND c.edition_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM change_log cl WHERE cl.batch_id = ${lit(BATCH)}
                             AND cl.entity = 'copy' AND cl.entity_id = c.id);`,
    );
  }
}

execute(statements, { remote, friend });

const after = query(MISSING, { remote, friend });
console.log(`\nwrote ${statements.length} statement(s); ${after.length} work(s) still without an edition`);
if (after.length) process.exitCode = 1;
