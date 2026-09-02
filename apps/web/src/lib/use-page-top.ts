import { useEffect, useRef } from 'react';

import { returnToListTop } from './page-top.js';

/**
 * The one page-change handler every paginated surface in this app uses.
 *
 * ⚠️ **One implementation, not one per page.** The owner's ask was about the
 * physical book library, but he filed it as *"we paginate to a new page on the
 * physical book librarieS"* — plural, and the queue, the wishlist and anything
 * else that grows a `Pager` later will want the identical behaviour. A second
 * copy of this effect on a second page is how the two start disagreeing about
 * whether focus moves.
 *
 * Today `Pager` has exactly one caller (`CollectionPage`); this hook is what
 * makes the second caller free rather than a place to get it wrong again.
 *
 * ## ⚠️ On a CHANGE, not on arrival
 *
 * The comparison against the previous value is not a micro-optimisation. The
 * URL is allowed to arrive with a page already on it — `/?q=dungeon&page=2` is
 * a link somebody sent — and yanking the viewport on first paint would be the
 * page fighting the person who opened it. Comparing values rather than listing
 * `page` as the only dependency is also what makes this survive StrictMode's
 * deliberate double-mount in dev, exactly as the filter-reset effect beside it
 * does.
 *
 * ## Why it covers a filter change too, without knowing about filters
 *
 * A filter or sort change resets the surface to page 0. When that is a real
 * move (you were on page 3), `page` changes and this fires; when you were
 * already on page 0 nothing changed and nothing should move. The surface does
 * not have to remember to call anything, which is the second half of the
 * TODO's *"check the same handler covers every way the page changes"*.
 *
 * @param page the current page, 0-based, exactly as the surface holds it
 * @returns the ref to put on the list container (give it `tabIndex={-1}`)
 */
export function useListTopOnPageChange<T extends HTMLElement>(page: number) {
  const listTop = useRef<T>(null);
  const previous = useRef(page);

  useEffect(() => {
    if (previous.current === page) return;
    previous.current = page;
    returnToListTop(window, listTop.current);
  }, [page]);

  return listTop;
}
