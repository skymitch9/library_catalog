/**
 * `lookupWikidataSeries` — the free structured series/volume rung (owner ask,
 * 2026-08-25). Mocks the SPARQL endpoint; the live query shape was verified by
 * hand against query.wikidata.org the same day (Way of Kings -> Stormlight #1).
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { lookupWikidataSeries } from '../src/wikidata.js';

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
