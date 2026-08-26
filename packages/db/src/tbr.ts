import {
  bookIdFromTitle,
  HELD_STATUSES,
  WISHLIST_STATUSES,
  type TbrEntryRef,
  type TbrGroupFormats,
  type TbrMatched,
} from '@lc/core';

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
  /**
   * ⚠️ **The matched WORK's own `work_key`** — not the document's, and the
   * difference is the whole media fold (2026-08-26).
   *
   * A document written on the audiobook site carries no `workKey` at all, so
   * two documents for one book share nothing. Once the entry is resolved to a
   * work — by either the key pass, the title-slug pass, or the bridge pass —
   * *this* is the key both of them can be folded on. `tbrFoldKey` reads it
   * first for exactly that reason.
   */
  workWorkKey: string | null;
  /** Which shelves this book can be reached on. Null when nothing matched. */
  formats: TbrGroupFormats | null;
  /**
   * ⚠️ **How the work was found**, shown nowhere and recorded here because a
   * bridge match is a WEAKER claim than a key match — the same reason
   * `audiobook_holding.matched_via` is stored rather than thrown away. A future
   * session debugging "why did these two fold" needs to know which rung fired.
   */
  matchedVia: 'work_key' | 'title_slug' | 'audio_bridge' | 'ebook_bridge' | null;
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
 *
 * ## ⚠️ THE THIRD RUNG — the bridges, added 2026-08-26 for the media fold
 *
 * Owner: *"for the tbr list, it's double counting if something is owned in
 * multiple media sources."* A document written on the audiobook site is keyed
 * by a slug of the AUDIOBOOK's title — *Firefight - The Reckoners, Book 2* —
 * and the two rungs above both fail on it: it carries no `workKey`, and no work
 * in this catalog is called that. So it resolves to nothing, lands under *"Not
 * on these shelves"*, and counts a second time beside the paperback.
 *
 * The bridge is already in this database and needed no new matcher: the
 * audiobook pipeline records the sibling catalog's own spelling per work in
 * `audiobook_holding` / `audiobook_edition_holding` (migrations 0010, 0390) and
 * the ebook one does the same in `ebook_holding` (0310). Slugging THOSE titles
 * with the same `bookIdFromTitle` gives a direct `bookId → work_id` map for
 * exactly the entries the first two rungs missed.
 *
 * ⚠️ **It is a third rung, never a replacement.** Anything that matched before
 * matches identically now — the bridge is consulted only for what was left
 * over, so this cannot change an existing match, only fill in an absent one.
 * `matchedVia` records which rung fired, because a bridge match is a weaker
 * claim (a title match made by another system, at another time) than a key one.
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

  // Rung 3. Same conditional-scan rule as rung 2, one step further down: it runs
  // only for entries that neither key nor this catalog's own title could place.
  const stillMissing = unmatched.filter((e) => !byBookId.has(e.bookId));
  const byBridge = new Map<string, BridgeRow>();
  if (stillMissing.length > 0) {
    const { results } = await db.prepare(BRIDGE_SELECT).bind(userId).all<BridgeRow>();
    for (const row of results ?? []) {
      const slug = bookIdFromTitle(row.bridge_title ?? '');
      // ⚠️ First wins, and the UNION's own order decides: `audiobook_holding`
      // (the per-work view, already ranked) before the per-edition rows before
      // the ebook shelf. A slug that two works answer to is a title collision
      // the catalog cannot resolve, and picking one arbitrarily is what every
      // other rung here already does.
      if (slug && !byBridge.has(slug)) byBridge.set(slug, row);
    }
  }

  const matched = entries.map((entry) => {
    const viaKey = entry.workKey ? byWorkKey.get(entry.workKey) : undefined;
    const viaSlug = viaKey ? undefined : byBookId.get(entry.bookId);
    const viaBridge = viaKey || viaSlug ? undefined : byBridge.get(entry.bookId);
    const row = viaKey ?? viaSlug ?? viaBridge;
    const matchedVia: TbrMatch['matchedVia'] = viaKey
      ? 'work_key'
      : viaSlug
        ? 'title_slug'
        : viaBridge
          ? viaBridge.bridge_source === 'ebook'
            ? 'ebook_bridge'
            : 'audio_bridge'
          : null;
    return { entry, row, matchedVia };
  });

  const formatsByWork = await formatsForWorks(
    db,
    [...new Set(matched.map((m) => m.row?.work_id).filter((id): id is number => typeof id === 'number'))],
  );

  return matched.map(({ entry, row, matchedVia }) => ({
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
    workWorkKey: row?.work_key ?? null,
    matchedVia,
    formats: row ? (formatsByWork.get(row.work_id) ?? emptyFormats(row.work_id)) : null,
  }));
}

interface BridgeRow extends Row {
  bridge_title: string | null;
  bridge_source: 'audio' | 'ebook';
}

