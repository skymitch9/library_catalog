/**
 * Pins `deriveShelfView` — the COPY-DRIVEN "On your shelf" derivation. The
 * house pattern: a pure function, no DOM, real-shaped inputs.
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
 *
 * ## A fact is printed ONCE — the 2026-09-03 amendment
 *
 * > Owner, of a three-copy card that printed *Not signed* four times: "This has
 * > double information, let's normalize this."
 *
 * `ShelfRow.badges` / `ShelfRow.signed` are what the CARD prints and
 * `ShelfCopy.badges` is what that COPY prints — two disjoint lists, decided
 * here, not filtered in the component. ⚠️ **Two tests below were AMENDED rather
 * than added**, because they pinned the behaviour the owner called double
 * information: the row-is-signed-if-ANY test, and work 220's union of badges.
 * Both are marked, and both say what they used to claim.
 *
 * ## FORMAT TABS, and a copy is ONE LINE — the 2026-09-03 round-2 amendment
 *
 * > Owner, looking at round 1 live: "Better but still duplicate, the hard cover
 * > section has info and the stuff underneath has information" — then the shape:
 * > "I want to see hardcover paperback cover audio ebook as the tabs and the
 * > editions owned of each under … So hardcover / Collectors edition - sprayed
 * > edges signed / Standard edition / Standard edition - signed - lent out"
 *
 * `ShelfView.sections` (the Physical / Ebook / Audio headings of 2026-09-02) was
 * **REMOVED** and `tabs` + `looseRows` took its place; the tests that pinned it
 * are amended in place and marked. The new pins are the two blocks at the foot:
 * which tabs exist and in what order, and — the deliverable — **what each LINE
 * says**, including his three-hardcover example word for word.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CopyView } from '../src/components/Copies.ts';
import type { EditionView } from '../src/components/Editions.ts';
import {
  audioCountLine,
  deriveShelfView,
  matchProvenance,
  specialEditionBadges,
} from '../src/lib/shelf-view.ts';
import { audiobookDetailUrl, resolveAudiobookCover } from '../src/lib/audiobook-site.ts';

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

  it('⚠️ AMENDED 2026-09-02: a physical edition you neither own nor want is an AVAILABLE row, never a Wanted one', () => {
    // > Owner: "on your shelf should be the main with other editions available
    // > under their given section."
    //
    // The 2026-08-24 rule was "an edition you neither own nor want is not a row
    // at all", and it existed to stop such a printing being fabricated into a
    // **Wanted**. That half is untouched and pinned below; what changed is that
    // the printing is now SHOWN, in a third state.
    const v = deriveShelfView({ ...NONE, editions: [edition({ id: 2, format: 'hardcover' })] });
    const row = only(v);
    assert.equal(row.state, 'available');
    assert.equal(row.owned, false, 'it is not claimed as a holding');
    assert.equal(row.neutral, false, 'and it is not the placeholder either');
    assert.notEqual(row.state, 'wanted', '⚠️ the 2026-08-24 anti-fabrication rule holds');
    assert.equal(row.stateLabel, 'Available');
    assert.equal(row.copies.length, 0);
    // ⚠️ Signing is a fact about an OBJECT and there is no object here.
    assert.equal(row.signed, null);
    assert.equal(row.format, 'Hardcover');
  });

  it('⚠️ "Available" is only claimed when nothing of yours could BE it — otherwise "May be yours"', () => {
    // An unlinked owned copy of this format could be a copy of this very
    // printing (`copy.edition_id` is null across nearly the whole catalog), so
    // asserting you do NOT own it would be the work-220 fabrication pointing the
    // other way. Two hardcover printings, two unlinked owned copies: both rows
    // soften, and neither claims anything.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned' }), copy({ id: 2, status: 'owned' })],
      editions: [
        edition({ id: 10, format: 'hardcover', edition_name: 'Signed Leatherbound' }),
        edition({ id: 11, format: 'hardcover', edition_name: 'Slipcase volume' }),
      ],
    });
    const available = v.rows.filter((r) => r.state === 'available');
    assert.equal(available.length, 2, 'both printings show — this is the "2 under physical" ask');
    assert.ok(available.every((r) => r.stateLabel === 'May be yours'));
    assert.ok(available.every((r) => r.stateTitle.includes('Editions & copies')));
  });

  it('an owned file + an un-owned physical printing → the file is Owned and the printing is Available', () => {
    const v = deriveShelfView({
      ...NONE,
      editions: [edition({ id: 1, format: 'ebook_epub' }), edition({ id: 2, format: 'hardcover' })],
    });
    assert.equal(v.rows.length, 2);
    const file = v.rows.find((r) => r.format === 'EPUB')!;
    const print = v.rows.find((r) => r.format === 'Hardcover')!;
    assert.equal(file.owned, true, 'an ebook edition is bytes you hold — step 2, unchanged');
    assert.equal(print.state, 'available');
    // ⚠️ Nothing you hold is physical, so "Available" is safe to claim outright.
    assert.equal(print.stateLabel, 'Available');
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
    // ⚠️ Since 2026-09-02 the two printings ALSO render, as their own rows —
    // that is the owner's "if its a second physical there should be 2 under
    // physical". The HOLDING row is still exactly what it was.
    const row = v.rows.find((r) => r.owned)!;
    assert.equal(row.label, 'Hardcover', 'the format word, never a borrowed name');
    assert.equal(row.labelSource, 'format');
    assert.equal(row.resolvedBy, null);
    assert.equal(row.meta, null, 'no imprint, no name — nothing resolved to say it about');
    assert.equal(row.editionName, null);
    // ⚠️ And no badge leaks in from the un-attributable printing's prose either.
    // ⚠️ AMENDED 2026-09-03: the card used to carry the UNION of the two copies'
    // attributes — leather, signed and slipcase — while each copy carried its
    // own underneath, so every one of the three was printed twice. The two
    // copies share NOTHING, so the card now claims nothing and each copy says
    // exactly what is true of it.
    assert.deepEqual(row.badges, [], 'nothing is true of both copies');
    assert.deepEqual(row.copies[0]!.badges.map((b) => b.key), ['leather']);
    assert.deepEqual(row.copies[1]!.badges.map((b) => b.key), ['slipcase']);
    // The per-copy answer is the only honest one here, and it is intact.
    assert.equal(row.signed, null, 'no group answer — copy 169 is signed and 382 is not');
    assert.equal(row.signedVaries, true);
    assert.equal(row.copies[0]!.signed, true);
    assert.equal(row.copies[1]!.signed, false);

    // ⚠️ Both printings survive to their own rows. The old `claimPhysicalEditionFor`
    // marked one of them "used" on its way to returning null, which was
    // invisible while unclaimed printings rendered nothing — it would have
    // swallowed exactly one of these two.
    const available = v.rows.filter((r) => r.state === 'available');
    assert.deepEqual(
      available.map((r) => r.label).sort(),
      ['Signed Leatherbound (two-volume set)', 'Volume of the slipcase set'],
    );
    // Neither claims he lacks it — he owns two unlinked hardcovers.
    assert.ok(available.every((r) => r.stateLabel === 'May be yours'));
    // And neither borrows the OWNED row's signed answer.
    assert.ok(available.every((r) => r.signed === null));
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

  it('⚠️ AMENDED 2026-09-03: copies that DISAGREE give the row NO answer — each copy answers for itself', () => {
    // This test used to assert `row.signed === true` — "at least one of these is
    // signed" — on a card whose copies then each answered again underneath.
    // Owner: "This has double information, let's normalize this." A row-level
    // claim that is false of one of its own copies is not a summary, it is a
    // fourth voice; the honest card says nothing and lets the copies speak.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, is_signed: 0 }), copy({ id: 2, is_signed: 1 })],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.signed, null, 'no single answer is true of both copies');
    assert.equal(row.signedVaries, true, 'so each copy carries its own chip');
    assert.deepEqual(row.copies.map((c) => c.signed).sort(), [false, true]);
    // ⚠️ And the badge does not sneak the same fact back onto the card.
    assert.equal(row.badges.some((b) => b.key === 'signed'), false);
    // Nor onto the signed copy's own line, where its chip is about to say it.
    assert.ok(row.copies.every((c) => !c.badges.some((b) => b.key === 'signed')));
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

/**
 * ## A fact is printed ONCE (owner, 2026-09-03)
 *
 * > "This has double information, let's normalize this."
 *
 * Said with a screenshot of a **Hardcover · OWNED** card holding three copies:
 * the card line read *"Not signed · Sprayed edges"* and the three copy lines
 * read *"On the shelf · Not signed · Sprayed edges"*, *"On the shelf · Not
 * signed"*, *"Lent out · good · Not signed"*. Four *Not signed*s and two
 * *Sprayed edges* for two facts.
 *
 * The approved rule: **on the card when every copy agrees, on the copies (and
 * only there) when they differ.** These pin it at the level that decides it —
 * `ShelfRow.badges` is what the CARD prints and `ShelfCopy.badges` is what that
 * COPY prints, so the component filters nothing and a test can pin what a row
 * says rather than what it happens to hold.
 */
