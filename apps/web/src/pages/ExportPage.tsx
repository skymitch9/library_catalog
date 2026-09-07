import { useEffect, useState } from 'react';
import { api, type Stats } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * Take the catalog away with you.
 *
 * `docs/info/decisions.md` §3 names "D1 is the only copy of this data" as the
 * standing risk, as it has been since the first deploy, and this screen is the
 * whole answer to it.
 *
 * ## Why a screen and not two links
 *
 * Because the two files are not interchangeable and something has to say so. The
 * sibling Board Game Catalog tucked its pair of anchors into the collection's
 * result count — beside "806 entries · 171 games" — where the one control that
 * protects you against losing everything read as a footnote about paging. One
 * entry in the top bar, and the choice of format made here. Two taps either way.
 *
 * ## ⚠️ Why these are buttons rather than `<a download>`
 *
 * The credential here is a Firebase Bearer token, not a cookie, so a plain
 * anchor arrives at the Worker with no Authorization header and 401s. It would
 * have worked perfectly in local development, where `middleware/auth.ts`'s dev
 * bypass answers without a token — see the note on `api.downloadExport`, which
 * fetches with the header and hands back a Blob.
 */

/** Save a Blob under a name, then let go of the object URL. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough for the navigation to have taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  async function download(format: 'json' | 'csv') {
    setBusy(format);
    setError(null);
    setSaved(null);
    try {
      const { blob, filename } = await api.downloadExport(format);
      saveBlob(blob, filename);
      setSaved(`${filename} — ${(blob.size / 1024).toFixed(0)} kB`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  // An export of nothing is a file that proves nothing. Say so rather than
  // handing over an empty spreadsheet.
  const empty = stats != null && stats.works === 0;

  return (
    <main>
      <h2>Export</h2>
      <p className="muted">
        {stats == null
          ? 'Counting what there is to take…'
          : empty
            ? 'Nothing in the catalog yet, so there is nothing to take away.'
            : `Everything, in one file — ${stats.works} books, ${stats.editions} editions and ${stats.copies} copies on the shelf, as of the moment you press the button.`}
      </p>

      {error && <p className="notice notice--bad small">{error}</p>}
      {saved && <p className="notice small">Saved {saved}</p>}

      {!empty && (
        <>
          <section className="panel">
            <h3>Backup</h3>
            {/* CUT 2026-09-07 (grey-paragraph audit item 102): the audit kept
                exactly ONE of this page's two panel notes — the CSV one below,
                which is the genuine trap. This panel is headed "Backup" and its
                button says "Download JSON"; the sentence added nothing that was
                not already on the screen. (It had already been trimmed once, on
                2026-08-17; the table inventory's home of record is
                migrations/0001_init.sql.) */}
            <button className="primary" disabled={busy != null} onClick={() => void download('json')}>
              {busy === 'json' ? 'Building…' : 'Download JSON'}
            </button>
          </section>

          <section className="panel">
            <h3>Spreadsheet</h3>
            {/* "flattened view, not the database" is an HONESTY MARKER and
                stays: it is the only thing stopping this file being used as a
                backup. Trimmed 2026-08-17 (owner's estate-wide trim) — the
                Excel/Numbers/Sheets line went, since a .csv download needs no
                introduction. */}
            <p className="muted small">
              One row per book — formats, ISBNs, copies and read-state flattened beside it. A{' '}
              <strong>flattened view, not the database</strong>: several editions collapse into
              one cell, so it is for sorting, not for rebuilding from.
            </p>
            <button disabled={busy != null} onClick={() => void download('csv')}>
              {busy === 'csv' ? 'Building…' : 'Download CSV'}
            </button>
          </section>

          {/* CUT 2026-09-07 (grey-paragraph audit item 104): privacy
              reassurance nobody asked for. The BEHAVIOUR is unchanged — the
              file is still built on the press and streamed straight to the
              device, with nothing stored server-side. */}
        </>
      )}
    </main>
  );
}
