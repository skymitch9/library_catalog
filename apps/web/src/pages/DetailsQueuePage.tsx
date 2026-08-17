import { useCallback, useEffect, useRef, useState } from 'react';
import { wordLookupError } from '@lc/core';
import {
  api,
  type AutoApplied,
  type DetailField,
  type FieldGapCount,
  type Me,
  type NeedsDetails,
  type QueueResponse,
  type ResearchFinding,
  type RunView,
} from '../api.js';
import { describeError } from '../lib/errors.js';
import { Link, queuePath, workPath } from '../router.js';

/**
 * What the catalog is missing, and the two ways to fill it.
 *
 * ## ⚠️ Why this is a tally first and a list second
 *
 * The obvious details queue is "every row with a null column". Measured against
 * production on 2026-08-10 that is **116 works out of 116**, each one saying
 * *first published, description* — the same sentence, a hundred and sixteen
 * times. It is a list you cannot work down because nothing in it distinguishes
 * one row from the next.
 *
 * So the tally comes first. It is where the information is: `series` reads
 * *0 to ask, 13 already answered*, which is thirteen pieces of research showing
 * up as **work already done** rather than as an absence; `first published` reads
 * *116 to ask*, which is a backfill with a price on it. Clicking a row narrows
 * the worklist to that one question, and then the list below is a list you can
 * actually get to the end of.
 *
 * ## Two ways to close a gap, and only one of them costs
 *
 * **Say what you know** writes a verdict — free, instant, and it demands a
 * source. **Look it up** spends 2–8¢ of Claude usage. The free one is listed
 * first on every row on purpose.
 *
 * ## ⚠️ A lookup fills the answer in. It does not ask first.
 *
 * This page used to show every found value with **Use it** and **Not this**
 * beside it. The owner pressed Use on all of them, without reading, every time —
 * so the gate was not buying scrutiny, it was buying taps, and four fields
 * stayed blank across a hundred-odd books because filling them in was tedious
 * rather than because anything was in doubt. In their words: *"I'd rather come
 * across a book with a wrong desc and fix it then, than confirm each possible
 * item each time."*
 *
 * So the confirmation is gone and the two things that make that trade honest are
 * here instead:
 *
 * - **Recently filled in** below the worklist, with Undo on every row and on the
 *   batch. Recoverability in place of a veto.
 * - Every value carries `decided_how = 'auto'`, so *"did anybody read this?"*
 *   stays answerable forever (migration 0013).
 *
 * And a third, which lives on the book page rather than here: the four fields
 * are editable in place, because "fix it when I see it" has to be two taps or
 * the bargain is not real.
 *
 * There is still deliberately **no confidence score** anywhere:
 * `docs/info/isbn-ladder.md` §4.4 records a wrong answer scoring 1.00 on title
 * and 1.00 on author — twice, in two different series — and only the publisher
 * gave it away. That argument did not change when the gate went; if anything it
 * is why nothing is silently dropped for scoring badly. Everything is applied,
 * and everything that could not be is named.
 */

/** Slow enough not to be a nuisance, quick enough that a run feels live. */
const POLL_MS = 3000;

const isActive = (run: RunView | undefined): boolean =>
  run != null && (run.status === 'queued' || run.status === 'running');

function formatCents(cents: number): string {
  if (cents <= 0) return '0¢';
  return cents < 100 ? `${cents < 1 ? cents.toFixed(2) : Math.round(cents)}¢` : `$${(cents / 100).toFixed(2)}`;
}

