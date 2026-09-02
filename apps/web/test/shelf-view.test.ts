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
 *
 * ## What a row SAYS — the 2026-09-02 amendment
 *
 * > Owner: "actually none of the edition stuff shows in the page anymore. i see
 * > we have it on the shelf but not what each edition is. lets have the editions
 * > listed in the on your shelf version with ebook and audio but instead of
 * > paperback replace that with the edition info and if its signed or not"
 *
 * `label` / `meta` / `signed` are now derived here too, so the words on the card
 * are pinned by a test rather than assembled in a component no test can mount.
 * The three cases the ask turns on each get their own test below:
 *
 *   1. **linked** — the copy's own `edition_id` names the printing.
 *   2. **sole-printing** — unlinked, but the work has exactly ONE printing of
 *      that format, so the attribution is unambiguous.
 *   3. **unresolvable** — no link and several candidates (or none): the format
 *      word stands alone. ⚠️ Never a borrowed name; see the work-220 test.
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

describe('the row LEADS with the edition, and never with a guess (owner 2026-09-02)', () => {
  it('LINKED: the copy names its printing → the edition_name is the headline, the binding drops to meta', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10 })],
      editions: [
        edition({
          id: 10,
          format: 'hardcover',
          edition_name: 'BN Exclusive',
          publisher: 'Tor Books',
          published_year: 2010,
          collects: 'Volumes 1-3',
        }),
      ],
    });
    const row = only(v);
    assert.equal(row.label, 'BN Exclusive');
    assert.equal(row.labelSource, 'edition-name');
    assert.equal(row.resolvedBy, 'linked');
    // The binding is still SAID — it just stopped being the headline.
    assert.equal(row.meta, 'Hardcover · Tor Books · 2010 · contains Volumes 1-3');
    // `format` remains the format: the emoji and the row rank key off it.
    assert.equal(row.format, 'Hardcover');
  });

  it("an unnamed printing falls to its KIND — and the kind is not then repeated as a pill", () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover', edition_kind: 'collectors' })],
    });
    const row = only(v);
    assert.equal(row.labelSource, 'edition-kind');
    assert.equal(row.label, "Collector's edition");
    // `kind` still travels — the component drops the pill by reading labelSource.
    assert.equal(row.kind, 'collectors');
  });

  it('⚠️ WORK 493, the whole point of the ask: sole printing, no name → the IMPRINT leads, not "Paperback"', () => {
    // Measured in production 2026-09-02: work 493 holds one owned unlinked copy
    // and one paperback printing — TokyoPop, 2006, edition_name NULL. Before this
    // change the card read "Paperback" and said nothing else at all, because the
    // meta line only ever rendered edition_name (NULL on 437 of 566 printings).
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 423, status: 'owned', edition_id: null })],
      editions: [
        edition({ id: 639, format: 'paperback', publisher: 'TokyoPop', published_year: 2006 }),
      ],
    });
    const row = only(v);
    assert.equal(row.label, 'TokyoPop · 2006');
    assert.equal(row.labelSource, 'imprint');
    assert.equal(row.resolvedBy, 'sole-printing');
    assert.equal(row.meta, 'Paperback', 'the binding survives as secondary info');
    assert.equal(row.owned, true, 'the 2026-08-24 invariant holds: never Wanted');
  });

  it('⚠️ WORK 220 — TWO printings of one format, copies unlinked → NO borrowed identity, the format word stands', () => {
    // The fabrication this guards. Work 220 holds two owned unlinked hardcover
    // copies against two hardcover printings: "Signed Leatherbound …" and a
    // slipcase-set volume. The old claim-the-first-match handed BOTH copies the
    // leatherbound's name — wrong for the slipcase copy, and a claim the record
    // never made. Ambiguity must render as an absence.
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 169, status: 'owned', edition_id: null, is_signed: 1, leatherbound: 1 }),
        copy({ id: 382, status: 'owned', edition_id: null, slipcase: 1 }),
      ],
      editions: [
        edition({
          id: 321,
          format: 'hardcover',
          edition_name: 'Signed Leatherbound (two-volume set)',
          edition_kind: 'collectors',
          publisher: 'Dragonsteel Books',
        }),
        edition({
          id: 586,
          format: 'hardcover',
          edition_name: 'Volume of the slipcase set',
          publisher: 'Tor Books',
          published_year: 2022,
        }),
      ],
    });
    const row = only(v);
    assert.equal(row.label, 'Hardcover', 'the format word, never a borrowed name');
    assert.equal(row.labelSource, 'format');
    assert.equal(row.resolvedBy, null);
    assert.equal(row.meta, null, 'no imprint, no name — nothing resolved to say it about');
    assert.equal(row.editionName, null);
    // ⚠️ And no badge leaks in from the un-attributable printing's prose either.
    assert.deepEqual(row.badges.map((b) => b.key).sort(), ['leather', 'signed', 'slipcase']);
    // The per-copy answer is the only honest one here, and it is intact.
    assert.equal(row.copies[0]!.signed, true);
    assert.equal(row.copies[1]!.signed, false);
  });

  it('a copy with NO editions at all keeps the format word and says nothing more', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ leatherbound: 1 })] });
    const row = only(v);
    assert.equal(row.label, 'Hardcover');
    assert.equal(row.labelSource, 'format');
    assert.equal(row.resolvedBy, null);
    assert.equal(row.meta, null);
  });

  it('⚠️ an edition that names itself in NO way at all → the format word, not an empty headline', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10 })],
      editions: [edition({ id: 10, format: 'paperback' })], // no name, kind, publisher or year
    });
    const row = only(v);
    assert.equal(row.label, 'Paperback');
    assert.equal(row.labelSource, 'format');
    // It DID resolve — we simply have nothing to call it.
    assert.equal(row.resolvedBy, 'linked');
    assert.equal(row.meta, null);
  });

  it('an imprint of ONLY a publisher, or ONLY a year, still leads', () => {
    const pub = only(
      deriveShelfView({
        ...NONE,
        copies: [copy({ edition_id: 10 })],
        editions: [edition({ id: 10, format: 'paperback', publisher: 'Tor Books' })],
      }),
    );
    assert.equal(pub.label, 'Tor Books');
    const yr = only(
      deriveShelfView({
        ...NONE,
        copies: [copy({ edition_id: 10 })],
        editions: [edition({ id: 10, format: 'paperback', published_year: 1998 })],
      }),
    );
    assert.equal(yr.label, '1998');
  });

  it('⚠️ EBOOK and AUDIO rows are UNCHANGED — the ask was about the physical rows', () => {
    const v = deriveShelfView({
      ...NONE,
      editions: [edition({ id: 78, format: 'ebook_epub', edition_name: 'Kindle', collects: 'Vol 1-2' })],
      audiobookHolding: { title: 'X', staleAt: null } as never,
      audioEditionCount: 1,
    });
    const ebook = v.rows.find((r) => r.medium === 'ebook')!;
    assert.equal(ebook.label, 'EPUB', 'the file row still leads with its format');
    assert.equal(ebook.meta, 'Kindle · contains Vol 1-2', 'exactly what the component used to compose');
    assert.equal(ebook.signed, null, 'a file cannot be signed');
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    assert.equal(audio.label, 'Audiobook');
    assert.equal(audio.signed, null);
  });

  it('⚠️ a WANTED row is unchanged, and is never asked whether it is signed', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ status: 'wanted', edition_id: 77 })],
      editions: [edition({ id: 77, format: 'paperback', edition_name: 'Deluxe' })],
    });
    const row = only(v);
    assert.equal(row.owned, false);
    assert.equal(row.signed, null, 'a wish has no object to have been signed');
    assert.equal(row.label, 'Deluxe');
  });

  it('the neutral slot answers nothing — no label, no meta, no signed claim', () => {
    const row = only(deriveShelfView({ ...NONE }));
    assert.equal(row.neutral, true);
    assert.equal(row.label, null);
    assert.equal(row.meta, null);
    assert.equal(row.signed, null);
  });
});

