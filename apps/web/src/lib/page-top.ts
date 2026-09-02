/**
 * Turning to a new page of a list puts you back at the top of it.
 *
 * > *"when we paginate to a new page on the physical book libraries it doesnt
 * > scroll to the top"* — the owner, 2026-08-20.
 *
 * ## ⚠️ `focus()` scrolls, and that is why this is a function and not two lines
 *
 * The first cut of this lived inline in `CollectionPage` and did the obvious
 * pair — `window.scrollTo({ top: 0 })`, then `listTop.focus()` — in that order.
 * **`HTMLElement.focus()` scrolls the focused element into view by default**,
 * so the second call silently undid the first: the viewport went to the top of
 * the document and then straight back down until the results container's top
 * edge met the top of the screen. The pixels moved, the person still did not
 * land where they asked to be, and nothing anywhere said so.
 *
 * `{ preventScroll: true }` is the whole fix, and it is the reason both halves
 * belong in ONE named function rather than being retyped at each call site: the
 * ordering trap is invisible when you read either line on its own.
 *
 * ## Why the focus move is not optional
 *
 * Moving the pixels without moving focus leaves a keyboard or screen-reader
 * user on the old page's control, reading the old page's rows — the same defect
 * the owner reported, for the people least able to work around it. The
 * container carries `tabIndex={-1}` so it can receive focus programmatically
 * without joining the tab order.
 *
 * ## The shape of the arguments
 *
 * Both are narrowed to the one method each is called for, so a test can hand in
 * a plain object. This app has **no DOM renderer** (see
 * `bulk-action-bar-hooks.test.ts` for why), so a helper that could only be
 * exercised through a real `window` could not be pinned at all.
 */

/** The `window`-shaped thing this scrolls. */
export interface PageScroller {
  scrollTo(options: { top: number; behavior?: ScrollBehavior }): void;
}

/** The list container. `tabIndex={-1}`, focused but never tabbed to. */
export interface ListTopElement {
  focus(options?: { preventScroll?: boolean }): void;
}

/**
 * Put the viewport back at the top of the document and move focus to the list.
 *
 * ⚠️ **`behavior: 'instant'`, never `'smooth'`.** A page turn is a jump, not a
 * journey: a smooth scroll of a long list animates past every row the person
 * just left, and on a slow device it is still travelling when the new rows
 * paint.
 *
 * ⚠️ **`preventScroll: true` is load-bearing** — see the header. Remove it and
 * the scroll above becomes dead code.
 */
export function returnToListTop(scroller: PageScroller, listTop: ListTopElement | null): void {
  scroller.scrollTo({ top: 0, behavior: 'instant' });
  listTop?.focus({ preventScroll: true });
}
