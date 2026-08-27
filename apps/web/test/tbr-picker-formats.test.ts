/**
 * The TBR wheel's **format checkboxes** — Audio / Ebook / Physical.
 *
 * ## What these pin, and why each earns its place
 *
 * Owner, 2026-08-26: *"for the tbr page, change the where drop down to be audio
 * ebook physical and let them be check boxes."* That replaced a single-value
 * `where` preference, which means two things had to be got right and both are
 * silent when wrong:
 *
 * 1. ⚠️ **A saved preference from the old build must not throw and must not
 *    reset.** `lc_tbr_picker_v1` is on real browsers right now holding
 *    `{ theme, where, series }`. The migration is exercised over all three old
 *    values AND over garbage, because localStorage is user-writable and a blob
 *    that half-parses is the shape that crashes a render.
 * 2. ⚠️ **"None ticked" must mean NO RESTRICTION, not "match nothing".** The
 *    inverted reading is the classic empty-set bug and it presents as a wheel
 *    that refuses to spin on a full list — a control that looks broken rather
 *    than one that says what it is doing.
 *
 * The third block is this repo's established source-text check
 * (`facet-list-agreement.test.ts`, `queue-load-waterfall.test.ts`): there is no
 * jsdom or vitest here, and `TbrSpinner.tsx` imports `firebase.ts`, which reads
 * `import.meta.env` at module scope and cannot be imported under the node test
 * runner. So the render is pinned by asserting on the component's own source —
 * three boxes driven off the registry, the retired dropdown gone, and the
 * "any format" sentence still beside them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import type { TbrGroupFormats } from '@lc/core';
import {
  anyFormatSelected,
  DEFAULT_PICKER_PREFS,
  heldInSelectedFormats,
  loadPickerPrefs,
  NO_FORMATS,
  PICKER_FORMAT_LABELS,
  PICKER_FORMATS,
  savePickerPrefs,
  toPickFilters,
  type PickerFormatSelection,
  type PickerPrefs,
} from '../src/lib/tbr-picker-prefs.ts';

/* ── a localStorage this test controls ───────────────────────────────────── */

/**
 * The smallest thing `loadPickerPrefs` / `savePickerPrefs` need. `raw` is what
 * the "browser" is holding; `boom` makes every access throw, which is what a
 * private-mode browser actually does.
 */
function withStorage(raw: string | null, boom = false): { written: string | null } {
  const box = { written: null as string | null };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        if (boom) throw new Error('SecurityError: storage is disabled');
        return raw;
      },
      setItem(_k: string, v: string) {
        if (boom) throw new Error('SecurityError: storage is disabled');
        box.written = v;
      },
    },
  });
  return box;
}

/** Every box unticked, as a fresh object — never share the frozen default. */
function none(): PickerFormatSelection {
  return { ...NO_FORMATS };
}

function sel(over: Partial<PickerFormatSelection>): PickerFormatSelection {
  return { ...none(), ...over };
}

/* ── 1. the registry ─────────────────────────────────────────────────────── */

describe('the format registry', () => {
  it('is exactly the three formats the owner named, in his order', () => {
    assert.deepEqual([...PICKER_FORMATS], ['audio', 'ebook', 'physical']);
  });

  it('labels every one of them — a box with no name is not shippable', () => {
    for (const id of PICKER_FORMATS) {
      assert.equal(typeof PICKER_FORMAT_LABELS[id], 'string');
      assert.ok(PICKER_FORMAT_LABELS[id].length > 0, `${id} has no label`);
    }
    assert.deepEqual(Object.keys(PICKER_FORMAT_LABELS).sort(), [...PICKER_FORMATS].sort());
  });

  it('defaults to nothing ticked — the old "Anywhere"', () => {
    assert.deepEqual(DEFAULT_PICKER_PREFS.formats, { audio: false, ebook: false, physical: false });
    assert.equal(anyFormatSelected(DEFAULT_PICKER_PREFS.formats), false);
  });

  it('anyFormatSelected is true as soon as ONE box is ticked', () => {
    for (const id of PICKER_FORMATS) {
      assert.equal(anyFormatSelected(sel({ [id]: true })), true, `${id} alone should count`);
    }
  });
});

/* ── 2. the migration ────────────────────────────────────────────────────── */

