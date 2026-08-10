import { useEffect, useState } from 'react';
import { api, type Stats } from '../api.js';

/**
 * Take the catalog away with you.
 *
 * `docs/HANDOFF.md` has named "D1 is the only copy of this data" as the standing
 * risk since the first deploy, and this screen is the whole answer to it.
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
      setError(err instanceof Error ? err.message : String(err));
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
            <p className="muted small">
              Every row of every table — books, aliases, editions, copies, read-state, series
              volumes and the links between books — with the list of applied migrations stamped on
              it so a restore knows which schema it is looking at. <strong>This is the one to
              keep</strong>, and the one worth taking before anything drastic.
            </p>
            <button className="primary" disabled={busy != null} onClick={() => void download('json')}>
              {busy === 'json' ? 'Building…' : 'Download JSON'}
            </button>
          </section>

          <section className="panel">
            <h3>Spreadsheet</h3>
            <p className="muted small">
              One row per book, with its formats, ISBNs, copies and your read-state flattened
              beside it. Opens in Excel, Numbers or Sheets. It is a{' '}
              <strong>flattened view, not the database</strong>: several editions collapse into one
              cell, so it is for sorting and totting up rather than for rebuilding from.
            </p>
            <button disabled={busy != null} onClick={() => void download('csv')}>
              {busy === 'csv' ? 'Building…' : 'Download CSV'}
            </button>
          </section>

          <p className="muted small">
            Both files are generated from the database when you press the button, so they are
            current as of that moment. Nothing is stored on the server and nothing is sent
            anywhere — the file goes straight to this device.
          </p>
        </>
      )}
    </main>
  );
}
