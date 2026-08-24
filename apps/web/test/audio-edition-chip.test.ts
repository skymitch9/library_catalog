/**
 * The series ladder's audio chip, once a volume can be held in more than one
 * recording — migration 0390, and the owner's decision of 2026-08-23: *"have it
 * say 2 on the physical and ebook libraries; on audiobook have them be different
 * since they're different files being served."*
 *
 * ## ⚠️ The trap this file exists for
 *
 * The chips are SUPPRESSED the moment every held rung agrees — the ladder
 * renders `{!uniformMedia && <Media …>}`, and `signatureShared` decides. So a
 * count that reached only the chip could never be seen on the shape that
 * prompted the ask: *Elantris* is ONE held volume in its series, its own
 * signature is trivially "shared", and its chips vanish. The count therefore has
 * to be part of the SIGNATURE, and this pins that.
 *
 * It is the same failure mode as the one `signatureOf`'s own comment records —
 * folding `matchedVia` away made every rung agree and produced a flat claim on
 * `/series/Tamer: King of Dinosaurs` — and it failed the same way: silently, and
 * only visible in a browser.
 *
 * ## The other half: a rung is a rung
 *
 * Two recordings of one volume are still ONE rung held on audio. Nothing here
 * may make the coverage arithmetic move; that separation is pinned in SQL by
 * `packages/db/test/audio-edition-count.test.ts`, and in the vocabulary here by
 * the "recordings each" wording, which speaks per volume and never per series.
 *
 * `signatureOf`, `signatureShared`, `mediumPhrase` and `Media` are pure (no
 * hooks, no fetch), so this needs no DOM. They live in `components/RungMedia`
 * rather than in `SeriesDetailPage` for exactly that reason — see that file's
 * header; the page imports `api`, which reaches `import.meta.env` and throws
 * under `node --test` before an assertion can run.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AudiobookRef, SeriesLadderEntry } from '../src/api.ts';
import {
  Media,
  audioToken,
  mediumPhrase,
  signatureOf,
  signatureShared,
} from '../src/components/RungMedia.tsx';

function audiobook(overrides: Partial<AudiobookRef> = {}): AudiobookRef {
  return {
    title: 'Elantris',
    series: null,
    indexDisplay: null,
    matchedVia: 'exact',
    viaAlias: null,
    editionCount: 1,
    ...overrides,
  };
}

function rung(overrides: Partial<SeriesLadderEntry> = {}): SeriesLadderEntry {
  return {
    index: 1,
    volumeId: null,
    display: '1',
    title: 'Elantris',
    authors: 'Brandon Sanderson',
    workId: 514,
    wanted: false,
    coverUrl: null,
    readState: null,
    source: null,
    sourceUrl: null,
    note: null,
    staleAt: null,
    editions: [],
    media: ['ebook'],
    audiobook: audiobook(),
    ...overrides,
  };
}

/** Every string the rendered chips contain, in order. */
function chipText(el: unknown): string[] {
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

/** The `title=` of the audio chip, which is where the sentence lives. */
function audioTooltip(el: unknown): string | null {
  let found: string | null = null;
  const walk = (node: any): void => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.props?.className === 'fmt fmt--audio' && typeof node.props.title === 'string') {
      found = node.props.title;
    }
    if (node.props) walk(node.props.children);
  };
  walk(el);
  return found;
}

describe('audioToken — the count belongs in the signature', () => {
  it('one recording is the vocabulary the catalog already had', () => {
    // Measured 2026-08-23: every matched work in this catalog holds exactly one
    // recording, so this is the token almost every rung will ever produce.
    assert.equal(audioToken(audiobook()), 'audio');
    assert.equal(audioToken(audiobook({ matchedVia: 'containment' })), 'audio?');
  });

  it('two recordings make a DIFFERENT token, hedge preserved', () => {
    assert.equal(audioToken(audiobook({ editionCount: 2 })), 'audio×2');
    assert.equal(
      audioToken(audiobook({ editionCount: 2, matchedVia: 'containment' })),
      'audio?×2',
      'the hedge must survive the count — an uncertain match twice over is still uncertain',
    );
  });
});

