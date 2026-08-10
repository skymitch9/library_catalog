/**
 * The research pipeline's tables: runs, findings, and the verdicts that stop a
 * settled question being asked twice.
 *
 * `research_run` and `research_finding` have existed, unused, since migration
 * 0001 — the schema was designed with this feature in mind and its column
 * comments carry the reasoning. Nothing here changes their shape;
 * `gap_verdict` (migration 0005) is the one addition.
 *
 * ⚠️ **Nothing in this file writes to `work`.** A run records what it found and
 * stops. Applying a finding is `applyFinding` in the Worker, and it happens only
 * because a person pressed Use. See `isbn-ladder.md` §4.4 for the measured
 * reason: a wrong answer scored 1.00 on both title and author, twice, in two
 * different series, and only the publisher gave it away.
 */

import {
  DETAIL_FIELDS,
  detailGaps,
  type DetailField,
  type FindingReviewState,
  type FindingValue,
  type GapSubject,
  type GapVerdict,
  type RunTier,
  type SourceTier,
} from '@lc/core';

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface ResearchRunRow {
  id: number;
  work_id: number;
  tier: string;
  model: string | null;
  effort: string | null;
  status: string;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  result_json: string | null;
  input_title: string | null;
  input_year: number | null;
  unfilled: string | null;
  triggered_by: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ResearchRun {
  id: number;
  workId: number;
  tier: string;
  model: string | null;
  effort: string | null;
  status: 'queued' | 'running' | 'done' | 'error';
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Whatever the run wanted to say for itself. Free-form by design. */
  result: { detail?: string | null; proposed?: number } | null;
  inputTitle: string | null;
  inputYear: number | null;
  /** The fields the run was sent to find, comma-delimited with edge commas. */
  unfilled: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const RUN_COLS = `id, work_id, tier, model, effort, status, error_message,
                  input_tokens, output_tokens, result_json, input_title, input_year,
                  unfilled, triggered_by, started_at, finished_at, created_at`;

/**
 * `,a,b,` — leading and trailing commas, exactly as migration 0001 specifies.
 *
 * The schema comment says why: an exact test is then `instr(unfilled, ',series,')`,
 * and `series` cannot match inside `seriesIndex`. Get the edges wrong and the
 * substring test silently starts matching prefixes.
 */
function packFields(fields: readonly string[]): string | null {
  return fields.length ? `,${fields.join(',')},` : null;
}

function unpackFields(raw: string | null): string[] {
  return (raw ?? '').split(',').filter(Boolean);
}

export function toRun(row: ResearchRunRow): ResearchRun {
  let result: ResearchRun['result'] = null;
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json) as ResearchRun['result'];
    } catch {
      // A run whose result will not parse is still a run that happened. Losing
      // the row because one field is malformed would hide the very thing the
      // table exists to record.
      result = { detail: 'The run recorded a result that could not be read back.' };
    }
  }
  return {
    id: row.id,
    workId: row.work_id,
    tier: row.tier,
    model: row.model,
    effort: row.effort,
    status: row.status as ResearchRun['status'],
    errorMessage: row.error_message,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    result,
    inputTitle: row.input_title,
    inputYear: row.input_year,
    unfilled: unpackFields(row.unfilled),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export interface CreateRunInput {
  workId: number;
  tier: RunTier;
  model: string;
  effort: string;
  triggeredBy: number | null;
  /**
   * What the run knew going in.
   *
   * Stamped before the call, never after — migration 0001's reasoning, unchanged:
   * a work edited while a run was in flight would otherwise be recorded with the
   * new value and never re-asked about the old one.
   */
  inputTitle: string;
  inputYear: number | null;
  /** The gaps it was sent to fill. */
  unfilled: readonly DetailField[];
}

export async function createRun(db: D1Database, input: CreateRunInput): Promise<ResearchRun> {
  const row = await db
    .prepare(
      `INSERT INTO research_run
         (work_id, tier, model, effort, status, input_title, input_year, unfilled,
          triggered_by, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, datetime('now'))
       RETURNING ${RUN_COLS}`,
    )
    .bind(
      input.workId,
      input.tier,
      input.model,
      input.effort,
      input.inputTitle,
      input.inputYear,
      packFields(input.unfilled),
      input.triggeredBy,
    )
    .first<ResearchRunRow>();
  if (!row) throw new Error('research_run insert returned no row');
  return toRun(row);
}

export interface FinishRunInput {
  status: 'done' | 'error';
  errorMessage?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  result?: { detail?: string | null; proposed?: number } | null;
}

export async function finishRun(
  db: D1Database,
  id: number,
  input: FinishRunInput,
): Promise<ResearchRun | null> {
  const row = await db
    .prepare(
      `UPDATE research_run
          SET status = ?, error_message = ?, input_tokens = ?, output_tokens = ?,
              result_json = ?, finished_at = datetime('now')
        WHERE id = ?
        RETURNING ${RUN_COLS}`,
    )
    .bind(
      input.status,
      input.errorMessage ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.result ? JSON.stringify(input.result) : null,
      id,
    )
    .first<ResearchRunRow>();
  return row ? toRun(row) : null;
}

/**
 * A run for this work that is still supposed to be working.
 *
 * The queue page polls, and without this a poll landing mid-lookup starts a
 * second paid call for the same book. Call `closeStaleRuns` first, so a run
 * still reported active really is one.
 */
export async function activeRun(db: D1Database, workId: number): Promise<ResearchRun | null> {
  const row = await db
    .prepare(
      `SELECT ${RUN_COLS} FROM research_run
        WHERE work_id = ? AND status IN ('queued', 'running')
        ORDER BY id DESC LIMIT 1`,
    )
    .bind(workId)
    .first<ResearchRunRow>();
  return row ? toRun(row) : null;
}

/**
 * Close anything that has gone quiet.
 *
 * ⚠️ The layer that catches what no `catch` can. A Worker invocation killed
 * outright — subrequest ceiling, platform eviction — runs none of our code, so
 * the row sits at `running` for ever and the book can never be asked again. The
 * sibling project watched `research_run` id 3 sit at `running` for eleven hours
 * for exactly this reason.
 *
 * Fifteen minutes is far beyond any real lookup (measured 17–73s there) and far
 * short of a working session.
 */
export async function closeStaleRuns(db: D1Database): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE research_run
          SET status = 'error',
              error_message = 'The lookup stopped without recording an outcome.',
              finished_at = datetime('now')
        WHERE status IN ('queued', 'running')
          AND started_at IS NOT NULL
          AND started_at < datetime('now', '-15 minutes')`,
    )
    .run();
  return res.meta.changes ?? 0;
}

/** The newest run per work. What makes the queue survive a reload. */
export async function latestRuns(db: D1Database): Promise<ResearchRun[]> {
  const { results } = await db
    .prepare(
      `SELECT ${RUN_COLS} FROM research_run r
        WHERE r.id = (SELECT MAX(id) FROM research_run WHERE work_id = r.work_id)
        ORDER BY r.work_id`,
    )
    .all<ResearchRunRow>();
  return results.map(toRun);
}

export async function listRunsForWork(db: D1Database, workId: number): Promise<ResearchRun[]> {
  const { results } = await db
    .prepare(`SELECT ${RUN_COLS} FROM research_run WHERE work_id = ? ORDER BY id DESC`)
    .bind(workId)
    .all<ResearchRunRow>();
  return results.map(toRun);
}

/** Every token this feature has ever spent, from the table rather than a counter. */
export async function runTotals(
  db: D1Database,
): Promise<{ runs: number; inputTokens: number; outputTokens: number; errors: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS runs,
              COALESCE(SUM(input_tokens), 0)  AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              -- ⚠️ COALESCE, like the two above it. SUM() over an empty table is
              -- NULL, not 0, so an untouched catalog reported errors: null and
              -- the page rendered nothing where a count belongs. Caught by
              -- curling the route against a database with no runs in it.
              --
              -- (And no backticks in this comment: the whole query is a
              -- JavaScript template literal, so one would end the string. That
              -- broke the build once already.)
              COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors
         FROM research_run`,
    )
    .first<{ runs: number; inputTokens: number; outputTokens: number; errors: number }>();
  return row ?? { runs: 0, inputTokens: 0, outputTokens: 0, errors: 0 };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface ResearchFindingRow {
  id: number;
  run_id: number;
  work_id: number;
  field: string;
  value_json: string;
  source_tier: string;
  source_url: string | null;
  confidence: number | null;
  review_state: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ResearchFinding {
  id: number;
  runId: number;
  workId: number;
  field: string;
  value: FindingValue;
  sourceTier: SourceTier;
  sourceUrl: string | null;
  /**
   * ⚠️ Always null, and deliberately.
   *
   * The column exists (migration 0001) and stays empty. `isbn-ladder.md` §4.4:
   * a **wrong** book scored 1.00 on title and 1.00 on author, and it happened
   * twice — *Firefight* and *Unsouled*. A number beside a claim invites sorting
   * and thresholding, and no threshold can separate those. What the UI shows
   * instead is the source and the basis, which is what actually caught both.
   */
  confidence: number | null;
  reviewState: FindingReviewState;
  reviewedAt: string | null;
  createdAt: string;
}

const FINDING_COLS = `id, run_id, work_id, field, value_json, source_tier, source_url,
                      confidence, review_state, reviewed_by, reviewed_at, created_at`;

export function toFinding(row: ResearchFindingRow): ResearchFinding {
  let value: FindingValue;
  try {
    value = JSON.parse(row.value_json) as FindingValue;
  } catch {
    value = { kind: 'unknown', basis: 'This finding could not be read back.' };
  }
  return {
    id: row.id,
    runId: row.run_id,
    workId: row.work_id,
    field: row.field,
    value,
    sourceTier: row.source_tier as SourceTier,
    sourceUrl: row.source_url,
    confidence: row.confidence,
    reviewState: row.review_state as FindingReviewState,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export interface SaveFindingInput {
  field: DetailField;
  value: FindingValue;
  sourceTier: SourceTier;
  sourceUrl: string | null;
}

/**
 * Write what a run proposed.
 *
 * Anything this work still had pending from an earlier run is rejected first, so
 * a second look replaces the first rather than stacking two contradictory
 * proposals in front of a person. Findings already accepted or rejected are left
 * exactly as they are — those are decisions, and a re-run does not undo them.
 */
export async function saveFindings(
  db: D1Database,
  runId: number,
  workId: number,
  findings: readonly SaveFindingInput[],
): Promise<number> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE research_finding SET review_state = 'rejected', reviewed_at = datetime('now')
          WHERE work_id = ? AND review_state = 'pending'`,
      )
      .bind(workId),
  ];

  for (const f of findings) {
    statements.push(
      db
        .prepare(
          `INSERT INTO research_finding
             (run_id, work_id, field, value_json, source_tier, source_url, confidence)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(runId, workId, f.field, JSON.stringify(f.value), f.sourceTier, f.sourceUrl),
    );
  }

  await db.batch(statements);
  return findings.length;
}