describe('a fact is printed ONCE — card when the copies agree, copies when they differ', () => {
  it("⚠️ THE OWNER'S SCREENSHOT: three copies, all unsigned, one with sprayed edges", () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, sprayed_edges: 1 }),
        copy({ id: 2, status: 'owned', edition_id: 10 }),
        copy({ id: 3, status: 'lent', edition_id: 10, condition: 'good' }),
      ],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    const row = only(v);
    // The card answers signing, because all three copies say the same thing.
    assert.equal(row.signed, false, 'all three agree, so the card says it — once');
    assert.equal(row.signedVaries, false, 'and no copy repeats it');
    // ⚠️ The card claims NO badge: sprayed edges are true of one copy of three.
    assert.deepEqual(row.badges, [], 'a badge one copy carries is not a fact about the card');
    assert.deepEqual(row.copies.map((c) => c.badges.map((b) => b.key)), [
      ['sprayed'],
      [],
      [],
    ]);
    // The copies still each know their own signed answer; the component simply
    // does not ask for it while the card has answered.
    assert.deepEqual(row.copies.map((c) => c.signed), [false, false, false]);
  });

  it('two copies, one signed one not → NO card chip, and each copy carries its own', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, is_signed: 1 }),
        copy({ id: 2, status: 'owned', edition_id: 10 }),
      ],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    const row = only(v);
    assert.equal(row.signed, null, '⚠️ no honest single answer, so the card gives none');
    assert.equal(row.signedVaries, true, 'the copies are asked instead');
    assert.deepEqual(row.copies.map((c) => c.signed), [true, false]);
    // ⚠️ Not as a badge on either level — `SignedChip` is the one that speaks.
    assert.equal(row.badges.some((b) => b.key === 'signed'), false);
    assert.ok(row.copies.every((c) => c.badges.length === 0));
  });

  it('two copies that BOTH agree → the card carries both facts and the copies carry nothing', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, is_signed: 1, slipcase: 1 }),
        copy({ id: 2, status: 'owned', edition_id: 10, is_signed: 1, slipcase: 1 }),
      ],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    const row = only(v);
    assert.equal(row.signed, true, 'both are signed, so the card says so');
    assert.equal(row.signedVaries, false);
    assert.deepEqual(row.badges.map((b) => b.key), ['slipcase'], 'shared, so it lives on the card');
    // ⚠️ `signed` is NOT also a badge — `SignedChip` already said it.
    assert.equal(row.badges.some((b) => b.key === 'signed'), false);
    assert.ok(row.copies.every((c) => c.badges.length === 0), 'nothing is left for a copy to add');
  });

  it('a SINGLE copy is unchanged — the card says everything, the copy repeats none of it', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 10, is_signed: 1, sprayed_edges: 1 })],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    const row = only(v);
    assert.equal(row.signed, true, 'one copy always agrees with itself');
    assert.equal(row.signedVaries, false);
    assert.deepEqual(row.badges.map((b) => b.key), ['sprayed']);
    assert.deepEqual(row.copies[0]!.badges, [], 'the card above already said it');
    assert.equal(row.copies[0]!.signed, true, 'the record is still there to read');
  });

  it("⚠️ an EDITION's prose badge stays on the card even when the copies differ", () => {
    // The 0430 back-compat: an un-swept printing carries its attributes in the
    // shop's own words. That describes the PRINTING, so it is equally true of
    // every copy of it and there is no one copy to pin it on — this rule must
    // not lose it. The copies here disagree about everything they own.
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, sprayed_edges: 1 }),
        copy({ id: 2, status: 'owned', edition_id: 10 }),
      ],
      editions: [edition({ id: 10, format: 'hardcover', edition_name: 'Leatherbound deluxe' })],
    });
    const row = only(v);
    assert.ok(
      row.badges.some((b) => b.key === 'leather'),
      'the printing is leatherbound; both copies of it are',
    );
    assert.equal(row.badges.some((b) => b.key === 'sprayed'), false, 'one copy only');
    assert.deepEqual(row.copies.map((c) => c.badges.map((b) => b.key)), [['sprayed'], []]);
    // ⚠️ And the prose badge is not ALSO repeated on the copies.
    assert.ok(row.copies.every((c) => !c.badges.some((b) => b.key === 'leather')));
  });

  it('⚠️ a WANTED row keeps its invariant: badges split, but signing is never asked', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'wanted', edition_id: 77, sprayed_edges: 1 }),
        copy({ id: 2, status: 'wanted', edition_id: 77 }),
      ],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    const row = only(v);
    assert.equal(row.signed, null, 'a wish has no object to have been signed');
    assert.equal(row.signedVaries, false, '⚠️ and no per-copy chip appears on a wish either');
    assert.deepEqual(row.badges, []);
    assert.deepEqual(row.copies.map((c) => c.badges.map((b) => b.key)), [['sprayed'], []]);
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
    // ONE recording: the holding renders it, and the ×N rides on the row.
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X', matchedVia: 'exact', titleSimilarity: 1 } as never,
      audioEditions: [],
      audioEditionCount: 2,
    });
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    assert.equal(audio.count, 2);
  });

  it('⚠️ AMENDED 2026-09-02: TWO recordings are two rows, and the ×N comes off them', () => {
    // Before the merge the shelf showed one "Audiobook ×2" row and the retired
    // panel showed the two recordings; now the Audio section shows both rows, so
    // a count badge on each would be counting the list the reader is looking at.
    // The sentence above the section still says the number (`audioCountLine`).
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X', matchedVia: 'exact', titleSimilarity: 1 } as never,
      audioEditions: [
        { audioKey: 'a', title: 'X', matchedVia: 'exact', titleSimilarity: 1, staleAt: null } as never,
        { audioKey: 'b', title: 'X — full cast', matchedVia: 'exact', titleSimilarity: 1, staleAt: null } as never,
      ],
      audioEditionCount: 2,
    });
    const audio = v.rows.filter((r) => r.medium === 'audio');
    assert.equal(audio.length, 2);
    assert.ok(audio.every((r) => r.count === null));
    assert.equal(v.audioCountLine, 'You own 2 audiobooks of this book.');
  });

  it('a stale ebook holding is NOT an Owned row; a live one is', () => {
    const stale = deriveShelfView({ ...NONE, ebookHolding: { staleAt: '2026-01-01' } as never });
    assert.equal(stale.rows.some((r) => r.medium === 'ebook'), false);
    assert.equal(stale.rows[0]!.neutral, true);
    const live = deriveShelfView({ ...NONE, ebookHolding: { staleAt: null } as never });
    assert.equal(live.rows.some((r) => r.medium === 'ebook' && r.owned), true);
  });

  it('⚠️ AMENDED 2026-09-02: a stale audiobook holding is still NOT Owned — it is AVAILABLE, with the caveat', () => {
    // The sibling catalog no longer confirms the match, so "Owned on audio"
    // would be a dead claim — that half is unchanged and is what this test was
    // written for. What changed is the other half: the row is no longer HIDDEN,
    // because hiding it looks identical to "never matched at all" and loses the
    // fact that it WAS true once. That was the retired panel's rule, and the
    // merge had to keep it rather than pick one of the two behaviours.
    const stale = deriveShelfView({
      ...NONE,
      audiobookHolding: {
        title: 'X',
        staleAt: '2026-01-01',
        matchedVia: 'exact',
        titleSimilarity: 1,
      } as never,
    });
    const row = stale.rows.find((r) => r.medium === 'audio')!;
    assert.ok(row, 'shown, never hidden');
    assert.equal(row.owned, false, '⚠️ never claimed as a holding');
    assert.equal(row.state, 'available');
    assert.ok(
      row.notes.includes('May be out of date — the audiobook catalog no longer confirms this match.'),
      'the caveat sentence survived the merge',
    );
    // ⚠️ And it still LINKS: a withdrawn match is worth following to see what
    // the other catalog now says.
    assert.ok(row.href);

    const live = deriveShelfView({
      ...NONE,
      audiobookHolding: { title: 'X', staleAt: null, matchedVia: 'exact', titleSimilarity: 1 } as never,
    });
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

/**
 * ## The "Other versions available" merge (owner, 2026-09-02)
 *
 * > "on your shelf should be the main with other editions available under their
 * > given section. so if its a second physical there should be 2 under physical."
 *
 * The panel is gone from the work page and its contents are shelf rows. These
 * are the pins `apps/web/test/other-versions.test.ts` used to hold, moved here
 * with it — ⚠️ **that file was deleted, not left as a second home.** What they
 * guard is unchanged: a format label always present, the ONE deep-link helper,
 * the ONE cover helper, the sibling's own volume display, a stale row shown with
 * a caveat, the 1-vs-2 count line, and — the load-bearing one — the
 * **provenance sentence** migration 0010 requires be shown and never hidden.
 */
function audioHolding(over: Record<string, unknown> = {}) {
  return {
    title: 'Harry Potter and the Chamber of Secrets',
    authors: 'J.K. Rowling',
    series: 'Harry Potter',
    indexDisplay: 'Book 2',
    coverHref: 'covers/J.k. Rowling/Harry Potter and the Chamber of Secrets.jpg',
    matchedVia: 'exact',
    titleSimilarity: 1,
    staleAt: null,
    ...over,
  } as never;
}

function audioEdition(over: Record<string, unknown> = {}) {
  return {
    audioKey: 'Elantris',
    title: 'Elantris',
    authors: 'Brandon Sanderson',
    series: null,
    indexDisplay: null,
    narrator: 'James Konicek, Danny Gavigan, Lily Beacon',
    coverHref: 'covers/Brandon Sanderson/Elantris - Graphic Audio.png',
    matchedVia: 'exact',
    titleSimilarity: 1,
    staleAt: null,
    ...over,
  } as never;
}

const tenthAnniversary = audioEdition({
  audioKey: 'Elantris - Tenth Anniversary Special Edition',
  title: 'Elantris - Tenth Anniversary Special Edition',
  series: 'Elantris',
  indexDisplay: '1',
  narrator: 'Jack Garrett',
  matchedVia: 'containment',
  titleSimilarity: 0.19,
});

describe('the audiobook cross-link renders ONCE, in the Audio section (the double-paint fix)', () => {
  it('⚠️ ONE audio row, not two — it painted twice on /work/232 before this merge', () => {
    const v = deriveShelfView({
      ...NONE,
      title: 'Fae and Fare',
      audiobookHolding: audioHolding({ title: 'Fae and Fare', indexDisplay: '2' }),
      audioEditionCount: 1,
    });
    assert.equal(v.rows.filter((r) => r.medium === 'audio').length, 1);
    // ⚠️ AMENDED 2026-09-03: `sections` became `tabs`. Same claim, same objects.
    const audio = v.tabs.find((t) => t.key === 'audio')!;
    assert.equal(audio.rows.length, 1, 'the Audio tab owns it, and nothing else does');
  });

  it('⚠️ the PROVENANCE sentence survives the merge — migration 0010: shown, never hidden', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: audioHolding({ matchedVia: 'containment', titleSimilarity: 0.87 }),
    });
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    // ⚠️ REWORDED 2026-09-03 (owner ask, approved 15:03), not removed. It used
    // to end "worth a second look", which asked something of the reader and
    // offered nowhere to answer it; the doubt is the same, and the sentence now
    // names the control that settles it (migration 0450's Audio tab).
    assert.ok(
      audio.notes.includes(
        'Matched on a partial title (87% title match) — confirm it in ✎ Edit this book.',
      ),
    );
  });

  it('every provenance wording, unchanged from the retired panel', () => {
    assert.equal(
      matchProvenance({ matchedVia: 'exact', titleSimilarity: 1 }),
      'Matched by exact title (100% title match).',
    );
    assert.equal(
      matchProvenance({ matchedVia: 'alias', titleSimilarity: null }),
      'Matched by alternate title.',
    );
    assert.equal(
      matchProvenance({ matchedVia: 'series_link', titleSimilarity: null }),
      'Matched to the audiobook series you confirmed — by series and volume number.',
    );
    assert.equal(matchProvenance({ matchedVia: 'wat', titleSimilarity: null }), 'Matched via wat.');
  });

  it('the format label is ALWAYS present (owner 2026-08-14: "always say the form the media is in")', () => {
    const v = deriveShelfView({ ...NONE, audiobookHolding: audioHolding() });
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    assert.equal(audio.label, 'Audiobook');
    assert.equal(audio.format, 'Audiobook');
  });

  it('links via the ONE deep-link helper, with the SIBLING catalog own title', () => {
    const v = deriveShelfView({ ...NONE, title: 'Ours', audiobookHolding: audioHolding() });
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    assert.equal(audio.href, audiobookDetailUrl('Harry Potter and the Chamber of Secrets'));
  });

  /**
   * ⚠️ Owner, 2026-09-02: the audiobook link is a SEARCH and a series-named
   * title found 16 books. Our stored `title` has had the volume stripped off
   * it, so for such a book it IS the series name; `rawTitle` / `audioKey` is
   * that catalog's verbatim string and is what the search must carry. Absence
   * must stay indistinguishable from the old behaviour.
   */
  it('searches the VERBATIM title when the holding carries one', () => {
    const v = deriveShelfView({
      ...NONE,
      title: 'The Wandering Inn',
      audiobookHolding: audioHolding({
        title: 'The Wandering Inn',
        rawTitle: 'The Wandering Inn - The Wandering Inn, Book 1',
      }),
    });
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    assert.equal(
      audio.href,
      audiobookDetailUrl('The Wandering Inn', 'The Wandering Inn - The Wandering Inn, Book 1'),
    );
    assert.ok(String(audio.href).includes('Book+1'), 'the volume must survive into the query');
  });

  it('a series-link holding (rawTitle null) links exactly as it always did', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: audioHolding({ matchedVia: 'series_link', rawTitle: null }),
    });
    const audio = v.rows.find((r) => r.medium === 'audio')!;
    assert.equal(audio.href, audiobookDetailUrl('Harry Potter and the Chamber of Secrets'));
  });

  it('two recordings: each row searches on its OWN audioKey', () => {
    const v = deriveShelfView({
      ...NONE,
      audioEditions: [
        audioEdition({ audioKey: 'Elantris', title: 'Elantris' }),
        audioEdition({
          audioKey: 'Elantris - Tenth Anniversary Special Edition',
          title: 'Elantris',
        }),
      ],
      audiobookHolding: audioHolding({ title: 'Elantris', rawTitle: 'Elantris' }),
    });
    const rows = v.rows.filter((r) => r.medium === 'audio');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].href, audiobookDetailUrl('Elantris', 'Elantris'));
    assert.equal(
      rows[1].href,
      audiobookDetailUrl('Elantris', 'Elantris - Tenth Anniversary Special Edition'),
    );
  });

  it('resolves the cover via the ONE bucket helper, and null stays null', () => {
    const withCover = deriveShelfView({ ...NONE, audiobookHolding: audioHolding() });
    assert.equal(
      withCover.rows.find((r) => r.medium === 'audio')!.coverUrl,
      resolveAudiobookCover('covers/J.k. Rowling/Harry Potter and the Chamber of Secrets.jpg'),
    );
    const none = deriveShelfView({ ...NONE, audiobookHolding: audioHolding({ coverHref: null }) });
    assert.equal(none.rows.find((r) => r.medium === 'audio')!.coverUrl, null);
  });

  it('says the sibling title and volume — but not when it is simply this book title', () => {
    const differs = deriveShelfView({ ...NONE, title: 'Ours', audiobookHolding: audioHolding() });
    assert.equal(
      differs.rows.find((r) => r.medium === 'audio')!.meta,
      'Harry Potter and the Chamber of Secrets · (Book 2)',
    );
    const same = deriveShelfView({
      ...NONE,
      title: 'Harry Potter and the Chamber of Secrets',
      audiobookHolding: audioHolding({ indexDisplay: null }),
    });
    assert.equal(same.rows.find((r) => r.medium === 'audio')!.meta, null, 'not said twice');
  });

  it('the narrator and the series disagreement ride on the row, and only when true', () => {
    const v = deriveShelfView({
      ...NONE,
      ourSeries: 'Elantris',
      audiobookHolding: audioHolding(),
      audioEditions: [tenthAnniversary, audioEdition()],
      audioEditionCount: 2,
    });
    const rows = v.rows.filter((r) => r.medium === 'audio');
    assert.equal(rows.length, 2, 'the list takes over only when it says more — two recordings');
    const tenth = rows.find((r) => r.key.endsWith('Tenth Anniversary Special Edition'))!;
    assert.ok(tenth.notes.includes('Read by Jack Garrett'));
    // Its series matches ours, so no disagreement line.
    assert.ok(!tenth.notes.some((n) => n.startsWith('Filed there under')));
    const fullCast = rows.find((r) => r.key === 'audio:Elantris')!;
    assert.ok(fullCast.notes.some((n) => n.startsWith('Read by James Konicek')));
    // The full-cast row has NO series over there and ours is 'Elantris' — an
    // absence is not a disagreement.
    assert.ok(!fullCast.notes.some((n) => n.startsWith('Filed there under')));
  });

  it('⚠️ ONE edition changes nothing — the single HOLDING still renders it', () => {
    // The list only takes over when it says more than the holding already does,
    // so an API response predating `audioEditions` cannot blank the section.
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: audioHolding(),
      audioEditions: [audioEdition()],
      audioEditionCount: 1,
    });
    const rows = v.rows.filter((r) => r.medium === 'audio');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.key, 'own-audio');
  });

  it('⚠️ two rows and NO count line when one of them is stale', () => {
    // The pair that proves the number is not `audioEditions.length`: the list
    // shows a withdrawn match with its caveat, and the count refuses to call it
    // a book the household owns.
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: audioHolding(),
      audioEditions: [tenthAnniversary, audioEdition({ staleAt: '2026-08-23 04:00:00' })],
      audioEditionCount: 1,
    });
    assert.equal(v.rows.filter((r) => r.medium === 'audio').length, 2);
    assert.equal(v.audioCountLine, null);
  });

  it('audioCountLine — silent at 0, 1 and absent; says the number at 2 and 3', () => {
    assert.equal(audioCountLine(0), null);
    assert.equal(audioCountLine(1), null);
    assert.equal(audioCountLine(undefined), null);
    assert.equal(audioCountLine(2), 'You own 2 audiobooks of this book.');
    assert.equal(audioCountLine(3), 'You own 3 audiobooks of this book.');
  });

  it('no audiobook anywhere → no audio row and no Audio tab', () => {
    const v = deriveShelfView({ ...NONE, copies: [copy()] });
    assert.equal(
      v.rows.some((r) => r.medium === 'audio'),
      false,
    );
    // ⚠️ AMENDED 2026-09-03: `sections` became `tabs`; the claim is the same.
    assert.equal(
      v.tabs.some((t) => t.key === 'audio'),
      false,
    );
  });
});

