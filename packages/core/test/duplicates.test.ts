/**
 * The duplicate finder's fold — `duplicateKeyFor` and `groupDuplicates`.
 *
 * ⚠️ **The pair that must NOT fold is the point of this file.** A finder that
 * groups too eagerly is worse than none: every false pair is a person opening
 * two books, reading them, and closing them again, and after three of those
 * nobody opens the fourth. The tests below therefore come in twos — a pair that
 * must fold together, and its nearest neighbour that must not.
 *
 * ⚠️ Also pinned: **two copies of one book is not a duplicate.** That is the
 * owner's own scoping answer and the one thing the board-game filter this
 * feature mimics does the opposite way (`duplicates.ts` carries the table).
 * `copyCount: 2` appears on a single work below and must never produce a group.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { UNKNOWN_AUTHOR } from '../src/constants.js';
import {
  duplicateKeyFor,
  groupDuplicates,
  type DuplicateCandidate,
} from '../src/duplicates.js';
import { workKeyFor } from '../src/titles.js';

let nextId = 1;

/** A work as `listDuplicateCandidates` hands it over. */
function work(
  title: string,
  authors: string,
  extra: Partial<DuplicateCandidate> = {},
): DuplicateCandidate {
  return {
    id: nextId++,
    title,
    subtitle: null,
    authors,
    series: null,
    copyCount: 1,
    ...extra,
  };
}

/** The titles in each group, groups in the order they came back. */
function titles(groups: ReturnType<typeof groupDuplicates>): string[][] {
  return groups.map((g) => g.works.map((w) => w.title));
}

describe('duplicateKeyFor', () => {
  it('is looser than work_key: the series suffix goes', () => {
    const bare = duplicateKeyFor('Firefight', null, 'Brandon Sanderson');
    const decorated = duplicateKeyFor(
      'Firefight (The Reckoners, Book 2)',
      null,
      'Brandon Sanderson',
    );

    assert.equal(bare, decorated);
    // …and the stored key, which this must be looser than, does NOT agree.
    assert.notEqual(
      workKeyFor('Firefight', 'Brandon Sanderson'),
      workKeyFor('Firefight (The Reckoners, Book 2)', 'Brandon Sanderson'),
    );
  });

  it('keeps the author half, so two books called Gold stay apart', () => {
    // `matching.ts`'s header: there are dozens of books called "Gold", and a
    // title-only fold across a book catalog is the failure that made this
    // catalog key on (title, author) in the first place.
    assert.notEqual(
      duplicateKeyFor('Gold', null, 'Chris Cleave'),
      duplicateKeyFor('Gold', null, 'Isaac Asimov'),
    );
  });

  it('uses the series name when there is one', () => {
    assert.equal(
      duplicateKeyFor('Warbreaker - Cosmere', 'Cosmere', 'Brandon Sanderson'),
      duplicateKeyFor('Warbreaker', null, 'Brandon Sanderson'),
    );
  });

  it('never folds a title away to nothing', () => {
    // "Dune", series "Dune" — stripping the series would leave an empty title
    // half, which makes the key author-only and collides across everything that
    // author wrote. `cleanTitleWithSeries` guards it; this pins that it stays.
    const key = duplicateKeyFor('Dune', 'Dune', 'Frank Herbert');
    assert.equal(key, workKeyFor('Dune', 'Frank Herbert'));
    assert.ok(key.startsWith('dune|'));
  });

  it('a bare trailing number is part of the title, not a volume', () => {
    // `cleanAudiobookTitle`'s measured rule: Eric Vall's books really are
    // called "Summoner 6", and stripping the numeral turns six works into one.
    assert.notEqual(
      duplicateKeyFor('Summoner 6', null, 'Eric Vall'),
      duplicateKeyFor('Summoner 5', null, 'Eric Vall'),
    );
  });
});

