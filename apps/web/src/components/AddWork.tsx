import { useState } from 'react';
import { api } from '../api.js';

/**
 * Add a book by hand, or by scanning an ISBN.
 *
 * The scan path fills the form and stops. It does **not** save, and that is the
 * whole design: phase 0 measured that a wrong ISBN returns a confident,
 * well-formed, wrong book — three of ten ISBNs typed from memory resolved to
 * entirely different titles, with covers and page counts. Nothing in the
 * response marks them. A person looking at the filled form is the only check
 * that exists.
 */
export function AddWork({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [series, setSeries] = useState('');
  const [isbn, setIsbn] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /**
   * What this book *is* to us, which the catalog previously had no way to say.
   *
   * ⚠️ `''` — catalogue it and record nothing — is the default and stays the
   * default. Every one of the 117 existing rows is exactly that: a book we know
   * about, with no `copy` row of any status. Making "owned" the default would
   * silently assert a shelf position for every future hand-added row and make
   * the wanted/owned distinction meaningless the first time somebody forgot.
   */
  const [intent, setIntent] = useState<'' | 'owned' | 'wanted'>('');

  async function lookup() {
    if (!isbn.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = (await api.scan(isbn.trim())) as {
        result: string;
        reason?: string;
        candidates?: { title: string; authors: string; publisher: string | null }[];
      };

      if (res.result === 'ignore') {
        // The price add-on and the retail UPC both land here. Saying so is more
        // useful than "not found", because the fix is "scan the other barcode".
        setNote(
          res.reason === 'price_addon'
            ? 'That is the price code beside the barcode — scan the longer one.'
            : 'That is not a book barcode. Look for the one starting 978 or 979.',
        );
        return;
      }
      if (res.result === 'owned') {
        setNote('You already own this one.');
        return;
      }
      const first = res.candidates?.[0];
      if (!first) {
        setNote('Nothing found for that ISBN. Type it in by hand — about half of this library is not in Open Library.');
        return;
      }
      setTitle(first.title);
      setAuthors(first.authors);
      setNote(`Found: ${first.title}${first.publisher ? ` (${first.publisher})` : ''}. Check it before saving.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const { work } = await api.createWork({
        title: title.trim(),
        authors: authors.trim(),
        series: series.trim() || null,
      });
      // No edition is created here. A copy with no `edition_id` is exactly what
      // migration 0001 made nullable for — the book is known, the printing is
      // not, and inventing a paperback edition to hang the copy off would put a
      // printing in the catalog that nobody has seen.
      if (intent) await api.createCopy({ workId: work.id, status: intent });
      onAdded();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row">
        <input
          value={isbn}
          onChange={(e) => setIsbn(e.target.value)}
          placeholder="ISBN (978… or 979…)"
          inputMode="numeric"
        />
        <button onClick={() => void lookup()} disabled={busy}>
          Look up
        </button>
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <input
        value={authors}
        onChange={(e) => setAuthors(e.target.value)}
        placeholder="Author(s), as printed"
      />
      <input
        value={series}
        onChange={(e) => setSeries(e.target.value)}
        placeholder="Series (optional)"
      />

      <label className="field">
        <span className="field__label">And we…</span>
        <select value={intent} onChange={(e) => setIntent(e.target.value as '' | 'owned' | 'wanted')}>
          <option value="">just catalogue it — record no copy</option>
          <option value="owned">have it</option>
          <option value="wanted">want it — put it on the wishlist</option>
        </select>
      </label>

      {note && <p className="muted small">{note}</p>}

      <div className="row">
        <button className="primary" onClick={() => void save()} disabled={busy || !title || !authors}>
          Save
        </button>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
