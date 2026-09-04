/**
 * The scan-time SHELF/WISHLIST switch — the choice, its persistence, the status
 * it writes, and the words a row says afterwards.
 *
 * The owner's ask, 2026-09-04, verbatim: *"I didn't see how to scan a book to
 * add wishlist. We should add this feature to the scanner."* Then: *"Yes build
 * it. We currently can't add to wishlist at all."*
 *
 * ## ⚠️ THE PROPERTIES WORTH A TEST
 *
 *  1. **`shelf` is the default** — including when storage is empty, absent,
 *     unreadable, or holds a word this build has never offered. That is the
 *     same compatibility promise `scan-format.ts` makes: it is what every scan
 *     has written since the barcode path existed, and a wishlist target that
 *     leaked into a later session would silently stop recording books that are
 *     physically in somebody's hands.
 *  2. **`copyStatusFor` never yields `preordered`.** A pre-order is a want
 *     somebody has already paid for; a barcode in a shop is not evidence of a
 *     payment. The type says so and this pins the values.
 *  3. **A stored value is validated on read.** `sessionStorage` is
 *     user-writable and survives a build that offered different options.
 *  4. **`addedLabel` gives each outcome its own words, in the right
 *     precedence.** "Added" over a want would claim a book is on the shelf, and
 *     "Added to wishlist" over a received pre-order would report the very thing
 *     the pre-order prompt exists to prevent.
 *
 * Component behaviour is deliberately NOT tested here — this app has no jsdom
 * setup, which is why every decision above was put in a module a `node:test`
 * process can import.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  DEFAULT_SCAN_TARGET,
  SCAN_TARGETS,
  addActionLabel,
  addedLabel,
  copyStatusFor,
  intentFor,
  isScanTarget,
  loadScanTarget,
  saveScanTarget,
  targetSentence,
} from '../src/lib/scan-target.js';

/**
 * A sessionStorage stand-in. Node has none, and the module is written to
 * survive its absence — so the "no storage at all" case below runs against the
 * REAL absence rather than a mock pretending to throw.
 */
function withStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

const KEY = 'lc_scan_target_v1';

describe('the target itself', () => {
  it('offers exactly two, and shelf is the default', () => {
    assert.deepEqual([...SCAN_TARGETS], ['shelf', 'wishlist']);
    assert.equal(DEFAULT_SCAN_TARGET, 'shelf');
  });

  it('maps to a copy status, and never to preordered', () => {
    assert.equal(copyStatusFor('shelf'), 'owned');
    assert.equal(copyStatusFor('wishlist'), 'wanted');
    // ⚠️ The whole point of the assertion: a barcode in a shop is not evidence
    // that anything was paid for. See WISHLIST_STATUSES in @lc/core.
    for (const t of SCAN_TARGETS) assert.notEqual(copyStatusFor(t), 'preordered');
  });

  it('defaults the manual-add intent from the same choice', () => {
    assert.equal(intentFor('shelf'), 'owned');
    assert.equal(intentFor('wishlist'), 'wanted');
  });

  it('recognises only the two words', () => {
    assert.equal(isScanTarget('shelf'), true);
    assert.equal(isScanTarget('wishlist'), true);
    assert.equal(isScanTarget('owned'), false);
    assert.equal(isScanTarget(''), false);
    assert.equal(isScanTarget(null), false);
    assert.equal(isScanTarget(undefined), false);
    assert.equal(isScanTarget(7), false);
  });
});

describe('remembering it for the session', () => {
  it('reads back what was written', () => {
    const store = withStorage();
    saveScanTarget('wishlist');
    assert.equal(store.get(KEY), 'wishlist');
    assert.equal(loadScanTarget(), 'wishlist');
  });

  it('falls back to shelf when nothing is stored', () => {
    withStorage();
    assert.equal(loadScanTarget(), 'shelf');
  });

  it('falls back to shelf when the stored value is not a target', () => {
    // ⚠️ storage is user-writable and survives a build that offered other
    // options — an unvalidated read would drive the switch into a state it
    // cannot render and write a status the schema would refuse.
    withStorage({ [KEY]: 'preordered' });
    assert.equal(loadScanTarget(), 'shelf');
  });

  it('falls back to shelf with NO storage at all, and saving does not throw', () => {
    // The real absence, not a mock: `globalThis.sessionStorage` is undefined
    // here, which is what a private-mode browser's throwing accessor amounts
    // to from this module's point of view.
    assert.equal(loadScanTarget(), 'shelf');
    assert.doesNotThrow(() => saveScanTarget('wishlist'));
  });
});

describe('what the screen says', () => {
  it('names the action on the button', () => {
    assert.equal(addActionLabel('shelf'), 'Add');
    assert.equal(addActionLabel('shelf', true), 'Add 2nd copy');
    // ⚠️ "Add 2nd copy" must not survive onto a wishlist sweep: the button
    // would name a write it no longer performs.
    assert.equal(addActionLabel('wishlist'), 'Add to wishlist');
    assert.equal(addActionLabel('wishlist', true), 'Add to wishlist');
  });

  it('says where books will land, in the subject the tab is about', () => {
    assert.equal(targetSentence('shelf'), 'Scanned books go on your shelf.');
    assert.match(targetSentence('wishlist'), /^Scanned books go on your wishlist/);
    assert.match(targetSentence('wishlist', 'Books you add'), /^Books you add go on your wishlist/);
  });
});

describe('what a settled row says it did', () => {
  const base = { target: 'shelf' as const, arrived: false, summary: null, owned: false };

  it('gives a wishlist add its own words', () => {
    assert.equal(addedLabel({ ...base, target: 'wishlist' }), 'Added to wishlist');
    assert.equal(addedLabel({ ...base, target: 'wishlist', owned: true }), 'Added to wishlist');
  });

  it('leaves the shelf wording exactly as it was', () => {
    assert.equal(addedLabel(base), 'Added');
    assert.equal(addedLabel({ ...base, owned: true }), 'Copy added');
    assert.equal(addedLabel({ ...base, summary: 'ISBN recorded' }), 'ISBN recorded');
    assert.equal(addedLabel({ ...base, arrived: true }), 'Pre-order received');
  });

  it('lets what HAPPENED outrank what was intended', () => {
    // ⚠️ Neither of these is reachable from the wishlist path today (the
    // pre-order and rescan questions are both skipped there). Pinned anyway:
    // if one ever becomes reachable, reporting the intent over the outcome is
    // the failure the pre-order prompt was built to prevent.
    assert.equal(
      addedLabel({ target: 'wishlist', arrived: true, summary: null, owned: false }),
      'Pre-order received',
    );
    assert.equal(
      addedLabel({ target: 'wishlist', arrived: false, summary: 'ISBN recorded', owned: false }),
      'ISBN recorded',
    );
  });
});
