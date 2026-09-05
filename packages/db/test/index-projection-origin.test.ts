/**
 * 🔴 The origin every pushed row points at — the second half of the 2026-09-05
 * federation build, and the sharper half.
 *
 * `buildIndexProjection` absolutised `detail_url` (and site-relative
 * `cover_url`) against a HARD-CODED `https://library.heygabi.ai`. That was
 * invisible while only one instance pushed. With padhard pushing as `library2`
 * it becomes a wrong answer rather than a missing one: `source_id` is a
 * per-database `work.id`, so a padhard row's `library.heygabi.ai/work/7` is
 * whatever book happens to be id 7 in the MAIN library.
 *
 * These pin the fix at the level it can regress: the origin resolution itself,
 * and the two fields that carry it.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  SITE_ORIGIN,
  buildIndexProjection,
  resolveProjectionOrigin,
} from '../src/index-projection.js';

describe('resolveProjectionOrigin', () => {
  it('uses the instance’s own origin when it is set', () => {
    assert.equal(
      resolveProjectionOrigin('https://padhard.heygabi.ai'),
      'https://padhard.heygabi.ai',
    );
  });

  it('falls back to the main library when unset or blank — main is unchanged', () => {
    assert.equal(resolveProjectionOrigin(undefined), SITE_ORIGIN);
    assert.equal(resolveProjectionOrigin(''), SITE_ORIGIN);
    assert.equal(resolveProjectionOrigin('   '), SITE_ORIGIN);
  });

  it('trims a trailing slash, so nothing ever emits `…ai//work/7`', () => {
    assert.equal(resolveProjectionOrigin('https://padhard.heygabi.ai/'), 'https://padhard.heygabi.ai');
    assert.equal(resolveProjectionOrigin(' https://padhard.heygabi.ai// '), 'https://padhard.heygabi.ai');
  });
});

/** The one row shape the projection reads, with a site-relative cover. */
function fakeDb() {
  return {
    prepare: () => ({
      all: async () => ({
        results: [
          {
            id: 7,
            title: 'A Book',
            authors: 'Someone',
            series: null,
            series_index_sort: null,
            first_published: null,
            cover_url: '/covers/a-book.jpg',
          },
        ],
      }),
    }),
  } as never;
}

describe('buildIndexProjection — whose site do the rows point at', () => {
  it('🔴 padhard’s rows point at padhard, not at the main library', async () => {
    const [row] = await buildIndexProjection(fakeDb(), 'https://padhard.heygabi.ai');
    assert.equal(row.detail_url, 'https://padhard.heygabi.ai/work/7');
    assert.equal(row.cover_url, 'https://padhard.heygabi.ai/covers/a-book.jpg');
  });

  it('the main instance is byte-identical to before the parameter existed', async () => {
    const [passed] = await buildIndexProjection(fakeDb(), SITE_ORIGIN);
    const [omitted] = await buildIndexProjection(fakeDb());
    assert.deepEqual(omitted, passed);
    assert.equal(omitted.detail_url, `${SITE_ORIGIN}/work/7`);
  });

  it('an already-absolute cover is left alone whichever instance pushes it', async () => {
    const db = {
      prepare: () => ({
        all: async () => ({
          results: [
            {
              id: 7,
              title: 'A Book',
              authors: 'Someone',
              series: null,
              series_index_sort: null,
              first_published: null,
              cover_url: 'https://covers.example/a.jpg',
            },
          ],
        }),
      }),
    } as never;
    const [row] = await buildIndexProjection(db, 'https://padhard.heygabi.ai');
    assert.equal(row.cover_url, 'https://covers.example/a.jpg');
  });
});
