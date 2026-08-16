import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type WishlistRow } from '../api.js';
import { describeError } from '../lib/errors.js';
import { Arrivals } from '../components/Arrivals.js';
import { Cover } from '../components/Cover.js';
import { formatLabel } from '../lib/formats.js';
import { ON_THE_WAY, arrivedPatch, statusLabel } from '../lib/statuses.js';

/**
 * Books we have said we want and do not have.
 *
 * ## Why this is a list of copies and not a list of books
 *
 * `copy.status` has allowed `'wanted'` since migration 0001 and **nothing in
 * this app has ever written or read it** — the column was unreachable. The
 * obvious way to reach it is a filter on the collection, and it is the wrong
 * one: the collection lists *works*, so "we have the EPUB and want the
 * hardcover" would show a book that is already in the collection and say
 * nothing about the wish. A wish is a fact about a copy.
 *
 * That distinction is about to matter rather than being theoretical. This
 * catalog is 117 works and 118 editions, **all of them ebooks**, and physical
 * books are being added shortly. Nearly every early wish will be a physical
 * copy of something already held as a file.
 *
 * ## Promotion is a PATCH
 *
 * Buying the book changes the row's status; it does not replace the row. The
 * wish records when it was wanted, from whom, and for how much, and a
 * delete-and-recreate throws all of that away — see `updateCopy` in `@lc/db`.
 */
export function WishlistPage({
  me,
  onOpen,
}: {
  me: Me;
  onOpen: (workId: number) => void;
}) {
  const [rows, setRows] = useState<WishlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  /**
   * What a batch arrival did — said on the page, never inside the panel.
   *
   * ⚠️ Both outcomes live here, and the failure one is the reason why. The panel
   * renders nothing once no copies are on the way, so a note it owned would be
   * destroyed by the very reload that follows a batch. Measured: with five of six
   * saved and the sixth deleted underneath, the panel unmounted and the warning
   * went with it — the one case where saying nothing is worst.
   */
  const [note, setNote] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  // `manageWishlist`, not `editCatalog` — these buttons (arrived/pre-ordered/
  // off-the-list) PATCH or DELETE an existing wishlist copy, which is exactly
  // what the 2026-08-16 wishlist split names `manageWishlist` (contributor+).
  // Asking for a NEW book ("Want this", elsewhere) is the looser
  // `suggestWishlist` (member+) and does not gate anything on this page.
  const canEdit = me.capabilities.includes('manageWishlist');

  const load = useCallback(() => {
    setError(null);
    api
      .wishlist()
      .then((r) => setRows(r.rows))
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  useEffect(load, [load]);

  async function change(copyId: number, body: Record<string, unknown>) {
    setBusy(copyId);
    // A single row acting makes the batch note stale — it counted a set this row
    // has just left.
    setNote(null);
    try {
      await api.updateCopy(copyId, body);
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(copyId: number) {
    setBusy(copyId);
    try {
      await api.deleteCopy(copyId);
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <main className="notice notice--bad">Could not load the wishlist: {error}</main>;
  if (!rows) return <main className="muted">Loading…</main>;

  const onTheWayRows = rows.filter((r) => r.status === 'preordered');
  const onTheWay = onTheWayRows.length;
  const wishes = rows.length - onTheWay;

  return (
    <main>
      <h2 className="page-title">Wishlist</h2>

      {note && (
        <p className={note.tone === 'good' ? 'notice notice--good' : 'notice notice--bad'}>
          {note.text}
        </p>
      )}

      {/* Above the list, because a parcel landing is why this screen was opened
          — nobody comes to the wishlist to browse on the day four preorders turn
          up. It renders nothing at all when nothing is on the way. */}
      <Arrivals
        rows={onTheWayRows}
        canEdit={canEdit}
        onArrived={(text) => {
          setNote({ text, tone: 'good' });
          load();
        }}
        onPartial={(text) => {
          setNote({ text, tone: 'bad' });
          load();
        }}
      />

      {rows.length === 0 ? (
        <p className="muted">
          Nothing on the list. A book page has a <em>Want this</em> button, and a series with
          gaps in it offers one against each missing volume.
        </p>
      ) : (
        <>
          {/* ⚠️ Counted apart, even though the page lists them together.
              A pre-order is a wish that has already been paid for, and calling
              twelve pledges "twelve wishes" makes the shopping list unusable
              the first time a crowdfunder delivers — which is what happened to
              the sibling Board Game Catalog at 204 pre-orders against 30
              wishes. They stay on one list because the list is short and both
              are "not here yet"; only the counting is separated. */}
          <p className="muted small">
            {wishes} {wishes === 1 ? 'wish' : 'wishes'}
            {onTheWay > 0 && ` · ${onTheWay} ${ON_THE_WAY}`}. Marking one as owned keeps
            the row — when you wanted it, and what you were going to pay — rather than
            starting a new one.
          </p>
          <ul className="works">
            {rows.map((r) => (
              <li key={r.copyId}>
                <div className="wish">
                  <button
                    className="wish__book"
                    onClick={() => onOpen(r.workId)}
                    aria-label={`Open ${r.title}`}
                  >
                    <Cover src={r.coverUrl} title={r.title} size="row" />
                    <span className="row-open__text">
                      <span className="row-open__head">
                        <strong>{r.title}</strong>
                        {/* ⚠️ `mark--preordered`, not the `mark--attested` this
                            borrowed before. That class belongs to series
                            evidence and means "somebody says this volume
                            exists"; wearing it here made a book in the post
                            look like a bibliographic claim. Preorder has its
                            own colour now — see `--transit`. */}
                        {r.status === 'preordered' && (
                          <span className="mark mark--preordered">
                            {statusLabel('preordered')}
                          </span>
                        )}
                      </span>
                      <span className="muted small">{r.authors}</span>
                      {r.series && (
                        <span className="series-tag">
                          {r.series}
                          {r.seriesIndexDisplay ? <b> {r.seriesIndexDisplay}</b> : null}
                        </span>
                      )}
                      {/* The fact that makes a wish against an owned book make
                          sense: we already hold it, in these forms, and want
                          another. Without this the row reads as a mistake. */}
                      {r.formats && (
                        <span className="muted small">
                          already held as {r.formats.split(',').map(formatLabel).join(' · ')}
                        </span>
                      )}
                      {r.notes && <span className="muted small">{r.notes}</span>}
                    </span>
                  </button>

                  {canEdit && (
                    <div className="wish__actions">
                      {/* ⚠️ The same transition the checklist above performs,
                          through the same helper — a preorder arriving one row
                          at a time must record the arrival date exactly as a
                          parcel of four does. */}
                      <button
                        className="primary chip"
                        disabled={busy === r.copyId}
                        onClick={() => void change(r.copyId, arrivedPatch(r.acquiredOn))}
                      >
                        {r.status === 'preordered' ? 'It arrived' : 'Got it'}
                      </button>
                      {r.status === 'wanted' && (
                        <button
                          className="chip"
                          disabled={busy === r.copyId}
                          onClick={() => void change(r.copyId, { status: 'preordered' })}
                        >
                          Pre-ordered
                        </button>
                      )}
                      <button
                        className="chip"
                        disabled={busy === r.copyId}
                        onClick={() => void remove(r.copyId)}
                      >
                        Off the list
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
