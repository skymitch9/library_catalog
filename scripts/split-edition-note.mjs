/**
 * "No barcode printed on this copy (owner-verified)" comes OUT of the edition
 * NAME and into `edition.note` — migration 0460's data half.
 *
 * ## The ask, verbatim (owner, 2026-09-03 17:22 Phoenix)
 *
 *   "Also remove the no bar code part from the title and put it into a note in
 *    the edit page of the edition entries"
 *
 * Said of /work/263, whose shelf cards read *"V1 Limited Edition hardcover — No
 * barcode printed on this copy (owner-verified)"*. `edition_name` holds what the
 * SHOP called the printing (migration 0050, kept byte-for-byte) and is the
 * headline every shelf card leads with; an observation somebody made at the
 * shelf is a different kind of fact, and since 0460 it has a column.
 *
 * ⚠️ **Nothing is lost and nothing is invented.** The suffix moves whole, the
 * prefix stays whole, and both are printed before anything is written.
 *
 * ## The mapping
 *
 *   | today's `edition_name` | becomes |
 *   |---|---|
 *   | `V1 Limited Edition hardcover — No barcode printed on this copy (owner-verified)` | name `V1 Limited Edition hardcover`, note `No barcode printed on this copy (owner-verified)` |
 *   | `Illumicrate Exclusive - no ISBN printed on this edition (owner-verified)` | name `Illumicrate Exclusive`, note `no ISBN printed on this edition (owner-verified)` |
 *   | `No barcode printed on this copy (owner-verified)` — the WHOLE name | name **`Standard edition`**, note the whole phrase |
 *
 * ⚠️ **Why the third row is named at all.** Clearing it would leave a printing
 * with no identity of any kind; *"Standard edition"* is this catalog's own
 * precedent for a plain printing with nothing distinguishing about it, written
 * into 4 MAIN and 63 padhard rows by `sweep-signed-editions.mjs` on the same
 * afternoon at the owner's instruction (*"For books that lost signed and became
 * null make them standard edition"*). Two rows are affected — MAIN #450 and
 * #470 — and both are listed under **WHOLE NAME WAS THE NOTE** every run so he
 * can rename them if he would rather.
 *
 * ## Measured before it was written (2026-09-03 17:30, both instances live)
 *
 *   MAIN (library-catalog): **9 rows** — #307–311, #378, #379, #450, #470.
 *   padhard (library-catalog-2nd): **1 row** — #426 `Allural — No barcode …`.
 *
 * ## Running it
 *
 *   node scripts/split-edition-note.mjs                    # dry run, local
 *   node scripts/split-edition-note.mjs --remote           # dry run, MAIN
 *   node scripts/split-edition-note.mjs --remote --friend  # dry run, padhard
 *   node scripts/split-edition-note.mjs --remote --apply   # APPLY to MAIN
 *   node scripts/split-edition-note.mjs --remote --friend --apply   # APPLY to padhard
 *
 * ⚠️ **DRY RUN is the default** — it prints what it WOULD change and writes
 * nothing. `--apply` (or `--commit`, the older spelling every other sweep in
 * `scripts/` uses) writes; `--dry-run` is accepted and means the default, so
 * saying it out loud is never wrong. `--friend` requires `--remote`:
 * `scripts/lib/d1.mjs` refuses the pair's absence because both instances bind
 * `DB`, so a local `--friend` run would rewrite MAIN while reporting about
 * padhard.
 *
 * ⚠️ **Idempotent by construction.** The match is on `edition_name` containing
 * "owner-verified", and the write removes that text from the column, so a second
 * run matches nothing. A row whose `note` is ALREADY something else is never
 * clobbered — it is printed under **NEEDS THE OWNER** and skipped, because a
 * remark somebody typed is not this script's to overwrite.
 *
 * ⚠️ **Run it AFTER `migrations/0460_edition_note.sql`** on that instance, and
 * on BOTH instances (global rule 2026-09-03: every data sweep runs on both, and
 * the report carries both numbers). It REFUSES to run before the migration
 * rather than reporting zero — see `requireNoteColumn`, and the measurement
 * behind it: a SELECT naming a column D1 does not have comes back as an empty
 * result set, not as an error.
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

/**
 * The name a printing gets when its whole name was the note.
 *
 * ⚠️ Not "" and not NULL. See the file header: this is the catalog's existing
 * word for a plain printing, written by the signed sweep the same afternoon, and
 * an edition with no identity at all reads on the shelf as a bare format word.
 */
export const STANDARD_EDITION = 'Standard edition';

