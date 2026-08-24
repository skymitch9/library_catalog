/**
 * Render smoke-test for the work page (`WorkPage.tsx`), driven through the
 * firebase-free leaf `deriveWorkView` — the `other-versions.test.ts` /
 * `note-rows.ts` pattern this repo uses because `WorkPage.tsx` reaches
 * `firebase.ts`, which reads `import.meta.env` at module scope and so cannot be
 * imported under the node test runner. There is no jsdom or vitest in this
 * repo; `deriveWorkView` is exactly the body of the page's render that the
 * 2026-08-24 outage crashed in (`editions.find(...)`), lifted out so it can be
 * run against real-shaped responses with no DOM.
 *
 * ⚠️ The cases that earn this file are the **empty-array and null** shapes,
 * because that is where `.find()` / `.map()` crashes hide: a book with no
 * editions, no peers, `reading: null`, `ebookHolding: null`. Each must derive
 * cleanly rather than throw the whole page blank.
 *
 * What this does NOT cover: the child components (`Copies`, `EbookShadow`,
 * `OtherVersions`, …) each render their own arrays and have their own tests
 * (`ebook-shadow.test.ts`, `other-versions.test.ts`). A full DOM mount of the
 * whole tree is not possible in this harness (no jsdom/vitest; firebase import
 * at module scope). This pins the page's OWN render decision — the outage locus.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Me } from '../src/api.ts';
import type { CopyView } from '../src/components/Copies.ts';
import type { EditionView } from '../src/components/Editions.ts';
import { deriveWorkView, type WorkDetail } from '../src/lib/work-view.ts';

/** Only `format` and `source_url` are read by the page; the rest is real-shaped noise. */
function edition(format: string, source_url: string | null = null): EditionView {
  return { id: 1, format, isbn13: null, source_url } as unknown as EditionView;
}

function copy(): CopyView {
  return { id: 1, status: 'owned' } as unknown as CopyView;
}

/** A fully-populated, real-shaped `/api/works/:id` response. Override per case. */
function makeDetail(overrides: Partial<WorkDetail> = {}): WorkDetail {
  return {
    work: {
      id: 269,
      title: 'The Way of Kings',
      subtitle: null,
      authors: 'Brandon Sanderson',
      series: 'The Stormlight Archive',
      seriesIndexDisplay: 'Book 1',
      seriesIndexSort: 1,
      multiVolumePrinting: false,
      firstPublished: 2010,
      description: 'A stormy epic.',
      coverUrl: 'https://example.test/cover.jpg',
      coverStatus: 'ok',
      illustrator: null,
      workKey: 'the way of kings|brandon sanderson',
    },
    universe: 'The Cosmere',
    editions: [edition('hardcover'), edition('ebook_epub', 'drive://file.epub')],
    copies: [copy()],
    watches: [],
    audiobookHolding: null,
    audioEditions: [],
    audioEditionCount: 1,
    ebookHolding: null,
    peerHoldings: [],
    reading: {
      read_state: 'read',
      started_on: null,
      finished_on: '2026-01-01',
      read_format: 'print',
      read_state_how: 'human',
    },
    ...overrides,
  };
}

const me: Me = {
  email: 'owner@example.test',
  displayName: 'Owner',
  role: 'admin',
  capabilities: ['read', 'editCatalog', 'trackReading'],
  reviewName: null,
} as unknown as Me;

describe('deriveWorkView — the page renders without throwing', () => {
  it('a normal, fully-populated work derives cleanly', () => {
    const v = deriveWorkView(makeDetail(), me);
    assert.equal(v.work.id, 269);
    // The one ebook edition names a file, so Drive links show and fileEdition is it.
    assert.equal(v.showDrive, true);
    assert.equal(v.fileEdition?.source_url, 'drive://file.epub');
    assert.equal(v.canTrack, true);
    assert.ok(Array.isArray(v.watches));
  });

  it('⚠️ empty editions — no crash, no file, no Drive links (the null/empty locus)', () => {
    const v = deriveWorkView(makeDetail({ editions: [] }), me);
    assert.equal(v.fileEdition, null);
    assert.equal(v.showDrive, false);
  });

  it('⚠️ a book with EVERYTHING empty or null derives cleanly', () => {
    // The shape most likely to hit an unguarded `.find`/`.map`: nothing present.
    const v = deriveWorkView(
      makeDetail({
        editions: [],
        copies: [],
        watches: [],
        peerHoldings: [],
        audioEditions: [],
        reading: null,
        ebookHolding: null,
        audiobookHolding: null,
        universe: null,
        audioEditionCount: undefined,
      }),
      me,
    );
    assert.equal(v.fileEdition, null);
    assert.equal(v.showDrive, false);
    assert.equal(v.reading, null);
    assert.equal(v.universe, null);
    assert.equal(v.audioEditionCount, undefined);
    assert.deepEqual(v.audioEditions, []);
    assert.deepEqual(v.peerHoldings, []);
  });

  it('physical-only editions hide Drive links; a non-physical edition shows them', () => {
    assert.equal(deriveWorkView(makeDetail({ editions: [edition('paperback')] }), me).showDrive, false);
    assert.equal(deriveWorkView(makeDetail({ editions: [edition('ebook_epub')] }), me).showDrive, true);
  });

  it('a reader without trackReading gets canTrack:false, still no crash', () => {
    const reader = { ...me, capabilities: ['read'] } as unknown as Me;
    assert.equal(deriveWorkView(makeDetail(), reader).canTrack, false);
  });

  it('watches / audioEditions default to [] when a stale response omits them', () => {
    // A response cached from before those fields existed must not blank the page.
    const v = deriveWorkView(
      makeDetail({ watches: undefined as never, audioEditions: undefined as never }),
      me,
    );
    assert.deepEqual(v.watches, []);
    assert.deepEqual(v.audioEditions, []);
  });

  it('⚠️ proves the outage: a response missing `editions` throws here, not silently', () => {
    // This is the 2026-08-24 crash reproduced. The GUARD against it is the
    // worker contract test (the field cannot go missing); deriveWorkView is
    // deliberately NOT defensive, so a broken response fails loudly rather than
    // rendering an empty shelf.
    const broken = makeDetail();
    delete (broken as { editions?: unknown }).editions;
    assert.throws(() => deriveWorkView(broken, me), /find/);
  });
});
