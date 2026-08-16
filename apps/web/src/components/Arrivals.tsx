import { useState } from 'react';
import { api, type WishlistRow } from '../api.js';
import { describeError } from '../lib/errors.js';
import { arrivedPatch } from '../lib/statuses.js';

/**
 * A box turning up — several books at once.
 *
 * ## Ported from the sibling Board Game Catalog, behaviour first
 *
 * `components/Arrivals.tsx` there, in this app's class vocabulary. Everything
 * that makes the interaction what it is came across unchanged: a disclosure
 * button rather than a permanently-open form, a checklist that starts with
 * **everything ticked** so the common case is one tap, unticking as the way to
 * say "not that one", and a single confirm. The sibling's `.card` and
 * `.btn btn-quiet` do not exist in this stylesheet, so the markup is `.panel`,
 * `.chip` and `button.primary` — the rendered control is the same one.
 *
 * ## ⚠️ Why batch is the feature and not a convenience
 *
 * One-at-a-time already existed: the wishlist has had a per-row "Got it" since
 * it shipped. What did not exist is the case this catalog actually has —
 * **six crowdfunding pledges and a four-book Barnes & Noble order**, where one
 * parcel settles several rows and confirming them singly is six or seven round
 * trips through a list that reorders itself under you as rows leave it.
 *
 * ## The state is what has NOT arrived
 *
 * The inverse of the obvious, and deliberately so — this is the sibling's
 * reasoning and it survives the port intact. Holding the *ticked* set means
 * seeding it from data that arrives after mount, and every such seed has a bug
 * about what happens when the list refreshes underneath it. Holding the
 * exclusions makes "everything is ticked" the empty set, which needs no seeding,
 * and a row that vanishes simply stops being asked about.
 *
 * ## ⚠️ There is no bulk write endpoint, on purpose
 *
 * Each ticked row is an ordinary `PATCH /api/copies/:id` — the same call the
 * per-row button makes, and the same one `Copies` makes on a book page. A second
 * way to change a copy's status would be a second thing to keep honest, and
 * `catalog.ts` already says why a promotion must be a PATCH rather than a
 * delete-and-recreate. The consequence is the good one: `allSettled`, so a
 * partial failure leaves whatever did not save still on the list to be retried,
 * rather than rolling back the ones that worked.
 */

/**
 * The value shared by most of the list, or nothing.
 *
 * A pledge's twenty rows carry one vendor and often one note, and printing it on
 * every row makes the row about the pledge instead of about the book. `>` and
 * not `>=`, so a tie between two values hoists neither — with nothing in common
 * there is nothing to say once.
 */
function commonValue(values: (string | null)[]): string | null {
  if (values.length < 2) return null;

  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** What this row adds to the value already shown above the list — often nothing. */
function residual(value: string | null, common: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!common) return trimmed;
  if (trimmed === common) return null;
  // Only strip a genuine prefix, so "Barnes & Noble" against "Barnes & Noble —
  // preorder" leaves the part that differs and never mangles an unrelated value.
  return trimmed.startsWith(common) ? trimmed.slice(common.length).trim() || null : trimmed;
}

function summarise(marked: WishlistRow[], heldBack: number): string {
  const only = marked.length === 1 ? marked[0] : undefined;
  const took = only
    ? `“${only.title}” has arrived and is on the shelf.`
    : `${marked.length} books have arrived and are on the shelf.`;

  if (heldBack === 0) return took;
  return `${took} ${heldBack === 1 ? 'One is' : `${heldBack} are`} still on the way.`;
}

