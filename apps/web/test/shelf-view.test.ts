/**
 * Pins `deriveShelfView` — the "On your shelf" EDITION LIST + availability
 * derivation the redesign hoists to the top of the work page. The
 * `other-versions.test.ts` pattern: a pure function, no DOM, real-shaped inputs.
 *
 * ## The owner model this pins (2026-08-24)
 *
 * ⚠️ Editions are the shelf, and the list is **never empty**. Each edition is a
 * row marked **Owned** (a held copy, or a file you hold) or **Wanted** (it
 * exists, no copy). Copies nest under the edition they are a copy of. A book with
 * nothing gets one Wanted row; a book owned only on audio gets one Owned
 * Audiobook row.
 *
 * ⚠️ The cases that earn this file: a book with NO copies (physical edition →
 * Wanted, file edition → Owned), copies nesting under an edition, the never-empty
 * fallback, the special-edition badges, and the availability counts coming from
 * the SERVER count rather than `editions.length`.
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
    sprayed_edges: 0,
    leatherbound: 0,
    slipcase: 0,
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

/** The single row we expect, asserted with a helpful message when the count is off. */
function only(v: { rows: unknown[] }): (typeof v.rows)[number] {
  assert.equal(v.rows.length, 1, `expected exactly one shelf row, got ${v.rows.length}`);
  return v.rows[0]!;
}

describe('deriveShelfView — editions are the shelf', () => {
  it('an owned copy linked to a hardcover → one Owned Hardcover row, copy nested', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10, location: 'Shelf 3' })],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    const row = only(v);
    assert.equal(row.format, 'Hardcover');
    assert.equal(row.medium, 'physical');
    assert.equal(row.owned, true);
    assert.equal(row.copies.length, 1);
    assert.equal(row.copies[0]!.status, 'owned');
    assert.equal(row.copies[0]!.location, 'Shelf 3');
  });

  it('prefers the OWNED copy first among the nested copies of a printing', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'lent', edition_id: 10 }), copy({ id: 2, status: 'owned', edition_id: 10 })],
      editions: [edition({ id: 10, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.owned, true);
    assert.equal(row.copies.length, 2);
    assert.equal(row.copies[0]!.status, 'owned');
  });

  it('no copy: a physical edition is Wanted, a file edition is Owned; owned sorts first', () => {
    const v = deriveShelfView({
      ...NONE,
      editions: [edition({ id: 1, format: 'ebook_epub' }), edition({ id: 2, format: 'hardcover' })],
    });
    assert.equal(v.rows.length, 2);
    const ebook = v.rows.find((r) => r.format === 'EPUB')!;
    const hardcover = v.rows.find((r) => r.format === 'Hardcover')!;
    assert.equal(ebook.owned, true, 'a file you hold is Owned');
    assert.equal(hardcover.owned, false, 'a physical printing with no copy is Wanted');
    // Owned (the ebook) leads the wanted physical row.
    assert.equal(v.rows[0]!.owned, true);
  });

  it('⚠️ NEVER empty: a wanted-only book (no edition, no held copy) still shows one Wanted row', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ status: 'wanted' })] });
    const row = only(v);
    assert.equal(row.owned, false);
    assert.equal(row.format, null);
    assert.equal(row.copies.length, 0);
  });

  it('⚠️ NEVER empty: a book with nothing at all still shows one Wanted row', () => {
    const row = only(deriveShelfView({ ...NONE }));
    assert.equal(row.owned, false);
  });

  it('owns it only on audio → one Owned Audiobook row', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X' } as never,
      audioEditionCount: 1,
    });
    const row = only(v);
    assert.equal(row.format, 'Audiobook');
    assert.equal(row.medium, 'audio');
    assert.equal(row.owned, true);
  });

  it('a held copy with NO edition linked → one Owned row, the copy nested', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ edition_id: null, location: 'Box 2' })] });
    const row = only(v);
    assert.equal(row.owned, true);
    assert.equal(row.copies.length, 1);
    assert.equal(row.copies[0]!.location, 'Box 2');
  });
});

describe('specialEditionBadges — first-class columns, prose as fallback', () => {
  it('signed comes from the copy boolean', () => {
    const b = specialEditionBadges(copy({ is_signed: 1 }), null);
    assert.deepEqual(b.map((x) => x.key), ['signed']);
  });

  it('⚠️ all four now come from the copy COLUMNS — no edition prose needed (0430)', () => {
    const b = specialEditionBadges(
      copy({ is_signed: 1, sprayed_edges: 1, leatherbound: 1, slipcase: 1 }),
      null,
    );
    assert.deepEqual(b.map((x) => x.key).sort(), ['leather', 'signed', 'slipcase', 'sprayed']);
  });

  it('⚠️ edition prose still lights the badges on an un-swept row (back-compat)', () => {
    const b = specialEditionBadges(
      copy({ is_signed: 1 }),
      edition({ edition_name: 'Deluxe — Signed, Leatherbound, Sprayed edges, Slipcased' }),
    );
    assert.deepEqual(b.map((x) => x.key).sort(), ['leather', 'signed', 'slipcase', 'sprayed']);
  });

  it('a column and the prose agreeing lights each badge ONCE, not twice', () => {
    const b = specialEditionBadges(
      copy({ leatherbound: 1 }),
      edition({ edition_name: 'Signed Leatherbound' }),
    );
    assert.deepEqual(b.map((x) => x.key), ['leather']);
  });

  it('an ordinary printing lights no badge', () => {
    assert.deepEqual(specialEditionBadges(copy(), edition({ edition_name: 'Tor 2010' })), []);
  });
});

describe('deriveShelfView — leather ⊂ hardcover in a row', () => {
  it('a leatherbound copy with NO edition still leads with Hardcover', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ leatherbound: 1 })] });
    const row = only(v);
    assert.equal(row.format, 'Hardcover');
    assert.equal(row.medium, 'physical');
    assert.ok(row.badges.some((b) => b.key === 'leather'));
  });

  it('a linked edition still names the format — leather does not override it', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ leatherbound: 1, edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    assert.equal(only(v).format, 'Hardcover');
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
    // The shelf is never empty even when only a peer holds it: one Wanted row.
    assert.equal(v.rows.length, 1);
    assert.equal(v.rows[0]!.owned, false);
  });
});
