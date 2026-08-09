import { useState } from 'react';
import { api } from '../api.js';

/**
 * Offer what Open Library knows, and let a person choose.
 *
 * ## ⚠️ Why the similarity score is shown, not hidden
 *
 * Because the failure mode here is a *plausible* wrong answer, not an obviously
 * wrong one. Open Library returns a different 2001 novel called Firefight when
 * asked for Brandon Sanderson's. The title and the author both look right at a
 * glance; only the year gives it away. Showing how well each candidate actually
 * matched — and the year and publisher beside it — is what turns "looks right"
 * into a decision someone can make.
 *
 * Nothing is applied until Use is pressed, and only the fields that are
 * currently empty are filled. A cover you chose by hand is never replaced by a
 * lookup.
 */
export function Enrich({
  workId,
  hasCover,
  onApplied,
}: {
  workId: number;
  hasCover: boolean;
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<
    Awaited<ReturnType<typeof api.enrichCandidates>>['candidates'] | null
  >(null);

  async function look() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.enrichCandidates(workId);
      setCandidates(res.candidates);
      setNote(res.note);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function use(c: NonNullable<typeof candidates>[number]) {
    setBusy(true);
    try {
      await api.updateWork(workId, {
        // Only fill what is empty. `firstPublished` and `openlibraryWorkId` are
        // safe to set; the title and authors are NOT touched, because those are
        // what the match was made on and overwriting them with a candidate's
        // spelling would move `work_key` and orphan the book's reviews.
        ...(hasCover ? {} : { coverUrl: c.coverUrl }),
        ...(c.publishedYear ? { firstPublished: c.publishedYear } : {}),
        ...(c.openlibraryWorkId ? { openlibraryWorkId: c.openlibraryWorkId } : {}),
      });
      setCandidates(null);
      onApplied();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Open Library</h3>
      {candidates === null ? (
        <button onClick={() => void look()} disabled={busy}>
          {busy ? 'Looking…' : 'Look this book up'}
        </button>
      ) : candidates.length === 0 ? (
        <p className="muted small">{note}</p>
      ) : (
        <ul className="plain">
          {candidates.map((c, i) => (
            <li key={i}>
              <div className="row-tight">
                {c.coverUrl && <img src={c.coverUrl} alt="" width={30} height={45} />}
                <div style={{ flex: 1 }}>
                  <strong>{c.title}</strong>
                  <div className="muted small">{c.authors}</div>
                  <div className="muted small">
                    {[c.publisher, c.publishedYear].filter(Boolean).join(' · ')}
                    {' · '}
                    {/* The number that separates "looks right" from "is right". */}
                    title {Math.round(c.similarity * 100)}% · author{' '}
                    {Math.round(c.authorSimilarity * 100)}%
                  </div>
                </div>
                <button onClick={() => void use(c)} disabled={busy}>
                  Use
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && candidates && candidates.length > 0 && <p className="muted small">{note}</p>}
    </section>
  );
}
