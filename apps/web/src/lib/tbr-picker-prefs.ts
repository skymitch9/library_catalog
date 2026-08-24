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
 * `savePrefs` already sets. Nothing sensitive is stored — a theme name and four
 * enum toggles.
 */

import type { PickFilters } from '@lc/core';

/** The animation themes the picker knows. The first is the built one. */
export const SPINNER_THEMES = ['wheel', 'dice', 'cards'] as const;
export type SpinnerThemeId = (typeof SPINNER_THEMES)[number];

/**
 * The filter axes the LIVE page can populate from the TBR resolve response.
 *
 * ⚠️ Deliberately a SUBSET of `@lc/core`'s `PickFilters`. The core picker
 * supports `format` (audio/physical/ebook) and `hardcover` as well, and is
 * tested on them — but the TBR resolve endpoint returns neither an edition
 * medium split (physical vs ebook) nor whether a hardcover printing exists, so
 * this UI cannot honestly drive those axes yet. They are noted as a follow-on
 * (see `TbrSpinner.tsx`), not shipped as controls that would refuse to work.
 *
 * `where` maps the one signal the resolve DOES give — `workId` — onto the
 * owned/wishlist axis: a book this catalog holds is owned; one it does not is
 * still on the list but not on these shelves.
 */
export interface PickerPrefs {
  theme: SpinnerThemeId;
  where: 'any' | 'owned' | 'wishlist';
  series: 'any' | 'first' | 'continuation';
}

const KEY = 'lc_tbr_picker_v1';

export const DEFAULT_PICKER_PREFS: PickerPrefs = {
  theme: 'wheel',
  where: 'any',
  series: 'any',
};

export function loadPickerPrefs(): PickerPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PICKER_PREFS;
    const p = JSON.parse(raw) as Partial<PickerPrefs>;
    return {
      theme:
        typeof p.theme === 'string' && (SPINNER_THEMES as readonly string[]).includes(p.theme)
          ? (p.theme as SpinnerThemeId)
          : DEFAULT_PICKER_PREFS.theme,
      where:
        p.where === 'owned' || p.where === 'wishlist' ? p.where : DEFAULT_PICKER_PREFS.where,
      series:
        p.series === 'first' || p.series === 'continuation'
          ? p.series
          : DEFAULT_PICKER_PREFS.series,
    };
  } catch {
    // A private-mode browser throws on localStorage. Defaults are a fine answer.
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
 * Translate the UI's saved toggles into the core picker's `PickFilters`.
 *
 * One place does the mapping, so the wheel and the pick always agree on what
 * the toggles mean. `excludeId` is added by the caller at reroll time, not
 * stored.
 */
export function toPickFilters(prefs: PickerPrefs): PickFilters {
  const filters: PickFilters = {};
  if (prefs.where === 'owned') filters.acquisition = 'owned';
  if (prefs.where === 'wishlist') filters.acquisition = 'wishlist';
  if (prefs.series === 'first') filters.series = 'first';
  if (prefs.series === 'continuation') filters.series = 'continuation';
  return filters;
}
