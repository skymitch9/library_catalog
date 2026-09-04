/**
 * The ways a book gets in — the tab catalogue, who may use each one, and the
 * sentence a person reads when they may not.
 *
 * ## ⚠️ WHY THIS IS A MODULE AND NOT A CONST IN `ScanPage`
 *
 * It was one, until 2026-09-04. The owner, having been told the board-game
 * catalog adds to its wishlist from the wishlist page itself: *"We should mimic
 * that shape so keep reusable components"*. Two screens now offer these tabs —
 * `/add` (all four, target from its Shelf|Wishlist switch) and the wishlist
 * door (three, target pinned) — and the moment there are two, the labels, the
 * order and the permission rules have to live somewhere neither of them owns.
 *
 * The JSX half (the glyphs, the tab strip) stays in `components/AddBookPanel.tsx`.
 * What is here is the part a `node:test` process can hold: pure data and two
 * pure functions. Same split as `lib/scan-target.ts` and `lib/wants.ts`, and for
 * the same reason — this app has no jsdom, so anything worth pinning has to be
 * reachable without mounting a component.
 *
 * ## ⚠️ THE TWO SCREENS GATE DIFFERENTLY, ON PURPOSE
 *
 * | | `/add` | the wishlist door |
 * |---|---|---|
 * | a tab this person cannot use | **hidden** (`shelfAddModes`) | **disabled, with a sentence** (`blockedAddModes`) |
 *
 * `/add` is behind `editCatalog` and the tabs it hides are the two that SPEND
 * MONEY — *"a control that exists and refuses is worse than one that was never
 * offered"*, and a free tab always remains. The wishlist door is behind
 * `suggestWishlist`, which a plain member holds, so the tabs missing there are
 * an ACCESS question rather than a spending one: somebody whose phone shows one
 * tab where another shows three is owed the reason. That is the same call the
 * Shelf|Wishlist switch made this morning — a control with a missing state
 * reads as broken — and the estate rule it comes from is that a refusal names
 * what happened, what it needs, and how to get it.
 */

// ⚠️ A TYPE-ONLY import, and it has to stay one. `router.tsx` owns this
// vocabulary because `parse` validates `?mode=` against it, and it pulls in
// React; `import type` is erased at compile time, so a `node:test` process
// importing this module never loads it. A value import here would take the
// test process down the way `api.js` → `lib/firebase.ts` does (see
// `lib/wants.ts`).
import type { AddMode } from '../router.js';

export type AddModeGlyph = 'barcode' | 'photo' | 'type';

export interface AddModeSpec {
  id: AddMode;
  label: string;
  /**
   * The one line under the label. ⚠️ Not decoration: a tab with no blurb makes
   * the reader open it to find out what it does, which on a phone is the
   * expensive way to answer a question.
   */
  blurb: string;
  glyph: AddModeGlyph;
  /** It spends money to run. Two of the four do; `/add` hides those. */
  costs?: true;
  /**
   * The capability the Worker will demand, or `null` when the floor to reach
   * either screen is already enough.
   *
   * ⚠️ Measured against the routes, not guessed: `POST /api/scan-jobs/barcode`
   * is `scanBarcode`, `/shelf` and `/single` are `scanPhoto`, and the typing
   * tab's two writes — `POST /api/works` and `POST /api/copies` with a wishlist
   * status — are both `suggestWishlist`, which is the wishlist door's own gate.
   * So typing is the tab that is never blocked, which is exactly why it is the
   * default: it works with no light, no barcode, no signal and no extra grant.
   */
  capability: string | null;
}

/**
 * The four ways in, in `/add`'s order.
 *
 * ⚠️ This is the sibling Board Game Catalog's `ADD_MODES` with book nouns, and
 * copying it rather than re-deriving it is the point — that app settled the
 * shape after its add row "reached five buttons of equal weight by accretion".
 */
export const ADD_MODE_SPECS: readonly AddModeSpec[] = [
  {
    id: 'scan',
    label: 'Barcode',
    glyph: 'barcode',
    blurb: 'Exact, free, and keeps scanning. Best when the book has one.',
    capability: 'scanBarcode',
  },
  {
    id: 'photo',
    label: 'Shelf photo',
    glyph: 'photo',
    blurb: 'Reads every spine at once. Best for bulk.',
    costs: true,
    capability: 'scanPhoto',
  },
  {
    id: 'single',
    label: 'One book',
    glyph: 'photo',
    blurb: 'Reads the title off a single cover.',
    costs: true,
    capability: 'scanPhoto',
  },
  {
    id: 'type',
    label: 'Type a title',
    glyph: 'type',
    // ⚠️ Was "Looks the rest up as you type." There is no title-search endpoint
    // and no as-you-type request — verified in a browser: typing a title
    // produced no suggestions and no network call. The tab offers an ISBN
    // lookup button and free-text fields, which the old blurb both overstated
    // and contradicted (it promised "no code" and then the only lookup was by
    // code).
    blurb: 'No code, no book to hand. Type what you know and save it.',
    capability: null,
  },
];