describe('loadPickerPrefs migrates the retired `where`', () => {
  it("old 'owned' → Physical ticked, and nothing else changes", () => {
    withStorage(JSON.stringify({ theme: 'dice', where: 'owned', series: 'first' }));
    const p = loadPickerPrefs();
    assert.deepEqual(p.formats, { audio: false, ebook: false, physical: true });
    // ⚠️ The other two preferences survive the migration untouched. A migration
    // that quietly reset the theme would be the same silent loss it exists to
    // prevent.
    assert.equal(p.theme, 'dice');
    assert.equal(p.series, 'first');
  });

  it("old 'any' → nothing ticked (same meaning: no restriction)", () => {
    withStorage(JSON.stringify({ theme: 'cards', where: 'any', series: 'any' }));
    const p = loadPickerPrefs();
    assert.deepEqual(p.formats, none());
    assert.equal(p.theme, 'cards');
  });

  it("old 'wishlist' → nothing ticked, because NO checkbox set can express it", () => {
    // ⚠️ This is a deliberate, documented loss of one option (see the module
    // header). A wishlist-only book is held in no format, so it is excluded
    // whenever a box is ticked; the honest migration is to drop the filter
    // rather than invent a fourth box.
    withStorage(JSON.stringify({ theme: 'wheel', where: 'wishlist', series: 'continuation' }));
    const p = loadPickerPrefs();
    assert.deepEqual(p.formats, none());
    assert.equal(p.series, 'continuation');
  });

  it('reads the NEW shape back unchanged, and ignores non-true values', () => {
    withStorage(
      JSON.stringify({
        theme: 'wheel',
        formats: { audio: true, ebook: 'yes', physical: 0 },
        series: 'any',
      }),
    );
    // Only an exact `true` ticks a box — a truthy string is a corrupted blob,
    // not a preference.
    assert.deepEqual(loadPickerPrefs().formats, { audio: true, ebook: false, physical: false });
  });

  it('round-trips through savePickerPrefs', () => {
    const box = withStorage(null);
    const prefs: PickerPrefs = {
      theme: 'dice',
      formats: sel({ audio: true, physical: true }),
      series: 'first',
    };
    savePickerPrefs(prefs);
    assert.ok(box.written, 'nothing was written');
    withStorage(box.written);
    assert.deepEqual(loadPickerPrefs(), prefs);
  });
});

describe("garbage in localStorage never throws and never leaves the UI in a state it can't render", () => {
  const junk: [string, string | null][] = [
    ['nothing stored at all', null],
    ['not JSON', '{oh no'],
    ['the literal null', 'null'],
    ['an array', '[1,2,3]'],
    ['a bare string', '"owned"'],
    ['a number', '42'],
    ['formats is a string', JSON.stringify({ formats: 'audio' })],
    ['formats is an array', JSON.stringify({ formats: ['audio'] })],
    ['formats is null', JSON.stringify({ formats: null })],
    ['where is a number', JSON.stringify({ where: 7 })],
    ['where is an unknown word', JSON.stringify({ where: 'somewhere' })],
    ['theme this build never shipped', JSON.stringify({ theme: 'roulette' })],
  ];

  for (const [name, raw] of junk) {
    it(`${name} → defaults, no throw`, () => {
      withStorage(raw);
      const p = loadPickerPrefs();
      assert.deepEqual(p.formats, none());
      // A theme the UI cannot render is the state this validation exists for.
      assert.ok((['wheel', 'dice', 'cards'] as string[]).includes(p.theme));
      assert.ok((['any', 'first', 'continuation'] as string[]).includes(p.series));
    });
  }

  it("a private-mode browser that throws on every access → defaults, and the save doesn't throw either", () => {
    withStorage(null, true);
    assert.deepEqual(loadPickerPrefs(), DEFAULT_PICKER_PREFS);
    assert.doesNotThrow(() => savePickerPrefs(DEFAULT_PICKER_PREFS));
  });

  it("the `theme: 'roulette'` blob still migrates its `where`", () => {
    // The two validations are independent: one bad field must not discard the
    // others.
    withStorage(JSON.stringify({ theme: 'roulette', where: 'owned' }));
    const p = loadPickerPrefs();
    assert.equal(p.theme, 'wheel');
    assert.deepEqual(p.formats, sel({ physical: true }));
  });
});

/* ── 3. the predicate ────────────────────────────────────────────────────── */

/** A group's formats row, defaulting to "held in nothing". */
function formats(over: Partial<TbrGroupFormats> = {}): TbrGroupFormats {
  return { physical: null, audio: null, ebook: null, ...over };
}

const AUDIO_ONLY = formats({ audio: { title: 'Firefight - The Reckoners, Book 2' } });
const EBOOK_ONLY = formats({ ebook: { title: 'Firefight' } });
const OWNED_PAPERBACK = formats({ physical: { workId: 12, state: 'owned' } });
/** ⚠️ On the list, wished for, held in nothing — the retired "Not on these shelves". */
const WISHLIST_ONLY = formats({ physical: { workId: 12, state: 'wanted' } });
/** In the catalog, but no copy at all — a real answer, not a gap (§9). */
const NO_COPY = formats({ physical: { workId: 12, state: 'none' } });
const ALL_THREE = formats({
  physical: { workId: 12, state: 'owned' },
  audio: { title: 'a' },
  ebook: { title: 'b' },
});

describe('heldInSelectedFormats — nothing ticked is NO RESTRICTION', () => {
  it('passes everything, including a book held in nothing at all', () => {
    for (const f of [AUDIO_ONLY, EBOOK_ONLY, OWNED_PAPERBACK, WISHLIST_ONLY, NO_COPY, formats()]) {
      assert.equal(heldInSelectedFormats(f, none()), true);
    }
  });

  it('passes a row whose formats row is missing entirely', () => {
    assert.equal(heldInSelectedFormats(null, none()), true);
    assert.equal(heldInSelectedFormats(undefined, none()), true);
  });
});

