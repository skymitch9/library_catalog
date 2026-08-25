/**
 * `bestCandidate` / `descriptionFrom` — the fix for descriptions falling through
 * to the paid LLM on scan (owner, 2026-08-25).
 *
 * Open Library (rung 1) answers with title/author but NO description; Google
 * Books (rung 2, keyed) has one. Every consumer took `candidates[0]` whole and
 * borrowed only the cover — discarding Google's blurb. `bestCandidate` keeps
 * rung-1 identity and coalesces the supplementary fields across rungs.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { bestCandidate, descriptionFrom, type BookCandidate } from '../src/index.js';

function cand(over: Partial<BookCandidate>): BookCandidate {
  return {
    isbn13: '9780000000000',
    title: 'X',
    authors: 'A',
    publisher: null,
    publishedYear: null,
    pages: null,
    language: null,
    coverUrl: null,
    openlibraryWorkId: null,
    format: null,
    source: 'openlibrary',
    sourceUrl: null,
    description: null,
    ...over,
  };
}

describe('descriptionFrom', () => {
  it('returns the first non-empty description in rung order', () => {
    assert.equal(
      descriptionFrom([cand({ description: null }), cand({ description: 'a blurb' })]),
      'a blurb',
    );
  });
  it('is null when nobody has one', () => {
    assert.equal(descriptionFrom([cand({}), cand({})]), null);
  });
});

describe('bestCandidate', () => {
  it('keeps rung-1 identity but borrows the description from a later rung', () => {
    const ol = cand({ source: 'openlibrary', title: 'Fourth Wing', authors: 'Rebecca Yarros', description: null });
    const gb = cand({ source: 'googlebooks', title: 'FOURTH WING (google)', authors: 'R. Yarros', description: 'Dragons and war college.' });
    const best = bestCandidate([ol, gb]);
    assert.ok(best);
    // identity from rung 1
    assert.equal(best.title, 'Fourth Wing');
    assert.equal(best.authors, 'Rebecca Yarros');
    assert.equal(best.source, 'openlibrary');
    // supplementary borrowed from rung 2
    assert.equal(best.description, 'Dragons and war college.');
  });

  it('borrows cover, year, pages, publisher, language when rung 1 lacks them', () => {
    const ol = cand({ coverUrl: null, publishedYear: null, pages: null, publisher: null, language: null });
    const gb = cand({
      coverUrl: 'https://x/c.jpg', publishedYear: 2023, pages: 500, publisher: 'Red Tower', language: 'en',
    });
    const best = bestCandidate([ol, gb]);
    assert.ok(best);
    assert.equal(best.coverUrl, 'https://x/c.jpg');
    assert.equal(best.publishedYear, 2023);
    assert.equal(best.pages, 500);
    assert.equal(best.publisher, 'Red Tower');
    assert.equal(best.language, 'en');
  });

  it('does not overwrite a value rung 1 already has', () => {
    const ol = cand({ description: 'OL blurb', publishedYear: 2020 });
    const gb = cand({ description: 'GB blurb', publishedYear: 2099 });
    const best = bestCandidate([ol, gb]);
    assert.equal(best?.description, 'OL blurb');
    assert.equal(best?.publishedYear, 2020);
  });

  it('is undefined for an empty candidate list', () => {
    assert.equal(bestCandidate([]), undefined);
  });
});
