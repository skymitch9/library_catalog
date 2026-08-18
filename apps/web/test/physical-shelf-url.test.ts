/**
 * `?ebooks=hide` — the URL half of "Recently added shows physical books only"
 * (owner, 2026-08-18).
 *
 * ⚠️ Why the URL is worth its own test when the filter it carries has no
 * control: it is the ONLY thing keeping the strip and the list "See all" opens
 * from being two different lists. The button sets three pieces of state and the
 * address bar is where they meet the server; if this parameter is dropped,
 * spelled differently, or emitted when nobody asked, the bug is invisible on the
 * screen that shows it — the list simply has the ebooks back in it and looks
 * like a list.
 *
 * The parse side lives behind a module-private `parseCollection` and is one line
 * through the same `pick` helper five other filters use; it is verified live
 * rather than here, which this comment says out loud rather than implying.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EBOOK_ONLY_FILTERS,
  collectionInUniversePath,
  collectionPath,
  type CollectionFilters,
} from '../src/router.tsx';

/** An unfiltered collection — every field at its shipped default. */
function filters(overrides: Partial<CollectionFilters> = {}): CollectionFilters {
  return {
    q: '',
    series: '',
    universe: '',
    medium: '',
    ebookOnly: '',
    format: '',
    editionKind: '',
    status: '',
    needs: '',
    readState: '',
    sort: null,
    dir: null,
    pageSize: null,
    page: 1,
    ...overrides,
  };
}

describe('the physical shelf in the address bar', () => {
  it('says nothing when nobody narrowed the shelf', () => {
    assert.equal(collectionPath(filters()), '/');
  });

  it('emits ?ebooks=hide, shortened the way ?read= and ?kind= are', () => {
    assert.equal(collectionPath(filters({ ebookOnly: 'hide' })), '/?ebooks=hide');
  });

  it('carries what "See all" sets, all three parts of it', () => {
    // What the button under the strip does: newest first, physical only. The
    // whole point is that this link reopens the strip's list and not another
    // one.
    const path = collectionPath(filters({ sort: 'added', dir: 'desc', ebookOnly: 'hide' }));
    const params = new URLSearchParams(path.slice(path.indexOf('?')));
    assert.equal(params.get('sort'), 'added');
    assert.equal(params.get('dir'), 'desc');
    assert.equal(params.get('ebooks'), 'hide');
  });

  it('composes with the other filters rather than replacing them', () => {
    const params = new URLSearchParams(
      collectionPath(filters({ q: 'cradle', medium: 'ebook', ebookOnly: 'hide' })).slice(2),
    );
    assert.equal(params.get('q'), 'cradle');
    assert.equal(params.get('medium'), 'ebook');
    assert.equal(params.get('ebooks'), 'hide');
  });

  it('leaves a universe link unnarrowed — a world is bigger than one shelf', () => {
    assert.equal(collectionInUniversePath('The Cosmere'), '/?universe=The+Cosmere');
  });

  it('offers one word, and it is the one that takes something away', () => {
    // ⚠️ There is deliberately no "show" — the whole catalog is the default, so
    // a second value could only ever mean "ebooks only", which is the opposite
    // of what this parameter's name would suggest it did.
    assert.deepEqual([...EBOOK_ONLY_FILTERS], ['hide']);
  });
});
