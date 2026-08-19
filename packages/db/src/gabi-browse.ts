/**
 * **What GABI may see of this shelf** — the read side of the delegated door
 * (`apps/worker/src/routes/gabi-delegated.ts`, verb `browse-works`).
 *
 * Built 2026-08-19 for the Discord bot's PHYSICAL suggestion lane
 * (`catalog-platform/apps/discord-worker/src/suggest.ts`). Until now that lane
 * could only see print rows the AUDIOBOOK catalog had cross-linked — **84 of
 * 1,079 rows, 64 of them physical** — and said so out loud, because the join
 * table is a join table and the shared index only widens for a caller holding a
 * Firebase ID token, which a Discord Worker structurally cannot mint. This is
 * the third road: a narrow read on the door that already exists.
 *
 * ## ⚠️ DEFAULT-DENY, BY EXPLICIT ALLOW-LIST — never `SELECT *` minus exclusions
 *
 * `index-projection.ts` is the model and the reasoning is identical: the columns
 * in `BrowseWorkRow` are the complete list of what leaves this catalog by this
 * road, and every one of them is display data a suggestion needs to be worth
 * making. **NEVER exported here:** copy counts, copy status, condition,
 * `is_signed`, prices, vendors, acquisition dates, locations, `lent_to`,
 * read-state, per-person ratings, notes, ISBNs, ASINs, descriptions.
 *
 * ⚠️ The exclusion form leaks when a column is added, which is why this is an
 * interface of seven fields and a hand-written select list rather than a
 * `WorkRow` with things deleted. `toWork()` is deliberately NOT reused for the
 * same reason — it returns the whole row.
 *
 * ## ⚠️ WHAT "HELD" MEANS HERE, and why it is a COPY-level question
 *
 * A physical suggestion is an **errand**: it points somebody at an object in a
 * house. So the predicate asks whether a held copy is a thing with mass, not
 * whether a printing was ever recorded:
 *
 *   a held copy (`HELD_STATUSES` — `owned` or `lent`; a lent book is still
 *   ours) that is EITHER linked to a physical printing OR linked to no printing
 *   at all.
 *
 * ⚠️ **The unlinked branch is not laxity — it is 177 of 390 copies, measured
 * live 2026-08-19.** `copy.work_id` is denormalised precisely so "a copy can
 * exist before its exact printing is known", which is the ordinary case when a
 * spine photo made the row (migration 0001's own comment). Requiring a physical
 * `edition` row would silently hide 6 works the household demonstrably has on a
 * shelf — the same trap `EBOOK_ONLY_CLAUSE` was written to avoid one table over.
 *
 * ⚠️ **`EBOOK_ONLY_CLAUSE.hide` cannot be reused here and must not be.** Its
 * third conjunct is `NOT EXISTS (copy)`, so once a held copy is required it is
 * always false and the whole clause degenerates to `TRUE` — a filter that reads
 * as protection and applies none. Checked before writing this, not after.
 *
 * ## What was measured, live, 2026-08-19 (`wrangler d1 execute --remote`)
 *
 * | fact | value |
 * |---|---|
 * | works | 448 |
 * | copies | 390 |
 * | copies with no `edition_id` | **177** (every one of them held) |
 * | held copies linked to an EBOOK printing | **0** |
 * | works this clause returns | **341** |
 * | of those, with no physical `edition` row → `formats: []` | **6** |
 *
 * ⚠️ **`formats: []` means "held, printing not typed in yet" — NEVER "not
 * physical".** A consumer that reads an empty list as "no print copy" inverts
 * the meaning of the six rows this clause exists to keep.
 */

import { HELD_STATUSES, PHYSICAL_FORMATS, UNKNOWN_AUTHOR } from '@lc/core';

/** `?, ?, ?` — one placeholder per value, so no list is ever inlined into SQL. */
const PHYSICAL_PLACEHOLDERS = PHYSICAL_FORMATS.map(() => '?').join(', ');
const HELD_PLACEHOLDERS = HELD_STATUSES.map(() => '?').join(', ');

/**
 * "The house holds this, and what it holds is a thing with mass."
 *
 * ⚠️ **Exported only so `packages/db/test/gabi-browse-clause.test.ts` can run
 * this exact SQL text against a real SQLite** — the same reason and the same
 * shape as `EBOOK_ONLY_CLAUSE`. A predicate that decides which of the owner's
 * books a bot may point a person at is one to exercise, not to reason about,
 * and the copy-without-an-edition row is precisely the case a reader nods past.
 *
 * Binds, in order: `HELD_STATUSES`, then `PHYSICAL_FORMATS`.
 */
