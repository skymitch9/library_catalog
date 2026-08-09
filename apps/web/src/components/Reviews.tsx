import { useEffect, useState } from 'react';
import { api, type Me } from '../api.js';
import { fetchReviews, writeReview, type Review } from '../lib/reviews.js';

/**
 * Reviews for one book — from both catalogs.
 *
 * ## ⚠️ The one thing this component must never do
 *
 * Show an audiobook review as if it were a review of the book on the shelf.
 *
 * An audiobook review is partly a review of a **narrator**. Porting the two
 * catalogs' reviews into one place is what the owner asked for, but presenting
 * them identically would make "5 stars" on a paperback mean something it never
 * said. So `source` is rendered, always, and the write path stamps it.
 */

const STARS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

function Stars({ rating }: { rating: number }) {
  // Ported from the audiobook site's `renderStars` so a rating looks the same in
  // both places — half stars included, since that is the scale both share.
  return (
    <span className="stars" aria-label={`Rating: ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) =>
        rating >= i ? (
          <span key={i} className="star full">★</span>
        ) : rating >= i - 0.5 ? (
          // The base glyph is the EMPTY star; CSS overlays a clipped filled one.
          <span key={i} className="star half">☆</span>
        ) : (
          <span key={i} className="star empty">☆</span>
        ),
      )}
    </span>
  );
}

export function Reviews({ workId, me }: { workId: number; me: Me }) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [rating, setRating] = useState<number>(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const keys = await api.reviewKeys(workId);
      const found = await fetchReviews(keys.collection, keys.workKey, keys.legacyBookId);
      setReviews(found);

      // Pre-fill with this person's existing review, so the form updates it
      // rather than looking like a blank slate they are about to duplicate.
      const mine = found.find(
        (r) => r.displayName.toLowerCase() === (me.reviewName ?? '').toLowerCase(),
      );
      if (mine) {
        setRating(mine.rating);
        setText(mine.text ?? '');
      }
    } catch (err) {
      // Firestore being unreachable must not take the page down — the book, its
      // editions and its copies are all in D1 and are still worth showing.
      setError(err instanceof Error ? err.message : String(err));
      setReviews([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  async function submit() {
    if (!rating) return;
    setBusy(true);
    setError(null);
    try {
      // The Worker derives the document id and the workKey; the browser does the
      // write, with this user's own credentials. See routes/reviews.ts for why
      // there is no service account anywhere in this project.
      const draft = await api.reviewDraft(workId, { rating, text });
      await writeReview(draft.collection, draft.docId, draft.doc);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canRate = me.capabilities.includes('trackReading');

  return (
    <section className="panel">
      <h3>Reviews</h3>

      {reviews === null ? (
        <p className="muted small">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="muted small">No reviews yet — on either site.</p>
      ) : (
        <ul className="reviews">
          {reviews
            .slice()
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map((r, i) => (
              <li key={`${r.displayName}-${i}`}>
                <div className="row-tight">
                  <strong>{r.displayName}</strong>
                  <Stars rating={r.rating} />
                  {/* Never optional. See the note at the top of this file. */}
                  <span className="muted small">
                    {r.source === 'audio'
                      ? 'audiobook'
                      : (r.editionLabel ?? 'this library')}
                  </span>
                </div>
                {r.text && <p className="small">{r.text}</p>}
              </li>
            ))}
        </ul>
      )}

      {canRate && (
        <>
          <div className="row-tight" role="group" aria-label="Your rating">
            {STARS.map((v) => (
              <button
                key={v}
                onClick={() => setRating(v)}
                className={rating === v ? 'primary chip' : 'chip'}
                aria-pressed={rating === v}
              >
                {v}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What did you think? (optional)"
            maxLength={1000}
            rows={3}
          />
          <p className="muted small">
            This is written to the same place as your audiobook reviews — it will show
            up on both sites.
          </p>
          <button className="primary" onClick={() => void submit()} disabled={busy || !rating}>
            {busy ? 'Saving…' : 'Save review'}
          </button>
        </>
      )}

      {error && <p className="muted small">Could not reach the review store: {error}</p>}
    </section>
  );
}
