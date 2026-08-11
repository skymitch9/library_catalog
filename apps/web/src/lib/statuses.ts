/**
 * How a `copy.status` is written for a person, and which of them earn a mark.
 *
 * ⚠️ One map, for the reason `FORMAT_LABEL` next door is one map: the collection
 * filter used to title-case the raw enum and print "Preordered", while the copy
 * panel printed "Pre-ordered" from a list of its own. Two spellings of one
 * status read as two statuses.
 *
 * The wording is not a straight capitalisation and should not be replaced by
 * one. `owned` is "On the shelf" because that is the question being answered,
 * and `lent` is "Lent out" because "Lent" alone is a season.
 */
export const STATUS_LABEL: Record<string, string> = {
  owned: 'On the shelf',
  wanted: 'Wanted',
  preordered: 'Pre-ordered',
  lent: 'Lent out',
  sold: 'Sold',
  borrowed: 'Borrowed',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/**
 * How a *count* of preorders is said: "3 on the way".
 *
 * Separate from the badge wording on purpose, and ported that way from the
 * sibling Board Game Catalog. A badge on a row names the status — "Pre-ordered"
 * — because the row's subject is the thing itself. A number in a stat strip is
 * a sentence about the shelf, and "3 preordered" is jargon where "3 on the way"
 * is what somebody would actually say out loud.
 */
export const ON_THE_WAY = 'on the way';

/**
 * What it means for a copy to turn up — as one patch body, in one place.
 *
 * Three controls say it: the arrivals checklist, the wishlist's per-row button,
 * and the copies panel on a book page. They were going to be three spellings of
 * one transition, which is the mistake `STATUS_LABEL` above exists to record.
 *
 * ## Why the date is here and not on the server
 *
 * ⚠️ This is the one place this port **departs from the sibling**, deliberately.
 * The Board Game Catalog writes `status` alone, because it *dropped* its
 * `acquired_on` column in migration 0004 and lets `created_at` stand in. This
 * schema kept the column (migration 0001) and nothing has ever written it, so a
 * shelf full of arrived books would carry no arrival dates at all — the column
 * would stay as empty as `copy.status` was before the wishlist shipped.
 *
 * ⚠️ **Only when it is empty.** A pledge importer or a hand-typed correction may
 * already know the real date, and an arrival ticked weeks late must not
 * overwrite it with today. Sending the key at all is what `updateCopy` in
 * `@lc/db` treats as "change this", so an absent key is the way to leave a value
 * alone — see the `pick(patch.acquiredOn, current.acquired_on)` there.
 *
 * The date is the browser's, matching `setReadState` in `WorkPage`: a book
 * arrives on the day the person holding it says it did, not on the Worker's UTC
 * day.
 */
export function arrivedPatch(acquiredOn: string | null | undefined): {
  status: 'owned';
  acquiredOn?: string;
} {
  return acquiredOn
    ? { status: 'owned' }
    : { status: 'owned', acquiredOn: new Date().toISOString().slice(0, 10) };
}
