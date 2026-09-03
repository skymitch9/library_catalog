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
    // ⚠️ **The hedge left the TOKEN on 2026-09-03** — owner ask, approved 15:03
    // (*"make all of those question ones show the audio even if not sure and
    // then we can confirm if it's right in the edit menu later"*). It did not
    // disappear: it is in the chip's tooltip, in the work page's provenance
    // sentence, and settled for good in the edit box's Audio tab (0450). A
    // containment rung now signs exactly as an exact one does.
    assert.equal(audioToken(audiobook({ matchedVia: 'containment' })), 'audio');
  });

  it('two recordings make a DIFFERENT token — the COUNT is what must survive', () => {
    assert.equal(audioToken(audiobook({ editionCount: 2 })), 'audio×2');
    assert.equal(
      audioToken(audiobook({ editionCount: 2, matchedVia: 'containment' })),
      'audio×2',
      'the count is the half of this token the suppression trap eats — it stays',
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
  });

  /*
   * ⚠️ The retired vocabulary, still answered. `audioToken` stopped emitting
   * `'audio?'` on 2026-09-03, but the branches are KEPT rather than deleted:
   * `mediumPhrase` is exported and takes a plain string, so a caller holding an
   * old token must get the current WORDS rather than falling through to
   * `mediumLabel` and printing a literal "audio?" mid-sentence.
   */
  it('the retired hedged tokens read as the plain ones, never as raw text', () => {
    assert.equal(mediumPhrase('audio?'), 'on audio');
    assert.equal(mediumPhrase('audio?×2'), 'on audio (2 recordings each)');
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

  /*
   * ⚠️ **The chip no longer wears a `?`, and the tooltip is where the doubt
   * went** — owner ask 2026-09-03, approved 15:03. The number must survive that
   * change untouched, which is the half this file has always been about.
   *
   * ⚠️ The hedge is still SAID (migration 0010: shown, never hidden) — it is in
   * the `title` asserted below, and it now names the control that settles it.
   */
  it('shows NO hedge mark, keeps the number, and moves the doubt to the tooltip', () => {
    const entry = rung({
      audiobook: audiobook({ editionCount: 2, matchedVia: 'containment' }),
    });
    const text = chipText(Media({ entry }));
    assert.ok(!text.includes('?'), 'the `?` came off the chip on 2026-09-03');
    assert.ok(text.some((t) => t.trim() === '2'), 'the count is untouched by that change');

    const tip = audioTooltip(Media({ entry }));
    assert.ok(tip?.includes('partial title'), tip ?? 'no tooltip');
    assert.ok(tip?.includes('Edit this book'), tip ?? 'no tooltip');
  });

  it('an EXACT match says nothing about partial titles', () => {
    const tip = audioTooltip(Media({ entry: rung() }));
    assert.ok(!tip?.includes('partial title'), tip ?? 'no tooltip');
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