/**
 * Every title the SIBLING catalogs know a work by, with the work beside it.
 *
 * ⚠️ **Three sources, and the third is not redundant.** `audiobook_holding` is
 * a VIEW that keeps one best row per work (migration 0390), so a work with two
 * recordings exposes only one title through it — and the entry on somebody's
 * TBR may well be the other one. `audiobook_edition_holding` is asked for both
 * its cleaned `title` and its verbatim `raw_title`, because the audiobook site
 * writes its TBR documents from the title it DISPLAYS, and which of the two
 * that is has changed over the life of that catalog.
 *
 * ⚠️ **Stale rows are excluded.** A holding the sibling catalog has withdrawn
 * must not fold two live entries together — the same rule
 * `audioEditionCountSql` applies for the same reason, and the same reason its
 * test exists.
 */
const BRIDGE_SELECT = `SELECT w.id AS work_id, w.work_key AS work_key, w.title AS title,
                              w.authors AS authors, w.series AS series,
                              w.series_index_display AS series_index_display,
                              w.cover_url AS cover_url, ub.read_state AS read_state,
                              b.bridge_title AS bridge_title, b.bridge_source AS bridge_source
                         FROM work w
                         LEFT JOIN user_book ub ON ub.work_id = w.id AND ub.user_id = ?
                         JOIN (
                           SELECT work_id, title     AS bridge_title, 'audio' AS bridge_source, 1 AS rung
                             FROM audiobook_holding          WHERE stale_at IS NULL
                           UNION ALL
                           SELECT work_id, title,                'audio',                      2
                             FROM audiobook_edition_holding  WHERE stale_at IS NULL
                           UNION ALL
                           SELECT work_id, raw_title,            'audio',                      3
                             FROM audiobook_edition_holding  WHERE stale_at IS NULL AND raw_title IS NOT NULL
                           UNION ALL
                           SELECT work_id, title,                'ebook',                      4
                             FROM ebook_holding
                         ) b ON b.work_id = w.id
                        ORDER BY b.rung, w.id`;

function emptyFormats(workId: number): TbrGroupFormats {
  return { physical: { workId, state: 'none' }, audio: null, ebook: null };
}

/**
 * Which shelves each of these works can actually be reached on.
 *
 * ⚠️ **`physical.state` is the HOUSEHOLD's, not the person's** — it reads
 * `copy`, the same table the shelf does, through `HELD_STATUSES` and
 * `WISHLIST_STATUSES` rather than a second spelling of them. `'none'` is a real
 * answer and not a gap: the catalog holds the work (it has a row) without
 * holding a copy of it, which is what a book added to a TBR from a book page
 * nobody owns looks like.
 *
 * ⚠️ `sold`, `lent` and `borrowed` are handled by those two constants and NOT
 * re-decided here. `lent` is owned (the book is ours, elsewhere); `sold` and
 * `borrowed` are neither owned nor wanted, and a work whose only copy is one of
 * those reads `'none'` — honest, and the same line `HELD_STATUSES` draws
 * everywhere else.
 */
async function formatsForWorks(
  db: D1Database,
  workIds: readonly number[],
): Promise<Map<number, TbrGroupFormats>> {
  const out = new Map<number, TbrGroupFormats>();
  if (workIds.length === 0) return out;
  for (const id of workIds) out.set(id, emptyFormats(id));

  for (let i = 0; i < workIds.length; i += KEYS_PER_QUERY) {
    const chunk = workIds.slice(i, i + KEYS_PER_QUERY);
    const marks = chunk.map(() => '?').join(', ');

    const [copies, audio, ebooks] = await Promise.all([
      db
        .prepare(`SELECT work_id, status FROM copy WHERE work_id IN (${marks})`)
        .bind(...chunk)
        .all<{ work_id: number; status: string }>(),
      db
        .prepare(
          `SELECT work_id, title FROM audiobook_holding WHERE stale_at IS NULL AND work_id IN (${marks})`,
        )
        .bind(...chunk)
        .all<{ work_id: number; title: string }>(),
      db
        .prepare(`SELECT work_id, title FROM ebook_holding WHERE work_id IN (${marks})`)
        .bind(...chunk)
        .all<{ work_id: number; title: string }>(),
    ]);

    for (const row of copies.results ?? []) {
      const f = out.get(row.work_id);
      if (!f?.physical) continue;
      if ((HELD_STATUSES as readonly string[]).includes(row.status)) f.physical.state = 'owned';
      else if (
        f.physical.state !== 'owned' &&
        (WISHLIST_STATUSES as readonly string[]).includes(row.status)
      ) {
        f.physical.state = 'wanted';
      }
    }
    for (const row of audio.results ?? []) {
      const f = out.get(row.work_id);
      if (f && !f.audio) f.audio = { title: row.title };
    }
    for (const row of ebooks.results ?? []) {
      const f = out.get(row.work_id);
      if (f && !f.ebook) f.ebook = { title: row.title };
    }
  }

  return out;
}
