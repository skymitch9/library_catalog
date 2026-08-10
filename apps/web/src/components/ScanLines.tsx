import { useState } from 'react';
import { MIN_SPINE_SIMILARITY, outstandingCount, type ScanJob, type ScanLine } from '@lc/core';
import { api } from '../api.js';
import { addLineToCatalog } from '../lib/catalog-add.js';
import { Link, workPath } from '../router.js';

/**
 * The review list — one row per book a sweep found, and the only place a book
 * gets into the catalog from a scan.
 *
 * ## ⚠️ Every row is a proposal, and the row says which kind
 *
 * A barcode row and a spine row look almost the same and are worth very
 * different amounts of trust, so the difference is on the row rather than in a
 * heading: a barcode carries its ISBN, a spine carries what was printed on it
 * plus how sure the read was. Phase 0 measured a wrong ISBN resolving to a
 * confident, well-formed, wrong book — three of ten — and a spine is weaker
 * evidence than an ISBN. Nothing here is ticked in advance and nothing is
 * added without a tap.
 *
 * ## ⚠️ A weak match is shown, not hidden
 *
 * Below `MIN_SPINE_SIMILARITY` the row is marked "loose match" and still
 * offered. Dropping it would be tidier and worse: the book is visibly on the
 * shelf, and a false negative costs a tap while a false positive costs a wrong
 * book in the catalog wearing someone else's cover.
 */

function Similarity({ line }: { line: ScanLine }) {
  if (line.similarity === null) return null;
  const loose = line.similarity < MIN_SPINE_SIMILARITY;
  return (
    <span className={loose ? 'mark mark--gap' : 'mark'} style={{ position: 'static' }}>
      {loose ? 'loose match' : 'close match'} {line.similarity.toFixed(2)}
    </span>
  );
}

function LineRow({
  line,
  index,
  jobId,
  onJob,
}: {
  line: ScanLine;
  index: number;
  jobId: number;
  onJob: (job: ScanJob) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const [draftAuthor, setDraftAuthor] = useState(line.author ?? '');

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const add = () =>
    run('add', async () => {
      const { workId } = await addLineToCatalog(line);
      // Recorded on the line only after the catalog write succeeded. The other
      // order would mark a book added that is not in the catalog.
      onJob((await api.patchScanLine(jobId, index, { addedWorkId: workId })).job);
    });

  const lookup = (q?: string) =>
    run('lookup', async () => {
      onJob((await api.lookupScanLine(jobId, index, q)).job);
      setEditing(false);
    });

  const dismiss = () =>
    run('dismiss', async () => {
      onJob((await api.patchScanLine(jobId, index, { dismissed: !line.dismissed })).job);
    });

  const saveEdit = () =>
    run('edit', async () => {
      const patched = await api.patchScanLine(jobId, index, {
        text: draft.trim(),
        author: draftAuthor.trim() || null,
      });
      onJob(patched.job);
      // Correcting the read is only ever the first half of the intent — the
      // reason to retype a spine is to ask again with the right words.
      onJob((await api.lookupScanLine(jobId, index, draft.trim())).job);
      setEditing(false);
    });

  const settled = line.addedWorkId !== null || line.dismissed;

  return (
    <li className={settled ? 'muted' : undefined}>
      {line.coverUrl ? (
        <img src={line.coverUrl} alt="" width={44} height={66} loading="lazy" />
      ) : (
        <span className="scan-line__blank" aria-hidden="true" />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* What the sweep actually read. Kept visible even after a lookup
            succeeded: "the spine said X, the database says Y" is the whole
            judgement being asked for, and hiding half of it makes the row
            impossible to check. */}
        <div className="muted small">
          #{line.position} · {line.via === 'barcode' ? line.code : `“${line.text}”`}
          {line.author ? ` · ${line.author}` : ''}
          {line.confidence ? ` · ${line.confidence} confidence` : ''}
        </div>

        {line.state === 'owned' && (
          <>
            <strong>Already yours{line.existingTitle ? `: ${line.existingTitle}` : ''}</strong>
            {line.existingWorkId !== null && (
              <div className="small">
                <Link to={workPath(line.existingWorkId)}>Open it</Link>
              </div>
            )}
          </>
        )}

        {line.state === 'found' && (
          <>
            <strong>{line.resolvedTitle}</strong>
            <div className="muted small">{line.resolvedAuthors}</div>
            <div className="muted small">
              {[line.publisher, line.publishedYear, line.isbn13].filter(Boolean).join(' · ')}
            </div>
            <div className="row-tight">
              <Similarity line={line} />
              {line.relookedUpAs && (
                <span className="muted small">asked as “{line.relookedUpAs}”</span>
              )}
            </div>
          </>
        )}

        {line.state !== 'owned' && line.state !== 'found' && (
          <strong>{line.via === 'spine' ? line.text : line.code}</strong>
        )}

        {line.detail && <div className="muted small">{line.detail}</div>}
        {line.note && <div className="muted small">Read: {line.note}</div>}
        {error && <div className="muted small">{error}</div>}

        {editing && (
          <div className="row" style={{ marginTop: '0.4rem' }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Title as printed"
              placeholder="Title"
            />
            <input
              value={draftAuthor}
              onChange={(e) => setDraftAuthor(e.target.value)}
              aria-label="Author as printed"
              placeholder="Author"
            />
            <button onClick={() => void saveEdit()} disabled={busy !== null || !draft.trim()}>
              {busy === 'edit' ? 'Asking…' : 'Save and look up'}
            </button>
          </div>
        )}
      </div>

      <div className="row-tight" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {line.addedWorkId !== null ? (
          <Link to={workPath(line.addedWorkId)} className="chip">
            Added
          </Link>
        ) : (
          <>
            {/* A spine that resolved to nothing can still be looked up — that is
                the point of the button. A barcode cannot: its ladder has
                already run, and re-running it asks the same question. */}
            {line.via === 'spine' && !line.dismissed && (
              <button onClick={() => void lookup()} disabled={busy !== null}>
                {busy === 'lookup' ? 'Looking…' : line.state === 'found' ? 'Again' : 'Look up'}
              </button>
            )}
            {line.via === 'spine' && !line.dismissed && (
              <button onClick={() => setEditing((v) => !v)} disabled={busy !== null}>
                {editing ? 'Cancel' : 'Edit'}
              </button>
            )}
            {line.state === 'found' && !line.dismissed && (
              <button className="primary" onClick={() => void add()} disabled={busy !== null}>
                {busy === 'add' ? 'Adding…' : 'Add'}
              </button>
            )}
            {line.state !== 'owned' && line.state !== 'skipped' && (
              <button onClick={() => void dismiss()} disabled={busy !== null}>
                {line.dismissed ? 'Undo' : 'Not wanted'}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function ScanLines({
  job,
  onJob,
  empty,
}: {
  job: ScanJob;
  onJob: (job: ScanJob) => void;
  /** What to say when the sweep has found nothing yet. Differs per tab. */
  empty: string;
}) {
  if (job.lines.length === 0) return <p className="muted small">{empty}</p>;

  const left = outstandingCount(job.lines);

  return (
    <>
      <p className="muted small">
        {job.lines.length} {job.lines.length === 1 ? 'book' : 'books'} ·{' '}
        {left === 0 ? 'all sorted' : `${left} still to sort`}
      </p>
      <ul className="works scan-lines">
        {job.lines.map((line, i) => (
          <LineRow
            key={`${line.via}-${line.code ?? line.text}-${i}`}
            line={line}
            index={i}
            jobId={job.id}
            onJob={onJob}
          />
        ))}
      </ul>
    </>
  );
}