/** One tab's spec by id. Throws rather than returning undefined: an id that is not in the table is a typo, not a state. */
export function addModeSpec(id: AddMode): AddModeSpec {
  const spec = ADD_MODE_SPECS.find((m) => m.id === id);
  if (!spec) throw new Error(`No such add mode: ${id}`);
  return spec;
}

/**
 * The tabs `/add` offers — all four, minus the paid ones when this person
 * cannot spend.
 *
 * ⚠️ Hidden, not disabled, and unchanged from what `ScanPage` did inline before
 * the extraction. See the header for why the wishlist door does the opposite.
 */
export function shelfAddModes(canSpend: boolean): AddMode[] {
  return ADD_MODE_SPECS.filter((m) => !m.costs || canSpend).map((m) => m.id);
}

/**
 * The wishlist door's three, in the order the board-game catalog settled on.
 *
 * ⚠️ **Typing first**, because it is the only one that works with no light, no
 * barcode and no signal — the sibling's exact reasoning, and it is the tab that
 * needs no permission beyond the door's own.
 *
 * ⚠️ **No shelf photo.** A wishlist is not bulk intake: photographing a shelf
 * means "record every one of these", which is a sentence about books you have.
 * Nobody stands in a shop wanting a whole shelf, and the paid rung is far too
 * much to spend on deciding whether to want something (the sibling's
 * `WishlistScan` leaves out its own slow paid rung for the same reason).
 */
export const WISHLIST_ADD_MODES: readonly AddMode[] = ['type', 'scan', 'single'];

/** The words for a capability, as a person would say it. */
const CAPABILITY_WORDS: Record<string, string> = {
  scanBarcode: 'the Scan permission',
  scanPhoto: 'the Photo scan permission, which costs money to run',
};

/**
 * Which of the offered tabs this person cannot actually use, and the sentence
 * saying so.
 *
 * ⚠️ **A sentence, never a bare status and never a dead control.** The estate
 * rule: say what happened, name what it needs, and say how to get it. The
 * shape is copied verbatim from the Shelf|Wishlist switch's refusal (shipped
 * this morning) so the two read as one voice.
 *
 * ⚠️ It is advisory, not the lock. The Worker re-checks every one of these on
 * the route; this only decides what a screen offers.
 */
export function blockedAddModes(
  capabilities: readonly string[],
  modes: readonly AddMode[] = WISHLIST_ADD_MODES,
): Partial<Record<AddMode, string>> {
  const blocked: Partial<Record<AddMode, string>> = {};
  for (const id of modes) {
    const spec = addModeSpec(id);
    if (!spec.capability || capabilities.includes(spec.capability)) continue;
    blocked[id] = `${spec.label} needs ${
      CAPABILITY_WORDS[spec.capability] ?? `the ${spec.capability} permission`
    } — ask an owner or admin here to grant it.`;
  }
  return blocked;
}

/**
 * The tab to open on: the caller's choice when this person can use it, else the
 * first offered tab they can.
 *
 * ⚠️ Landing somebody on a tab that is disabled would be a screen that looks
 * broken on arrival — the one failure a disabled-with-a-sentence tab is
 * otherwise better than hiding at avoiding.
 */
export function firstUsableMode(
  modes: readonly AddMode[],
  blocked: Partial<Record<AddMode, string>>,
  preferred?: AddMode,
): AddMode {
  if (preferred && modes.includes(preferred) && !blocked[preferred]) return preferred;
  const open = modes.find((m) => !blocked[m]);
  // ⚠️ Falls back rather than throwing. Every tab being blocked is not a state
  // the two callers can reach today (typing needs no grant beyond the door's
  // own), and a screen with no tab at all would be worse than one whose single
  // tab refuses in words. `type` is the last word because it is the one tab
  // that never needs a permission — see `ADD_MODE_SPECS`.
  return open ?? preferred ?? modes[0] ?? 'type';
}
