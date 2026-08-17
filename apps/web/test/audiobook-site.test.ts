/**
 * The two ports in `lib/audiobook-site.ts` are byte-for-byte mirrors of the
 * sibling audiobook site's own code (`site/covers-base.js` `coverUrl()`,
 * `site/index.html` `_parseHash`). If either drifts, nothing throws — a cover
 * 503s at the CDN, or a link lands on an empty search box. These tests pin the
 * exact behaviours the sibling site was measured to have, so a drift fails a
 * test instead of a click.
 *
 * ⚠️ The deep-link shape is a HASH SEARCH, not a per-book route. The audiobook
 * site has no per-book URL; its only book anchor is `#q=<title>` read with
 * `URLSearchParams` (`_parseHash`) and applied as a search. The round-trip
 * tests below therefore decode exactly the way the site itself does — that IS
 * the contract, not an approximation of one.
 *
 * Lives in `apps/web/test/` (outside the app tsconfig's `include`, like
 * `packages/core/test/`) so `npm test` runs it via tsx without dragging
 * node types into the DOM-typed app build.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { audiobookDetailUrl, resolveAudiobookCover } from '../src/lib/audiobook-site.ts';

/** Decode a link the way the audiobook site's `_parseHash` does. */
function parseHashLikeTheSite(url: string): string {
  const hash = url.split('#')[1] ?? '';
  return new URLSearchParams(hash).get('q') ?? '';
}

describe('audiobookDetailUrl — the hash-search deep link', () => {
  it('points at the audiobook site with the title as #q=', () => {
    assert.equal(
      audiobookDetailUrl('Dungeon Crawler Carl'),
      'https://audiobooks.heygabi.ai/#q=Dungeon+Crawler+Carl',
    );
  });

  it('spaces become + (urlencode), matching the site writer _writeHash', () => {
    const url = audiobookDetailUrl('Harry Potter and the Chamber of Secrets');
    assert.ok(url.includes('q=Harry+Potter+and+the+Chamber+of+Secrets'));
    assert.ok(!url.includes('%20'), 'URLSearchParams writes +, never %20');
  });

  it('round-trips through the site parser for hostile titles', () => {
    // '#' would truncate the hash and '&' would start a second param if either
    // escaped encoding; '%' and '+' must survive a decode.
    const nasty = 'Tress & the Emerald Sea: #1 (100% + change)';
    assert.equal(parseHashLikeTheSite(audiobookDetailUrl(nasty)), nasty);
  });

  it('round-trips curly quotes and unicode', () => {
    const title = 'The Hitchhiker’s Guide — édition';
    assert.equal(parseHashLikeTheSite(audiobookDetailUrl(title)), title);
  });
});

describe('resolveAudiobookCover — the sibling bucket port', () => {
  it('nothing in, null out', () => {
    assert.equal(resolveAudiobookCover(null), null);
    assert.equal(resolveAudiobookCover(''), null);
    assert.equal(resolveAudiobookCover('   '), null);
  });

  it('absolute, protocol-relative and data: hrefs pass through untouched', () => {
    assert.equal(
      resolveAudiobookCover('https://elsewhere.example/x.jpg'),
      'https://elsewhere.example/x.jpg',
    );
    assert.equal(resolveAudiobookCover('//cdn.example/x.jpg'), '//cdn.example/x.jpg');
    assert.equal(resolveAudiobookCover('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
  });

  it("resolves against the SIBLING's bucket, covers.heygabi.ai — not this catalog's", () => {
    const url = resolveAudiobookCover('covers/Ariel Kaplan/The Pomegranate Gate.jpg');
    assert.equal(url, 'https://covers.heygabi.ai/Ariel%20Kaplan/The%20Pomegranate%20Gate.jpg');
    assert.ok(!String(url).includes('bookcovers.heygabi.ai'), 'bookcovers.* is the LIBRARY bucket');
  });

  it("percent-encodes !'()* like Python's quote(), not encodeURIComponent", () => {
    const url = resolveAudiobookCover("covers/A/It's (Not) Over! *now*.jpg");
    assert.equal(
      url,
      'https://covers.heygabi.ai/A/It%27s%20%28Not%29%20Over%21%20%2Anow%2A.jpg',
    );
  });

  it('never double-encodes an already-encoded historic href (the CDN-503 case)', () => {
    assert.equal(
      resolveAudiobookCover('covers/J.k.%20Rowling/Harry%20Potter.jpg'),
      'https://covers.heygabi.ai/J.k.%20Rowling/Harry%20Potter.jpg',
    );
  });

  it("a literal % that is not an escape is left raw, then encoded once — the site's own rule", () => {
    assert.equal(
      resolveAudiobookCover('covers/100% Wolf.jpg'),
      'https://covers.heygabi.ai/100%25%20Wolf.jpg',
    );
  });

  it('an href without the covers/ prefix and with leading slashes still resolves', () => {
    assert.equal(resolveAudiobookCover('foo/bar.jpg'), 'https://covers.heygabi.ai/foo/bar.jpg');
    assert.equal(resolveAudiobookCover('/foo.jpg'), 'https://covers.heygabi.ai/foo.jpg');
  });
});
