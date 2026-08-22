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
 * Is the volume number missing? **`series_index_sort` alone decides.**
 *
 * ## ⚠️ OWNER RULE, 2026-08-19 — the printed form is OPTIONAL data
 *
 * Verbatim: *"We don't need physical volume if we have series. Only a few
 * things have it like the 2 part Sanderson. Make it optional."*
 *
 * So a work with a series and a `series_index_sort` is **COMPLETE**.
 * `series_index_display` — the designation physically printed on a particular
 * printing, *"Volume 07"*, *"Prequel"* — stays in the schema and is kept
 * wherever it exists, but it is **never demanded and never a gap**. The full
 * semantics, with dates, are in
 * [`docs/info/volume-numbers.md`](../../../docs/info/volume-numbers.md); that
 * document is the permanent answer, and this comment is its pointer.
 *
 * ⚠️ **Do not re-tighten this into a two-column test.** It was one from
 * 2026-08-13 to 2026-08-19 and the earlier reasoning reads persuasively — *"a
 * row that sorts correctly and prints nothing"* — so a future session will be
 * tempted. What that version actually did, measured on the friend instance on
 * the day it was reversed: **55 of 55 remaining queue rows were `seriesIndex`,
 * and nothing in the pipeline downstream of `routes/ingest.ts` had ever written
 * `display`.** Every one was a row research could be paid for for ever and
 * never close. The predicate was demanding a fact about a physical printing
 * from a catalog of EPUB files, which mostly do not have one.
 *
 * ⚠️ `gapSummary` in `@lc/db` uses this too — the tally and the queue must
 * agree on what "filled" means, or the summary claims work the rows still owe.
 */
export function seriesIndexIncomplete(sort: number | null | undefined): boolean {
  return sort == null;
}

/** True for null, undefined, and a string of nothing but spaces. */
export function isBlankDetail(value: string | number | null | undefined): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * ⚠️ **The ingest route's LEGACY DEFAULT for `series_index_display`. Not a
 * requirement, and not a form anything else should reach for.**
 *
 * `apps/worker/src/routes/ingest.ts` has written `Book ${sort}` on every work
 * it has ever created with a volume number, on both instances, since the route
 * existed — which is where the main catalog's 184 rows whose display is the
 * bare sort number came from. It is kept, verbatim and here rather than inline,
 * for exactly one reason: **changing it would change how newly imported books
 * read on the shelf**, and that is a surface nobody asked about.
 *
 * ⚠️ Under the owner's rule of 2026-08-19 (see `seriesIndexIncomplete`, and
 * `docs/info/volume-numbers.md`) the printed form is **optional data**, present
 * only where a printing physically carries a designation. So this derivation is
 * a legacy default and NOT the semantics: nothing new should call it, research
 * must not, and a row without a display is complete rather than unfinished.
 */
export function seriesIndexDisplayFrom(sort: number): string {
  // `.0` is not something `toString()` produces; it is carried from the ingest
  // route byte-for-byte so lifting the literal out changed nothing.
  return `Book ${Number(sort).toString().replace(/\.0$/, '')}`;
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
        // ⚠️ The SORT alone, by owner rule of 2026-08-19 — the printed form is
        // optional data, not a completeness requirement. See
        // `seriesIndexIncomplete`, which carries the reversal and the measured
        // reason it must not be re-tightened.
        return seriesIndexIncomplete(subject.seriesIndexSort);
      case 'description':
        return isBlankDetail(subject.description);
    }
  });
}

