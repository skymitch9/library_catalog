/**
 * File every special printing under one canonical kind.
 *
 * ## Why this exists
 *
 * The owner, 2026-08-11: *"Let's normalize any edition to collectors edition.
 * Keep the original name on the visible listing but for our sanity all editions
 * should be collectors and we can fix them one off if needed."*
 *
 * Measured against production the same day: **220 editions carry no
 * `edition_name` at all, and 17 carry one across 13 distinct names** —
 * "Illumicrate Exclusive", "Year of Sanderson premium hardcover", "B&N Exclusive
 * Edition", "Deluxe Edition", "Signed Leatherbound" and eight more.
 *
 * Migration 0050 adds `edition.edition_kind` so that set is one value instead of
 * thirteen `LIKE` patterns. This writes it for the rows that already exist;
 * `classifyEdition` in `@lc/core` is what the importers call for the rows that
 * arrive next.
 *
 * ⚠️ **`edition_name` is not rewritten.** It keeps its exact text and stays what
 * every listing prints — that was half the ask, and it is the only record of
 * which shop a book came out of. The one exception is the junk row below, and it
 * is called out by name.
 *
 * ## ⚠️ What it deliberately does NOT classify
 *
 * Three real production rows, all left alone on purpose:
 *
 *   * **"Omnibus - collects volumes 1-3"** and **"Volume 1"** — both *White
 *     Sand*. They describe **what is inside the book**, not how it was printed.
 *     An omnibus is an ordinary trade printing; calling it a collector's edition
 *     would be false, and White Sand is the original "alternate copies of stuff
 *     we already own" case the series restructure was built around. They stay
 *     NULL, which in this column means *ordinary printing* — see `EDITION_KINDS`.
 *   * **"ebook"** — junk that leaked out of a crowdfunding reward name. The
 *     row's `format` is already `ebook_epub`, so the name says nothing the row
 *     does not. This is the one place a name is touched: it is **cleared to
 *     NULL**, guarded on the format actually being an ebook, rather than
 *     categorised.
 *
 * After a run the collection's Printing filter should show every named printing
 * under **Collector's edition** except the two *White Sand* rows, which stay
 * under **Named, not sorted** — and that short list is exactly where "we can fix
 * them one off if needed" is done from.
 *
 * ⚠️ **Read the dry run rather than trusting a number written here.** The brief
 * this was built from enumerated twelve of the thirteen distinct names, so a
 * thirteenth exists that has never been seen. It will appear in one of the three
 * lists printed below, and if it lands under "leaving as an ORDINARY printing"
 * that is a decision worth a second look before committing.
 *
 * ## Re-running
 *
 * Idempotent, and only ever writes into a NULL `edition_kind`, so a hand-made
 * correction is never overwritten. ⚠️ One wart, stated rather than hidden: if
 * the owner deliberately clears `HAND_CLASSIFIED` row back to NULL meaning
 * "no, that one is ordinary", a later run would re-apply it. Delete the entry
 * from the list if that ever happens.
 *
 * ## Running it
 *
 *   node scripts/backfill-edition-kinds.mjs                    # dry run, local
 *   node scripts/backfill-edition-kinds.mjs --remote           # dry run, production
 *   node scripts/backfill-edition-kinds.mjs --remote --commit  # apply
 */

import { classifyEdition } from '../packages/core/src/crowdfunding.ts';
import { execute, parseFlags, query } from './lib/d1.mjs';

const { commit, remote, limit } = parseFlags();

/** A SQL string literal. Doubling the quote is the whole of SQLite's escaping. */
const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/**
 * ⚠️ The one-off the rule cannot honestly reach.
 *
 * "Book with sticker and bookmark tier" is a crowdfunding **tier** name, and the
 * owner classes the printing it delivered as special. No keyword on
 * `COLLECTORS_HINTS` reaches it and none should: a bookmark is not a binding,
 * and adding 'sticker' to a list of words meaning "finely made" would file the
 * next ordinary paperback-with-a-freebie as a collector's edition.
 *
 * So it is named here instead, in the script, where it reads as the deliberate
 * exception it is. This is what *"we can fix them one off if needed"* looks like
 * when the fix is known in advance; the Editions panel is where the ones that
 * are not known in advance get fixed.
 *
 * Matched on the exact string, so it writes nothing in a database that does not
 * hold that row.
 */
const HAND_CLASSIFIED = new Map([['Book with sticker and bookmark tier', 'collectors']]);

/**
 * ⚠️ Names that are junk rather than a kind — cleared, not categorised.
 *
 * Guarded on `format` too. "ebook" as an `edition_name` is meaningless beside
 * `format = 'ebook_epub'`, and would be a real fact if it ever appeared on a
 * hardcover row (it would mean somebody had typed the wrong thing, and that is
 * worth seeing rather than deleting).
 */
const JUNK_NAMES = new Set(['ebook']);

const NAMED = `
  SELECT e.id           AS id,
         e.work_id      AS workId,
         e.format       AS format,
         e.edition_name AS name,
         e.edition_kind AS kind,
         w.title        AS title
    FROM edition e
    JOIN work w ON w.id = e.work_id
   WHERE e.edition_name IS NOT NULL AND e.edition_name <> ''
   ORDER BY e.id
`;

