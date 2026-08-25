/**
 * `lookupHardcover` — the free rung that answers description + series + volume
 * in one call (owner ask, 2026-08-25).
 *
 * ⚠️ **Every call here is MOCKED and the live API has never been exercised from
 * this repo.** The field names were confirmed against the published SDL
 * (`hardcoverapp/hardcover-docs@main/schema.graphql`, read 2026-08-25:
 * `editions.isbn_13`, `editions.book`, `books.description`, `books.book_series`,
 * `book_series.position` (`float8`), `book_series.series.name`) — so the SHAPE
 * is verified against the vendor's own schema, but nothing here is evidence
 * that a real token gets a real answer.
 *
 * The request assertions are the load-bearing ones: the ISBN must travel as a
 * GraphQL **variable**, not concatenated into the query document.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { lookupHardcover, pickSeries, type HardcoverSeriesEntry } from '../src/hardcover.js';

/** Captures the one request, and answers with `body`. */
function graphql(body: unknown, status = 200) {
  const seen: { url?: string; init?: RequestInit } = {};
  const impl = (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

/** One edition, one book, as the schema declares it. */
function edition(book: unknown) {
  return { data: { editions: [{ book }] } };
}

describe('lookupHardcover', () => {
  it('POSTs to the GraphQL endpoint with a Bearer token, and passes the ISBN as a VARIABLE', async () => {
    const { impl, seen } = graphql(edition({ description: 'x', book_series: [] }));
    await lookupHardcover('978-0-7653-5037-4', { token: 'tok', fetchImpl: impl });

    assert.equal(seen.url, 'https://api.hardcover.app/v1/graphql');
    assert.equal(seen.init?.method, 'POST');
    const headers = seen.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer tok');
    assert.equal(headers['content-type'], 'application/json');

    const sent = JSON.parse(String(seen.init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    // ⚠️ The whole point: the digits are in `variables`, and the query document
    // does NOT contain them. A concatenated `where` clause would fail here.
    assert.deepEqual(sent.variables, { isbn: '9780765350374' });
    assert.equal(
      sent.query.includes('9780765350374'),
      false,
      'the ISBN must never be interpolated into the query text',
    );
    assert.match(sent.query, /\$isbn: String!/);
    assert.match(sent.query, /isbn_13: \{_eq: \$isbn\}/);
  });

  it('parses description, series name and position', async () => {
    const { impl } = graphql(
      edition({
        description: '  The capital of Arelon.  ',
        book_series: [{ position: 1, series: { name: 'Elantris' } }],
      }),
    );
    const got = await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl });
    assert.deepEqual(got, {
      description: 'The capital of Arelon.',
      series: 'Elantris',
      position: 1,
      seriesEntries: [{ name: 'Elantris', position: 1, booksCount: null }],
      universesDropped: [],
    });
  });

  it('keeps a DECIMAL position — `float8`, so a 1.5 novella is a real answer', async () => {
    const { impl } = graphql(
      edition({ description: null, book_series: [{ position: 1.5, series: { name: 'Cradle' } }] }),
    );
    const got = await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl });
    assert.equal(got?.position, 1.5);
    assert.equal(got?.description, null, 'an absent blurb is null, not an empty string');
  });

  it('reads a position that arrives as a numeric STRING (float8 serialisation)', async () => {
    const { impl } = graphql(
      edition({ description: null, book_series: [{ position: '3.5', series: { name: 'Cradle' } }] }),
    );
    const got = await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl });
    assert.equal(got?.position, 3.5);
  });

  it('takes the first book_series row that actually NAMES a series', async () => {
    const { impl } = graphql(
      edition({
        description: null,
        book_series: [
          { position: 9, series: null },
          { position: 2, series: { name: 'The Stormlight Archive' } },
        ],
      }),
    );
    const got = await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl });
    assert.equal(got?.series, 'The Stormlight Archive');
    assert.equal(got?.position, 2);
    assert.equal(got?.description, null);
    // The unnamed row never becomes an entry at all — `series.name` is `String!`,
    // so a row with a null `series` carries no name to read.
    assert.deepEqual(got?.seriesEntries, [
      { name: 'The Stormlight Archive', position: 2, booksCount: null },
    ]);
    assert.deepEqual(got?.universesDropped, []);
  });

  it('is null for a series-less, blurb-less book rather than inventing values', async () => {
    const { impl } = graphql(edition({ description: '   ', book_series: [] }));
    const got = await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl });
    assert.deepEqual(got, {
      description: null,
      series: null,
      position: null,
      seriesEntries: [],
      universesDropped: [],
    });
  });

  it('is null when no edition carries that ISBN', async () => {
    const { impl } = graphql({ data: { editions: [] } });
    assert.equal(await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl }), null);
  });

  it('throws on an HTTP error so the free ladder can record a named skip', async () => {
    const { impl } = graphql({ error: 'An unknown error occurred' }, 500);
    await assert.rejects(
      lookupHardcover('9780765350374', { token: 't', fetchImpl: impl }),
      /hardcover 500/,
    );
  });

  it('⚠️ throws on a GraphQL `errors` array served with HTTP 200, rather than reading it as "no match"', async () => {
    const { impl } = graphql({ errors: [{ message: 'field "book_series" not found' }] });
    await assert.rejects(
      lookupHardcover('9780765350374', { token: 't', fetchImpl: impl }),
      /hardcover graphql: field "book_series" not found/,
    );
  });

  it('does not even call out for a malformed ISBN', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    assert.equal(await lookupHardcover('not-an-isbn', { token: 't', fetchImpl: spy }), null);
    assert.equal(called, false);
  });

  it('asks for `series.books_count` — the tie-break `pickSeries` needs', async () => {
    const { impl, seen } = graphql(edition({ description: null, book_series: [] }));
    await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl });
    const sent = JSON.parse(String(seen.init?.body)) as { query: string };
    // `series.books_count: Int!`, re-read from the published SDL 2026-08-25.
    assert.match(sent.query, /books_count/);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ A UNIVERSE must never land in `work.series`
