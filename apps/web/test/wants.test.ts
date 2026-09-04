/**
 * "Is this book already on the wishlist?" — the pure half.
 *
 * ## ⚠️ THE DECISION THIS PINS, AND WHY IT IS A DECISION AT ALL
 *
 * The barcode scanner's Wishlist target (owner ask 2026-09-04) must not write a
 * second `wanted` row against a work that already carries one: two rows asking
 * for one book is a wishlist that offers to buy it twice. Scanning a book you
 * OWN twice is the opposite — a real event, which is what "Add 2nd copy" is
 * for — so the two cases deliberately behave differently, and the difference is
 * decided here rather than in a component no test can mount.
 *
 * ## ⚠️ A PRE-ORDER COUNTS, AND GETS DIFFERENT WORDS
 *
 * `WISHLIST_STATUSES` is `['wanted','preordered']`, and both block a second
 * want: a pre-order is a want that has already been paid for. But the sentence
 * differs — "already on your wishlist" over a book that is bought and in the
 * post would send somebody back to the shop, which is the exact failure
 * `@lc/core/preorders.ts` exists to prevent, arriving through another door.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WISHLIST_STATUSES } from '@lc/core';

import { wantIn, wantSentence } from '../src/lib/wants.js';

describe('wantIn', () => {
  it('says nothing about a shelf with no wish on it', () => {
    assert.equal(wantIn([]), null);
    assert.equal(wantIn([{ status: 'owned' }, { status: 'lent' }, { status: 'sold' }]), null);
  });

  it('finds a plain want', () => {
    assert.deepEqual(wantIn([{ status: 'owned' }, { status: 'wanted' }]), { status: 'wanted' });
  });

  it('counts a pre-order as a want, because it is one that is paid for', () => {
    assert.deepEqual(wantIn([{ status: 'preordered' }]), { status: 'preordered' });
  });

  it('covers every wishlist status @lc/core names, with nothing hand-written', () => {
    // ⚠️ Reads the shared list rather than restating it: a third wishlist
    // status added to core must not silently stop blocking a duplicate here.
    for (const status of WISHLIST_STATUSES) {
      assert.deepEqual(wantIn([{ status }]), { status }, `${status} should count as a want`);
    }
  });

  it('does not treat a borrowed book as a wish', () => {
    // `borrowed` describes a book already in this house's orbit — see the
    // WISHLIST_STATUSES comment in @lc/core.
    assert.equal(wantIn([{ status: 'borrowed' }]), null);
  });
});

describe('wantSentence', () => {
  const want = { workId: 1, title: 'A Book', status: 'wanted' };

  it('says wishlist for a want', () => {
    assert.equal(wantSentence(want), 'Already on your wishlist.');
  });

  it('says BOUGHT for a pre-order, never "on your wishlist"', () => {
    const said = wantSentence({ ...want, status: 'preordered' });
    assert.match(said, /pre-ordered/i);
    assert.doesNotMatch(said, /wishlist/i);
  });
});
