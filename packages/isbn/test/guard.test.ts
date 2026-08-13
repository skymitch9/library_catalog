/**
 * The one-barcode-one-edition guard.
 *
 * Rule under test — `catalog-platform/docs/info/matching-thresholds.md` §6
 * tier 1, mechanical, no judgement:
 *
 *   - One barcode may create at most one edition and one copy. A lookup
 *     answer carrying more than one distinct ISBN-13 for one scanned barcode
 *     is refused outright, not trimmed to its first entry.
 *   - An Open Library `/works/…` (work-level) record may never be an edition
 *     source. Only edition-level (`/books/…`) records carry a printing's
 *     identity.
 *
 * The failure that wrote the rule: on 2026-08-13 scanned barcodes resolved to
 * work-level aggregates and minted a phantom *Space Knight* (work #302) with
 * six editions carrying six unrelated ISBNs and six copies — plus #300 and
 * #301 the same evening. The six ISBNs used below are the real ones from that
 * incident, straight out of docs/TODO.md.
 *
 * Every fake here goes through `fetchImpl`, which the ladder takes for
 * exactly this purpose. No network.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REFUSED_PREFIX,
  lookupGoogleBooksByIsbn,
  lookupOpenLibraryByIsbn,
  resolveIsbn,
  wasRefused,
} from '../src/resolve.ts';
import { editionsOfWork, workKeyForIsbn } from '../src/works.ts';

/** The six ISBNs the Space Knight phantom hoarded. Real incident data. */
const SPACE_KNIGHT_ISBNS = [
  '9781951641061',
  '9781951641078',
  '9781951641085',
  '9781951641139',
  '9781951641696',
  '9781951641719',
];

/** A Response-shaped fake carrying a JSON body. Only what the ladder reads. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () => jsonResponse(body, status)) as unknown as typeof fetch;
}

/** One well-formed, single-printing Open Library `/api/books` record. */
function olEditionRecord(isbn13: string, extra: Record<string, unknown> = {}) {
  return {
    [`ISBN:${isbn13}`]: {
      title: 'Space Knight Book 1',
      authors: [{ name: 'Michael-Scott Earle' }],
      publishers: [{ name: 'Orenda' }],
      publish_date: '2020',
      number_of_pages: 300,
      url: `https://openlibrary.org/books/OL99999M/Space_Knight_Book_1`,
      identifiers: { isbn_13: [isbn13], openlibrary: ['OL99999M'] },
      ...extra,
    },
  };
}

describe('one-barcode-one-edition: the Open Library ISBN rung', () => {
  it('passes a clean single-printing record through unchanged', async () => {
    const isbn = SPACE_KNIGHT_ISBNS[0]!;
    const got = await lookupOpenLibraryByIsbn(isbn, {
      fetchImpl: fetchReturning(olEditionRecord(isbn)),
    });
    assert.equal(got.length, 1);
    assert.equal(got[0]!.isbn13, isbn);
    assert.equal(got[0]!.title, 'Space Knight Book 1');
  });

  it('REFUSES an answer carrying several distinct ISBN-13s — the Space Knight shape', async () => {
    const isbn = SPACE_KNIGHT_ISBNS[0]!;
    const body = olEditionRecord(isbn, {
      title: 'Space Knight',
      identifiers: { isbn_13: SPACE_KNIGHT_ISBNS, openlibrary: ['OL99999M'] },
    });
    await assert.rejects(
      () => lookupOpenLibraryByIsbn(isbn, { fetchImpl: fetchReturning(body) }),
      (err: Error) => err.message.startsWith(REFUSED_PREFIX) && /6 distinct/.test(err.message),
    );
  });

  it('REFUSES a work-level record outright — never an edition source', async () => {
    const isbn = SPACE_KNIGHT_ISBNS[0]!;
    const body = olEditionRecord(isbn, {
      title: 'Space Knight',
      url: 'https://openlibrary.org/works/OL12345W/Space_Knight',
      identifiers: { isbn_13: [isbn], openlibrary: ['OL12345W'] },
    });
    await assert.rejects(
      () => lookupOpenLibraryByIsbn(isbn, { fetchImpl: fetchReturning(body) }),
      (err: Error) => err.message.startsWith(REFUSED_PREFIX) && /work-level/.test(err.message),
    );
  });

  it('does not refuse over hyphenation — one ISBN spelled two ways is one ISBN', async () => {
    const isbn = '9781638493457';
    const body = olEditionRecord(isbn, {
      title: 'He Who Fights with Monsters',
      identifiers: { isbn_13: ['978-1-63849-345-7', isbn], openlibrary: ['OL88888M'] },
    });
    const got = await lookupOpenLibraryByIsbn(isbn, { fetchImpl: fetchReturning(body) });
    assert.equal(got.length, 1);
  });
});

