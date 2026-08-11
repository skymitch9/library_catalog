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
