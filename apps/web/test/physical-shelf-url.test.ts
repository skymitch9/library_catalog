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
  parseCollection,
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

// ---------------------------------------------------------------------------
// ⚠️ F7 — what an already-shared link means now (2026-08-25)
// ---------------------------------------------------------------------------
//
// The Type consolidation changed bindings and kinds from AND to OR (the owner's
// ask, and right for a control where every ticked box adds books) and migrated
// `?format=` into `?binding=`. Both halves were documented; their INTERACTION
// inverted the meaning of links people had already sent each other:
//
//     /?format=hardcover&kind=collectors
//       then → hardcover AND collector's
//       now  → hardcover OR collector's  ← a handful became most of the shelf
//
// AND cannot be given back for that one shape without a second predicate path
// beside `collectionFilter`, which is the thing that builder exists to prevent.
// So the legacy migration narrows instead: the format becomes the binding, the
// kind is dropped, and the result is a shelf that CONTAINS the old answer
// rather than one that swamps it.

describe('a link shared before the Type consolidation (F7)', () => {
  it('⚠️ legacy ?format= + ?kind= keeps the format and DROPS the kind', () => {
    const f = parseCollection('?format=hardcover&kind=collectors');
    assert.deepEqual(f.bindings, ['hardcover']);
    assert.deepEqual(
      f.editionKinds,
      [],
      'keeping both would OR them, and "hardcover OR collectors" is most of the shelf',
    );
  });

  it('a legacy ?format= on its own still migrates, exactly as before', () => {
    assert.deepEqual(parseCollection('?format=paperback').bindings, ['paperback']);
    assert.deepEqual(parseCollection('?format=paperback').editionKinds, []);
  });

  it('a legacy ebook format still folds to the coarse `ebook` type', () => {
    // Stated in 1333ff2 and accepted as a trade: `?format=epub` now also matches
    // a work whose only file is a PDF. The Type control offers one ebook box.
    assert.deepEqual(parseCollection('?format=ebook_epub').bindings, ['ebook']);
  });

  it('⚠️ a link the CURRENT control produced is left completely alone', () => {
    // `?binding=…&kind=…` is what ticking two boxes writes. It means OR, the
    // person built it a moment ago, and nothing here may quietly narrow it.
    const f = parseCollection('?binding=hardcover&kind=collectors');
    assert.deepEqual(f.bindings, ['hardcover']);
    assert.deepEqual(f.editionKinds, ['collectors']);
  });

  it('?kind= alone is untouched — there is no legacy format to interact with', () => {
    assert.deepEqual(parseCollection('?kind=collectors').editionKinds, ['collectors']);
    assert.deepEqual(parseCollection('?kind=collectors,unsorted').editionKinds, [
      'collectors',
      'unsorted',
    ]);
  });

  it('an unknown legacy format drops the kind only when it really was there', () => {
    // `?format=junk` produces no binding at all (`legacyFormatBinding` folds
    // unknown to `ebook` only for real EDITION_FORMATS; `pick` rejects the rest)
    // — but the parameter WAS present, so the link is still a legacy one and
    // widening it would be the same bug.
    const f = parseCollection('?format=junk&kind=collectors');
    assert.deepEqual(f.bindings, []);
    assert.deepEqual(f.editionKinds, []);
  });
});
