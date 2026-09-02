/**
 * The format a scan writes, chosen once at the top of the sweep — and the
 * lookup's second opinion about it.
 *
 * ## ⚠️ WHY THIS EXISTS, IN THE WORDS OF THE THING IT FIXES
 *
 * `lib/catalog-add.ts`'s own comment above the edition write has said this for
 * months:
 *
 * > *"`paperback` here is a guess, and it is wrong often enough to be reported
 * > from the shelf. A barcode proves a printing exists and does not say which
 * > one; a hardcover scanned off its own barcode lands here as a paperback.
 * > That is still the right default … but it is only defensible because it is
 * > now correctable. **If this ever stops being a one-tap correction, ask at
 * > scan time instead.**"*
 *
 * Kiro's queued ask (recorded 2026-08-22, `docs/TODO.md`) is that sentence
 * cashed in: *"scan-time toggle (default PB, one-tap to change) + GABI research
 * confirmation with auto-open persistence"*. So the guess becomes a CHOICE the
 * person makes before they start scanning, at the cost of zero taps per book,
 * and the lookup gets to disagree with them out loud.
 *
 * ## ⚠️ ONE CHOICE PER SWEEP, NOT ONE PER BOOK
 *
 * The whole complaint this screen has ever had is too many taps. Somebody
 * emptying a box of paperbacks and somebody shelving a run of hardcovers are
 * each doing ONE thing, so the toggle sits above the list and every row it adds
 * inherits it. A book that breaks the run is what the per-row confirmation and
 * the Editions panel are for.
 *
 * ⚠️ **`paperback` is still the default and must stay it.** It is the commoner
 * printing, it is what every scan has written since the feature existed, and
 * changing the default would silently re-label the intake habits of everybody
 * who has learned this screen.
 *
 * ## ⚠️ THE CONFIRMATION SPENDS NOTHING
 *
 * "GABI research confirmation" is read here in its **conservative** sense: the
 * confirmation comes from the binding the FREE ISBN ladder already fetched
 * (Open Library's `physical_format`, mapped by `physicalFormatFrom` in
 * `@lc/isbn`), not from a paid model call. Nothing about a format is worth ~2¢
 * a book, the free rung answers on the same request the row already made, and a
 * scan screen that spends money per row is the one thing this screen has always
 * refused to be. If a paid rung is ever wanted here it is a separate, opt-in
 * decision with a price on the button, exactly as the shelf photo is.
 *
 * ## ⚠️ WHAT "AUTO-OPEN PERSISTENCE" IS READ AS
 *
 * The ask is ambiguous and was recorded as ambiguous. The conservative reading,
 * and the one built: **the toggle remembers itself, per browser, across visits**
 * — so reopening `/add` (or resuming a sweep from `/scans`) opens on the format
 * you were last using rather than resetting to paperback and quietly writing
 * the wrong binding for the rest of the box.
 *
 * It deliberately does **not** mean any of these, which the same phrase could
 * have meant, and each of which is a bigger claim:
 *
 * | Not built | Why not |
 * |---|---|
 * | Persist per SWEEP on the server | A `scan_job` column is a migration, and the choice is about the person's current activity, not about a job's history |
 * | Persist across DEVICES | There is no per-person settings store in this app; `lib/prefs.ts` and `lib/tbr-picker-prefs.ts` are both per-browser and say so |
 * | Auto-OPEN the panel/tab itself | The tab already survives a reload in `?mode=`, which is the existing mechanism and is not this file's business |
 *
 * Mirrors `lib/prefs.ts` and `lib/tbr-picker-prefs.ts` in shape and discipline:
 * every value is validated on read, because localStorage is user-writable and
 * survives a build that offered different options, and a private-mode browser
 * throws on the accessor itself.
 */

import { PHYSICAL_FORMATS, type EditionFormat } from '@lc/core';

/**
 * The formats the toggle offers.
 *
 * ⚠️ **Derived from `PHYSICAL_FORMATS`, never listed twice** — the same rule
 * `editionMedium` states in `@lc/core`. A scan is somebody holding an object,
 * so the ebook formats and the Kindle licence can never be the answer, and a
 * fourth physical format added to core lands here without anybody remembering.
 */
export const SCAN_FORMATS: readonly EditionFormat[] = PHYSICAL_FORMATS;

/**
 * ⚠️ Unchanged from what every scan has written since the feature existed. See
 * the header: this default is not a preference, it is a compatibility promise.
 */
export const DEFAULT_SCAN_FORMAT: EditionFormat = 'paperback';

/** Per-browser, like `lc_prefs_v1` and `lc_tbr_picker_v1`. */
const KEY = 'lc_scan_format_v1';

/** Is this string one of the formats a scan may write? */
export function isScanFormat(value: unknown): value is EditionFormat {
  return typeof value === 'string' && (SCAN_FORMATS as readonly string[]).includes(value);
}

/**
 * The remembered choice, or the default.
 *
 * ⚠️ Never throws and never rejects loudly: an unreadable value degrades to
 * `paperback`, which is exactly what the code did before this file existed, so
 * the worst case of the persistence failing is the old behaviour.
 */
export function loadScanFormat(): EditionFormat {
  try {
    const raw = localStorage.getItem(KEY);
    return isScanFormat(raw) ? raw : DEFAULT_SCAN_FORMAT;
  } catch {
    return DEFAULT_SCAN_FORMAT;
  }
}

export function saveScanFormat(format: EditionFormat): void {
  try {
    localStorage.setItem(KEY, format);
  } catch {
    /* private mode. Not worth telling anyone about — the session still works. */
  }
}

/**
 * What the lookup would say, if it disagrees with the person.
 *
 * ⚠️ **Returns null when it AGREES, and that is the whole design.** A
 * confirmation that fires on every row is a banner people learn to scroll past;
 * one that fires only on the rows where two sources actually differ is a thing
 * worth reading. Silence on this screen means *nobody disagreed*.
 *
 * ⚠️ It also returns null when the lookup said nothing (`null`/`undefined`),
 * which is the ORDINARY case — Open Library omits `physical_format` on most
 * records and `physicalFormatFrom` declines every binding it cannot read
 * unambiguously. "Nobody disagreed" and "nobody spoke" are both silence here
 * on purpose: neither is a reason to interrupt somebody mid-sweep, and only the
 * first is worth a sentence anywhere.
 *
 * ⚠️ **It never returns a format the toggle could not offer.** A lookup that
 * somehow answered `ebook_kindle` for a barcode in somebody's hands is refused
 * rather than rendered as a button that would write a licence for a physical
 * object.
 */
export function formatDisagreement(
  chosen: EditionFormat,
  research: EditionFormat | null | undefined,
): EditionFormat | null {
  if (!isScanFormat(research)) return null;
  return research === chosen ? null : research;
}
