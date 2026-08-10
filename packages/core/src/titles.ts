/**
 * Leaf module: folding a title and an author down to something comparable.
 *
 * **This is the one implementation.** Everything that needs a folded title, a
 * split author list or a work key calls in here — the Worker, the CLI, the
 * review bridge, the web app. Imports nothing. No I/O.
 *
 * ## Why "the one implementation" is written in bold
 *
 * `audiobook_catalog` splits author strings in four places and they do not all
 * agree — measured 2026-08-09:
 *
 * | Where | Rule |
 * |---|---|
 * | `app/tools/audit_site.py:86` | `re.split(r"[;,/&]\| and ", …)` |
 * | `app/web/templates/app.js:157` | `author.split(/[;,\/&]\|\sand\s/i)` |
 * | `app/metadata.py:149` | comma only |
 * | `app/tools/generate_author_map.py:19` | comma only |
 *
 * Its own docs record that keeping those in sync was a real, silent bug. A fifth
 * implementation, in a third language, is how that bug returns — and here it
 * would be worse, because the author is half of `workKey`, so a disagreement
 * does not produce a cosmetic difference, it produces a review that silently
 * fails to appear on the other site.
 *
 * The rule below is the `[;,/&]| and ` one, because that is what the two
 * *display* paths use and display is what a person checks against. The
 * comma-only pair agrees with it on the **first** author in every case that
 * matters, which is the only part `workKey` reads — that is the reason this
 * divergence is survivable, and it is why `workKey` uses the primary author
 * rather than the whole list.
 *
 * There was briefly a second implementation of this fold in Python, for an ebook
 * indexer that has since been removed, plus an `npm run check:fold` that proved
 * the two agreed. Both are gone. **If a second language ever needs these rules
 * again, bring that parity check back with it** — it is not optional, and it
 * caught nothing only because it existed.
 */

/**
 * Fold a title down to something comparable.
 *
 * Spines and covers print titles in ways a catalog never will — all caps,
 * ampersands, accented type, a leading article. None of that changes which book
 * it is.
 *
 * Identical to the Board Game Catalog's `normaliseTitle`, deliberately: the
 * matcher, the alias table and the lookup cache all assume this exact fold, and
 * "improving" it silently invalidates every cached row and every stored key.
 */
export function normaliseTitle(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // Café -> Cafe
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Split an author field into names, using the audiobook catalog's display rule.
 *
 * Empty strings are dropped and the "- Translator" suffix that catalog carries
 * ("Jennifer E. Sunseri - Translator") is stripped, because a translator is not
 * who wrote it and must never become the primary author.
 */
export function splitAuthors(raw: string): string[] {
  return raw
    .split(/[;,/&]|\sand\s/i)
    .map((a) => a.replace(/\s*-\s*(Translator|Narrator|Editor)\s*$/i, '').trim())
    .filter(Boolean);
}

/**
 * The name the work is filed under. First listed, not "most famous".
 *
 * Falls back to the raw string when splitting yields nothing, so a work with a
 * strange author field still gets a key rather than an empty one — an empty
 * author half would make the key title-only, which is the exact collision this
 * design exists to avoid.
 */
export function primaryAuthor(raw: string): string {
  return splitAuthors(raw)[0] ?? raw.trim();
}

/**
 * ⚠️ THE BRIDGE BETWEEN THIS CATALOG AND THE AUDIOBOOK ONE.
 *
 * `normaliseTitle(title) | normaliseTitle(primaryAuthor(authors))`.
 *
 * Computed once, on write, stored in `work.work_key`, and written onto every
 * review document so a paperback and an audiobook of the same book find each
 * other. Never recomputed at read time — a fold that changes must be a
 * migration, not a silent re-interpretation of stored keys.
 *
 * ## Why the author has to be in it
 *
 * The audiobook site keys reviews on `bookIdFromTitle(title)` — a slug of the
 * **title alone**, no author anywhere in it. That is fine inside one catalog of
 * 1,073 rows and is not fine across catalogs: book titles collide across authors
 * constantly, which is the failure `LIBRARY_CATALOG.md` §3 calls out. Two
 * different books called "Gold" must not share a review, and they would.
 *
 * ## Why it is a pipe and not a hyphen
 *
 * `normaliseTitle` reduces every non-alphanumeric run to a space, so a pipe
 * cannot occur inside either half. The key is therefore unambiguously splittable
 * back into its two parts, which the backfill needs and a hyphen would not give.
 */
export function workKeyFor(title: string, authors: string): string {
  return `${normaliseTitle(title)}|${normaliseTitle(primaryAuthor(authors))}`;
}

/** Split a stored `work_key` back into its halves. Null if it is malformed. */
export function parseWorkKey(key: string): { title: string; author: string } | null {
  const i = key.indexOf('|');
  if (i <= 0 || i === key.length - 1) return null;
  return { title: key.slice(0, i), author: key.slice(i + 1) };
}

/**
 * Article-stripped title for ordering. "The Hobbit" sorts under H.
 *
 * Distinct from `normaliseTitle`: this keeps case, punctuation and diacritics,
 * because it is shown to a person in a sorted list, not compared.
 */
export function sortTitleFor(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '').trim();
}