describe('one-barcode-one-edition: the Google Books rung', () => {
  const gbVolume = (identifiers: { type: string; identifier: string }[]) => ({
    items: [
      {
        volumeInfo: {
          title: 'Space Knight Book 1',
          authors: ['Michael-Scott Earle'],
          industryIdentifiers: identifiers,
        },
      },
    ],
  });

  it('passes one ISBN-13 beside its ISBN-10 — the ordinary record', async () => {
    const got = await lookupGoogleBooksByIsbn(SPACE_KNIGHT_ISBNS[0]!, {
      googleBooksKey: 'k',
      fetchImpl: fetchReturning(
        gbVolume([
          { type: 'ISBN_13', identifier: SPACE_KNIGHT_ISBNS[0]! },
          { type: 'ISBN_10', identifier: '1951641061' },
        ]),
      ),
    });
    assert.equal(got.length, 1);
  });

  it('REFUSES several distinct ISBN-13s in one answer', async () => {
    await assert.rejects(
      () =>
        lookupGoogleBooksByIsbn(SPACE_KNIGHT_ISBNS[0]!, {
          googleBooksKey: 'k',
          fetchImpl: fetchReturning(
            gbVolume([
              { type: 'ISBN_13', identifier: SPACE_KNIGHT_ISBNS[0]! },
              { type: 'ISBN_13', identifier: SPACE_KNIGHT_ISBNS[1]! },
            ]),
          ),
        }),
      (err: Error) => err.message.startsWith(REFUSED_PREFIX),
    );
  });
});

describe('one-barcode-one-edition: the ladder degrades, the trace says why', () => {
  it('a refused rung answers nothing, lands in the trace, and does not block rung 2', async () => {
    const isbn = SPACE_KNIGHT_ISBNS[0]!;
    // Rung 1 answers the aggregate; rung 2 answers a clean printing.
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('openlibrary.org')) {
        return jsonResponse(
          olEditionRecord(isbn, {
            title: 'Space Knight',
            identifiers: { isbn_13: SPACE_KNIGHT_ISBNS, openlibrary: ['OL99999M'] },
          }),
        );
      }
      return jsonResponse({
        items: [
          {
            volumeInfo: {
              title: 'Space Knight Book 1',
              industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
            },
          },
        ],
      });
    }) as unknown as typeof fetch;

    const { candidates, trace } = await resolveIsbn(isbn, {
      googleBooksKey: 'k',
      fetchImpl,
    });
    // The aggregate was refused, not trimmed to its first entry…
    assert.equal(wasRefused(trace), true);
    assert.ok(trace.find((t) => t.rung === 'openlibrary')!.detail!.startsWith(REFUSED_PREFIX));
    // …and the clean answer from the other rung still arrived: exactly one.
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.source, 'googlebooks');
  });

  it('wasRefused is false when a rung merely has nothing', async () => {
    const { candidates, trace } = await resolveIsbn('9780000000000', {
      fetchImpl: fetchReturning({}),
    });
    assert.equal(candidates.length, 0);
    assert.equal(wasRefused(trace), false);
  });
});

describe('one-barcode-one-edition: /works/ records never become editions', () => {
  it('workKeyForIsbn landing on a work record keeps the key and refuses the edition', async () => {
    // redirect: 'follow' can land /isbn/{n}.json on a work document.
    const got = await workKeyForIsbn(SPACE_KNIGHT_ISBNS[0]!, {
      fetchImpl: fetchReturning({
        key: '/works/OL12345W',
        title: 'Space Knight',
        authors: [{ key: '/authors/OL23919A' }],
      }),
    });
    assert.ok(got);
    assert.equal(got!.workKey, 'OL12345W');
    assert.equal(got!.editionKey, null);
    assert.equal(got!.edition, null);
    assert.deepEqual(got!.authorKeys, ['OL23919A']);
  });

  it('workKeyForIsbn on a real edition record still answers in full', async () => {
    const got = await workKeyForIsbn(SPACE_KNIGHT_ISBNS[0]!, {
      fetchImpl: fetchReturning({
        key: '/books/OL99999M',
        title: 'Space Knight Book 1',
        works: [{ key: '/works/OL12345W' }],
        isbn_13: [SPACE_KNIGHT_ISBNS[0]!],
        publish_date: '2020',
      }),
    });
    assert.ok(got);
    assert.equal(got!.workKey, 'OL12345W');
    assert.equal(got!.editionKey, 'OL99999M');
    assert.ok(got!.edition);
    assert.equal(got!.edition!.year, 2020);
  });

  it('editionsOfWork drops any /works/ entry rather than mapping it', async () => {
    const got = await editionsOfWork('OL12345W', {
      fetchImpl: fetchReturning({
        entries: [
          { key: '/books/OL99999M', title: 'Space Knight Book 1', isbn_13: [SPACE_KNIGHT_ISBNS[0]!] },
          { key: '/works/OL12345W', title: 'Space Knight' },
        ],
      }),
    });
    assert.equal(got.length, 1);
    assert.equal(got[0]!.key, '/books/OL99999M');
  });
});
