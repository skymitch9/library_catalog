/**
 * Guards for the scripts/ audit HIGH findings:
 *   - key custody on the paid --llm rung (backfill-missing-isbns.mjs:431)
 *   - the 'manual' source is never demoted by an ISBN write (…:517)
 *   - --friend is threaded into query/execute so a --friend run cannot silently
 *     read/write the MAIN catalogue (backfill-work-covers.mjs:35 et al.)
 *
 * The scripts run on import, so the pure decisions are extracted to
 * scripts/lib/backfill-safety.mjs and tested here; the friend-threading fix is
 * guarded structurally against the (import-unsafe) script sources.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  declaresNoIsbn,
  editionSourceWriteExpr,
  isCrowdfundedPrinting,
  isbnLanguageVerdict,
  llmKeyName,
  namesAnIsbn,
  readLlmKeyFrom,
} from '../lib/backfill-safety.mjs';

describe('llmKeyName — the paid rung follows the instance (audit HIGH :431)', () => {
  it('a --friend run reads padhard\'s own key, not the owner\'s', () => {
    assert.deepEqual(llmKeyName({ friend: true }), {
      keyName: 'ANTHROPIC_API_KEY_FRIEND_SAM',
      overridden: false,
    });
  });

  it('the main instance reads ANTHROPIC_API_KEY', () => {
    assert.deepEqual(llmKeyName({ friend: false }), {
      keyName: 'ANTHROPIC_API_KEY',
      overridden: false,
    });
  });

  it('--llm-key-from=main overrides a --friend run onto the owner\'s key, loudly', () => {
    assert.deepEqual(llmKeyName({ friend: true, keyFrom: 'main' }), {
      keyName: 'ANTHROPIC_API_KEY',
      overridden: true,
    });
  });

  it('--llm-key-from=main is IGNORED on a non-friend run (no override to make)', () => {
    assert.deepEqual(llmKeyName({ friend: false, keyFrom: 'main' }), {
      keyName: 'ANTHROPIC_API_KEY',
      overridden: false,
    });
  });

  it('readLlmKeyFrom parses the flag value', () => {
    assert.equal(readLlmKeyFrom(['--llm', '--friend', '--llm-key-from=main']), 'main');
    assert.equal(readLlmKeyFrom(['--llm']), null);
  });
});

describe('editionSourceWriteExpr — never demote a manual edition (audit HIGH :517)', () => {
  const lit = (v) => `'${String(v)}'`;

  it('preserves manual and writes the incoming source otherwise', () => {
    const expr = editionSourceWriteExpr(lit, 'openlibrary');
    assert.match(expr, /WHEN source = 'manual' THEN source/);
    assert.match(expr, /ELSE 'openlibrary' END/);
  });

  it('maps the llm rung to the schema-allowed research source', () => {
    const expr = editionSourceWriteExpr(lit, 'llm');
    assert.match(expr, /ELSE 'research' END/);
    assert.doesNotMatch(expr, /'llm'/);
  });

  it('is a CASE, not an unconditional assignment (the pre-fix bug)', () => {
    assert.match(editionSourceWriteExpr(lit, 'googlebooks'), /^CASE WHEN/);
  });
});

describe('declaresNoIsbn — a printing that says it has no ISBN is not a gap (2026-08-20)', () => {
  it('catches the slipcase wording, which is the biggest class in production', () => {
    assert.equal(
      declaresNoIsbn(
        'Volume of the slipcase set (set ISBN 9781368053099); no per-volume ISBN recorded',
        null,
      ),
      'no per-volume ISBN recorded',
    );
  });

  it("catches the owner-verified note migration 0460 split out of the name", () => {
    assert.match(
      declaresNoIsbn('Illumicrate Exclusive', 'no ISBN printed on this edition (owner-verified)'),
      /^no ISBN printed on this edition/,
    );
  });

  it('catches the barcode wording the same note carries on other rows', () => {
    assert.ok(declaresNoIsbn(null, 'No barcode printed on this copy (owner-verified)'));
  });

  it('reads the note as well as the name, in either position', () => {
    assert.ok(declaresNoIsbn('no ISBN assigned', null));
    assert.ok(declaresNoIsbn(null, 'no ISBN recorded'));
  });

  it('is NARROW: an exclusive printing is not refused just for being exclusive', () => {
    // 42 of the 43 rows the 2026-08-20 run filled were special printings, and
    // most of them may well have a real ISBN. Refusing every Kickstarter row
    // would trade one silent-wrong-fill for a silent-never-fill.
    assert.equal(declaresNoIsbn('Kickstarter limited edition hardcover', null), null);
    assert.equal(declaresNoIsbn("Collector's Edition", null), null);
    assert.equal(declaresNoIsbn('Crowdfunded print copy', null), null);
    assert.equal(
      declaresNoIsbn('Leatherbound (two-volume set: Vol 1 ISBN 9781938570308)', null),
      null,
    );
  });

  it('is quiet on empty input', () => {
    assert.equal(declaresNoIsbn(null, null), null);
    assert.equal(declaresNoIsbn('', ''), null);
    assert.equal(declaresNoIsbn(undefined, undefined), null);
  });
});

describe("isCrowdfundedPrinting — the owner's ruling of 2026-09-05 18:29 Phoenix", () => {
  /*
   * Owner, verbatim: "For the kickstarters we have in stock the ISBNs are
   * recorded if they exist." So on a crowdfunded printing he holds, an absent
   * isbn13 is a MEASURED ABSENCE, and filling it overwrites a recorded fact.
   *
   * ⚠️ These 12 names are the REAL edition_name values on the 13 tier C rows,
   * read live from production 2026-09-05 — not invented fixtures. (The Grimoire
   * name covers five rows: #331 #332 #334 #335 and its sibling.)
   */
  const TIER_C_NAMES = [
    ['Book with sticker and bookmark tier', 'tier', 'ed#317 Fires of December'],
    ["Collector's Edition Trilogy — Book 1 Numbered", "Collector's", 'ed#319 The Primal Hunter'],
    ["Collector's Edition", "Collector's", 'ed#320 Ascend Online: Legacy of the Fallen'],
    ['Kickstarter limited edition hardcover', 'Kickstarter', "ed#330 The Dungeon Anarchist's Cookbook"],
    ['Kickstarter Grimoire Edition — faux leather', 'Kickstarter', 'ed#331/332/334/335 Krout'],
    ['Crowdfunded print copy', 'Crowdfunded', 'ed#343/344/345 Space Knight'],
    ['Kickstarter paperback', 'Kickstarter', 'ed#349 Monster Empire Book 1'],
    ["Kickstarter Collector's Edition", 'Kickstarter', 'ed#350 Ascend Online'],
  ];

  for (const [name, phrase, which] of TIER_C_NAMES) {
    it(`refuses ${JSON.stringify(name)} (${which})`, () => {
      assert.equal(isCrowdfundedPrinting(name, null), phrase);
    });
  }

  it('catches the other campaign vocabulary in production edition_names', () => {
    assert.ok(isCrowdfundedPrinting('Indiegogo print copy', null));
    assert.ok(isCrowdfundedPrinting('Illumicrate Exclusive', null));
    assert.ok(isCrowdfundedPrinting('Campaign-only exclusive hardcover, extras', null));
    assert.ok(isCrowdfundedPrinting('B&N Exclusive Edition', null));
    assert.ok(isCrowdfundedPrinting('BackerKit add-on', null));
  });

  it('reads the note as well as the name', () => {
    assert.ok(isCrowdfundedPrinting(null, 'came from the Kickstarter campaign'));
    assert.equal(isCrowdfundedPrinting(null, 'a plain second-hand paperback'), null);
  });

  it('🔴 does NOT match a plain trade edition_name', () => {
    // The whole cost of this widening is silent-never-fill on ordinary rows, so
    // the ordinary rows have to stay fillable.
    assert.equal(isCrowdfundedPrinting('Hardcover', null), null);
    assert.equal(isCrowdfundedPrinting('Paperback', null), null);
    assert.equal(isCrowdfundedPrinting('Trade paperback', null), null);
    assert.equal(isCrowdfundedPrinting('First Edition', null), null);
    assert.equal(isCrowdfundedPrinting('Mass market', null), null);
  });

  it('🔴 does NOT match edition_name NULL — that is #507, The Book of Mormon', () => {
    // Edition #507 is the ONE ordinary printing among the 43 rows the 2026-08-20
    // run filled (isbn-ladder.md §7.1): edition_name NULL, note NULL, format
    // paperback, no special-copy flags on either owned copy. The owner's ruling
    // is about "the kickstarters we have in stock" and does not reach it, which
    // is why tier C is 13 rows and not 14.
    assert.equal(isCrowdfundedPrinting(null, null), null);
    assert.equal(isCrowdfundedPrinting(undefined, undefined), null);
    assert.equal(isCrowdfundedPrinting('', ''), null);
  });

  it('is word-boundary anchored — "tier" must not fire on "Frontier"', () => {
    // An unanchored /tier/ matches Fron-TIER, and a guard that fires on a title
    // is worse than no guard: it turns one silent-wrong-fill into many
    // silent-never-fills, the exact trade declaresNoIsbn refused to make.
    assert.equal(isCrowdfundedPrinting('Frontier Justice', null), null);
    assert.equal(isCrowdfundedPrinting('Rentier', null), null);
  });

  it('is a SEPARATE claim from declaresNoIsbn, and both still hold', () => {
    // declaresNoIsbn stays narrow on purpose: it refuses a row that STATES no
    // ISBN exists, true in anyone's hands. This one refuses a crowdfunded
    // OBJECT, and is sound only because of the owner's stated habit. A future
    // session must be able to move one without moving the other.
    assert.equal(declaresNoIsbn('Kickstarter limited edition hardcover', null), null);
    assert.ok(isCrowdfundedPrinting('Kickstarter limited edition hardcover', null));

    const slipcase = 'Volume of the slipcase set (set ISBN 9781368053099); no per-volume ISBN recorded';
    assert.ok(declaresNoIsbn(slipcase, null));
    assert.equal(isCrowdfundedPrinting(slipcase, null), null);
  });
});

