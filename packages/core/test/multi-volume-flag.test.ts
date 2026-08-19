/**
 * `multiVolumePrinting` — the one field a machine may never touch.
 *
 * ## The rule
 *
 * Owner, 2026-08-19, verbatim: *"series == volume unless human intervention on
 * the ui or by me telling you there is 2 books sharing 1 series slot as 2
 * volumes. make it a check box in the book edit for this book is the same spot
 * in the series but has multiple volumes."*
 *
 * So the default model is **`series_index_sort` IS the volume** — book 3 of a
 * series is volume 3, and there is no second concept. The flag names the single
 * exception: one position in the reading order, printed as more than one
 * physical book (the Words of Radiance two-volume leatherbound; "part 1 of 2"
 * printings generally). Where it is true, the optional printed designation
 * becomes meaningful; where false, that designation is noise.
 *
 * ## ⚠️ Why the guard is mechanical rather than written down
 *
 * It is a fact about a **physical printing**, and this catalog is EPUB files.
 * A model asked *"is this a two-volume printing?"* answers confidently and
 * wrongly for any book with a part-1-of-2 audiobook, a boxed set, or an
 * omnibus — and nothing downstream could catch it, because there is no title
 * string to compare and no second source to corroborate against. That is
 * `isbn-ladder.md` §4.4's failure shape with the safety rail removed, which is
 * the same argument that keeps `isbn13` off the research list.
 *
 * These tests pin the three doors it must not have. They are cheap, and the
 * thing they prevent is a field that quietly acquires a machine writer in six
 * months because somebody adds a `DETAIL_FIELDS` entry without reading this.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { DETAIL_FIELDS } from '../src/constants.js';
import { detailGaps, detailFieldsFor, DETAIL_FIELD_LABEL } from '../src/gaps.js';
import { createWorkSchema, updateWorkSchema } from '../src/schemas.js';

describe('multiVolumePrinting is human-only', () => {
  it('⚠️ is not a DETAIL_FIELD, so no research pass can be sent to find it', () => {
    // The single most important assertion here. `DETAIL_FIELDS` is what the
    // model is asked for, what `applyFinding` switches on, and what the sweep
    // budgets subrequests against. Absence from it is what makes the whole
    // machine blind to this column.
    assert.ok(!(DETAIL_FIELDS as readonly string[]).includes('multiVolumePrinting'));
    assert.ok(!Object.keys(DETAIL_FIELD_LABEL).includes('multiVolumePrinting'));
  });

  it('⚠️ never appears as a gap, so it cannot reach the queue or the sweep', () => {
    // False is the ordinary answer and means nothing needs doing. A flag that
    // showed up as a gap would put every book in the catalog on the worklist
    // and, worse, invite a lookup to close it.
    const ordinary = {
      firstPublished: 2022,
      series: 'Stormlight Archive',
      seriesIndexSort: 2,
      seriesIndexDisplay: null,
      description: 'A book.',
    };
    assert.deepEqual(detailGaps(ordinary), []);
    assert.ok(!detailFieldsFor(ordinary).includes('multiVolumePrinting' as never));
    // And an empty work still asks only the four real questions.
    assert.deepEqual(detailGaps({}), ['firstPublished', 'series', 'description']);
  });

  it('⚠️ is NOT on the create contract — no importer may originate it', () => {
    // The asymmetry is the design. Every new row starts false (migration 0360's
    // DEFAULT 0); it becomes true only by a person ticking the box. zod strips
    // rather than rejects on a non-strict object, so the assertion is that the
    // value does not survive — which is exactly what "an importer cannot set
    // it" means in practice.
    const parsed = createWorkSchema.parse({
      title: 'Words of Radiance',
      authors: 'Brandon Sanderson',
      multiVolumePrinting: true,
    } as never);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(parsed, 'multiVolumePrinting'),
      'create must not carry the flag',
    );
  });

  it('IS on the update contract, because the checkbox writes through it', () => {
    // The one legitimate door. Both directions, because unticking must work as
    // well as ticking — a wrongly-ticked box is the owner's to correct.
    assert.equal(updateWorkSchema.parse({ multiVolumePrinting: true }).multiVolumePrinting, true);
    assert.equal(updateWorkSchema.parse({ multiVolumePrinting: false }).multiVolumePrinting, false);
    // Absent stays absent — a patch that does not mention it must not clear it.
    assert.ok(
      !Object.prototype.hasOwnProperty.call(updateWorkSchema.parse({}), 'multiVolumePrinting'),
    );
  });

  it('refuses a non-boolean rather than coercing one', () => {
    // ⚠️ zod SILENTLY STRIPPING a bad value is the defect this repo already
    // paid for once (a stray `rating`), and coercion would be worse here: the
    // string "false" is truthy in JavaScript, so a coercing schema would tick
    // the box for a caller trying to untick it.
    assert.throws(() => updateWorkSchema.parse({ multiVolumePrinting: 'true' }));
    assert.throws(() => updateWorkSchema.parse({ multiVolumePrinting: 1 }));
  });
});