describe('groupDuplicates', () => {
  it('folds a decorated title onto its bare twin', () => {
    const groups = groupDuplicates([
      work('Firefight', 'Brandon Sanderson'),
      work('Firefight (The Reckoners, Book 2)', 'Brandon Sanderson'),
    ]);

    assert.equal(groups.length, 1);
    assert.deepEqual(titles(groups), [
      ['Firefight', 'Firefight (The Reckoners, Book 2)'],
    ]);
  });

  it('⚠️ does NOT fold a near-pair: same title, different author', () => {
    const groups = groupDuplicates([
      work('Gold', 'Chris Cleave'),
      work('Gold', 'Isaac Asimov'),
    ]);

    assert.deepEqual(groups, []);
  });

  it('⚠️ does NOT fold a near-pair: consecutive volumes of one series', () => {
    // The most dangerous false positive on a real shelf, because the two rows
    // look almost identical in a list.
    const groups = groupDuplicates([
      work('Mistborn: The Final Empire', 'Brandon Sanderson', { series: 'Mistborn' }),
      work('Mistborn: The Well of Ascension', 'Brandon Sanderson', { series: 'Mistborn' }),
    ]);

    assert.deepEqual(groups, []);
  });

  it('⚠️ two copies of one book is not a duplicate', () => {
    // The owner's scoping answer, and the exact question the board-game
    // filter asks instead. One row, two copies, no group.
    const groups = groupDuplicates([
      work('The Hobbit', 'J.R.R. Tolkien', { copyCount: 2 }),
    ]);

    assert.deepEqual(groups, []);
  });

  it('a work on its own never becomes a group', () => {
    assert.deepEqual(groupDuplicates([work('Elantris', 'Brandon Sanderson')]), []);
    assert.deepEqual(groupDuplicates([]), []);
  });

  it('catches an exact work_key duplicate the loose fold would have split', () => {
    // ⚠️ The hole `groupDuplicates` merges on both keys to close. Both rows
    // carry the identical stored `work_key` — the least deniable duplicate
    // there is — but disagree about `series`, so `cleanTitleWithSeries` strips
    // the tail from one and not the other.
    const a = work('Warbreaker - Cosmere', 'Brandon Sanderson', { series: 'Cosmere' });
    const b = work('Warbreaker - Cosmere', 'Brandon Sanderson', { series: null });

    assert.equal(
      workKeyFor(a.title, a.authors),
      workKeyFor(b.title, b.authors),
      'the fixture must actually share a stored key, or this test proves nothing',
    );
    assert.notEqual(
      duplicateKeyFor(a.title, a.series, a.authors),
      duplicateKeyFor(b.title, b.series, b.authors),
      'the fixture must actually split under the loose fold, or this test proves nothing',
    );

    assert.equal(groupDuplicates([a, b]).length, 1);
  });

  it('merges transitively across the two keys', () => {
    const a = work('Warbreaker - Cosmere', 'Brandon Sanderson', { series: 'Cosmere' });
    const b = work('Warbreaker - Cosmere', 'Brandon Sanderson', { series: null });
    const c = work('Warbreaker', 'Brandon Sanderson', { series: null });

    const groups = groupDuplicates([a, b, c]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.works.length, 3);
  });

  it('authorless books fold on the sentinel, not onto real Unknowns', () => {
    // `workKeyFor`'s `?unknown` branch is the whole collision proof here:
    // normaliseTitle('Unknown') === normaliseTitle('?unknown') === 'unknown'.
    const groups = groupDuplicates([
      work('The Golden Goose', UNKNOWN_AUTHOR),
      work('The Golden Goose', UNKNOWN_AUTHOR),
      work('The Golden Goose', 'Unknown'),
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.works.length, 2);
    assert.deepEqual(
      groups[0]?.works.map((w) => w.authors),
      [UNKNOWN_AUTHOR, UNKNOWN_AUTHOR],
    );
  });

  it('largest group first, and oldest row first inside it', () => {
    const groups = groupDuplicates([
      work('Elantris', 'Brandon Sanderson'),
      work('Elantris (Cosmere, Book 1)', 'Brandon Sanderson'),
      work('Firefight', 'Brandon Sanderson'),
      work('Firefight (The Reckoners, Book 2)', 'Brandon Sanderson'),
      work('Firefight - The Reckoners, Book 2', 'Brandon Sanderson'),
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.works.length, 3);
    assert.equal(groups[1]?.works.length, 2);
    // Ascending id inside a group — the oldest row is usually the keeper.
    const ids = groups[0]?.works.map((w) => w.id) ?? [];
    assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
  });
});