describe('namesAnIsbn — the third guard, and the row that got past the other two', () => {
  /*
   * Edition #321, work 220 *Words of Radiance* — the Dragonsteel leatherbound.
   * This edition_name is the REAL production value, read live 2026-09-06:
   * isbn13 NULL, source 'openlibrary', and the name below.
   *
   * Measured in the 2026-09-06 01:44Z production dry run: with declaresNoIsbn
   * and isCrowdfundedPrinting both in force, the ladder still proposed
   * 9781399622073 (Orion, a UK trade hardcover) for this row — two hours after
   * the owner had nulled that exact value as tier A.
   */
  const ED_321 =
    'Leatherbound (two-volume set: Vol 1 ISBN 9781938570308, Vol 2 ISBN 9781938570315)';

  it('🔴 refuses ed#321, naming the first identifier the row states', () => {
    assert.equal(namesAnIsbn(ED_321, null), '9781938570308');
  });

  it('🔴 is the ONLY one of the three guards that catches ed#321', () => {
    // The whole reason this function exists. declaresNoIsbn misses it because
    // the row does not say it has no ISBN — it names two. isCrowdfundedPrinting
    // misses it because "leatherbound" is a binding material, not campaign
    // vocabulary, and it was deliberately NOT added to that word list: whether a
    // leatherbound is "a kickstarter we have in stock" is a question about a
    // physical object, and those belong to the owner.
    assert.equal(declaresNoIsbn(ED_321, null), null);
    assert.equal(isCrowdfundedPrinting(ED_321, null), null);
    assert.ok(namesAnIsbn(ED_321, null));
  });

  it('reads the note as well as the name', () => {
    assert.equal(namesAnIsbn(null, 'the set ISBN is 9781368053099'), '9781368053099');
  });

  it('accepts the hyphenated printed form, and the ISBN-13 / ISBN-10 spellings', () => {
    assert.equal(namesAnIsbn('Vol 1, ISBN 978-1-938570-30-8', null), '9781938570308');
    assert.equal(namesAnIsbn('ISBN-13: 9781938570308', null), '9781938570308');
    assert.equal(namesAnIsbn('ISBN-10 0786838655', null), '0786838655');
    assert.equal(namesAnIsbn('ISBNs: 9781938570308 / 9781938570315', null), '9781938570308');
    // An ISBN-10 ending in the check character X.
    assert.equal(namesAnIsbn('ISBN 043942089X', null), '043942089X');
  });

  it('takes the LEADING identifier when two are space-separated, never a splice of both', () => {
    // Without the slice this concatenates into a 26-digit non-answer and the
    // guard silently stops firing — a refusal that quietly becomes a write.
    assert.equal(namesAnIsbn('ISBN 9781938570308 9781938570315', null), '9781938570308');
  });

  it('🔴 needs the WORD and a NUMBER — neither half alone is a named identifier', () => {
    // The word with no number: nothing has been stated.
    assert.equal(namesAnIsbn('ISBN unknown', null), null);
    assert.equal(namesAnIsbn('check the ISBN on the copyright page', null), null);
    assert.equal(namesAnIsbn(null, 'ISBN not yet recorded'), null);
    // A number with no word: a year, a print run, a tier, a price.
    assert.equal(namesAnIsbn('First printing 2019, 1 of 500', null), null);
    assert.equal(namesAnIsbn('Kickstarter tier 3', null), null);
    assert.equal(namesAnIsbn(null, 'bought 2021-08-14 for 39.99'), null);
  });

  it('does not fire on a plain trade edition_name, which must stay fillable', () => {
    // Same cost as isCrowdfundedPrinting's widening: every false refusal here is
    // a silent-never-fill, so ordinary rows have to keep reaching the ladder.
    assert.equal(namesAnIsbn('Hardcover', null), null);
    assert.equal(namesAnIsbn('Trade paperback', null), null);
    assert.equal(namesAnIsbn('First Edition', null), null);
  });

  it('is quiet on empty input — that is ed#507, The Book of Mormon', () => {
    // edition_name NULL and note NULL: the row states nothing at all, so no
    // guard may refuse it. #507 stays an open question for the owner rather
    // than being quietly swept up by a third guard it does not fit.
    assert.equal(namesAnIsbn(null, null), null);
    assert.equal(namesAnIsbn(undefined, undefined), null);
    assert.equal(namesAnIsbn('', ''), null);
  });

  it('overlaps declaresNoIsbn on the slipcase wording, and guard 1 still runs first', () => {
    // Both fire on this row. The script checks declaresNoIsbn first, so the 17
    // slipcase rows keep being reported under their existing reason and the
    // counts in docs/info/isbn-ladder.md §7 do not move.
    const slipcase =
      'Volume of the slipcase set (set ISBN 9781368053099); no per-volume ISBN recorded';
    assert.ok(declaresNoIsbn(slipcase, null));
    assert.equal(namesAnIsbn(slipcase, null), '9781368053099');
  });

  it('does NOT verify the check digit, on purpose', () => {
    // The claim is "this row has already stated its identifiers", which a
    // mistyped ISBN states just as loudly as a valid one — and checking would
    // mean importing packages/core/src/isbn.ts into a leaf .mjs that has to keep
    // running under plain node.
    assert.equal(namesAnIsbn('ISBN 9781938570300', null), '9781938570300');
  });
});