describe('heldInSelectedFormats — one box at a time', () => {
  it('Audio keeps only books with an audiobook holding', () => {
    const s = sel({ audio: true });
    assert.equal(heldInSelectedFormats(AUDIO_ONLY, s), true);
    assert.equal(heldInSelectedFormats(EBOOK_ONLY, s), false);
    assert.equal(heldInSelectedFormats(OWNED_PAPERBACK, s), false);
  });

  it('Ebook keeps only books with an ebook holding', () => {
    const s = sel({ ebook: true });
    assert.equal(heldInSelectedFormats(EBOOK_ONLY, s), true);
    assert.equal(heldInSelectedFormats(AUDIO_ONLY, s), false);
    assert.equal(heldInSelectedFormats(OWNED_PAPERBACK, s), false);
  });

  it("Physical keeps only state 'owned' — ⚠️ 'wanted' and 'none' are NOT held", () => {
    const s = sel({ physical: true });
    assert.equal(heldInSelectedFormats(OWNED_PAPERBACK, s), true);
    // A wishlist copy is not a book you can read tonight, which is the whole
    // question the control asks.
    assert.equal(heldInSelectedFormats(WISHLIST_ONLY, s), false);
    assert.equal(heldInSelectedFormats(NO_COPY, s), false);
    assert.equal(heldInSelectedFormats(AUDIO_ONLY, s), false);
  });
});

describe('heldInSelectedFormats — combinations compose with OR, never AND', () => {
  it('two boxes keep a book held in EITHER, not one held in both', () => {
    const s = sel({ audio: true, physical: true });
    assert.equal(heldInSelectedFormats(AUDIO_ONLY, s), true);
    assert.equal(heldInSelectedFormats(OWNED_PAPERBACK, s), true);
    assert.equal(heldInSelectedFormats(ALL_THREE, s), true);
    assert.equal(heldInSelectedFormats(EBOOK_ONLY, s), false);
  });

  it('all three ticked keeps anything held anywhere, and still drops a wishlist-only book', () => {
    const s = sel({ audio: true, ebook: true, physical: true });
    for (const f of [AUDIO_ONLY, EBOOK_ONLY, OWNED_PAPERBACK, ALL_THREE]) {
      assert.equal(heldInSelectedFormats(f, s), true);
    }
    // ⚠️ THE RETIRED OPTION, stated as a test: a wishlist-only book is excluded
    // whenever any box is ticked and included when none is. There is no third
    // behaviour, and nothing renders it as one.
    assert.equal(heldInSelectedFormats(WISHLIST_ONLY, s), false);
    assert.equal(heldInSelectedFormats(NO_COPY, s), false);
    assert.equal(heldInSelectedFormats(formats(), s), false);
  });

  it('a ticked box with a missing formats row fails rather than guessing', () => {
    assert.equal(heldInSelectedFormats(null, sel({ audio: true })), false);
  });
});

/* ── 4. the core filters no longer carry an acquisition axis ─────────────── */

describe('toPickFilters', () => {
  it('passes the series axis through and sets NOTHING for the format boxes', () => {
    // ⚠️ Core's `PickFilters.format` takes ONE medium; the boxes are a set, so
    // the page filters its own rows. If this ever starts writing `format` or
    // `acquisition` there are two definitions of the same axis again.
    const f = toPickFilters({
      theme: 'wheel',
      formats: sel({ audio: true, physical: true }),
      series: 'first',
    });
    assert.deepEqual(f, { series: 'first' });
    assert.equal('acquisition' in f, false);
    assert.equal('format' in f, false);
  });

  it('is empty when nothing is toggled', () => {
    assert.deepEqual(toPickFilters(DEFAULT_PICKER_PREFS), {});
  });
});

/* ── 5. the component renders three boxes ────────────────────────────────── */

describe('TbrSpinner renders the three checkboxes', () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL('../src/components/TbrSpinner.tsx', import.meta.url).href),
    'utf8',
  );

  it('drives the boxes off the registry rather than hard-coding three inputs', () => {
    assert.match(SOURCE, /PICKER_FORMATS\.map\(/);
    assert.match(SOURCE, /type="checkbox"/);
    assert.match(SOURCE, /PICKER_FORMAT_LABELS\[id\]/);
  });

  it('has retired the `where` dropdown entirely — no dead option survives', () => {
    assert.doesNotMatch(SOURCE, /prefs\.where/);
    assert.doesNotMatch(SOURCE, /On these shelves/);
    assert.doesNotMatch(SOURCE, /Not on these shelves/);
    assert.doesNotMatch(SOURCE, /value="wishlist"/);
  });

  it('says in WORDS what an empty set of boxes means', () => {
    // ⚠️ Never a dead control: an all-unticked checkbox group with no sentence
    // beside it reads as a filter somebody forgot to finish.
    assert.match(SOURCE, /Any format/);
  });

  it('filters the rows before candidates exist, so the pool and the pick agree', () => {
    assert.match(SOURCE, /heldInSelectedFormats\(r\.formats, prefs\.formats\)/);
  });

  it('labels the group for a screen reader', () => {
    assert.match(SOURCE, /aria-labelledby="tbr-spinner-formats-label"/);
  });
});