// ---------------------------------------------------------------------------

/**
 * The live shape that found the bug: ISBN 9780765326355, *The Way of Kings*,
 * 2026-08-25. Hardcover files the universe as a series row exactly like the
 * series, so taking the first named row made ROW ORDER decide which tier got
 * written.
 *
 * ⚠️ The predicate here is a hand-written stub, not `@lc/universes`. That is
 * deliberate: `@lc/isbn` must not depend on the package that reads a file
 * generated from another checkout, and the point of `pickSeries` is that the
 * DECISION is testable without the list. The Worker's end of the wiring — that
 * the real fold is passed, and that a dropped universe becomes a named skip —
 * is covered in `apps/worker/src/lib/free-details.test.ts`.
 */
const isCosmere = (name: string) =>
  ['the cosmere', 'cosmere', 'runnerverse'].includes(name.trim().toLowerCase());

/** `book_series` rows as Hardcover serialises them. */
function seriesRow(name: string, position: number | null, booksCount: number | null) {
  return { position, series: { name, books_count: booksCount } };
}

describe('pickSeries', () => {
  const entry = (name: string, booksCount: number | null): HardcoverSeriesEntry => ({
    name,
    position: null,
    booksCount,
  });

  it('drops a universe and keeps the series', () => {
    const got = pickSeries(
      [entry('The Stormlight Archive', 10), entry('The Cosmere', 40)],
      isCosmere,
    );
    assert.equal(got.chosen?.name, 'The Stormlight Archive');
    assert.deepEqual(got.universesDropped, ['The Cosmere']);
  });

  it('drops a universe listed FIRST — row order must not decide the tier', () => {
    const got = pickSeries(
      [entry('The Cosmere', 40), entry('The Stormlight Archive', 10)],
      isCosmere,
    );
    assert.equal(got.chosen?.name, 'The Stormlight Archive');
  });

  it('prefers the SMALLEST books_count among genuine series', () => {
    const got = pickSeries([entry('Big Omnibus Grouping', 30), entry('Main Sequence', 4)]);
    assert.equal(got.chosen?.name, 'Main Sequence');
  });

  it('breaks a books_count tie with the FIRST row, so the answer is stable', () => {
    const got = pickSeries([entry('First', 7), entry('Second', 7)]);
    assert.equal(got.chosen?.name, 'First');
  });

  it('⚠️ sorts an UNKNOWN books_count LAST — absence is not evidence of a small set', () => {
    assert.equal(pickSeries([entry('Unknown', null), entry('Known', 9)]).chosen?.name, 'Known');
    // …but it still wins when it is all there is.
    assert.equal(pickSeries([entry('Unknown', null)]).chosen?.name, 'Unknown');
  });

  it('⚠️ answers NO SERIES when every entry is a universe, and says which were dropped', () => {
    const got = pickSeries([entry('The Cosmere', 40), entry('Runnerverse', 22)], isCosmere);
    assert.equal(got.chosen, null);
    assert.deepEqual(got.universesDropped, ['The Cosmere', 'Runnerverse']);
  });

  it('drops nothing when no predicate is given — the honest default', () => {
    const got = pickSeries([entry('The Cosmere', 40)]);
    assert.equal(got.chosen?.name, 'The Cosmere');
    assert.deepEqual(got.universesDropped, []);
  });

  it('is empty in, empty out', () => {
    assert.deepEqual(pickSeries([], isCosmere), { chosen: null, universesDropped: [] });
  });
});

