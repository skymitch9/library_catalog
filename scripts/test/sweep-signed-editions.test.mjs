/**
 * `planRow` — what the "Signed" sweep would change for one edition row,
 * exercised with no database. This mapping IS the sweep's decision; the D1 read
 * and the UPDATE batch around it are plumbing.
 *
 * ⚠️ Pins the four things that make the sweep safe:
 *   1. **standard edition = both columns NULL** (migration 0050: NULL is an
 *      ordinary printing, not "unclassified"), applied to every matched row —
 *      including the multi-word names, which the owner said to normalise too;
 *   2. **the flag lands on a COPY** (migration 0430), never on the edition —
 *      and when the copy must be linked first, the link and the flag are one
 *      decision, so they can be written as one statement;
 *   3. **it never guesses which of several copies is signed** and never invents
 *      a copy row — those rows go to the owner;
 *   4. **a re-run is a no-op** — an already-flagged copy is not re-flagged, and
 *      a row whose name no longer says "signed" is not matched at all.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_FORMAT,
  nameSaysSigned,
  parseCopyList,
  planRow,
  resolveCopyCollisions,
  stripSignedWord,
} from '../sweep-signed-editions.mjs';

/** An edition row with the padhard shape unless overridden. */
function row(over = {}) {
  return {
    edition_id: 1,
    work_id: 10,
    edition_name: 'Signed',
    edition_kind: null,
    format: 'paperback',
    work_title: 'X',
    linked: [],
    unlinked: [],
    ...over,
  };
}

