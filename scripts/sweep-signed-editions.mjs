/**
 * "Signed" typed into the EDITION NAME becomes a standard edition plus the
 * signed button on the COPY.
 *
 * ## Why this exists
 *
 * Diva (the `--friend` instance, padhard) recorded signing the only way the
 * Editions panel let her: she typed the word into `edition.edition_name`. That
 * is prose, so nothing can filter on it, nothing can count it, and the "Mark
 * signed" toggle in `apps/web/src/components/Copies.tsx` stays dark beside a
 * book that is signed.
 *
 * ⚠️ **Signing is a COPY fact, not an edition fact**, and migration 0430 spells
 * out why: two backers of one Kickstarter get different piles out of the SAME
 * `edition` — one signed, one not. `copy.is_signed` has been a real boolean
 * since 0001 precisely so a specific physical object on a shelf can carry it.
 * An `edition` row cannot be signed; only a copy of it can.
 *
 * ## Why clearing the name IS "make it a standard edition"
 *
 * Migration 0050: `edition_kind IS NULL` means **ordinary printing**, not
 * "unclassified" — the one place in this schema where NULL is a positive
 * statement rather than an absence. And an unnamed edition prints no badge. So
 * `edition_name = NULL, edition_kind = NULL` is exactly the owner's "standard
 * edition", written in the schema's own vocabulary. The fact that was in the
 * prose does not vanish: it moves to `copy.is_signed`, where it is editable,
 * filterable and countable.
 *
 * ## The owner's spec (2026-09-03, verbatim)
 *
 *   *"Diva marked books as signed manually in edition, sweep those and apply the
 *   button."* … *"Make them all standard edition and signed instead of signed in
 *   the edition. Keep the hardcover and paperback if available default to
 *   paperback if unknown."*
 *
 * "All" includes the four rows whose names carry more words than "Signed"
 * ("Signed deluxe edition", "After light edition/ signed", "Signed special" ×2).
 * Those words are LOST, so the dry run lists them under **loses extra words**
 * before anything is written — a veto list, printed every run.
 *
 * ## The copy the flag lands on
 *
 * Most of these editions have no copy linked to them at all (measured on
 * padhard 2026-09-03: 55 of 63) — the work's copy sits with `edition_id IS
 * NULL`, which 0001 explicitly allows. So:
 *
 *   * edition HAS linked copies → flag each one that is not already flagged;
 *   * edition has none, and the work has exactly ONE unlinked copy → link that
 *     copy AND flag it **in a single UPDATE**, so the link and the fact travel
 *     atomically rather than leaving a linked-but-unflagged row behind if the
 *     batch dies between two statements;
 *   * anything else (several unlinked copies, or no copy at all) → **printed
 *     under "needs the owner" and not guessed.** Which of three copies she got
 *     signed is not derivable from the database.
 *
 * ⚠️ This never CREATES a copy row. A work with no copy is a work nobody owns
 * yet, and inventing an object on a shelf to hold a flag would be a fabrication.
 *
 * ## Running it
 *
 *   node scripts/sweep-signed-editions.mjs                    # dry run, local
 *   node scripts/sweep-signed-editions.mjs --remote           # dry run, MAIN
 *   node scripts/sweep-signed-editions.mjs --remote --friend  # dry run, padhard
 *   node scripts/sweep-signed-editions.mjs --remote --friend --commit   # APPLY
 *
 * ## `--strip-word` — the SECOND mode, and why there are two
 *
 * The default above deletes the whole name, which is right for padhard, where
 * every name was the bare word. **MAIN is different**: its 20 matching names are
 * real vendor prose that migration 0050 says `edition_name` exists to keep
 * byte-for-byte — "Kickstarter signed paperback", "Collector's Edition Trilogy —
 * Book 1 Signed & Numbered". Clearing those destroys the *Kickstarter*, not just
 * the *signed*.
 *
 * **Owner, verbatim (2026-09-03 14:26 Phoenix):** *"I think remove signed from
 * the name keep the rest, mark them all signed."* So:
 *
 *   * `edition_name` — the WORD "signed" is removed and the remainder kept
 *     (`stripSignedWord`); a name that was only "Signed" becomes NULL;
 *   * `edition_kind` — **untouched**. Nothing in "remove signed from the name"
 *     asks for a collector's edition to stop being one;
 *   * `format` — the same keep-hardcover/paperback rule as the default mode;
 *   * copies — *"mark them all signed"* is read literally: **every** copy of the
 *     work is flagged, linked to the edition or not. A copy is still only
 *     LINKED to the edition where that is unambiguous (one unlinked copy, one
 *     signed-named edition); the ambiguous ones are flagged and listed for a
 *     human to link later, never guessed.
 *
 *   node scripts/sweep-signed-editions.mjs --remote --strip-word            # dry run, MAIN
 *   node scripts/sweep-signed-editions.mjs --remote --strip-word --commit   # APPLY
 *
 * ⚠️ **DRY RUN is the default** — it prints what it WOULD change and writes
 * nothing. `--commit` applies. `--friend` requires `--remote`; `scripts/lib/d1.mjs`
 * refuses the pair's absence because both instances bind `DB`, so a local
 * `--friend` run would rewrite MAIN while reporting about padhard.
 *
 * Idempotent by construction: the match is on `edition_name` containing
 * "signed", and both modes remove that word from the column — the default by
 * clearing it, `--strip-word` by deleting the word — so a second run matches
 * nothing. ⚠️ The one exception is a name where "signed" is not a WORD
 * ("cosigned"): the SQL's `instr` matches it, the word-boundary strip does not,
 * so it is printed as *word not found* and left alone rather than mangled. None
 * exist on either instance (measured 2026-09-03).
 */