export async function listFindings(
  db: D1Database,
  workId: number,
  reviewState?: FindingReviewState,
): Promise<ResearchFinding[]> {
  const sql = reviewState
    ? `SELECT ${FINDING_COLS} FROM research_finding WHERE work_id = ? AND review_state = ? ORDER BY id`
    : `SELECT ${FINDING_COLS} FROM research_finding WHERE work_id = ? ORDER BY id`;
  const stmt = reviewState
    ? db.prepare(sql).bind(workId, reviewState)
    : db.prepare(sql).bind(workId);
  const { results } = await stmt.all<ResearchFindingRow>();
  return results.map(toFinding);
}

/** Every pending finding across the catalog, for the queue's review list. */
export async function listPendingFindings(db: D1Database): Promise<ResearchFinding[]> {
  const { results } = await db
    .prepare(
      `SELECT ${FINDING_COLS} FROM research_finding WHERE review_state = 'pending' ORDER BY work_id, id`,
    )
    .all<ResearchFindingRow>();
  return results.map(toFinding);
}

export async function getFinding(db: D1Database, id: number): Promise<ResearchFinding | null> {
  const row = await db
    .prepare(`SELECT ${FINDING_COLS} FROM research_finding WHERE id = ?`)
    .bind(id)
    .first<ResearchFindingRow>();
  return row ? toFinding(row) : null;
}

