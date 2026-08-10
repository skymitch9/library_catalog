import {
  normaliseTitle,
  primaryAuthor,
  type CreateWorkAlias,
  type WorkAliasKind,
  type WorkAliasSource,
} from '@lc/core';

/**
 * Other names a work answers to.
 *
 * The table has existed since migration 0001 and nothing wrote to it for the
 * whole of the project's first three phases, which is exactly how it came to be
 * described as an alternate-*title* store while the aliases this catalog actually
 * needed were pen names. Migration 0005 added `kind` and this file is the write
 * path; `packages/core/src/matching.ts` is the read path.
 *
 * ⚠️ **An alias is an addition to a work, never an edit of one.** Nothing here
 * touches `work.title` or `work.authors`, because those two columns derive
 * `work_key`, which is the join to the shared Firestore reviews — see the header
 * of `works.ts`. "Fixing" the author of the five *He Who Fights with Monsters*
 * works to their pen name would have moved five review keys and orphaned whatever
 * the audiobook catalog has filed under the old ones.
 */

export interface WorkAlias {
  id: number;
  workId: number;
  alias: string;
  kind: WorkAliasKind;
  source: WorkAliasSource;
  createdAt: string;
}

interface AliasRow {
  id: number;
  work_id: number;
  alias: string;
  kind: string;
  source: string;
  created_at: string;
}

const COLS = 'id, work_id, alias, kind, source, created_at';

function toAlias(row: AliasRow): WorkAlias {
  return {
    id: row.id,
    workId: row.work_id,
    alias: row.alias,
    kind: row.kind as WorkAliasKind,
    source: row.source as WorkAliasSource,
    createdAt: row.created_at,
  };
}

/**
 * Every alias in the catalog, in the shape `buildWorkIndex` takes.
 *
 * One query and not one per work: the matcher folds the whole catalog once and
 * then asks it repeatedly, and `matching.ts` says why — a shelf photo asked
 * against 800 works must not re-read a table 800 times.
 */
export async function listWorkAliases(
  db: D1Database,
): Promise<{ workId: number; alias: string; kind: WorkAliasKind }[]> {
  const { results } = await db
    .prepare('SELECT work_id AS workId, alias, kind FROM work_alias')
    .all<{ workId: number; alias: string; kind: string }>();
  return results.map((r) => ({ workId: r.workId, alias: r.alias, kind: r.kind as WorkAliasKind }));
}

/** One work's aliases, newest kind-grouped first so the page can render sections. */
export async function listAliasesForWork(db: D1Database, workId: number): Promise<WorkAlias[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM work_alias WHERE work_id = ?
        ORDER BY kind, alias COLLATE NOCASE`,
    )
    .bind(workId)
    .all<AliasRow>();
  return results.map(toAlias);
}

export class AliasError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

/**
 * Record another name for a book.
 *
 * ⚠️ Refuses an alias that folds to the work's own title or its own author. Not
 * out of tidiness: `buildWorkIndex`'s rule 1 silently discards a title alias that
 * collides with a real title, so such a row would sit on the page looking like it
 * had been recorded and do nothing forever. A write that cannot have an effect
 * should fail loudly at the moment somebody makes it, not go quiet.
 *
 * Idempotent on the UNIQUE (work_id, alias): adding the same name twice answers
 * 409 rather than duplicating, and the UI treats that as "already there".
 */
export async function addWorkAlias(
  db: D1Database,
  workId: number,
  input: CreateWorkAlias,
): Promise<WorkAlias> {
  const work = await db
    .prepare('SELECT title, authors FROM work WHERE id = ?')
    .bind(workId)
    .first<{ title: string; authors: string }>();
  if (!work) throw new AliasError('That book is not in the catalog', 404);

  const alias = input.alias.trim();

  // ⚠️ `normaliseTitle` and not a local fold. This refusal has to agree exactly
  // with the rule that would otherwise discard the row — `buildWorkIndex` folds
  // with `normaliseTitle`, so anything it would call a collision must be refused
  // here, and nothing else.
  if (input.kind === 'title' && normaliseTitle(alias) === normaliseTitle(work.title)) {
    throw new AliasError('That is already the title of this book', 400);
  }
  if (
    input.kind === 'author' &&
    normaliseTitle(primaryAuthor(alias)) === normaliseTitle(primaryAuthor(work.authors))
  ) {
    throw new AliasError('That is already the author of this book', 400);
  }

  const existing = await db
    .prepare(`SELECT ${COLS} FROM work_alias WHERE work_id = ? AND alias = ?`)
    .bind(workId, alias)
    .first<AliasRow>();
  if (existing) {
    throw new AliasError(
      existing.kind === input.kind
        ? 'This book already answers to that name'
        : `"${alias}" is already recorded on this book as ${existing.kind === 'title' ? 'a title' : 'an author'}`,
      409,
    );
  }

  const row = await db
    .prepare(
      `INSERT INTO work_alias (work_id, alias, kind, source)
       VALUES (?, ?, ?, ?)
       RETURNING ${COLS}`,
    )
    .bind(workId, alias, input.kind, input.source)
    .first<AliasRow>();
  if (!row) throw new AliasError('Could not record that name', 400);
  return toAlias(row);
}

/**
 * Remove one alias.
 *
 * Scoped to the work as well as the id, so a stale page cannot delete somebody
 * else's row by guessing a number.
 */
export async function deleteWorkAlias(
  db: D1Database,
  workId: number,
  aliasId: number,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM work_alias WHERE id = ? AND work_id = ?')
    .bind(aliasId, workId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
