/**
 * Back-fill the first-class special-edition columns (migration 0430) from the
 * prose they used to live in.
 *
 * ## Why this exists
 *
 * Before 0430, "leatherbound", "sprayed edges" and "slipcase" were recorded only
 * as free text in `edition.edition_name` / `edition.edition_kind` (the shop's
 * own words) — and surfaced as read-only badges parsed from that text. 0430
 * makes them real `copy` booleans. This maps the few rows that already carry the
 * words onto the new columns, so the badge a person already saw becomes an
 * editable, filterable fact.
 *
 * The detection is `detectSpecialEditionProse` in `@lc/core` — the SAME function
 * the shelf-view badge derivation uses — so the sweep migrates exactly what the
 * badge already lit, no more and no less. `is_signed` is not swept: it has been
 * a real boolean since migration 0001 and was never in prose.
 *
 * ## Leather ⊂ hardcover
 *
 * A leatherbound copy IS a hardcover (`LEATHER_IMPLIES_FORMAT`). So when this
 * marks a copy leatherbound and that copy is linked to an edition whose format
 * is NOT hardcover, it also proposes correcting that edition's format to
 * hardcover — the "+ hardcover" half of the ask. A leatherbound copy with no
 * linked edition needs no format write: the shelf-view derivation shows
 * Hardcover from the flag alone.
 *
 * ## Running it
 *
 *   node scripts/sweep-special-editions.mjs                    # dry run, local
 *   node scripts/sweep-special-editions.mjs --remote           # dry run, production (MAIN)
 *   node scripts/sweep-special-editions.mjs --remote --friend  # dry run, padhard
 *   node scripts/sweep-special-editions.mjs --remote --commit  # APPLY (main)
 *
 * ⚠️ **DRY RUN is the default** — it prints what it WOULD change and writes
 * nothing. `--commit` applies. Do NOT run `--commit` against production until
 * migration 0430 has been applied there (the columns must exist first).
 */

import { detectSpecialEditionProse, LEATHER_IMPLIES_FORMAT } from '../packages/core/src/constants.ts';
import { execute, parseFlags, query } from './lib/d1.mjs';

/**
 * The changes one copy row implies — a PURE function so the mapping is testable
 * without a database (`scripts/test/sweep-special-editions.test.mjs`).
 *
 * `row` carries the copy's current flags, its linked edition's `edition_name` /
 * `edition_kind` / `format`, and the copy's `notes`. A column is proposed only
 * when the prose says so AND the column is not already set — a re-run is a no-op.
 */
export function planRow(row) {
  const prose = detectSpecialEditionProse(
    [row.edition_name, row.edition_kind, row.copy_notes].filter(Boolean).join(' '),
  );

  const setCols = [];
  if (prose.sprayedEdges && !row.sprayed_edges) setCols.push('sprayed_edges');
  if (prose.leatherbound && !row.leatherbound) setCols.push('leatherbound');
  if (prose.slipcase && !row.slipcase) setCols.push('slipcase');

  // Leather ⊂ hardcover: only when a linked edition names a non-hardcover format.
  const setEditionHardcover =
    prose.leatherbound &&
    row.edition_id != null &&
    row.edition_format != null &&
    row.edition_format !== LEATHER_IMPLIES_FORMAT;

  return { setCols, setEditionHardcover };
}

function main() {
  const { commit, remote, friend } = parseFlags();

  const rows = query(
    `SELECT c.id AS copy_id, c.leatherbound, c.sprayed_edges, c.slipcase,
            c.notes AS copy_notes, c.edition_id,
            e.edition_name, e.edition_kind, e.format AS edition_format,
            w.title AS work_title
       FROM copy c
       LEFT JOIN edition e ON e.id = c.edition_id
       LEFT JOIN work w ON w.id = c.work_id
      ORDER BY c.id`,
    { remote, friend },
  );

  const statements = [];
  let copiesChanged = 0;
  let editionsToHardcover = 0;

  for (const row of rows) {
    const { setCols, setEditionHardcover } = planRow(row);
    if (setCols.length === 0 && !setEditionHardcover) continue;

    copiesChanged += 1;
    const parts = [];
    if (setCols.length > 0) {
      parts.push(setCols.join(' + '));
      statements.push(
        `UPDATE copy SET ${setCols.map((c) => `${c} = 1`).join(', ')} WHERE id = ${row.copy_id};`,
      );
    }
    if (setEditionHardcover) {
      editionsToHardcover += 1;
      parts.push(`edition #${row.edition_id} ${row.edition_format} -> hardcover`);
      statements.push(
        `UPDATE edition SET format = '${LEATHER_IMPLIES_FORMAT}' WHERE id = ${row.edition_id};`,
      );
    }
    console.log(`copy #${row.copy_id} (${row.work_title ?? '?'}): ${parts.join('; ')}`);
  }

  const target = friend ? 'padhard (library-catalog-2nd)' : remote ? 'MAIN (library-catalog)' : 'LOCAL';
  console.log('');
  console.log(`Scanned ${rows.length} copies on ${target}.`);
  console.log(
    `Would change ${copiesChanged} cop${copiesChanged === 1 ? 'y' : 'ies'} ` +
      `(${editionsToHardcover} edition${editionsToHardcover === 1 ? '' : 's'} -> hardcover), ` +
      `${statements.length} statement(s).`,
  );

  if (!commit) {
    console.log('DRY RUN — nothing written. Re-run with --commit to apply.');
    return;
  }
  if (statements.length === 0) {
    console.log('Nothing to write.');
    return;
  }
  execute(statements, { remote, friend });
  console.log(`Committed ${statements.length} statement(s).`);
}

// Run only when invoked directly, so the test can import `planRow` without side effects.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sweep-special-editions.mjs')) {
  main();
}
