/**
 * `planRow` — what the 0430 back-fill sweep would change for one copy,
 * exercised with no database. This is the dry-run's mapping, which is the whole
 * decision the sweep makes; the D1 read/write around it is plumbing.
 *
 * ⚠️ Pins the two things that make the sweep safe:
 *   1. it proposes a column only when the prose says so AND the column is not
 *      already set — so a second run is a no-op;
 *   2. leather ⊂ hardcover fires ONLY when a linked edition names a
 *      non-hardcover format — never for a leatherbound copy with no edition, and
 *      never when the edition is already hardcover.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { planRow } from '../sweep-special-editions.mjs';

/** A copy row with everything unset unless overridden. */
function row(over = {}) {
  return {
    copy_id: 1,
    leatherbound: 0,
    sprayed_edges: 0,
    slipcase: 0,
    copy_notes: null,
    edition_id: null,
    edition_name: null,
    edition_kind: null,
    edition_format: null,
    work_title: 'X',
    ...over,
  };
}

describe('sweep planRow — the dry-run mapping', () => {
  it('maps a leatherbound edition name to the leatherbound column', () => {
    const p = planRow(row({ edition_name: 'Signed Leatherbound' }));
    assert.deepEqual(p.setCols, ['leatherbound']);
  });

  it('detects sprayed edges and slipcase from prose, together', () => {
    const p = planRow(row({ edition_name: 'Deluxe — sprayed edges, slipcased' }));
    assert.deepEqual(p.setCols.sort(), ['slipcase', 'sprayed_edges']);
  });

  it('reads the copy notes as well as the edition prose', () => {
    const p = planRow(row({ copy_notes: 'has sprayed edges' }));
    assert.deepEqual(p.setCols, ['sprayed_edges']);
  });

  it('⚠️ does NOT re-propose a column that is already set — a re-run is a no-op', () => {
    const p = planRow(row({ leatherbound: 1, edition_name: 'Leatherbound' }));
    assert.deepEqual(p.setCols, []);
  });

  it('an ordinary printing changes nothing', () => {
    const p = planRow(row({ edition_name: 'Tor 2010', edition_id: 5, edition_format: 'paperback' }));
    assert.deepEqual(p.setCols, []);
    assert.equal(p.setEditionHardcover, false);
  });

  it('⚠️ leather ⊂ hardcover: a leatherbound copy on a paperback edition proposes hardcover', () => {
    const p = planRow(
      row({ edition_id: 5, edition_format: 'paperback', edition_name: 'Leatherbound' }),
    );
    assert.deepEqual(p.setCols, ['leatherbound']);
    assert.equal(p.setEditionHardcover, true);
  });

  it('no edition linked — leather sets the column but proposes NO format write', () => {
    const p = planRow(row({ edition_id: null, copy_notes: 'leatherbound' }));
    assert.deepEqual(p.setCols, ['leatherbound']);
    assert.equal(p.setEditionHardcover, false);
  });

  it('edition already hardcover — no redundant format write', () => {
    const p = planRow(
      row({ edition_id: 5, edition_format: 'hardcover', edition_name: 'Leatherbound' }),
    );
    assert.equal(p.setEditionHardcover, false);
  });
});