/**
 * The one string that says a row is ours to move — case-insensitive.
 *
 * ⚠️ Deliberately the SHORTEST stable part of the phrase rather than
 * `NO_BARCODE_NOTE` from `@lc/core`. Production carries two wordings ("No
 * barcode printed on this copy (owner-verified)" and "no ISBN printed on this
 * edition (owner-verified)") and only the parenthetical is common to both; the
 * exported constant matches one of the two and would silently leave five
 * Illumicrate rows behind.
 */
const MARKER = 'owner-verified';

/**
 * The separators an edition name uses to hang the note off its end: an em dash,
 * an en dash or a hyphen, **with whitespace on both sides**.
 *
 * ⚠️ The whitespace is what makes this safe. A bare `-` would split
 * "Well-known" and "owner-verified" itself; requiring spaces means only a
 * separator between two phrases matches.
 */
const SEPARATOR = /\s+[—–-]\s+/g;

/**
 * What one edition name becomes — a PURE function, so the whole decision is
 * testable with no database (`scripts/test/split-edition-note.test.mjs`).
 *
 * Returns `null` when the name is not one of ours (no marker), else
 * `{ name, note, whole }` where `whole` says the name was nothing BUT the note.
 *
 * ⚠️ It splits at the LAST separator before the marker, not the first. A name
 * with its own internal dash ("Book 1 - Deluxe — No barcode …") keeps every
 * word of its identity and gives up only the note.
 */
export function splitEditionNote(name) {
  if (name === null || name === undefined) return null;
  const raw = String(name);
  const marker = raw.toLowerCase().indexOf(MARKER);
  if (marker < 0) return null;

  const seps = [...raw.matchAll(SEPARATOR)].filter((m) => m.index < marker);
  const last = seps[seps.length - 1];
  // ⚠️ A dash with nothing in front of it is not a SEPARATOR (the pattern wants
  // whitespace on both sides), so "— No barcode …" lands here rather than in the
  // split below — and the dash has to come off, or the note would keep a mark
  // that only ever joined it to a name that was never there.
  if (!last) {
    return { name: STANDARD_EDITION, note: raw.trim().replace(/^[—–-]\s*/, '').trim(), whole: true };
  }

  const prefix = raw.slice(0, last.index).trim();
  const note = raw.slice(last.index + last[0].length).trim();
  // A separator with nothing in front of it is the whole-name case wearing a
  // dash — "— No barcode …" names no printing either.
  if (prefix === '') return { name: STANDARD_EDITION, note, whole: true };
  return { name: prefix, note, whole: false };
}

/**
 * The change one row implies, or a reason it is being left alone. Pure, over a
 * row carrying `edition_name` and its CURRENT `note`.
 *
 * ⚠️ **An existing note is never overwritten.** `note` is a person's own words
 * (or this sweep's own earlier run); replacing one because a name happens to
 * carry a marker would destroy something nobody asked to lose. The only case
 * that proceeds is a null note, or a note that already IS the text we were about
 * to write — which is the re-run, and is a no-op on that column.
 */
export function planRow(row) {
  const split = splitEditionNote(row.edition_name);
  if (!split) return { skip: 'the name does not carry the marker' };

  const current = row.note ?? null;
  if (current !== null && current.trim() !== '' && current.trim() !== split.note) {
    return {
      skip:
        `this printing already has a note (${JSON.stringify(current)}) — the name would ` +
        'overwrite it, and somebody wrote that. Move it by hand.',
      needsOwner: true,
      ...split,
    };
  }

  return {
    ...split,
    // The re-run: the note is already right, only the name still carries it.
    noteAlreadySet: current !== null && current.trim() === split.note,
  };
}

/**
 * ⚠️ **Refuse to run before migration 0460, LOUDLY.**
 *
 * Measured 2026-09-03 building this script: a `SELECT … e.note …` against an
 * instance without the column comes back from `d1.mjs`'s `query()` as **an
 * empty array**, not an error — wrangler's failure output still parses, so the
 * sweep printed *"editions matched … 0"* against a MAIN catalog holding nine of
 * them and said DRY RUN as if all were well. A zero that means "no such column"
 * is indistinguishable from a zero that means "already swept", and this repo has
 * been bitten by that shape before (`import-ebooks.mjs`: a counter that lies
 * about a no-op looks exactly like the bug it was meant to disprove).
 *
 * `pragma_table_info` answers it in one cheap read, and it works on `--remote`.
 */
function requireNoteColumn({ remote, friend }) {
  const cols = query(`SELECT name FROM pragma_table_info('edition')`, { remote, friend }).map(
    (r) => r.name,
  );
  if (cols.includes('note')) return;
  throw new Error(
    'edition.note does not exist on this instance — run migrations/0460_edition_note.sql ' +
      'against it FIRST (npm run db:migrate / db:migrate:friend). Without the column the ' +
      'sweep\'s SELECT returns an EMPTY RESULT rather than an error, and would report ' +
      '"0 editions matched" over rows it simply could not read.',
  );
}