export const BROWSE_HELD_PHYSICAL_CLAUSE =
  `EXISTS (SELECT 1 FROM copy c
             LEFT JOIN edition e ON e.id = c.edition_id
            WHERE c.work_id = w.id
              AND c.status IN (${HELD_PLACEHOLDERS})
              AND (c.edition_id IS NULL OR e.format IN (${PHYSICAL_PLACEHOLDERS})))`;

/**
 * The complete set of fields that leave this catalog by the `browse-works`
 * road. Adding one is a decision somebody makes on purpose — `gabi-browse.test`
 * pins the key list so a field cannot arrive as a side effect of a feature.
 */
export interface BrowseWorkRow {
  id: number;
  title: string;
  /**
   * As printed, or **`null`** for a book whose author is not yet recorded — the
   * `UNKNOWN_AUTHOR` sentinel becomes an honest null here exactly as `toWork`
   * does it, so a consumer cannot render `?unknown` as somebody's name.
   */
  authors: string | null;
  series: string | null;
  /** The human spelling — `"1"`, `"2.5"`, `"Book Three"`. Null off-series. */
  seriesIndex: string | null;
  /** `work.first_published`. Null when nobody has recorded one. */
  year: number | null;
  /**
   * The RAW physical `edition.format` values on this work (`hardcover`,
   * `paperback`, `mass_market`), de-duplicated. ⚠️ Raw, not labelled: the wire
   * spelling is the route's business (`apps/worker/src/lib/format-labels.ts`),
   * so there is exactly one place in this repo that decides what a person reads.
   *
   * ⚠️ **Empty means "held, printing not recorded", never "not physical"** —
   * see the module header. 6 of the 341 rows are in that state today.
   */
  formats: string[];
}

export interface BrowseWorksPage {
  /** Every work the clause matches, ignoring `limit`/`offset` — so a caller can
   *  see it was truncated rather than quietly suggesting from the first page
   *  forever. */
  total: number;
  rows: BrowseWorkRow[];
}

interface BrowseSourceRow {
  id: number;
  title: string;
  authors: string;
  series: string | null;
  series_index_display: string | null;
  series_index_sort: number | null;
  first_published: number | null;
  /** `group_concat(DISTINCT e.format)` over PHYSICAL editions only. */
  formats: string | null;
}

/**
 * One page of the physical shelf, plus the honest total.
 *
 * ⚠️ **Ordered by `w.id`, and the caller is told the total for that reason.**
 * A fixed order under a cap means the tail of the shelf is never suggested; the
 * fix is the caller paging or raising the limit, not a random order this side
 * cannot test. `total` is what makes the truncation visible instead of silent.
 *
 * The limit is clamped by the ROUTE (`browse-works`), which owns the hard cap —
 * this function trusts what it is given, like every other paged reader here.
 */
export async function browseHeldPhysicalWorks(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<BrowseWorksPage> {
  const clauseBinds = [...HELD_STATUSES, ...PHYSICAL_FORMATS];

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM work w WHERE ${BROWSE_HELD_PHYSICAL_CLAUSE}`)
    .bind(...clauseBinds)
    .first<{ n: number }>();

  const { results } = await db
    .prepare(
      `SELECT w.id, w.title, w.authors, w.series, w.series_index_display,
              w.series_index_sort, w.first_published,
              (SELECT group_concat(DISTINCT e.format)
                 FROM edition e
                WHERE e.work_id = w.id AND e.format IN (${PHYSICAL_PLACEHOLDERS})) AS formats
         FROM work w
        WHERE ${BROWSE_HELD_PHYSICAL_CLAUSE}
        ORDER BY w.id
        LIMIT ? OFFSET ?`,
    )
    // ⚠️ The subquery's placeholders appear FIRST in the SQL text, so they bind
    // first. D1 binds positionally by order of appearance (the note on
    // `listCollection`'s `readerId` is the same trap, one file over).
    .bind(...PHYSICAL_FORMATS, ...clauseBinds, limit, offset)
    .all<BrowseSourceRow>();

  return {
    total: totalRow?.n ?? 0,
    rows: results.map((r) => ({
      id: r.id,
      title: r.title,
      authors: r.authors === UNKNOWN_AUTHOR ? null : r.authors,
      series: r.series,
      // The display spelling when there is one, else the sort number said
      // plainly — never the raw float, which renders "2.5" as "2.5" and "3" as
      // "3" only by luck of JavaScript's number formatting.
      seriesIndex:
        r.series_index_display ??
        (r.series_index_sort === null ? null : String(r.series_index_sort)),
      year: r.first_published,
      formats: (r.formats ?? '').split(',').map((f) => f.trim()).filter(Boolean),
    })),
  };
}
