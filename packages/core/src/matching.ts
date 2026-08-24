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

import type { WorkAliasKind } from './constants.js';
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
 * One known other name for one work — see `work_alias` in migrations 0001 and
 * 0005.
 *
 * Structural rather than the db package's row type, so `packages/core` stays a
 * leaf with nothing to import.
 *
 * `kind` is optional and absent means `'title'`, which is what every row written
 * before migration 0005 meant. That default lives here rather than at each call
 * site so a caller that has not been taught about author aliases cannot
 * accidentally feed one into the author gate.
 */
export interface WorkAliasRef {
  workId: number;
  alias: string;
  kind?: WorkAliasKind | undefined;
}

/**
 * The best agreement between one candidate name and every name we know a work by.
 *
 * ⚠️ One implementation, deliberately exported. The Open Library backfill applies
 * the same gate outside the index (it has no `WorkIndex` — it is comparing a
 * search result against one row it already holds), and this file's header records
 * what a second similarity function costs: three wrong-game matches shipped in
 * the sibling project, every one of them from a copy that drifted.
 *
 * Both sides must already be folded. Folding here would fold twice for every
 * caller that keeps a folded index, which is all of them.
 */
export function bestSimilarity(candidateKey: string, ourKeys: readonly string[]): number {
  let best = 0;
  for (const key of ourKeys) best = Math.max(best, titleSimilarity(candidateKey, key));
  return best;
}

/** Drop blanks and duplicates, preserving order. The primary name stays first. */
function distinct(keys: readonly string[]): string[] {
  return [...new Set(keys.filter((k) => k.length > 0))];
}

/**
 * The same folded title with a volume *marker word* removed from in front of its
 * number: "tamer king of dinosaurs book 7" -> "tamer king of dinosaurs 7".
 *
 * ## Why this exists — measured 2026-08-10 against production
 *
 * This catalog files Michael-Scott Earle's series as "Tamer: King of Dinosaurs
 * Book 7"; the audiobook catalog files the very same volume as "Tamer: King of
 * Dinosaurs 7". Nothing exact meets, and **containment cannot bridge it either**,
 * because containment is a substring test and the word "book" sits in the middle
 * of one side. The only audiobook row that *is* a substring of ours is the
 * series-level "Tamer: King of Dinosaurs" — so all five volumes matched one
 * generic row while the correct numbered rows sat unused beside it.
 *
 * ⚠️ This is a comparison key and **not** a change to `normaliseTitle`. That
 * function produces `work.work_key` and Firestore document ids; changing it is a
 * migration. This fold is computed at match time, is never stored, and is applied
 * identically to both sides — it is not a second similarity function, which the
 * header of this file bans for good reason.
 *
 * ⚠️ The marker must be followed by a number. "The Book Thief" keeps its "book",
 * because nothing numeric follows it.
 */
export function foldVolumeMarker(key: string): string {
  return key.replace(/\b(?:book|volume|vol|part)\s+(\d+(?:\.\d+)?)\b/g, '$1');
}

/**
 * The numbers a folded title contains, as a set of strings.
 *
 * Used to stop containment from silently adding or dropping a volume number —
 * see `numbersAgree`.
 */
function numbersIn(key: string): Set<string> {
  return new Set(key.match(/\d+(?:\.\d+)?/g) ?? []);
}

/**
 * True when two titles carry exactly the same numbers.
 *
 * ## ⚠️ The rule this enforces: a containment match may differ in words, never in
 * numbers.
 *
 * Containment exists so "Oathbound Healer - MM" can meet "Oathbound Healer" — a
 * difference of decoration. It must not let a *numbered volume* meet something
 * numbered differently, because that is not decoration, it is a different book.
 * Two real false positives this catches, both measured against production
 * 2026-08-10:
 *
 * | Ours | Matched | Why it is wrong |
 * |---|---|---|
 * | `Tamer: King of Dinosaurs Book 11` | `Tamer: King of Dinosaurs` | there is no volume 11 on audio at all |
 * | `The Primal Hunter` | `The Primal Hunter 10` | we hold book 1; the sort picked the longest key, which is the highest volume |
 *
 * The Tamer case is the worse of the two: it claims the household owns an
 * audiobook that does not exist. A wrong match is worse than no match, so this
 * gate rejects rather than down-ranks — the same stance the author gate takes.
 */
