/**
 * The fold, pinned to catalog-platform's data/match-fold.fixtures.json — the
 * LIBRARY side of the two-repo contract.
 *
 * The shared index Worker (catalog-platform/apps/index-worker) computes
 * `work_fold` on write, and that fold replicates what this repo's `work_key`
 * means — the join to ~870 cross-catalog reviews. Its implementation is a port
 * of `normaliseTitle`/`primaryAuthor`; this file is what makes drift between
 * the two a loud CI failure instead of a silent join failure. The index side
 * runs the SAME fixture file in its own suite.
 *
 * ⚠️ If a case fails HERE, someone changed `normaliseTitle` or
 * `splitAuthors`/`primaryAuthor` — which is a MIGRATION, not an edit (stored
 * `work_key` rows and Firestore doc ids depend on the fold). The fixture is
 * the record of what stored keys already mean; do not update it to match a
 * new implementation without migrating both this repo's keys and the index.
 *
 * The file is materialised into packages/universes/generated/ by
 * scripts/sync-universes.mjs (pretest), same as the universe list. If the
 * read below throws ENOENT, the sync has not run — `npm test` runs it for
 * you; a bare tsx invocation does not.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normaliseTitle, primaryAuthor } from '../src/titles.js';

interface TitleCase {
  raw: string;
  fold: string;
  why: string;
}
interface AuthorCase {
  raw: string;
  primary: string;
  fold: string;
  why: string;
}

const fixtures = JSON.parse(
  readFileSync(new URL('../../universes/generated/match-fold.fixtures.json', import.meta.url), 'utf8'),
) as { schemaVersion: number; titles: TitleCase[]; authors: AuthorCase[] };

test('fold fixtures: expected schema version', () => {
  assert.equal(fixtures.schemaVersion, 1);
});

test('fold fixtures: every title case reproduces through normaliseTitle', () => {
  assert.ok(fixtures.titles.length > 0);
  for (const { raw, fold, why } of fixtures.titles) {
    assert.equal(normaliseTitle(raw), fold, `normaliseTitle(${JSON.stringify(raw)}) — ${why}`);
  }
});

test('fold fixtures: every author case reproduces through primaryAuthor + normaliseTitle', () => {
  assert.ok(fixtures.authors.length > 0);
  for (const { raw, primary, fold, why } of fixtures.authors) {
    assert.equal(primaryAuthor(raw), primary, `primaryAuthor(${JSON.stringify(raw)}) — ${why}`);
    assert.equal(normaliseTitle(primaryAuthor(raw)), fold, `fold of primaryAuthor(${JSON.stringify(raw)}) — ${why}`);
  }
});

test('fold fixtures: the empty-fold class stays covered', () => {
  // The one behaviour the index Worker's whole refusal design rests on: a
  // wholly non-Latin title folds to ''. If someone trims these cases from the
  // fixture file, the pin silently vanishes — so their presence is itself
  // asserted, the same belt-and-braces the index side wears.
  assert.ok(fixtures.titles.some((t) => t.fold === ''), 'no empty-fold title fixture left');
  assert.ok(fixtures.authors.some((a) => a.fold === ''), 'no empty-fold author fixture left');
});
