/**
 * Render conditions for the ebook holding shadow (`EbookShadow.tsx`), pinned
 * without a DOM — the `other-versions.test.ts` pattern.
 *
 *   - the ordinary physical-only book renders NOTHING — no empty panel;
 *   - agreement renders the quiet line, disagreement renders a notice with
 *     the fix named in words;
 *   - a stale holding is shown with a caveat, never hidden;
 *   - the verdict is `ebookAgreement`'s — the same function the backfill
 *     census prints, so panel and script cannot disagree.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { WorkEbookHolding } from '../src/api.ts';
import { EbookShadow, buildEbookShadow } from '../src/components/EbookShadow.tsx';

function holding(overrides: Partial<WorkEbookHolding> = {}): WorkEbookHolding {
  return {
    formats: ['epub'],
    sourcePath: 'Brandon Sanderson/Dragonsteel_Prime.epub',
    editionSource: 'file',
    derivedVia: 'edition',
    staleAt: null,
    ...overrides,
  };
}

describe('buildEbookShadow — what the panel will say', () => {
  it('no ebook either way renders NOTHING — the ordinary book stays quiet', () => {
    assert.equal(buildEbookShadow({ editionFormats: [], holding: null }), null);
    assert.equal(
      buildEbookShadow({ editionFormats: ['hardcover', 'paperback'], holding: null }),
      null,
    );
  });

  it('agreement is the quiet case: verdict both, agrees true, formats named', () => {
    const view = buildEbookShadow({ editionFormats: ['ebook_epub'], holding: holding() });
    assert.ok(view);
    assert.equal(view.verdict, 'both');
    assert.equal(view.agrees, true);
    assert.match(view.headline, /agree/);
    assert.match(view.headline, /EPUB/);
  });

  it('the provenance note tells a hand-added edition from a piped file', () => {
    const file = buildEbookShadow({ editionFormats: ['ebook_epub'], holding: holding() });
    assert.match(file!.notes[0]!, /stored edition rows/);
    const manual = buildEbookShadow({
      editionFormats: ['ebook_epub'],
      holding: holding({ editionSource: 'manual', sourcePath: null }),
    });
    assert.match(manual!.notes[0]!, /hand-added/);
  });

  it('edition-only disagreement names the fix: run the backfill', () => {
    const view = buildEbookShadow({ editionFormats: ['ebook_epub'], holding: null });
    assert.equal(view!.verdict, 'edition_only');
    assert.equal(view!.agrees, false);
    assert.match(view!.headline, /backfill:ebooks/);
  });

  it('a STALE holding beside a live edition is edition-only, with the stale caveat', () => {
    const view = buildEbookShadow({
      editionFormats: ['ebook_epub'],
      holding: holding({ staleAt: '2026-08-16 00:00:00' }),
    });
    assert.equal(view!.verdict, 'edition_only');
    assert.match(view!.notes[0]!, /stale/);
  });

  it('holding-only says what it means before AND after phase 5', () => {
    const view = buildEbookShadow({ editionFormats: ['paperback'], holding: holding() });
    assert.equal(view!.verdict, 'holding_only');
    assert.equal(view!.agrees, false);
    assert.match(view!.headline, /phase 5/);
  });

  it('a stale holding with no edition is still SHOWN, never hidden', () => {
    const view = buildEbookShadow({
      editionFormats: [],
      holding: holding({ staleAt: '2026-08-16 00:00:00' }),
    });
    assert.ok(view, 'a stale holding must render');
    assert.equal(view.agrees, false);
    assert.match(view.notes[0]!, /stale/);
  });

  it('a kindle licence does not count as the edition-side ebook', () => {
    // Derivation can never put kindle in the holding, so the edition side
    // must not count it either — no un-clearable alarm on licence-only books.
    assert.equal(buildEbookShadow({ editionFormats: ['ebook_kindle'], holding: null }), null);
  });
});

describe('EbookShadow — the component-level render condition', () => {
  it('returns null for the ordinary physical-only book', () => {
    assert.equal(
      EbookShadow({ editions: [{ format: 'hardcover' }], holding: null }),
      null,
    );
  });

  it('returns a section panel when there is something to say', () => {
    const el = EbookShadow({
      editions: [{ format: 'ebook_epub' }],
      holding: holding(),
    });
    assert.ok(el, 'agreement must render');
    assert.equal((el as { type?: unknown }).type, 'section');
  });
});