/**
 * The fields to ASK a lookup for. `detailGaps` plus the volume number whenever
 * the series is being asked for in the same breath.
 *
 * ## ⚠️ Why this exists at all, and why it is NOT `detailGaps`
 *
 * "Which volume is this?" is only a *question* once a book has a series —
 * `detailFieldsFor` is right about that, and widening the OWED list would put
 * "missing volume number" under every seriesless book on the queue and hand a
 * model a blank to invent a series for. So the owed list is unchanged.
 *
 * But the ASK list had the same restriction, and there it was a bug that cost
 * real money. Measured on `library-catalog-2nd`, 2026-08-21: **126 runs had
 * asked `series`, only 11 had ever asked `seriesIndex`, and 36 of 36 remaining
 * queue rows were the volume number** — every one of them a gap the catalog
 * had *created for itself* by filling the series and then having to buy a
 * second lookup for the number.
 *
 * ⚠️ **The number had already been bought.** Run #135 (work 100, *Summoned to
 * the Wilds*) was asked for `firstPublished, series, description`, and wrote
 * this into its own `result_json`:
 *
 * > *"Series set to Villains and Virtues. … **Villains and Virtues #2** by
 * > A. K. Caggiano…"*
 *
 * The same search that found the series found the volume, said so out loud,
 * and the number was dropped on the floor because `seriesIndex` was not on
 * that run's ask list. One search, one page fetch, two invoices.
 *
 * ⚠️ **This does NOT reopen the completeness rules of 2026-08-19.**
 * `seriesIndexIncomplete` still reads the sort alone, the printed form is
 * still optional data and still never a gap, and `multi_volume_printing` is
 * still human-only. See `docs/info/volume-numbers.md`, which is the permanent
 * answer; this function widens what gets *asked*, never what is *owed*.
 *
 * The apply side was already built for this: `applyFinding` refuses a
 * `seriesIndex` whose work has no series, and `autoApplyFindings` sorts by
 * `DETAIL_FIELDS` so `series` lands first. A run that learns both writes both;
 * a run that cannot settle the series drops the volume number exactly as it
 * always did.
 */
export function detailAsks(subject: GapSubject, missing: readonly DetailField[]): DetailField[] {
  if (!missing.includes('series')) return [...missing];
  if (missing.includes('seriesIndex')) return [...missing];
  // A recorded answer stays answered. Without this the companion ask would
  // re-buy the one question `gap_verdict` exists to stop being re-bought —
  // *Tusk Love*'s "there is no such number" (R10) is the standing example.
  if (new Set(subject.verdicts ?? []).has('seriesIndex')) return [...missing];
  if (!seriesIndexIncomplete(subject.seriesIndexSort)) return [...missing];
  // DETAIL_FIELDS order, so `series` is asked — and applied — ahead of the
  // number that depends on it.
  return DETAIL_FIELDS.filter((f) => missing.includes(f) || f === 'seriesIndex');
}

/**
 * The questions this book has never been put, of the ones it still owes.
 *
 * Empty means there is nothing new to buy: every open gap has already been
 * asked about by a finished run and the answer did not close it. Asking again
 * costs the same money and returns the same nothing.
 *
 * ⚠️ A field is *asked*, not *answered*. That is the whole distinction — a run
 * that came back `found`, `none` or `unknown` all count as asked, which is
 * precisely why they stop repeating.
 *
 * ## ⚠️ Why this lives in the leaf and not next to its first caller
 *
 * It was `apps/worker/src/lib/details-sweep.ts`'s private helper until
 * 2026-08-19, when the SECOND consumer turned up and the missing sharing was
 * the bug. The queue page's "Look up N" button had its own idea of
 * already-asked — `runs[workId] !== undefined`, keyed **by work** — so a
 * research pass that filled `series` on 57 books marked those books asked, and
 * the volume question, which only comes into existence once a book HAS a
 * series, was born behind that marker. 51 unanswered questions sat behind it;
 * the button read **"Every one already asked"** and was disabled one line under
 * the page's own sentence *"51 books are waiting for a lookup."* The owner
 * reported it twice as *"the button didnt fix"*.
 *
 * ⚠️ **Outstanding-ness is a fact about a (work, FIELD) pair, never about a
 * work.** Anything that reduces it to "has this book been touched" reproduces
 * the same bug, and the fix is not to drop the marker either — that reinstates
 * the paid re-ask loop it exists to prevent. Both directions are lies; this
 * function is the only shape that is neither.
 */
export function unaskedGaps(
  missing: readonly DetailField[],
  asked: readonly string[],
): DetailField[] {
  const already = new Set(asked);
  return missing.filter((field) => !already.has(field));
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
