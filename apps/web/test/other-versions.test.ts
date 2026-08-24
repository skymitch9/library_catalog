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

import type { WorkAudioEdition, WorkAudiobookHolding } from '../src/api.ts';
import { OtherVersions, audioCountLine, buildVersionEntries } from '../src/components/OtherVersions.tsx';
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

/**
 * Migration 0390 — a work with more than one audiobook edition.
 *
 * The household owns two *Elantris* recordings: a full-cast one filed with no
 * series, and the Tenth Anniversary edition filed as series Elantris, volume 1,
 * read by Jack Garrett. Before 0390 only one could be stored; this pins what the
 * section shows once both are.
 */
function edition(overrides: Partial<WorkAudioEdition> = {}): WorkAudioEdition {
  return {
    audioKey: 'Elantris',
    title: 'Elantris',
    authors: 'Brandon Sanderson',
    series: null,
    indexDisplay: null,
    narrator: 'James Konicek, Danny Gavigan, Lily Beacon',
    coverHref: 'covers/Brandon Sanderson/Elantris - Graphic Audio.png',
    matchedVia: 'exact',
    titleSimilarity: 1,
    staleAt: null,
    ...overrides,
  };
}

const tenthAnniversary = edition({
  audioKey: 'Elantris - Tenth Anniversary Special Edition',
  title: 'Elantris - Tenth Anniversary Special Edition',
  series: 'Elantris',
  indexDisplay: '1',
  narrator: 'Jack Garrett',
  matchedVia: 'containment',
  titleSimilarity: 0.19,
});

describe('buildVersionEntries — more than one audiobook edition (migration 0390)', () => {
  it('lists every edition, each with its own key and format label', () => {
    const entries = buildVersionEntries({
      holding: holding(),
      editions: [tenthAnniversary, edition()],
      ourSeries: null,
    });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.formatLabel), ['Audiobook', 'Audiobook']);
    // Keys are per edition, so React can tell two rows of one book apart.
    assert.deepEqual(entries.map((e) => e.key), [
      'audiobook:Elantris - Tenth Anniversary Special Edition',
      'audiobook:Elantris',
    ]);
  });

  it('⚠️ ONE edition changes nothing — the single holding still renders it', () => {
    // The list only takes over when it says more than the view already does.
    // A one-edition book must render exactly what it rendered before 0390, so
    // an API response that predates `audioEditions` cannot blank the section.
    const entries = buildVersionEntries({
      holding: holding(),
      editions: [edition()],
      ourSeries: 'Harry Potter',
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, 'audiobook');
    assert.equal(entries[0].title, 'Harry Potter and the Chamber of Secrets');
  });

  it('carries each edition’s own series, volume and link', () => {
    const [tenth, fullCast] = buildVersionEntries({
      holding: holding(),
      editions: [tenthAnniversary, edition()],
      ourSeries: null,
    });
    assert.equal(tenth.indexDisplay, '1');
    assert.equal(tenth.href, audiobookDetailUrl(tenthAnniversary.title));
    assert.equal(fullCast.indexDisplay, null);
    assert.equal(fullCast.href, audiobookDetailUrl('Elantris'));
  });

  it('renders a section for a two-edition work even with no view row', () => {
    // `audiobookHolding` and `audioEditions` are fed by the same table, so this
    // pair cannot happen in practice — pinned so a future caller that passes
    // only the list still gets a section rather than silence.
    const el = OtherVersions({
      holding: null,
      editions: [tenthAnniversary, edition()],
      ourSeries: null,
    });
    assert.ok(el, 'two editions must render');
    assert.equal((el as { type?: unknown }).type, 'section');
  });
});

/**
 * "Say the NUMBER" — the owner's decision, 2026-08-23, verbatim: *"have it say
 * 2 on the physical and ebook libraries; on audiobook have them be different
 * since they're different files being served."*
 *
 * ⚠️ The case that earns most of this block is **1 vs 2**, because the count is
 * SILENT at one. A book with a single recording must read exactly as it did
 * before this change — a "1" on every audiobook in the catalog is the label
 * nobody reads, and today every book in this catalog has exactly one.
 */
describe('audioCountLine — the number, said in words', () => {
  it('says nothing at one — the ordinary case, and every book here today', () => {
    assert.equal(audioCountLine(1), null);
  });

  it('says nothing at zero, and nothing when the field is absent', () => {
    assert.equal(audioCountLine(0), null);
    // An API response cached from before the field existed. It must render what
    // it rendered before, never "0 audiobooks".
    assert.equal(audioCountLine(undefined), null);
  });

  it('says TWO at two — the case migration 0390 exists for', () => {
    assert.equal(audioCountLine(2), 'You own 2 audiobooks of this book.');
  });

  it('says three at three, without a special case', () => {
    assert.equal(audioCountLine(3), 'You own 3 audiobooks of this book.');
  });
});

describe('OtherVersions — the count line beside the rows', () => {
  /** The children of the rendered <section>, flattened enough to search. */
  function texts(el: unknown): string[] {
    const out: string[] = [];
    const walk = (node: any): void => {
      if (node == null || typeof node === 'boolean') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === 'string' || typeof node === 'number') {
        out.push(String(node));
        return;
      }
      if (typeof node === 'object' && node.props) walk(node.props.children);
    };
    walk((el as any)?.props?.children);
    return out;
  }

  it('a two-edition work says "You own 2 audiobooks of this book."', () => {
    const el = OtherVersions({
      holding: holding(),
      editions: [tenthAnniversary, edition()],
      audioEditionCount: 2,
      ourSeries: null,
    });
    assert.ok(texts(el).includes('You own 2 audiobooks of this book.'));
  });

  it('a ONE-edition work says no such line', () => {
    const el = OtherVersions({
      holding: holding(),
      editions: [edition()],
      audioEditionCount: 1,
      ourSeries: null,
    });
    assert.ok(!texts(el).some((t) => t.startsWith('You own')));
  });

  it('⚠️ two rows and NO count line when one of them is stale', () => {
    // The pair that proves the number is not `editions.length`. The list shows
    // a withdrawn match with its caveat; the count refuses to call it a book
    // the household owns. Two rows, and no sentence claiming two.
    const el = OtherVersions({
      holding: holding(),
      editions: [tenthAnniversary, edition({ staleAt: '2026-08-23 04:00:00' })],
      audioEditionCount: 1,
      ourSeries: null,
    });
    assert.ok(el, 'the section still renders both rows');
    assert.ok(!texts(el).some((t) => t.startsWith('You own')));
  });
});
