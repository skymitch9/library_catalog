/**
 * What the content-notes panel OFFERS, pinned without a DOM.
 *
 * The affordance rules are the half of this feature a browser check would be
 * least likely to catch: a Remove button drawn for somebody the rules will
 * refuse looks fine until it is pressed, and one withheld from a person who
 * may use it looks like the feature simply not existing. `buildNoteRows` is
 * split out of the component for exactly this reason — the same split
 * `deriveShelfView` uses under `OnYourShelf.tsx`.
 *
 * ⚠️ **It imports the leaf, NOT the component**, and that was measured rather
 * than assumed: the first draft imported `ContentNotes.tsx` and crashed at
 * module load with *"Cannot read properties of undefined (reading
 * 'VITE_FIREBASE_API_KEY')"*, because the component reaches `firebase.ts`,
 * which reads `import.meta.env` at module scope. `error-wording.ts`'s header
 * records the same trap for the 503 wording; `lib/note-rows.ts` exists for the
 * same reason and must keep importing nothing but `@lc/core`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildNoteRows } from '../src/lib/note-rows.ts';
import { describeStoreError } from '../src/lib/error-wording.ts';

const mine = { id: 'a', label: 'Animal cruelty', displayName: 'Skylar', authorUid: 'uid-1' };
const theirs = { id: 'b', label: 'War', displayName: 'Amber Mitchell', authorUid: 'uid-2' };
/** Written before the 2026-08-17 delete binding, or by a legacy session. */
const unstamped = { id: 'c', label: 'Grief', displayName: 'Skylar' };

describe('who is offered a Remove control', () => {
  it('offers it on my own note and on nobody else’s', () => {
    const rows = buildNoteRows({
      warnings: [mine, theirs],
      uid: 'uid-1',
      displayName: 'Skylar',
      canModerate: false,
    });
    assert.deepEqual(rows.map((r) => r.canDelete), [true, false]);
    assert.equal(rows[0].asModerator, false);
    // ⚠️ Never a bare absence: the refusal is a sentence, ready for the moment
    // somebody asks why.
    assert.match(rows[1].refusal ?? '', /only remove notes you added/i);
  });

  it('offers it on everyone’s to a moderator, and says which power was used', () => {
    const rows = buildNoteRows({
      warnings: [mine, theirs],
      uid: 'uid-1',
      displayName: 'Skylar',
      canModerate: true,
    });
    assert.deepEqual(rows.map((r) => r.canDelete), [true, true]);
    // The distinction is load-bearing: a refusal on a moderator delete has to
    // name the ESTATE role (site_roles), which is a different record from this
    // catalog's, and only this flag tells the two cases apart.
    assert.equal(rows[0].asModerator, false, 'my own note is deleted as its author, not as a moderator');
    assert.equal(rows[1].asModerator, true);
  });

  /**
   * ⚠️ A note with my NAME but no `authorUid` is not mine to delete —
   * `firestore.rules` binds on the uid, so offering the control here would draw
   * a button the store refuses. The sentence says how to make it deletable.
   */
  it('withholds it on an unstamped note, and explains rather than dead-ends', () => {
    const [row] = buildNoteRows({
      warnings: [unstamped],
      uid: 'uid-1',
      displayName: 'Skylar',
      canModerate: false,
    });
    assert.equal(row.canDelete, false);
    assert.match(row.refusal ?? '', /add it again/i);
  });

  it('never renders a blank credit', () => {
    const [row] = buildNoteRows({
      warnings: [{ id: 'd', label: 'Blood', displayName: '  ' }],
      uid: null,
      displayName: null,
      canModerate: false,
    });
    assert.equal(row.credit, 'somebody');
  });
});

/**
 * The other store's refusals, in words. `describeError` handles the Worker's
 * `ApiError`; this is Firestore's, and without it the panel would print the
 * SDK's own "Missing or insufficient permissions." — a bare code wearing a
 * sentence's clothes.
 */
describe('a Firestore failure is never shown raw', () => {
  it('a permission refusal names what would help', () => {
    const denied = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    assert.match(describeStoreError(denied), /not allowed|refused/i);
    assert.match(
      describeStoreError(denied, { need: 'the estate-wide moderator role' }),
      /estate-wide moderator role/,
    );
  });

  /**
   * ⚠️ The estate rule this exists for: **a network or server failure is NOT a
   * permission failure.** Mislabelling one sends people asking for access they
   * already have.
   */
  it('an outage does not read as a permission problem', () => {
    const out = describeStoreError({ code: 'unavailable', message: 'backend unavailable' });
    assert.match(out, /connection|reach/i);
    assert.doesNotMatch(out, /permission|role|allowed/i);

    const offline = describeStoreError(new TypeError('Failed to fetch'));
    assert.doesNotMatch(offline, /permission|role/i);
  });

  it('an expired session says so, rather than blaming the role', () => {
    const out = describeStoreError({ code: 'unauthenticated', message: 'x' });
    assert.match(out, /sign in again/i);
  });
});
