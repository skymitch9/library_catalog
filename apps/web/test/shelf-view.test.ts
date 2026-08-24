/**
 * Pins `deriveShelfView` — the "On your shelf" hero + availability derivation
 * the redesign hoists to the top of the work page. The `other-versions.test.ts`
 * pattern: a pure function, no DOM, real-shaped inputs.
 *
 * ⚠️ The cases that earn this file: a book with NO copies (the common ebook-file
 * case, hero inferred from an edition), the special-edition badges read out of
 * edition prose, and the availability counts coming from the SERVER count rather
 * than `editions.length`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CopyView } from '../src/components/Copies.ts';
import type { EditionView } from '../src/components/Editions.ts';
import { deriveShelfView, specialEditionBadges } from '../src/lib/shelf-view.ts';

function copy(over: Partial<CopyView> = {}): CopyView {
  return {
    id: 1,
    status: 'owned',
    location: null,
    condition: null,
    lent_to: null,
    person_user_id: null,
    person_name: null,
    is_signed: 0,
    edition_id: null,
    notes: null,
    acquired_on: null,
    ...over,
  } as CopyView;
}

function edition(over: Partial<EditionView> = {}): EditionView {
  return {
    id: 10,
    format: 'hardcover',
    edition_name: null,
    edition_kind: null,
    collects: null,
    isbn13: null,
    isbn10: null,
    asin: null,
    publisher: null,
    published_year: null,
    pages: null,
    source: 'manual',
    source_url: null,
    ...over,
  } as EditionView;
}

const NONE = {
  copies: [],
  editions: [],
  audiobookHolding: null,
  audioEditions: [],
  audioEditionCount: undefined,
  ebookHolding: null,
  peerHoldings: [],
};

describe('deriveShelfView — the hero', () => {
  it('an owned copy linked to a hardcover leads with Hardcover', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10, location: 'Shelf 3' })],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    assert.equal(v.hero?.format, 'Hardcover');
    assert.equal(v.hero?.medium, 'physical');
    assert.equal(v.hero?.status, 'owned');
    assert.equal(v.hero?.location, 'Shelf 3');
  });

  it('prefers the OWNED copy over a lent one for the hero', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'lent', edition_id: 10 }), copy({ id: 2, status: 'owned', edition_id: 10 })],
      editions: [edition({ id: 10, format: 'paperback' })],
    });
    assert.equal(v.hero?.status, 'owned');
    assert.equal(v.hero?.otherHeldCount, 1);
  });

  it('no copy at all — the hero is inferred from an edition, physical first', () => {
    const v = deriveShelfView({
      ...NONE,
      editions: [edition({ id: 1, format: 'ebook_epub' }), edition({ id: 2, format: 'hardcover' })],
    });
    assert.equal(v.hero?.status, null);
    assert.equal(v.hero?.format, 'Hardcover');
    assert.equal(v.hero?.medium, 'physical');
  });

  it('a wanted-only book (no held copy, no edition) has no hero', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ status: 'wanted' })] });
    assert.equal(v.hero, null);
    assert.equal(v.hasAnything, false);
  });

  it('owns it only on audio — the hero says Audiobook', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X' } as never,
      audioEditionCount: 1,
    });
    assert.equal(v.hero?.format, 'Audiobook');
    assert.equal(v.hero?.medium, 'audio');
  });
});

describe('specialEditionBadges — read out of existing data', () => {
  it('signed comes from the copy boolean', () => {
    const b = specialEditionBadges(copy({ is_signed: 1 }), null);
    assert.deepEqual(b.map((x) => x.key), ['signed']);
  });

  it('sprayed / leather / slipcase come from the edition prose', () => {
    const b = specialEditionBadges(
      copy({ is_signed: 1 }),
      edition({ edition_name: 'Deluxe — Signed, Leatherbound, Sprayed edges, Slipcased' }),
    );
    assert.deepEqual(b.map((x) => x.key).sort(), ['leather', 'signed', 'slipcase', 'sprayed']);
  });

  it('an ordinary printing lights no badge', () => {
    assert.deepEqual(specialEditionBadges(copy(), edition({ edition_name: 'Tor 2010' })), []);
  });
});

describe('deriveShelfView — availability', () => {
  it('audio count comes from the server field, not editions.length', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X' } as never,
      audioEditions: [{ staleAt: null } as never, { staleAt: null } as never],
      audioEditionCount: 2,
    });
    assert.deepEqual(v.availability.audio, { count: 2 });
  });

  it('a stale ebook holding is not "available"; a live one is', () => {
    assert.equal(deriveShelfView({ ...NONE, ebookHolding: { staleAt: '2026-01-01' } as never }).availability.ebook, false);
    assert.equal(deriveShelfView({ ...NONE, ebookHolding: { staleAt: null } as never }).availability.ebook, true);
  });

  it('peers pass through', () => {
    const peers = [{ peerId: 'padhard', peerLabel: 'Padhard', detailUrl: null, formats: 'hardcover' }];
    const v = deriveShelfView({ ...NONE, peerHoldings: peers });
    assert.equal(v.availability.peers.length, 1);
    assert.equal(v.hasAnything, true);
  });
});
