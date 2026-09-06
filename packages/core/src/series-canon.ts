/**
 * The estate series canon — CROSS-CATALOG series-spelling folds, as a rule.
 *
 * `catalog-platform/data/series-canon.json` records a series spelled one way in
 * `audiobook_catalog/site/catalog.csv` and another way in this repo's D1
 * `work.series` — the drift that left three series (Ascend Online, Harry
 * Potter, Fae & Alchemy) building ZERO cross-catalog audio rungs, because
 * `normaliseTitle` folds case and whitespace but not DECORATION
 * (`"[publication order]"`, `"(Full-Cast Editions)"`).
 *
 * ⚠️ **This file holds the RULE, never the DATA.** `@lc/core` promises "no I/O
 * — safe to import anywhere", and a build-generated file with a cross-repo
 * provenance does not belong inside that promise — `@lc/universes`' header says
 * so outright and is the only package in the repo allowed to reach another one.
 * So the map is built by the caller and passed in:
 *
 * | Caller | Where its canon comes from | How fresh |
 * |---|---|---|
 * | `scripts/lib/series-canon.mjs` | `catalog-platform/data/series-canon.json`, read LIVE out of the sibling checkout | as fresh as the last `git pull` of catalog-platform |
 * | `@lc/universes` (`seriesCanonMap`) | `packages/universes/generated/series-canon.json`, materialised by `scripts/sync-universes.mjs` | as fresh as the last build/deploy |
 *
 * 🔴 **Those two can disagree, and when they do the WORKER is the stale one.**
 * That difference is stated out loud in
 * `catalog-platform/docs/info/audiobook-association-route.md` §2.4 and accepted
 * with a guard: the route reports the canon's entry count in its status line, so
 * a deploy that shipped an empty or stale canon is visible in one curl rather
 * than as a page full of hedged rungs months later. A Worker cannot read across
 * repos at runtime, so there is no third option — only a choice about whether
 * the skew is visible.
 *
 * ## Why an unknown name passes through unchanged
 *
 * A series with no recorded cross-catalog drift is still a series, correctly
 * spelled, and this must hand it back rather than erase it. Deliberately unlike
 * `universes.json`'s `canonicalName`, which returns null for an unknown name:
 * a universe lookup has a real empty case ("this series belongs to no
 * universe") and a series-name fold does not.
 *
 * ## Why a map and not a rule
 *
 * The data file's own `_decided.whyAFileAndNotAFunction` settles it: a
 * decoration-stripping RULE is a discovery tool, and running it at match time
 * would merge two series that only coincidentally share a decoration pattern —
 * and would have to be reproduced identically in Python and twice in
 * JavaScript. A flat variant -> canonical map matched EXACTLY has none of that
 * risk. **Callers still run the result through `normaliseTitle` themselves**;
 * this only removes the decoration-shaped drift that `normaliseTitle` alone
 * does not.
 */

/** One entry of `series-canon.json`. Extra keys (`evidence`, `decidedHow`) ride along ignored. */
export interface SeriesCanonEntry {
  canonical?: string | undefined;
  variants?: readonly string[] | undefined;
}

/** `series-canon.json` as far as this rule is concerned. */
export interface SeriesCanonDocument {
  entries?: readonly SeriesCanonEntry[] | undefined;
}

/** Normalised variant -> canonical spelling. */
export type SeriesCanonMap = ReadonlyMap<string, string>;

/**
 * Lowercase, fold curly quotes to straight, collapse whitespace, trim.
 *
 * ⚠️ Identical fold to `catalog-platform`'s `tools/lib/{universes,series-canon}.mjs`
 * `normText` — the estate's ONE text-normalisation rule for names, not a second
 * one drifting from the first. It is deliberately NOT `normaliseTitle`:
 * `normaliseTitle` produces `work_key` and Firestore document ids, so changing
 * it is a migration, and this is a comparison key that is never stored.
 */
export function normText(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Build the lookup map from a parsed `series-canon.json`.
 *
 * The canonical spelling is registered as a variant of itself, so a name
 * already in canonical form is found rather than falling through to the
 * pass-through branch — the two paths must not be distinguishable.
 *
 * ⚠️ Never throws on a malformed document. An entry with no `canonical` is
 * skipped; a document with no `entries` yields an empty map, which degrades the
 * fold to plain `normaliseTitle` — exactly the behaviour before this file
 * existed. Deciding whether that is worth a warning is the CALLER's job,
 * because only the caller knows where the file was supposed to come from.
 */
export function buildSeriesCanonMap(doc: SeriesCanonDocument | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of doc?.entries ?? []) {
    if (!entry.canonical) continue;
    for (const variant of [...(entry.variants ?? []), entry.canonical]) {
      map.set(normText(variant), entry.canonical);
    }
  }
  return map;
}

/**
 * Fold a series name onto its estate-canon canonical spelling.
 *
 * ⚠️ An unknown name is returned UNCHANGED, not null — see the header. A blank,
 * null or undefined name is returned exactly as it arrived, so a caller that
 * holds `string | null` gets `string | null` back and nothing has to guard.
 */
export function canonicalSeriesIn(map: SeriesCanonMap, name: string): string;
export function canonicalSeriesIn(
  map: SeriesCanonMap,
  name: string | null | undefined,
): string | null | undefined;
export function canonicalSeriesIn(
  map: SeriesCanonMap,
  name: string | null | undefined,
): string | null | undefined {
  if (!name) return name;
  return map.get(normText(name)) ?? name;
}
