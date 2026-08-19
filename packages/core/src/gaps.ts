/**
 * What this catalog is actually missing — and, far more of the work, what it is
 * not.
 *
 * ⚠️ Leaf module. Imports `constants.ts` and nothing else; see the header there.
 *
 * ## The measurement that shaped every line below
 *
 * Production, read 2026-08-10:
 *
 * | | |
 * |---|---|
 * | works | **116** |
 * | no `first_published` | **116** |
 * | no `description` | **116** |
 * | no `subtitle` | **116** |
 * | no `series` | **13** — of which **13 are already researched answers** |
 * | series set, no volume number | **10** |
 * | no cover | **1** |
 * | no `openlibrary_work_id` | **71** — of which 68 were searched and not found |
 * | editions | **117**, every one `ebook_epub` from a file |
 * | editions with no ISBN-13 | **117** |
 * | editions with no publisher / year / pages | **116** |
 * | copies of any status | **0** |
 *
 * So "which columns are null" is not a queue, it is the whole catalog listed
 * against the whole schema. Something has to decide, per field, whether an empty
 * column is **a question, an answer, or a category error**, and this file is
 * that something.
 *
 * ## What is asked for, and why
 *
 * | Field | Absent on | Asked because |
 * |---|---|---|
 * | `firstPublished` | 116/116 | Every book was published in a year, including the Kindle-native half. It is knowable for all of them and recorded for none. |
 * | `series` | 13, minus verdicts | The 13 are named answers, not gaps — see below. The field stays on the list because the next book added will be a real question. |
 * | `seriesIndex` | 10 | "Which volume is this?" A real question for a light novel; a real *answer* of `none` for a side story, which is why it is verdictable. |
 * | `description` | 116/116 | One or two sentences saying what the book is. Nothing else in the catalog answers "what is this". |
 *
 * ## What is refused, and why — the longer and more important list
 *
 * - **`isbn13`.** ⚠️ The strongest refusal here. An ISBN identifies **one
 *   printing**, and every edition in this catalog is an EPUB extracted from a
 *   file. A model asked for "the ISBN of this book" will return a real,
 *   checksum-valid ISBN for *a printing nobody in this house owns*, and the
 *   catalog would then claim a hardcover on the strength of it. That is
 *   `isbn-ladder.md` §4.4's failure with the safety rail removed: there is no
 *   title string to compare, so nothing downstream could ever catch it.
 * - **`publisher`, `published_year`, `pages` on an edition.** Same shape. They
 *   describe a printing; the row describes a file. A print run's page count
 *   attached to an EPUB is a false statement that sorts and filters.
 * - **`openlibraryWorkId`.** Looked up, never reasoned. 68 of the 71 blanks were
 *   searched against openlibrary.org and it has nothing — recorded in
 *   `scripts/openlibrary-ids.json`, which is tracked precisely so the answer is
 *   not re-bought. A model asked for one emits a plausible `OL…W` and there is
 *   no cheap way to tell a real id from an invented one.
 * - **`coverUrl`.** One work has none, and it is a picture book whose file
 *   carries no cover image. No amount of research produces a JPEG.
 * - **`subtitle`.** Null on all 116, and null is *correct* on most books. An
 *   absent subtitle is the norm, not a gap.
 *
 * ## Answers are not gaps
 *
 * The 13 works with no series are the case this file was written around. Eleven
 * were researched on 2026-08-10 and are **true standalones**; two are genuinely
 * **unknown**. Both outcomes are recorded, with sources, in
 * `scripts/series-overrides.json`, and re-surfacing them as gaps would be the
 * catalog forgetting work it has already paid for. `gap_verdict` (migration
 * 0005) is where that memory lives in the database, and `scripts/seed-gap-verdicts.mjs`
 * is what puts those thirteen answers into it.
 */

import { DETAIL_FIELDS, type DetailField, type GapVerdict } from './constants.js';

/** Field names as a person would say them. */
export const DETAIL_FIELD_LABEL: Record<DetailField, string> = {
  firstPublished: 'first published',
  series: 'series',
  seriesIndex: 'volume number',
  description: 'description',
};

/**
 * Why a field a person might expect to see here is not on the list.
 *
 * Exported and rendered on the queue page rather than left as a comment. A
 * worklist that silently omits ISBN looks like an oversight; one that says
 * "refused, and here is the reason" is a decision somebody can argue with.
 */
