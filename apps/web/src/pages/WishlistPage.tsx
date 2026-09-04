import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type WishlistRow } from '../api.js';
import { describeError } from '../lib/errors.js';
import { Arrivals } from '../components/Arrivals.js';
import { Cover } from '../components/Cover.js';
import { WishlistAdd } from '../components/WishlistAdd.js';
import { formatLabel } from '../lib/formats.js';
import { addedLabel } from '../lib/scan-target.js';
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
 *
 * ## ⚠️ The page has its OWN DOOR since 2026-09-04
 *
 * The owner, told that the sibling board-game catalog adds to its wishlist from
 * its wishlist page rather than from a switch on its scanner: *"We should mimic
 * that shape so keep reusable components"*. So **+ Add something** opens
 * `WishlistAdd` here — the same tabs, camera and forms `/add` renders, with the
 * target pinned to `wishlist`. Nothing navigates: sending somebody to the
 * scanner to record a book they do not have yet is the wrong direction, which
 * is the finding the sibling's own page writes down in those words.
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
   * The page's one "that worked" line — a batch arrival, or a book just added.
   *
   * ⚠️ Both outcomes live here, and the failure one is the reason why. The panel
   * renders nothing once no copies are on the way, so a note it owned would be
   * destroyed by the very reload that follows a batch. Measured: with five of six
   * saved and the sixth deleted underneath, the panel unmounted and the warning
   * went with it — the one case where saying nothing is worst. The add door has
   * the same shape: a typed save shuts it, so a note it owned would go with it.
   */
  const [note, setNote] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  /**
   * The add door, shut until asked for — see `components/WishlistAdd.tsx`.
   *
   * ⚠️ State on the page rather than inside the button, because the empty state
   * and the header both open the same one panel. Two `WishlistAdd`s alive at
   * once would be two cameras asking for the same device.
   */
  const [adding, setAdding] = useState(false);

  // `manageWishlist`, not `editCatalog` — these buttons (arrived/pre-ordered/
  // off-the-list) PATCH or DELETE an existing wishlist copy, which is exactly
  // what the 2026-08-16 wishlist split names `manageWishlist` (contributor+).
  // Asking for a NEW book ("Want this", elsewhere) is the looser
  // `suggestWishlist` (member+) and does not gate anything on this page.
  const canEdit = me.capabilities.includes('manageWishlist');
  // The looser half of the same 2026-08-16 split: asking for a book is
  // `suggestWishlist` (member+), so the add door opens for people who may not
  // touch the rows already on the list. ⚠️ Hidden when absent rather than
  // disabled — a `guest` has `read` and not this, and for them there is no
  // "ask" to explain. Its TABS are the ones that explain themselves; see
  // `lib/add-modes.ts` for why those two go opposite ways.
  const canSuggest = me.capabilities.includes('suggestWishlist');

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
      <div className="row-tight">
        <h2 className="page-title">Wishlist</h2>
        {/* ⚠️ The only primary button on the screen, and it is at the top. The
            owner came to a wishlist page, could not find a way to add anything,
            and had to ask — twice, in two catalogs — so this is not a control
            to tuck behind a menu. It is repeated in the empty state below,
            because an empty page is exactly where somebody is looking for it. */}
        {canSuggest && !adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            + Add something
          </button>
        )}
      </div>

      {canSuggest && adding && (
        <WishlistAdd
          me={me}
          onAdded={() => {
            /* ⚠️ The same words the row inside the panel says (`addedLabel`
               with this door's pinned target), so one event is not reported two
               ways by two surfaces a few pixels apart. */
            setNote({
              text: `${addedLabel({ target: 'wishlist', arrived: false, summary: null, owned: false })}.`,
              tone: 'good',
            });
            load();
          }}
          onClose={() => setAdding(false)}
        />
      )}

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
        <>
          {/* ⚠️ Says what puts a book HERE, not just that nothing is here. A
              row on this page is a copy whose status is `wanted` — the fact the
              page's header comment opens with — and an empty state that does
              not say so leaves somebody guessing at what they are looking at.
              Same sense as the sibling catalog's, in this repo's nouns. */}
          <p className="muted">
            Nothing on the list. A book lands here when one of its copies is{' '}
            <em>wanted</em> — add one here, press <em>Want this</em> on a book&rsquo;s page, or
            take one of the gaps a series offers against its missing volumes.
          </p>
          {/* The page's own door, not a link to `/add`. Sending somebody to the
              scanner to record a book they do not have yet is the wrong
              direction — that screen is for books in your hands. */}
          {canSuggest && !adding && (
            <p>
              <button className="primary" onClick={() => setAdding(true)}>
                + Add something
              </button>
            </p>
          )}
        </>
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
