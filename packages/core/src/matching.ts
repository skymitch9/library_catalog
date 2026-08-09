/**
 * Leaf module: deciding whether two names are the same book.
 *
 * Imports `titles.ts` only. No I/O.
 *
 * ## The one thing that had to change from the Board Game Catalog
 *
 * `LIBRARY_CATALOG.md` §3 names this file's job as the load-bearing change:
 * `matchIndexedTitle` there matches on a normalised **title alone**, accepting
 * containment when the shorter string is ≥60% of the longer. Two reasons that
 * cannot survive contact with books:
 *
 *   1. Titles collide across authors constantly. Board games have near-unique
 *      names; books do not. There are dozens of books called "Gold".
 *   2. Kindle-native rows have no ISBN, only a `B0…` ASIN no ISBN database
 *      knows, so they can *only* reach a work by name — which means the name
 *      has to carry enough to identify it.
 *
 * So matching here is on **(title, author)**, and the author is not a
 * tie-breaker applied afterwards — a title match with a contradicting author is
 * rejected outright, not down-ranked.
 *
 * ## ⚠️ What did NOT change, and must not
 *
 * `titleSimilarity` and the 0.7 spine floor are **ported verbatim** from
 * `packages/core/src/barcode.ts` in the Board Game Catalog, including the
 * measurements in the comments. That project shipped three wrong-game matches —
 * Brink, Iliad, Moon — and every one came from a second similarity function
 * drifting from the first. Do not write another one here. If this floor is
 * wrong for books, move it *with* evidence and update the comment.
 *
 * The books-specific evidence, measured 2026-08-09 against this household's
 * own library (docs/info/isbn-ladder.md), says the floor is if anything more
 * necessary here: Open Library's fielded search answered "Firefight" +
 * "Brandon Sanderson" with a *different* 2001 book called Firefight, and
 * free-text search answered "The Wandering Inn" + "pirateaba" with "Garden of
 * Sanctuary". Both are confident, well-formed, wrong answers. Nothing in the
 * API response marks them; only a similarity gate does.
 */

import { normaliseTitle, primaryAuthor } from './titles.js';

/**
 * Word-membership similarity, 0..1. Ported verbatim — see the header.
 *
 * Words of one character are dropped so initials and stray punctuation do not
 * inflate the score. Deliberately not edit distance: "Duel" and "Dark" are one
 * letter apart in the wrong places, whereas word membership is exactly what
 * distinguishes a variant from the thing it is a variant of.
 */
function titleWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 1),
  );
}

export function titleSimilarity(candidateName: string, searchedFor: string): number {
  const a = titleWords(candidateName);
  const b = titleWords(searchedFor);
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  // Penalise both missing words and extra ones, so a base title cannot outrank
  // the specific volume that was actually read.
  return (2 * shared) / (a.size + b.size);
}

/** For a title a person named themselves and asked us to look up. */
export const MIN_TITLE_SIMILARITY = 0.34;

/**
 * The stricter floor, for a title nobody confirmed — read off a spine and
 * matched without anyone looking.
 *
 * A one-word fragment of a two-word title always scores 2*1/(1+2) = 0.67, while
 * genuine reads score 1.0. 0.7 sits in the gap between those two populations.
 * An honest read landing just under is not lost, only left unticked: a false
 * negative costs a tap, a false positive costs a wrong book in the catalog
 * wearing someone else's cover.
 */
export const MIN_SPINE_SIMILARITY = 0.7;

/**
 * Authors are compared on a *lower* floor than titles, on purpose.
 *
 * An author name is short — usually two words — so the same fragment arithmetic
 * that makes 0.67 suspicious for a title makes it ordinary for a name:
 * "Brandon Sanderson" against "Sanderson, Brandon" scores 1.0, but against
 * "Brandon Sanderson and Janci Patterson" it scores 0.8, and against a
 * surname-only spine read ("SANDERSON") it scores 0.67 — and that read is
 * correct. Held at 0.5 so a bare surname passes and a different author does not.
 */
