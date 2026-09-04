/**
 * Where a scan LANDS — the shelf, or the wishlist.
 *
 * ## ⚠️ WHY THIS EXISTS, IN THE OWNER'S WORDS
 *
 * 2026-09-04, from his phone: *"I didn't see how to scan a book to add
 * wishlist. We should add this feature to the scanner."* Then, when asked
 * whether to build it: *"Yes build it. We currently can't add to wishlist at
 * all."*
 *
 * The second sentence is the real measurement. A wishlist add DID exist — the
 * *Want this* button in `Copies.tsx` and the *"want it"* row of `AddWork`'s
 * intent dropdown — but the barcode path (`lib/catalog-add.ts`) has written
 * `status: 'owned'` on every copy it has ever created, and both of the existing
 * doors are buried where a phone will not find them. "Can't at all" is the
 * honest reading of a feature that is only reachable through ✎ Edit → Editions
 * & copies.
 *
 * ## ⚠️ ONE CHOICE PER SWEEP, NOT ONE PER BOOK
 *
 * Deliberately the same shape as `lib/scan-format.ts`, which settled this
 * argument for the binding: the whole standing complaint about the scan screen
 * is too many taps, and somebody walking a bookshop with a list is doing ONE
 * thing. Ten scans in a shop is one tap, not ten.
 *
 * ## ⚠️ SESSION storage, where the format toggle uses LOCAL storage
 *
 * The difference is deliberate and is about what each choice means:
 *
 * | | remembered | why |
 * |---|---|---|
 * | Format (`scan-format.ts`) | across visits (`localStorage`) | a HABIT — you are the kind of person who buys paperbacks |
 * | Target (this file) | for the session (`sessionStorage`) | an ERRAND — you are in a shop right now, and tomorrow you are not |
 *
 * ⚠️ `shelf` must stay the default, for `scan-format.ts`'s reason: it is what
 * every scan has written since the feature existed, and a remembered wishlist
 * target that outlived the shop trip would silently stop recording books that
 * are physically in the person's hands.
 */

import type { CopyStatus } from '@lc/core';

/** The two things a scan can mean. */
export type ScanTarget = 'shelf' | 'wishlist';

export const SCAN_TARGETS: readonly ScanTarget[] = ['shelf', 'wishlist'];

/** ⚠️ Not a preference — a compatibility promise. See the header. */
export const DEFAULT_SCAN_TARGET: ScanTarget = 'shelf';

/**
 * Per-browser, per-SESSION.
 *
 * ⚠️ The key follows this app's own convention (`lc_scan_format_v1`,
 * `lc_prefs_v1`, `lc_tbr_picker_v1`) rather than the dotted `lc.scanTarget`
 * the ask sketched, so a person clearing "the catalog's keys" out of a browser
 * finds all of them under one prefix.
 */
const KEY = 'lc_scan_target_v1';

/** The word on the button, and the word in the sentence under it. */
export const TARGET_LABEL: Record<ScanTarget, string> = {
  shelf: 'Shelf',
  wishlist: 'Wishlist',
};

/** Is this string one of the two targets? */
export function isScanTarget(value: unknown): value is ScanTarget {
  return typeof value === 'string' && (SCAN_TARGETS as readonly string[]).includes(value);
}

/**
 * The remembered choice, or `shelf`.
 *
 * ⚠️ Never throws and never rejects loudly, exactly as `loadScanFormat` does:
 * an unreadable value degrades to `shelf`, which is what this code did before
 * the target existed — so the worst case of the persistence failing is the old
 * behaviour, not a broken screen. A private-mode browser throws on the
 * accessor itself, and storage is user-writable, so the value is validated on
 * every read.
 */
export function loadScanTarget(): ScanTarget {
  try {
    const raw = sessionStorage.getItem(KEY);
    return isScanTarget(raw) ? raw : DEFAULT_SCAN_TARGET;
  } catch {
    return DEFAULT_SCAN_TARGET;
  }
}

export function saveScanTarget(target: ScanTarget): void {
  try {
    sessionStorage.setItem(KEY, target);
  } catch {
    /* private mode. Not worth telling anyone about — the sweep still works. */
  }
}

/**
 * The `copy.status` a scan writes.
 *
 * ⚠️ **The one place the mapping is written.** `catalog-add.ts` used to hold
 * the string `'owned'` inline in `recordArrival`, which is exactly how a second
 * write path silently keeps the old behaviour when a feature like this arrives.
 * `preordered` is deliberately NOT reachable from here: a pre-order is a want
 * somebody has already paid for, and a barcode in a shop is not evidence of a
 * payment (see `WISHLIST_STATUSES` in `@lc/core`).
 */
export function copyStatusFor(target: ScanTarget): Extract<CopyStatus, 'owned' | 'wanted'> {
  return target === 'wishlist' ? 'wanted' : 'owned';
}

/**
 * What `AddWork`'s intent dropdown opens on.
 *
 * ⚠️ It DEFAULTS from the switch and stays a dropdown. The manual-add form can
 * still say "just catalogue it — record no copy", which the two-state switch
 * has no way to express and which is a real answer; defaulting is not the same
 * as deciding.
 */
export function intentFor(target: ScanTarget): 'owned' | 'wanted' {
  return copyStatusFor(target);
}

/** The label on a scan row's add button — the action, named. */
export function addActionLabel(target: ScanTarget, secondCopy = false): string {
  if (target === 'wishlist') return 'Add to wishlist';
  return secondCopy ? 'Add 2nd copy' : 'Add';
}

/**
 * The one line under the switch.
 *
 * ⚠️ `subject` is passed in rather than hardcoded because the switch also sits
 * above the *type-it-in* tab, where "scanned books" would be a sentence about
 * something the person is not doing.
 */
export function targetSentence(target: ScanTarget, subject = 'Scanned books'): string {
  return target === 'wishlist'
    ? `${subject} go on your wishlist — a want, not a copy you own.`
    : `${subject} go on your shelf.`;
}

/**
 * What a settled row says it did.
 *
 * ⚠️ Each outcome keeps its own words, which is the rule `ScanLines` already
 * lived by: *"Copy added" over a received pre-order would report the very thing
 * the prompt was asked to prevent.* A wishlist add gets the same treatment —
 * "Added" over a want would claim a book is on the shelf.
 *
 * ⚠️ `arrived` and `summary` outrank the target on purpose. Both are outcomes
 * of the SHELF path (a pre-order received, a rescan answer that filled an ISBN)
 * and neither is reachable from the wishlist path — but if one ever were, what
 * actually happened beats what was intended.
 */
export function addedLabel(o: {
  target: ScanTarget;
  arrived: boolean;
  summary: string | null;
  owned: boolean;
}): string {
  if (o.arrived) return 'Pre-order received';
  if (o.summary) return o.summary;
  if (o.target === 'wishlist') return 'Added to wishlist';
  return o.owned ? 'Copy added' : 'Added';
}
