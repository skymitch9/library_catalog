/**
 * Cross-language drift guard for the TITLE/KEY functions (normalization item
 * 1), pinned to catalog-platform's data/title-key-fixtures.json — the LIBRARY
 * side of a contract that also runs in audiobook_catalog (Python: two module
 * ports; JS: site/reviews.js's own bookIdFromTitle, which is the canon for
 * that one function). This repo's titles.ts/reviews.ts are canon for every
 * OTHER function in the file.
 *
 * ⚠️ These functions produce PERSISTED keys — work.work_key and Firestore
 * review document ids. If a case here fails, someone changed normaliseTitle,
 * bookIdFromTitle, splitAuthors, workKeyFor, cleanAudiobookTitle,
 * cleanTitleWithSeries or splitSeriesPrefix — which is a MIGRATION, not an
 * edit. Do not update the fixture to match a new implementation; migrate the
 * stored keys first, in both repos, then regenerate the fixture from the
 * new canon.
 *
 * The file is materialised into packages/universes/generated/ by
 * scripts/sync-universes.mjs (pretest), same as the universe list and the
 * fold fixtures. If the read below throws ENOENT, the sync has not run —
 * `npm test` runs it for you; a bare tsx invocation does not.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  normaliseTitle,
  splitAuthors,
  workKeyFor,
  cleanAudiobookTitle,
  cleanTitleWithSeries,
  splitSeriesPrefix,
} from '../src/titles.js';
import { bookIdFromTitle } from '../src/reviews.js';

interface Fixtures {
  schemaVersion: number;
  titles: Array<{ raw: string; expect: string; why: string }>;
  bookIds: Array<{ raw: string; expect: string; why: string }>;
  splitAuthorsCases: Array<{ raw: string; expect: string[]; why: string }>;
  workKeyCases: Array<{ title: string; authors: string; expect: string; why: string }>;
  cleanAudiobookTitleCases: Array<{ raw: string; expect: string; why: string }>;
  cleanTitleWithSeriesCases: Array<{ raw: string; series: string | null; expect: string; why: string }>;
  splitSeriesPrefixCases: Array<{
    raw: string;
    expect: { series: string; title: string } | null;
    why: string;
  }>;
}

const fixtures = JSON.parse(
  readFileSync(new URL('../../universes/generated/title-key-fixtures.json', import.meta.url), 'utf8'),
) as Fixtures;

test('title-key fixtures: expected schema version', () => {
  assert.equal(fixtures.schemaVersion, 1);
});

test('title-key fixtures: the file is not empty (belt and braces against a truncated copy)', () => {
  const total =
    fixtures.titles.length +
    fixtures.bookIds.length +
    fixtures.splitAuthorsCases.length +
    fixtures.workKeyCases.length +
    fixtures.cleanAudiobookTitleCases.length +
    fixtures.cleanTitleWithSeriesCases.length +
    fixtures.splitSeriesPrefixCases.length;
  assert.ok(total >= 50, `expected >=50 fixture cases total, found ${total}`);
});

test('title-key fixtures: every normaliseTitle case reproduces', () => {
  for (const { raw, expect, why } of fixtures.titles) {
    assert.equal(normaliseTitle(raw), expect, `normaliseTitle(${JSON.stringify(raw)}) — ${why}`);
  }
});

test('title-key fixtures: every bookIdFromTitle case reproduces', () => {
  for (const { raw, expect, why } of fixtures.bookIds) {
    assert.equal(bookIdFromTitle(raw), expect, `bookIdFromTitle(${JSON.stringify(raw)}) — ${why}`);
  }
});

test('title-key fixtures: bookIdFromTitle and normaliseTitle disagree on leading articles, by design', () => {
  // The CRITICAL invariant the fixture file is built to protect: never assume
  // two functions agree on the same input, even when both are "title folds".
  const theCase = fixtures.titles.find((c) => c.raw === 'The Lake House');
  const bookIdCase = fixtures.bookIds.find((c) => c.raw === 'The Lake House');
  assert.ok(theCase && bookIdCase, 'fixture must carry "The Lake House" on both sides');
  assert.notEqual(theCase!.expect, bookIdCase!.expect.replace(/-/g, ' '));
  assert.equal(normaliseTitle('The Lake House'), 'lake house');
  assert.equal(bookIdFromTitle('The Lake House'), 'the-lake-house');
});

test('title-key fixtures: every splitAuthors case reproduces', () => {
  for (const { raw, expect, why } of fixtures.splitAuthorsCases) {
    assert.deepEqual(splitAuthors(raw), expect, `splitAuthors(${JSON.stringify(raw)}) — ${why}`);
  }
});

test('title-key fixtures: every workKeyFor case reproduces', () => {
  for (const { title, authors, expect, why } of fixtures.workKeyCases) {
    assert.equal(workKeyFor(title, authors), expect, `workKeyFor(${JSON.stringify(title)}, ${JSON.stringify(authors)}) — ${why}`);
  }
});

test('title-key fixtures: every cleanAudiobookTitle case reproduces', () => {
  for (const { raw, expect, why } of fixtures.cleanAudiobookTitleCases) {
    assert.equal(cleanAudiobookTitle(raw), expect, `cleanAudiobookTitle(${JSON.stringify(raw)}) — ${why}`);
  }
});

test('title-key fixtures: every cleanTitleWithSeries case reproduces', () => {
  for (const { raw, series, expect, why } of fixtures.cleanTitleWithSeriesCases) {
    assert.equal(
      cleanTitleWithSeries(raw, series),
      expect,
      `cleanTitleWithSeries(${JSON.stringify(raw)}, ${JSON.stringify(series)}) — ${why}`,
    );
  }
});

test('title-key fixtures: every splitSeriesPrefix case reproduces', () => {
  for (const { raw, expect, why } of fixtures.splitSeriesPrefixCases) {
    assert.deepEqual(splitSeriesPrefix(raw), expect, `splitSeriesPrefix(${JSON.stringify(raw)}) — ${why}`);
  }
});
