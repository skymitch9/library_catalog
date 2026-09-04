/**
 * `splitEditionNote` / `planRow` — what the edition-note sweep would change for
 * one row, exercised with no database. This mapping IS the sweep's decision; the
 * D1 read and the UPDATE batch around it are plumbing.
 *
 * ⚠️ Pins the five things that make the sweep safe:
 *   1. **the suffix moves WHOLE and the prefix stays WHOLE** — the owner's
 *      *"remove the no bar code part from the title and put it into a note"*,
 *      with nothing invented and nothing dropped;
 *   2. **both production wordings are matched** — "No barcode printed on this
 *      copy (owner-verified)" and "no ISBN printed on this edition
 *      (owner-verified)"; only the parenthetical is common to the two, which is
 *      why the marker is not `NO_BARCODE_NOTE`;
 *   3. **a name that is NOTHING BUT the phrase becomes "Standard edition"** —
 *      the catalog's own word for a plain printing (MAIN #450 and #470);
 *   4. **an existing note is never overwritten** — that row goes to the owner;
 *   5. **a re-run is a no-op** — the write removes the marker from the name, so
 *      nothing matches twice, and a row whose note is already right gets the
 *      name statement alone.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { STANDARD_EDITION, planRow, splitEditionNote } from '../split-edition-note.mjs';

const BARCODE = 'No barcode printed on this copy (owner-verified)';
const ISBN = 'no ISBN printed on this edition (owner-verified)';

describe('splitEditionNote — the suffix comes off, the identity stays', () => {
  it('⚠️ MAIN #378/#379, the /work/263 rows: em dash, name kept whole', () => {
    assert.deepEqual(splitEditionNote(`V1 Limited Edition hardcover — ${BARCODE}`), {
      name: 'V1 Limited Edition hardcover',
      note: BARCODE,
      whole: false,
    });
  });

  it('⚠️ MAIN #307–311, the Illumicrate rows: a HYPHEN and the OTHER wording', () => {
    // The marker is the parenthetical, not `NO_BARCODE_NOTE` — matching the
    // exported constant would leave all five of these behind.
    assert.deepEqual(splitEditionNote(`Illumicrate Exclusive - ${ISBN}`), {
      name: 'Illumicrate Exclusive',
      note: ISBN,
      whole: false,
    });
  });

  it('⚠️ padhard #426: one row, same shape', () => {
    assert.deepEqual(splitEditionNote(`Allural — ${BARCODE}`), {
      name: 'Allural',
      note: BARCODE,
      whole: false,
    });
  });

  it('⚠️ MAIN #450/#470: the WHOLE name is the phrase → "Standard edition"', () => {
    assert.deepEqual(splitEditionNote(BARCODE), {
      name: STANDARD_EDITION,
      note: BARCODE,
      whole: true,
    });
    // A leading separator names no printing either.
    assert.deepEqual(splitEditionNote(`— ${BARCODE}`), {
      name: STANDARD_EDITION,
      note: BARCODE,
      whole: true,
    });
  });

  it("⚠️ splits at the LAST separator — a name's own dash survives", () => {
    assert.deepEqual(splitEditionNote(`Book 1 - Deluxe — ${BARCODE}`), {
      name: 'Book 1 - Deluxe',
      note: BARCODE,
      whole: false,
    });
  });

  it('⚠️ a hyphen inside a word is NOT a separator', () => {
    // The regex wants whitespace on both sides. Without that, "Well-known"
    // would be cut in half and "owner-verified" would cut itself.
    assert.deepEqual(splitEditionNote(`Well-known edition — ${BARCODE}`), {
      name: 'Well-known edition',
      note: BARCODE,
      whole: false,
    });
  });

  it('a name without the marker is not ours — null, never a guess', () => {
    assert.equal(splitEditionNote('BN Exclusive'), null);
    assert.equal(splitEditionNote(null), null);
    assert.equal(splitEditionNote(undefined), null);
  });

  it('⚠️ a re-run matches NOTHING — the new name carries no marker', () => {
    const first = splitEditionNote(`Allural — ${BARCODE}`);
    assert.equal(splitEditionNote(first.name), null);
  });
});

describe('planRow — what is written, and what is refused', () => {
  const row = (over = {}) => ({
    edition_id: 1,
    work_id: 2,
    edition_name: `Allural — ${BARCODE}`,
    note: null,
    ...over,
  });

  it('a null note is filled and the name is rewritten', () => {
    const plan = planRow(row());
    assert.equal(plan.name, 'Allural');
    assert.equal(plan.note, BARCODE);
    assert.equal(plan.noteAlreadySet, false);
    assert.equal(plan.skip, undefined);
  });

  it('⚠️ a note that is ALREADY the phrase → the name statement alone', () => {
    const plan = planRow(row({ note: BARCODE }));
    assert.equal(plan.noteAlreadySet, true, 'no redundant write, and no double-counted note');
    assert.equal(plan.name, 'Allural');
  });

  it("⚠️ a note somebody ELSE wrote is never overwritten — it goes to the owner", () => {
    const plan = planRow(row({ note: 'Spine faded, bought at a con' }));
    assert.ok(plan.skip, 'refused');
    assert.equal(plan.needsOwner, true);
    assert.ok(plan.skip.includes('Spine faded'), 'and the report says what it would have destroyed');
  });

  it('a row the query matched but the splitter does not claim is skipped, not guessed', () => {
    const plan = planRow(row({ edition_name: 'BN Exclusive' }));
    assert.ok(plan.skip);
    assert.equal(plan.needsOwner, undefined, 'nothing for a person to do — it is simply not ours');
  });
});
