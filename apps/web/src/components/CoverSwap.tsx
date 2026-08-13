import { useEffect, useState } from 'react';
import { api, type CoverCandidateView } from '../api.js';

/**
 * Swap between the covers this book is already known to have.
 *
 * Ported as an *idea* from the board game catalog's CoverPicker: a book has
 * several plausible covers — its editions' own, the ones it wore before, an
 * Open Library guess — and until now there was no way to see them side by
 * side and pick the one that matches the object on the shelf.
 *
 * ## Why swapping is cheap, and why the UI says so
 *
 * Uploaded covers are stored under a name derived from the image bytes
 * (`coverObjectKey`), and removing or replacing a cover never deletes the
 * object. So every cover this book ever wore is still sitting at its own
 * immutable URL, and swapping back is re-pointing a column — not finding,
 * re-downloading or re-uploading anything. The line under the grid exists so
 * a person can trust the button with that fact rather than take it on faith.
 *
 * ## Unlike the board game picker, a pick here writes immediately
 *
 * Their picker feeds a form whose Save owns the write; this panel's
 * neighbours (Replace / Remove / stand-in) all write on press, and a picker
 * that behaved differently from the buttons beside it would be the odd one
 * out. The two-step (tap to choose, then a labelled Apply) is the guard
 * against a stray tap on a phone. The write goes through the SAME verified
 * PUT as a pasted link — the Worker fetches the image before the column
 * moves, so a candidate that stopped serving is refused, never stored.
 */
export function CoverSwap({
  workId,
  onChanged,
}: {
  workId: number;
  onChanged: () => void;
}) {
  const [candidates, setCandidates] = useState<CoverCandidateView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  /** Recorded candidates whose <img> failed here, shown as dead rather than blank. */
  const [broken, setBroken] = useState<Set<string>>(new Set());

  useEffect(() => {
    let stale = false;
    api
      .coverCandidates(workId)
      .then((r) => {
        if (!stale) setCandidates(r.candidates);
      })
      .catch((err: unknown) => {
        if (!stale) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      stale = true;
    };
  }, [workId]);

  if (error) return <p className="muted small">Could not load the known covers: {error}</p>;
  if (!candidates) return <p className="muted small">Looking for covers this book could wear…</p>;

  // ⚠️ A guess whose image failed is hidden — it was never a fact, and a grid
  // of broken guesses would read as a broken app. A RECORDED candidate that
  // fails stays visible as "no longer loads", because that is a fact about
  // the catalog worth a person's eyes.
  const visible = candidates.filter((c) => !(c.derived && broken.has(c.url)));
  const current = candidates.find((c) => c.selected)?.url ?? null;
  const pick = chosen ?? current;

  async function apply() {
    if (!pick || pick === current) return;
    setBusy(true);
    setSaid(null);
    try {
      // The verified PUT: the Worker fetches the URL and refuses anything
      // that does not serve a real image. 'ok' because a person choosing
      // from a side-by-side grid has assessed it — same reasoning as upload.
      await api.setCover(workId, { url: pick, status: 'ok' });
      setSaid('Cover swapped.');
      setChosen(null);
      onChanged();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (visible.length === 0) {
    return (
      <p className="muted small">
        No covers are known for this book — no printing carries one, it has worn no other, and
        Open Library has nothing to guess from. Paste a link or upload a file instead.
      </p>
    );
  }

  return (
    <div className="stack">
      {visible.length === 1 && (
        <p className="muted small">
          Only one cover is known for this book, so there is nothing to swap between yet.
        </p>
      )}

      <ul className="cover-swap">
        {visible.map((c) => {
          const dead = !c.derived && broken.has(c.url);
          return (
            <li key={c.url}>
              <button
                type="button"
                className={`cover-swap__card${pick === c.url ? ' cover-swap__card--chosen' : ''}`}
                aria-pressed={pick === c.url}
                disabled={busy}
                onClick={() => setChosen(c.url)}
              >
                <span className="cover-swap__frame">
                  {dead ? (
                    <span className="cover-swap__dead">Image no longer loads</span>
                  ) : (
                    <img
                      src={c.url}
                      alt=""
                      loading="lazy"
                      onError={() => setBroken((prev) => new Set(prev).add(c.url))}
                    />
                  )}
                </span>
                <span className="cover-swap__label">
                  {c.label}
                  {c.selected && <b> · in use</b>}
                  {c.derived && <span className="muted"> · guess</span>}
                </span>
                {c.caption && <span className="cover-swap__caption">{c.caption}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {visible.length > 1 && (
        <>
          <div className="row-tight">
            <button
              className="primary"
              disabled={busy || !pick || pick === current}
              onClick={() => void apply()}
            >
              {busy ? 'Checking…' : 'Use this cover'}
            </button>
          </div>
          <p className="muted small">
            Nothing is lost by swapping: covers this app hosts are stored under a name derived
            from the image itself and are never deleted, so every cover here stays available and
            swapping back is just re-pointing. The picked image is fetched and checked before
            anything is saved.
          </p>
        </>
      )}

      {said && <p className="muted small">{said}</p>}
    </div>
  );
}
