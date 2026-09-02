/**
 * The research pipeline's tables: runs, findings, and the verdicts that stop a
 * settled question being asked twice.
 *
 * `research_run` and `research_finding` have existed, unused, since migration
 * 0001 — the schema was designed with this feature in mind and its column
 * comments carry the reasoning. Nothing here changes their shape;
 * `gap_verdict` (migration 0005) is the one addition.
 *
 * ⚠️ **Nothing in this file writes to `work`.** That much is unchanged: this
 * layer records what a run found and stops. Applying a finding is
 * `applyFinding` in the Worker.
 *
 * What *has* changed is who triggers it. It used to happen only because a person
 * pressed Use; a run now applies its own findings unread, on the owner's
 * explicit instruction — see the head of `apps/worker/src/lib/research-run.ts`
 * for the argument and the terms. The consequence for this file is
 * `decided_how` (migration 0013): `review_state = 'accepted'` no longer implies
 * a human read the value, and anything judging trustworthiness must read that
 * column instead. `isbn-ladder.md` §4.4 is why the distinction is worth storing
 * — a wrong answer scored 1.00 on both title and author, twice, in two different
 * series, and only the publisher gave it away.
 */

import {
  DETAIL_FIELDS,
  UNKNOWN_AUTHOR,
  classifyLookupFailure,
  detailAsks,
  detailGaps,
  seriesIndexIncomplete,
  type DecisionMode,
  type DetailField,
  type FindingReviewState,
  type FindingSourceTier,
  type FindingValue,
  type GapSubject,
  type GapVerdict,
  type RunTier,
} from '@lc/core';
import { listWorkAliases } from './aliases.js';

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
  /** JSON array of the alias titles the run asked under, or NULL. Migration 0410. */
  input_aliases: string | null;
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
  /**
   * Whatever the run wanted to say for itself. Free-form by design.
   *
   * `sources` maps a `DetailField` name to the rung that answered it —
   * `audiobook` | `index` | `openlibrary` | `googlebooks` | `hardcover` |
   * `wikidata` | `llm` (the `FreeRung` union, plus `llm`). Added
   * 2026-08-23 with the free ladder, and it needs **no migration**: the whole
   * object is `result_json`, a TEXT column whose reader already tolerates
   * anything. ⚠️ A run recorded before the ladder existed simply has no
   * `sources` key, which is the truth about it — nobody wrote down where its
   * values came from — where a default of `llm` would be a claim nobody made.
   *
   * Typed as plain strings deliberately: this is JSON read back off disk, and
   * `@lc/db` cannot enforce a union it did not write.
   */
  result: {
    detail?: string | null;
    proposed?: number;
    applied?: number;
    sources?: Record<string, string>;
    /**
     * What the FREE ladder did before any money was spent, added 2026-09-02.
     *
     * ⚠️ **`sources` says who answered; this says who was ASKED.** They are
     * different questions and only the second one can explain a bill. Run 738
     * on padhard #578 is the case that forced this: its whole `result_json` was
     * 261 bytes reading `sources: llm`, so *"why did this cost money?"* was
     * unanswerable from the page and had to be reconstructed by hand from the
     * code and the tables. The free rungs HAD run; nothing recorded it.
     *
     * | key | is |
     * |---|---|
     * | `rungs` | the rungs actually invoked, in ladder order. ⚠️ A rung BELOW the one that answered is absent because it was never reached, **not** because it knew nothing |
     * | `skipped` | the ladder's own named skip lines, verbatim — each already says whether a rung could not be asked or was asked and was silent |
     * | `applied` | one sentence per value the free rungs wrote |
     * | `stillOpen` | the fields handed on to the paid rung. This is the list the money was spent on |
     *
     * **No migration**, for the same reason `sources` needed none: the whole
     * object is `result_json`, a TEXT column whose reader tolerates anything.
     * ⚠️ Absent on every run recorded before 2026-09-02, and that absence is
     * the truth about them — nobody wrote the ladder down. It must never be
     * rendered as "the free rungs found nothing".
     *
     * Typed as plain strings deliberately: this is JSON read back off disk and
     * `@lc/db` cannot enforce a union it did not write.
     */
    free?: {
      rungs?: string[];
      skipped?: string[];
      applied?: string[];
      stillOpen?: string[];
    };
  } | null;
  inputTitle: string | null;
  /**
   * The alias titles the run additionally asked under — `work_alias` rows of
   * kind `title` at the moment the run started. Empty for a run that asked
   * under the primary title alone, which is every run written before migration
   * 0410. Together with `inputTitle` this is the run's full identity set, and
   * `askedForWork` compares it against the work's CURRENT identities to decide
   * whether a new alias has re-opened a field.
   */
  inputAliases: string[];
  inputYear: number | null;
  /** The fields the run was sent to find, comma-delimited with edge commas. */
  unfilled: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const RUN_COLS = `id, work_id, tier, model, effort, status, error_message,
                  input_tokens, output_tokens, result_json, input_title, input_year,
                  unfilled, input_aliases, triggered_by, started_at, finished_at, created_at`;