import { execute, lit, parseFlags, query } from './lib/d1.mjs';

/**
 * The formats the owner said to keep. Everything else — including `mass_market`
 * and the ebook formats — falls back to `paperback`, per *"keep the hardcover
 * and paperback if available default to paperback if unknown"*.
 *
 * ⚠️ Deliberately NOT `PHYSICAL_FORMATS` from `@lc/core`, which also holds
 * `mass_market`. This is the owner's two-value list, not the schema's.
 */
export const KEEP_FORMATS = ['hardcover', 'paperback'];
export const DEFAULT_FORMAT = 'paperback';

/** Case-insensitive "the name says signed" — the same test the SQL makes. */
export function nameSaysSigned(name) {
  return typeof name === 'string' && name.toLowerCase().includes('signed');
}

/**
 * The connectors that join two things in an edition name. When one of the two
 * is the word we just deleted, the connector has nothing left to join.
 *
 * ⚠️ Only a connector glued to the word's RIGHT is swallowed with it, and the
 * asymmetry is what makes the two owner-checked mappings both come out right:
 *
 *   * "Book 1 Signed **&** Numbered" → the `&` joined *Signed* to *Numbered*,
 *     so it goes: → "Book 1 Numbered".
 *   * "hardcover**,** signed extras" → the comma joins *hardcover* to the item
 *     *signed extras*, which still exists after the word goes, so the comma
 *     stays: → "hardcover, extras".
 *
 * A connector left DANGLING at either end afterwards ("After light edition/")
 * is trimmed by the cleanup pass instead, which needs no such judgement.
 */
const CONNECTOR = String.raw`(?:[&/,;]|and\b)`;

/**
 * Remove the WORD "signed" from an edition name and keep the rest — the
 * `--strip-word` mapping, pure and unit-tested against the owner's own examples.
 *
 * Returns the new name, or `null` when nothing survives ("Signed" → NULL).
 *
 * ⚠️ Word-boundary, case-insensitive: "cosigned" and "unsigned" are NOT the
 * word and come back unchanged (the caller reports those rather than writing
 * them). The remainder is capitalised only when the deleted word was at the
 * START, because that is the only case where the deletion promotes a lower-case
 * word into first position: "Signed special" → "Special", not "special".
 */
