import type { Me } from '../api.js';
import { WISHLIST_ADD_MODES, blockedAddModes } from '../lib/add-modes.js';
import { targetSentence } from '../lib/scan-target.js';
import { AddBookPanel } from './AddBookPanel.js';

/**
 * **+ Add something** — the wishlist page's own door.
 *
 * ## ⚠️ WHY IT EXISTS, IN THE OWNER'S WORDS
 *
 * 2026-09-04, after being told the sibling board-game catalog adds to its
 * wishlist from the wishlist page itself — *+ Add something* → type / barcode /
 * photo — rather than from a switch on its scanner:
 *
 * > *"We should mimic that shape so keep reusable components"*
 *
 * That morning's build had put a **Shelf | Wishlist** switch on `/add`, which
 * works and is kept: a shop visit with a mixed basket needs it. But it answers
 * the question *"where does this scan go?"*, and the thought somebody has
 * standing on this page is *"I want a thing"* — which starts nowhere near the
 * scanner. The sibling's `WishlistPage` records the same finding in its own
 * words: **the page's own door, not a link to `/scan`.**
 *
 * ## ⚠️ THE TARGET IS PINNED, AND NO SWITCH IS SHOWN
 *
 * Everything this door creates is `status='wanted'`, through the same
 * `copyStatusFor` → `catalog-add` path `/add` uses when its switch is on
 * Wishlist. A switch here would offer to put a book on the shelf from the
 * wishlist page, which is a control whose only correct setting is the one it
 * already has. The already-wanted refusal (`lib/wants.ts`) applies unchanged:
 * a second `wanted` row against one work is two rows saying the same sentence.
 *
 * ## ⚠️ ONE SCANNER, NOT TWO
 *
 * The tabs and everything under them are `AddBookPanel`, the same component
 * `/add` renders — same camera loop, same `ScanLines`, same `AddWork`, same
 * `addLineToCatalog`. This file is only the door: which tabs, in which order,
 * pinned to which target, and what closing means. A second scan stack beside
 * the first is precisely the failure `lib/catalog-add.ts`'s header names, and
 * the owner asked for the opposite of it by name.
 *
 * ## ⚠️ WHAT THIS DOOR DOES *NOT* OFFER
 *
 * The **shelf photo**. A wishlist is not bulk intake — photographing a shelf
 * means "record every one of these", a sentence about books you already have.
 * Argued in `lib/add-modes.ts` beside the tab order.
 */
export function WishlistAdd({
  me,
  onAdded,
  onClose,
}: {
  /**
   * Whose capabilities decide which doors are open.
   *
   * This panel is only ever mounted behind `suggestWishlist` (`WishlistPage`),
   * so **typing always works** — `POST /api/works` and `POST /api/copies` with
   * a wishlist status are both gated on exactly that capability, measured
   * against the routes rather than assumed. What varies is the camera: the
   * barcode tab is `scanBarcode` (contributor+) and the one-book photo is
   * `scanPhoto` (moderator+, it bills the vision API). A member sees three tabs
   * with two of them disabled and a sentence saying why — see
   * `lib/add-modes.ts` for why this door explains where `/add` hides.
   */
  me: Me;
  /** The list behind this panel just went stale. */
  onAdded: () => void;
  onClose: () => void;
}) {
  return (
    <section className="panel">
      <div className="row-tight">
        <strong>Add to the wishlist</strong>
        <button onClick={onClose}>Close</button>
      </div>

      <AddBookPanel
        /* ⚠️ Pinned, not defaulted. There is no switch on this door and there
           is nothing to read out of storage: a want is what this page is. */
        target="wishlist"
        modes={WISHLIST_ADD_MODES}
        blocked={blockedAddModes(me.capabilities, WISHLIST_ADD_MODES)}
        /* Typing is the default because it is the only tab that works with no
           light, no barcode and no signal — the sibling's exact reasoning — and
           the only one that needs no permission beyond this door's own. */
        initialMode="type"
        /* ⚠️ No `onNav`. This is a panel on a page, not a route: rewriting the
           URL here would point `/wishlist` at `/add`'s query string and a
           reload would land somewhere else entirely. */
        underTabs={() => (
          <p className="muted small">{targetSentence('wishlist', 'Books you add here')}</p>
        )}
        onAdded={(from) => {
          onAdded();
          /*
           * ⚠️ A TYPED save shuts the door; a scanned row does not.
           *
           * `AddWork` does not clear itself after a save — it still holds the
           * book it just created, and pressing Save again would mint a second
           * work, because `POST /api/works` deliberately does not dedupe
           * (migration 0001). One book typed is one errand finished, and
           * **+ Add something** is one tap away. A sweep is several books by
           * definition, so a scanned row leaves it standing.
           */
          if (from === 'typed') onClose();
        }}
        /* Finishing a sweep here means "done adding", not "leave the page" —
           the list this door sits above is exactly where you want to end up. */
        onFinished={() => {
          onAdded();
          onClose();
        }}
        /* On `/add`, Cancel means "I'll scan it after all" and returns to the
           barcode tab. Here the panel itself is the thing being backed out of. */
        onCancel={onClose}
      />
    </section>
  );
}