/** Mark one finding. The only thing review does to the finding itself. */
export async function markFinding(
  db: D1Database,
  id: number,
  reviewState: FindingReviewState,
  reviewedBy: number | null,
): Promise<ResearchFinding | null> {
  const row = await db
    .prepare(
      `UPDATE research_finding
          SET review_state = ?, reviewed_by = ?, reviewed_at = datetime('now')
        WHERE id = ?
        RETURNING ${FINDING_COLS}`,
    )
    .bind(reviewState, reviewedBy, id)
    .first<ResearchFindingRow>();
  return row ? toFinding(row) : null;
}

// ---------------------------------------------------------------------------
// Verdicts — answers, so they stop looking like gaps
// ---------------------------------------------------------------------------

export interface GapVerdictRow {
  id: number;
  work_id: number;
  field: string;
  verdict: string;
  source: string;
  note: string | null;
  run_id: number | null;
  decided_at: string;
}

export interface WorkGapVerdict {
  id: number;
  workId: number;
  field: DetailField;
  verdict: GapVerdict;
  source: string;
  note: string | null;
  runId: number | null;
  decidedAt: string;
}

function toVerdict(row: GapVerdictRow): WorkGapVerdict {
  return {
    id: row.id,
    workId: row.work_id,
    field: row.field as DetailField,
    verdict: row.verdict as GapVerdict,
    source: row.source,
    note: row.note,
    runId: row.run_id,
    decidedAt: row.decided_at,
  };
}