describe('lookupHardcover + the universe predicate', () => {
  it('⚠️ The Way of Kings: Stormlight is written, The Cosmere is dropped', async () => {
    const { impl } = graphql(
      edition({
        description: null,
        book_series: [
          seriesRow('The Stormlight Archive', 1, 10),
          seriesRow('The Cosmere', 7, 40),
        ],
      }),
    );
    const got = await lookupHardcover('9780765326355', {
      token: 't',
      fetchImpl: impl,
      isUniverseName: isCosmere,
    });

    assert.equal(got?.series, 'The Stormlight Archive');
    assert.equal(got?.position, 1, 'the POSITION travels with the chosen entry, not the first row');
    assert.deepEqual(got?.universesDropped, ['The Cosmere']);
    // Both are still reported, so a caller can say what it declined.
    assert.equal(got?.seriesEntries.length, 2);
  });

  it('⚠️ the same book with The Cosmere listed FIRST still writes Stormlight', async () => {
    const { impl } = graphql(
      edition({
        description: null,
        book_series: [seriesRow('The Cosmere', 7, 40), seriesRow('The Stormlight Archive', 1, 10)],
      }),
    );
    const got = await lookupHardcover('9780765326355', {
      token: 't',
      fetchImpl: impl,
      isUniverseName: isCosmere,
    });
    assert.equal(got?.series, 'The Stormlight Archive');
    assert.equal(got?.position, 1);
  });

  it('answers a null series when ONLY a universe was named', async () => {
    const { impl } = graphql(
      edition({ description: 'A blurb.', book_series: [seriesRow('The Cosmere', 7, 40)] }),
    );
    const got = await lookupHardcover('9780765326355', {
      token: 't',
      fetchImpl: impl,
      isUniverseName: isCosmere,
    });
    assert.equal(got?.series, null);
    assert.equal(got?.position, null);
    assert.deepEqual(got?.universesDropped, ['The Cosmere']);
    assert.equal(got?.description, 'A blurb.', 'the blurb is still a real answer');
  });

  it('prefers the smaller series over a bigger one that is not on any universe list', async () => {
    const { impl } = graphql(
      edition({
        description: null,
        book_series: [seriesRow('An Omnibus Grouping', 3, 55), seriesRow('Cradle', 3, 12)],
      }),
    );
    const got = await lookupHardcover('9780765326355', { token: 't', fetchImpl: impl });
    assert.equal(got?.series, 'Cradle');
    assert.equal(got?.position, 3);
  });

  it('reads a books_count that arrives as a numeric STRING', async () => {
    const { impl } = graphql(
      edition({
        description: null,
        book_series: [
          { position: 1, series: { name: 'Bigger', books_count: '40' } },
          { position: 2, series: { name: 'Smaller', books_count: '4' } },
        ],
      }),
    );
    const got = await lookupHardcover('9780765326355', { token: 't', fetchImpl: impl });
    assert.equal(got?.series, 'Smaller');
  });
});
