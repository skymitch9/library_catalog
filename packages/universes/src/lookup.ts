/**
 * The universe lookup — pure, no I/O, no imports.
 *
 * ⚠️ THIS IS ONE OF TWO IMPLEMENTATIONS. The other is
 * `audiobook_catalog/app/core/universes.py`, and it has to give the same answer
 * because the two catalogs describe the same books. There is no shared runtime
 * between a Cloudflare Worker and a Python static build, so there is no shared
 * implementation; `universes.fixtures.json` is what keeps them honest, and both
 * repos run it.
 *
 * This estate has already shipped that class of bug once — `resolve_author_link`
 * (Python) and `_resolveAuthorFolder` (JS) split author strings identically
 * until they did not, and a promote failed silently. See catalog-platform
 * `docs/PLATFORM.md` §2.3.
 *
 * The resolution order is fixed by `_lookup.order` in the data file. Change it
 * here and you must change it there, in the Python, and in the fixtures.
 */

export interface UniverseBook {
  title: string;
  why: string;
  /** Present on the Otherlife entries, whose series exists only inside their titles. */
  series?: string;
  volume?: number;
}

export interface Universe {
  name: string;
  decidedHow: 'seed' | 'llm' | 'human';
  series?: string[];
  /** Deliberate refusals for THIS universe. Never returns a universe; records a decision. */
  notSeries?: string[];
  bookOverrides?: UniverseBook[];
  bookExclusions?: UniverseBook[];
  penNames?: string[];
  notes?: string;
  confirmed?: string;
  evidence?: string;
}

export interface UniversesDocument {
  schemaVersion: number;
  universes: Universe[];
  canonicalNames: Record<string, string>;
  _refused?: Array<Record<string, unknown>>;
}

export interface UniverseIndex {
  readonly series: ReadonlyMap<string, string>;
  readonly overrideTitles: ReadonlyMap<string, string>;
  readonly excludedTitles: ReadonlyMap<string, string>;
  readonly canonicalNames: ReadonlyMap<string, string>;
}

/**
 * Lowercase, fold curly quotes to straight, collapse whitespace, trim.
 *
 * ⚠️ The curly-apostrophe fold is load-bearing and not cosmetic. The audiobook
 * catalog stores `The Frugal Wizard’s Handbook…` with U+2019, and that row is
 * the single exclusion proving a series-level mapping cannot work. Miss the fold
 * and the one row the whole design rests on silently resolves to The Cosmere.
 *
 * ⚠️ This is NOT `normaliseTitle` from `@lc/core`. That one strips leading
 * articles and produces STORED keys — `work.work_key`, Firestore document ids —
 * so changing it is a migration. This one compares against a hand-written list
 * where "The Cosmere" and "Cosmere" are deliberately different strings, and it
 * writes nothing. Reusing either for the other's job would be a bug.
 */
export function normaliseUniverseText(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Six universes and ~50 keys — a few Maps, built once, held in memory. */
export function buildUniverseIndex(doc: UniversesDocument): UniverseIndex {
  const series = new Map<string, string>();
  const overrideTitles = new Map<string, string>();
  const excludedTitles = new Map<string, string>();
  const canonicalNames = new Map<string, string>();

  for (const u of doc.universes ?? []) {
    for (const s of u.series ?? []) series.set(normaliseUniverseText(s), u.name);
    for (const b of u.bookOverrides ?? []) overrideTitles.set(normaliseUniverseText(b.title), u.name);
    for (const b of u.bookExclusions ?? []) excludedTitles.set(normaliseUniverseText(b.title), u.name);
  }
  for (const [alias, target] of Object.entries(doc.canonicalNames ?? {})) {
    if (alias.startsWith('_')) continue; // `_note` / `_namespace` are prose
    canonicalNames.set(alias, target);
  }

  return { series, overrideTitles, excludedTitles, canonicalNames };
}

export interface UniverseQuery {
  title?: string | null;
  series?: string | null;
}

/**
 * Resolve one catalog row to a universe name, or null.
 *
 * ⚠️ Exclusions are checked FIRST, so the answer never depends on which rule
 * fires. `The Frugal Wizard’s Handbook` and `Lux - A Texas Reckoners Novel` both
 * sit beside titles that would otherwise sweep them in.
 *
 * ⚠️ Titles match exactly after normalising — never prefix, never substring.
 * Substring matching would make `Elantris` match `The Hope of Elantris`.
 *
 * null is the ordinary answer, not an error. Most books are in no universe, and
 * a guess is the one outcome this whole list exists to prevent.
 */
export function universeFor(index: UniverseIndex, query: UniverseQuery): string | null {
  const title = normaliseUniverseText(query.title);
  if (title && index.excludedTitles.has(title)) return null;
  if (title) {
    const hit = index.overrideTitles.get(title);
    if (hit !== undefined) return hit;
  }
  const series = normaliseUniverseText(query.series);
  if (series) {
    const hit = index.series.get(series);
    if (hit !== undefined) return hit;
  }
  return null;
}

/** Fold a spelling onto the owner's. Unknown names return null — never a guess. */
export function canonicalUniverseName(index: UniverseIndex, name: string | null | undefined): string | null {
  return index.canonicalNames.get(normaliseUniverseText(name)) ?? null;
}

/** Every series and override title belonging to one universe. Answers "all Cosmere books" in memory. */
export function membersOf(doc: UniversesDocument, universeName: string): { series: string[]; titles: string[] } {
  const u = (doc.universes ?? []).find((x) => x.name === universeName);
  if (!u) return { series: [], titles: [] };
  return { series: [...(u.series ?? [])], titles: (u.bookOverrides ?? []).map((b) => b.title) };
}
