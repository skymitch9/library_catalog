import {
  PHOTO_NOT_STORED,
  type ScanJob,
  type ScanLine,
  type ScanMode,
  type ScanStatus,
} from '@lc/core';

/**
 * Scan jobs — the intake queue that survives a locked phone.
 *
 * ## ⚠️ `photo_key` is never a key
 *
 * It is `NOT NULL` in the schema and it always holds `PHOTO_NOT_STORED`. The
 * photograph exists only in the request body and in the vision call it feeds;
 * there is no R2 bucket in this app and there must not be one. See the note on
 * `PHOTO_NOT_STORED` in `@lc/core`, and the deliberate absence of an R2 binding
 * in `apps/worker/wrangler.toml`.
 *
 * ## Why the lines are a JSON blob
 *
 * `scan_job.enriched` holds the whole `ScanLine[]`. Lines are only ever read as
 * part of their job and never queried across jobs, so a table would buy indexes
 * nothing uses and charge a migration for every field the review screen learns.
 * The cost is a read-modify-write per line, which is one round trip on a table
 * with one row per sweep.
 *
 * `raw_titles` holds what vision returned **before** anything was matched, and
 * is kept rather than overwritten: it is the only record of what the model
 * actually read, and the thing to look at when a match is wrong.
 */

interface ScanJobRow {
  id: number;
  status: string;
  mode: string;
  raw_titles: string | null;
  enriched: string | null;
  error: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string | null;
  processed_at: string | null;
  reviewed_at: string | null;
}

const JOB_COLS = `id, status, mode, raw_titles, enriched, error, created_by,
                  created_at, updated_at, processed_at, reviewed_at`;

/**
 * Parse the blob defensively.
 *
 * A job whose `enriched` is corrupt should read as a job with no lines, not as
 * a 500 on the queue page that hides every other job behind it.
 */
function linesOf(raw: string | null): ScanLine[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScanLine[]) : [];
  } catch {
    return [];
  }
}

function toJob(row: ScanJobRow): ScanJob {
  return {
    id: row.id,
    status: row.status as ScanStatus,
    mode: row.mode as ScanMode,
    lines: linesOf(row.enriched),
    error: row.error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    reviewedAt: row.reviewed_at,
  };
}

export async function createScanJob(
  db: D1Database,
  input: { mode: ScanMode; createdBy: number | null; status?: ScanStatus },
): Promise<ScanJob> {
  const row = await db
    .prepare(
      `INSERT INTO scan_job (status, mode, photo_key, created_by, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       RETURNING ${JOB_COLS}`,
    )
    .bind(input.status ?? 'uploaded', input.mode, PHOTO_NOT_STORED, input.createdBy)
    .first<ScanJobRow>();
  if (!row) throw new Error('insert returned no row');
  return toJob(row);
}

export async function getScanJob(db: D1Database, id: number): Promise<ScanJob | null> {
  const row = await db
    .prepare(`SELECT ${JOB_COLS} FROM scan_job WHERE id = ?`)
    .bind(id)
    .first<ScanJobRow>();
  return row ? toJob(row) : null;
}

/** What vision read, before matching. Kept separately from the enriched lines. */
export async function getRawTitles(db: D1Database, id: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT raw_titles FROM scan_job WHERE id = ?')
    .bind(id)
    .first<{ raw_titles: string | null }>();
  return row?.raw_titles ?? null;
}

/**
 * The queue.
 *
 * Newest first, and `open: true` narrows to sweeps that still want attention.
 * A finished job is kept rather than deleted — it is the only record of which
 * photograph produced which books — but it does not belong in a list whose
 * whole job is to say "you left three of these half done".
 */
export async function listScanJobs(
  db: D1Database,
  opts: { open?: boolean; limit?: number } = {},
): Promise<ScanJob[]> {
  const where = opts.open ? `WHERE status NOT IN ('done')` : '';
  const { results } = await db
    .prepare(
      `SELECT ${JOB_COLS} FROM scan_job ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(Math.min(Math.max(opts.limit ?? 25, 1), 200))
    .all<ScanJobRow>();
  return results.map(toJob);
}

/**
 * Write a job's state.
 *
 * Every field is optional and `undefined` means "leave it alone", which is what
 * lets the vision path stamp `raw_titles` without touching lines and the review
 * path write lines without touching `raw_titles`. `updated_at` always moves, so
 * a caller cannot forget it.
 *
 * ⚠️ `reviewed_at` is stamped by the transition to `done` and by nothing else.
 * It answers "when did a person finish with this", which is not the same as
 * "when did the machine finish with it" (`processed_at`).
 */
export async function updateScanJob(
  db: D1Database,
  id: number,
  patch: {
    status?: ScanStatus;
    lines?: ScanLine[];
    rawTitles?: string;
    error?: string | null;
    processed?: boolean;
  },
): Promise<ScanJob | null> {
  const sets: string[] = [`updated_at = datetime('now')`];
  const binds: unknown[] = [];

  if (patch.status !== undefined) {
    sets.push('status = ?');
    binds.push(patch.status);
    if (patch.status === 'done') sets.push(`reviewed_at = datetime('now')`);
  }
  if (patch.lines !== undefined) {
    sets.push('enriched = ?');
    binds.push(JSON.stringify(patch.lines));
  }
  if (patch.rawTitles !== undefined) {
    sets.push('raw_titles = ?');
    binds.push(patch.rawTitles);
  }
  if (patch.error !== undefined) {
    sets.push('error = ?');
    binds.push(patch.error);
  }
  if (patch.processed) sets.push(`processed_at = datetime('now')`);

  const row = await db
    .prepare(`UPDATE scan_job SET ${sets.join(', ')} WHERE id = ? RETURNING ${JOB_COLS}`)
    .bind(...binds, id)
    .first<ScanJobRow>();
  return row ? toJob(row) : null;
}

export async function deleteScanJob(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM scan_job WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}