describe('signatureOf / signatureShared — the suppression trap', () => {
  it('a one-recording rung signs exactly as it did before 0390', () => {
    assert.equal(signatureOf(rung()), 'ebook+audio');
  });

  it('a two-recording rung signs differently', () => {
    assert.equal(signatureOf(rung({ audiobook: audiobook({ editionCount: 2 }) })), 'ebook+audio×2');
  });

  it('⚠️ a series where ONE volume has two recordings shows its chips', () => {
    // Without the count in the signature these two rungs "agree", the chips are
    // suppressed, and the 2 is invisible — the exact bug this file guards.
    const held = [rung(), rung({ index: 2, audiobook: audiobook({ editionCount: 2 }) })];
    assert.equal(signatureShared(held), null, 'not shared, so every rung wears its chips');
  });

  it('rungs that all hold one recording still collapse to one sentence', () => {
    assert.equal(signatureShared([rung(), rung({ index: 2 })]), 'ebook+audio');
  });

  it('rungs that ALL hold two collapse too, and the sentence says so per volume', () => {
    const two = audiobook({ editionCount: 2 });
    const shared = signatureShared([rung({ audiobook: two }), rung({ index: 2, audiobook: two })]);
    assert.equal(shared, 'ebook+audio×2');
    assert.deepEqual(
      (shared as string).split('+').map(mediumPhrase),
      ['as ebooks', 'on audio (2 recordings each)'],
      '"each" is load-bearing: this sentence speaks for every rung at once',
    );
  });

  it('mediumPhrase leaves the existing words alone', () => {
    assert.equal(mediumPhrase('physical'), 'in print');
    assert.equal(mediumPhrase('ebook'), 'as ebooks');
    assert.equal(mediumPhrase('audio'), 'on audio');
    assert.equal(mediumPhrase('audio?'), 'possibly on audio');
    assert.equal(mediumPhrase('audio?×2'), 'possibly on audio (2 recordings each)');
  });
});

describe('Media — the chip itself', () => {
  it('shows NO number at one recording', () => {
    const text = chipText(Media({ entry: rung() }));
    assert.ok(text.includes('Audio'), 'the audio chip is there');
    assert.ok(!text.includes('1'), 'a "1" on every audiobook is the label nobody reads');
  });

  it('shows the number at two — the owner’s ask, on the ladder', () => {
    const text = chipText(Media({ entry: rung({ audiobook: audiobook({ editionCount: 2 }) }) }));
    assert.ok(text.includes('Audio'));
    assert.ok(
      text.some((t) => t.trim() === '2'),
      'the chip must read "AUDIO 2"',
    );
  });

  it('keeps the containment hedge beside the number', () => {
    const text = chipText(
      Media({ entry: rung({ audiobook: audiobook({ editionCount: 2, matchedVia: 'containment' }) }) }),
    );
    assert.ok(text.includes('?'), 'two uncertain matches are still uncertain');
    assert.ok(text.some((t) => t.trim() === '2'));
  });

  it('the tooltip says how many, and where to see WHICH', () => {
    // ⚠️ It cannot name them: the ladder loads one row per work (the
    // `audiobook_holding` view) and the narrators live in `audioEditions`,
    // which only the work page asks for.
    const tip = audioTooltip(Media({ entry: rung({ audiobook: audiobook({ editionCount: 2 }) }) }));
    assert.ok(tip?.includes('2 recordings'), tip ?? 'no tooltip');
    assert.ok(tip?.includes('open the book'), tip ?? 'no tooltip');
  });

  it('the one-recording tooltip is unchanged', () => {
    const tip = audioTooltip(Media({ entry: rung() }));
    assert.equal(tip, 'In the audiobook catalog as "Elantris"');
  });
});