function numbersAgree(a: string, b: string): boolean {
  const left = numbersIn(a);
  const right = numbersIn(b);
  if (left.size !== right.size) return false;
  for (const n of left) if (!right.has(n)) return false;
  return true;
}

/**
 * Resolve a set of same-folded-title candidates to at most one, when a series
 * volume number can settle it.
 *
 * ## Why this exists — Space Knight, measured 2026-08-14
 *
 * Work #249 *Space Knight Book 1* and #250 *Space Knight Book 2* both refused
 * to match anything: the audiobook catalog's own title-cleaning strips the
 * series+volume suffix down to bare "Space Knight" for BOTH its volume-1 and
 * volume-2 rows, so the two candidates are textually identical and carry no
 * digit at all in their `titleKey` — `numbersAgree` (0 numbers vs 1) rejects
 * both, correctly, because a bare series-level row must not silently absorb a
 * numbered volume (see `numbersAgree`'s Tamer/Primal Hunter table above).
 *
 * The volume number has not vanished, though — it survives as a separate
 * field (`series_index_sort` in `catalog.csv`, carried here as
 * `MatchableWork.seriesIndex`) that the title-cleaning step never touches.
 * This function is the one place that field is allowed to settle a match, and
 * only under the narrow condition that makes it safe: MULTIPLE rows already
 * fold to the identical title (an ambiguous set — see `titleKeyCounts`), so
 * there is no risk of a stray CSV number overriding a real title mismatch.
 *
 * ## The rule
 *
 * - Exactly one candidate → return it. This is the overwhelmingly common case
 *   and changes nothing: a non-ambiguous fold never reaches this function with
 *   more than one entry.
 * - More than one candidate, and our side states no volume (`seriesIndex` is
 *   null) → refuse. We cannot tell them apart; guessing is the one thing this
 *   file's header bans.
 * - More than one candidate, and exactly one of them carries the SAME volume
 *   number → that one, and only that one.
 * - More than one candidate and zero or several share our volume number
 *   (neither side stated one clearly enough, or the data is inconsistent) →
 *   refuse. Same posture as "no volume on either side": a wrong match is worse
 *   than no match.
 */
function disambiguateByVolume<E extends { seriesIndex: number | null }>(
  candidates: readonly E[],
  seriesIndex: number | null | undefined,
): E | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] as E;
  if (seriesIndex == null) return null;
  const withVolume = candidates.filter((c) => c.seriesIndex != null && c.seriesIndex === seriesIndex);
  return withVolume.length === 1 ? (withVolume[0] as E) : null;
}

/**
 * Every folded name this work's author is known by — the printed one first, then
 * any `author` aliases.
 *
 * ⚠️ `primaryAuthor` is applied to the aliases too. An alias may legitimately be
 * written "Shirtaloon, Travis Deverell" if that is how the other side prints it,
 * and comparing the whole string against a folded primary author would make the
 * alias score worse than the name it was added to rescue.
 */
export function foldAuthorNames(authors: string, aliases: readonly string[] = []): string[] {
  return distinct([
    normaliseTitle(primaryAuthor(authors)),
    ...aliases.map((a) => normaliseTitle(primaryAuthor(a))),
  ]);
}

/** Every folded name this work is titled under — the catalog's first. */
export function foldTitleNames(title: string, aliases: readonly string[] = []): string[] {
  return distinct([normaliseTitle(title), ...aliases.map((a) => normaliseTitle(a))]);
}

/** The minimum a row must expose to be matchable. */
export interface MatchableWork {
  id: number;
  title: string;
  /** As printed. Split and folded here, never by the caller. */
  authors: string;
  /**
   * A series-volume number carried OUTSIDE the title string, when the row has
   * one — e.g. `catalog.csv`'s `series_index_sort` column. Absent/null for the
   * overwhelming majority of rows.
   *
   * ⚠️ Only ever consulted for **ambiguous-fold disambiguation** — see
   * `disambiguateByVolume` — and never as a substitute for `numbersAgree`'s
   * text-based check, which stays the primary gate. Widening its role would
   * let a stray CSV number paper over a genuine title mismatch.
   */
  seriesIndex?: number | null;
}