export function stripSignedWord(name) {
  if (name === null || name === undefined) return null;

  // The word, plus a connector glued to its right, plus the space either side.
  let out = String(name).replace(
    new RegExp(String.raw`\bsigned\b\s*` + CONNECTOR + String.raw`?\s*`, 'gi'),
    ' ',
  );

  out = out.replace(/\s+/g, ' ').replace(/\s+([,;])/g, '$1');

  // Whatever the deletion left dangling at either end. Looped, because removing
  // a trailing "&" can expose a trailing comma behind it.
  let previous;
  do {
    previous = out;
    out = out
      .replace(new RegExp(String.raw`^\s*` + CONNECTOR + String.raw`\s*`, 'i'), '')
      .replace(new RegExp(String.raw`\s*(?:[&/,;]|\band)\s*$`, 'i'), '')
      .trim();
  } while (out !== previous);

  if (out === '') return null;
  // Only a deletion at the start can leave a lower-case word leading the name.
  if (/^\s*signed\b/i.test(String(name))) return out[0].toUpperCase() + out.slice(1);
  return out;
}

/**
 * The changes one edition row implies — a PURE function, so the whole decision
 * is testable with no database (`scripts/test/sweep-signed-editions.test.mjs`).
 *
 * `row` carries the edition's own columns plus `linked` (copies pointing at this
 * edition) and `unlinked` (the WORK's copies with no edition), each an array of
 * `{ id, is_signed }`.
 *
 * `stripWord` selects the second mode (see the file header): keep the name minus
 * the word, leave `edition_kind` alone, and flag EVERY copy of the work.
 */
export function planRow(row, { stripWord = false } = {}) {
  if (stripWord) return planRowStripWord(row);

  const linked = row.linked ?? [];
  const unlinked = row.unlinked ?? [];

  const clearName = row.edition_name !== null && row.edition_name !== undefined;
  const clearKind = row.edition_kind !== null && row.edition_kind !== undefined;
  const defaultFormat = !KEEP_FORMATS.includes(row.format);

  // Anything other than the bare word is prose we are about to delete. Printed
  // so the owner can veto a row before --commit, never silently swallowed.
  const losesWords = clearName && String(row.edition_name).trim().toLowerCase() !== 'signed';

  /** Linked copies that are not already flagged — a re-run flags nothing. */
  let flagCopyIds = [];
  /** The one unlinked copy to link AND flag, in one statement. */
  let linkCopyId = null;
  /** Why this row's COPY half cannot be decided here. The edition half still applies. */
  let needsOwner = null;

  if (linked.length > 0) {
    flagCopyIds = linked.filter((c) => Number(c.is_signed) !== 1).map((c) => c.id);
  } else if (unlinked.length === 1) {
    linkCopyId = unlinked[0].id;
  } else if (unlinked.length === 0) {
    needsOwner = 'no copy row on this work at all — nothing to flag (a copy is never invented)';
  } else {
    needsOwner =
      `${unlinked.length} unlinked copies on this work — which one is signed is not in the database ` +
      `(copies ${unlinked.map((c) => `#${c.id}`).join(', ')})`;
  }

  return {
    stripWord: false,
    clearName,
    clearKind,
    defaultFormat,
    newFormat: defaultFormat ? DEFAULT_FORMAT : row.format,
    losesWords,
    flagCopyIds,
    linkCopyId,
    needsOwner,
  };
}

/**
 * `--strip-word`: keep the name minus the word, keep the kind, flag every copy.
 *
 * ⚠️ **`flagCopyIds` means something WIDER here than in the default mode**, and
 * the difference is the owner's *"mark them all signed"*: it is every unflagged
 * copy of the WORK — linked to this edition or sitting with `edition_id IS
 * NULL` — not just the ones already pointing at the edition. Linking stays as
 * conservative as it ever was; only the flag is generous. A row whose copies
 * are flagged but not linked is still listed for the owner, because "link it by
 * hand later" is a real outstanding task, not a silent success.
 *
 * ⚠️ `linkCopyId` is left INSIDE `flagCopyIds`; the caller drops it when it
 * builds statements, because the link and the flag travel as one UPDATE. That
 * is deliberate: `resolveCopyCollisions` can null `linkCopyId` afterwards, and
 * the copy must still end up flagged when it does.
 */