export interface SetVerdictInput {
  workId: number;
  field: DetailField;
  verdict: GapVerdict;
  source: string;
  note?: string | null;
  runId?: number | null;
  decidedBy?: number | null;
}

/**
 * Record an answer. Changing your mind overwrites; it never adds a second row.
 *
 * The UNIQUE (work_id, field) in migration 0005 is what makes that an UPSERT
 * rather than a duplicate, and the reason is in the migration: two verdicts
 * disagreeing about one field is the state the table exists to prevent.
 */
export async function setGapVerdict(
  db: D1Database,
  input: SetVerdictInput,
): Promise<WorkGapVerdict> {
  const row = await db
    .prepare(
      `INSERT INTO gap_verdict (work_id, field, verdict, source, note, run_id, decided_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (work_id, field) DO UPDATE SET
         verdict = excluded.verdict,
         source = excluded.source,
         note = excluded.note,
         run_id = excluded.run_id,
         decided_by = excluded.decided_by,
         decided_at = datetime('now')
       RETURNING id, work_id, field, verdict, source, note, run_id, decided_at`,
    )
    .bind(
      input.workId,
      input.field,
      input.verdict,
      input.source,
      input.note ?? null,
      input.runId ?? null,
      input.decidedBy ?? null,
    )
    .first<GapVerdictRow>();
  if (!row) throw new Error('gap_verdict upsert returned no row');
  return toVerdict(row);
}

export async function listGapVerdicts(
  db: D1Database,
  workId: number,
): Promise<WorkGapVerdict[]> {
  const { results } = await db
    .prepare(
      `SELECT id, work_id, field, verdict, source, note, run_id, decided_at
         FROM gap_verdict WHERE work_id = ? ORDER BY field`,
    )
    .bind(workId)
    .all<GapVerdictRow>();
  return results.map(toVerdict);
}

