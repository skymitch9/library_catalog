/**
 * Leaf module: finding the same WORK recorded twice.
 *
 * Imports `titles.ts` only. No I/O.
 *
 * ## What "duplicate" means here, and what it deliberately does NOT mean
 *
 * ⚠️ **The same book on the shelf twice is NOT a duplicate.** The owner settled
 * this when he asked for the feature: *"duplicates = the same WORK recorded
 * twice"*. Two copies of one book is an ordinary, legitimate holding — a
 * hardback and the paperback you lend out — and flagging it would make the
 * finder useless on the shelf it is meant to clean.
 *
 * ⚠️ **This is where this file diverges from the Board Game Catalog, whose
 * filter this feature was told to mimic.** There, `duplicates=1` means the
 * opposite thing: `packages/db/src/items.ts:379` in that repo is
 *
 * ```sql
 * EXISTS (SELECT 1 FROM item i4 JOIN copy c4 ON c4.item_id = i4.id
 *          WHERE i4.root_game_id = i2.root_game_id
 *            AND c4.status IN (…owned…)
 *          GROUP BY i4.id HAVING SUM(c4.quantity) > 1)
 * ```
 *
 * — "a tree holding more than one of something", surfaced as the header chip
 * *"N owned 2+"* and the checkbox *"We own 2+"*
 * (`apps/web/src/pages/CollectionPage.tsx:181,303` there). That is a **copy**
 * question and it is the right one for board games, where a second copy of
 * *Wingspan* really is a shelf mistake and titles are near-unique so a second
 * *row* for one game cannot happen quietly.
 *
 * Books are the other way round. This catalog already answers the copy
 * question — `ownedMoreThanOnce` in `holdings.ts`, and the `×2` mark on the
 * card — so building the games clause again would duplicate a surface we have
 * and answer a question the owner explicitly ruled out. What books have and
 * board games do not is **two rows for one book**: an ebook import, a spine
 * photo and a manual add all create works, and *Firefight* arriving once as
 * `Firefight` and once as `Firefight (The Reckoners, Book 2)` is the ordinary
 * way it happens.
 *
 * So: the **grammar, placement and wording shape are mirrored** (see
 * `apps/web/src/router.tsx`), and the **predicate is not**, because the same
 * predicate would answer a question this catalog does not have.
 *
 * ## ⚠️ There is no new similarity function in here, and there must never be
 *
 * `matching.ts`'s header spells out why: the sibling project shipped three
 * wrong-game matches — Brink, Iliad, Moon — and every one came from a second
 * similarity function drifting from the first. Everything below composes
 * `cleanTitleWithSeries` and `workKeyFor` from `titles.ts` and adds no
 * comparison of its own. If this fold is wrong, it is wrong *there*, once.
 */

import { cleanTitleWithSeries, workKeyFor } from './titles.js';

/** One work, as the duplicate finder needs to see it. */
export interface DuplicateCandidate {
  id: number;
  title: string;
  subtitle: string | null;
  /**
   * ⚠️ The **raw stored** author string, sentinel and all — not the nulled-out
   * `Work.authors`. `workKeyFor` has a branch for `UNKNOWN_AUTHOR` that is the
   * entire collision proof for provisional keys, and handing it `null` or `''`
   * would fold every authorless book onto every other one.
   */
  authors: string;
  series: string | null;
  /** Owned + lent, as the collection counts them. Shown, never compared. */
  copyCount: number;
}

/** Works that fold together, and the key they folded onto. */
export interface DuplicateGroup {
  /** The folded key the group is filed under. Shown to nobody; useful in tests. */
  key: string;
  /** Two or more, always — a group of one is not a duplicate. */
  works: DuplicateCandidate[];
}

