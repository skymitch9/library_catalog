import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type DetailField,
  type FieldGapCount,
  type Me,
  type NeedsDetails,
  type QueueResponse,
  type ResearchFinding,
  type RunView,
} from '../api.js';
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
 * ## Nothing here writes to the catalog on its own
 *
 * A lookup produces *proposals*. Each one shows its value, the page it came
 * from and what that page says, and a person presses Use. There is deliberately
 * **no confidence score** anywhere on this page: `docs/info/isbn-ladder.md` §4.4
 * records a wrong answer scoring 1.00 on title and 1.00 on author — twice, in
 * two different series — and only the publisher gave it away. A number invites
 * ranking and thresholding; the source and the sentence invite reading.
 */

/** Slow enough not to be a nuisance, quick enough that a run feels live. */
const POLL_MS = 3000;

const isActive = (run: RunView | undefined): boolean =>
  run != null && (run.status === 'queued' || run.status === 'running');

function formatCents(cents: number): string {
  if (cents <= 0) return '0¢';
  return cents < 100 ? `${cents < 1 ? cents.toFixed(2) : Math.round(cents)}¢` : `$${(cents / 100).toFixed(2)}`;
}

export function DetailsQueuePage({ me, field }: { me: Me; field: string | null }) {
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

  const load = useCallback(async () => {
    try {
      const next = await api.queue();
      setData(next);
      const byWork: Record<number, RunView> = {};
      for (const run of next.runs) byWork[run.workId] = run;
      setRuns(byWork);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
        setOpen((s) => new Set(s).add(workId));
        await loadFindings(workId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
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
    [load, loadFindings],
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
          A book stays listed until you press Refresh, so you can read what its lookup found.
        </p>
      )}

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
  // The fetched list once the row is open; the server's count until then, so a
  // closed row can still say how many decisions are waiting on it.
  const proposals = (findings ?? []).filter((f) => f.reviewState === 'pending');
  const waiting = findings === undefined ? work.pending : proposals.length;

  return (
    <li>
      <div className="row-open__text">
        <div className="row-open__head">
          <strong>
            <Link to={workPath(work.workId)}>{work.title}</Link>
          </strong>
          {work.series && <span className="series-tag">{work.series}</span>}
          {waiting > 0 && <span className="mark mark--gap">{waiting} to decide</span>}
          {run?.status === 'done' && !active && <span className="mark mark--attested">asked</span>}
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
            {run.status === 'error'
              ? (run.errorMessage ?? 'The lookup failed.')
              : run.proposed > 0
                ? `Proposed ${run.proposed} ${run.proposed === 1 ? 'answer' : 'answers'} · ${formatCents(run.estimatedCents)} · ${run.inputTokens ?? 0} in / ${run.outputTokens ?? 0} out`
                : (run.detail ?? 'Nothing to propose.')}
          </div>
        )}

        <div className="controls">
          <button onClick={onToggle}>
            {expanded ? 'Hide' : waiting > 0 ? `Review ${waiting}` : 'Say what you know'}
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
            {findings != null && proposals.length === 0 && (
              <p className="muted small">Nothing waiting on a decision for this book.</p>
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
      setOutcome(err instanceof Error ? err.message : String(err));
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
      setSaid(err instanceof Error ? err.message : String(err));
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
