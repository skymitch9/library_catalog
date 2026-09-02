/**
 * The scan-time format toggle — the choice, its persistence, and the rule that
 * decides whether the row says anything at all.
 *
 * Kiro's ask, recorded verbatim in `docs/TODO.md` 2026-08-22 and built
 * 2026-09-02: *"scan-time toggle (default PB, one-tap to change) + GABI
 * research confirmation with auto-open persistence"*.
 *
 * ## ⚠️ THE THREE PROPERTIES WORTH A TEST
 *
 *  1. **`paperback` is still the default**, including when storage is empty,
 *     unreadable, or holds something this build has never offered. That is a
 *     compatibility promise, not a preference: it is what every scan has
 *     written since the feature existed.
 *  2. **The confirmation is SILENT when the two agree**, and silent when the
 *     lookup said nothing. A confirmation that fires on every row is a banner
 *     people learn to scroll past.
 *  3. **A stored value is validated on read.** localStorage is user-writable
 *     and survives a build that offered different options; an unvalidated read
 *     drives the toggle into a state it cannot render and writes a format the
 *     schema would refuse.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { PHYSICAL_FORMATS } from '@lc/core';
import {
  DEFAULT_SCAN_FORMAT,
  SCAN_FORMATS,
  formatDisagreement,
  isScanFormat,
  loadScanFormat,
  saveScanFormat,
} from '../src/lib/scan-format.js';

/**
 * A localStorage stand-in. Node has none, and the module is deliberately
 * written to survive its absence — so the "no storage at all" case below runs
 * against the REAL absence rather than a mock pretending to throw.
 */
function withStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('what the toggle may offer', () => {
  it('⚠️ is PHYSICAL_FORMATS itself, never a second copy of the list', () => {
    // A fourth physical format added to core must land here without anybody
    // remembering — the same rule `editionMedium` states in @lc/core.
    assert.deepEqual([...SCAN_FORMATS], [...PHYSICAL_FORMATS]);
  });

  it('offers no ebook format and no licence — a scan is an object in a hand', () => {
    for (const f of SCAN_FORMATS) {
      assert.ok(!f.startsWith('ebook'), `${f} must not be offered at scan time`);
    }
  });

  it('defaults to paperback — the compatibility promise, not a preference', () => {
    assert.equal(DEFAULT_SCAN_FORMAT, 'paperback');
  });

  it('isScanFormat admits the three and refuses everything else', () => {
    assert.ok(isScanFormat('hardcover'));
    assert.ok(isScanFormat('mass_market'));
    assert.ok(!isScanFormat('ebook_kindle'));
    assert.ok(!isScanFormat('leatherbound'));
    assert.ok(!isScanFormat(''));
    assert.ok(!isScanFormat(null));
    assert.ok(!isScanFormat(undefined));
  });
});

describe('persistence — "auto-open persistence", read conservatively', () => {
  beforeEach(() => withStorage());

  it('a fresh browser opens on paperback', () => {
    assert.equal(loadScanFormat(), 'paperback');
  });

  it('round-trips a chosen format, which is the whole feature', () => {
    saveScanFormat('hardcover');
    assert.equal(loadScanFormat(), 'hardcover');
  });

  it('⚠️ validates on read — a value this build never offered falls back', () => {
    withStorage({ lc_scan_format_v1: 'ebook_kindle' });
    assert.equal(loadScanFormat(), 'paperback');
    withStorage({ lc_scan_format_v1: 'leatherbound' });
    assert.equal(loadScanFormat(), 'paperback');
    withStorage({ lc_scan_format_v1: '{"not":"a format"}' });
    assert.equal(loadScanFormat(), 'paperback');
  });

  it('⚠️ NO STORAGE AT ALL degrades to the old behaviour, and never throws', () => {
    // A private-mode browser throws on the accessor itself. The worst case of
    // the persistence failing has to be exactly what the code did before this
    // file existed — a paperback — never an error on the intake screen.
    delete (globalThis as { localStorage?: unknown }).localStorage;
    assert.equal(loadScanFormat(), 'paperback');
    assert.doesNotThrow(() => saveScanFormat('hardcover'));
  });
});

describe('formatDisagreement — when the row is allowed to say something', () => {
  it('⚠️ SILENT when the lookup agrees', () => {
    assert.equal(formatDisagreement('paperback', 'paperback'), null);
    assert.equal(formatDisagreement('hardcover', 'hardcover'), null);
  });

  it('⚠️ SILENT when the lookup said nothing — the ordinary case', () => {
    // Open Library omits `physical_format` on most records and
    // `physicalFormatFrom` declines everything it cannot read. Silence must not
    // read as a disagreement.
    assert.equal(formatDisagreement('paperback', null), null);
    assert.equal(formatDisagreement('paperback', undefined), null);
  });

  it('speaks when, and only when, the two genuinely differ', () => {
    assert.equal(formatDisagreement('paperback', 'hardcover'), 'hardcover');
    assert.equal(formatDisagreement('hardcover', 'mass_market'), 'mass_market');
    assert.equal(formatDisagreement('mass_market', 'paperback'), 'paperback');
  });

  it('⚠️ never offers a format the toggle could not write', () => {
    // A lookup that somehow answered `ebook_kindle` for a barcode in somebody's
    // hands must not render a button that writes a licence for a physical book.
    assert.equal(
      formatDisagreement('paperback', 'ebook_kindle' as unknown as typeof DEFAULT_SCAN_FORMAT),
      null,
    );
  });
});
