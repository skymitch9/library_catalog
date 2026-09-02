/**
 * The hand-reviewed cross-catalog joins — this side of the file.
 *
 * ⚠️ WHY THESE EXIST. The four rows the overrides file names already resolve on
 * this side, and they resolve through TWO `work_alias` rows that nothing marks
 * as load-bearing. Measured against production 2026-09-02: work 230 reaches
 * *The Wandering Inn* audiobook only because an alias "The Wandering Inn" is
 * recorded on it, and work 232 reaches *Fae and Fare* the same way. Delete
 * either alias, or tighten the matcher, and two of the owner's four acceptance
 * links vanish with nothing failing anywhere. `checkCuratedLinks` is what fails.
 *
 * The pure logic is tested here; `npm run check:cross-links -- --remote` is the
 * same logic pointed at a live database. That one is deliberately NOT in this
 * suite — a unit suite that reaches production is a suite nobody can run
 * offline.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  OVERRIDES_PATH,
  checkCuratedLinks,
  loadCuratedOverrides,
} from '../lib/cross-catalog-overrides.mjs';

const BOOK1 = 'The Wandering Inn - The Wandering Inn, Book 1';
const BOOK2 = 'Fae and Fare - The Wandering Inn, Book 2';

/** Four pairs, as the shipped file states them. */
const PAIRS = [
  { audiobookTitle: BOOK1, libraryWorkId: 229, libraryTitle: 'The Wandering Inn', format: 'Paperback' },
  { audiobookTitle: BOOK1, libraryWorkId: 230, libraryTitle: 'No Killing Goblins', format: 'Paperback' },
  { audiobookTitle: BOOK2, libraryWorkId: 231, libraryTitle: 'Fae and Fare', format: 'Paperback' },
  { audiobookTitle: BOOK2, libraryWorkId: 232, libraryTitle: 'Immortal Games', format: 'Paperback' },
];

const ALL_WORKS = [229, 230, 231, 232].map((id) => ({ id }));
const ALL_HOLDINGS = PAIRS.map((p) => ({
  work_id: p.libraryWorkId,
  audio_key: p.audiobookTitle,
  stale_at: null,
}));

describe('checkCuratedLinks — the three verdicts', () => {
  it('all four resolve when the works exist and hold live rows', () => {
    const r = checkCuratedLinks(PAIRS, ALL_WORKS, ALL_HOLDINGS);
    assert.equal(r.resolved.length, 4);
    assert.equal(r.unresolved.length, 0);
    assert.equal(r.unknownWorkId.length, 0);
  });

  it('an id that names no work is a DEAD LINK, not merely unresolved', () => {
    // 🔴 The distinction is the whole point: the sibling site is shipping a
    // live link to a "Not a page" screen. That is a different emergency from a
    // link that renders nothing on this side, and it has a different fix.
    const r = checkCuratedLinks(PAIRS, [{ id: 229 }, { id: 231 }], ALL_HOLDINGS);
    assert.deepEqual(r.unknownWorkId.map((o) => o.libraryWorkId), [230, 232]);
    assert.equal(r.unresolved.length, 0);
  });

  it('a work with no holding row is UNRESOLVED — the alias-deleted case', () => {
    const holdings = ALL_HOLDINGS.filter((h) => h.work_id !== 230);
    const r = checkCuratedLinks(PAIRS, ALL_WORKS, holdings);
    assert.deepEqual(r.unresolved.map((o) => o.libraryWorkId), [230]);
    assert.equal(r.resolved.length, 3);
  });

  it('a STALE holding does not count as resolved', () => {
    // `stale_at` means the sibling catalogue no longer confirms the match. The
    // work page still shows it with a caveat, but a reviewed link resting on a
    // withdrawn match is exactly the drift this check exists to surface.
    const holdings = ALL_HOLDINGS.map((h) =>
      h.work_id === 232 ? { ...h, stale_at: '2026-09-02T00:00:00Z' } : h,
    );
    const r = checkCuratedLinks(PAIRS, ALL_WORKS, holdings);
    assert.deepEqual(r.unresolved.map((o) => o.libraryWorkId), [232]);
  });

  it('matches the audiobook title VERBATIM, never loosely', () => {
    // A curated row is a claim about ONE row of the sibling catalogue. Folding
    // or trimming here would let it claim a family of them — the failure the
    // whole mechanism exists to avoid rather than reproduce.
    const holdings = ALL_HOLDINGS.map((h) =>
      h.work_id === 229 ? { ...h, audio_key: 'the wandering inn' } : h,
    );
    const r = checkCuratedLinks(PAIRS, ALL_WORKS, holdings);
    assert.deepEqual(r.unresolved.map((o) => o.libraryWorkId), [229]);
  });

  it('an id held by another work does not satisfy the pair', () => {
    // Pairing is (work, audiobook), not either half alone. A holding on the
    // wrong work is not a resolution of this one.
    const holdings = [{ work_id: 231, audio_key: BOOK1, stale_at: null }];
    const r = checkCuratedLinks(PAIRS, ALL_WORKS, holdings);
    assert.equal(r.resolved.length, 0);
    assert.equal(r.unresolved.length, 4);
  });
});

describe('loadCuratedOverrides — reading the sibling checkout', () => {
  it('reads the SHIPPED file when the sibling is next door', (t) => {
    // ⚠️ Skipped rather than failed on a checkout without the sibling (a git
    // worktree lands three directories too deep — see AUDIOBOOK_ROOT's header).
    // A skip says "not checked"; a pass would say "checked and fine", which is
    // the silent-staleness trap this project keeps writing rules about.
    if (!existsSync(OVERRIDES_PATH)) {
      t.skip(`${OVERRIDES_PATH} not present — set LC_AUDIOBOOK_ROOT`);
      return;
    }
    const rows = loadCuratedOverrides();

    // The owner asked for exactly these four and NOTHING else curated
    // (2026-09-02). A fifth row arriving without this number being updated is a
    // curation nobody reviewed, which is the one thing this must not become.
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.libraryWorkId), [229, 230, 231, 232]);
    assert.deepEqual(
      rows.filter((r) => r.audiobookTitle === BOOK1).map((r) => r.libraryWorkId),
      [229, 230],
    );
    assert.deepEqual(
      rows.filter((r) => r.audiobookTitle === BOOK2).map((r) => r.libraryWorkId),
      [231, 232],
    );
    // The owner's spec, 2026-08-14: every entry says the form the media is in.
    assert.ok(rows.every((r) => r.format));
    // Provenance, never hidden — a reviewed row states when a person last
    // stood behind it.
    assert.ok(rows.every((r) => r.reviewedOn));
  });

  it('points at the sibling checkout, not at a copy in this repo', () => {
    // ⚠️ ONE HOME. A second copy here would be a second home for one fact, and
    // the two would drift the first time somebody edited one of them. This
    // asserts the path leaves this repo, which is the only structural way to
    // notice a well-meaning "let's vendor it" change.
    assert.ok(
      OVERRIDES_PATH.replace(/\\/g, '/').endsWith('audiobook_catalog/site/cross-catalog-overrides.json'),
      `expected the sibling checkout, got ${OVERRIDES_PATH}`,
    );
  });
});
