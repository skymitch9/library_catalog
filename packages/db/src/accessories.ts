import type { AccessoryKind, CreateAccessory, UpdateAccessory } from '@lc/core';

/**
 * The things that came with a book and are not books.
 *
 * ⚠️ **Nothing in this file may be reached from the collection page.** The owner
 * asked for that in as many words — *"we don't need ti publish that count on the
 * main page, just keep it each book"* — so `listAccessoriesForWork` is called from
 * `/api/works/:id` and from nowhere else. `collectionStats` and
 * `listCollection` in `works.ts` do not import this module and must not start.
 *
 * ⚠️ **`copy_id` is checked against `work_id` here, in the write path**, because
 * SQLite cannot express it as a CHECK — a CHECK cannot contain a subquery.
 * Migration 0011 says so; this is the other half of that sentence. Without it a
 * stale page could file *Dungeon Crawler Carl*'s plushie against a copy of
 * *Onyx Storm*, and nothing would ever complain.
 */

export interface Accessory {
  id: number;
  workId: number;
  copyId: number | null;
  name: string;
  kind: AccessoryKind;
  isDigital: boolean;
  quantity: number;
  location: string | null;
  notes: string | null;
  pledgeId: number | null;
  /** Denormalised for display only — the campaign that delivered it, if one did. */
  campaignName: string | null;
  campaignPlatform: string | null;
  createdAt: string;
}

interface AccessoryRow {
  id: number;
  work_id: number;
  copy_id: number | null;
  name: string;
  kind: string;
  is_digital: number;
  quantity: number;
  location: string | null;
  notes: string | null;
  pledge_id: number | null;
  campaign_name: string | null;
  campaign_platform: string | null;
  created_at: string;
}

/**
 * The select, with the campaign joined in.
 *
 * Two LEFT JOINs and not a second round trip: the panel always wants to say
 * "from the Dungeon Crawler Carl Kickstarter" beside the pin, and a per-row fetch
 * for that is the N+1 that `matching.ts` warns about in the large.
 */
const SELECT = `
  SELECT a.id, a.work_id, a.copy_id, a.name, a.kind, a.is_digital, a.quantity,
         a.location, a.notes, a.pledge_id, a.created_at,
         c.name     AS campaign_name,
         c.platform AS campaign_platform
    FROM book_accessory a
    LEFT JOIN crowdfunding_pledge p ON p.id = a.pledge_id
    LEFT JOIN crowdfunding_campaign c ON c.id = p.campaign_id`;

function toAccessory(row: AccessoryRow): Accessory {
  return {
    id: row.id,
    workId: row.work_id,
    copyId: row.copy_id,
    name: row.name,
    kind: row.kind as AccessoryKind,
    isDigital: row.is_digital === 1,
    quantity: row.quantity,
    location: row.location,
    notes: row.notes,
    pledgeId: row.pledge_id,
    campaignName: row.campaign_name,
    campaignPlatform: row.campaign_platform,
    createdAt: row.created_at,
  };
}

/**
 * Everything that came with one book.
 *
 * Ordered physical first, then by kind, then by name: a shelf of objects reads
 * before a list of files, and the objects are what somebody is looking for when
 * they open this panel.
 */
export async function listAccessoriesForWork(
  db: D1Database,
  workId: number,
): Promise<Accessory[]> {
  const { results } = await db
    .prepare(`${SELECT} WHERE a.work_id = ? ORDER BY a.is_digital, a.kind, a.name COLLATE NOCASE`)
    .bind(workId)
    .all<AccessoryRow>();
  return results.map(toAccessory);
}

export class AccessoryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

/**
 * ⚠️ The check migration 0011 could not make the database do.
 *
 * A `copy_id` naming a copy of a different work is a false statement, not an
 * untidy one — the same class of error as a `contains` relation stored the wrong
 * way round (migration 0004). Refuse it rather than store it.
 */
async function assertCopyBelongs(
  db: D1Database,
  workId: number,
  copyId: number | null | undefined,
): Promise<void> {
  if (copyId == null) return;
  const row = await db
    .prepare('SELECT work_id FROM copy WHERE id = ?')
    .bind(copyId)
    .first<{ work_id: number }>();
  if (!row) throw new AccessoryError('That copy is not in the catalog', 404);
  if (row.work_id !== workId) {
    throw new AccessoryError('That copy belongs to a different book', 400);
  }
}

