/**
 * **How a printing is SPELLED when it leaves this catalog.**
 *
 * Extracted 2026-08-19 from `routes/audiobook-mapping.ts`, where it was a
 * private function, because `routes/gabi-delegated.ts`'s `browse-works` verb
 * became its second caller — and a second spelling of the same six-values-to-
 * four-words mapping is exactly the drift CLAUDE.md's "one implementation of
 * anything that makes a decision" rule exists to prevent. Behaviour is
 * unchanged; `format-labels.test.ts` is the test the private version never had.
 *
 * ⚠️ **The words matter to a machine as well as to a person.** The audiobook
 * catalog stores these strings verbatim in `catalog.csv`'s `library_formats`
 * column (pipe-separated, e.g. `Hardcover|Ebook`), and the Discord bot's
 * `PHYSICAL_FORMAT_TOKENS` matches on the lower-cased parts. Changing a label
 * here silently un-matches rows in two other repos.
 *
 * Mirrors `apps/web/src/lib/formats.ts` `FORMAT_LABEL`'s physical spellings, so
 * the word is the same wherever a person reads it in this estate.
 */

import { editionMedium } from '@lc/core';

/** ⚠️ Keyed on the RAW `EDITION_FORMATS` values. An unknown key falls through
 *  to itself rather than to a guess — see `crossCatalogFormatLabels`. */
export const PHYSICAL_FORMAT_LABEL: Record<string, string> = {
  hardcover: 'Hardcover',
  paperback: 'Paperback',
  mass_market: 'Mass market',
};

/**
 * Stable, sensible order: physical formats as they are likely to be shelved,
 * `Ebook` last — rather than whatever order SQLite's `group_concat` happened to
 * return, which is otherwise insertion order and not meaningful here.
 */
const LABEL_ORDER = ['Hardcover', 'Paperback', 'Mass market', 'Ebook'];

/**
 * `EDITION_FORMATS` → the labels another catalog reads.
 *
 * Each `PHYSICAL_FORMATS` value keeps its own label (a hardcover and a paperback
 * are different things worth two links), and every `ebook_*` format — file or
 * Kindle licence alike — folds to one `Ebook`, because "do we also have this to
 * read" is the honest granularity a *different* catalog's UI needs, not which of
 * five ebook variants.
 *
 * ⚠️ The ebook fold goes through `editionMedium`, which defines ebook as the
 * NEGATION of `PHYSICAL_FORMATS`. So a seventh format added to the enum lands on
 * one side of this line without anybody remembering to widen a second array.
 */
export function crossCatalogFormatLabels(rawFormats: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const format of rawFormats) {
    if (editionMedium(format) === 'ebook') {
      labels.add('Ebook');
    } else {
      labels.add(PHYSICAL_FORMAT_LABEL[format] ?? format);
    }
  }
  return LABEL_ORDER.filter((l) => labels.has(l));
}

/**
 * The same words, physical only — what `browse-works` hands the suggestion lane,
 * which is asking about objects on a shelf and has no use for `Ebook`.
 *
 * ⚠️ **Derived by filtering the shared function, never by a second table.** An
 * `Ebook` that leaked into a physical suggestion would send somebody to a
 * bookcase for a file.
 */
export function physicalFormatLabels(rawFormats: readonly string[]): string[] {
  return crossCatalogFormatLabels(rawFormats).filter((l) => l !== 'Ebook');
}