/**
 * The catalog's names, folded once, ready to be asked about repeatedly.
 *
 * Folding on every call is right for one question and wrong for seventy: a shelf
 * photo asked against 800 works re-folds 56,000 strings. This exists so nobody
 * writes a second, faster, subtly different matcher when the loop starts to hurt.
 */
export interface WorkIndex<T> {
  /**
   * `authorKeys` is a list rather than one string because a work may be filed
   * under a pen name somewhere else — *He Who Fights with Monsters* is Travis
   * Deverell here and Shirtaloon on Open Library. The printed author is always
   * first, so a report can name it without knowing about aliases.
   */
  entries: {
    work: T;
    titleKey: string;
    /**
     * `titleKey` with a volume marker word folded away — see `foldVolumeMarker`.
     * Equal to `titleKey` for the overwhelming majority of rows, and different
     * exactly where one catalog writes "Book 7" and the other writes "7".
     */
    matchKey: string;
    authorKeys: string[];
    /** Carried through from `MatchableWork.seriesIndex` — see its doc. */
    seriesIndex: number | null;
  }[];
  /**
   * Folded alternate titles, exact-match only, kept apart from `entries` because
   * the two answer *different questions* — see `matchIndexedWork`.
   */
  aliasKeys: Map<string, T>;
  /**
   * How many entries share each `titleKey`, catalog-wide. A count of 2+ is an
   * **ambiguous fold** — e.g. Space Knight vol 1 and vol 2 both stripping down
   * to bare "space knight" once their series/volume decoration is removed —
   * and is the trigger `disambiguateByVolume` checks for. A count of exactly 1
   * is the ordinary case and changes nothing about how that row is matched.
   */
  titleKeyCounts: Map<string, number>;
}

/**
 * Fold the catalog, and fold what else each row answers to.
 *
 * ## Title aliases
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
 *
 * ## Author aliases
 *
 * ⚠️ **Neither rule applies to them, and that is not an oversight.** Both exist
 * because a title alias *identifies a work* — a string that identifies two works
 * identifies neither. An author alias identifies nothing on its own; it only ever
 * widens the gate on the work that carries it, and a pen name shared by five
 * works is the ordinary case rather than the ambiguous one. Five *He Who Fights
 * with Monsters* volumes all answering to "Shirtaloon" is exactly right, and rule
 * 2 applied here would throw away every one of them.
 *
 * They are scoped per work for the same reason: an author alias on work 94 says
 * nothing about work 12, so it never enters a global map.
 */
