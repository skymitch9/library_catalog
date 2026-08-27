/**
 * How this person likes the TBR spinner set up, remembered between visits: the
 * animation theme and the filter toggles.
 *
 * Mirrors `lib/prefs.ts` exactly in shape and discipline — every value is
 * validated on read, because localStorage is user-writable and survives a
 * build that offered different options. A stored theme this version has never
 * heard of, or a filter value it has dropped, must fall back to a default the
 * UI can actually render rather than driving a control into an impossible
 * state.
 *
 * ⚠️ Per-person is per-BROWSER here, like the collection prefs: there is no
 * server round-trip, so this is the same "remembered on this device" contract
 * `savePrefs` already sets. Nothing sensitive is stored — a theme name, three
 * booleans and one enum toggle.
 *
 * ## ⚠️ `where` became three CHECKBOXES, 2026-08-26
 *
 * Owner: *"for the tbr page, change the where drop down to be audio ebook
 * physical and let them be check boxes."* The old control was a single-value
 * `where` (`any` / `owned` / `wishlist`) that read the one signal the resolve
 * response used to give — whether the catalog matched a work at all. The media
 * fold (`docs/info/tbr.md` §9) now hands every group a **formats row**
 * (`{ physical, audio, ebook }`), which is a straight answer to *"can I
 * actually pick this up?"*, so the control asks that instead.
 *
 * **Any combination, and none is a real answer.** A book qualifies when it is
 * held in **at least one ticked format**; with nothing ticked there is no
 * format restriction at all. That is the old *"Anywhere"*, and it is said in
 * words beside the boxes rather than left as an empty control that looks
 * broken.
 *
 * ⚠️ **The old "Not on these shelves" (wishlist-only) option is GONE, not
 * renamed.** A wishlist-only book is held in no format, so it is excluded
 * whenever any box is ticked and included when none is — there is no set of
 * checkboxes that means "only the ones I do NOT have". That is a deliberate
 * loss of one option, recorded here so nobody re-adds it as a fourth box.
 */

import type { PickFilters, TbrGroupFormats } from '@lc/core';

/** The animation themes the picker knows — all three are built and animate. */
export const SPINNER_THEMES = ['wheel', 'dice', 'cards'] as const;
export type SpinnerThemeId = (typeof SPINNER_THEMES)[number];

/**
 * The three format boxes, in the order the owner named them.
 *
 * ⚠️ A **data registry**, like `SPINNER_STAGES` — the component maps over this
 * rather than hard-coding three inputs, so the boxes, the stored prefs and the
 * predicate below can never disagree about which formats exist.
 */
export const PICKER_FORMATS = ['audio', 'ebook', 'physical'] as const;
export type PickerFormatId = (typeof PICKER_FORMATS)[number];

/** What each box is called on screen. */
export const PICKER_FORMAT_LABELS: Record<PickerFormatId, string> = {
  audio: 'Audio',
  ebook: 'Ebook',
  physical: 'Physical',
};

/** Which boxes are ticked. All false = no format restriction. */
export type PickerFormatSelection = Record<PickerFormatId, boolean>;

/**
 * The filter axes the LIVE page can populate from the TBR resolve response.
 *
 * ⚠️ Still deliberately a SUBSET of `@lc/core`'s `PickFilters`. The core picker
 * also supports `hardcover`, and is tested on it, but the resolve endpoint
 * returns no hardcover flag — so that axis stays unshipped rather than being
 * rendered as a control that would refuse to work.
 *
 * `formats` is applied by this app, not by `toPickFilters`: core's
 * `PickFilters.format` is a SINGLE medium and the owner asked for any
 * combination. Widening core's filter would be a second definition of the same
 * axis; the page filters its own rows with {@link heldInSelectedFormats} and
 * hands core the survivors.
 */
export interface PickerPrefs {
  theme: SpinnerThemeId;
  formats: PickerFormatSelection;
  series: 'any' | 'first' | 'continuation';
}

/**
 * ⚠️ **The key is UNCHANGED and the migration happens IN PLACE.** This module
 * has never carried a version field of its own — the `_v1` is part of the key
 * name and nothing reads it — so bumping it would silently reset every saved
 * theme as well, to fix a single dropped field. `loadPickerPrefs` reads both
 * shapes instead.
 */
const KEY = 'lc_tbr_picker_v1';

/** Nothing ticked: the default is "any format", the old `where: 'any'`. */
export const NO_FORMATS: PickerFormatSelection = {
  audio: false,
  ebook: false,
  physical: false,
};

export const DEFAULT_PICKER_PREFS: PickerPrefs = {
  theme: 'wheel',
  formats: NO_FORMATS,
  series: 'any',
};