export const REFUSED_FIELDS: readonly { field: string; because: string }[] = [
  {
    field: 'ISBN',
    because:
      'An ISBN identifies one printing. Every edition here is an EPUB from a file, so a found ISBN would claim a printing nobody owns — and no similarity check could catch it.',
  },
  {
    field: 'publisher, page count, print year',
    because:
      'Facts about a printing, attached to a row that is a file. Wrong in exactly the case anyone would look them up.',
  },
  {
    field: 'Open Library id',
    because:
      'Looked up, not reasoned. 68 of the 71 blanks were already searched and Open Library has nothing — see scripts/openlibrary-ids.json.',
  },
  {
    field: 'cover',
    because: 'One work has none: a picture book whose file carries no cover image. Research cannot make a JPEG.',
  },
  {
    field: 'subtitle',
    because: 'Absent on 116 of 116, and absent is correct for most books. Not a gap.',
  },
];

/** Enough of a work to decide what it still owes. Structural, so rows fit too. */
export interface GapSubject {
  firstPublished?: number | null;
  series?: string | null;
  seriesIndexSort?: number | null;
  /**
   * ⚠️ The volume number is TWO columns, and both matter here. `sort` (REAL)
   * is where the book files in the ladder; `display` (TEXT) is what actually
   * prints on the page. A row with sort set and display NULL sorts into
   * exactly the right position and prints nothing at all — 22 works were in
   * that state in production on 2026-08-13 while this queue reported zero
   * gaps, because the old predicate looked only at `seriesIndexSort`. A field
   * whose absence is only visible from one direction, same class as
   * `copy.edition_id` NULL.
   */
  seriesIndexDisplay?: string | null;
  description?: string | null;
  /**
   * Fields this work has already been answered about, found or not.
   *
   * ⚠️ Load-bearing. Without it the eleven researched standalones come back as
   * gaps on every pass, and the queue asks — and charges — for an answer the
   * catalog already has written down with a source.
   */
  verdicts?: readonly DetailField[];
}

/**
 * Is the volume number missing — in either of its two halves?
 *
 * `sort == null` means the book files nowhere in the ladder; a blank `display`
 * means the page prints nothing. Both states are a gap: a number nobody can
 * read is not an answer, and a printed number that sorts nowhere is not one
 * either. ⚠️ `gapSummary` in `@lc/db` uses this too — the tally and the queue
 * must agree on what "filled" means, or the summary claims work the rows still
 * owe.
 *
 * ⚠️ **The predicate is unchanged; what changed is who can satisfy it.** Until
 * 2026-08-19 `applyFinding` filled `sort` only, so a research-filled volume
 * number left this gap open FOR EVER — nothing else in the pipeline ever wrote
 * `display`. Measured that day on the friend instance, that dead end had become
 * the entire remaining queue: 55 of 55 rows were `seriesIndex`, 54 of them with
 * neither column set. `applyFinding` now writes the derived printed form
 * (`seriesIndexDisplayFrom`) alongside the sort, which is exactly what the
 * INGEST route has always written; see that function's header for why that is
 * a correction rather than a loosening. A person quoting a real cover still
 * wins — the derived form is only ever written into a blank, and
 * `isDerivedSeriesIndexDisplay` is how undo tells the two apart.
 */
export function seriesIndexIncomplete(
  sort: number | null | undefined,
  display: string | null | undefined,
): boolean {
  return sort == null || isBlankDetail(display);
}

/** True for null, undefined, and a string of nothing but spaces. */
export function isBlankDetail(value: string | number | null | undefined): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * The printed form this catalog writes when a machine fills a volume number and
 * nobody has quoted a cover.
 *
 * ## ⚠️ This is not new policy — it is the ingest route's policy, given a name
 *
 * `apps/worker/src/routes/ingest.ts` has written `Book ${sort}` into
 * `series_index_display` on **every work it has ever created with a volume
 * number**, on both instances, since the route existed. That is where the main
 * catalog's 184 rows whose display is exactly the sort number came from, and the
 * 81 that differ came from the TITLE STRING (*"High School DxD - Volume 07 - …"*
 * → `Volume 07`) — not from anybody photographing a cover.
 *
 * So the refusal `applyFinding` used to make — *"the display quotes the cover,
 * and research read a web page"* — was protecting a provenance that has never
 * existed anywhere in this repo, and it cost real convergence:
 * **measured 2026-08-19 on `library-catalog-2nd`, 55 of 55 remaining queue rows
 * were `seriesIndex`, and 54 of them had NEITHER column set.** Research fills
 * `sort`; `seriesIndexIncomplete` needs both; so every one of those rows was a
 * row research could be paid for for ever and never close. That is the whole
 * "this queue does not converge" problem, arrived at its end state.
 *
 * The rule now is: a machine that is trusted to write the SORT is trusted to
 * write the ordinary printed form of the same number, and nothing more. It is
 * still a derivation and it is still weaker than a person reading a cover —
 * which is why it is one function, used by both writers, so "what does the
 * machine print" has exactly one answer and `isDerivedSeriesIndexDisplay` can
 * recognise its own handwriting when undoing.
 *
 * ⚠️ It must stay derivable from `sort` ALONE. `isDerivedSeriesIndexDisplay` is
 * how `revertFinding` decides whether a display string is the machine's to take
 * back, and that test only works while this function has no other input.
 */