export function DetailsQueuePage({
  me,
  field,
  onChoresChanged,
}: {
  me: Me;
  field: string | null;
  /**
   * ⚠️ Tells App to re-read `/api/me`.
   *
   * The nav's "Missing (N)" comes from `me.chores`, which is fetched once when
   * the app mounts. Auto-apply drains the queue *while this page is open*, so
   * without this the badge sits at its opening value until a reload — a count
   * that says 116 over an empty worklist. `null` vs `0` is load-bearing there
   * (see `/api/me`), so the fix is to re-read it, never to decrement it here.
   */
  onChoresChanged: () => void;
}) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<number, RunView>>({});
  const [findings, setFindings] = useState<Record<number, ResearchFinding[]>>({});
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  /**
   * Lookups whose POST has not come back yet.
   *
   * Load-bearing and easy to miss: the POST *waits* for its lookup, so for the
   * 20–90 seconds it is in flight there is no `running` row in `runs` to notice.
   * Without this counter the driver below would see "nothing active", start the
   * next book, and fire the whole queue off in parallel — which is exactly what
   * one-at-a-time exists to prevent, and what the 50-subrequest ceiling punishes.
   */
  const [inFlight, setInFlight] = useState<ReadonlySet<number>>(new Set());

  /** What the machine has written lately. The undo list; see the note below. */
  const [autoApplied, setAutoApplied] = useState<AutoApplied[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [undoSaid, setUndoSaid] = useState<string | null>(null);

  const loadAutoApplied = useCallback(async () => {
    try {
      const r = await api.autoApplied(50);
      setAutoApplied(r.applied);
    } catch {
      // The worklist is the page; a failed history fetch must not blank it.
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await api.queue();
      setData(next);
      const byWork: Record<number, RunView> = {};
      for (const run of next.runs) byWork[run.workId] = run;
      setRuns(byWork);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
    // Reloaded together, always. These two views disagree the moment one is
    // refreshed without the other — a book vanishing from the worklist with
    // nothing appearing below to say what filled it in reads as data loss.
    await loadAutoApplied();
    onChoresChanged();
  }, [loadAutoApplied, onChoresChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const anyActive = inFlight.size > 0 || Object.values(runs).some(isActive);

  // Polls only while something is in flight. An idle queue costs nothing.
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const loadFindings = useCallback(async (workId: number) => {
    try {
      const r = await api.workFindings(workId);
      setFindings((f) => ({ ...f, [workId]: r.findings }));
    } catch {
      // A failed fetch of one row's history is not worth an error box.
    }
  }, []);

  /**
   * Ask for one book, exactly once.
   *
   * `startedRef` is the same guard the scan queue uses: a set of things already
   * asked for, consulted before asking. Without it the driver below re-fires in
   * the second between the POST returning and the run appearing in the polled
   * list, and buys the same answer twice.
   */
  const startedRef = useRef<Set<number>>(new Set());

  const start = useCallback(
    async (workId: number) => {
      startedRef.current.add(workId);
      setInFlight((s) => new Set(s).add(workId));
      try {
        const r = await api.runResearch(workId);
        setRuns((prev) => ({ ...prev, [workId]: r.run }));
        // ⚠️ Only expand when something is left to decide. The row used to open
        // every time because there was always something to read; now there
        // almost never is, and popping open an empty panel after each book
        // makes a 116-book sweep unreadable.
        if ((r.findings?.length ?? 0) > 0) setOpen((s) => new Set(s).add(workId));
        await loadFindings(workId);
        // The run just wrote to `work`, so both the undo list and the nav count
        // are now stale. Refreshed per book rather than at the end of the sweep,
        // so stopping halfway still leaves the page telling the truth.
        await loadAutoApplied();
        onChoresChanged();
      } catch (err) {
        setError(describeError(err));
        startedRef.current.delete(workId);
        // The request failed, but the lookup behind it may not have: the server
        // registers the work with `waitUntil` before answering, so a dropped
        // connection can still end in a finished run. Ask the table rather than
        // assuming, or the next press buys the same answer twice.
        void load();
      } finally {
        setInFlight((s) => {
          const next = new Set(s);
          next.delete(workId);
          return next;
        });
      }
    },
    [load, loadFindings, loadAutoApplied, onChoresChanged],
  );

  const works = data?.works ?? [];
  const shown: NeedsDetails[] = field
    ? works.filter((w) => (w.missing as string[]).includes(field))
    : works;

  /**
   * Work down the list, one book at a time.
   *
   * Driven by observed state rather than by a loop, so a run that outlives a
   * reload is not raced by a second one and "Stop" takes effect after the
   * current lookup instead of abandoning a call already paid for.
   */
  useEffect(() => {
    if (!running) return;
    if (stopping) {
      if (!anyActive) setRunning(false);
      return;
    }
    if (anyActive) return;
    const next = shown.find(
      (w) => !startedRef.current.has(w.workId) && runs[w.workId] === undefined,
    );
    if (!next) {
      setRunning(false);
      return;
    }
    void start(next.workId);
  }, [running, stopping, anyActive, shown, runs, start]);

  const canRun = me.capabilities.includes('runResearch');
  const canReview = me.capabilities.includes('reviewFindings');

  /**
   * Take back what the machine wrote.
   *
   * ⚠️ Chunked at ten, because the server refuses more in one call — each revert
   * costs several D1 subrequests and a Worker that exceeds its ceiling is
   * *terminated* rather than made to throw. Undoing a screenful therefore has to
   * be several requests, and they run one after another for the same reason the
   * server's loop does: two reverts against one book touch the same row.
   */
  const undo = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      setUndoing(true);
      setUndoSaid(null);
      const reverted: string[] = [];
      const skipped: string[] = [];
      try {
        for (let i = 0; i < ids.length; i += 10) {
          const r = await api.undoAutoApplied(ids.slice(i, i + 10));
          reverted.push(...r.reverted);
          skipped.push(...r.skipped);
        }
        setUndoSaid(
          `Took back ${reverted.length} ${reverted.length === 1 ? 'value' : 'values'}.` +
            (skipped.length > 0 ? ` ${skipped.length} could not be: ${skipped.join(' ')}` : ''),
        );
      } catch (err) {
        setUndoSaid(describeError(err));
      } finally {
        setUndoing(false);
        // The questions are open again, so the worklist, the tally and the nav
        // count are all wrong until this lands.
        await load();
      }
    },
    [load],
  );

  if (error && !data) {
    return <main className="notice notice--bad">Could not load the worklist: {error}</main>;
  }
  if (!data) return <main className="muted">Loading…</main>;

  const outstanding = shown.filter((w) => runs[w.workId] === undefined);

  return (
    <main>
      <h2 className="page-title">What is missing</h2>

      <p className="muted small">
        {/* Said plainly rather than left to be inferred from a long list. A page
            that quietly listed the whole catalog against every empty column
            would look like a bug rather than a worklist. */}
        Four questions are asked of every book, and only four. Everything else that is empty in
        this catalog is either an answer already, or a fact about a printing we do not own —
        see <em>what is not asked</em> below.
      </p>

      {/* ⚠️ The page says what it is about to do to the catalog, before it does
          it. A screen that used to ask permission and now writes without asking
          must not leave that change to be discovered. */}
      <p className="muted small">
        A lookup <strong>fills the answer in</strong> — it does not ask first. Everything it
        writes is listed under <em>Recently filled in</em> at the bottom, with an Undo beside
        it, and every one of the four fields can be edited on the book&apos;s own page.
      </p>

      {error && <p className="notice notice--bad">{error}</p>}

      <GapSummary summary={data.summary} field={field} />

      <section className="panel">
        <div className="stat-strip" role="group" aria-label="What research has cost">
          <Stat n={data.spent.runs} label={data.spent.runs === 1 ? 'lookup run' : 'lookups run'} />
          <Stat n={data.spent.inputTokens} label="tokens in" />
          <Stat n={data.spent.outputTokens} label="tokens out" />
          <Stat text={formatCents(data.spent.estimatedCents)} label="spent, estimated" />
          {data.spent.errors > 0 && <Stat n={data.spent.errors} label="failed" />}
        </div>
        <p className="muted small">
          {/* Every figure above comes from `research_run`, not from this tab —
              which is what makes it mean the same thing after a reload. */}
          Counted from the run log, so it survives a reload. {data.model} at low effort; the
          estimate is tokens only and does not include Anthropic's own charge for the web
          searches.
        </p>
      </section>

      {!data.configured && (
        <p className="notice notice--bad">
          No Anthropic API key is configured, so nothing can be looked up. Put{' '}
          <code>ANTHROPIC_API_KEY</code> in <code>apps/worker/.dev.vars</code> and run{' '}
          <code>npm run secrets:push</code>. Writing answers down by hand still works.
        </p>
      )}

      <div className="controls">
        {canRun && (
          <>
            <button
              className="primary"
              disabled={running || outstanding.length === 0 || !data.configured}
              onClick={() => {
                setError(null);
                setStopping(false);
                setRunning(true);
              }}
            >
              {running
                ? 'Working…'
                : outstanding.length === 0
                  ? shown.length === 0
                    ? 'Nothing to ask'
                    : 'Every one already asked'
                  : `Look up ${outstanding.length}`}
            </button>
            {running && !stopping && (
              <button onClick={() => setStopping(true)}>Stop after this one</button>
            )}
          </>
        )}
        <button onClick={() => void load()} disabled={running}>
          Refresh
        </button>
        {field && (
          <Link to={queuePath()} className="chip">
            Showing “{data.summary.find((s) => s.field === field)?.label ?? field}” — show all
          </Link>
        )}
        {outstanding.length > 0 && data.configured && (
          <span className="muted small">
            About {formatCents(outstanding.length * data.centsEach.low)}–
            {formatCents(outstanding.length * data.centsEach.high)} for the lot, one at a time.
          </span>
        )}
      </div>

      <ul className="works">
        {shown.map((w) => (
          <QueueRow
            key={w.workId}
            work={w}
            run={runs[w.workId]}
            pending={inFlight.has(w.workId)}
            findings={findings[w.workId]}
            expanded={open.has(w.workId)}
            busy={running}
            canRun={canRun && data.configured}
            canReview={canReview}
            onToggle={() => {
              setOpen((s) => {
                const next = new Set(s);
                if (next.has(w.workId)) next.delete(w.workId);
                else {
                  next.add(w.workId);
                  void loadFindings(w.workId);
                }
                return next;
              });
            }}
            onRun={() => void start(w.workId)}
            onChanged={() => {
              void loadFindings(w.workId);
              void load();
            }}
          />
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="muted">
          {field
            ? 'Nothing is waiting on that question.'
            : 'Every book has an answer to every question asked of it.'}
        </p>
      )}

      {shown.some((w) => runs[w.workId] != null) && (
        <p className="muted small">
          A book stays listed until you press Refresh, so you can read what its lookup filled in.
        </p>
      )}

      <AutoAppliedList
        rows={autoApplied}
        canReview={canReview}
        busy={undoing}
        said={undoSaid}
        onUndo={(ids) => void undo(ids)}
      />

      <details className="panel">
        <summary>What is not asked, and why</summary>
        <ul className="stack">
          {data.refused.map((r) => (
            <li key={r.field} className="muted small">
              <strong>{r.field}</strong> — {r.because}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}

const FIELD_LABEL: Record<string, string> = {
  firstPublished: 'first published',
  series: 'series',
  seriesIndex: 'volume number',
  description: 'description',
};

/**
 * What the machine wrote, and the way back.
 *
 * ⚠️ **This section is the reason auto-apply is allowed to exist.** The owner
 * traded reading each value beforehand for being able to spot a bad batch
 * afterwards; delete this and the trade is one-sided — the gate gone, no remedy.
 *
 * Newest first, and it shows the *value* rather than a count, because the whole
 * point is that a wrong one should be visible at a glance while scrolling past.
 * The batch button undoes what is on screen; the per-row button exists because
 * one wrong description among forty good ones is the ordinary case, not a
 * reason to throw the forty away.
 */
function AutoAppliedList({
  rows,
  canReview,
  busy,
  said,
  onUndo,
}: {
  rows: AutoApplied[];
  canReview: boolean;
  busy: boolean;
  said: string | null;
  onUndo: (ids: number[]) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <details className="panel" open>
      <summary>Recently filled in — {rows.length}</summary>
      <p className="muted small">
        Written by a lookup without being read first. Undo puts the value back to empty and the
        question back on the list; it never touches anything typed by hand.
      </p>

      {canReview && (
        <div className="controls">
          <button disabled={busy} onClick={() => onUndo(rows.map((r) => r.findingId))}>
            {busy ? 'Undoing…' : `Undo all ${rows.length}`}
          </button>
        </div>
      )}
      {said && <p className="muted small">{said}</p>}

      <ul className="stack">
        {rows.map((r) => (
          <li key={r.findingId} className="proposal">
            <div>
              <strong>
                <Link to={workPath(r.workId)}>{r.title}</Link>
              </strong>{' '}
              <span className="mark mark--relation">{FIELD_LABEL[r.field] ?? r.field}</span>
            </div>
            {/* A `none`/`unknown` wrote a verdict, not a value, and saying
                "(nothing to record)" is more honest than printing an empty box. */}
            <div className="proposal__value">
              {r.value.kind === 'found'
                ? String(r.value.value ?? '')
                : r.value.kind === 'none'
                  ? 'recorded as: this book has none'
                  : 'recorded as: nobody knows'}
            </div>
            <div className="muted small">
              {r.sourceTier}
              {r.sourceUrl && (
                <>
                  {' · '}
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {hostOf(r.sourceUrl)}
                  </a>
                </>
              )}
              {r.appliedAt ? ` · ${r.appliedAt}` : ''}
            </div>
            {canReview && (
              <div className="controls">
                <button disabled={busy} onClick={() => onUndo([r.findingId])}>
                  Undo
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The per-field tally — the part of this page that carries information.
 *
 * ⚠️ Four columns, and the second and third are the point. "13 missing" and
 * "13 already answered" are the same thirteen books and completely different
 * facts, and a queue that could not tell them apart would ask a model to
 * re-discover eleven standalones somebody researched by hand on 2026-08-10.
 */
function GapSummary({ summary, field }: { summary: FieldGapCount[]; field: string | null }) {
  return (
    <section className="panel">
      <table className="gap-summary">
        <thead>
          <tr>
            <th>Question</th>
            <th>To ask</th>
            <th>Answered</th>
            <th>Recorded</th>
            <th>N/A</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => {
            const answered = s.none + s.unknown;
            return (
              <tr key={s.field} className={field === s.field ? 'is-current' : undefined}>
                <th scope="row">
                  {s.missing > 0 ? (
                    <Link to={queuePath(s.field)}>{s.label}</Link>
                  ) : (
                    <span>{s.label}</span>
                  )}
                </th>
                <td>{s.missing > 0 ? <strong>{s.missing}</strong> : <span className="muted">0</span>}</td>
                <td>
                  {answered > 0 ? (
                    <span title={`${s.none} have no such thing, ${s.unknown} nobody knows`}>
                      {answered}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{s.filled > 0 ? s.filled : <span className="muted">—</span>}</td>
                <td>{s.notApplicable > 0 ? s.notApplicable : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        {/* The distinction the whole feature turns on, stated where the numbers
            are rather than in a doc nobody opens. */}
        <strong>Answered</strong> means somebody looked and wrote down what they found — “this
        is a standalone”, “nobody knows” — with a source. It is not the same as{' '}
        <strong>to ask</strong>, and keeping the two apart is what stops the catalog paying to
        rediscover work it has already done.
      </p>
    </section>
  );
}

/** One book, and whatever its lookup has to say for itself. */
function QueueRow({
  work,
  run,
  pending,
  findings,
  expanded,
  busy,
  canRun,
  canReview,
  onToggle,
  onRun,
  onChanged,
}: {
  work: NeedsDetails;
  run: RunView | undefined;
  /** This row's POST is still open. There is no run row to show yet. */
  pending: boolean;
  findings: ResearchFinding[] | undefined;
  expanded: boolean;
  busy: boolean;
  canRun: boolean;
  canReview: boolean;
  onToggle: () => void;
  onRun: () => void;
  onChanged: () => void;
}) {
  const active = pending || isActive(run);
  const failed = !pending && run?.status === 'error';
  // ⚠️ Still pending now means "the lookup could not use this", not "waiting to
  // be read" — a value that was not a usable year, or not a number. Auto-apply
  // closes everything else, so this is normally zero and is the one case a
  // person is still asked about. The count is the server's until the row is
  // opened, so a closed row can still say it has something stuck on it.
  const proposals = (findings ?? []).filter((f) => f.reviewState === 'pending');
  const stuck = findings === undefined ? work.pending : proposals.length;

  return (
    <li>
      <div className="row-open__text">
        <div className="row-open__head">
          <strong>
            <Link to={workPath(work.workId)}>{work.title}</Link>
          </strong>
          {work.series && <span className="series-tag">{work.series}</span>}
          {stuck > 0 && <span className="mark mark--gap">{stuck} could not be used</span>}
          {run?.status === 'done' && !active && (
            <span className="mark mark--attested">
              {run.applied > 0 ? `filled in ${run.applied}` : 'asked'}
            </span>
          )}
          {failed && <span className="mark mark--gap">failed</span>}
        </div>
        <div className="muted small">{work.authors}</div>
        <div className="muted small">missing: {work.missingLabels.join(', ')}</div>
        {work.answeredLabels.length > 0 && (
          <div className="muted small">
            {/* Shown, not hidden: a row that says "series: answered" is the page
                proving it is not about to re-ask a settled question. */}
            already answered: {work.answeredLabels.join(', ')}
          </div>
        )}

        {active && <div className="muted small">Looking it up on the web — 20 to 90 seconds…</div>}

        {run && !active && (
          <div className="muted small">
            {/* ⚠️ `run.detail` rather than a count assembled here. The server
                writes the sentence, and it says what was WRITTEN — not what was
                proposed. The two differ whenever a column filled in while the
                lookup was out, and the old "Proposed 3 answers" would now be
                describing work that may never have happened. */}
            {run.status === 'error'
              ? /* ⚠️ NEVER `run.errorMessage` raw. The Worker classifies at
                   store time now, but `error_message` is persisted: runs 5 and
                   6 on padhard's instance hold `400 {"type":"error",…,
                   "request_id":"req_…"}` and always will. `wordLookupError`
                   words those legacy rows through the same classifier, so the
                   screen cannot print a status, a body or a request id
                   whatever is in the column. See `@lc/core`. */
                wordLookupError(run.errorMessage)
              : run.proposed > 0
                ? `${run.detail ?? ''} · ${formatCents(run.estimatedCents)} · ${run.inputTokens ?? 0} in / ${run.outputTokens ?? 0} out`
                : (run.detail ?? 'Nothing to propose.')}
          </div>
        )}

        <div className="controls">
          <button onClick={onToggle}>
            {expanded ? 'Hide' : stuck > 0 ? `Sort out ${stuck}` : 'Say what you know'}
          </button>
          {canRun && !active && (
            <button onClick={onRun} disabled={busy}>
              {run ? 'Look again' : 'Look it up'}
            </button>
          )}
        </div>

        {expanded && (
          <div className="stack">
            {proposals.map((f) => (
              <Proposal key={f.id} finding={f} canReview={canReview} onChanged={onChanged} />
            ))}
            {proposals.length > 0 && (
              <p className="muted small">
                A lookup found these and could not write them — the value was not a usable
                year, number or piece of text. They are the only thing left to decide by hand.
              </p>
            )}
            {findings != null && proposals.length === 0 && (
              <p className="muted small">Nothing is stuck on this book.</p>
            )}
            {canReview && <VerdictForm work={work} onChanged={onChanged} />}
          </div>
        )}
      </div>
    </li>
  );
}

const KIND_LABEL: Record<string, string> = {
  found: 'found',
  none: 'there is none',
  unknown: 'nobody knows',
};

/**
 * One proposal, and the two buttons that decide it.
 *
 * ⚠️ The source, the tier and the basis are rendered *beside the value*, always,
 * and there is no score. That layout is the finding of `isbn-ladder.md` §4.4
 * turned into a component: on *Firefight* and again on *Unsouled*, the title and
 * the author matched perfectly and the publisher was the only thing that
 * differed. A person reading "the publisher's own page says…" can catch that; a
 * person reading "0.97" cannot.
 */
function Proposal({
  finding,
  canReview,
  onChanged,
}: {
  finding: ResearchFinding;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const decide = async (reviewState: 'accepted' | 'rejected') => {
    setBusy(true);
    try {
      const r = await api.reviewFinding(finding.id, reviewState);
      setOutcome(r.applied ?? r.skipped ?? (reviewState === 'rejected' ? 'Discarded.' : 'Done.'));
      onChanged();
    } catch (err) {
      setOutcome(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="proposal">
      <div>
        <strong>{finding.field}</strong>{' '}
        <span className="mark mark--relation">{KIND_LABEL[finding.value.kind] ?? finding.value.kind}</span>
      </div>
      {finding.value.kind === 'found' && <div className="proposal__value">{String(finding.value.value ?? '')}</div>}
      {finding.value.basis && <div className="muted small">{finding.value.basis}</div>}
      <div className="muted small">
        {finding.sourceTier}
        {finding.sourceUrl && (
          <>
            {' · '}
            <a href={finding.sourceUrl} target="_blank" rel="noreferrer noopener">
              {hostOf(finding.sourceUrl)}
            </a>
          </>
        )}
      </div>
      {outcome ? (
        <p className="muted small">{outcome}</p>
      ) : (
        canReview && (
          <div className="controls">
            <button className="primary" disabled={busy} onClick={() => void decide('accepted')}>
              Use it
            </button>
            <button disabled={busy} onClick={() => void decide('rejected')}>
              Not this
            </button>
          </div>
        )
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // A model can return something that is not a URL. Showing it raw beats
    // blanking the only provenance the finding has.
    return url;
  }
}

/**
 * Writing an answer down by hand: free, instant, and it demands a source.
 *
 * ⚠️ This is the route the eleven researched standalones justify. Somebody
 * already knows; making them pay a model to rediscover it would be absurd, and
 * leaving the gap open means paying for it on every future pass. The source box
 * is required by the server — `series-overrides.json` states the rule in as many
 * words: *an entry with no source is a bug, not a shortcut.*
 */
function VerdictForm({ work, onChanged }: { work: NeedsDetails; onChanged: () => void }) {
  const [picked, setPicked] = useState<DetailField | null>(null);
  const [verdict, setVerdict] = useState<'none' | 'unknown'>('none');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  /**
   * ⚠️ Derived, never held in state on its own — and this is a bug that shipped
   * for about four minutes before a browser caught it.
   *
   * The options are `work.missing`, and that list SHRINKS as answers land. With
   * the choice held in state, accepting the year left `picked` on
   * `firstPublished` while the select — no longer offering it — rendered
   * `description`. The form then showed one question and submitted a different
   * one, silently. A controlled `<select>` whose value is not among its options
   * does not correct itself, so nothing looked wrong until the wrong field came
   * back marked answered.
   *
   * Falling back to the first live option makes the rendered value and the
   * submitted value the same expression, so they cannot disagree.
   */
  const options = work.missing;
  const field: DetailField = picked && options.includes(picked) ? picked : (options[0] ?? 'series');

  const submit = async () => {
    setBusy(true);
    try {
      await api.setVerdict(work.workId, { field, verdict, source });
      setSaid('Written down. This question will not be asked again.');
      setSource('');
      onChanged();
    } catch (err) {
      setSaid(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <p className="muted small">
        Already know the answer? Write it down — free, and it stops this being asked again.
      </p>
      <div className="controls">
        <label className="field">
          <span className="field__label">Question</span>
          <select value={field} onChange={(e) => setPicked(e.target.value as DetailField)}>
            {options.map((f, i) => (
              <option key={f} value={f}>
                {work.missingLabels[i] ?? f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Answer</span>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as 'none' | 'unknown')}>
            <option value="none">There is none — this book has no such thing</option>
            <option value="unknown">Nobody knows — I looked</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">How do you know?</span>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="the publisher's page, the book itself, …"
          />
        </label>
        <button className="primary" disabled={busy || source.trim() === ''} onClick={() => void submit()}>
          Write it down
        </button>
      </div>
      {said && <p className="muted small">{said}</p>}
    </div>
  );
}

function Stat({ n, text, label }: { n?: number; text?: string; label: string }) {
  return (
    <div className="stat">
      <b>{text ?? (n ?? 0).toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}