export function Arrivals({
  rows,
  canEdit,
  onArrived,
  onPartial,
}: {
  /** Every copy on the way. The caller filters; this panel does not fetch. */
  rows: WishlistRow[];
  canEdit: boolean;
  /** Everything saved: say so on the page, which outlives this panel's reload. */
  onArrived: (note: string) => void;
  /**
   * Some saved, some did not.
   *
   * ⚠️ Reported to the *page* rather than drawn here, and that is not symmetry
   * for its own sake — it is a defect found by deleting a row behind an open
   * panel and confirming. Five of six saved, the sixth was gone, and the reload
   * left nothing on the way; this panel returns `null` at zero rows, so it
   * unmounted and took the warning with it. The user was told **nothing at all**
   * about the one that failed. A note about rows that have just changed cannot
   * live in a component whose existence depends on those rows.
   */
  onPartial: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  /**
   * A *total* failure only — the `catch` below, where nothing was written.
   *
   * Safe to keep here precisely because nothing changed: the row set is what it
   * was, so this panel is still mounted to show it. Partial failure is the case
   * that has to leave.
   */
  const [error, setError] = useState<string | null>(null);

  // Nothing on the way is not an empty state worth drawing — it is the ordinary
  // condition of the list, and a panel saying so would sit above the wishlist
  // every day of the year.
  if (!canEdit || rows.length === 0) return null;

  const chosen = rows.filter((r) => !excluded.has(r.copyId));
  const heldBack = rows.length - chosen.length;
  const sharedVendor = commonValue(rows.map((r) => r.vendor));
  const sharedNote = commonValue(rows.map((r) => r.notes));

  const toggle = (copyId: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(copyId)) next.delete(copyId);
      else next.add(copyId);
      return next;
    });

  function close() {
    setOpen(false);
    setExcluded(new Set());
    setError(null);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      // Settled rather than raced: one row failing must not abandon the other
      // ten, and it must not be reported as though the whole thing failed
      // either. Each is an independent write to an independent row.
      const results = await Promise.allSettled(
        chosen.map((r) => api.updateCopy(r.copyId, arrivedPatch(r.acquiredOn))),
      );
      const failures = results.filter((r) => r.status === 'rejected');

      if (failures.length > 0) {
        const reason = (failures[0] as PromiseRejectedResult).reason as unknown;
        const said = reason instanceof Error ? reason.message : String(reason);
        // Deliberately not `onArrived`: this is a warning, and the page paints
        // the two differently.
        onPartial(
          `${chosen.length - failures.length} of ${chosen.length} saved. ` +
            `The rest did not — nothing else was touched, so try again. (${said})`,
        );
        setExcluded(new Set());
        return;
      }

      onArrived(summarise(chosen, heldBack));
      close();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel arrivals">
      <div className="panel__head">
        <h3>
          On the way <span className="arrivals__count">{rows.length}</span>
        </h3>
        {!open && (
          <button className="primary" onClick={() => setOpen(true)}>
            It arrived
          </button>
        )}
      </div>

      {!open && (
        <p className="muted small">
          {rows.length === 1
            ? 'One book here is paid for and still on its way.'
            : `${rows.length} books here are paid for and still on their way.`}{' '}
          When the parcel turns up, this puts the lot of them on the shelf at once.
        </p>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      {open && (
        <>
          <p className="muted small">
            Untick anything that did <strong>not</strong> turn up — a volume still to ship, a
            pledge fulfilling in waves. Unticked rows stay exactly as they are.
          </p>

          {/* Said once, because it is one fact about the parcel rather than
              twenty facts about its contents. See `commonValue`. */}
          {(sharedVendor || sharedNote) && (
            <p className="muted small arrivals__shared" title={[sharedVendor, sharedNote].filter(Boolean).join(' · ')}>
              {[sharedVendor, sharedNote].filter(Boolean).join(' · ')}
            </p>
          )}

          <ul className="arrivals__list">
            {rows.map((r) => (
              <ArrivalRow
                key={r.copyId}
                row={r}
                checked={!excluded.has(r.copyId)}
                disabled={busy}
                vendor={residual(r.vendor, sharedVendor)}
                note={residual(r.notes, sharedNote)}
                onToggle={() => toggle(r.copyId)}
              />
            ))}
          </ul>

          <div className="row-tight arrivals__actions">
            <button className="primary" disabled={busy || chosen.length === 0} onClick={() => void confirm()}>
              {/* "all" only when it is doing more than the obvious — a one-row
                  list has no "all" to speak of. The verb is this app's word for
                  `owned`: `STATUS_LABEL` calls it "On the shelf", and "Mark as
                  owned" would be a second spelling of one status. */}
              {busy
                ? 'Saving…'
                : chosen.length === 1
                  ? 'Put it on the shelf'
                  : chosen.length === rows.length
                    ? `Put all ${rows.length} on the shelf`
                    : `Put ${chosen.length} on the shelf`}
            </button>
            {/* Only when it does something. "Tick everything" beside an already
                full list reports success and changes nothing. */}
            {heldBack > 0 && (
              <button className="chip" disabled={busy} onClick={() => setExcluded(new Set())}>
                Tick everything
              </button>
            )}
            <button className="chip" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>

          {chosen.length === 0 && (
            <p className="muted small">
              Nothing is ticked, so there is nothing to mark. Close this and it is as though
              you never opened it.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * One line of the checklist.
 *
 * ⚠️ The whole row is the `<label>`, so the tap target is the line rather than a
 * 16px box. This is read on a phone with a parcel in the other hand, and it is
 * the same call the collection makes in `WorkList` — "a link inside a row is a
 * miss".
 */
function ArrivalRow({
  row,
  checked,
  disabled,
  vendor,
  note,
  onToggle,
}: {
  row: WishlistRow;
  checked: boolean;
  disabled: boolean;
  vendor: string | null;
  note: string | null;
  onToggle: () => void;
}) {
  return (
    <li className={checked ? 'arrival' : 'arrival arrival--held'}>
      <label>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
        {/* The title leads. On a phone it is the whole first line, because it is
            the only thing on the row you actually decide with — everything else
            qualifies it. */}
        <span className="arrival__title">
          {row.title}
          {row.series && (
            <span className="series-tag">
              {' '}
              {row.series}
              {row.seriesIndexDisplay ? <b> {row.seriesIndexDisplay}</b> : null}
            </span>
          )}
        </span>
        <span className="arrival__meta">
          {vendor && <span className="muted small">{vendor}</span>}
          {/* Clamped to one line, with the whole thing on hover. A pledge note
              runs to 150 characters and there can be twenty of them; given its
              own paragraph it becomes the page. */}
          {note && (
            <span className="arrival__note" title={note}>
              {note}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