/**
 * Strip Audible's title decoration down to what is printed on a book.
 *
 * ## This function is a measurement, not a tidy-up
 *
 * Run against 30 titles sampled across this household's own audiobook catalog
 * on 2026-08-09, asking Open Library for each (docs/info/isbn-ladder.md):
 *
 * | Query | Hits |
 * |---|---|
 * | title verbatim from `catalog.csv` | **5 / 30** |
 * | the same title through this function | **14 / 30** |
 *
 * Nearly tripling the hit rate, from removing text that is not on the book. An
 * ebook importer or a spine matcher that skips this step is not slightly worse,
 * it is wrong about two thirds of the library.
 *
 * ⚠️ Order matters. The series suffix must go before the parenthetical, or
 * "Arc, Book 3)" survives inside the bracket.
 *
 * ⚠️ What it deliberately does NOT strip: a bare trailing number. "Summoner 6"
 * *is* the title — Eric Vall's books are named that way — and a rule that
 * removed it would turn six distinct works into one.
 */
export function cleanAudiobookTitle(raw: string): string {
  let t = raw;

  // Audible packaging that is never printed on a book. Removed FIRST, because
  // it sits between the title and the series suffix and blocks the rules below
  // from seeing them adjacent.
  //
  // Both were found by dry-running the review backfill over all 860 existing
  // review documents (2026-08-09) and reading the keys it produced — the
  // A Court of Thorns and Roses rows generated keys like
  // "court of mist and fury part 1 of 2 dramatized adaptation|sarah j maas",
  // which no print edition could ever match.
  t = t.replace(/\s*[-–—:,]?\s*\bPart\s+\d+\s+of\s+\d+\b/gi, '');
  t = t.replace(/\s*[-–—:,]?\s*\bDramatized Adaptation\b/gi, '');

  // " - The Reckoners, Book 2" / " - Series Name, Book One"
  t = t.replace(/\s*[-–—:]\s*[^,\-–—]*,\s*(Book|Volume|Vol\.?|Part)\s+[\w-]+\s*$/i, '');
  // ", Book 7" with no separator before the series name
  t = t.replace(/,\s*(Book|Volume|Vol\.?|Part)\s+[\w-]+\s*$/i, '');
  // " - A Court of Thorns and Roses, 2" — the same suffix with the word "Book"
  // left out, which Audible does inconsistently within a single series.
  //
  // ⚠️ Restricted to a bare NUMERAL on purpose. Allowing any trailing word here
  // would eat the tail of "Title - Subtitle, Something", and a lost word is a
  // key that silently matches the wrong book.
  t = t.replace(/\s*[-–—:]\s*[^,\-–—]*,\s*\d+(?:\.\d+)?\s*$/, '');
  // Leftover empty brackets from the two strippers above: "Title () ()".
  t = t.replace(/\s*\(\s*\)/g, '');
  // "(The Wandering Inn, Book 1)" / "(Volume 1)" / "(… Series …)"
  t = t.replace(
    /\s*\(([^()]*?(Book|Volume|Vol\.?|Part)\s+[\w-]+|[^()]*Series[^()]*)\)\s*$/i,
    '',
  );
  // Marketing tails that are never on a spine.
  t = t.replace(
    /\s*[-–—:]\s*(A Novel|A Novella|Light Novel|Unabridged)\s*$/i,
    '',
  );
  return t.replace(/\s*[-–—:]\s*$/, '').trim();
}

