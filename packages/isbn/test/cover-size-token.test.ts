/**
 * 🔴 **A cover can be the RIGHT book and still be useless — 50 pixels wide.**
 *
 * The failure, measured 2026-08-23 21:40 Phoenix on padhard **199 *Foxy
 * Tales***: the paid cover rung proposed, at HIGH confidence, the correct
 * jacket for the correct book, and what got stored was a smudge.
 *
 * | URL | Bytes (measured) |
 * |---|---|
 * | `…222114404._SX50_.jpg` (stored) | **1,980** |
 * | `…222114404._SY475_.jpg` | 34,579 |
 * | `…222114404.jpg` (no token) | **255,373** |
 *
 * ⚠️ **Every guard this catalog owns passes the 1,980-byte form, and each of
 * them is right to.** `MIN_COVER_BYTES` is a floor (1,000);
 * `check-cover-health.mjs` uses the same floor; the KI-6 hash audit passes it
 * because the hash is genuinely distinct — it is a real, unique, correct, tiny
 * image. `docs/TODO.md`: *"Only looking at it works, again."*
 *
 * So the fix is not a fourth floor. It is to stop asking for the small one:
 * `fullSizeCoverUrl` strips the size token, `verifyCoverUrl` fetches THAT, and
 * `CoverCheck.url` reports which address the bytes came from so the write paths
 * store the image they actually fetched.
 *
 * ## ⚠️ What this file does NOT verify
 *
 * Nothing here touches the network — the byte counts above are the 2026-08-23
 * measurement, replayed through `fetchImpl`. That Goodreads still serves the
 * tokenless form of every id it serves a tokenised form of is an assumption the
 * host allowlist rests on, and it is not re-measured by a unit test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fullSizeCoverUrl } from '@lc/core';
import { verifyCoverUrl } from '../src/resolve.ts';

/** The three real URLs from `docs/TODO.md`'s byte table, and their real sizes. */
const GR = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1738511384l/222114404';
const SIZES: Record<string, number> = {
  [`${GR}._SX50_.jpg`]: 1_980,
  [`${GR}._SY475_.jpg`]: 34_579,
  [`${GR}.jpg`]: 255_373,
};

/** Serves the measured byte counts; 404 for anything not in the table. */
function goodreadsFetch(known: Record<string, number> = SIZES) {
  const asked: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const bytes = known[url];
    if (bytes === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  }) as unknown as typeof fetch;
  return { impl, asked };
}

describe('fullSizeCoverUrl — the pure rule', () => {
  it('strips the token that stored 50 pixels onto padhard #199', () => {
    assert.equal(fullSizeCoverUrl(`${GR}._SX50_.jpg`), `${GR}.jpg`);
  });

  it('strips the other two shapes docs/TODO.md names', () => {
    assert.equal(fullSizeCoverUrl(`${GR}._SY475_.jpg`), `${GR}.jpg`);
    assert.equal(fullSizeCoverUrl(`${GR}._UY218_.jpg`), `${GR}.jpg`);
  });

  it('strips Amazon’s stacked and comma forms', () => {
    const amz = 'https://m.media-amazon.com/images/I/51abcDEFgh';
    assert.equal(fullSizeCoverUrl(`${amz}._SY445_SX342_.jpg`), `${amz}.jpg`);
    assert.equal(fullSizeCoverUrl(`${amz}._UY218_SR178,218_.jpg`), `${amz}.jpg`);
    assert.equal(fullSizeCoverUrl(`${amz}._SL500_.jpg`), `${amz}.jpg`);
  });

  it('returns null — not the input — when there is nothing to do', () => {
    // ⚠️ Null so a caller cannot mistake "unchanged" for "upgraded".
    assert.equal(fullSizeCoverUrl(`${GR}.jpg`), null);
    assert.equal(fullSizeCoverUrl('https://m.media-amazon.com/images/I/51abc._AC_.jpg'), null);
  });

  it('leaves every other host alone, token or not', () => {
    // ⚠️ On a host that is not Amazon's image service, `._SX50_` is just part of
    // a filename and deleting it is a 404 waiting to happen.
    assert.equal(fullSizeCoverUrl('https://covers.openlibrary.org/b/id/12345-L.jpg'), null);
    assert.equal(fullSizeCoverUrl('https://example.com/pic._SX50_.jpg'), null);
    assert.equal(fullSizeCoverUrl('https://books.google.com/books/content?id=x&zoom=1'), null);
  });

  it('does not throw on something that is not a URL', () => {
    assert.equal(fullSizeCoverUrl('covers/local-file.jpg'), null);
    assert.equal(fullSizeCoverUrl(''), null);
  });
});

describe('verifyCoverUrl — the 50-pixel cover is upgraded, not stored', () => {
  it('fetches the tokenless form and reports 255,373 bytes, not 1,980', async () => {
    // 🔴 THE REPRODUCTION. Before 2026-09-07 this returned `{ok: true, bytes:
    // 1980}` and the caller stored `._SX50_` — every check green, cover useless.
    const { impl, asked } = goodreadsFetch();
    const check = await verifyCoverUrl(`${GR}._SX50_.jpg`, { fetchImpl: impl });
    assert.equal(check.ok, true);
    assert.equal(check.bytes, 255_373);
    assert.equal(check.url, `${GR}.jpg`, 'the URL to STORE is the one fetched');
    assert.deepEqual(asked, [`${GR}.jpg`], 'one fetch, of the full-size form');
  });

  it('falls back to the thumbnail when the full-size form does not answer', async () => {
    // A small cover beats none. Two subrequests, and only on this narrow match.
    const { impl, asked } = goodreadsFetch({ [`${GR}._SX50_.jpg`]: 1_980 });
    const check = await verifyCoverUrl(`${GR}._SX50_.jpg`, { fetchImpl: impl });
    assert.equal(check.ok, true);
    assert.equal(check.bytes, 1_980);
    assert.equal(check.url, `${GR}._SX50_.jpg`);
    assert.deepEqual(asked, [`${GR}.jpg`, `${GR}._SX50_.jpg`]);
  });

  it('costs no extra fetch when there is no token to strip', async () => {
    const { impl, asked } = goodreadsFetch();
    const check = await verifyCoverUrl(`${GR}.jpg`, { fetchImpl: impl });
    assert.equal(check.ok, true);
    assert.equal(check.url, `${GR}.jpg`);
    assert.equal(asked.length, 1);
  });

  it('still refuses the Open Library placeholder, and still asks default=false', async () => {
    // The two older defences are untouched by the third.
    const asked: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(new Uint8Array(43), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as unknown as typeof fetch;
    const url = 'https://covers.openlibrary.org/b/isbn/9781454965435-L.jpg';
    const check = await verifyCoverUrl(url, { fetchImpl: impl });
    assert.equal(check.ok, false);
    assert.match(check.reason ?? '', /43 bytes/);
    assert.equal(check.url, url, 'the reported URL carries no ?default=false');
    assert.match(asked[0] ?? '', /default=false/);
  });

  it('reports the URL on every failure shape, so a log can name it', async () => {
    const impl = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const check = await verifyCoverUrl('https://example.com/nope.jpg', { fetchImpl: impl });
    assert.equal(check.ok, false);
    assert.equal(check.url, 'https://example.com/nope.jpg');
  });
});
