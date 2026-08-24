/**
 * What the duplicates view SAYS — the empty state above all.
 *
 * ## Why the empty state is the test worth writing
 *
 * It is the sentence the owner sees on the day the feature works perfectly,
 * and it is the one place this screen can silently lie. "No duplicates" is
 * indistinguishable from a finder that looked at nothing, filtered itself down
 * to zero rows, or failed and swallowed the error — the silent-wrong-guess the
 * collection page writes notes about everywhere else. Saying *what it looked
 * at* is what turns "none" into evidence, so the count is pinned here rather
 * than left to be noticed missing.
 *
 * ⚠️ These are pure string functions in `src/lib/` on purpose: this app's tests
 * run under `node:test` with no DOM, so a sentence written inline in JSX is a
 * sentence nothing can pin. That is the same reason `details-outstanding.ts`
 * and `residue-sentence.ts` exist as libraries.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { UNKNOWN_AUTHOR } from '@lc/core';

import {
  duplicateAuthorLabel,
  duplicateRowDetail,
  duplicatesEmptyMessage,
  duplicatesSummary,
} from '../src/lib/duplicates-view.js';
import type { DuplicateGroupView, DuplicateWork } from '../src/api.js';

const work = (over: Partial<DuplicateWork> = {}): DuplicateWork => ({
  id: 1,
  title: 'Firefight',
  subtitle: null,
  authors: 'Brandon Sanderson',
  series: null,
  copyCount: 1,
  ...over,
});

const group = (...works: DuplicateWork[]): DuplicateGroupView => ({
  key: 'firefight|brandon sanderson',
  works,
});

describe('duplicatesEmptyMessage', () => {
  it('names how many works were looked at', () => {
    assert.equal(
      duplicatesEmptyMessage(1143),
      'No duplicates found across 1,143 works.',
    );
  });

  it('⚠️ says the number even when it is zero — an empty catalog is not a clean one', () => {
    assert.equal(duplicatesEmptyMessage(0), 'No duplicates found across 0 works.');
  });

  it('agrees with itself about one', () => {
    assert.equal(duplicatesEmptyMessage(1), 'No duplicates found across 1 work.');
  });
});

describe('duplicatesSummary', () => {
  it('counts records and groups apart — a group of three is one decision', () => {
    const groups = [
      group(work({ id: 1 }), work({ id: 2 }), work({ id: 3 })),
      group(work({ id: 4 }), work({ id: 5 })),
    ];
    assert.equal(duplicatesSummary(groups), '5 records to look at, in 2 groups.');
  });

  it('singular reads as a sentence', () => {
    assert.equal(
      duplicatesSummary([group(work({ id: 1 }), work({ id: 2 }))]),
      '2 records to look at, in 1 group.',
    );
  });
});

describe('duplicateAuthorLabel', () => {
  it('⚠️ the sentinel becomes words here and nowhere else', () => {
    assert.equal(duplicateAuthorLabel(UNKNOWN_AUTHOR), 'Author unknown');
  });

  it('a real author is shown as recorded', () => {
    assert.equal(duplicateAuthorLabel('Brandon Sanderson'), 'Brandon Sanderson');
  });
});

describe('duplicateRowDetail', () => {
  it('shows the fields that tell two records in a group apart', () => {
    assert.equal(
      duplicateRowDetail(work({ subtitle: 'The Reckoners', series: 'Reckoners', copyCount: 2 })),
      'The Reckoners · Reckoners · 2 copies',
    );
  });

  it('a record with no copy says so rather than showing a bare zero', () => {
    assert.equal(duplicateRowDetail(work({ copyCount: 0 })), 'no copies');
  });

  it('never leaves a lonely separator', () => {
    const detail = duplicateRowDetail(work());
    assert.equal(detail, '1 copy');
    assert.ok(!detail.startsWith('·'));
    assert.ok(!detail.endsWith('·'));
  });
});
