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
  isbnLanguageVerdict,
  llmKeyName,
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
