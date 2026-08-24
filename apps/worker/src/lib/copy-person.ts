import { can, type Role } from '@lc/core';
import { memberDisplayNames } from '@lc/db';

/**
 * WHO has the book — who is allowed to see it, and what name they see.
 *
 * ## The rule, in one sentence
 *
 * ⚠️ **A copy's `person_user_id` and `person_name` reach a caller only if that
 * caller holds `editCatalog` or IS the linked person; every other caller gets
 * both fields as `null` while the status word ("Lent out") is left untouched.**
 *
 * That is the owner's decision #2 of 2026-08-23, verbatim intent: *"Editors of
 * the catalog see the name. The linked member sees, on THEIR own page … Anyone
 * else sees only the status word ('lent out'), never the name."*
 *
 * ## Why it lives in ONE function
 *
 * `copy` rows leave this Worker through more than one door — the work page, a
 * PATCH response, and "Books with you" — and a redaction implemented per-route
 * is a redaction that will be forgotten on the fourth door. This repo has the
 * scar for it already: `packages/db/src/index-projection.ts` and
 * `gabi-browse.ts` both list `lent_to` by name in their "never leaves the
 * house" comments precisely because a default-allow projection leaks the moment
 * a column is added. Same lesson, applied before rather than after.
 *
 * ## Why the status word is NOT redacted
 *
 * A reader who cannot see the name can still see that a copy is lent out, and
 * that is deliberate: hiding the status too would make a book look missing from
 * the shelf rather than lent, which is a worse lie than the one being avoided.
 * The name is the private fact; the fact that the book is out is not.
 *
 * ## Why a member cannot see who ELSE has a book
 *
 * The self-exception is `person_user_id === viewer.id`, an equality on the id
 * from the verified token — never a name comparison. Two members called Sam do
 * not read each other's rows, and a `person_name` that happens to match the
 * viewer's own display name grants nothing.
 */

/** The two columns the rule is about — structurally typed, so any copy-shaped row fits. */
export interface CopyPersonFields {
  person_user_id: number | null;
  person_name: string | null;
}

/** The caller, as the verified token describes them. */
export interface PersonViewer {
  id: number;
  role: Role;
}

/**
 * May this caller see who has this copy?
 *
 * ⚠️ `editCatalog` and not `read`: `read` includes `guest`, and a guest seeing
 * the household's lending record is exactly what decision #2 rules out. It is
 * also not `manageUsers` — a moderator who records the lend must be able to see
 * what they recorded.
 */
export function maySeeCopyPerson(copy: CopyPersonFields, viewer: PersonViewer): boolean {
  if (can(viewer.role, 'editCatalog')) return true;
  return copy.person_user_id !== null && copy.person_user_id === viewer.id;
}

/**
 * Apply the rule to a batch of copies, resolving linked ids to the member's
 * CURRENT display name on the way out.
 *
 * One `app_user` query for the whole batch (`memberDisplayNames`), and it is
 * skipped entirely when nothing is linked or nothing is visible — the ordinary
 * book page has no lent copies at all and must not pay for this feature.
 *
 * ⚠️ **The resolved name overwrites `person_name` in the response and the
 * stored text is not sent beside it.** Two names on one row is how a card comes
 * to show "Sam (Samantha Ellis)"; the stored text is a FALLBACK, so it is used
 * only when the link resolves to nothing — a member with no `display_name`, or
 * an id that no longer names anybody.
 */
export async function withCopyPeople<T extends CopyPersonFields>(
  db: D1Database,
  copies: readonly T[],
  viewer: PersonViewer,
): Promise<T[]> {
  const visible = copies.filter((c) => maySeeCopyPerson(c, viewer));
  const linked = visible
    .map((c) => c.person_user_id)
    .filter((id): id is number => id !== null);
  const names = await memberDisplayNames(db, linked);

  return copies.map((c) => {
    if (!maySeeCopyPerson(c, viewer)) {
      return { ...c, person_user_id: null, person_name: null };
    }
    const live = c.person_user_id === null ? null : (names.get(c.person_user_id) ?? null);
    return { ...c, person_name: live ?? c.person_name };
  });
}
