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

import { lookupHardcover } from '../src/hardcover.js';

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
    assert.deepEqual(got, {
      description: null,
      series: 'The Stormlight Archive',
      position: 2,
    });
  });

  it('is null for a series-less, blurb-less book rather than inventing values', async () => {
    const { impl } = graphql(edition({ description: '   ', book_series: [] }));
    const got = await lookupHardcover('9780765350374', { token: 't', fetchImpl: impl });
    assert.deepEqual(got, { description: null, series: null, position: null });
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
});
