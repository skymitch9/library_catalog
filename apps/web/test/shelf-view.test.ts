/**
 * Pins `deriveShelfView` — the COPY-DRIVEN "On your shelf" derivation. The
 * `other-versions.test.ts` pattern: a pure function, no DOM, real-shaped inputs.
 *
 * ## The owner model this pins (2026-08-24, corrected): the shelf is WHAT YOU HAVE
 *
 * ⚠️ **The shelf is built from your COPIES, not from copy→edition links.**
 * `copy.edition_id` is null across essentially the whole catalog, so the old
 * link-driven code showed an owned book as **Wanted** (work 493). The rows now
 * come from what you HOLD: owned copies grouped by their effective format, plus
 * the ebook/audiobook you hold; Wanted rows are for wishlist copies ONLY; and a
 * book with genuinely nothing gets a neutral "not on your shelf" slot — never a
 * fabricated Wanted.
 *
 * ⚠️ **The 493 case is pinned explicitly**: an owned copy with `edition_id:null`
 * plus an unlinked paperback edition → ONE "Owned" Paperback row, zero Wanted.
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

describe('deriveShelfView — copy-driven: the shelf is what you have', () => {
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
    assert.equal(row.neutral, false);
    assert.equal(row.copies.length, 1);
    assert.equal(row.copies[0]!.status, 'owned');
    assert.equal(row.copies[0]!.location, 'Shelf 3');
  });

  it('⚠️ WORK 493: an OWNED copy with edition_id:null + an unlinked paperback edition → ONE Owned Paperback row, ZERO Wanted', () => {
    const v = deriveShelfView({
      ...NONE,
      // The copy is owned but never linked to its printing (no barcode). The
      // paperback edition sits unlinked. The OLD code showed the edition as
      // Wanted and the copy floated off; the fix ties them by format.
      copies: [copy({ id: 1, status: 'owned', edition_id: null, location: 'Manga shelf' })],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.format, 'Paperback');
    assert.equal(row.owned, true, 'the owned book must read Owned, never Wanted');
    assert.equal(row.medium, 'physical');
    assert.equal(row.copies.length, 1);
    assert.equal(row.copies[0]!.location, 'Manga shelf');
    // ⚠️ The whole bug: not a single Wanted row anywhere.
    assert.equal(v.rows.filter((r) => !r.owned && !r.neutral).length, 0, 'zero Wanted rows');
  });

  it('two owned copies of the same (sole) format → ONE row, two nested instances', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: null, condition: 'fine' }),
        copy({ id: 2, status: 'owned', edition_id: null, condition: 'good' }),
      ],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.format, 'Paperback');
    assert.equal(row.owned, true);
    assert.equal(row.copies.length, 2, 'both copies nest as instances under the one format row');
  });

  it('owned physical + a held ebook (shared pool) → TWO Owned rows', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: null })],
      editions: [edition({ id: 77, format: 'paperback' })],
      ebookHolding: { staleAt: null } as never,
    });
    assert.equal(v.rows.length, 2);
    const paper = v.rows.find((r) => r.format === 'Paperback')!;
    const ebook = v.rows.find((r) => r.medium === 'ebook')!;
    assert.equal(paper.owned, true);
    assert.equal(ebook.owned, true);
    // Physical leads the file.
    assert.equal(v.rows[0]!.medium, 'physical');
  });

  it('owned physical + an ebook EDITION (file) → TWO Owned rows', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: null })],
      editions: [
        edition({ id: 77, format: 'paperback' }),
        edition({ id: 78, format: 'ebook_epub' }),
      ],
    });
    assert.equal(v.rows.length, 2);
    assert.ok(v.rows.find((r) => r.format === 'Paperback')?.owned);
    assert.ok(v.rows.find((r) => r.format === 'EPUB')?.owned);
  });

  it('a genuine wishlist copy → ONE Wanted row, nothing owned', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ status: 'wanted' })] });
    const row = only(v);
    assert.equal(row.owned, false);
    assert.equal(row.neutral, false);
    assert.equal(row.copies.length, 1, 'the wish nests so a count is visible');
  });

  it('a wishlist copy that wants a specific paperback printing → ONE Wanted Paperback row', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ status: 'wanted', edition_id: 77 })],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.format, 'Paperback');
    assert.equal(row.owned, false);
  });

  it('prefers the OWNED copy first among the nested copies of a printing', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'lent', edition_id: 10 }),
        copy({ id: 2, status: 'owned', edition_id: 10 }),
      ],
      editions: [edition({ id: 10, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.owned, true);
    assert.equal(row.copies.length, 2);
    assert.equal(row.copies[0]!.status, 'owned');
  });

  it('an ebook edition with no copy → Owned (a file you hold)', () => {
    const v = deriveShelfView({ ...NONE, editions: [edition({ id: 1, format: 'ebook_epub' })] });
    const row = only(v);
    assert.equal(row.format, 'EPUB');
    assert.equal(row.owned, true);
  });

  it('⚠️ a physical edition you neither own nor want is NOT a row → neutral slot', () => {
    const v = deriveShelfView({ ...NONE, editions: [edition({ id: 2, format: 'hardcover' })] });
    const row = only(v);
    assert.equal(row.neutral, true, 'not fabricated as Wanted');
    assert.equal(row.owned, false);
  });

  it('an owned file + an un-owned physical printing → only the file shows, no phantom Wanted', () => {
    const v = deriveShelfView({
      ...NONE,
      editions: [edition({ id: 1, format: 'ebook_epub' }), edition({ id: 2, format: 'hardcover' })],
    });
    const row = only(v);
    assert.equal(row.format, 'EPUB');
    assert.equal(row.owned, true);
  });

  it('⚠️ NEVER empty, and NEVER a fabricated Want: nothing at all → one neutral slot', () => {
    const row = only(deriveShelfView({ ...NONE }));
    assert.equal(row.neutral, true);
    assert.equal(row.owned, false);
    assert.equal(row.format, null);
  });

  it('owns it only on audio → one Owned Audiobook row, recording count on the row', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X' } as never,
      audioEditionCount: 2,
    });
    const row = only(v);
    assert.equal(row.format, 'Audiobook');
    assert.equal(row.medium, 'audio');
    assert.equal(row.owned, true);
    assert.equal(row.count, 2);
  });

  it('a held copy with NO edition and NO editions at all → one Owned row, copy nested', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ edition_id: null, location: 'Box 2' })] });
    const row = only(v);
    assert.equal(row.owned, true);
    assert.equal(row.medium, 'physical');
    assert.equal(row.copies.length, 1);
    assert.equal(row.copies[0]!.location, 'Box 2');
  });

  it('two owned copies of two DIFFERENT linked printings → two rows, one each', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10 }),
        copy({ id: 2, status: 'owned', edition_id: 11 }),
      ],
      editions: [
        edition({ id: 10, format: 'hardcover', edition_name: 'Deluxe' }),
        edition({ id: 11, format: 'hardcover', edition_name: 'BN Exclusive' }),
      ],
    });
    assert.equal(v.rows.length, 2);
    assert.ok(v.rows.every((r) => r.owned && r.copies.length === 1));
    assert.deepEqual(v.rows.map((r) => r.editionName).sort(), ['BN Exclusive', 'Deluxe']);
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

  it('a leatherbound owned copy amid a sole PAPERBACK edition still reads Hardcover (leather wins)', () => {
    // The copy is leatherbound, so it is a hardcover regardless of the lone
    // paperback edition — leather is checked before the sole-physical fallback.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ leatherbound: 1, edition_id: null })],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    const hardcover = v.rows.find((r) => r.format === 'Hardcover');
    assert.ok(hardcover, 'a leatherbound copy makes a Hardcover Owned row');
    assert.equal(hardcover!.owned, true);
  });
});

describe('deriveShelfView — availability (peers only) and audio count', () => {
  it('audio count comes from the server field, not editions.length', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X' } as never,
      audioEditions: [{ staleAt: null } as never, { staleAt: null } as never],
      audioEditionCount: 2,
    });
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    assert.equal(audio.count, 2);
  });

  it('a stale ebook holding is NOT an Owned row; a live one is', () => {
    const stale = deriveShelfView({ ...NONE, ebookHolding: { staleAt: '2026-01-01' } as never });
    assert.equal(stale.rows.some((r) => r.medium === 'ebook'), false);
    assert.equal(stale.rows[0]!.neutral, true);
    const live = deriveShelfView({ ...NONE, ebookHolding: { staleAt: null } as never });
    assert.equal(live.rows.some((r) => r.medium === 'ebook' && r.owned), true);
  });

  it('peers pass through as availability, not as shelf rows', () => {
    const peers = [
      { peerId: 'padhard', peerLabel: 'Padhard', detailUrl: null, formats: 'hardcover' },
    ];
    const v = deriveShelfView({ ...NONE, peerHoldings: peers });
    assert.equal(v.availability.peers.length, 1);
    // A peer holding it does not put anything on YOUR shelf → neutral slot.
    assert.equal(v.rows.length, 1);
    assert.equal(v.rows[0]!.neutral, true);
  });
});