function main() {
  const argv = process.argv.slice(2);
  const { remote, friend, commit } = parseFlags(argv);
  // `--apply` is the spelling this sweep was asked for; `--commit` is what every
  // other script in scripts/ uses. Both mean write; neither means dry.
  const apply = commit || argv.includes('--apply');

  // ⚠️ FIRST, before anything is counted — see `requireNoteColumn`. A missing
  // column reads as "nothing matched" here, not as a failure.
  requireNoteColumn({ remote, friend });

  // ⚠️ `instr(...)` rather than `LIKE '%owner-verified%'`, and not for SQL
  // reasons: `d1.mjs` sends reads through wrangler's `--command`, which on
  // Windows goes via cmd.exe, where `%…%` reads as a variable reference. Same
  // predicate, no percent signs to lose. (`sweep-signed-editions.mjs` learned
  // this the hard way; the comment is repeated because the trap is invisible.)
  const rows = query(
    `SELECT e.id AS edition_id, e.work_id, e.edition_name, e.note, e.format,
            w.title AS work_title
       FROM edition e
       LEFT JOIN work w ON w.id = e.work_id
      WHERE instr(lower(e.edition_name), 'owner-verified') > 0
      ORDER BY e.id`,
    { remote, friend },
  );

  const statements = [];
  const wholeName = [];
  const needsOwner = [];
  let renamed = 0;
  let notesWritten = 0;

  for (const row of rows) {
    const plan = planRow(row);

    if (plan.skip) {
      console.log(
        `edition #${row.edition_id} · ${row.work_title ?? '?'} · SKIPPED — ${plan.skip}`,
      );
      if (plan.needsOwner) needsOwner.push({ ...row, why: plan.skip });
      continue;
    }

    const sets = [`edition_name = ${lit(plan.name)}`];
    renamed += 1;
    if (!plan.noteAlreadySet) {
      sets.push(`note = ${lit(plan.note)}`);
      notesWritten += 1;
    }
    statements.push(`UPDATE edition SET ${sets.join(', ')} WHERE id = ${row.edition_id};`);

    console.log(
      `edition #${row.edition_id} · ${row.work_title ?? '?'} · ` +
        `"${row.edition_name}" → "${plan.name}" | note: "${plan.note}"` +
        (plan.noteAlreadySet ? ' (note already set — name only)' : '') +
        (plan.whole ? ' ⚠️ WHOLE NAME WAS THE NOTE' : ''),
    );
    if (plan.whole) wholeName.push({ ...row, to: plan.name });
  }

  if (wholeName.length > 0) {
    console.log('');
    console.log(
      `⚠️ WHOLE NAME WAS THE NOTE — these printings had no name but the phrase, and are being ` +
        `called "${STANDARD_EDITION}" (the catalog's own word for a plain printing). Rename them ` +
        `by hand if that is wrong:`,
    );
    for (const row of wholeName) {
      console.log(
        `  edition #${row.edition_id} · work #${row.work_id} "${row.work_title ?? '?'}" · ` +
          `${row.format} · was "${row.edition_name}"`,
      );
    }
  }

  if (needsOwner.length > 0) {
    console.log('');
    console.log('⚠️ NEEDS THE OWNER — a note is already there and this sweep will not overwrite it:');
    for (const row of needsOwner) {
      console.log(`  edition #${row.edition_id} · ${row.work_title ?? '?'} — ${row.why}`);
    }
  }

  const target = friend
    ? 'padhard (library-catalog-2nd)'
    : remote
      ? 'MAIN (library-catalog)'
      : 'LOCAL';
  console.log('');
  console.log(`Target: ${target}`);
  console.log(`  editions matched .............. ${rows.length}`);
  console.log(`  names rewritten ............... ${renamed}`);
  console.log(`  notes written ................. ${notesWritten}`);
  console.log(`  whole name was the note ....... ${wholeName.length}  (→ "${STANDARD_EDITION}")`);
  console.log(`  left for the owner ............ ${needsOwner.length}`);
  console.log(`  statements .................... ${statements.length}`);

  if (!apply) {
    console.log('DRY RUN — nothing written. Re-run with --apply to write.');
    return;
  }
  if (statements.length === 0) {
    console.log('Nothing to write.');
    return;
  }
  execute(statements, { remote, friend });
  console.log(`Committed ${statements.length} statement(s).`);
}

// Run only when invoked directly, so the test can import the pure functions
// without touching a database.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('split-edition-note.mjs')
) {
  main();
}
