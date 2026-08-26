/**
 * `lib/tbr-search.ts` — the `/tbr` search box, and therefore the wheel's pool.
 *
 * Owner, 2026-08-26: *"can we also add a search bar in the /tbr route too so
 * people can search tbr books there too with the wheel"*.
 *
 * ## ⚠️ The property that matters most is a REFUSAL
 *
 * `narrowTbrGroups` must match a group under **every spelling it was recorded
 * under**, not just the one on the card. A book folded from a paperback entry
 * (*Firefight*) and an audiobook entry (*Firefight - The Reckoners, Book 2*)
 * carries both, and somebody typing "reckoners" means that book. Searching only
 * the displayed title would HIDE it — the same trap the audiobook site's own
 * `matchTitles` records in its comment: *"folding the MATCH set would HIDE a
 * book rather than stop repeating it"*.
 *
 * ## ⚠️ And the second is that this is NOT a matcher
 *
 * A search box is a substring test a person typed. `tbrFoldKey` and
 * `matching.ts` decide whether two records are the same BOOK and are strict
 * about it on purpose; being generous here costs an extra row on screen, which
 * the person can see. The two must not converge.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TbrFoldable, TbrGroup } from '@lc/core';

import {
  narrowTbrGroups,
  noTbrMatchSentence,
  tbrSearchCountSentence,
} from '../src/lib/tbr-search.js';

type Row = TbrFoldable & { series?: string | null; workTitle?: string | null };

/** One folded group, with only the fields the search reads. */
function group(
  key: string,
  title: string,
  authors: string | null,
  entries: Partial<Row>[] = [],
): TbrGroup<Row> {
  return {
    key,
    entries: entries.map((e, i) => ({
      docId: `${key}-${i}`,
      bookId: key,
      workKey: null,
      ...e,
    })) as Row[],
    docIds: entries.map((_, i) => `${key}-${i}`),
    workId: null,
    readState: null,
    title,
    authors,
    workCoverUrl: null,
    docCoverUrl: null,
    formats: { physical: null, audio: null, ebook: null },
  };
}

const GROUPS: TbrGroup<Row>[] = [
  group('firefight', 'Firefight', 'Brandon Sanderson', [
    { title: 'Firefight', workTitle: 'Firefight', series: 'The Reckoners' },
    // The audiobook site's own spelling of the same book.
    { title: 'Firefight - The Reckoners, Book 2', authors: 'Brandon Sanderson' },
  ]),
  group('warbreaker', 'Warbreaker', 'Brandon Sanderson', [{ title: 'Warbreaker' }]),
  group('the-cafe', 'The Café at the End of the World', 'Ana Reyes', [
    { title: 'The Café at the End of the World' },
  ]),
  group('gold', 'Gold', 'Chris Cleave', [{ title: 'Gold' }]),
];

describe('narrowTbrGroups', () => {
  it('an empty query returns everything, in the same order', () => {
    assert.deepEqual(narrowTbrGroups(GROUPS, '').map((g) => g.key), GROUPS.map((g) => g.key));
    assert.deepEqual(narrowTbrGroups(GROUPS, '   ').map((g) => g.key), GROUPS.map((g) => g.key));
  });

  it('matches the title, case-insensitively', () => {
    assert.deepEqual(narrowTbrGroups(GROUPS, 'WARBREAK').map((g) => g.key), ['warbreaker']);
  });

  it('matches the author', () => {
    assert.deepEqual(
      narrowTbrGroups(GROUPS, 'sanderson').map((g) => g.key),
      ['firefight', 'warbreaker'],
    );
  });

  it('⚠️ matches EVERY spelling the group was recorded under', () => {
    // The audiobook packaging is not on the card, and typing it must still
    // find the book. Folding the match set would hide it.
    assert.deepEqual(narrowTbrGroups(GROUPS, 'reckoners, book 2').map((g) => g.key), ['firefight']);
  });

  it('matches the series, which is usually not in the title at all', () => {
    // The same reason the collection's `?q=` searches `w.series`: before that
    // clause, `?q=cradle` returned zero rows over six Cradle books.
    assert.deepEqual(narrowTbrGroups(GROUPS, 'reckoners').map((g) => g.key), ['firefight']);
  });

  it('⚠️ every token must match — AND, not OR', () => {
    // OR would widen with every word typed, so the list would grow as the
    // person refined it. Nothing here is by both authors.
    assert.deepEqual(narrowTbrGroups(GROUPS, 'sanderson firefight').map((g) => g.key), ['firefight']);
    assert.deepEqual(narrowTbrGroups(GROUPS, 'sanderson reyes'), []);
  });

  it('tokens may match different fields — "sanderson reckoners" is one book', () => {
    assert.deepEqual(narrowTbrGroups(GROUPS, 'sanderson reckoners').map((g) => g.key), ['firefight']);
  });

  it('ignores accents and punctuation, both ways round', () => {
    assert.deepEqual(narrowTbrGroups(GROUPS, 'cafe').map((g) => g.key), ['the-cafe']);
    assert.deepEqual(narrowTbrGroups(GROUPS, 'café').map((g) => g.key), ['the-cafe']);
  });

  it('a query nothing answers to returns an empty list, not everything', () => {
    assert.deepEqual(narrowTbrGroups(GROUPS, 'zzzz'), []);
  });

  it('⚠️ does not mutate or reorder the input', () => {
    const before = GROUPS.map((g) => g.key);
    narrowTbrGroups(GROUPS, 'sanderson');
    assert.deepEqual(GROUPS.map((g) => g.key), before);
  });
});

describe('the sentences under the box', () => {
  it('⚠️ an empty result says the list is still there, and how big it is', () => {
    const msg = noTbrMatchSentence('zzzz', 40);
    assert.ok(msg);
    assert.match(msg, /zzzz/);
    assert.match(msg, /40 books are still there/);
    assert.match(msg, /clear the box/i);
  });

  it('reads singularly for a one-book list', () => {
    const msg = noTbrMatchSentence('zzzz', 1);
    assert.ok(msg);
    assert.match(msg, /1 book is still there/);
  });

  it('says nothing when nothing was typed — that is the page’s own empty state', () => {
    assert.equal(noTbrMatchSentence('', 40), null);
    assert.equal(noTbrMatchSentence('   ', 40), null);
  });

  it('the count sentence appears only while a search is actually narrowing', () => {
    assert.equal(tbrSearchCountSentence('', 40, 40), null);
    assert.equal(tbrSearchCountSentence('sanderson', 40, 40), null);
    assert.equal(tbrSearchCountSentence('sanderson', 3, 40), 'Showing 3 of 40 books on your list.');
  });
});