describe('signed is answered EITHER WAY on what you hold (owner: "and if its signed or not")', () => {
  it('an owned physical row with an unsigned copy says FALSE, not null — the negative is an answer', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ status: 'owned' })] });
    const row = only(v);
    assert.equal(row.signed, false, 'a badge that only ever lights cannot answer "or not"');
    assert.equal(row.copies[0]!.signed, false);
  });

  it('a signed copy says TRUE at both levels', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy({ is_signed: 1 })] });
    const row = only(v);
    assert.equal(row.signed, true);
    assert.equal(row.copies[0]!.signed, true);
  });

  it('the ROW is signed when ANY of its copies is, and the copies still disagree individually', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, is_signed: 0 }), copy({ id: 2, is_signed: 1 })],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.signed, true);
    assert.deepEqual(row.copies.map((c) => c.signed).sort(), [false, true]);
  });

  it('⚠️ signing takes NO prose fallback — a shop calling the printing "Signed" is not a signature on YOUR copy', () => {
    // The other three attributes still read the prose (0430 back-compat); signing
    // deliberately does not, so `signed:false` cannot be flipped by a blurb.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover', edition_name: 'Signed Leatherbound' })],
    });
    const row = only(v);
    assert.equal(row.signed, false);
    assert.ok(row.badges.some((b) => b.key === 'leather'), 'leather DOES read the prose');
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

  it('a stale audiobook holding is NOT an Owned row; a live one is', () => {
    // The sibling catalog no longer confirms the match — a top-line "Owned on
    // audio" glance would be a dead claim. The OtherVersions drawer still shows
    // it with a "may be out of date" note; the shelf glance must not.
    const stale = deriveShelfView({ ...NONE, audiobookHolding: { title: 'X', staleAt: '2026-01-01' } as never });
    assert.equal(stale.rows.some((r) => r.medium === 'audio'), false);
    assert.equal(stale.rows[0]!.neutral, true);
    const live = deriveShelfView({ ...NONE, audiobookHolding: { title: 'X', staleAt: null } as never });
    assert.equal(live.rows.some((r) => r.medium === 'audio' && r.owned), true);
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
