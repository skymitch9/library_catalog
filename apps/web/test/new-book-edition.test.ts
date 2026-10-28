/**
 * The edition step of `addLineToCatalog` (scan / shelf-photo adds), pinned.
 *
 * Owner rule 2026-10-27: a NEW book always gets exactly one edition. Before it,
 * an add with no ISBN-13 wrote none — works 541–545 landed with a copy at
 * `edition_id = NULL` and zero editions. `lib/new-book-edition.ts` holds the
 * rule because `catalog-add.ts` imports `api.js` → `lib/firebase.ts` and cannot
 * be loaded by `tsx --test`.
 *
 * ⚠️ What this does NOT cover: `addLineToCatalog` itself (the match, the
 * questions, `recordArrival` passing `editionId` to `createCopy`). That glue is
 * one `const editionId = await mintEditionForAdd(...)` feeding the existing
 * `recordArrival(work.id, answer, editionId, …)` and is checked by typecheck
 * only, not by a test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { editionForAdd, mintEditionForAdd, type EditionBody } from '../src/lib/new-book-edition.ts';

const spine = { isbn13: null, publisher: null, publishedYear: null, coverUrl: null };
const barcode = {
  isbn13: '9780765326355',
  publisher: 'Tor',
  publishedYear: 2010,
  coverUrl: 'https://covers.example/x.jpg',
};

function fakeCreate() {
  const calls: EditionBody[] = [];
  const fn = async (body: EditionBody) => {
    calls.push(body);
    return { edition: { id: 42 } };
  };
  return { calls, fn };
}

describe('a NEW book always earns exactly one edition', () => {
  it('no ISBN → createEdition once with the chosen format, isbn13 null, source manual', async () => {
    const api = fakeCreate();
    const id = await mintEditionForAdd(api.fn, 541, spine, {
      attached: false,
      wishlist: false,
      format: 'hardcover',
    });
    assert.equal(id, 42, 'the id handed on to createCopy');
    assert.deepEqual(api.calls, [
      {
        workId: 541,
        isbn13: null,
        format: 'hardcover',
        publisher: null,
        publishedYear: null,
        coverUrl: null,
        source: 'manual',
      },
    ]);
  });

  it('no ISBN, no format passed → the documented paperback default', () => {
    assert.equal(editionForAdd(1, spine, { attached: false, wishlist: false })?.format, 'paperback');
  });

  it('a new book on the WISHLIST target still earns its edition', async () => {
    const api = fakeCreate();
    const id = await mintEditionForAdd(api.fn, 9, spine, {
      attached: false,
      wishlist: true,
      format: 'paperback',
    });
    assert.equal(id, 42);
    assert.equal(api.calls.length, 1);
  });
});

describe('a WANT attaching to a book we already hold writes NO edition (#139)', () => {
  for (const [name, line] of [
    ['no ISBN', spine],
    ['with ISBN', barcode],
  ] as const) {
    it(name, async () => {
      const api = fakeCreate();
      const id = await mintEditionForAdd(api.fn, 5, line, {
        attached: true,
        wishlist: true,
        format: 'hardcover',
      });
      assert.equal(id, null);
      assert.equal(api.calls.length, 0, 'createEdition must not be called');
    });
  }
});

describe('existing ISBN behaviour is unchanged', () => {
  it('new book with ISBN → one openlibrary edition carrying it', async () => {
    const api = fakeCreate();
    const id = await mintEditionForAdd(api.fn, 7, barcode, {
      attached: false,
      wishlist: false,
      format: 'paperback',
    });
    assert.equal(id, 42);
    assert.deepEqual(api.calls, [
      {
        workId: 7,
        isbn13: '9780765326355',
        format: 'paperback',
        publisher: 'Tor',
        publishedYear: 2010,
        coverUrl: 'https://covers.example/x.jpg',
        source: 'openlibrary',
      },
    ]);
  });

  it('shelf attach to a held book with ISBN → one edition, as before', () => {
    const body = editionForAdd(7, barcode, { attached: true, wishlist: false });
    assert.equal(body?.isbn13, '9780765326355');
    assert.equal(body?.source, 'openlibrary');
  });

  it('shelf attach to a held book with NO ISBN → no edition, as before', () => {
    assert.equal(editionForAdd(7, spine, { attached: true, wishlist: false }), null);
  });

  it('an ISBN 409 propagates — the caller keeps its existing handling', async () => {
    await assert.rejects(
      mintEditionForAdd(
        async () => {
          throw new Error('isbn_taken');
        },
        7,
        barcode,
        { attached: false, wishlist: false },
      ),
      /isbn_taken/,
    );
  });
});
