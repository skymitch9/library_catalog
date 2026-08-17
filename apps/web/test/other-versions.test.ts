/**
 * Render conditions for "Other versions available" (`OtherVersions.tsx`),
 * pinned without a DOM:
 *
 *   - a work with no counterpart renders NOTHING — no empty panel, no heading;
 *   - a work with an `audiobook_holding` row renders exactly one entry, and
 *     that entry ALWAYS carries a format label (the owner's exact spec,
 *     2026-08-14: "always say the form the media is in");
 *   - the link is the hash-search deep link and the cover resolves against the
 *     sibling's bucket — i.e. the entry is built FROM the two audited helpers,
 *     never from a second URL implementation.
 *
 * `buildVersionEntries` is a pure function returning plain data, so most of
 * this needs no React at all; the two component-level checks call the function
 * component directly (it uses no hooks) and look at what it returns.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { WorkAudiobookHolding } from '../src/api.ts';
import { OtherVersions, buildVersionEntries } from '../src/components/OtherVersions.tsx';
import { audiobookDetailUrl, resolveAudiobookCover } from '../src/lib/audiobook-site.ts';

/** A realistic row — Harry Potter 2 is one of the two the backfill matched first. */
function holding(overrides: Partial<WorkAudiobookHolding> = {}): WorkAudiobookHolding {
  return {
    title: 'Harry Potter and the Chamber of Secrets',
    authors: 'J.K. Rowling',
    series: 'Harry Potter',
    indexDisplay: 'Book 2',
    coverHref: 'covers/J.k. Rowling/Harry Potter and the Chamber of Secrets.jpg',
    matchedVia: 'exact',
    titleSimilarity: 1,
    staleAt: null,
    ...overrides,
  };
}

describe('buildVersionEntries — what the section will show', () => {
  it('no holding, no entries — the section renders nothing at all', () => {
    assert.deepEqual(buildVersionEntries({ holding: null, ourSeries: null }), []);
    assert.deepEqual(buildVersionEntries({ holding: null, ourSeries: 'Harry Potter' }), []);
  });

  it('one holding is one entry, and the format label is ALWAYS present', () => {
    const entries = buildVersionEntries({ holding: holding(), ourSeries: 'Harry Potter' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].formatLabel, 'Audiobook');
    assert.equal(entries[0].key, 'audiobook');
  });

  it('links via the ONE deep-link helper, with the SIBLING catalog’s title', () => {
    const h = holding();
    const [entry] = buildVersionEntries({ holding: h, ourSeries: null });
    assert.equal(entry.href, audiobookDetailUrl(h.title));
    assert.equal(entry.title, h.title);
  });

  it('resolves the cover via the ONE bucket helper, and null stays null', () => {
    const h = holding();
    const [withCover] = buildVersionEntries({ holding: h, ourSeries: null });
    assert.equal(withCover.cover, resolveAudiobookCover(h.coverHref));
    const [noCover] = buildVersionEntries({ holding: holding({ coverHref: null }), ourSeries: null });
    assert.equal(noCover.cover, null);
  });

  it('carries the sibling’s own volume display through untouched', () => {
    const [entry] = buildVersionEntries({ holding: holding(), ourSeries: null });
    assert.equal(entry.indexDisplay, 'Book 2');
    const [none] = buildVersionEntries({ holding: holding({ indexDisplay: null }), ourSeries: null });
    assert.equal(none.indexDisplay, null);
  });

  it('a stale holding still yields an entry — shown with a caveat, never hidden', () => {
    const entries = buildVersionEntries({
      holding: holding({ staleAt: '2026-08-15 00:00:00' }),
      ourSeries: null,
    });
    assert.equal(entries.length, 1);
  });
});

describe('OtherVersions — the component-level render condition', () => {
  it('returns null for a work with no counterpart', () => {
    assert.equal(OtherVersions({ holding: null, ourSeries: null }), null);
  });

  it('returns a section panel when a holding exists', () => {
    const el = OtherVersions({ holding: holding(), ourSeries: 'Harry Potter' });
    assert.ok(el, 'a holding must render');
    assert.equal((el as { type?: unknown }).type, 'section');
  });
});