/**
 * ## The shelf is FORMAT TABS, and a copy is ONE LINE (owner, 2026-09-03)
 *
 * ⚠️ **This whole block was AMENDED, not added.** It used to pin `sections` —
 * the Physical / Ebook / Audio headings of 2026-09-02 — and those are gone.
 * Owner, 15:18, looking at round 1 live: *"Better but still duplicate, the hard
 * cover section has info and the stuff underneath has information"*, then at
 * 15:33 the shape he wants:
 *
 * > "I want to see hardcover paperback cover audio ebook as the tabs and the
 * > editions owned of each under … So hardcover / Collectors edition - sprayed
 * > edges signed / Standard edition / Standard edition - signed - lent out"
 *
 * `sections` was REMOVED rather than left beside `tabs`: two groupings of one
 * list is two things to keep in step, and the component only ever renders one.
 */
describe('tabs — one per format, "the editions owned of each under" (owner 2026-09-03)', () => {
  it('⚠️ AMENDED: groups the SAME row objects by FORMAT, in the owner order', () => {
    const v = deriveShelfView({
      ...NONE,
      title: 'X',
      copies: [copy({ id: 1, status: 'owned', edition_id: 77 })],
      editions: [
        edition({ id: 77, format: 'paperback' }),
        edition({ id: 78, format: 'ebook_epub' }),
      ],
      audiobookHolding: audioHolding({ title: 'X' }),
    });
    // It used to be ['physical','ebook','audio'] — three MEDIUMS. The physical
    // one now names the binding, and Audio comes before Ebook because that is
    // the order he listed them in.
    assert.deepEqual(
      v.tabs.map((t) => t.key),
      ['paperback', 'audio', 'ebook'],
    );
    assert.deepEqual(
      v.tabs.map((t) => t.label),
      ['Paperback', 'Audio', 'Ebook'],
    );
    // ⚠️ The same objects, not copies — one fact, one home, applied to a shape.
    // Every row is either a CARD under a tab, a LINE under a tab (an owned copy
    // group), or loose. Nothing is dropped and nothing is duplicated.
    const carded = v.tabs.flatMap((t) => t.rows);
    const lined = v.rows.filter((r) => r.owned && r.copies.length > 0);
    assert.equal(carded.length + lined.length + v.looseRows.length, v.rows.length);
    assert.ok(carded.every((r) => v.rows.includes(r)));
  });

  it('⚠️ AMENDED: a second PHYSICAL is a second TAB, not a second card under one heading', () => {
    // One owned paperback (linked, so it resolves and nothing is ambiguous) and
    // a hardcover printing nobody owns. Under the 2026-09-02 sections these were
    // two rows in one "Physical" section; they are now two tabs, and the
    // hardcover one holds nothing you own.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 77 })],
      editions: [
        edition({ id: 77, format: 'paperback', publisher: 'Tor', published_year: 2001 }),
        edition({ id: 78, format: 'hardcover', edition_name: 'First edition' }),
      ],
    });
    assert.deepEqual(
      v.tabs.map((t) => t.key),
      ['hardcover', 'paperback'],
    );
    const hardcover = v.tabs.find((t) => t.key === 'hardcover')!;
    const paperback = v.tabs.find((t) => t.key === 'paperback')!;
    assert.equal(paperback.owned, true, 'the paperback is the one he holds');
    assert.equal(paperback.lines.length, 1);
    // ⚠️ A printing he neither owns nor wants still SHOWS, as the card it always
    // was — "MAY BE YOURS" is untouched by this ask.
    assert.equal(hardcover.owned, false, 'nothing under it is a holding');
    assert.deepEqual(hardcover.lines, [], 'and so it has no copy lines at all');
    assert.equal(hardcover.rows.length, 1);
    assert.equal(hardcover.rows[0]!.label, 'First edition');
    // ⚠️ The owned copy is LINKED, so nothing of his could be the hardcover.
    assert.equal(hardcover.rows[0]!.stateLabel, 'Available');
  });

  it('a format with nothing at all gets NO tab', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 77 })],
      editions: [edition({ id: 77, format: 'paperback' })],
    });
    assert.deepEqual(
      v.tabs.map((t) => t.key),
      ['paperback'],
    );
  });

  it('⚠️ the neutral slot belongs to no format — it is LOOSE, not a tab called "Other"', () => {
    const v = deriveShelfView({ ...NONE });
    assert.deepEqual(v.tabs, [], 'no tab strip over a book with nothing on the shelf');
    assert.equal(v.looseRows.length, 1);
    assert.equal(v.looseRows[0]!.neutral, true);
  });

  it('a formatless "any format" want is loose too, beside the tabs', () => {
    // ⚠️ The wish has to be genuinely formatless to stay loose: with exactly one
    // physical printing on the work an unlinked copy borrows THAT format (the
    // 493 fix) and files under its tab. Here the only printing is a file, so
    // "I want this book, in whatever comes" has no format to borrow.
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 78 }),
        copy({ id: 2, status: 'wanted', edition_id: null }),
      ],
      editions: [edition({ id: 78, format: 'ebook_epub' })],
    });
    assert.deepEqual(
      v.tabs.map((t) => t.key),
      ['ebook'],
    );
    assert.equal(v.looseRows.length, 1);
    assert.equal(v.looseRows[0]!.key, 'want-any');
  });

  it('⚠️ a MASS MARKET copy earns its own tab — the shelf never drops a holding', () => {
    // He named four tabs. A format he did not name is still something he owns,
    // and a tab set that quietly loses it would be worse than a fifth word.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 10 })],
      editions: [edition({ id: 10, format: 'mass_market' })],
    });
    assert.deepEqual(
      v.tabs.map((t) => t.label),
      ['Mass market'],
    );
    assert.equal(v.tabs[0]!.lines.length, 1);
  });

  it('⚠️ a physical copy whose binding cannot be attributed files under "Physical"', () => {
    // Work 220's shape: two unlinked copies against two hardcover printings, so
    // nothing resolves — but the copies are still physical books in hand.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned' })],
      editions: [
        edition({ id: 10, format: 'hardcover', edition_name: 'A' }),
        edition({ id: 11, format: 'paperback', edition_name: 'B' }),
      ],
    });
    const physical = v.tabs.find((t) => t.key === 'physical')!;
    assert.ok(physical, 'the copy is not dropped for having no attributable format');
    assert.equal(physical.owned, true);
    assert.equal(physical.header, 'Physical');
  });
});