export const MIN_AUTHOR_SIMILARITY = 0.5;

/** Close enough to act on, for a title a person named themselves. */
export function isTrustedMatch(candidateName: string, searchedFor: string): boolean {
  return titleSimilarity(candidateName, searchedFor) >= MIN_TITLE_SIMILARITY;
}

/** Close enough to tick automatically, for a title nobody confirmed. */
export function isConfidentMatch(candidateName: string, searchedFor: string): boolean {
  return titleSimilarity(candidateName, searchedFor) >= MIN_SPINE_SIMILARITY;
}

/**
 * One known other name for one work — see `work_alias` in migration 0001.
 *
 * Structural rather than the db package's row type, so `packages/core` stays a
 * leaf with nothing to import.
 */
export interface WorkAliasRef {
  workId: number;
  alias: string;
}

/** The minimum a row must expose to be matchable. */
export interface MatchableWork {
  id: number;
  title: string;
  /** As printed. Split and folded here, never by the caller. */
  authors: string;
}

/**
 * The catalog's names, folded once, ready to be asked about repeatedly.
 *
 * Folding on every call is right for one question and wrong for seventy: a shelf
 * photo asked against 800 works re-folds 56,000 strings. This exists so nobody
 * writes a second, faster, subtly different matcher when the loop starts to hurt.
 */
export interface WorkIndex<T> {
  entries: { work: T; titleKey: string; authorKey: string }[];
  /**
   * Folded alternate titles, exact-match only, kept apart from `entries` because
   * the two answer *different questions* — see `matchIndexedWork`.
   */
  aliasKeys: Map<string, T>;
}

/**
 * Fold the catalog, and fold what else each row answers to.
 *
 * Two rules keep an alias from becoming the wrong-book bug it exists to prevent,
 * and both drop the alias rather than guess. Ported from the Board Game
 * Catalog's `buildTitleIndex`, whose reasoning applies here with more force —
 * UK/US retitling makes aliases *common* in books, not exceptional:
 *
 *  1. **A real title always wins.** An alias folding to some other work's actual
 *     title is discarded outright.
 *  2. **A contested alias belongs to nobody.** Two works claiming one alias makes
 *     that string ambiguous, and picking either is how two different books get
 *     silently merged.
 */
export function buildWorkIndex<T extends MatchableWork>(
  works: readonly T[],
  aliases: readonly WorkAliasRef[] = [],
): WorkIndex<T> {
  const entries = works.map((work) => ({
    work,
    titleKey: normaliseTitle(work.title),
    authorKey: normaliseTitle(primaryAuthor(work.authors)),
  }));

  if (aliases.length === 0) return { entries, aliasKeys: new Map() };

  const byId = new Map(works.map((w) => [w.id, w]));
  const realTitles = new Map<string, number>();
  for (const e of entries) if (!realTitles.has(e.titleKey)) realTitles.set(e.titleKey, e.work.id);

  const claimed = new Map<string, T | null>(); // null = contested, do not use
  for (const a of aliases) {
    const work = byId.get(a.workId);
    if (!work) continue;
    const key = normaliseTitle(a.alias);
    if (key.length < 2) continue;
    if (realTitles.has(key)) continue; // rule 1

    const seen = claimed.get(key);
    if (seen === undefined) claimed.set(key, work);
    else if (seen !== null && seen.id !== work.id) claimed.set(key, null); // rule 2
  }

  const aliasKeys = new Map<string, T>();
  for (const [key, work] of claimed) if (work) aliasKeys.set(key, work);

  return { entries, aliasKeys };
}

export interface WorkMatch<T> {
  work: T;
  /** How the match was made, so the review screen can say so. */
  via: 'exact' | 'alias' | 'containment';
  titleSimilarity: number;
  /** Null when the caller supplied no author to check against. */
  authorSimilarity: number | null;
}