const rows = query(NAMED, { remote });

const classify = [];
const clear = [];
const leaving = [];

for (const r of rows) {
  if (r.kind) continue; // already filed; never overwritten
  if (JUNK_NAMES.has(String(r.name).trim().toLowerCase()) && String(r.format).startsWith('ebook')) {
    clear.push(r);
    continue;
  }
  const kind = classifyEdition(r.name) ?? HAND_CLASSIFIED.get(r.name) ?? null;
  if (kind) classify.push({ ...r, kind, byHand: !classifyEdition(r.name) });
  else leaving.push(r);
}

const targets = Number.isFinite(limit) ? classify.slice(0, limit) : classify;

console.log(`\n${remote ? 'production' : 'local'}: ${rows.length} named edition(s) of ${
  query('SELECT COUNT(*) AS n FROM edition', { remote })[0]?.n ?? '?'
} total`);

console.log(`\nwill file as a kind (${targets.length}):`);
for (const r of targets) {
  console.log(
    `  ${String(r.id).padStart(4)}  ${r.kind.padEnd(11)}${r.byHand ? '(by hand) ' : '          '}${String(r.name).slice(0, 44).padEnd(46)}${String(r.title).slice(0, 28)}`,
  );
}

console.log(`\nwill clear the name as junk (${clear.length}):`);
for (const r of clear) {
  console.log(`  ${String(r.id).padStart(4)}  "${r.name}" on a ${r.format} — ${String(r.title).slice(0, 40)}`);
}

/*
 * ⚠️ Printed every run, not tucked away in a summary. These are the rows the
 * rule refused, and refusing them is a decision somebody may want to overrule —
 * a silent skip and a considered exclusion look identical in a log that does not
 * name them.
 */
console.log(`\n⚠️ leaving as an ORDINARY printing (${leaving.length}) — named, but not a special printing:`);
for (const r of leaving) {
  console.log(`  ${String(r.id).padStart(4)}  "${r.name}" — ${String(r.title).slice(0, 40)}`);
}
console.log(
  '   These stay NULL, which in `edition_kind` means "ordinary", not "unknown".\n' +
    '   They are what the collection\'s Printing → "Named, not sorted" filter lists.',
);

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.');
  process.exit(0);
}

if (targets.length === 0 && clear.length === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

const statements = [
  ...targets.map(
    (r) =>
      `UPDATE edition SET edition_kind = ${sql(r.kind)}, updated_at = datetime('now')
        WHERE id = ${r.id} AND edition_kind IS NULL;`,
  ),
  // ⚠️ The name goes, the kind stays NULL. Guarded on the exact name AND the
  // format, so it writes nothing in a database whose row 'ebook' means something
  // else.
  ...clear.map(
    (r) =>
      `UPDATE edition SET edition_name = NULL, updated_at = datetime('now')
        WHERE id = ${r.id} AND lower(edition_name) = ${sql(String(r.name).trim().toLowerCase())}
          AND format LIKE 'ebook%';`,
  ),
];

execute(statements, { remote });

/*
 * ⚠️ Confirm by RE-READING the database, never by trusting the statement count.
 *
 * `execute` returns how many statements ran, not how many rows changed — local
 * D1 omits `meta.changes` entirely — and `docs/TODO.md` records something worse
 * from the same helper: `query()` once returned an **empty result over 99 live
 * rows**, and the script reported "nothing to do". So the check below asserts a
 * positive number it expects to see, and says so loudly when the arithmetic does
 * not come out, rather than printing whatever it read.
 */
const after = query(
  `SELECT
     (SELECT COUNT(*) FROM edition WHERE edition_kind = 'collectors')            AS collectors,
     (SELECT COUNT(*) FROM edition WHERE edition_name IS NOT NULL
         AND edition_name <> '' AND edition_kind IS NULL)                        AS unsorted,
     (SELECT COUNT(*) FROM edition WHERE edition_kind IS NULL)                   AS ordinary,
     (SELECT COUNT(*) FROM edition)                                              AS total`,
  { remote },
)[0];

if (!after) {
  console.log('\n⚠️ The confirming read returned NOTHING. The write may well have landed — ' +
    'this helper has returned an empty result over live rows before. Re-read by hand ' +
    'before re-running, because a second run is safe but a wrong conclusion is not.');
  process.exit(1);
}

console.log(
  `\nwrote ${targets.length} kind(s) and cleared ${clear.length} junk name(s).` +
    `\nnow: ${after.collectors} collector's edition(s), ${after.unsorted} named-but-unsorted, ` +
    `${after.ordinary} ordinary of ${after.total} editions`,
);

const expected = targets.length;
if (Number(after.collectors) < expected) {
  console.log(
    `\n⚠️ That is not the arithmetic expected — ${expected} row(s) were filed and only ` +
      `${after.collectors} carry a kind. Investigate before re-running.`,
  );
  process.exit(1);
}
console.log('\nThe named-but-unsorted rows are the "fix them one off" list: ' +
  'Collection → Filters → Printing → "Named, not sorted".');