export function buildWorkIndex<T extends MatchableWork>(
  works: readonly T[],
  aliases: readonly WorkAliasRef[] = [],
): WorkIndex<T> {
  const authorAliases = new Map<number, string[]>();
  for (const a of aliases) {
    if (a.kind !== 'author') continue;
    const list = authorAliases.get(a.workId);
    if (list) list.push(a.alias);
    else authorAliases.set(a.workId, [a.alias]);
  }

  const entries = works.map((work) => {
    const titleKey = normaliseTitle(work.title);
    return {
      work,
      titleKey,
      matchKey: foldVolumeMarker(titleKey),
      authorKeys: foldAuthorNames(work.authors, authorAliases.get(work.id) ?? []),
      seriesIndex: work.seriesIndex ?? null,
    };
  });

  const titleKeyCounts = new Map<string, number>();
  for (const e of entries) titleKeyCounts.set(e.titleKey, (titleKeyCounts.get(e.titleKey) ?? 0) + 1);

  if (aliases.length === 0) return { entries, aliasKeys: new Map(), titleKeyCounts };

  const byId = new Map(works.map((w) => [w.id, w]));
  const realTitles = new Map<string, number>();
  for (const e of entries) if (!realTitles.has(e.titleKey)) realTitles.set(e.titleKey, e.work.id);

  const claimed = new Map<string, T | null>(); // null = contested, do not use
  for (const a of aliases) {
    // Absent `kind` means 'title' — every row written before migration 0005.
    if (a.kind === 'author') continue;
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

  return { entries, aliasKeys, titleKeyCounts };
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
 * An author that contradicts is a rejection, not a lower score.
 *
 * Scored against every name the work is known by, best wins — so a pen name
 * recorded as an `author` alias passes the gate while an unrelated author still
 * fails it. A work with no aliases has exactly one key and behaves as before.
 *
 * Returns `null` when no author was supplied (the gate does not apply),
 * a score when it passes, and **NaN when it contradicts** — a sentinel rather
 * than a boolean because callers store the passing score. `authorPasses` below
 * is the only correct way to read it; `=== NaN` is always false.
 *
 * ⚠️ Module-level, and shared by both entry points on purpose. This gate is the
 * thing that stops *Firefight* reaching a different book called Firefight, and
 * a second copy of it inside `matchIndexedWorkAll` is exactly the drift this
 * file's header bans.
 */
function authorScoreFor(
  authorKey: string | null,
  candidateAuthorKeys: readonly string[],
): number | null {
  if (!authorKey) return null;
  const score = bestSimilarity(authorKey, candidateAuthorKeys);
  return score >= MIN_AUTHOR_SIMILARITY ? score : Number.NaN;
}

/** True unless `authorScoreFor` said the author contradicts. */
function authorPasses(score: number | null): boolean {
  return !Number.isNaN(score as number);
}

/**
 * Everything containment requires EXCEPT the number check, which the two
 * passes apply differently. Kept as one predicate so every pass — in both
 * entry points — agrees on containment, length ratio and the author gate, the
 * three things that must never loosen.
 */
function isBaseContained(
  entry: { titleKey: string; authorKeys: string[] },
  target: string,
  authorKey: string | null,
): boolean {
  if (entry.titleKey.length < 3) return false;
  const contains = entry.titleKey.includes(target) || target.includes(entry.titleKey);
  if (!contains) return false;
  // The shorter string must be at least 60% of the longer. This is what
  // stops "Mistborn" matching "Mistborn: The Final Empire" — which for books
  // is not a near miss but a genuinely different row, since the series name
  // and the volume title are routinely both printed on the spine.
  const shorter = Math.min(entry.titleKey.length, target.length);
  const longer = Math.max(entry.titleKey.length, target.length);
  if (shorter / longer < 0.6) return false;
  return authorPasses(authorScoreFor(authorKey, entry.authorKeys));
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
 *
 * `seriesIndex` may also be omitted — most callers (the spine-scan gate, most
 * of the audiobook backfill) have no volume number on the search side and
 * ambiguous-fold rows simply refuse, exactly as before this parameter existed.
 * Supplying it only ever narrows an otherwise-ambiguous fold to one row or to
 * none; see `disambiguateByVolume`. It never widens what already matches.
 */
export function matchIndexedWork<T extends MatchableWork>(
  index: WorkIndex<T>,
  title: string,
  author?: string | null,
  seriesIndex?: number | null,
): WorkMatch<T> | null {
  const target = normaliseTitle(title);
  if (target.length < 2) return null;

  const authorKey = author ? normaliseTitle(primaryAuthor(author)) : null;
  const authorOk = (candidateAuthorKeys: readonly string[]): number | null =>
    authorScoreFor(authorKey, candidateAuthorKeys);

  // Usually one row; more than one is an ambiguous fold (rare — two rows
  // printed identically once folded) and `disambiguateByVolume` is what
  // decides whether a stated series volume can tell them apart.
  const exactCandidates = index.entries.filter((e) => e.titleKey === target);
  const exact = disambiguateByVolume(exactCandidates, seriesIndex);
  if (exact) {
    const a = authorOk(exact.authorKeys);
    if (!Number.isNaN(a as number)) {
      return { work: exact.work, via: 'exact', titleSimilarity: 1, authorSimilarity: a };
    }
    // An exact title with the wrong author is not "no match found" — it is a
    // *different book with the same name*, and falling through to containment
    // would only find the same row again. Stop here.
    return null;
  }
  if (exactCandidates.length > 1) {
    // Ambiguous and the volume could not settle it — a positive refusal, not
    // "no exact match, try something weaker": every later stage would face
    // this identical fold collision, so falling through would only risk
    // guessing at what was already declined. See `disambiguateByVolume`.
    return null;
  }

  /*
   * The same title, with "Book 7" written as "7" on one side. Still `exact`:
   * it identifies one specific volume with nothing guessed at, which is a
   * strictly stronger claim than containment and belongs above it.
   *
   * ⚠️ Placed AFTER the literal test so a row that matches exactly as printed
   * always wins, and before containment so a numbered volume can never be
   * captured by its own series-level row. `titleSimilarity` reports the honest
   * word-overlap of the printed keys rather than 1, because the two strings do
   * differ — the caller stores it and the UI shows it.
   */
  const targetFolded = foldVolumeMarker(target);
  if (targetFolded !== target || index.entries.some((e) => e.matchKey !== e.titleKey)) {
    const foldedCandidates = index.entries.filter((e) => e.matchKey === targetFolded);
    const folded = disambiguateByVolume(foldedCandidates, seriesIndex);
    if (folded) {
      const a = authorOk(folded.authorKeys);
      if (!Number.isNaN(a as number)) {
        return {
          work: folded.work,
          via: 'exact',
          titleSimilarity: titleSimilarity(folded.titleKey, target),
          authorSimilarity: a,
        };
      }
      return null;
    }
    if (foldedCandidates.length > 1) {
      // Same refusal as the exact-title tier above, for the same reason.
      return null;
    }
  }

  const aliased = index.aliasKeys.get(target);
  if (aliased) {
    const entry = index.entries.find((e) => e.work.id === aliased.id);
    const a = entry ? authorOk(entry.authorKeys) : null;
    if (!Number.isNaN(a as number)) {
      return { work: aliased, via: 'alias', titleSimilarity: 1, authorSimilarity: a };
    }
    return null;
  }

  const baseContained = (e: (typeof index.entries)[number]): boolean =>
    isBaseContained(e, target, authorKey);

  // Pass 1, unchanged from before this parameter existed: a containment match
  // may differ in words, never in numbers. Without this every numbered volume
  // in a series is a substring match for the series-level row, and the sort
  // below — longest key first — then hands an unnumbered work the
  // *highest*-numbered volume it can find. See `numbersAgree` for the two
  // false positives this was measured against.
  let contained = index.entries
    .filter((e) => baseContained(e) && numbersAgree(e.titleKey, target))
    .sort((a, b) => b.titleKey.length - a.titleKey.length)[0];

  // Pass 2, only when pass 1 found nothing: the Space Knight shape. A
  // candidate whose titleKey carries NO number at all — because the
  // decoration that held it was stripped along with the rest — and which is
  // one of an ambiguous-fold GROUP (see `titleKeyCounts`) may still be
  // resolved by `seriesIndex`, the volume number that survived outside the
  // title text. A unique, non-ambiguous bare title (e.g. "Oathbound Healer",
  // or the Tamer series-level row) never reaches this: `titleKeyCounts` is 1
  // for it, so pass 2 is a no-op and pass 1's refusal stands.
  if (!contained) {
    const bareAmbiguous = index.entries.filter(
      (e) =>
        baseContained(e) &&
        numbersIn(e.titleKey).size === 0 &&
        (index.titleKeyCounts.get(e.titleKey) ?? 0) > 1,
    );
    contained = disambiguateByVolume(bareAmbiguous, seriesIndex) ?? undefined;
  }

  if (!contained) return null;
  return {
    work: contained.work,
    via: 'containment',
    titleSimilarity: titleSimilarity(contained.titleKey, target),
    authorSimilarity: authorOk(contained.authorKeys),
  };
}

/**
 * The same question as `matchIndexedWork`, asked of a catalog that can honestly
 * answer more than once.
 *
 * ## Why this exists — the two Elantris audiobooks, measured 2026-08-23
 *
 * `audiobookIndex` builds a `WorkIndex` over the SIBLING catalog's rows, so a
 * lookup is "which audiobook rows are this book of ours?". The household owns
 * two recordings of *Elantris* — a full-cast one filed with no series, and the
 * Tenth Anniversary edition filed as series *Elantris*, volume 1, narrated by
 * Jack Garrett. `matchIndexedWork` returns the FIRST rung that answers and
 * stops, which is exactly right when the caller can store one answer, and
 * exactly wrong for `audiobook_edition_holding` (migration 0390), which is
 * keyed per edition and wants the set.
 *
 * ## ⚠️ What this does NOT do: it never loosens a single gate
 *
 * Same rungs, same order, same author gate, same `numbersAgree` check, same
 * `disambiguateByVolume` refusals. This function only removes the *early
 * return* — nothing that was rejected before is accepted now. A row absent
 * from `matchIndexedWork`'s answer for any reason other than "something
 * stronger was found first" is absent here too. That is the whole design: a
 * second matcher with its own thresholds is the mistake this file's header
 * opens with, and there is not one comparison written below that is not
 * already written above.
 *
 * ## The refusals, restated because they are the safety
 *
 * - **Exact title, wrong author** → `[]`. A different book with the same name,
 *   and every weaker rung would only find the same row again.
 * - **Ambiguous fold that a volume number cannot settle** → refuse. Two
 *   audiobook rows both cleaning down to bare "Space Knight" must not BOTH be
 *   handed to volume 1; that is the flat-lie shape `numbersAgree` documents.
 *   When the refusal happens at a rung below one that already answered, the
 *   answers already proved stand and nothing weaker is tried — a positive
 *   refusal stops the search, it does not retract what a stronger rung
 *   established independently.
 * - **Containment pass 2** (the bare-ambiguous Space Knight shape) still runs
 *   only when pass 1 found nothing, and still resolves to at most one row.
 *
 * ## Ordering and duplicates
 *
 * Strongest rung first (exact, volume-marker fold, alias, then containment
 * longest-key first), so `[0]` is the same row `matchIndexedWork` would have
 * returned in every case where it returns one. One row can satisfy several
 * rungs — an exact title is trivially contained in itself — so results are
 * deduplicated by `work.id`, first (strongest) claim winning.
 *
 * Returns `[]` rather than null for "nothing", so a caller can always iterate.
 */
export function matchIndexedWorkAll<T extends MatchableWork>(
  index: WorkIndex<T>,
  title: string,
  author?: string | null,
  seriesIndex?: number | null,
): WorkMatch<T>[] {
  const target = normaliseTitle(title);
  if (target.length < 2) return [];

  const authorKey = author ? normaliseTitle(primaryAuthor(author)) : null;
  const authorOk = (candidateAuthorKeys: readonly string[]): number | null =>
    authorScoreFor(authorKey, candidateAuthorKeys);

  const out: WorkMatch<T>[] = [];
  const claimed = new Set<number>();
  const add = (match: WorkMatch<T>): void => {
    if (claimed.has(match.work.id)) return;
    claimed.add(match.work.id);
    out.push(match);
  };

  // Rung 1 — the literal title. See `matchIndexedWork` for why an ambiguous
  // fold refuses rather than falling through.
  const exactCandidates = index.entries.filter((e) => e.titleKey === target);
  const exact = disambiguateByVolume(exactCandidates, seriesIndex);
  if (exact) {
    const a = authorOk(exact.authorKeys);
    // A different book with the same name. Nothing weaker can help, and this
    // is the one refusal that discards rather than stops: nothing has been
    // proved yet at this point.
    if (!authorPasses(a)) return [];
    add({ work: exact.work, via: 'exact', titleSimilarity: 1, authorSimilarity: a });
  } else if (exactCandidates.length > 1) {
    return [];
  }

  // Rung 2 — the same title with "Book 7" written as "7" on one side. Still
  // `exact`; see the corresponding block in `matchIndexedWork`.
  const targetFolded = foldVolumeMarker(target);
  if (targetFolded !== target || index.entries.some((e) => e.matchKey !== e.titleKey)) {
    const foldedCandidates = index.entries.filter((e) => e.matchKey === targetFolded);
    const folded = disambiguateByVolume(foldedCandidates, seriesIndex);
    if (folded) {
      const a = authorOk(folded.authorKeys);
      if (!authorPasses(a)) return out;
      add({
        work: folded.work,
        via: 'exact',
        titleSimilarity: titleSimilarity(folded.titleKey, target),
        authorSimilarity: a,
      });
    } else if (foldedCandidates.length > 1) {
      return out;
    }
  }

  // Rung 3 — an alternate title the index asserts, exact only.
  const aliased = index.aliasKeys.get(target);
  if (aliased) {
    const entry = index.entries.find((e) => e.work.id === aliased.id);
    const a = entry ? authorOk(entry.authorKeys) : null;
    if (!authorPasses(a)) return out;
    add({ work: aliased, via: 'alias', titleSimilarity: 1, authorSimilarity: a });
  }

  // Rung 4 — containment, every row that passes rather than only the longest.
  // `numbersAgree` still gates pass 1, so a numbered volume can no more be
  // captured by its series-level row here than it can in `matchIndexedWork`.
  const contained = index.entries
    .filter((e) => isBaseContained(e, target, authorKey) && numbersAgree(e.titleKey, target))
    .sort((a, b) => b.titleKey.length - a.titleKey.length);

  if (contained.length === 0) {
    // Pass 2 — the Space Knight shape, and still at most one row: an ambiguous
    // fold that only `seriesIndex` can settle must not resolve to the whole
    // group. Unchanged from `matchIndexedWork`.
    const bareAmbiguous = index.entries.filter(
      (e) =>
        isBaseContained(e, target, authorKey) &&
        numbersIn(e.titleKey).size === 0 &&
        (index.titleKeyCounts.get(e.titleKey) ?? 0) > 1,
    );
    const one = disambiguateByVolume(bareAmbiguous, seriesIndex);
    if (one) contained.push(one);
  }

  for (const e of contained) {
    add({
      work: e.work,
      via: 'containment',
      titleSimilarity: titleSimilarity(e.titleKey, target),
      authorSimilarity: authorOk(e.authorKeys),
    });
  }

  return out;
}

/**
 * The known series names, folded once for membership tests. Feed it the union
 * the rule names: `work.series` ∪ `series_volume.series` ∪ `series_check.series`
 * (`listKnownSeriesNames` in `@lc/db` is that query). Same `normaliseTitle` as
 * everything else — a second fold here is the drift this file's header bans.
 */
export function foldSeriesNames(names: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const name of names) {
    const key = normaliseTitle(name);
    if (key.length >= 2) keys.add(key);
  }
  return keys;
}

/**
 * Tier 2 of the bare-series-name rule — `catalog-platform/docs/info/
 * matching-thresholds.md` §6: a candidate whose normalised title equals a
 * known series name and carries no volume marker/number is **review-only,
 * never auto-ticked, never refused**.
 *
 * Why review-only rather than a refusal: **18 of 341** real works are
 * legitimately titled with a bare series name (volume 1s — *The Wandering
 * Inn*, *Dungeon Crawler Carl*; picture books — *Bizzy Bear*). It may be
 * volume 1; a person can say so in one tap. And why not silence: the
 * 2026-08-13 phantom works (#300–#302) all wore exactly this title shape —
 * an Open Library record titled bare *Space Knight* absorbed six scanned
 * volumes as six editions and six copies of a book that does not exist.
 *
 * "Carries no volume number" is a digit test on the folded key, mechanically:
 * `normaliseTitle`'s alphabet is [a-z0-9 ], so any digit that survives the
 * fold is a volume-ish number ("Dungeon Crawler Carl 2"), and a marker word
 * with no number ("The Book Thief") deliberately does not count — same
 * stance as `foldVolumeMarker`, which only folds a marker *followed by* a
 * number.
 */
export function isBareSeriesTitle(title: string, seriesKeys: ReadonlySet<string>): boolean {
  const key = normaliseTitle(title);
  if (key.length < 2) return false;
  if (!seriesKeys.has(key)) return false;
  return !/\d/.test(key);
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