/**
 * The most alias titles a run carries into one ask, mirroring `enrich.ts`'s
 * `MAX_QUERIES`. Aliases are entered by hand and there will never be many; the
 * cap is a guard against one bad paste turning a single lookup into a wall of
 * "also known as" lines. Deliberately shared by the WRITE side (`research-run.ts`
 * builds the ask and stamps `input_aliases` from this) and the READ side
 * (`askedForWork` builds the current identity set from it), so the two can never
 * cap differently and leave a field re-opening for ever.
 */
export const MAX_ALIAS_IDENTITIES = 4;

/**
 * The alias titles to actually carry into an ask, from all of a work's
 * title-kind aliases — deduplicated, blanks and the primary title dropped,
 * ordered stably, and capped at `MAX_ALIAS_IDENTITIES`.
 *
 * ⚠️ ONE definition, used by both the ask and the accounting. The stable sort
 * matters: if a work somehow had more than the cap of aliases, the WRITE side
 * and the READ side must pick the SAME subset or the read would see a current
 * identity the run never covered and re-open the field on every sweep. Sorting
 * `localeCompare` and slicing identically on both sides closes that loop.
 */
export function selectTitleAliases(
  primaryTitle: string,
  aliases: readonly string[],
): string[] {
  const primary = primaryTitle.trim();
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of aliases) {
    const a = (raw ?? '').trim();
    if (a === '' || a === primary || seen.has(a)) continue;
    seen.add(a);
    kept.push(a);
  }
  kept.sort((x, y) => x.localeCompare(y));
  return kept.slice(0, MAX_ALIAS_IDENTITIES);
}

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

/**
 * `input_aliases` is a JSON array of strings, NOT the comma-packed form
 * `unfilled` uses — alias titles are free text and may contain commas (migration
 * 0410 says why). NULL, '' and anything unparseable all read back as "no
 * aliases", which is the truth about a run that asked under the title alone.
 */
function packAliases(aliases: readonly string[]): string | null {
  return aliases.length ? JSON.stringify([...aliases]) : null;
}

function unpackAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
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
    inputAliases: unpackAliases(row.input_aliases),
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
  /**
   * The alias titles the run additionally asked under, already capped and
   * de-duplicated by `selectTitleAliases`. Stamped alongside `inputTitle` and
   * for the same reason — the record is of what the lookup had in hand, not what
   * the work looks like now. Omit or pass `[]` for a run that asks under the
   * primary title alone.
   */
  inputAliases?: readonly string[];
  inputYear: number | null;
  /** The gaps it was sent to fill. */
  unfilled: readonly DetailField[];
}

