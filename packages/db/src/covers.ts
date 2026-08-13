import { assembleCoverCandidates, type CoverCandidate, type CoverStatus } from '@lc/core';
import { getWork } from './works.js';
import { listEditionsForWork } from './editions.js';

/**
 * The queries behind the cover picker. The decisions — dedupe, precedence,
 * what counts as a guess — live in `assembleCoverCandidates` (`@lc/core`),
 * where a test can reach them; this file only fetches the three inputs.
 */

export interface CoverCandidates {
  workId: number;
  title: string;
  currentUrl: string | null;
  coverStatus: CoverStatus | null;
  candidates: CoverCandidate[];
}

/**
 * Every cover this work could wear: the one it wears, its editions' own, the
 * ones it wore before (from `change_log`), and computed Open Library guesses.
 *
 * ⚠️ The history read is what makes "swap back" a real offer. `DELETE
 * /works/:id/cover` deliberately does not delete the R2 object, and uploaded
 * objects are named for their own bytes — so every URL the column ever held
 * is still serving, and re-pointing the column is the whole cost of a swap.
 * Old values only: each row's `old_json` is a URL the work stopped wearing at
 * `created_at`, and the newest row's NEW value is the current cover, which
 * arrives via the work row instead.
 */
export async function listCoverCandidates(
  db: D1Database,
  workId: number,
): Promise<CoverCandidates | null> {
  const work = await getWork(db, workId);
  if (!work) return null;

  const [editions, historyRows] = await Promise.all([
    listEditionsForWork(db, workId),
    db
      .prepare(
        `SELECT old_json, created_at FROM change_log
          WHERE entity = 'work' AND entity_id = ? AND field = 'coverUrl'
          ORDER BY id DESC
          LIMIT 50`,
      )
      .bind(workId)
      .all<{ old_json: string; created_at: string }>(),
  ]);

  const history: { url: string; at: string }[] = [];
  for (const row of historyRows.results) {
    // `old_json` is JSON — a string for a URL, `null` for "had no cover".
    // A row that fails to parse is skipped: this is a convenience read, and
    // the Changes panel already renders the raw value for a person to see.
    try {
      const value: unknown = JSON.parse(row.old_json);
      if (typeof value === 'string' && value.trim() !== '') {
        history.push({ url: value, at: row.created_at });
      }
    } catch {
      // skip
    }
  }

  return {
    workId: work.id,
    title: work.title,
    currentUrl: work.coverUrl,
    coverStatus: work.coverStatus,
    candidates: assembleCoverCandidates({
      currentUrl: work.coverUrl,
      openlibraryWorkId: work.openlibraryWorkId,
      editions: editions.map((e) => ({
        id: e.id,
        coverUrl: e.cover_url,
        isbn13: e.isbn13,
        format: e.format,
        editionName: e.edition_name,
        publisher: e.publisher,
        publishedYear: e.published_year,
        source: e.source,
      })),
      history,
    }),
  };
}
