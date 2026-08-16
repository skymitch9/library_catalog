import { useCallback, useEffect, useState } from 'react';
import { jobSummary, type ScanJob } from '@lc/core';
import { api } from '../api.js';
import { describeError } from '../lib/errors.js';
import { Link, addPath, navigate } from '../router.js';

/**
 * The sweeps you walked away from.
 *
 * This page is the visible half of scan-job persistence, and it only earns its
 * place because the invisible half exists: results used to live in React state,
 * so there was never anything to come back to. Now a locked phone, a closed
 * tab, or a "I'll finish this after dinner" all end in the same place — a row
 * here, with every line still on it.
 *
 * ⚠️ Finished sweeps are **not** listed. The row is kept in the database — it
 * is the only record of which photograph produced which books, and of what a
 * shelf read cost — but a queue whose job is to say "you left three of these
 * half done" stops being able to say it once everything ever swept is on it.
 */
export function ScanJobsPage({ canSpend }: { canSpend: boolean }) {
  const [jobs, setJobs] = useState<ScanJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs((await api.scanJobs(true)).jobs);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function drop(id: number) {
    try {
      await api.deleteScanJob(id);
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function close(id: number) {
    try {
      await api.finishScanJob(id);
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <main>
      <div className="row-tight">
        <Link to="/" className="chip">
          ← Collection
        </Link>
        <Link to={addPath('scan')} className="chip">
          Start a new sweep
        </Link>
      </div>
      <h2 className="page-title">Unfinished sweeps</h2>

      {error && <p className="notice notice--bad">{error}</p>}

      {jobs === null ? (
        <p className="muted small">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="muted">
          Nothing half-finished. Scan a stack of barcodes
          {canSpend ? ', or photograph a shelf,' : ''} and whatever you do not sort now
          waits here.
        </p>
      ) : (
        <ul className="works">
          {jobs.map((job) => (
            <li key={job.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>
                  {job.mode === 'shelf' ? 'Shelf photo' : 'Barcode sweep'} #{job.id}
                </strong>
                <div className="muted small">
                  {jobSummary(job)} · {job.createdAt}
                </div>
                {job.status === 'failed' && (
                  <div className="muted small">Failed: {job.error ?? 'no reason recorded'}</div>
                )}
              </div>
              <div className="row-tight">
                <button
                  className="primary"
                  onClick={() =>
                    navigate(addPath(job.mode === 'shelf' ? 'photo' : 'scan', job.id))
                  }
                >
                  Open
                </button>
                <button onClick={() => void close(job.id)}>Finish</button>
                {/* Deleting throws away the reading, including one that was
                    paid for — so it sits behind the two safer buttons rather
                    than beside them, and it is only ever offered here. */}
                <button onClick={() => void drop(job.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