describe('sweep-signed-editions planRow — the dry-run mapping', () => {
  it('a plain "Signed" with a linked copy: clears both columns and flags the copy', () => {
    const p = planRow(row({ linked: [{ id: 7, is_signed: 0 }] }));
    assert.equal(p.clearName, true);
    assert.equal(p.clearKind, false); // it was already NULL
    assert.deepEqual(p.flagCopyIds, [7]);
    assert.equal(p.linkCopyId, null);
    assert.equal(p.needsOwner, null);
    assert.equal(p.losesWords, false);
  });

  it('⚠️ no linked copy but exactly ONE unlinked copy on the work: link AND flag it', () => {
    const p = planRow(row({ unlinked: [{ id: 42, is_signed: 0 }] }));
    assert.equal(p.linkCopyId, 42);
    assert.deepEqual(p.flagCopyIds, []);
    assert.equal(p.needsOwner, null);
  });

  it('⚠️ several unlinked copies: NOT guessed — handed to the owner with the ids', () => {
    const p = planRow(
      row({ unlinked: [{ id: 42, is_signed: 0 }, { id: 43, is_signed: 0 }] }),
    );
    assert.equal(p.linkCopyId, null);
    assert.deepEqual(p.flagCopyIds, []);
    assert.match(p.needsOwner, /2 unlinked copies/);
    assert.match(p.needsOwner, /#42, #43/);
    // The EDITION half still applies — "make them all standard edition".
    assert.equal(p.clearName, true);
  });

  it('⚠️ no copy row at all: handed to the owner, and no copy is invented', () => {
    const p = planRow(row({ linked: [], unlinked: [] }));
    assert.equal(p.linkCopyId, null);
    assert.match(p.needsOwner, /no copy row/);
  });

  it('⚠️ an already-flagged linked copy is not re-flagged — a re-run writes no copy', () => {
    const p = planRow(row({ linked: [{ id: 7, is_signed: 1 }] }));
    assert.deepEqual(p.flagCopyIds, []);
    assert.equal(p.linkCopyId, null);
    assert.equal(p.needsOwner, null); // it HAS a linked copy; nothing is owed
  });

  it('flags only the unflagged half of several linked copies', () => {
    const p = planRow(
      row({ linked: [{ id: 7, is_signed: 1 }, { id: 8, is_signed: 0 }] }),
    );
    assert.deepEqual(p.flagCopyIds, [8]);
  });

  it('hardcover and paperback are KEPT', () => {
    for (const format of ['hardcover', 'paperback']) {
      const p = planRow(row({ format, linked: [{ id: 7, is_signed: 0 }] }));
      assert.equal(p.defaultFormat, false, `${format} must be kept`);
      assert.equal(p.newFormat, format);
    }
  });

  it('⚠️ anything else defaults to paperback — mass_market included', () => {
    for (const format of ['mass_market', 'ebook_epub', null]) {
      const p = planRow(row({ format, linked: [{ id: 7, is_signed: 0 }] }));
      assert.equal(p.defaultFormat, true, `${format} must default`);
      assert.equal(p.newFormat, DEFAULT_FORMAT);
    }
  });

  it('⚠️ a multi-word name is still normalised, and is FLAGGED as losing words', () => {
    const p = planRow(
      row({ edition_name: 'Signed special', edition_kind: 'collectors', linked: [{ id: 7, is_signed: 1 }] }),
    );
    assert.equal(p.clearName, true);
    assert.equal(p.clearKind, true);
    assert.equal(p.losesWords, true);
  });

  it('case and stray whitespace do not make a bare "Signed" look like prose', () => {
    assert.equal(planRow(row({ edition_name: ' signed ' })).losesWords, false);
    assert.equal(planRow(row({ edition_name: 'SIGNED' })).losesWords, false);
    assert.equal(planRow(row({ edition_name: 'After light edition/ signed' })).losesWords, true);
  });

  it('⚠️ a swept row no longer matches — the sweep is idempotent by construction', () => {
    // What the row looks like after --commit: the name is what the SQL matches on.
    assert.equal(nameSaysSigned(null), false);
    assert.equal(nameSaysSigned('Signed deluxe edition'), true);
    assert.equal(nameSaysSigned('SIGNED'), true);
    assert.equal(nameSaysSigned('Illumicrate Exclusive'), false);
    const swept = planRow(row({ edition_name: null, edition_kind: null }));
    assert.equal(swept.clearName, false);
    assert.equal(swept.clearKind, false);
  });
});

describe('resolveCopyCollisions — two editions cannot take one copy', () => {
  /**
   * The real case, found on MAIN 2026-09-03: *Something* has two "Signed"
   * editions (#620 paperback, #621 hardcover) and one unlinked copy #407.
   */
  it('⚠️ both claimants lose the copy and go to the owner — the last write must not silently win', () => {
    const settled = resolveCopyCollisions([
      planRow(row({ edition_id: 620, format: 'paperback', unlinked: [{ id: 407, is_signed: 0 }] })),
      planRow(row({ edition_id: 621, format: 'hardcover', unlinked: [{ id: 407, is_signed: 0 }] })),
    ]);
    for (const plan of settled) {
      assert.equal(plan.linkCopyId, null);
      assert.match(plan.needsOwner, /all claim its one unlinked copy #407/);
      // The EDITION half is untouched by the collision.
      assert.equal(plan.clearName, true);
    }
  });

  it('a copy claimed once is left alone', () => {
    const settled = resolveCopyCollisions([
      planRow(row({ edition_id: 1, unlinked: [{ id: 42, is_signed: 0 }] })),
      planRow(row({ edition_id: 2, unlinked: [{ id: 43, is_signed: 0 }] })),
    ]);
    assert.deepEqual(settled.map((p) => p.linkCopyId), [42, 43]);
    assert.deepEqual(settled.map((p) => p.needsOwner), [null, null]);
  });

  it('rows with no link proposal are untouched, and null is never treated as a claim', () => {
    const plans = [
      planRow(row({ linked: [{ id: 7, is_signed: 0 }] })),
      planRow(row({ linked: [], unlinked: [] })),
    ];
    const settled = resolveCopyCollisions(plans);
    assert.deepEqual(settled[0].flagCopyIds, [7]);
    assert.equal(settled[0].needsOwner, null);
    assert.match(settled[1].needsOwner, /no copy row/);
  });
});

/**
 * `--strip-word`, the MAIN mode. The owner looked at main's 20 real vendor names
 * and said *"I think remove signed from the name keep the rest, mark them all
 * signed"* (2026-09-03 14:26 Phoenix) — so the mapping below is not a guess, it
 * is the spec, pair by pair, and every one of these strings is a name that
 * actually exists in `library-catalog` or was written out by the owner.
 */
describe('stripSignedWord — the owner-checked before → after pairs', () => {
  const CASES = [
    // The 15-row bulk of MAIN: the word sits mid-name and only the word goes.
    ['Kickstarter signed paperback', 'Kickstarter paperback'],
    // ⚠️ The comma is KEPT: it joins "hardcover" to an item that still exists.
    ['Campaign-only exclusive hardcover, signed extras', 'Campaign-only exclusive hardcover, extras'],
    // ⚠️ The "&" is DROPPED: it joined *Signed* to *Numbered*, and one is gone.
    [
      "Collector's Edition Trilogy — Book 1 Signed & Numbered",
      "Collector's Edition Trilogy — Book 1 Numbered",
    ],
    // Everything after the word survives verbatim, punctuation and all.
    [
      'Signed Leatherbound (two-volume set: books 1-2)',
      'Leatherbound (two-volume set: books 1-2)',
    ],
    // Nothing survives → NULL, which is migration 0050's "ordinary printing".
    ['Signed', null],
    // ⚠️ Capitalised, because deleting a leading word promotes the next one.
    ['Signed special', 'Special'],
  ];

  for (const [before, after] of CASES) {
    it(`"${before}" → ${after === null ? 'NULL' : `"${after}"`}`, () => {
      assert.equal(stripSignedWord(before), after);
    });
  }

  it('padhard\'s multi-word names, had this mode existed then', () => {
    assert.equal(stripSignedWord('Signed deluxe edition'), 'Deluxe edition');
    // The dangling "/" left behind at the end is trimmed, not kept.
    assert.equal(stripSignedWord('After light edition/ signed'), 'After light edition');
  });

  it('case and whitespace do not change the answer', () => {
    assert.equal(stripSignedWord('SIGNED paperback'), 'Paperback');
    assert.equal(stripSignedWord('  signed  '), null);
    assert.equal(stripSignedWord('Kickstarter  SIGNED  paperback'), 'Kickstarter paperback');
  });

  it('⚠️ "signed" inside another word is NOT the word — the name comes back untouched', () => {
    // `instr(lower(name), 'signed')` matches these; the sweep must not mangle them.
    for (const name of ['Cosigned edition', 'Unsigned proof', 'Consigned copy']) {
      assert.equal(stripSignedWord(name), name);
    }
  });

  it('drops the connector on either side rather than leaving it dangling', () => {
    assert.equal(stripSignedWord('Signed & Numbered'), 'Numbered');
    assert.equal(stripSignedWord('Signed and numbered'), 'Numbered');
    assert.equal(stripSignedWord('Numbered & signed'), 'Numbered');
    assert.equal(stripSignedWord('Signed/numbered'), 'Numbered');
    assert.equal(stripSignedWord('Deluxe, signed'), 'Deluxe');
  });

  it('null in, null out', () => {
    assert.equal(stripSignedWord(null), null);
    assert.equal(stripSignedWord(undefined), null);
  });
});

describe('planRow --strip-word — keep the name, keep the kind, flag every copy', () => {
  const strip = (over) => planRow(row(over), { stripWord: true });

  it('rewrites the name and NEVER touches edition_kind', () => {
    const p = strip({
      edition_name: 'Kickstarter signed paperback',
      edition_kind: 'collectors',
      linked: [{ id: 7, is_signed: 0 }],
    });
    assert.equal(p.renameName, true);
    assert.equal(p.newName, 'Kickstarter paperback');
    assert.equal(p.clearName, false);
    assert.equal(p.clearKind, false, 'edition_kind is untouched in this mode');
  });

  it('a bare "Signed" still empties the name to NULL', () => {
    const p = strip({ linked: [{ id: 7, is_signed: 0 }] });
    assert.equal(p.renameName, true);
    assert.equal(p.newName, null);
  });

  it('⚠️ "mark them all signed": an UNLINKED copy is flagged even when a linked one exists', () => {
    const p = strip({
      linked: [{ id: 7, is_signed: 0 }],
      unlinked: [{ id: 8, is_signed: 0 }, { id: 9, is_signed: 0 }],
    });
    assert.deepEqual(p.flagCopyIds, [7, 8, 9]);
    // …but the ambiguous ones are NOT linked, and that is an outstanding task.
    assert.equal(p.linkCopyId, null);
    assert.match(p.needsOwner, /flagged signed but NOT linked/);
    assert.match(p.needsOwner, /#8, #9/);
  });

  it('the one unambiguous case still links: no linked copy, exactly one unlinked', () => {
    const p = strip({ unlinked: [{ id: 42, is_signed: 0 }] });
    assert.equal(p.linkCopyId, 42);
    // ⚠️ It stays in flagCopyIds on purpose — the caller drops it when it builds
    // the single link+flag statement, and resolveCopyCollisions may put it back.
    assert.deepEqual(p.flagCopyIds, [42]);
    assert.equal(p.needsOwner, null);
  });

  it('⚠️ a collision withholds the LINK but the copy is still flagged signed', () => {
    // MAIN's real case: *Something* #620/#621 both claim copy #407.
    const settled = resolveCopyCollisions([
      strip({ edition_id: 620, format: 'paperback', unlinked: [{ id: 407, is_signed: 0 }] }),
      strip({ edition_id: 621, format: 'hardcover', unlinked: [{ id: 407, is_signed: 0 }] }),
    ]);
    for (const plan of settled) {
      assert.equal(plan.linkCopyId, null);
      assert.deepEqual(plan.flagCopyIds, [407], 'the flag survives the collision');
      assert.match(plan.needsOwner, /all claim its one unlinked copy #407/);
      assert.match(plan.needsOwner, /flagged signed anyway/);
    }
  });

  it('already-flagged copies are not re-flagged — a re-run writes nothing', () => {
    const p = strip({ linked: [{ id: 7, is_signed: 1 }], unlinked: [] });
    assert.deepEqual(p.flagCopyIds, []);
    assert.equal(p.linkCopyId, null);
    assert.equal(p.needsOwner, null);
  });

  it('no copy at all is still handed over, and no copy is invented', () => {
    const p = strip({ linked: [], unlinked: [] });
    assert.deepEqual(p.flagCopyIds, []);
    assert.match(p.needsOwner, /no copy row/);
  });

  it('the format rule is unchanged: keep hardcover/paperback, default the rest', () => {
    assert.equal(strip({ format: 'hardcover' }).newFormat, 'hardcover');
    assert.equal(strip({ format: 'mass_market' }).newFormat, DEFAULT_FORMAT);
    assert.equal(strip({ format: 'mass_market' }).defaultFormat, true);
  });

  it('⚠️ "signed" inside another word: nothing is written, and the row is reported', () => {
    const p = strip({ edition_name: 'Cosigned edition', linked: [{ id: 7, is_signed: 0 }] });
    assert.equal(p.renameName, false);
    assert.equal(p.wordNotFound, true);
  });

  it('the DEFAULT mode is untouched by the new argument', () => {
    const p = planRow(row({ edition_name: 'Kickstarter signed paperback', linked: [{ id: 7, is_signed: 0 }] }));
    assert.equal(p.clearName, true);
    assert.equal(p.newName, undefined);
    assert.equal(p.losesWords, true);
  });
});

describe('parseCopyList — group_concat back into rows', () => {
  it('parses ids and flags', () => {
    assert.deepEqual(parseCopyList('12:0,13:1'), [
      { id: 12, is_signed: 0 },
      { id: 13, is_signed: 1 },
    ]);
  });

  it('an empty result is an empty list, not a one-element list of NaN', () => {
    for (const empty of [null, undefined, '']) {
      assert.deepEqual(parseCopyList(empty), []);
    }
  });
});