describe('isbnLanguageVerdict — the real 2026-08-20 mismatches, by ISBN', () => {
  it('an attested foreign language refuses, whatever the group says', () => {
    // Filed on The Sea of Monsters: La mer des monstres, Albin Michel.
    assert.equal(isbnLanguageVerdict({ isbn13: '9782226177612', languages: ['fre'] }), 'foreign');
    // Filed on The Last Olympian: Ostatni Olimpijczyk, Jaguar.
    assert.equal(isbnLanguageVerdict({ isbn13: '9788362170043', languages: ['pol'] }), 'foreign');
    // Filed on The Son of Neptune: El fill de Neptú, La Galera — CATALAN.
    assert.equal(isbnLanguageVerdict({ isbn13: '9788424664558', languages: ['cat'] }), 'foreign');
  });

  it('an attested English language passes even from a non-English group', () => {
    assert.equal(isbnLanguageVerdict({ isbn13: '9788362170043', languages: ['eng'] }), 'ok');
  });

  it('accepts the two-letter form Google Books uses', () => {
    assert.equal(isbnLanguageVerdict({ isbn13: '9780786838653', languages: ['en'] }), 'ok');
    assert.equal(isbnLanguageVerdict({ isbn13: '9783596712496', languages: ['de'] }), 'foreign');
  });

  it('falls back to the registration group when nothing is attested', () => {
    // Oathbringer got 978-605 (Turkey) with no language on the record.
    assert.equal(isbnLanguageVerdict({ isbn13: '9786052382349' }), 'foreign');
    // Starsight got 978-83 (Poland).
    assert.equal(isbnLanguageVerdict({ isbn13: '9788381168830', languages: [] }), 'foreign');
    // A Kickstarter hardcover got 979-12 (Italy) off Google Books.
    assert.equal(isbnLanguageVerdict({ isbn13: '9791281656383' }), 'foreign');
  });

  it('978-0 / 978-1 and the 979-8 KDP block are UNKNOWN, never a confirmation', () => {
    // Unknown proceeds — the gate refuses positively wrong answers, it does not
    // demand proof, or nothing self-published would ever be filled.
    assert.equal(isbnLanguageVerdict({ isbn13: '9780786838653' }), 'unknown');
    assert.equal(isbnLanguageVerdict({ isbn13: '9781399622073' }), 'unknown');
    assert.equal(isbnLanguageVerdict({ isbn13: '9798426232426' }), 'unknown');
  });

  it('a malformed ISBN is unknown, not foreign — the checksum gate owns that', () => {
    assert.equal(isbnLanguageVerdict({ isbn13: 'not-an-isbn' }), 'unknown');
    assert.equal(isbnLanguageVerdict({ isbn13: '' }), 'unknown');
  });

  it('honours a non-English expected language, for a future non-English shelf', () => {
    assert.equal(
      isbnLanguageVerdict({ isbn13: '9782226177612', languages: ['fre'], expected: 'fre' }),
      'ok',
    );
  });
});