export function seriesIndexDisplayFrom(sort: number): string {
  // `.0` is not something `toString()` produces; it is carried from the ingest
  // route verbatim so the two writers cannot differ even on an input neither
  // expects.
  return `Book ${Number(sort).toString().replace(/\.0$/, '')}`;
}

/**
 * Is this display string the machine's own derivation of this sort value?
 *
 * ⚠️ Used by `revertFinding` and by nothing else, for one reason: undo may clear
 * a column the machine filled and must NEVER clear one a person typed. A
 * hand-quoted *"Prequel"* or *"Volume 07"* fails this test and survives the
 * undo; a `Book 3` beside `sort = 3` is recognisably ours and goes.
 */
export function isDerivedSeriesIndexDisplay(
  sort: number | null | undefined,
  display: string | null | undefined,
): boolean {
  if (sort == null || typeof display !== 'string') return false;
  return display.trim() === seriesIndexDisplayFrom(sort);
}

/**
 * The fields this work can meaningfully be asked about at all.
 *
 * One conditional, and it is not cosmetic: **"which volume is this?" is not a
 * question you can ask a book with no series.** Asking it anyway is how a model
 * is handed a blank to fill and invents a series to put the number in.
 */
export function detailFieldsFor(subject: GapSubject): DetailField[] {
  return DETAIL_FIELDS.filter((field) =>
    field === 'seriesIndex' ? !isBlankDetail(subject.series) : true,
  );
}

/**
 * What this work is asked for and does not have. Empty means it leaves the queue.
 *
 * The order is `DETAIL_FIELDS`' order, so two rows that owe the same things read
 * identically and the "missing:" line under a row can never disagree with the
 * query that chose the row.
 */
export function detailGaps(subject: GapSubject): DetailField[] {
  const answered = new Set(subject.verdicts ?? []);
  return detailFieldsFor(subject).filter((field) => {
    if (answered.has(field)) return false;
    switch (field) {
      case 'firstPublished':
        return isBlankDetail(subject.firstPublished);
      case 'series':
        return isBlankDetail(subject.series);
      case 'seriesIndex':
        // ⚠️ Both columns, not one — see `seriesIndexIncomplete`. The old
        // `seriesIndexSort == null` test was blind to a row that sorts
        // correctly and prints nothing.
        return seriesIndexIncomplete(subject.seriesIndexSort, subject.seriesIndexDisplay);
      case 'description':
        return isBlankDetail(subject.description);
    }
  });
}

/**
 * What a research finding proposes about one field.
 *
 * ⚠️ Three outcomes, not two, and the third is the one that is easy to drop.
 * "Research could not establish this" is a *result*: recorded, it stops the
 * field being asked again; discarded, the next pass buys the same nothing. It
 * is the same three-way split `series-overrides.json` already uses.
 */
export type FindingKind =
  /** A value was found, and `value` holds it. */
  | 'found'
  /** There is no such thing for this book — a genuine standalone. */
  | 'none'
  /** Looked, and it is not settled anywhere reachable. */
  | 'unknown';

/**
 * The JSON stored in `research_finding.value_json`.
 *
 * An object rather than a bare value, because a bare `null` cannot say whether
 * it means "no series exists" or "nobody could tell". That distinction is the
 * feature.
 */
export interface FindingValue {
  kind: FindingKind;
  /** Present only when `kind` is `found`. A year, a series name, a sentence. */
  value?: string | number | null;
  /**
   * What the source actually says, in the model's words.
   *
   * ⚠️ This is what a person reads instead of a confidence score. See
   * `isbn-ladder.md` §4.4: on *Firefight* and again on *Unsouled*, a wrong
   * answer scored **1.00 on title and 1.00 on author**, and only the publisher
   * gave it away. A number beside a claim invites ranking; a sentence naming the
   * page invites reading.
   */
  basis?: string | null;
}

/** The verdict a `none`/`unknown` finding becomes when a person accepts it. */
export function verdictFor(kind: FindingKind): GapVerdict | null {
  return kind === 'none' ? 'none' : kind === 'unknown' ? 'unknown' : null;
}
