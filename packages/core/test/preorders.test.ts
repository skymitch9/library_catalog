/**
 * Tests for the pre-order arrival rule — the one that decides whether a book
 * turning up is the copy already on order or a second one.
 *
 * ⚠️ **Its own file, and the reason is the failure it guards.** Everything here
 * is about `preordered` never being treated as `wanted`. The sibling Board Game
 * Catalog shipped those summed and read "262 wanted" over a wishlist of 25; the
 * doc comment on `CollectionStats` in `@lc/db` carries the measurement. A widened
 * filter would not throw — it would silently offer to "receive" a book nobody has
 * bought, which is exactly the class of bug this suite exists for.
 *
 * Run with `npm test` (Node strips the types; no build step, no framework).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PREORDER_STATUS,
  isPreordered,
  preorderQuestionText,
  preorderSentence,
  preorderedCopies,
} from '../src/preorders.ts';
import { COPY_STATUSES, HELD_STATUSES, WISHLIST_STATUSES } from '../src/constants.ts';

const copy = (id: number, status: string) => ({ id, status });

describe('pre-orders — which copies can arrive', () => {
  it('⚠️ takes `preordered` and NOTHING else, `wanted` least of all', () => {
    // The whole rule. A wish has not been bought, so a book turning up cannot be
    // "that wish arriving" — it is a purchase, and the wish is a separate row
    // that may still be outstanding.
    const copies = COPY_STATUSES.map((status, i) => copy(i + 1, status));
    assert.deepEqual(
      preorderedCopies(copies).map((c) => c.status),
      ['preordered'],
    );
  });

  it('is not fooled by the two lists `preordered` legitimately appears on', () => {
    // `WISHLIST_STATUSES` holds both because both mean "not here yet"; that is
    // the only question they ever answer together. `HELD_STATUSES` excludes
    // `preordered` because a book in the post is not on the shelf — which is why
    // an arriving pre-order shows as a gap until somebody says it landed.
    assert.equal(WISHLIST_STATUSES.includes('preordered'), true);
    assert.equal(WISHLIST_STATUSES.includes('wanted'), true);
    assert.equal((HELD_STATUSES as readonly string[]).includes('preordered'), false);
    assert.equal(isPreordered('wanted'), false);
    assert.equal(isPreordered(PREORDER_STATUS), true);
  });

  it('keeps every pre-ordered copy — a work can have three', () => {
    // Production: *Worlds Beyond Number* is one work with three pre-ordered
    // copies, one per variant cover. Collapsing them to "the pre-order" would
    // make the question unanswerable, which is the guess this refuses.
    const copies = [
      copy(1, 'owned'),
      copy(2, 'preordered'),
      copy(3, 'preordered'),
      copy(4, 'preordered'),
      copy(5, 'wanted'),
    ];
    assert.deepEqual(
      preorderedCopies(copies).map((c) => c.id),
      [2, 3, 4],
    );
  });

  it('a book with nothing on order asks nothing — the ordinary answer', () => {
    assert.deepEqual(preorderedCopies([copy(1, 'owned'), copy(2, 'lent')]), []);
    assert.deepEqual(preorderedCopies([]), []);
  });

  it('does not copy the array it was handed', () => {
    // Callers map straight over the result and hand it to a component. A filter
    // that aliased the input would let a later render mutate the catalog's view.
    const copies = [copy(1, 'preordered')];
    const out = preorderedCopies(copies);
    assert.notEqual(out, copies);
    assert.equal(out[0], copies[0]);
  });
});

describe('pre-orders — the words the prompt uses', () => {
  it('says "pre-order", never "wanted"', () => {
    // Two different rows meaning two different things about a wallet. Blurring
    // them in the prompt teaches the wrong distinction at the one moment
    // somebody is acting on it.
    const said = preorderSentence(1, 'Tamer: King of Dinosaurs 11');
    assert.match(said, /pre-order/);
    assert.doesNotMatch(said, /wanted/i);
    assert.match(said, /Tamer: King of Dinosaurs 11/);
  });

  it('counts, so three variant covers do not read as one', () => {
    assert.match(preorderSentence(3, 'The Wizard, The Witch, The Wild One'), /3 copies/);
    assert.match(preorderSentence(1, 'x'), /a copy/);
  });

  it('still forms a sentence when the title is unknown', () => {
    // A spine read can name a work id with no title on the line. "“” already
    // has…" would be worse than a pronoun.
    assert.equal(preorderSentence(1, null), 'This book already has a copy on pre-order.');
  });

  it('⚠️ the question offers exactly two readings and no default', () => {
    for (const count of [1, 3]) {
      const asked = preorderQuestionText(count);
      assert.match(asked, /different copy/);
      assert.match(asked, /\?$/);
    }
    // Singular names the pre-order; plural cannot, because there are several.
    assert.match(preorderQuestionText(1), /that pre-order/);
    assert.match(preorderQuestionText(2), /one of those/);
  });
});
