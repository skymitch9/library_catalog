/**
 * The `ebook_holding` derivation and the agreement check — phase 4 of the
 * ebook split. Pinned here, without a database, because the backfill script
 * and the work page's shadow panel both call these exact functions: if these
 * hold, the script's census and the UI's verdict cannot disagree.
 *
 * The load-bearing rules:
 *
 *   - derivation is a projection over stored `work_id`s — grouping, never
 *     matching (no fold, no similarity, nothing to get wrong);
 *   - one row per work, whatever the edition count (work #90's shape);
 *   - `ebook_kindle` is a licence, not a pool file, and never derives a row;
 *   - `ebookAgreement` gives four honest answers, and 'neither' is the
 *     ordinary agree-case that renders nothing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveEbookHoldings,
  ebookAgreement,
  manifestFormat,
  type EbookEditionInput,
} from '../src/ebook-holding.js';

function edition(overrides: Partial<EbookEditionInput> = {}): EbookEditionInput {
  return {
    workId: 1,
    format: 'ebook_epub',
    source: 'file',
    sourceUrl: 'Author/Title.epub',
    ...overrides,
  };
}

describe('manifestFormat — the stored spelling is the manifest’s', () => {
  it('strips the ebook_ prefix and nothing else', () => {
    assert.equal(manifestFormat('ebook_epub'), 'epub');
    assert.equal(manifestFormat('ebook_pdf'), 'pdf');
    // A format without the prefix passes through untouched — total, no throw.
    assert.equal(manifestFormat('epub'), 'epub');
  });
});

describe('deriveEbookHoldings — a projection, not a match', () => {
  it('one edition, one plan, carrying format / path / provenance', () => {
    const plans = deriveEbookHoldings([edition()]);
    assert.equal(plans.length, 1);
    assert.deepEqual(plans[0], {
      workId: 1,
      formats: ['epub'],
      sourcePath: 'Author/Title.epub',
      editionSource: 'file',
    });
  });

  it('two editions of one work collapse to ONE row — migration 0310’s rule', () => {
    // Work #90's real shape: two epub editions (measured 2026-08-16).
    const plans = deriveEbookHoldings([
      edition({ workId: 90, sourceUrl: 'A/first.epub' }),
      edition({ workId: 90, sourceUrl: 'A/second.epub' }),
    ]);
    assert.equal(plans.length, 1);
    assert.deepEqual(plans[0]!.formats, ['epub']); // deduplicated
    assert.equal(plans[0]!.sourcePath, 'A/first.epub'); // first path wins
  });

  it('distinct formats are all recorded, sorted', () => {
    const plans = deriveEbookHoldings([
      edition({ format: 'ebook_pdf', sourceUrl: 'A/t.pdf' }),
      edition({ format: 'ebook_epub', sourceUrl: 'A/t.epub' }),
    ]);
    assert.deepEqual(plans[0]!.formats, ['epub', 'pdf']);
  });

  it('ebook_kindle derives NOTHING — a licence has no file in the pool', () => {
    assert.deepEqual(deriveEbookHoldings([edition({ format: 'ebook_kindle' })]), []);
  });

  it('physical formats derive nothing — they are what this catalog is FOR', () => {
    assert.deepEqual(
      deriveEbookHoldings([
        edition({ format: 'hardcover' }),
        edition({ format: 'paperback' }),
      ]),
      [],
    );
  });

  it("'file' outranks 'manual' as provenance, whatever the row order", () => {
    for (const rows of [
      [edition({ source: 'manual', sourceUrl: null }), edition({ source: 'file' })],
      [edition({ source: 'file' }), edition({ source: 'manual', sourceUrl: null })],
    ]) {
      assert.equal(deriveEbookHoldings(rows)[0]!.editionSource, 'file');
    }
  });

  it('a purely manual edition keeps its provenance and its null path', () => {
    const plans = deriveEbookHoldings([edition({ source: 'manual', sourceUrl: null })]);
    assert.equal(plans[0]!.editionSource, 'manual');
    assert.equal(plans[0]!.sourcePath, null);
  });

  it('plans come back sorted by work id, one per work', () => {
    const plans = deriveEbookHoldings([
      edition({ workId: 30 }),
      edition({ workId: 2 }),
      edition({ workId: 30 }),
    ]);
    assert.deepEqual(plans.map((p) => p.workId), [2, 30]);
  });
});

describe('ebookAgreement — four honest answers', () => {
  it("'both': an ebook file edition and a live holding agree", () => {
    assert.equal(ebookAgreement(['ebook_epub'], true), 'both');
    assert.equal(ebookAgreement(['hardcover', 'ebook_pdf'], true), 'both');
  });

  it("'neither': the ordinary physical-only book, agreeing by silence", () => {
    assert.equal(ebookAgreement([], false), 'neither');
    assert.equal(ebookAgreement(['hardcover'], false), 'neither');
  });

  it("'edition_only': the cache is behind — the backfill has not run", () => {
    assert.equal(ebookAgreement(['ebook_epub'], false), 'edition_only');
  });

  it("'holding_only': the phase-5 shape — editions pruned, cache stands", () => {
    assert.equal(ebookAgreement([], true), 'holding_only');
    assert.equal(ebookAgreement(['paperback'], true), 'holding_only');
  });

  it('a kindle licence is NOT an ebook file edition for this comparison', () => {
    // The holding side can never contain kindle (derivation excludes it), so
    // the edition side must not count it either — or every kindle-only book
    // would read 'edition_only' forever, an alarm nobody can clear.
    assert.equal(ebookAgreement(['ebook_kindle'], false), 'neither');
    assert.equal(ebookAgreement(['ebook_kindle'], true), 'holding_only');
  });
});