/**
 * Match a title (and author, when known) against the catalog.
 *
 * Three comparisons, in falling order of how much they claim:
 *
 * | | |
 * |---|---|
 * | exact title | the same book, said the same way |
 * | exact alias | the same book, said another way — asserted, not inferred |
 * | containment | a guess, gated at 60% of the longer string |
 *
 * **The author gate applies to all three.** An alias is an identity claim about
 * a string, but it is not a claim that every author who ever used that string
 * wrote the same book — "The Golden Compass" is Pullman's, and asserting the
 * alias must not hand it to someone else's identically-titled novel.
 *
 * `author` may be omitted (a spine read that showed no author, a Kindle row with
 * a blank field). Then this degrades to title-only matching, which is exactly
 * the Board Game Catalog's behaviour and exactly as unsafe — so callers that can
 * supply an author must, and `matchNeedsAuthor` below reports when one was
 * missing so the review screen can mark the row rather than tick it.
 */
export function matchIndexedWork<T extends MatchableWork>(
  index: WorkIndex<T>,
  title: string,
  author?: string | null,
): WorkMatch<T> | null {
  const target = normaliseTitle(title);
  if (target.length < 2) return null;

  const authorKey = author ? normaliseTitle(primaryAuthor(author)) : null;

  /** An author that contradicts is a rejection, not a lower score. */
  const authorOk = (candidateAuthorKey: string): number | null => {
    if (!authorKey) return null;
    const score = titleSimilarity(candidateAuthorKey, authorKey);
    return score >= MIN_AUTHOR_SIMILARITY ? score : Number.NaN;
  };

  const exact = index.entries.find((e) => e.titleKey === target);
  if (exact) {
    const a = authorOk(exact.authorKey);
    if (!Number.isNaN(a as number)) {
      return { work: exact.work, via: 'exact', titleSimilarity: 1, authorSimilarity: a };
    }
    // An exact title with the wrong author is not "no match found" — it is a
    // *different book with the same name*, and falling through to containment
    // would only find the same row again. Stop here.
    return null;
  }

  const aliased = index.aliasKeys.get(target);
  if (aliased) {
    const entry = index.entries.find((e) => e.work.id === aliased.id);
    const a = entry ? authorOk(entry.authorKey) : null;
    if (!Number.isNaN(a as number)) {
      return { work: aliased, via: 'alias', titleSimilarity: 1, authorSimilarity: a };
    }
    return null;
  }

  const contained = index.entries
    .filter((e) => {
      if (e.titleKey.length < 3) return false;
      const contains = e.titleKey.includes(target) || target.includes(e.titleKey);
      if (!contains) return false;
      // The shorter string must be at least 60% of the longer. This is what
      // stops "Mistborn" matching "Mistborn: The Final Empire" — which for books
      // is not a near miss but a genuinely different row, since the series name
      // and the volume title are routinely both printed on the spine.
      const shorter = Math.min(e.titleKey.length, target.length);
      const longer = Math.max(e.titleKey.length, target.length);
      if (shorter / longer < 0.6) return false;
      return !Number.isNaN(authorOk(e.authorKey) as number);
    })
    .sort((a, b) => b.titleKey.length - a.titleKey.length)[0];

  if (!contained) return null;
  return {
    work: contained.work,
    via: 'containment',
    titleSimilarity: titleSimilarity(contained.titleKey, target),
    authorSimilarity: authorOk(contained.authorKey),
  };
}

/**
 * True when a match was made without an author to check it against.
 *
 * Not an error — plenty of legitimate reads have no author — but the one thing
 * the review screen must surface rather than tick, because it is precisely the
 * `BOSS MONSTER` → `Super Boss Monster 2` shape that files a genuinely new book
 * under *already yours*, where it is lost rather than merely wrong.
 */
export function matchNeedsAuthor<T>(match: WorkMatch<T> | null): boolean {
  return match !== null && match.authorSimilarity === null && match.via !== 'exact';
}