/** True when at least one box is ticked — i.e. the filter is actually on. */
export function anyFormatSelected(selection: PickerFormatSelection): boolean {
  return PICKER_FORMATS.some((id) => selection[id]);
}

/**
 * Read the three booleans out of whatever was stored, old shape or new.
 *
 * | Stored | Becomes | Why |
 * |---|---|---|
 * | `formats: {…}` | those three booleans, anything not exactly `true` false | the current shape |
 * | `where: 'owned'` | Physical ticked | *"on these shelves"* meant the household holds a copy |
 * | `where: 'any'` | nothing ticked | *"Anywhere"* is no restriction, which is what none means |
 * | `where: 'wishlist'` | nothing ticked | ⚠️ **no equivalent exists** — see the module header |
 * | anything else, or absent | nothing ticked | the default |
 *
 * ⚠️ Never throws and never rejects: an unreadable blob degrades to the
 * default, because a saved preference is not worth an error message.
 */
function readFormats(p: Record<string, unknown>): PickerFormatSelection {
  const stored = p.formats;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const s = stored as Record<string, unknown>;
    return {
      audio: s.audio === true,
      ebook: s.ebook === true,
      physical: s.physical === true,
    };
  }
  // Migrate the retired single-value `where` forward.
  if (p.where === 'owned') return { ...NO_FORMATS, physical: true };
  // 'any' → nothing ticked (same meaning). 'wishlist' → nothing ticked as well:
  // ⚠️ there is NO checkbox combination that means "only books I do not hold",
  // so the honest migration is to drop the restriction rather than invent one.
  return NO_FORMATS;
}

export function loadPickerPrefs(): PickerPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PICKER_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_PICKER_PREFS;
    }
    const p = parsed as Record<string, unknown>;
    return {
      theme:
        typeof p.theme === 'string' && (SPINNER_THEMES as readonly string[]).includes(p.theme)
          ? (p.theme as SpinnerThemeId)
          : DEFAULT_PICKER_PREFS.theme,
      formats: readFormats(p),
      series:
        p.series === 'first' || p.series === 'continuation'
          ? p.series
          : DEFAULT_PICKER_PREFS.series,
    };
  } catch {
    // A private-mode browser throws on localStorage, and a half-written blob
    // throws on JSON.parse. Defaults are a fine answer to both.
    return DEFAULT_PICKER_PREFS;
  }
}

export function savePickerPrefs(prefs: PickerPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* not worth telling anyone about */
  }
}

/**
 * Is this book held in at least one of the ticked formats?
 *
 * **Nothing ticked = no restriction**, so everything passes — the old
 * *"Anywhere"*. Otherwise the group's formats row (`docs/info/tbr.md` §9)
 * answers each box:
 *
 * | Box | Held when |
 * |---|---|
 * | Audio | an `audiobook_holding` row exists (`formats.audio` non-null) |
 * | Ebook | an `ebook_holding` row exists (`formats.ebook` non-null) |
 * | Physical | ⚠️ `formats.physical.state === 'owned'` |
 *
 * ⚠️ **Physical is the only one with a STATE, and `'wanted'` is not held.**
 * `state` is the household's fact, decided by core's `HELD_STATUSES` — `lent`
 * is owned (ours, elsewhere) while `wanted` is a wishlist copy and `none` is a
 * work in the catalog with no copy at all. A wishlist book is not one you can
 * go and read tonight, which is the whole question this control asks.
 *
 * The boxes compose with OR, not AND: *"audio or physical"* is what somebody
 * ticking two boxes means, not *"both formats at once"*.
 */
export function heldInSelectedFormats(
  formats: TbrGroupFormats | null | undefined,
  selection: PickerFormatSelection,
): boolean {
  if (!anyFormatSelected(selection)) return true;
  if (!formats) return false;
  if (selection.audio && formats.audio != null) return true;
  if (selection.ebook && formats.ebook != null) return true;
  if (selection.physical && formats.physical?.state === 'owned') return true;
  return false;
}

/**
 * Translate the UI's saved toggles into the core picker's `PickFilters`.
 *
 * One place does the mapping, so the wheel and the pick always agree on what
 * the toggles mean. `excludeId` is added by the caller at reroll time, not
 * stored.
 *
 * ⚠️ **The format boxes are NOT here**, and that is the design: core's
 * `format` filter takes one medium, the boxes are a set, and the page applies
 * them itself with {@link heldInSelectedFormats} before core ever sees the
 * candidates. Both the wheel's pool and the pick read that same filtered array,
 * so they cannot disagree.
 */
export function toPickFilters(prefs: PickerPrefs): PickFilters {
  const filters: PickFilters = {};
  if (prefs.series === 'first') filters.series = 'first';
  if (prefs.series === 'continuation') filters.series = 'continuation';
  return filters;
}
