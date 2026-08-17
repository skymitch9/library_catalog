import { bookIdFromTitle, type TbrEntryRef, type TbrMatched } from '@lc/core';

/**
 * Matching a person's cross-catalog TBR against these shelves.
 *
 * ## ⚠️ Nothing here writes, and nothing here stores a TBR
 *
 * The list itself lives in Firestore, in the `readingLists` collection the
 * audiobook site has always written (`packages/core/src/tbr.ts` carries the
 * whole argument). This module answers the one question D1 can: *which of these
 * entries is a book we hold, and has this person finished it?* — because the
 * answer to the second half is what retires the entry.
 *
 * There is deliberately **no `tbr` table and no migration**. A row here would
 * be a second store of a per-person fact that already has one, and it could not
 * span catalogs anyway: this database knows nothing about the audiobook shelf.
 * Same conclusion as `docs/info/identity-and-reviews.md` §3 reached for
 * reviews, for the same reason.
 */

/** ⚠️ Bound parameters per statement — D1 caps them at 100; `user_id` takes one. */
const KEYS_PER_QUERY = 90;

interface Row {
  work_id: number;
  work_key: string;
  title: string;
  authors: string | null;
  series: string | null;
  series_index_display: string | null;
  cover_url: string | null;
  read_state: string | null;
}

const SELECT = `SELECT w.id AS work_id, w.work_key AS work_key, w.title AS title,
                       w.authors AS authors, w.series AS series,
                       w.series_index_display AS series_index_display,
                       w.cover_url AS cover_url, ub.read_state AS read_state
                  FROM work w
                  LEFT JOIN user_book ub ON ub.work_id = w.id AND ub.user_id = ?`;

/** What the browser gets back for one entry: its keys, plus what we hold. */
export interface TbrMatch extends TbrEntryRef, TbrMatched {
  /** The catalog's title, which may be spelled differently from the entry's. */
  workTitle: string | null;
  authors: string | null;
  series: string | null;
  seriesIndexDisplay: string | null;
  /** This catalog's cover, preferred over the entry's when we have one. */
  workCoverUrl: string | null;
}

/**
 * Match every entry to a work, and say whether this person has read it.
 *
 * ## Two keys, and the second one is the weak fallback — again
 *
 * `workKey` is the real join and matches anything this catalog wrote. An entry
 * written on the audiobook site carries only `bookId`, a slug of the title as
 * *that* catalog spells it, so the fallback is `bookIdFromTitle(work.title)`
 * over the catalog — exactly the pairing `fetchReviews` uses, and exactly as
 * weak: `Firefight - The Reckoners, Book 2` and the paperback `Firefight` do
 * not meet, and never will without a key with an author in it.
 *
 * ⚠️ **An unmatched entry is the ORDINARY case, not a failure.** The household
 * owns ~1,075 audiobooks against a few hundred works here, so most of anyone's
 * TBR is of books this catalog does not hold. The page says so in words rather
 * than hiding them: they are still on the person's list, just not on these
 * shelves.
 *
 * ## Why the fallback scan is conditional
 *
 * The `workKey` pass is an indexed `IN (…)`. The `bookId` pass has no index it
 * could ever use — the slug is computed, not stored — so it reads the work
 * table. It therefore runs **only when some entry is still unmatched**, which
 * on a list written entirely from this catalog is never. If that ever becomes
 * the hot path, the fix is a stored slug column and a migration, not a bigger
 * query here.
 */
export async function resolveTbrEntries(
  db: D1Database,
  userId: number,
  entries: readonly TbrEntryRef[],
): Promise<TbrMatch[]> {
  if (entries.length === 0) return [];

  const keys = [...new Set(entries.map((e) => e.workKey).filter((k): k is string => !!k))];

  const byWorkKey = new Map<string, Row>();
  for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
    const chunk = keys.slice(i, i + KEYS_PER_QUERY);
    const { results } = await db
      .prepare(`${SELECT} WHERE w.work_key IN (${chunk.map(() => '?').join(', ')}) ORDER BY w.id`)
      .bind(userId, ...chunk)
      .all<Row>();
    // ⚠️ First work wins where two rows share a key. `work_key` is indexed and
    // NOT unique on purpose (migration 0001), and two works sharing one are the
    // same book by the only definition this catalog has — see
    // `applyObservedRatings`. Which of the two the entry links to is arbitrary
    // and harmless; the read state that clears it is read per row below.
    for (const row of results ?? []) if (!byWorkKey.has(row.work_key)) byWorkKey.set(row.work_key, row);
  }

  const unmatched = entries.filter((e) => !e.workKey || !byWorkKey.has(e.workKey));
  const byBookId = new Map<string, Row>();
  if (unmatched.length > 0) {
    const { results } = await db.prepare(`${SELECT} ORDER BY w.id`).bind(userId).all<Row>();
    for (const row of results ?? []) {
      const slug = bookIdFromTitle(row.title);
      if (slug && !byBookId.has(slug)) byBookId.set(slug, row);
    }
  }

  return entries.map((entry) => {
    const row = (entry.workKey ? byWorkKey.get(entry.workKey) : undefined) ?? byBookId.get(entry.bookId);
    return {
      docId: entry.docId,
      bookId: entry.bookId,
      workKey: entry.workKey,
      workId: row?.work_id ?? null,
      // ⚠️ `null` means "no row", which is not the same as 'unread' and must
      // stay distinguishable: `spentTbrEntries` only ever clears an explicit
      // 'read', and a missing row is the ordinary state of a book nobody has
      // said anything about.
      readState: row?.read_state ?? null,
      workTitle: row?.title ?? null,
      authors: row?.authors ?? null,
      series: row?.series ?? null,
      seriesIndexDisplay: row?.series_index_display ?? null,
      workCoverUrl: row?.cover_url ?? null,
    };
  });
}
