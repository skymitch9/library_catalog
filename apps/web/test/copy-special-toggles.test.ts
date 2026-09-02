/**
 * An EXISTING copy can be marked signed — and the three attributes beside it.
 *
 * ## Why this is worth a test at all
 *
 * > *"i thought we had a way to mark signed books on the ui, i dont see that
 * > option anymore."* — the owner, 2026-08-22.
 *
 * ⚠️ **It had never gone away, because it had never been there.** The `Signed`
 * checkbox lived only on the **AddCopy** form, so the fact could be captured
 * while first recording a copy and never afterwards — and signing is precisely
 * a fact learned later, when a book comes home from an event. The control on
 * the copy row was added 2026-08-22 (`ede7ff3`) and generalised to the four
 * special-edition attributes with migration 0430 (`eeb08ab`, 2026-08-24).
 *
 * A control whose absence was reported once, in those words, is a control worth
 * pinning: nothing else in the tree fails if the chips stop rendering, and the
 * report that catches it is a person noticing months later.
 *
 * ## The two halves, and why both
 *
 * 1. **The API accepts it.** `PATCH /api/copies/:id` must take each attribute
 *    ON ITS OWN. `updateCopySchema` is `createCopySchema.partial().strict()`,
 *    and the subtlety worth holding is that `.partial()` wraps each field as
 *    `ZodOptional<ZodDefault<…>>`: an absent key short-circuits at the
 *    `ZodOptional`, so the `.default(false)` never fires and a one-key patch
 *    **resets none of the others**. If that ever inverted, marking a book
 *    signed would silently un-mark its slipcase.
 * 2. **The control is on the row.** A schema that accepts a field nothing sends
 *    is the state the owner reported.
 *
 * The second half is a source-structure assertion because this app has no DOM
 * renderer — see `bulk-action-bar-hooks.test.ts` for the full reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { updateCopySchema } from '@lc/core';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/components/Copies.tsx', import.meta.url)),
  'utf8',
);

/** The write keys the row's chips send. Mirrors `SPECIAL_TOGGLES` in the component. */
const PATCH_KEYS = ['isSigned', 'sprayedEdges', 'leatherbound', 'slipcase'] as const;

describe('PATCH /api/copies/:id accepts each special-edition attribute alone', () => {
  for (const key of PATCH_KEYS) {
    it(`takes { ${key}: true } on its own`, () => {
      const parsed = updateCopySchema.parse({ [key]: true });
      assert.equal(parsed[key], true);
    });

    it(`⚠️ { ${key} } resets nothing else — the other keys stay ABSENT`, () => {
      const parsed = updateCopySchema.parse({ [key]: true });
      for (const other of PATCH_KEYS) {
        if (other === key) continue;
        assert.equal(
          other in parsed,
          false,
          `${other} appeared in a one-key ${key} patch — .partial() has stopped short-circuiting and a mark would clear its neighbours`,
        );
      }
      // The same rule, for the fields that are not booleans at all.
      assert.equal('status' in parsed, false);
      assert.equal('currency' in parsed, false);
    });

    it(`can also UN-mark: { ${key}: false }`, () => {
      assert.equal(updateCopySchema.parse({ [key]: false })[key], false);
    });
  }

  it('still refuses an unmodelled key rather than stripping it', () => {
    // ⚠️ The update schemas are `.strict()` where the CREATE schemas are not —
    // KI-10. That asymmetry is deliberate and this is the half that must not
    // drift: a silently dropped flag reads as a successful mark.
    assert.throws(() => updateCopySchema.parse({ is_signed: true }));
  });
});

describe('the copy row offers the toggles', () => {
  it('names all four attributes in SPECIAL_TOGGLES', () => {
    for (const key of PATCH_KEYS) {
      assert.match(
        SOURCE,
        new RegExp(`patch: '${key}'`),
        `${key} left SPECIAL_TOGGLES — the chip and the summary line have drifted`,
      );
    }
  });

  it('spells BOTH directions, so un-marking is discoverable', () => {
    assert.match(SOURCE, /mark: 'Mark signed'/);
    assert.match(SOURCE, /unmark: 'Not signed'/);
  });

  it('renders the toggles inside the existing-copy actions, not only the add form', () => {
    const actions = SOURCE.indexOf('copy__actions');
    const addForm = SOURCE.indexOf('function AddCopy');
    const rendered = SOURCE.indexOf('SPECIAL_TOGGLES.map(');
    assert.notEqual(actions, -1, 'the copy row lost its actions block');
    assert.notEqual(rendered, -1, 'nothing renders SPECIAL_TOGGLES — the row has no toggles');
    assert.ok(
      rendered > actions,
      'SPECIAL_TOGGLES is rendered before the copy row actions — it is not on the row',
    );
    assert.ok(
      addForm === -1 || rendered < addForm,
      'SPECIAL_TOGGLES moved into AddCopy — that is the 2026-08-22 defect exactly: settable only while first recording a copy',
    );
  });

  it('writes the flipped value, so the chip is a toggle and not a one-way mark', () => {
    assert.match(SOURCE, /\{ \[t\.patch\]: !c\[t\.field\] \}/);
  });
});