function planRowStripWord(row) {
  const linked = row.linked ?? [];
  const unlinked = row.unlinked ?? [];
  const all = [...linked, ...unlinked];

  const hasName = row.edition_name !== null && row.edition_name !== undefined;
  const newName = hasName ? stripSignedWord(row.edition_name) : null;
  const renameName = hasName && newName !== row.edition_name;

  const defaultFormat = !KEEP_FORMATS.includes(row.format);

  // Unambiguous means the same thing it always did: no copy is already linked,
  // and the work has exactly one that could be. The cross-row half of
  // "unambiguous" — one signed-named edition — is resolveCopyCollisions'.
  const linkCopyId = linked.length === 0 && unlinked.length === 1 ? unlinked[0].id : null;
  const flagCopyIds = all.filter((c) => Number(c.is_signed) !== 1).map((c) => c.id);

  let needsOwner = null;
  if (all.length === 0) {
    needsOwner = 'no copy row on this work at all — nothing to flag (a copy is never invented)';
  } else if (unlinked.length > 0 && linkCopyId === null) {
    needsOwner =
      `${unlinked.length} unlinked cop${unlinked.length === 1 ? 'y' : 'ies'} flagged signed but NOT ` +
      `linked to this edition — link by hand later (copies ${unlinked.map((c) => `#${c.id}`).join(', ')})`;
  }

  return {
    stripWord: true,
    clearName: false,
    /** ⚠️ NEVER true in this mode — "remove signed from the name" says nothing about the kind. */
    clearKind: false,
    renameName,
    newName,
    /** `instr` matched but the word boundary did not ("cosigned") — reported, never written. */
    wordNotFound: hasName && !renameName,
    defaultFormat,
    newFormat: defaultFormat ? DEFAULT_FORMAT : row.format,
    losesWords: false,
    flagCopyIds,
    linkCopyId,
    needsOwner,
  };
}

/**
 * ⚠️ Two signed editions of ONE work cannot both take its one unlinked copy.
 *
 * `planRow` sees a single row and cannot know this: it is a fact ACROSS rows.
 * Found the first time this ran against MAIN (2026-09-03) — *Something* has
 * editions #620 (paperback) and #621 (hardcover), both named "Signed", and one
 * copy #407 sitting unlinked. Left alone, the batch would link copy #407 to
 * #620 and then immediately re-link it to #621: the last write silently wins and
 * the report claims two copies were linked when one was, twice.
 *
 * Which of the two printings she actually owns is not in the database, so both
 * go to the owner rather than being guessed. Pure, over the whole plan list, so
 * the rule is testable without a database.
 */
export function resolveCopyCollisions(plans) {
  const claims = new Map();
  for (const plan of plans) {
    if (plan.linkCopyId != null) claims.set(plan.linkCopyId, (claims.get(plan.linkCopyId) ?? 0) + 1);
  }
  return plans.map((plan) => {
    const n = plan.linkCopyId == null ? 0 : (claims.get(plan.linkCopyId) ?? 0);
    if (n <= 1) return plan;
    return {
      ...plan,
      linkCopyId: null,
      // ⚠️ In --strip-word the copy is still FLAGGED (it stays in flagCopyIds);
      // only the link is withheld. Saying so is the difference between "left
      // for you" and "left undone".
      needsOwner:
        `${n} signed editions of this work all claim its one unlinked copy #${plan.linkCopyId} — ` +
        (plan.stripWord
          ? 'the copy is flagged signed anyway, but which printing it is cannot be derived — link it by hand'
          : 'one copy cannot belong to two printings, and which one she owns is not in the database'),
    };
  });
}

/** `"12:0,13:1"` → `[{ id: 12, is_signed: 0 }, { id: 13, is_signed: 1 }]`. */
export function parseCopyList(concatenated) {
  if (concatenated === null || concatenated === undefined || concatenated === '') return [];
  return String(concatenated)
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const [id, isSigned] = pair.split(':');
      return { id: Number(id), is_signed: Number(isSigned) };
    });
}

