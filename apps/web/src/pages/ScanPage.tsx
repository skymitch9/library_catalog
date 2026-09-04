import { useCallback, useState } from 'react';
import {
  DEFAULT_SCAN_TARGET,
  SCAN_TARGETS,
  TARGET_LABEL,
  loadScanTarget,
  saveScanTarget,
  targetSentence,
  type ScanTarget,
} from '../lib/scan-target.js';
import { shelfAddModes } from '../lib/add-modes.js';
import { AddBookPanel } from '../components/AddBookPanel.js';
import { addPath, replaceUrl, scansPath, Link, type AddMode } from '../router.js';

/**
 * Add books: by barcode, by photograph of a shelf, or by hand.
 *
 * ## ⚠️ THE TABS AND EVERYTHING UNDER THEM LIVE IN `AddBookPanel` NOW
 *
 * Extracted 2026-09-04 on the owner's instruction — *"We should mimic that
 * shape so keep reusable components"* — when `/wishlist` gained its own
 * **+ Add something** door. This page is what is LEFT: the way back, the link
 * to unfinished sweeps, and the Shelf | Wishlist switch, which is this screen's
 * alone. The camera loop, the review list and the typing form are one component
 * rendered by both doors, so there is exactly one path from a scan to a row.
 *
 * ## Why that screen is a *list*, not a single result
 *
 * Because the job is a shelf, not a book. Stopping the camera after every hit
 * means a tap between every book, and a tap between every book is why bulk
 * intake does not get done. So the loop runs `continuous`, results accumulate,
 * and nothing is written until the whole stack has been swept and looked over.
 *
 * ## ⚠️ The list lives on the server, and that is what `?job=` is for
 *
 * It used to be `useState`, which meant a phone locking mid-sweep lost every
 * result. Tolerable for barcodes — a barcode is free to re-scan — and not
 * tolerable for a shelf photograph, which costs an API call every time. So each
 * scan appends a line to a `scan_job` row, the job id goes into the URL, and a
 * reload picks the sweep up exactly where it was. The queue at `/scans` lists
 * the ones you walked away from. ⚠️ This page owns that URL and the panel does
 * not: `onNav` is how the panel says which tab and which sweep it is on, and
 * `replaceUrl` (never a push, never a path change) is why iOS does not re-ask
 * for the camera on every tab switch. See `AddBookPanel`'s own note.
 */
