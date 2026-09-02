/**
 * Turning a page puts you back at the top — and STAYS there.
 *
 * ## The bug this pins, which passed a code review and shipped
 *
 * The first implementation (`CollectionPage`, 2026-08-21) did the obvious pair:
 *
 * ```ts
 * window.scrollTo({ top: 0, behavior: 'instant' });
 * listTopRef.current?.focus();
 * ```
 *
 * `HTMLElement.focus()` scrolls the focused element into view **by default**,
 * so the second line undid the first. The viewport went to the top of the
 * document and then straight back down to the results container. Both lines
 * read correctly on their own; only their ORDER and `focus`'s default make it
 * wrong, which is exactly the kind of thing a unit test can hold and a reviewer
 * cannot.
 *
 * ⚠️ So the assertion that matters here is not "it scrolled" — it is
 * **`preventScroll: true`**. A version of this file that only checked `scrollTo`
 * was called would pass on the broken code.
 *
 * This app has no DOM renderer (see `bulk-action-bar-hooks.test.ts`), which is
 * why `returnToListTop` takes its two collaborators as arguments.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { returnToListTop } from '../src/lib/page-top.js';

function scroller() {
  const calls: { top: number; behavior?: string }[] = [];
  return {
    calls,
    scrollTo(options: { top: number; behavior?: ScrollBehavior }) {
      calls.push(options);
    },
  };
}

function listTop() {
  const calls: ({ preventScroll?: boolean } | undefined)[] = [];
  return {
    calls,
    focus(options?: { preventScroll?: boolean }) {
      calls.push(options);
    },
  };
}

describe('returnToListTop', () => {
  it('scrolls the window to the very top', () => {
    const win = scroller();
    returnToListTop(win, listTop());
    assert.deepEqual(win.calls, [{ top: 0, behavior: 'instant' }]);
  });

  it('jumps rather than animating — a page turn is not a journey', () => {
    const win = scroller();
    returnToListTop(win, null);
    assert.equal(win.calls[0]?.behavior, 'instant');
    assert.notEqual(win.calls[0]?.behavior, 'smooth');
  });

  it('moves focus to the list, so a keyboard user goes where the pixels went', () => {
    const el = listTop();
    returnToListTop(scroller(), el);
    assert.equal(el.calls.length, 1);
  });

  it('⚠️ focuses with preventScroll — without it the scroll above is undone', () => {
    const el = listTop();
    returnToListTop(scroller(), el);
    assert.equal(
      el.calls[0]?.preventScroll,
      true,
      'focus() scrolls the element into view by default; the page turn must not land on the list container',
    );
  });

  it('still scrolls when there is no list element to focus', () => {
    const win = scroller();
    assert.doesNotThrow(() => returnToListTop(win, null));
    assert.equal(win.calls.length, 1);
  });
});