export async function deleteGapVerdict(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM gap_verdict WHERE id = ?').bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// The queue itself
// ---------------------------------------------------------------------------

interface QueueRow {
  id: number;
  title: string;
  authors: string;
  series: string | null;
  series_index_sort: number | null;
  first_published: number | null;
  description: string | null;
  /** Comma-joined `gap_verdict.field` values, or null when there are none. */
  verdicts: string | null;
}

export interface NeedsDetails {
  workId: number;
  title: string;
  authors: string;
  series: string | null;
  /** The fields this work is asked for and does not have. Never empty. */
  missing: DetailField[];
  /** Fields already answered — shown so the page can say what it is not asking. */
  answered: DetailField[];
}

/**
 * Every work with at least one askable gap.
 *
 * ⚠️ The gap test is **not** in this SQL. `detailGaps` in
 * `packages/core/src/gaps.ts` decides, and it decides here too, in JavaScript,
 * over rows the query merely fetched. The sibling project generates its WHERE
 * clause from the same policy for the same reason: a hand-written SQL predicate
 * is a second implementation of the decision, and the "missing:" line under a
 * row and the query that chose the row start disagreeing the first time the
 * policy changes.
 *
 * The catalog is 116 rows. Fetching all of them and filtering in memory costs
 * one query and no correctness.
 */
export async function listWorksNeedingDetails(db: D1Database): Promise<NeedsDetails[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.title, w.authors, w.series, w.series_index_sort,
              w.first_published, w.description,
              (SELECT group_concat(field) FROM gap_verdict g WHERE g.work_id = w.id) AS verdicts
         FROM work w
        ORDER BY w.sort_title, w.id`,
    )
    .all<QueueRow>();

  const out: NeedsDetails[] = [];
  for (const row of results) {
    const answered = unpackVerdicts(row.verdicts);
    const subject: GapSubject = {
      firstPublished: row.first_published,
      series: row.series,
      seriesIndexSort: row.series_index_sort,
      description: row.description,
      verdicts: answered,
    };
    const missing = detailGaps(subject);
    if (missing.length === 0) continue;
    out.push({
      workId: row.id,
      title: row.title,
      authors: row.authors,
      series: row.series,
      missing,
      answered,
    });
  }
  return out;
}

function unpackVerdicts(raw: string | null): DetailField[] {
  return (raw ?? '').split(',').filter(Boolean) as DetailField[];
}

export interface FieldGapCount {
  field: DetailField;
  /** Works still owing this field. */
  missing: number;
  /** Works where a verdict says there is no such thing. */
  none: number;
  /** Works where a verdict says nobody knows. */
  unknown: number;
  /** Works that have a value recorded. */
  filled: number;
  /** Works the field cannot apply to — a volume number with no series. */
  notApplicable: number;
}

/**
 * The per-field tally, from the database, over the whole catalog.
 *
 * ⚠️ The part of the queue page that actually carries information. A worklist of
 * 116 rows that each say "first published, description" tells you nothing you
 * did not know from the first row; **this** says which questions are nearly
 * closed and which are wide open, and it is where the thirteen answered series
 * become visible as work already done rather than as an absence.
 */
export async function gapSummary(db: D1Database): Promise<FieldGapCount[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.title, w.authors, w.series, w.series_index_sort,
              w.first_published, w.description,
              (SELECT group_concat(field || ':' || verdict) FROM gap_verdict g WHERE g.work_id = w.id) AS verdicts
         FROM work w`,
    )
    .all<Omit<QueueRow, 'verdicts'> & { verdicts: string | null }>();

  const zero = (): Omit<FieldGapCount, 'field'> => ({
    missing: 0,
    none: 0,
    unknown: 0,
    filled: 0,
    notApplicable: 0,
  });
  const tally = new Map<DetailField, Omit<FieldGapCount, 'field'>>();
  const bump = (field: DetailField, key: keyof Omit<FieldGapCount, 'field'>) => {
    const row = tally.get(field) ?? zero();
    row[key] += 1;
    tally.set(field, row);
  };

  for (const row of results) {
    const pairs = (row.verdicts ?? '').split(',').filter(Boolean);
    const verdictOf = new Map<string, string>();
    for (const pair of pairs) {
      const idx = pair.lastIndexOf(':');
      if (idx > 0) verdictOf.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    const value: Record<DetailField, string | number | null> = {
      firstPublished: row.first_published,
      series: row.series,
      seriesIndex: row.series_index_sort,
      description: row.description,
    };

    for (const field of DETAIL_FIELDS) {
      // A volume number is not a question you can ask a book with no series.
      if (field === 'seriesIndex' && (row.series == null || row.series.trim() === '')) {
        bump(field, 'notApplicable');
        continue;
      }
      const v = value[field];
      if (v != null && !(typeof v === 'string' && v.trim() === '')) {
        bump(field, 'filled');
        continue;
      }
      const verdict = verdictOf.get(field);
      if (verdict === 'none') bump(field, 'none');
      else if (verdict === 'unknown') bump(field, 'unknown');
      else bump(field, 'missing');
    }
  }

  // Reported in DETAIL_FIELDS' order, so the summary and the "missing:" line
  // under every row list the same things in the same sequence.
  return DETAIL_FIELDS.map((field) => ({ field, ...(tally.get(field) ?? zero()) }));
}