function main() {
  const { commit, remote, friend } = parseFlags();
  // Not in parseFlags: that helper is shared by every backfill in scripts/, and
  // a flag only this sweep understands does not belong in the common parser.
  const stripWord = process.argv.slice(2).includes('--strip-word');

  // ⚠️ `instr(...) > 0` rather than `LIKE '%signed%'`, and not for SQL reasons:
  // d1.mjs sends reads through wrangler's `--command`, which on Windows goes via
  // cmd.exe, where `%signed%` reads as a variable reference. Same predicate, no
  // percent signs to lose.
  const rows = query(
    `SELECT e.id AS edition_id, e.work_id, e.edition_name, e.edition_kind, e.format,
            w.title AS work_title,
            (SELECT group_concat(c.id || ':' || c.is_signed)
               FROM copy c WHERE c.edition_id = e.id) AS linked_copies,
            (SELECT group_concat(c.id || ':' || c.is_signed)
               FROM copy c WHERE c.work_id = e.work_id AND c.edition_id IS NULL) AS unlinked_copies
       FROM edition e
       LEFT JOIN work w ON w.id = e.work_id
      WHERE instr(lower(e.edition_name), 'signed') > 0
      ORDER BY e.id`,
    { remote, friend },
  );

  const statements = [];
  const losesWords = [];
  const needsOwner = [];
  const renames = [];
  const wordNotFound = [];
  let namesCleared = 0;
  let namesRewritten = 0;
  let kindsCleared = 0;
  let formatsDefaulted = 0;
  let copiesFlagged = 0;
  let copiesLinkedAndFlagged = 0;

  // Two passes: plan every row, THEN settle the cross-row question of two
  // editions claiming one copy. Statements are built only after that.
  const planned = rows.map((raw) => ({
    ...raw,
    linked: parseCopyList(raw.linked_copies),
    unlinked: parseCopyList(raw.unlinked_copies),
  }));
  const plans = resolveCopyCollisions(planned.map((row) => planRow(row, { stripWord })));

  for (const [i, row] of planned.entries()) {
    const plan = plans[i];

    const sets = [];
    if (plan.clearName) {
      sets.push('edition_name = NULL');
      namesCleared += 1;
    }
    if (plan.renameName) {
      sets.push(`edition_name = ${lit(plan.newName)}`);
      if (plan.newName === null) namesCleared += 1;
      else namesRewritten += 1;
      renames.push({ ...row, to: plan.newName });
    }
    if (plan.wordNotFound) wordNotFound.push(row);
    if (plan.clearKind) {
      sets.push('edition_kind = NULL');
      kindsCleared += 1;
    }
    if (plan.defaultFormat) {
      sets.push(`format = '${DEFAULT_FORMAT}'`);
      formatsDefaulted += 1;
    }
    if (sets.length > 0) {
      statements.push(`UPDATE edition SET ${sets.join(', ')} WHERE id = ${row.edition_id};`);
    }

    // ⚠️ The link statement carries its own `is_signed = 1`, so that copy must
    // not also get a bare flag statement — it would be a redundant write, and
    // the counters would double-count it.
    const flagOnly = plan.flagCopyIds.filter((id) => id !== plan.linkCopyId);
    const copyActions = [];

    if (plan.linkCopyId != null) {
      copiesLinkedAndFlagged += 1;
      // One statement on purpose: the link and the flag must travel together.
      statements.push(
        `UPDATE copy SET edition_id = ${row.edition_id}, is_signed = 1 WHERE id = ${plan.linkCopyId};`,
      );
      copyActions.push(`link + flag copy #${plan.linkCopyId}`);
    }
    if (flagOnly.length > 0) {
      copiesFlagged += flagOnly.length;
      for (const id of flagOnly) {
        statements.push(`UPDATE copy SET is_signed = 1 WHERE id = ${id};`);
      }
      copyActions.push(
        `flag cop${flagOnly.length === 1 ? 'y' : 'ies'} ${flagOnly.map((id) => `#${id}`).join(', ')}`,
      );
    }
    if (plan.needsOwner) {
      needsOwner.push({ ...row, why: plan.needsOwner });
      copyActions.push('⚠️ NEEDS THE OWNER');
    }
    if (copyActions.length === 0) copyActions.push('already signed — no copy write');

    if (plan.losesWords) losesWords.push(row);

    const formatNote = plan.defaultFormat ? `${row.format} -> ${DEFAULT_FORMAT}` : row.format;
    const nameNote = plan.renameName
      ? `"${row.edition_name}" -> ${plan.newName === null ? 'NULL' : `"${plan.newName}"`}`
      : `"${row.edition_name}"`;
    console.log(
      `edition #${row.edition_id} · ${row.work_title ?? '?'} · ` +
        `${nameNote} · ${formatNote} · ${copyActions.join(' · ')}`,
    );
  }

  if (renames.length > 0) {
    console.log('');
    console.log('NAME CHANGES — before → after (this listing is the only record of the old names):');
    for (const row of renames) {
      console.log(
        `  edition #${row.edition_id} · ${row.work_title ?? '?'} · ` +
          `"${row.edition_name}" → ${row.to === null ? 'NULL' : `"${row.to}"`}`,
      );
    }
  }

  if (wordNotFound.length > 0) {
    console.log('');
    console.log('⚠️ "signed" IS NOT A WORD IN THESE NAMES — matched by instr, left alone:');
    for (const row of wordNotFound) {
      console.log(`  edition #${row.edition_id} · ${row.work_title ?? '?'} · "${row.edition_name}"`);
    }
  }

  if (losesWords.length > 0) {
    console.log('');
    console.log('⚠️ LOSES EXTRA WORDS — these names say more than "Signed", and the rest is deleted:');
    for (const row of losesWords) {
      console.log(`  edition #${row.edition_id} · ${row.work_title ?? '?'} · "${row.edition_name}"` +
        (row.edition_kind ? ` · edition_kind '${row.edition_kind}' also cleared` : ''));
    }
  }

  if (needsOwner.length > 0) {
    console.log('');
    console.log(
      stripWord
        ? '⚠️ LINK BY HAND LATER — the copies ARE flagged signed, but which printing they are is not in the database:'
        : '⚠️ NEEDS THE OWNER — the edition is normalised, but no copy is flagged:',
    );
    for (const row of needsOwner) {
      console.log(`  work #${row.work_id} "${row.work_title ?? '?'}" (edition #${row.edition_id}, ` +
        `was "${row.edition_name}") — ${row.why}`);
    }
  }

  const target = friend
    ? 'padhard (library-catalog-2nd)'
    : remote
      ? 'MAIN (library-catalog)'
      : 'LOCAL';
  console.log('');
  console.log(`Target: ${target}   Mode: ${stripWord ? '--strip-word (keep the rest of the name)' : 'default (clear the whole name)'}`);
  console.log(`  editions matched .............. ${rows.length}`);
  if (stripWord) {
    console.log(`  names rewritten ............... ${namesRewritten}`);
    console.log(`  names emptied to NULL ......... ${namesCleared}`);
    console.log(`  names left alone (not a word) . ${wordNotFound.length}`);
    console.log(`  kinds cleared ................. ${kindsCleared}  (never, in this mode)`);
  } else {
    console.log(`  names cleared ................. ${namesCleared}`);
    console.log(`  kinds cleared ................. ${kindsCleared}`);
  }
  console.log(`  formats defaulted to paperback  ${formatsDefaulted}`);
  console.log(`  copies flagged ................ ${copiesFlagged}`);
  console.log(`  copies linked + flagged ....... ${copiesLinkedAndFlagged}`);
  console.log(`  rows to link by hand .......... ${needsOwner.length}`);
  console.log(`  statements .................... ${statements.length}`);

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
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('sweep-signed-editions.mjs')
) {
  main();
}
