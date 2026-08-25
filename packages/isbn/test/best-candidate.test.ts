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

  // -------------------------------------------------------------------------
  // ⚠️ F6 — `undefined` and `null` are DIFFERENT answers about a description
  // -------------------------------------------------------------------------
  //
  // `BookCandidate.description`'s doc comment states the contract: `undefined`
  // means *this rung does not carry descriptions*, `null` means *it does, and
  // this book has none*. The Open Library rung really does build its candidate
  // with no `description` key at all — `olRung()` below reproduces that shape,
  // which `cand()` cannot, because its default of `null` is exactly the value
  // under test.
  //
  // The defect: `pick()` returned `null` when nobody answered, so a lookup that
  // reached only Open Library came back saying "asked, and there is none" — and
  // a consumer branching on `!== undefined` (the pattern free-details.ts uses
  // at three call sites) would stop asking for ever.

  /** A rung that does not carry descriptions — no key at all, as Open Library's does. */
  function olRung(over: Partial<BookCandidate> = {}): BookCandidate {
    const c = cand(over);
    delete c.description;
    return c;
  }

  it('⚠️ leaves description UNDEFINED when no rung could answer it', () => {
    const best = bestCandidate([olRung(), olRung()]);
    assert.ok(best);
    assert.equal(
      best.description,
      undefined,
      'no rung carries descriptions, so the honest answer is "nobody was asked" — not "there is none"',
    );
  });

  it('keeps NULL when a description-capable rung answered and had none', () => {
    // Google Books answered; it simply has no blurb for this book. That IS a
    // statement, and it must not be flattened into "nobody could say".
    const best = bestCandidate([olRung(), cand({ source: 'googlebooks', description: null })]);
    assert.ok(best);
    assert.equal(best.description, null);
  });

  it('still borrows a real blurb when rung 1 cannot carry one at all', () => {
    const best = bestCandidate([olRung(), cand({ source: 'googlebooks', description: 'Dragons.' })]);
    assert.equal(best?.description, 'Dragons.');
  });

  // -------------------------------------------------------------------------
  // ⚠️ F5 — a borrowed field must not wear rung 1's provenance
  // -------------------------------------------------------------------------
  //
  // `source`/`sourceUrl` stay rung 1's, because they are the IDENTITY's
  // provenance. But `publisher='Tor', pages=384, source='openlibrary'` on one
  // row sends an auditor to an Open Library page carrying neither. `borrowed`
  // is what lets a caller that persists provenance stay honest;
  // `routes/gabi-delegated.ts` writes it into the edition's change_log note.

  it('⚠️ names every field it took from a later rung, and the rung it came from', () => {
    const ol = cand({ source: 'openlibrary', sourceUrl: 'https://openlibrary.org/books/OL1M' });
    const gb = cand({ source: 'googlebooks', publisher: 'Tor', pages: 384, description: 'A blurb.' });
    const best = bestCandidate([ol, gb]);
    assert.ok(best);
    assert.equal(best.source, 'openlibrary', 'identity provenance is rung 1 and stays true');
    assert.equal(best.sourceUrl, 'https://openlibrary.org/books/OL1M');
    assert.deepEqual(best.borrowed, {
      publisher: 'googlebooks',
      pages: 'googlebooks',
      description: 'googlebooks',
    });
  });

  it('borrows nothing — and says so — when rung 1 answered everything', () => {
    const ol = cand({ publisher: 'Tor', pages: 384, description: 'A blurb.', coverUrl: 'https://x/c.jpg' });
    const gb = cand({ source: 'googlebooks', publisher: 'Del Rey', pages: 999 });
    assert.deepEqual(bestCandidate([ol, gb])?.borrowed, {});
  });
});