/**
 * The same clean, but told what the series is called.
 *
 * **Prefer this whenever a series name is available**, and it usually is:
 * `audiobook_catalog/site/catalog.csv` carries a `series` column beside every
 * title, and the ebook importer will have one from the OPF Calibre metadata.
 *
 * ## Why an exact strip beats the heuristic
 *
 * Audible writes the same suffix three ways *within one series*, measured
 * against the real catalog on 2026-08-09:
 *
 *     … (Dramatized Adaptation) - A Court of Thorns and Roses, Book 2
 *     … (Dramatized Adaptation) - A Court of Thorns and Roses 2
 *     … (Dramatized Adaptation) - A Court of Thorns and Roses
 *
 * The first is caught by the "Book N" rule. The second needs a rule that strips
 * a bare trailing numeral after a separator — which would also strip the tail of
 * a genuine subtitle, and a lost word is a key that silently matches the wrong
 * book. The third has nothing to pattern-match at all.
 *
 * Knowing the string "A Court of Thorns and Roses" removes the guesswork from
 * all three: it is deleted where it appears as a suffix, with any volume number
 * that trails it, and nothing else is touched.
 */
export function cleanTitleWithSeries(raw: string, series: string | null | undefined): string {
  const base = cleanAudiobookTitle(raw);
  if (!series) return base;

  const escaped = series.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return base;

  // Separator, the series name, and optionally a volume number after it.
  const suffix = new RegExp(
    `\\s*[-–—:,]\\s*(?:The\\s+)?${escaped}(?:\\s*,?\\s*(?:Book|Volume|Vol\\.?|Part)?\\s*[\\w.-]+)?\\s*$`,
    'i',
  );
  const stripped = base.replace(suffix, '').trim();

  // ⚠️ Never return empty. A standalone book whose title IS its series name —
  // "Dune", series "Dune" — would otherwise be reduced to nothing, and an empty
  // title half makes the work key author-only, which collides across every book
  // that author wrote.
  return stripped.length > 0 ? stripped : base;
}

/**
 * Pull a series name and volume out of an Audible-style title, when it says one.
 *
 * "Firefight - The Reckoners, Book 2" -> { series: 'The Reckoners', index: 2,
 * display: 'Book 2' }. Returns nulls when the title claims nothing, which is the
 * common case for standalone books and must not be guessed at.
 *
 * `index` is a number so it sorts (1, 2, 2.5, 3); `display` is what the cover
 * actually says, because "Book 2", "2.5" and "Prequel" are not interchangeable.
 * Both columns exist in `audiobook_catalog` already and are reused rather than
 * redesigned.
 */
export function parseSeriesFromTitle(raw: string): {
  series: string | null;
  index: number | null;
  display: string | null;
} {
  const m =
    /[-–—:]\s*([^,\-–—]+?),\s*(?:Book|Volume|Vol\.?|Part)\s+([\w.-]+)\s*$/i.exec(raw) ??
    /\(\s*([^,()]+?),\s*(?:Book|Volume|Vol\.?|Part)\s+([\w.-]+)\s*\)\s*$/i.exec(raw);
  if (!m) return { series: null, index: null, display: null };

  const series = (m[1] ?? '').trim();
  const rawIndex = (m[2] ?? '').trim();
  const numeric = Number(rawIndex);

  // Word numerals appear often enough to be worth the eight entries: "Book One"
  // is how several of these series are printed.
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const index = Number.isFinite(numeric)
    ? numeric
    : (words[rawIndex.toLowerCase()] ?? null);

  return { series: series || null, index, display: `Book ${rawIndex}` };
}