/**
 * ## ONE LINE PER OWNED COPY — the owner's own example, verbatim (2026-09-03)
 *
 * > "So hardcover
 * > Collectors edition - sprayed edges signed
 * > Standard edition
 * > Standard edition - signed - lent out"
 *
 * These pin what each LINE SAYS, which is the whole deliverable of round 2. The
 * line grammar: **the printing's name, then ` — `, then only what distinguishes
 * THAT copy**, joined ` · ` — the special-edition badges, then *Signed*, then a
 * status that is not "on the shelf", then the location.
 *
 * ⚠️ Two words are never printed, and their absence IS the plain case: *"On the
 * shelf"* (the copy is where it should be) and *"Not signed"* (nothing marks it
 * signed). That narrows the 2026-09-02 *"say it either way"* rule to the hover,
 * where `line.title` still answers both.
 */
describe('one line per owned copy — the owner example, word for word', () => {
  it("⚠️ THE OWNER'S THREE HARDCOVERS: exactly the three lines he wrote", () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, sprayed_edges: 1, is_signed: 1 }),
        copy({ id: 2, status: 'owned', edition_id: 11 }),
        copy({ id: 3, status: 'lent', edition_id: 11, is_signed: 1, condition: 'good' }),
      ],
      editions: [
        edition({ id: 10, format: 'hardcover', edition_name: 'Collectors edition' }),
        edition({ id: 11, format: 'hardcover', edition_name: 'Standard edition' }),
      ],
    });
    const tab = v.tabs.find((t) => t.key === 'hardcover')!;
    // Nothing is true of all three, so the header is the format word alone.
    assert.equal(tab.header, 'Hardcover');
    assert.deepEqual(tab.lines.map((l) => l.text), [
      'Collectors edition — Sprayed edges · Signed',
      'Standard edition',
      'Standard edition — Signed · Lent out',
    ]);
    // ⚠️ The condition came off the line (his example dropped it) and is still
    // reachable — a fact moved, never lost.
    assert.ok(tab.lines[2]!.title.includes('Condition: good'));
    // ⚠️ And neither of the two banned words appears anywhere in the lines.
    const all = tab.lines.map((l) => l.text).join(' | ');
    assert.ok(!all.includes('On the shelf'), 'the Owned case says nothing');
    assert.ok(!all.includes('Not signed'), 'the unsigned case says nothing');
  });

  it('⚠️ a fact EVERY copy under the tab shares is said ONCE, on the header', () => {
    // Round 1 could only ask "do the copies of this PRINTING agree?". These two
    // copies are of two DIFFERENT printings, so only the tab-level split can see
    // that both are signed — which is the lift this round is.
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, is_signed: 1 }),
        copy({ id: 2, status: 'owned', edition_id: 11, is_signed: 1 }),
      ],
      editions: [
        edition({ id: 10, format: 'hardcover', edition_name: 'Collectors edition' }),
        edition({ id: 11, format: 'hardcover', edition_name: 'Standard edition' }),
      ],
    });
    const tab = v.tabs.find((t) => t.key === 'hardcover')!;
    assert.equal(tab.header, 'Hardcover · all signed');
    assert.deepEqual(tab.lines.map((l) => l.text), ['Collectors edition', 'Standard edition']);
    assert.ok(
      tab.lines.every((l) => !l.text.includes('Signed')),
      '⚠️ the header said it; a line repeating it is the double information itself',
    );
    // The record is still on each line's hover, either way.
    assert.ok(tab.lines.every((l) => l.title.includes('Signed')));
  });

  it('⚠️ ONE copy of ONE format reads cleanly — one tab, one line, no "all"', () => {
    // "So paperback with standard under it." A single copy has nothing to share
    // WITH, so its facts stay on its line: "Paperback · all signed" over one
    // book would be a claim about a set of one.
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 10, is_signed: 1 })],
      editions: [edition({ id: 10, format: 'paperback', edition_name: 'Standard edition' })],
    });
    assert.equal(v.tabs.length, 1);
    const tab = v.tabs[0]!;
    assert.equal(tab.label, 'Paperback');
    assert.equal(tab.header, 'Paperback');
    assert.deepEqual(tab.lines.map((l) => l.text), ['Standard edition — Signed']);
  });

  it('a lent copy names the person, as ONE phrase', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10 }),
        copy({ id: 2, status: 'lent', edition_id: 10, person_name: 'Sam' }),
      ],
      editions: [edition({ id: 10, format: 'hardcover', edition_name: 'Standard edition' })],
    });
    const tab = v.tabs[0]!;
    // ⚠️ "Lent out to Sam", not "Lent out · Lent to Sam" — the word "lent" once.
    assert.deepEqual(tab.lines.map((l) => l.text), [
      'Standard edition',
      'Standard edition — Lent out to Sam',
    ]);
  });

  it('a borrowed copy says who from; a location rides on the end', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, location: 'Shelf 3' }),
        copy({ id: 2, status: 'borrowed', edition_id: 10, person_name: 'Kim' }),
      ],
      editions: [edition({ id: 10, format: 'hardcover', edition_name: 'Standard edition' })],
    });
    assert.deepEqual(v.tabs[0]!.lines.map((l) => l.text), [
      'Standard edition — Shelf 3',
      'Standard edition — Borrowed from Kim',
    ]);
  });

  it('⚠️ WORK 263 TODAY: unlinked copies keep the FORMAT word — never a borrowed name', () => {
    // The page the owner reviews. Three held copies, three hardcover printings,
    // no copy linked to one — so the printing cannot be named without inventing
    // an attribution (work 220's rule). The lines say what the record says, and
    // become "Collectors edition" the moment the copies are linked under
    // Editions & copies. The three printings still show as MAY BE YOURS cards.
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', sprayed_edges: 1 }),
        copy({ id: 2, status: 'owned' }),
        copy({ id: 3, status: 'lent', condition: 'good' }),
      ],
      editions: [
        edition({ id: 10, format: 'hardcover', edition_name: 'Collectors edition' }),
        edition({ id: 11, format: 'hardcover', edition_name: 'Standard edition' }),
        edition({ id: 12, format: 'hardcover', edition_name: 'Another printing' }),
      ],
    });
    const tab = v.tabs.find((t) => t.key === 'hardcover')!;
    assert.deepEqual(tab.lines.map((l) => l.text), [
      'Hardcover — Sprayed edges',
      'Hardcover',
      'Hardcover — Lent out',
    ]);
    assert.equal(tab.rows.length, 3, 'the three printings are still MAY BE YOURS cards');
    assert.ok(tab.rows.every((r) => r.stateLabel === 'May be yours'));
  });

  it('an AUDIO tab keeps its card — the cover and the provenance sentence stay', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: audioHolding({ matchedVia: 'containment', titleSimilarity: 0.87 }),
    });
    const tab = v.tabs.find((t) => t.key === 'audio')!;
    assert.equal(tab.header, 'Audio');
    assert.deepEqual(tab.lines, [], 'a recording is not a copy you hold — it stays a card');
    assert.equal(tab.rows.length, 1);
    assert.ok(tab.rows[0]!.coverUrl, 'its jacket survived');
    assert.ok(
      tab.rows[0]!.notes.includes(
        'Matched on a partial title (87% title match) — confirm it in ✎ Edit this book.',
      ),
      '⚠️ migration 0010: the provenance is shown, never hidden',
    );
  });

  it('an EBOOK COPY gets the same line grammar; an ebook FILE keeps its card', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 78, is_signed: 1 })],
      editions: [
        edition({ id: 78, format: 'ebook_epub', edition_name: 'Kindle' }),
        edition({ id: 79, format: 'ebook_epub', edition_name: 'The DRM-free one' }),
      ],
    });
    const tab = v.tabs.find((t) => t.key === 'ebook')!;
    assert.deepEqual(tab.lines.map((l) => l.text), ['Kindle — Signed']);
    assert.equal(tab.rows.length, 1, 'the file nobody holds a copy row for stays a card');
    assert.equal(tab.rows[0]!.label, 'EPUB');
  });

  it('a WISH keeps its card — a want is not a copy on the shelf', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'wanted', edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover', edition_name: 'Deluxe' })],
    });
    const tab = v.tabs.find((t) => t.key === 'hardcover')!;
    assert.deepEqual(tab.lines, []);
    assert.equal(tab.rows.length, 1);
    assert.equal(tab.rows[0]!.state, 'wanted');
    assert.equal(tab.owned, false);
  });

  it("a printing's own jacket rides on the line, and an absence stays an absence", () => {
    const withArt = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover', cover_url: 'https://x/y.jpg' })],
    });
    assert.equal(withArt.tabs[0]!.lines[0]!.coverUrl, 'https://x/y.jpg');
    const bare = deriveShelfView({
      ...NONE,
      copies: [copy({ id: 1, status: 'owned', edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    assert.equal(bare.tabs[0]!.lines[0]!.coverUrl, null, '⚠️ never the work cover borrowed');
  });

  it('⚠️ a shared SPRAYED-EDGES lifts too, and is worded for a set', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [
        copy({ id: 1, status: 'owned', edition_id: 10, sprayed_edges: 1 }),
        copy({ id: 2, status: 'owned', edition_id: 11, sprayed_edges: 1, is_signed: 1 }),
      ],
      editions: [
        edition({ id: 10, format: 'hardcover', edition_name: 'One' }),
        edition({ id: 11, format: 'hardcover', edition_name: 'Two' }),
      ],
    });
    const tab = v.tabs[0]!;
    assert.equal(tab.header, 'Hardcover · all sprayed edges');
    // Only ONE of them is signed, so that stays on its own line.
    assert.deepEqual(tab.lines.map((l) => l.text), ['One', 'Two — Signed']);
  });
});

describe('a printing own cover (owner 2026-09-02: "set the covers for the alternate editions too")', () => {
  it('an edition with a cover carries it onto its row; without one it is null', () => {
    const v = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover', cover_url: 'https://x/y.jpg' })],
    });
    assert.equal(only(v).coverUrl, 'https://x/y.jpg');
    const bare = deriveShelfView({
      ...NONE,
      copies: [copy({ edition_id: 10 })],
      editions: [edition({ id: 10, format: 'hardcover' })],
    });
    assert.equal(only(bare).coverUrl, null, '⚠️ an absence, never the work cover borrowed');
  });

  it('an AVAILABLE printing shows its own cover too', () => {
    const v = deriveShelfView({
      ...NONE,
      editions: [edition({ id: 2, format: 'hardcover', cover_url: 'https://x/alt.jpg' })],
    });
    assert.equal(only(v).coverUrl, 'https://x/alt.jpg');
  });
});
