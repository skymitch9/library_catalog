import { useEffect, useState } from 'react';
import { isMyReview, reviewSourceOf } from '@lc/core';
import { api, type Me } from '../api.js';
import { describeError } from '../lib/errors.js';
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
 *
 * ## ⚠️ This component is also the bridge that marks books read
 *
 * *"if a book has a rating from the audiobook library mark it as read"*.
 *
 * That derivation has to start here and nowhere else, and it is worth knowing
 * why before moving it. The Worker cannot reach Firestore — there is no service
 * account in this project, deliberately — so this browser is the only thing in
 * the estate that sees both stores. `load()` already fetches every review of
 * this book from the shared collection; recognising the signed-in person's own
 * rating among them and reporting it back is the entire mechanism. Nothing else
 * has the two halves in one place.
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

export function Reviews({
  workId,
  me,
  onReadStateDerived,
}: {
  workId: number;
  me: Me;
  /**
   * A rating just marked this book read. The book page's own "Your reading"
   * panel is now stale and has to refetch.
   *
   * ⚠️ Only fired when the server reports something actually changed, which is
   * never on the second call for the same rating. That is what keeps this from
   * looping: a reload re-renders the parent, this component's effect does not
   * re-run (it is keyed on `workId`), and even if it did the second derivation
   * would report nothing and stop.
   */
  onReadStateDerived?: () => void;
}) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [rating, setRating] = useState<number>(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The server's held sentence for an authorless book — design §3.4 guard 2. */
  const [held, setHeld] = useState<string | null>(null);

  async function load() {
    try {
      const keys = await api.reviewKeys(workId);
      /*
       * ⚠️ Both keys are null for a book with no author recorded, and the
       * legacy query is the reason this panel must not improvise one: it is
       * title-only, so on an authorless book it could surface a STRANGER'S
       * reviews of a different book with the same name. The server said
       * "held"; render that and ask nothing.
       */
      if (keys.workKey === null || keys.legacyBookId === null) {
        setHeld(keys.held ?? 'Reviews are held until the author is known.');
        setReviews([]);
        return;
      }
      setHeld(null);
      const found = await fetchReviews(keys.collection, keys.workKey, keys.legacyBookId);
      setReviews(found);

      // Report what the fetch returned — the write side of the key-move
      // evidence floor (design §5.2). Fire-and-forget: the panel promised
      // nothing, and a failed report only leaves the floor where it was.
      api.reviewsSeen(workId, found.length).catch(() => undefined);

      // Pre-fill with this person's existing review, so the form updates it
      // rather than looking like a blank slate they are about to duplicate.
      //
      // ⚠️ `isMyReview` rather than the display-name comparison this used to
      // do, and it is not a tidy-up: it prefers `email` where the document has
      // one, which is the join `docs/info/identity-and-reviews.md` §2 settles
      // on, and falls back to the folded display name — the only key that
      // reaches the 860 reviews written on the audiobook site, which carry no
      // email at all. It is the ONE implementation, shared with the Worker and
      // `scripts/backfill-read-from-ratings.mjs`, because getting it loose would
      // mark this person's books read on a housemate's rating.
      const mine = found.find((r) => isMyReview(r, me));
      if (mine) {
        setRating(mine.rating);
        setText(mine.text ?? '');
        // A rating is evidence the book was read. Reported after the fact, from
        // what Firestore actually holds — see `api.reviewObserved`. Failing here
        // must not disturb the panel: the reviews rendered fine, and read state
        // is a derived nicety on top of them.
        try {
          const { marked } = await api.reviewObserved(workId, {
            rating: mine.rating,
            // ⚠️ `reviewSourceOf`, not `mine.source`. All 869 existing review
            // documents carry no `source` at all, and reading the field alone
            // would derive a read state with no format for every book in the
            // house — throwing away the most accurate thing this app knows,
            // for an owner who listens to far more than they read. The absence
            // of both `source` and `workKey` is itself proof the audiobook site
            // wrote it; the function carries the argument.
            source: reviewSourceOf(mine),
          });
          if (marked.length) onReadStateDerived?.();
        } catch {
          /* non-fatal, and deliberately silent — nothing was promised. */
        }
      }
    } catch (err) {
      // Firestore being unreachable must not take the page down — the book, its
      // editions and its copies are all in D1 and are still worth showing.
      setError(describeError(err));
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
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // Held books take no ratings either — a review written now would be stamped
  // with the provisional key and come loose the day the author arrives, which
  // is exactly what the server's 409 on /draft would say. Not offering the
  // form beats offering one that refuses.
  const canRate = me.capabilities.includes('trackReading') && held === null;

  // Dedup ONCE: one review per person — multiple audiobook editions (e.g.
  // dramatized parts) can produce duplicate reviews for the same person on the
  // same work. The score header and the list below both read this, so a review
  // is never counted twice in the average.
  const deduped = (reviews ?? [])
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .filter(
      (r, i, arr) =>
        arr.findIndex((x) => x.displayName.toLowerCase() === r.displayName.toLowerCase()) === i,
    );
  const ratingsCount = deduped.length;
  const writtenCount = deduped.filter((r) => (r.text ?? '').trim().length > 0).length;
  // ⚠️ Measured from the deduped reviews actually fetched — never asserted. One
  // decimal, matching the half-star scale both catalogs share.
  const average = ratingsCount
    ? Math.round((deduped.reduce((s, r) => s + r.rating, 0) / ratingsCount) * 10) / 10
    : 0;

  return (
    <section className="panel">
      <h3>Ratings &amp; reviews</h3>

      {held !== null ? (
        <p className="muted small">
          {held} Add it from the <em>Title &amp; author</em> panel in the editor — always safe on
          this book.
        </p>
      ) : reviews === null ? (
        <p className="muted small">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="muted small">No reviews yet — on either site.</p>
      ) : (
        <>
          {/* The hoisted rating header — the big Fraunces average, brass stars,
              and the counts a person comes to the page for (mockup `.rate-head`
              / `.score`). Real data, deduped one-per-person. */}
          <div className="bd-rate-head">
            <div className="bd-score">
              <span className="bd-score__num">{average.toFixed(1)}</span>
              <div>
                <Stars rating={average} />
                <span className="bd-score__of">
                  {ratingsCount} {ratingsCount === 1 ? 'rating' : 'ratings'}
                  {writtenCount > 0 &&
                    ` · ${writtenCount} written ${writtenCount === 1 ? 'review' : 'reviews'}`}
                </span>
              </div>
            </div>
          </div>
          <ul className="reviews">
          {deduped
            .map((r, i) => (
              <li key={`${r.displayName}-${i}`}>
                <div className="row-tight">
                  <strong>{r.displayName}</strong>
                  <Stars rating={r.rating} />
                  {/* Never optional. See the note at the top of this file.
                      ⚠️ `reviewSourceOf`, not `r.source` — and this was a live
                      defect, not a refactor. All 869 documents in the shared
                      collection carry no `source`, so reading the field alone
                      labelled every audiobook review "this library": the one
                      thing the note at the top of this file says must never
                      happen, on every review the collection currently holds. */}
                  <span className="muted small">
                    {reviewSourceOf(r) === 'audio'
                      ? 'audiobook'
                      : (r.editionLabel ?? 'this library')}
                  </span>
                </div>
                {r.text && <p className="small">{r.text}</p>}
              </li>
            ))}
          </ul>
        </>
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