export async function createRun(db: D1Database, input: CreateRunInput): Promise<ResearchRun> {
  const row = await db
    .prepare(
      `INSERT INTO research_run
         (work_id, tier, model, effort, status, input_title, input_year, unfilled,
          input_aliases, triggered_by, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, datetime('now'))
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
      packAliases(input.inputAliases ?? []),
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
  /** Same shape `toRun` reads back — see `ResearchRun['result']` for `sources`. */
  result?: ResearchRun['result'];
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

/**
 * What has already been ASKED about each work, and when it was last attempted.
 *
 * ⚠️ This exists for one reason: **the details queue does not converge on its
 * own.** A `gap_verdict` closes a question only when the model actually returns
 * a `none`/`unknown` finding for it. Three outcomes leave the gap exactly as it
 * was, and every one of them is normal here:
 *
 * | Outcome | Why the gap survives |
 * |---|---|
 * | `identified: false` | no findings at all are returned — and per isbn-ladder.md §4.2 this is the *expected* answer for roughly half this library |
 * | ~~the volume number~~ | ~~research fills `series_index_sort` only~~ — **fixed 2026-08-19**: `applyFinding` writes the derived printed form too (`seriesIndexDisplayFrom`), and the sweep's rung 0 heals rows stranded before it. The other two rows still stand. |
 * | an unusable value | the finding stays `pending` by design, so a person still gets asked |
 *
 * A person pressing Run is welcome to re-buy any of those; they are choosing to.
 * An hourly sweep doing it is a bill that never stops, so the sweep asks this
 * question first — see `apps/worker/src/lib/details-sweep.ts`.
 *
 * Two columns, two different jobs:
 *
 * - `asked` — fields carried by a **finished (`done`)** run that asked under
 *   every NAME the work currently answers to. `error` runs are excluded on
 *   purpose: they never got an answer, so the question has not really been put.
 *
 *   ⚠️ **Identity, not just title (2026-08-24).** A run records the names it
 *   asked under: `input_title` and, since migration 0410, `input_aliases` — the
 *   `work_alias` rows of kind `title` it was handed. A field counts as asked
 *   only while some done run's recorded name-set COVERS the work's current
 *   name-set. This subsumes the old `input_title = w.title` rule and adds one
 *   case to it:
 *     - retitle a book → no run's `input_title` matches → askable again (as
 *       before: "unless an input changed", identification may now succeed);
 *     - add a NEW alias → no past run asked under it → every still-empty field
 *       that alias could newly answer re-opens, and NOTHING already answered
 *       under the main title does (an answered field is filled, so it is not a
 *       gap and `unaskedGaps` never re-asks it — the re-open is "exactly the
 *       newly-answerable fields, and no more").
 *   The accounting itself is the pure, exported `askedForWork`, so the rule is
 *   pinned by a test directly rather than through a copy of the SQL.
 * - `lastAttemptAt` — when this book last genuinely had its turn. The sweep
 *   rotates on it, which is what stops one permanently-erroring book at the top
 *   of the alphabet starving every book below it.
 *
 * ## ⚠️ A failure about the ACCOUNT is not a turn (2026-08-19)
 *
 * `lastAttemptAt` used to be the newest attempt of any status, full stop. That
 * is right for a book that fails *on its own merits* — a lookup that times out
 * or comes back unreadable has spent a slot and must go to the back. It is
 * wrong for the failure this catalog actually hit: on 2026-08-17 the friend
 * instance's key reached its monthly cap, and three books errored with
 *
 *     "You have reached your specified API usage limits.
 *      You will regain access on 2026-09-01 at 00:00 UTC."
 *
 * Nothing was asked, nothing was spent, and nothing about those books was
 * learned — yet all three were demoted behind every book that HAD been
 * answered, and stayed demoted after the owner cleared the cap. A whole-account
 * outage demotes the whole catalog in the order it happened to be swept, which
 * is a rotation the outage invented rather than one the work justified.
 *
 * So an error is now weighed by `classifyLookupFailure` (`@lc/core`, the leaf
 * that already words these three failures for the screen): `allowance_used_up`,
 * `too_many_at_once` and `key_rejected` are facts about the KEY, so they leave
 * the rotation exactly where it was; every other error still counts as a turn
 * taken.
 *
 * ⚠️ This is deliberately a **different rule from `asked`**, and the two must
 * not be merged. `asked` already ignores every error — a question that got no
 * answer has not been put, whatever the reason. This one is about ORDER, not
 * eligibility, and only account failures are exempt: a book whose lookups keep
 * timing out is still eligible AND still goes to the back, which is precisely
 * the starvation guard the original line was written for.
 *
 * A few queries for the whole catalog, not one: the timestamp rotation is a
 * per-work SQL aggregate, but `asked` now needs each done run's recorded
 * name-set weighed against the work's current aliases, which is per-run data and
 * a `work_alias` read. `research_run` is one row per lookup ever made — tens, not
 * thousands — and `work_alias` is smaller still, so the extra reads cost nothing.
 */
export interface WorkRunHistory {
  workId: number;
  /**
   * Fields a finished run already asked about while covering every name the work
   * currently answers to. See the header: adding a new alias re-opens exactly
   * the still-empty fields it could newly answer.
   */
  asked: DetailField[];
  /**
   * The newest attempt that was really this book's turn: `finished_at`, or
   * `started_at` if the run is still out. ⚠️ Runs that failed on the account's
   * allowance, rate limit or key are skipped — see the header.
   */
  lastAttemptAt: string | null;
}

/**
 * The fields a work has already been asked about, given every done run's
 * recorded name-set and the names the work answers to NOW.
 *
 * Pure and exported so the delicate accounting — "adding an alias re-opens
 * exactly the newly-answerable fields, and no more" — is pinned by a test
 * directly, the same way `lastRealAttempt` is.
 *
 * A field is asked iff SOME done run both asked it (`unfilled`) and asked under
 * a name-set that COVERS the work's current one: the run's `input_title` equals
 * the current title AND every current alias was among the run's `input_aliases`.
 * Coverage must be satisfied by a SINGLE run — in normal operation the paid ask
 * always carries the title plus ALL current aliases at once, so the latest run
 * after the latest alias change covers everything, and before that run happens
 * the field is correctly re-opened.
 *
 * ⚠️ The alias cap is applied to the CURRENT set through `selectTitleAliases`,
 * the identical function the ask uses to choose what to send. If a work ever had
 * more than the cap of aliases, both sides drop the same overflow, so coverage
 * is decidable and no field re-opens for ever.
 */
export function askedForWork(
  currentTitle: string,
  currentTitleAliases: readonly string[],
  runs: readonly {
    inputTitle: string | null;
    inputAliases: readonly string[];
    unfilled: readonly string[];
  }[],
): DetailField[] {
  const currentNames = [currentTitle, ...selectTitleAliases(currentTitle, currentTitleAliases)];
  const asked = new Set<string>();
  for (const run of runs) {
    const covered = new Set<string>([run.inputTitle ?? '', ...run.inputAliases]);
    if (currentNames.every((name) => covered.has(name))) {
      for (const field of run.unfilled) asked.add(field);
    }
  }
  return [...asked] as DetailField[];
}

export async function detailsRunHistory(db: D1Database): Promise<WorkRunHistory[]> {
  // The rotation half: per-work timestamp aggregates, unchanged.
  //
  // ⚠️ Three aggregates rather than one MAX, because SQLite cannot read an
  // Anthropic error body and decide whether it was about the key. The split is:
  // the newest NON-error attempt, then the newest error and its message, and the
  // classification happens in TypeScript against the one implementation that
  // already words these failures for the screen.
  const times = await db
    .prepare(
      `SELECT r.work_id AS work_id,
              MAX(CASE WHEN r.status <> 'error'
                       THEN COALESCE(r.finished_at, r.started_at) END) AS last_ok_at,
              MAX(CASE WHEN r.status = 'error'
                       THEN COALESCE(r.finished_at, r.started_at) END) AS last_error_at,
              (SELECT e.error_message
                 FROM research_run e
                WHERE e.work_id = r.work_id AND e.tier = 'details' AND e.status = 'error'
                ORDER BY COALESCE(e.finished_at, e.started_at) DESC, e.id DESC
                LIMIT 1) AS last_error_message
         FROM research_run r
        WHERE r.tier = 'details'
        GROUP BY r.work_id`,
    )
    .all<{
      work_id: number;
      last_ok_at: string | null;
      last_error_at: string | null;
      last_error_message: string | null;
    }>();

  // The asked half: every done run's recorded name-set, plus the work's title
  // and current title-aliases, so `askedForWork` can decide coverage. Per-run,
  // not aggregated, because coverage is a per-run question.
  const doneRuns = await db
    .prepare(
      `SELECT r.work_id AS work_id, w.title AS work_title,
              r.input_title AS input_title, r.input_aliases AS input_aliases,
              r.unfilled AS unfilled
         FROM research_run r
         JOIN work w ON w.id = r.work_id
        WHERE r.tier = 'details' AND r.status = 'done'`,
    )
    .all<{
      work_id: number;
      work_title: string;
      input_title: string | null;
      input_aliases: string | null;
      unfilled: string | null;
    }>();

  // Current title-aliases per work, grouped once.
  const aliasesByWork = new Map<number, string[]>();
  for (const a of await listWorkAliases(db)) {
    if (a.kind !== 'title') continue;
    const list = aliasesByWork.get(a.workId) ?? [];
    list.push(a.alias);
    aliasesByWork.set(a.workId, list);
  }

  // Group done runs by work, carrying the current title from the join.
  const runsByWork = new Map<
    number,
    { title: string; runs: { inputTitle: string | null; inputAliases: string[]; unfilled: string[] }[] }
  >();
  for (const row of doneRuns.results) {
    const entry = runsByWork.get(row.work_id) ?? { title: row.work_title, runs: [] };
    entry.runs.push({
      inputTitle: row.input_title,
      inputAliases: unpackAliases(row.input_aliases),
      unfilled: unpackFields(row.unfilled),
    });
    runsByWork.set(row.work_id, entry);
  }

  return times.results.map((row) => {
    const grouped = runsByWork.get(row.work_id);
    const asked = grouped
      ? askedForWork(grouped.title, aliasesByWork.get(row.work_id) ?? [], grouped.runs)
      : [];
    return {
      workId: row.work_id,
      asked,
      lastAttemptAt: lastRealAttempt(row.last_ok_at, row.last_error_at, row.last_error_message),
    };
  });
}

/**
 * Which of the two timestamps counts as this book's last turn. Pure and
 * exported so the rule above is pinned by a test directly rather than through a
 * copy of itself.
 *
 * ⚠️ Only the NEWEST error is classified, and that is enough: an older error
 * either predates a successful attempt (which then wins on time anyway) or is
 * itself superseded by the newer one. Reading every error row to be thorough
 * would cost a query per work for an answer that cannot change.
 */
export function lastRealAttempt(
  lastOkAt: string | null,
  lastErrorAt: string | null,
  lastErrorMessage: string | null,
): string | null {
  if (!lastErrorAt) return lastOkAt;
  // A failure about the key is not a turn. Fall back to the last real one —
  // which may be null, putting a never-successfully-attempted book back at the
  // front where it started.
  if (classifyLookupFailure(lastErrorMessage)) return lastOkAt;
  if (!lastOkAt) return lastErrorAt;
  // ISO-ish 'YYYY-MM-DD HH:MM:SS' from SQLite's datetime('now'), so string
  // order is time order — the same reasoning `planSweep`'s sort relies on.
  return lastErrorAt > lastOkAt ? lastErrorAt : lastOkAt;
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
  decided_how: string | null;
  created_at: string;
}

export interface ResearchFinding {
  id: number;
  runId: number;
  workId: number;
  field: string;
  value: FindingValue;
  /** `FindingSourceTier`, not `SourceTier`: 'donor' is a valid stored origin (migration 0320). */
  sourceTier: FindingSourceTier;
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
  /**
   * Whether anybody read this before it was accepted. Migration 0013.
   *
   * ⚠️ `reviewState: 'accepted'` no longer implies a person looked. Under
   * auto-apply the run accepts its own findings, and this is the only column
   * that says so. NULL means still pending, or decided before 0013.
   */
  decidedHow: DecisionMode | null;
  createdAt: string;
}

const FINDING_COLS = `id, run_id, work_id, field, value_json, source_tier, source_url,
                      confidence, review_state, reviewed_by, reviewed_at, decided_how,
                      created_at`;

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
    sourceTier: row.source_tier as FindingSourceTier,
    sourceUrl: row.source_url,
    confidence: row.confidence,
    reviewState: row.review_state as FindingReviewState,
    reviewedAt: row.reviewed_at,
    decidedHow: (row.decided_how as DecisionMode | null) ?? null,
    createdAt: row.created_at,
  };
}

export interface SaveFindingInput {
  field: DetailField;
  value: FindingValue;
  sourceTier: FindingSourceTier;
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

/**
 * Mark one finding. The only thing review does to the finding itself.
 *
 * ⚠️ `decidedHow` is not optional and should never be guessed at a call site.
 * It is the difference between "a person asserted this" and "a machine wrote it
 * while nobody was looking", and the whole audit trail for auto-apply rests on
 * callers passing the truth. See migration 0013.
 */
export async function markFinding(
  db: D1Database,
  id: number,
  reviewState: FindingReviewState,
  reviewedBy: number | null,
  decidedHow: DecisionMode,
): Promise<ResearchFinding | null> {
  const row = await db
    .prepare(
      `UPDATE research_finding
          SET review_state = ?, reviewed_by = ?, reviewed_at = datetime('now'), decided_how = ?
        WHERE id = ?
        RETURNING ${FINDING_COLS}`,
    )
    .bind(reviewState, reviewedBy, decidedHow, id)
    .first<ResearchFindingRow>();
  return row ? toFinding(row) : null;
}

/**
 * One auto-applied value, with enough around it to judge and undo.
 *
 * The work's title travels with the row because the whole point of the list is
 * to be skimmed — "Cradle 3, description, from reactormag.com" — and a list of
 * work ids is not skimmable.
 */
export interface AutoApplied {
  findingId: number;
  workId: number;
  title: string;
  /** Null for a book added without an author — the sentinel never leaves SQL. */
  authors: string | null;
  field: string;
  value: FindingValue;
  sourceTier: FindingSourceTier;
  sourceUrl: string | null;
  appliedAt: string | null;
}

/**
 * What the machine wrote lately, newest first.
 *
 * ⚠️ This is the other half of the auto-apply bargain and not a nicety. The
 * owner gave up reading each value *before* it lands; what they get back is the
 * ability to see a batch afterwards and throw it away wholesale. Without this
 * the trade is one-sided — the gate is gone and there is no remedy.
 *
 * `accepted` only: a rejected or still-pending finding never touched a column,
 * so it has nothing to undo.
 */
export async function listAutoApplied(db: D1Database, limit = 50): Promise<AutoApplied[]> {
  const { results } = await db
    .prepare(
      `SELECT f.id AS finding_id, f.work_id, w.title, NULLIF(w.authors, '${UNKNOWN_AUTHOR}') AS authors, f.field, f.value_json,
              f.source_tier, f.source_url, f.reviewed_at
         FROM research_finding f
         JOIN work w ON w.id = f.work_id
        WHERE f.decided_how = 'auto' AND f.review_state = 'accepted'
        ORDER BY f.reviewed_at DESC, f.id DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<{
      finding_id: number;
      work_id: number;
      title: string;
      authors: string;
      field: string;
      value_json: string;
      source_tier: string;
      source_url: string | null;
      reviewed_at: string | null;
    }>();

  return results.map((r) => {
    let value: FindingValue;
    try {
      value = JSON.parse(r.value_json) as FindingValue;
    } catch {
      value = { kind: 'unknown', basis: 'This finding could not be read back.' };
    }
    return {
      findingId: r.finding_id,
      workId: r.work_id,
      title: r.title,
      authors: r.authors,
      field: r.field,
      value,
      sourceTier: r.source_tier as FindingSourceTier,
      sourceUrl: r.source_url,
      appliedAt: r.reviewed_at,
    };
  });
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
  /** Whether anybody read it first. See migration 0013. Defaults to 'human'. */
  decidedHow?: DecisionMode | null;
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
      `INSERT INTO gap_verdict
         (work_id, field, verdict, source, note, run_id, decided_by, decided_how)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (work_id, field) DO UPDATE SET
         verdict = excluded.verdict,
         source = excluded.source,
         note = excluded.note,
         run_id = excluded.run_id,
         decided_by = excluded.decided_by,
         decided_how = excluded.decided_how,
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
      input.decidedHow ?? 'human',
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

/**
 * Withdraw one auto-recorded verdict, putting the question back on the list.
 *
 * ⚠️ Narrowed to `decided_how = 'auto'` on purpose, and this is the guard that
 * makes bulk undo safe. Undoing a machine batch must never reach a verdict a
 * person wrote by hand — those are the eleven researched standalones migration
 * 0007 exists to protect, and re-opening them would make the catalog pay a model
 * to rediscover work somebody already did.
 */
export async function deleteAutoVerdict(
  db: D1Database,
  workId: number,
  field: DetailField,
): Promise<boolean> {
  const res = await db
    .prepare(
      `DELETE FROM gap_verdict
        WHERE work_id = ? AND field = ? AND decided_how = 'auto'`,
    )
    .bind(workId, field)
    .run();
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
  /** ⚠️ Travels with sort everywhere the gap test runs — the volume number is
   *  two columns, and a row with sort set and display NULL prints nothing. */
  series_index_display: string | null;
  first_published: number | null;
  description: string | null;
  /** Comma-joined `gap_verdict.field` values, or null when there are none. */
  verdicts: string | null;
}

export interface NeedsDetails {
  workId: number;
  title: string;
  /** Null for a book added without an author — the sentinel never leaves SQL. */
  authors: string | null;
  series: string | null;
  /** The fields this work is asked for and does not have. Never empty. */
  missing: DetailField[];
  /**
   * What a LOOKUP should be sent for — `missing`, plus the volume number when
   * the series is being bought in the same call. ⚠️ Never use this to decide
   * whether a book belongs on the queue or what it owes; see `detailAsks`.
   */
  asks: DetailField[];
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
      `SELECT w.id, w.title, NULLIF(w.authors, '${UNKNOWN_AUTHOR}') AS authors, w.series, w.series_index_sort,
              w.series_index_display, w.first_published, w.description,
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
      seriesIndexDisplay: row.series_index_display,
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
      asks: detailAsks(subject, missing),
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
              w.series_index_display, w.first_published, w.description,
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
      // ⚠️ The volume number is filled when the SORT is — the one policy in
      // `seriesIndexIncomplete`, so this tally can never disagree with the
      // rows. The printed form is optional data by owner rule of 2026-08-19;
      // `docs/info/volume-numbers.md` is why.
      const filled =
        field === 'seriesIndex'
          ? !seriesIndexIncomplete(row.series_index_sort)
          : (() => {
              const v = value[field];
              return v != null && !(typeof v === 'string' && v.trim() === '');
            })();
      if (filled) {
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
