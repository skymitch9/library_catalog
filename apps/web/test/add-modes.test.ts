/**
 * The add-tab catalogue: which tabs each door offers, in which order, and what
 * a person is told about the ones they cannot use.
 *
 * The owner's ask, 2026-09-04, after being told the board-game catalog adds to
 * its wishlist from the wishlist page itself: *"We should mimic that shape so
 * keep reusable components"*.
 *
 * ## ⚠️ THE PROPERTIES WORTH A TEST
 *
 *  1. **`/add` is unchanged by the extraction.** Same four tabs, same order,
 *     and the two that SPEND MONEY are the two that disappear when somebody
 *     cannot spend — hidden, not disabled, which is that screen's convention.
 *  2. **The wishlist door leads with typing**, because it is the only tab that
 *     works with no light, no barcode, no signal — and the only one that needs
 *     no permission beyond the door's own gate.
 *  3. **No shelf photo on the wishlist door.** A wishlist is not bulk intake.
 *  4. **A blocked tab gets a SENTENCE**, naming the permission and how to get
 *     it — never a bare status, never a dead control. The estate rule.
 *  5. **`type` is never blocked**, at any role. If it ever became blockable the
 *     wishlist door would have a state where every tab refuses, which is the
 *     one thing worse than hiding them.
 *  6. **`firstUsableMode` never opens on a blocked tab**, because a screen that
 *     arrives already refusing looks broken rather than gated.
 *
 * Component behaviour is deliberately NOT tested here — this app has no jsdom
 * setup, which is why the decisions above live in a module a `node:test`
 * process can import. `lib/add-modes.ts` imports the `AddMode` TYPE only, so
 * nothing here loads `router.tsx` or React.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ADD_MODE_SPECS,
  WISHLIST_ADD_MODES,
  addModeSpec,
  blockedAddModes,
  firstUsableMode,
  shelfAddModes,
} from '../src/lib/add-modes.js';

/** The three roles that differ here, by what the Worker's routes demand. */
const MEMBER: string[] = ['suggestWishlist', 'trackReading'];
const CONTRIBUTOR: string[] = ['suggestWishlist', 'editCatalog', 'scanBarcode', 'manageWishlist'];
const MODERATOR: string[] = [...CONTRIBUTOR, 'scanPhoto', 'runResearch'];

describe('the tab catalogue', () => {
  it('holds the four ways in, in /add’s order', () => {
    assert.deepEqual(
      ADD_MODE_SPECS.map((m) => m.id),
      ['scan', 'photo', 'single', 'type'],
    );
  });

  it('marks as costing money exactly the tabs the Worker gates on scanPhoto', () => {
    // ⚠️ The two facts are separate fields and could drift; they are the same
    // claim. `POST /api/scan-jobs/shelf` and `/single` are `scanPhoto` — the
    // spend capability, split from the free `scanBarcode` on 2026-08-16.
    for (const spec of ADD_MODE_SPECS) {
      assert.equal(
        spec.costs === true,
        spec.capability === 'scanPhoto',
        `${spec.id}: costs and capability disagree`,
      );
    }
  });

  it('gives every tab a label and a one-line blurb', () => {
    // A tab with no blurb makes the reader open it to find out what it does,
    // which on a phone is the expensive way to answer a question.
    for (const spec of ADD_MODE_SPECS) {
      assert.ok(spec.label.length > 0, `${spec.id}: no label`);
      assert.ok(spec.blurb.length > 0, `${spec.id}: no blurb`);
    }
  });

  it('refuses an id that is not in the table', () => {
    // A typo, not a state — so it throws rather than returning undefined and
    // letting a tab render blank.
    assert.throws(() => addModeSpec('nonsense' as never), /No such add mode/);
  });
});

describe('shelfAddModes — what /add offers', () => {
  it('offers all four when this person can spend', () => {
    assert.deepEqual(shelfAddModes(true), ['scan', 'photo', 'single', 'type']);
  });

  it('HIDES exactly the two paid tabs when they cannot', () => {
    // Hidden rather than disabled: "a control that exists and refuses is worse
    // than one that was never offered" — and a free tab always remains.
    assert.deepEqual(shelfAddModes(false), ['scan', 'type']);
  });
});

describe('WISHLIST_ADD_MODES — what the wishlist door offers', () => {
  it('leads with typing', () => {
    assert.equal(WISHLIST_ADD_MODES[0], 'type');
  });

  it('is type, then barcode, then one book — the sibling’s order', () => {
    assert.deepEqual([...WISHLIST_ADD_MODES], ['type', 'scan', 'single']);
  });

  it('does NOT offer the shelf photo', () => {
    // A wishlist is not bulk intake: photographing a shelf means "record every
    // one of these", which is a sentence about books you have.
    assert.equal(WISHLIST_ADD_MODES.includes('photo'), false);
  });
});

describe('blockedAddModes — the refusals, in words', () => {
  it('blocks nothing for a moderator', () => {
    assert.deepEqual(blockedAddModes(MODERATOR), {});
  });

  it('blocks only the paid tab for a contributor', () => {
    const blocked = blockedAddModes(CONTRIBUTOR);
    assert.deepEqual(Object.keys(blocked), ['single']);
  });

  it('blocks both camera tabs for a member, and never the typing one', () => {
    const blocked = blockedAddModes(MEMBER);
    assert.equal(blocked.type, undefined);
    assert.ok(blocked.scan);
    assert.ok(blocked.single);
  });

  it('never blocks typing, at any of the three roles', () => {
    // The floor to reach the wishlist door is `suggestWishlist`, and both of
    // the typing tab's writes — POST /works and POST /copies with a wishlist
    // status — are gated on exactly that. So the door always has one way in.
    for (const caps of [MEMBER, CONTRIBUTOR, MODERATOR]) {
      assert.equal(blockedAddModes(caps).type, undefined);
    }
  });

  it('names the tab, the permission and how to get it', () => {
    const blocked = blockedAddModes(MEMBER);
    // What happened / what it needs / how to get it — the estate rule, and the
    // same shape the Shelf|Wishlist switch's refusal uses.
    assert.match(blocked.scan ?? '', /^Barcode needs the Scan permission/);
    assert.match(blocked.scan ?? '', /ask an owner or admin here to grant it\.$/);
    assert.match(blocked.single ?? '', /^One book needs the Photo scan permission/);
    // The paid tab says so, because "why can't I" and "why would I" are
    // different questions and this one answers both.
    assert.match(blocked.single ?? '', /costs money to run/);
  });

  it('only reports on the tabs it was asked about', () => {
    // /add passes its own list; a sentence about a tab that screen does not
    // render would be an answer to a question nobody asked.
    assert.deepEqual(blockedAddModes(MEMBER, ['type']), {});
  });
});

describe('firstUsableMode', () => {
  it('takes the preferred tab when it is usable', () => {
    assert.equal(firstUsableMode(WISHLIST_ADD_MODES, {}, 'scan'), 'scan');
  });

  it('never opens on a blocked tab', () => {
    const blocked = blockedAddModes(MEMBER);
    assert.equal(firstUsableMode(WISHLIST_ADD_MODES, blocked, 'scan'), 'type');
  });

  it('falls to the first offered tab when nothing is preferred', () => {
    assert.equal(firstUsableMode(WISHLIST_ADD_MODES, {}), 'type');
  });

  it('ignores a preferred tab this door does not offer at all', () => {
    // `/add` can hand `?mode=photo` to a door that has no shelf photo.
    assert.equal(firstUsableMode(WISHLIST_ADD_MODES, {}, 'photo'), 'type');
  });
});
