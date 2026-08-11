import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type WishlistRow } from '../api.js';
import { Cover } from '../components/Cover.js';
import { formatLabel } from '../lib/formats.js';
import { ON_THE_WAY, statusLabel } from '../lib/statuses.js';

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

  const canEdit = me.capabilities.includes('editCatalog');

  const load = useCallback(() => {
    setError(null);
    api
      .wishlist()
      .then((r) => setRows(r.rows))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  async function change(copyId: number, body: Record<string, unknown>) {
    setBusy(copyId);
    try {
      await api.updateCopy(copyId, body);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <main className="notice notice--bad">Could not load the wishlist: {error}</main>;
  if (!rows) return <main className="muted">Loading…</main>;

  const onTheWay = rows.filter((r) => r.status === 'preordered').length;
  const wishes = rows.length - onTheWay;

  return (
    <main>
      <h2 className="page-title">Wishlist</h2>

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
                      <button
                        className="primary chip"
                        disabled={busy === r.copyId}
                        onClick={() => void change(r.copyId, { status: 'owned' })}
                      >
                        Got it
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