/**
 * The LOOSE key — deliberately looser than the stored `work.work_key`.
 *
 * `work_key` is `normaliseTitle(title)|normaliseTitle(primaryAuthor(authors))`
 * and is a **persisted** key: the audiobook bridge joins on it, so it can only
 * ever move in a migration (`titles.ts`, `works.ts`). It therefore folds
 * nothing that a stored key would have to be re-derived to fold — which is
 * exactly why an exact-`work_key` match finds so few of the duplicates that
 * are actually on this shelf. The two rows a person wants to see side by side
 * usually differ by decoration: a series suffix, a volume number, an Audible
 * packaging tail, a `(Book 2)` bracket.
 *
 * So this key runs the title through `cleanTitleWithSeries` **first** and then
 * through the same `workKeyFor` fold. Every rule that function applies only
 * ever *removes* text, so in practice this key is `work_key` with the
 * decoration taken off.
 *
 * ⚠️ **The author half is untouched, and that is load-bearing.**
 * `matching.ts` records why: there are dozens of books called *Gold*, and a
 * title-only fold across a book catalog produces confident, well-formed, wrong
 * answers. Loosening the title is a review queue; loosening the author is a
 * wrong merge.
 *
 * ⚠️ `subtitle` is not in here because it is not in `work_key` either — it is
 * its own column, so "Title" and "Title" + subtitle already fold together
 * without help. A title typed *with* its subtitle inline is caught only when
 * the tail is one `cleanAudiobookTitle` recognises; widening that is a change
 * to `titles.ts`, with evidence, not a second fold here.
 */
export function duplicateKeyFor(
  title: string,
  series: string | null,
  authors: string,
): string {
  return workKeyFor(cleanTitleWithSeries(title, series), authors);
}

/**
 * Group works that are probably the same book.
 *
 * Two works join the same group when they share **either** key: the loose key
 * above, or the stored `work_key` they were filed under.
 *
 * ⚠️ The second half is not belt-and-braces, it closes a real hole.
 * `cleanTitleWithSeries` reads the `series` column, and two rows for one book
 * need not agree about it — one imported with `series: null`, one filled in by
 * research. `"Warbreaker: Cosmere"` with `series: 'Cosmere'` loses its tail and
 * the same title with `series: null` keeps it, so two rows carrying the
 * **identical stored `work_key`** — the least deniable duplicate there is —
 * would land in different groups. Keying on both and merging is what makes an
 * exact duplicate impossible to miss.
 *
 * Merging is by union — if A shares a loose key with B and B shares a
 * `work_key` with C, all three are one group. That is set arithmetic, not a
 * similarity judgement; nothing here decides how alike two titles are.
 *
 * Groups come back largest first, then alphabetically by the first title, so
 * the worst offender is at the top of the page. Works inside a group keep
 * ascending id order — oldest row first, which is usually the one to keep.
 */
export function groupDuplicates(works: readonly DuplicateCandidate[]): DuplicateGroup[] {
  // Union–find over key strings. `parent` maps a key to its representative.
  const parent = new Map<string, string>();

  const find = (k: string): string => {
    let root = parent.get(k);
    if (root === undefined) {
      parent.set(k, k);
      return k;
    }
    while (root !== parent.get(root)) root = parent.get(root) as string;
    // Path compression, so a long chain costs once.
    let cur = k;
    while (cur !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const keysFor = (w: DuplicateCandidate): [string, string] => [
    duplicateKeyFor(w.title, w.series, w.authors),
    // The stored key, recomputed from the same inputs rather than read off the
    // row: this module is pure and `works.ts` is the only place allowed to
    // *derive* the persisted column. Same function, so the same answer.
    workKeyFor(w.title, w.authors),
  ];

  for (const w of works) {
    const [loose, stored] = keysFor(w);
    union(loose, stored);
  }

  const byRoot = new Map<string, DuplicateCandidate[]>();
  for (const w of works) {
    const root = find(keysFor(w)[0]);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(w);
    else byRoot.set(root, [w]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, bucket] of byRoot) {
    // A group of one is not a duplicate. This is the "only one" case the games
    // filter handles by simply not matching the tree, and it is handled the
    // same way here: it never becomes a group at all.
    if (bucket.length < 2) continue;
    groups.push({ key, works: [...bucket].sort((a, b) => a.id - b.id) });
  }

  groups.sort(
    (a, b) =>
      b.works.length - a.works.length ||
      (a.works[0]?.title ?? '').localeCompare(b.works[0]?.title ?? ''),
  );
  return groups;
}
