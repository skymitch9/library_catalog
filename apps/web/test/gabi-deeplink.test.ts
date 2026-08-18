/**
 * The GABI panel's `?gabi=` deep link.
 *
 * These pin the contract the Discord side has to match — `panelDeepLink()` in
 * `catalog-platform/apps/discord-worker/src/gabi.ts`, which today emits a bare
 * `/` with no question at all.
 *
 * ⚠️ THE FIRST TEST IS THE IMPORTANT ONE, and it is a REGRESSION GUARD, not a
 * tautology: it asserts that `?q=` does NOT prefill the panel. The design
 * (`docs/info/gabi-fixer-design.md` §10.2) named `q`, written before anybody
 * measured this app's router — and `q` is already the collection's own
 * server-side search on `/`, the exact route the deep link points at
 * (`router.tsx` `parseCollection`), and the series list's search as well. One
 * value doing both jobs would filter the book list to a sentence no title
 * matches, so a working link would look like a broken catalogue. If somebody
 * later "fixes" this module back to the parameter the doc names, this fails.
 *
 * Lives in `apps/web/test/` (outside the app tsconfig's `include`, like
 * `packages/core/test/`) so `npm test` runs it via tsx without dragging node
 * types into the DOM-typed app build — hence a DOM-free module under test.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GABI_PREFILL_MAX,
  GABI_PREFILL_PARAM,
  gabiPrefillFrom,
  searchWithoutGabiPrefill,
} from '../src/lib/gabi-deeplink.ts';

describe('gabiPrefillFrom — which parameter carries the question', () => {
  it('⚠️ `q` is NOT the panel parameter — it is the collection search', () => {
    assert.equal(gabiPrefillFrom('?q=the+Sanderson+one+with+the+wrong+cover'), null);
  });

  it('the parameter is `gabi`, named in one place', () => {
    assert.equal(GABI_PREFILL_PARAM, 'gabi');
    assert.equal(gabiPrefillFrom('?gabi=what+is+missing'), 'what is missing');
  });

  it('reads the question with or without the leading ?', () => {
    assert.equal(gabiPrefillFrom('gabi=what+is+missing'), 'what is missing');
  });

  it('a collection filter and a question can ride the same URL', () => {
    assert.equal(gabiPrefillFrom('?q=sanderson&gabi=which+ones+are+missing'), 'which ones are missing');
  });

  it('percent-encoding survives — a real question has punctuation', () => {
    assert.equal(
      gabiPrefillFrom('?gabi=the%20Sanderson%20one%20with%20the%20wrong%20cover%3F'),
      'the Sanderson one with the wrong cover?',
    );
  });
});

describe('gabiPrefillFrom — when there is no question', () => {
  it('absent → null', () => {
    assert.equal(gabiPrefillFrom(''), null);
    assert.equal(gabiPrefillFrom('?page=2'), null);
  });

  it('⚠️ present but EMPTY → null, so `?gabi=` alone does not open an empty box', () => {
    assert.equal(gabiPrefillFrom('?gabi='), null);
    assert.equal(gabiPrefillFrom('?gabi=%20%20'), null);
  });
});

describe('gabiPrefillFrom — tidying what a link brings', () => {
  it('collapses the ragged whitespace a Discord copy-paste carries', () => {
    assert.equal(gabiPrefillFrom('?gabi=what%20is%0A%0A%20%20missing%3F%20'), 'what is missing?');
  });

  it('truncates past the ceiling rather than pasting a wall of text', () => {
    const long = 'a'.repeat(GABI_PREFILL_MAX + 50);
    const got = gabiPrefillFrom(`?gabi=${long}`);
    assert.equal(got?.length, GABI_PREFILL_MAX);
  });

  it('a question at exactly the ceiling is untouched', () => {
    const exact = 'b'.repeat(GABI_PREFILL_MAX);
    assert.equal(gabiPrefillFrom(`?gabi=${exact}`), exact);
  });
});

describe('searchWithoutGabiPrefill — taking the question back out of the URL', () => {
  it('removes it, so a reload cannot seed the box over what was typed since', () => {
    assert.equal(searchWithoutGabiPrefill('?gabi=what+is+missing'), '');
  });

  it('⚠️ every OTHER parameter survives — the link may point at a filtered view', () => {
    assert.equal(
      searchWithoutGabiPrefill('?q=sanderson&sort=title&gabi=which+are+missing'),
      '?q=sanderson&sort=title',
    );
  });

  it('a search with no question is returned untouched', () => {
    assert.equal(searchWithoutGabiPrefill('?q=sanderson'), '?q=sanderson');
    assert.equal(searchWithoutGabiPrefill(''), '');
  });

  it('the result is a bare path suffix, never a trailing ?', () => {
    assert.ok(!searchWithoutGabiPrefill('?gabi=x').endsWith('?'));
  });
});

describe('the round trip an arrival performs', () => {
  it('question out, URL cleaned, and the cleaned URL yields no question', () => {
    const search = '?q=stormlight&gabi=which+volume+is+missing';
    assert.equal(gabiPrefillFrom(search), 'which volume is missing');
    const cleaned = searchWithoutGabiPrefill(search);
    assert.equal(cleaned, '?q=stormlight');
    // The prefill is once-only: the URL left behind carries nothing to re-seed.
    assert.equal(gabiPrefillFrom(cleaned), null);
  });
});