async function assertPledgeExists(
  db: D1Database,
  pledgeId: number | null | undefined,
): Promise<void> {
  if (pledgeId == null) return;
  const row = await db
    .prepare('SELECT id FROM crowdfunding_pledge WHERE id = ?')
    .bind(pledgeId)
    .first<{ id: number }>();
  if (!row) throw new AccessoryError('That pledge is not recorded', 404);
}

export async function addAccessory(
  db: D1Database,
  workId: number,
  input: CreateAccessory,
): Promise<Accessory> {
  const work = await db
    .prepare('SELECT id FROM work WHERE id = ?')
    .bind(workId)
    .first<{ id: number }>();
  if (!work) throw new AccessoryError('That book is not in the catalog', 404);

  await assertCopyBelongs(db, workId, input.copyId);
  await assertPledgeExists(db, input.pledgeId);

  const row = await db
    .prepare(
      `INSERT INTO book_accessory
         (work_id, copy_id, name, kind, is_digital, quantity, location, notes, pledge_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       RETURNING id`,
    )
    .bind(
      workId,
      input.copyId ?? null,
      input.name.trim(),
      input.kind,
      input.isDigital ? 1 : 0,
      input.quantity,
      input.location ?? null,
      input.notes ?? null,
      input.pledgeId ?? null,
    )
    .first<{ id: number }>();
  if (!row) throw new AccessoryError('Could not record that', 400);

  const created = await getAccessory(db, row.id);
  if (!created) throw new AccessoryError('Could not record that', 400);
  return created;
}

export async function getAccessory(db: D1Database, id: number): Promise<Accessory | null> {
  const row = await db.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first<AccessoryRow>();
  return row ? toAccessory(row) : null;
}

/**
 * Change one.
 *
 * ⚠️ Only the keys that arrived are written. A PATCH sending `{ location: 'loft
 * box 2' }` must not blank the note saying which tier it came from — the rule
 * `updateCopy` follows, and the reason `updateAccessorySchema` is `.partial()`.
 *
 * `undefined` means "not sent"; `null` means "clear it". Distinguishing those two
 * is the whole of what makes a partial update safe, and `Object.hasOwn` is how it
 * is done rather than a truthiness test — `quantity: 0` and `notes: ''` are both
 * meaningful values that a truthiness test would silently drop.
 */
export async function updateAccessory(
  db: D1Database,
  id: number,
  input: UpdateAccessory,
): Promise<Accessory | null> {
  const current = await getAccessory(db, id);
  if (!current) return null;

  if (Object.hasOwn(input, 'copyId')) {
    await assertCopyBelongs(db, current.workId, input.copyId);
  }
  if (Object.hasOwn(input, 'pledgeId')) {
    await assertPledgeExists(db, input.pledgeId);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  const put = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  if (Object.hasOwn(input, 'name') && input.name != null) put('name', input.name.trim());
  if (Object.hasOwn(input, 'kind')) put('kind', input.kind);
  if (Object.hasOwn(input, 'isDigital')) put('is_digital', input.isDigital ? 1 : 0);
  if (Object.hasOwn(input, 'quantity')) put('quantity', input.quantity);
  if (Object.hasOwn(input, 'copyId')) put('copy_id', input.copyId ?? null);
  if (Object.hasOwn(input, 'pledgeId')) put('pledge_id', input.pledgeId ?? null);
  if (Object.hasOwn(input, 'location')) put('location', input.location ?? null);
  if (Object.hasOwn(input, 'notes')) put('notes', input.notes ?? null);

  if (sets.length === 0) return current;

  sets.push("updated_at = datetime('now')");
  binds.push(id);
  await db
    .prepare(`UPDATE book_accessory SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return getAccessory(db, id);
}

/**
 * Delete one accessory, scoped to BOTH the work and the accessory id.
 *
 * ⚠️ The `work_id` is part of the WHERE clause, not just the `id`: the route's
 * `:id` work segment must actually constrain the delete, otherwise a request
 * naming the wrong work destroys another book's accessory row and still answers
 * 200. Scoping it in SQL makes the guard atomic (no read-then-delete race) and
 * mirrors how `listAccessoriesForWork` and the PATCH guard key on `work_id`.
 */
export async function deleteAccessory(
  db: D1Database,
  workId: number,
  id: number,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM book_accessory WHERE id = ? AND work_id = ?')
    .bind(id, workId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
