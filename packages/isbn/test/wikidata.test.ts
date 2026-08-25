/**
 * `lookupWikidataSeries` — the free structured series/volume rung (owner ask,
 * 2026-08-25). Mocks the SPARQL endpoint; the live query shape was verified by
 * hand against query.wikidata.org the same day (Way of Kings -> Stormlight #1).
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { WIKIDATA_UA, lookupWikidataSeries } from '../src/wikidata.js';

function sparql(bindings: unknown[]): typeof fetch {
  return (async (_url: string) =>
    new Response(JSON.stringify({ head: { vars: ['seriesLabel', 'ordinal'] }, results: { bindings } }), {
      status: 200,
      headers: { 'content-type': 'application/sparql-results+json' },
    })) as unknown as typeof fetch;
}

describe('lookupWikidataSeries', () => {
  it('parses a series name and ordinal', async () => {
    const got = await lookupWikidataSeries('9780765326355', {
      fetchImpl: sparql([{ seriesLabel: { value: 'The Stormlight Archive' }, ordinal: { value: '1' } }]),
    });
    assert.deepEqual(got, { series: 'The Stormlight Archive', ordinal: 1 });
  });

  it('returns the series with null ordinal when the statement has no P1545 qualifier', async () => {
    const got = await lookupWikidataSeries('9780765326355', {
      fetchImpl: sparql([{ seriesLabel: { value: 'Mistborn' } }]),
    });
    assert.deepEqual(got, { series: 'Mistborn', ordinal: null });
  });

  it('keeps a decimal ordinal (novella at 3.5)', async () => {
    const got = await lookupWikidataSeries('9780000000000', {
      fetchImpl: sparql([{ seriesLabel: { value: 'X' }, ordinal: { value: '3.5' } }]),
    });
    assert.equal(got?.ordinal, 3.5);
  });

  it('is null when nothing matched', async () => {
    assert.equal(await lookupWikidataSeries('9780765326355', { fetchImpl: sparql([]) }), null);
  });

  it('⚠️ rejects a bare Q-id label (the label service failed) rather than shelving it', async () => {
    const got = await lookupWikidataSeries('9780765326355', {
      fetchImpl: sparql([{ seriesLabel: { value: 'Q7766706' }, ordinal: { value: '1' } }]),
    });
    assert.equal(got, null);
  });

  it('does not even call out for a malformed ISBN', async () => {
    let called = false;
    const spy = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    assert.equal(await lookupWikidataSeries('not-an-isbn', { fetchImpl: spy }), null);
    assert.equal(called, false);
  });

  it('throws on an HTTP error so the free ladder can record a skip', async () => {
    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(lookupWikidataSeries('9780765326355', { fetchImpl: bad }), /wikidata 500/);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ F8 — several P179 statements, and the one that is chosen (2026-08-25)
// ---------------------------------------------------------------------------
//
// The query was `LIMIT 1` with no `ORDER BY`. SPARQL result order is
// unspecified without one, and a great many books in this catalogue's shape
// carry TWO `P179` statements — the series and a wider publication sequence.
// `OPTIONAL { ?st pq:P1545 ?ordinal }` compounds it: the statement that won
// could be the one WITHOUT the ordinal while another had both. And because
// `writeFreeValues` only ever writes into a blank, the first arbitrary answer
// is permanent — the same ISBN could file the book differently on two runs and
// only the first would stick.

/** Captures the request so the query text and headers can be read back. */
function spySparql(bindings: unknown[]) {
  const seen: { url: string; headers: Record<string, string> } = { url: '', headers: {} };
  const impl = (async (url: string, init?: RequestInit) => {
    seen.url = String(url);
    seen.headers = (init?.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify({ results: { bindings } }), {
      status: 200,
      headers: { 'content-type': 'application/sparql-results+json' },
    });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

describe('choosing between several P179 statements (F8)', () => {
  it('⚠️ prefers the statement that HAS an ordinal, even when it is not first', async () => {
    const got = await lookupWikidataSeries('9780765326355', {
      // The exact failing shape: a broader sequence with no volume number
      // arrives first, the real series with its ordinal second.
      fetchImpl: sparql([
        { seriesLabel: { value: 'Tor fantasy publication sequence' } },
        { seriesLabel: { value: 'The Stormlight Archive' }, ordinal: { value: '1' } },
      ]),
    });
    assert.deepEqual(got, { series: 'The Stormlight Archive', ordinal: 1 });
  });

  it('falls back to the first named series when none carries an ordinal', async () => {
    const got = await lookupWikidataSeries('9780765326355', {
      fetchImpl: sparql([{ seriesLabel: { value: 'Mistborn' } }, { seriesLabel: { value: 'Other' } }]),
    });
    assert.deepEqual(got, { series: 'Mistborn', ordinal: null });
  });

  it('⚠️ skips a bare Q-id and takes a real one behind it', async () => {
    // A failed label service must not win, and with several statements in hand
    // there may well be a good one behind it. (One Q-id ALONE is still null —
    // that case is pinned above.)
    const got = await lookupWikidataSeries('9780765326355', {
      fetchImpl: sparql([
        { seriesLabel: { value: 'Q7766706' }, ordinal: { value: '9' } },
        { seriesLabel: { value: 'Cradle' }, ordinal: { value: '1' } },
      ]),
    });
    assert.deepEqual(got, { series: 'Cradle', ordinal: 1 });
  });

  it('⚠️ asks for an ORDERED window, not an arbitrary single row', async () => {
    const spy = spySparql([{ seriesLabel: { value: 'X' } }]);
    await lookupWikidataSeries('9780765326355', { fetchImpl: spy.impl });
    const query = decodeURIComponent(spy.seen.url);
    assert.match(query, /ORDER BY DESC\(BOUND\(\?ordinal\)\)/, 'the pick must be deterministic');
    assert.ok(!/LIMIT 1/.test(query), 'LIMIT 1 with no ordering is the arbitrary pick this fixed');
  });

  it('the ISBN really reaches the query — a deleted FILTER must not pass silently', async () => {
    // Named in the review as a test gap: every existing case would still pass
    // if the FILTER that matches the ISBN were removed altogether.
    const spy = spySparql([]);
    await lookupWikidataSeries('9780765326355', { fetchImpl: spy.impl });
    const query = decodeURIComponent(spy.seen.url);
    assert.match(query, /9780765326355/);
    assert.match(query, /REPLACE\(\?isbn, "-", ""\)/, 'Wikidata stores P212 hyphenated');
  });

  it('⚠️ F14: identifies itself with a CONTACT, as the Wikidata policy requires', async () => {
    // A generic UA gets blocked when WDQS throttles, and the block arrives as a
    // thrown `wikidata 403` — a rung permanently skipped, reported as one line.
    const spy = spySparql([]);
    await lookupWikidataSeries('9780765326355', { fetchImpl: spy.impl });
    const ua = spy.seen.headers['User-Agent'] ?? '';
    assert.equal(ua, WIKIDATA_UA);
    assert.match(ua, /@/, 'the policy asks for a contact, not just a name');
  });
});