export function ScanPage({
  onDone,
  backLabel = 'Collection',
  initialMode = 'scan',
  initialJobId = null,
  canSpend,
  canSuggest,
}: {
  onDone: () => void;
  /** Where leaving goes, named. Usually the collection; see `backTarget`. */
  backLabel?: string;
  /** 'type' when the caller knows the camera is not available to this user. */
  initialMode?: AddMode;
  /** From `?job=`. Reopens a sweep left half-finished. */
  initialJobId?: number | null;
  /** `runResearch`. A photograph costs money; a barcode does not. */
  canSpend: boolean;
  /**
   * `suggestWishlist` — whether the Wishlist half of the target switch is
   * usable.
   *
   * ⚠️ **In practice always true on this screen**, and the prop exists anyway.
   * `/add` is gated on `editCatalog`, whose role set is a strict subset of
   * `suggestWishlist`'s (`CAPABILITY_MATRIX` — contributor+ implies member+),
   * so nobody who can reach this page lacks it. It is passed rather than
   * assumed because that subset relation is a fact about today's matrix, not a
   * law, and a switch that silently writes a status the server then refuses is
   * the worst of the three ways this could fail.
   */
  canSuggest: boolean;
}) {
  /*
   * ⚠️ **Where this sweep LANDS** — the owner's 2026-09-04 ask, from his phone:
   * *"I didn't see how to scan a book to add wishlist. We should add this
   * feature to the scanner."*
   *
   * Same shape and same reasoning as the format toggle inside the panel — lazy
   * initialiser, ONE choice for the whole sweep, written on the tap — with one
   * deliberate difference: it is remembered for the SESSION, not across visits.
   * A binding is a habit; a wishlist trip is an errand. `lib/scan-target.ts`
   * carries the argument.
   */
  const [scanTarget, setScanTarget] = useState<ScanTarget>(() => loadScanTarget());
  /*
   * ⚠️ The MECHANICAL guard, not just a disabled button: a stored `wishlist`
   * from an earlier session must not survive a change of role. The panel is
   * handed this, never `scanTarget`, so there is no path on which a person
   * without `suggestWishlist` writes a want.
   */
  const target: ScanTarget = canSuggest ? scanTarget : DEFAULT_SCAN_TARGET;

  /*
   * The panel's tab and sweep, written into the URL.
   *
   * ⚠️ `useCallback` so the panel's effects key on the tab and the job rather
   * than on this function's identity — a new function every render would
   * restart them. `replaceUrl` and the path never changing are argued in this
   * file's header and in `AddBookPanel`.
   */
  const onNav = useCallback((mode: AddMode, jobId: number | null) => {
    replaceUrl(addPath(mode, jobId));
  }, []);

  /*
   * ⚠️ **SHELF or WISHLIST** — the switch this screen keeps.
   *
   * The owner, 2026-09-04, having been unable to find any way to do it:
   * *"Yes build it. We currently can't add to wishlist at all."* It stays here
   * after the wishlist page grew its own door, because a shop visit with a
   * mixed basket — two for the shelf, one for the list — needs it and the
   * wishlist door cannot express it.
   *
   * ⚠️ It renders on EVERY tab, including *Type a title*, where the format
   * toggle deliberately does not. The reason they differ: the format toggle
   * feeds `addLineToCatalog`, which the typing tab never calls — but the target
   * feeds `AddWork`'s intent dropdown as well, so it reaches every way in.
   *
   * ⚠️ It reuses the `.scan-format` segmented shape rather than minting a
   * second one. That shape is already this app's spelling of "pick exactly one
   * of a short list" (`.cog__modes`, and the format toggle), it is already 44px
   * on touch, and a second near-identical block of CSS is two places to fix the
   * next phone bug in.
   *
   * ⚠️ The refusal, when it comes, is a SENTENCE — never a dead half of a
   * switch and never a bare status. It names what happened, what it needs and
   * how to get it, which is the estate rule.
   */
  const targetSwitch = (mode: AddMode) => (
    <div className="scan-format">
      <span className="scan-format__label" id="scan-target-label">
        Adding to
      </span>
      <div className="scan-format__opts" role="group" aria-labelledby="scan-target-label">
        {SCAN_TARGETS.map((t) => (
          <button
            key={t}
            aria-pressed={target === t}
            disabled={!canSuggest && t === 'wishlist'}
            onClick={() => {
              setScanTarget(t);
              // Written on the tap, for the format toggle's reason: a phone
              // that locks mid-sweep is the case this screen is built around,
              // and an unmount handler is exactly what that does not run.
              saveScanTarget(t);
            }}
          >
            {TARGET_LABEL[t]}
          </button>
        ))}
      </div>
      <span className="muted small">
        {canSuggest
          ? targetSentence(target, mode === 'type' ? 'Books you add' : 'Scanned books')
          : 'Wishlist needs the Wishlist permission, which this account does not have — ask an owner or admin here to grant it. Books you add still go on your shelf.'}
      </span>
    </div>
  );

  return (
    <main>
      <div className="row-tight">
        <button onClick={onDone}>← {backLabel}</button>
        <Link to={scansPath} className="chip">
          Unfinished sweeps
        </Link>
      </div>
      <h2>Add a book</h2>

      <AddBookPanel
        target={target}
        /* All four, minus the two that spend money when this person cannot —
           hidden rather than disabled, which is this screen's convention and
           unchanged by the extraction. See `lib/add-modes.ts` for why the
           wishlist door does the opposite. */
        modes={shelfAddModes(canSpend)}
        initialMode={initialMode}
        initialJobId={initialJobId}
        onNav={onNav}
        /* Target first: WHERE a book lands is a bigger claim than which binding
           it is recorded as, and it is the one somebody arrives at this screen
           having already decided. */
        underTabs={targetSwitch}
        /* ⚠️ Only a TYPED save leaves this screen, exactly as it did before the
           extraction: `AddWork`'s Save has always meant "that book is in, take
           me back", while adding a scanned row means "next book" and must leave
           the sweep standing. */
        onAdded={(from) => {
          if (from === 'typed') onDone();
        }}
        onFinished={onDone}
      />
    </main>
  );
}
