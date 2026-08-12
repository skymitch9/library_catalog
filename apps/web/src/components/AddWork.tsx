import { useState } from 'react';
import type { PreorderAnswer } from '@lc/core';
import { api } from '../api.js';
import { PreorderPrompt } from './PreorderPrompt.js';
import { preorderQuestionFor, type PreorderQuestion } from '../lib/preorders.js';
import { arrivedPatch } from '../lib/statuses.js';

/**
 * Add a book by hand, or by scanning an ISBN.
 *
 * The scan path fills the form and stops. It does **not** save, and that is the
 * whole design: phase 0 measured that a wrong ISBN returns a confident,
 * well-formed, wrong book — three of ten ISBNs typed from memory resolved to
 * entirely different titles, with covers and page counts. Nothing in the
 * response marks them. A person looking at the filled form is the only check
 * that exists.
 *
 * ## ⚠️ "We have it" asks one question first, and only ever one
 *
 * Saying **have it** about a book that already has a `preordered` copy raises the
 * same prompt the scan review screen raises, from the same component — see
 * `PreorderPrompt.tsx`, and `@lc/core/preorders.ts` for why guessing is not an
 * option. A received pre-order is a PATCH of the copy already on file; a second
 * copy is a new row and leaves the pre-order on its way.
 *
 * ⚠️ **The match this needs is deliberately NOT general de-duplication.** It runs
 * only for `intent === 'owned'`, and its only output is whether to ask. This form
 * has always created a work per save — `POST /api/works` does not dedupe, on
 * purpose, and migration 0001 says why — and quietly changing that here would be a
 * much larger behaviour change riding in on a prompt. Answering **a different
 * copy** therefore does exactly what pressing Save did yesterday.
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
  /** Raised by Save, answered by the prompt, then handed back to `save`. */
  const [preorder, setPreorder] = useState<PreorderQuestion | null>(null);

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

  async function save(answer?: PreorderAnswer) {
    setBusy(true);
    setNote(null);
    try {
      /*
       * ⚠️ Ask before anything is written, exactly as `addLineToCatalog` does.
       *
       * Only `owned` can be a pre-order arriving: `wanted` is a wish about a book
       * that is already bought — a legitimate thing to record and never an
       * arrival — and the empty intent writes no copy at all. Matching for the
       * other two would spend a request to answer a question nobody asked.
       */
      if (intent === 'owned' && !answer) {
        const match = await api.matchWork(title.trim(), authors.trim());
        const question = match.work
          ? await preorderQuestionFor(match.work.id, match.work.title)
          : null;
        if (question) {
          setPreorder(question);
          return;
        }
      }

      /*
       * The pre-order arriving is the one path that creates **no work and no
       * second copy**: the book is already in the catalog — that is how it came
       * to have a pre-order — and the whole point of the answer is that this
       * object is the one already recorded. Creating a work here would leave a
       * duplicate row behind the correction.
       */
      if (answer?.kind === 'arrived') {
        await api.updateCopy(answer.copyId, arrivedPatch(answer.acquiredOn));
        onAdded();
        return;
      }

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

      {/* ⚠️ Editing any of the three fields the question was asked about drops
          it. A prompt naming one book, answered after somebody retyped the form
          into a different one, would flip a pre-order that has nothing to do
          with what is on screen. Same rule as `unresolve` on a scan line: a new
          question invalidates the old answer. */}
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setPreorder(null);
        }}
        placeholder="Title"
      />
      <input
        value={authors}
        onChange={(e) => {
          setAuthors(e.target.value);
          setPreorder(null);
        }}
        placeholder="Author(s), as printed"
      />
      <input
        value={series}
        onChange={(e) => setSeries(e.target.value)}
        placeholder="Series (optional)"
      />

      <label className="field">
        <span className="field__label">And we…</span>
        <select
          value={intent}
          onChange={(e) => {
            setIntent(e.target.value as '' | 'owned' | 'wanted');
            setPreorder(null);
          }}
        >
          <option value="">just catalogue it — record no copy</option>
          <option value="owned">have it</option>
          <option value="wanted">want it — put it on the wishlist</option>
        </select>
      </label>

      {note && <p className="muted small">{note}</p>}

      {/* Nothing has been written when this appears, so Cancel below is still a
          complete way out — which is why the prompt itself offers no third
          answer. See `PreorderPrompt.tsx`. */}
      {preorder && (
        <PreorderPrompt question={preorder} busy={busy} onAnswer={(a) => void save(a)} />
      )}

      <div className="row">
        <button
          className="primary"
          onClick={() => void save()}
          disabled={busy || !title || !authors || preorder !== null}
        >
          Save
        </button>
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
