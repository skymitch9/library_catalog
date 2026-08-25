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
    bindings: [],
    editionKinds: [],
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

  it('serialises the consolidated Type control as ?binding= and ?kind=', () => {
    // The one dropdown drives two lists (owner ask, 2026-08-24): the binding
    // types ride `?binding=`, the printing kinds ride `?kind=`, each comma-joined.
    const path = collectionPath(
      filters({ bindings: ['hardcover', 'ebook'], editionKinds: ['collectors'] }),
    );
    const params = new URLSearchParams(path.slice(path.indexOf('?')));
    assert.equal(params.get('binding'), 'hardcover,ebook');
    assert.equal(params.get('kind'), 'collectors');
    // ⚠️ The removed single-format select's param is never emitted any more.
    assert.equal(params.get('format'), null);
  });

  it('emits ?kind= as a comma-joined list now that printing is multi-select', () => {
    const path = collectionPath(filters({ editionKinds: ['collectors', 'unsorted'] }));
    const params = new URLSearchParams(path.slice(path.indexOf('?')));
    assert.equal(params.get('kind'), 'collectors,unsorted');
  });

  it('says nothing about Type when nothing is ticked', () => {
    const path = collectionPath(filters({ bindings: [], editionKinds: [] }));
    assert.equal(path, '/');
  });

  it('offers two words, and neither of them means "ebooks only"', () => {
    // ⚠️ **The default flipped on 2026-08-21 and this is what made `show`
    // necessary.** It used to be that the whole catalog was the default, so
    // `hide` was the only value that could mean anything and a second one could
    // only have meant "ebooks only" — the opposite of what the parameter's name
    // suggests. Now the collection defaults to HIDING ebooks (it is the
    // physical shelf, matching the "Recently Added" strip), so there has to be
    // a word for "I explicitly asked to see everything", and that word is
    // `show`.
    //
    // ⚠️ `show` still does NOT mean "ebooks only". `CollectionPage` maps it
    // to the EMPTY narrowing (`effectiveEbookOnly = ''`), not to an inverted
    // one. If a third value ever turns up here, check that first — an
    // "ebooks only" value belongs on `medium`, which already has one.
    assert.deepEqual([...EBOOK_ONLY_FILTERS], ['hide', 'show']);
  });
});
