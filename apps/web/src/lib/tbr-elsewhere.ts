/**
 * "Which of these books is not in this catalogue, and how do I say so?"
 *
 * ## ⚠️ The owner's report, 2026-08-26
 *
 * > *"in the tbr list, not all have sync'd — can we audit Diva's"*
 *
 * They had synced. **Measured the same day** against the live `readingLists`
 * store and both live D1 instances (`docs/info/tbr.md` §10): of Samantha's 358
 * to-read entries, **53 resolve to no work on `padhard.heygabi.ai`** — and 48
 * of those 53 are absent from the MAIN instance too. They are audiobooks the
 * household holds on the audio side and that neither library catalogue has ever
 * had a row for. Nothing failed; the three matching rungs in `resolveTbrEntries`
 * did exactly what they should, and there was no fourth rung they missed.
 *
 * ⚠️ **So the defect was never the matching — it was the WORDING.** The page
 * already showed those entries under *"Not on these shelves"*, but it never
 * said HOW MANY, and it offered one link (the audiobook site) as though that
 * were the only place a missing book could be. A person counting cards and
 * finding 53 with no format chip reads that as *"the sync dropped 53 books"*,
 * which is the estate's silent-failure rule broken in the expensive direction:
 * an absence that looks like a loss.
 *
 * ## What lives here and why it is not in `@lc/core`
 *
 * `groupTbrEntries` is shared with the Worker and belongs in core. **This is
 * page wording**, and it follows the precedent `lib/details-residue.ts` set: a
 * sentence a person reads is a pure function with its own tests, so the wording
 * can be argued about in a test file rather than in a JSX diff.
 */

import type { TbrFoldable, TbrGroup } from '@lc/core';

/**
 * The two halves of a TBR list: books this catalogue holds a row for, and books
 * it does not.
 *
 * ⚠️ **`workId === null` is the whole predicate, and it is a fact rather than a
 * guess.** It means all three rungs of `resolveTbrEntries` — the indexed
 * `work_key` pass, the title-slug scan, and the `audiobook_holding` /
 * `ebook_holding` bridge — declined to name a work. Anything softer here would
 * be a fourth matcher, and `tbrFoldKey`'s header says why this feature does not
 * get one: an over-eager match is silent and permanent.
 */
export function splitTbrGroupsByShelf<T extends TbrFoldable>(
  groups: readonly TbrGroup<T>[],
): { here: TbrGroup<T>[]; elsewhere: TbrGroup<T>[] } {
  const here: TbrGroup<T>[] = [];
  const elsewhere: TbrGroup<T>[] = [];
  for (const group of groups) (group.workId === null ? elsewhere : here).push(group);
  return { here, elsewhere };
}

/**
 * The sentence that turns "53 books vanished" into "53 books live somewhere
 * else".
 *
 * ⚠️ **It states the NUMBER.** The section header alone ("Not on these
 * shelves") does not, and a person who has just counted a shorter list than
 * they expected is counting for a reason. Naming the figure is what makes the
 * absence checkable instead of alarming — the same rule `residueSentence`
 * follows for the details queue.
 *
 * ⚠️ **It never says "failed", "missing" or "not synced".** These entries are
 * on the list, in the shared store, exactly as recorded. The catalogue simply
 * holds no copy — see `docs/info/tbr.md` §3, which has said since 2026-08-17
 * that this is *"the ordinary case, not a failure"*, and §10, which measured
 * how ordinary.
 *
 * @returns the sentence, or `null` when there is nothing to say — a list with
 *   no such books renders no note at all, the same rule the fold note follows.
 */
export function notInCatalogueSentence(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count === 1) {
    return (
      'One book on your list is not in this catalogue — it will be an audiobook or an ' +
      'ebook the household holds elsewhere. It is still on your list; there is just no ' +
      'copy here to link to.'
    );
  }
  return (
    `${count} books on your list are not in this catalogue — they will be audiobooks or ` +
    'ebooks the household holds elsewhere. They are still on your list; there is just no ' +
    'copy here to link to.'
  );
}
