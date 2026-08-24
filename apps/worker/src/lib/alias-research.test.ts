/**
 * The alias wiring on the PAID ask, pinned at the two pure seams the model call
 * hides: the identity block the prompt is built from, and the attribution the
 * run record carries back.
 *
 * `researchDetails` itself cannot be unit-tested without a live key, so the alias
 * behaviour is proven at `buildResearchIdentity` (what the model is told) and
 * `aliasAttribution` (what the run says it found the book as) — the same
 * export-the-pure-core pattern `lastRealAttempt` uses.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { buildResearchIdentity } from '@lc/research';

import { aliasAttribution, withAttribution } from './research-run.js';

describe('buildResearchIdentity — aliases reach the prompt', () => {
  it('adds one "Also known as" line per alias, after the author', () => {
    const identity = buildResearchIdentity({
      title: 'The Ex Hex Duo',
      authors: 'Erin Sterling',
      series: null,
      titleAliases: ['The Ex Hex'],
      fields: ['series'],
    });
    assert.equal(
      identity,
      ['Title: The Ex Hex Duo', 'Author: Erin Sterling', 'Also known as: The Ex Hex'].join('\n'),
    );
  });

  it('is byte-for-byte the old prompt when there are no aliases', () => {
    const identity = buildResearchIdentity({
      title: 'Unsouled',
      authors: 'Will Wight',
      series: 'Cradle',
      fields: ['description'],
    });
    assert.equal(
      identity,
      [
        'Title: Unsouled',
        'Author: Will Wight',
        'Series (already recorded, treat as given): Cradle',
      ].join('\n'),
    );
  });

  it('de-duplicates and drops an alias that merely repeats the title', () => {
    const identity = buildResearchIdentity({
      title: 'Blackflame',
      authors: 'Will Wight',
      series: null,
      titleAliases: ['Blackflame', 'Cradle 3', 'Cradle 3', '  '],
      fields: ['seriesIndex'],
    });
    assert.equal(
      identity,
      ['Title: Blackflame', 'Author: Will Wight', 'Also known as: Cradle 3'].join('\n'),
    );
  });

  it('keeps aliases ahead of the recorded-series line', () => {
    const identity = buildResearchIdentity({
      title: 'A',
      authors: 'B',
      series: 'S',
      titleAliases: ['AKA'],
      fields: ['description'],
    });
    assert.equal(
      identity,
      ['Title: A', 'Author: B', 'Also known as: AKA', 'Series (already recorded, treat as given): S'].join(
        '\n',
      ),
    );
  });
});

describe('aliasAttribution — the run says which name paid off', () => {
  it('names the alias when the model matched on one', () => {
    assert.equal(
      aliasAttribution('The Ex Hex', 'The Ex Hex Duo'),
      'Identified as “The Ex Hex”.',
    );
  });

  it('is silent when the match was the catalogued title', () => {
    assert.equal(aliasAttribution('The Ex Hex Duo', 'The Ex Hex Duo'), null);
  });

  it('is silent when the model said nothing (null) or only whitespace', () => {
    assert.equal(aliasAttribution(null, 'Book'), null);
    assert.equal(aliasAttribution('   ', 'Book'), null);
  });

  it('withAttribution folds the sentence in front of the model note', () => {
    assert.equal(
      withAttribution('Filled in the series.', 'Identified as “The Ex Hex”.'),
      'Identified as “The Ex Hex”. Filled in the series.',
    );
    // No attribution → the note passes through untouched (including null).
    assert.equal(withAttribution('Just the note.', null), 'Just the note.');
    assert.equal(withAttribution(null, null), null);
    // Attribution but no note → the attribution stands alone.
    assert.equal(withAttribution(null, 'Identified as “X”.'), 'Identified as “X”.');
  });
});
