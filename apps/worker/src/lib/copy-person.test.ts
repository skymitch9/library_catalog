/**
 * WHO has the book — the redaction rule, exercised for each of the three
 * caller classes it distinguishes.
 *
 * ⚠️ **Redaction is the one property here whose failure is silent.** A leak
 * renders as a name on a card that looks exactly like a name that was supposed
 * to be there; nothing errors, nothing 500s, and the person who would notice is
 * the one who cannot see the page. So this pins the rule from both sides — that
 * the name is present for those who may see it, and `null` for those who may
 * not — rather than only asserting "something came back".
 *
 * The three classes, which are the whole design (owner decision #2, 2026-08-23):
 *
 *   1. holds `editCatalog`      → sees the name
 *   2. IS the linked person     → sees the name on their OWN row
 *   3. anybody else             → both fields null, status untouched
 *
 * Class 2 is the interesting one and the reason class 3 is tested inside the
 * SAME batch: a member with one row of their own must not be handed everybody
 * else's while resolving it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Role } from '@lc/core';
import { maySeeCopyPerson, withCopyPeople, type CopyPersonFields } from './copy-person.js';

/** A copy row, cut down to the fields the rule reads plus one it must not touch. */
interface Row extends CopyPersonFields {
  id: number;
  status: string;
}

const SAMANTHA = 7;
const JUSTIN = 9;

function row(id: number, over: Partial<Row> = {}): Row {
  return {
    id,
    status: 'lent',
    person_user_id: null,
    person_name: null,
    ...over,
  };
}

/**
 * A D1 stub answering only the query `memberDisplayNames` makes.
 *
 * It records the ids it was asked for, because "did the redacted rows leak into
 * the lookup?" is a real question: a batch that resolves every id and only
 * *then* blanks the invisible ones would pass a naive output assertion while
 * still reading names it had no business reading.
 */
function stubDb(names: Record<number, string | null>) {
  const asked: number[][] = [];
  return {
    asked,
    db: {
      prepare: () => ({
        bind: (...ids: number[]) => {
          asked.push(ids);
          return {
            all: async () => ({
              results: ids.map((id) => ({ id, display_name: names[id] ?? null })),
            }),
          };
        },
      }),
    } as unknown as D1Database,
  };
}

const viewer = (id: number, role: Role) => ({ id, role });

describe('maySeeCopyPerson — the three caller classes', () => {
  const lent = row(1, { person_user_id: SAMANTHA, person_name: 'Sam' });

  it('class 1: an editor may see it', () => {
    for (const role of ['owner', 'admin', 'moderator', 'contributor'] as Role[]) {
      assert.equal(maySeeCopyPerson(lent, viewer(99, role)), true, `${role} holds editCatalog`);
    }
  });

  it('class 2: the linked person may see it, whatever their role', () => {
    assert.equal(maySeeCopyPerson(lent, viewer(SAMANTHA, 'member')), true);
    assert.equal(maySeeCopyPerson(lent, viewer(SAMANTHA, 'guest')), true);
  });

  it('class 3: everybody else may not', () => {
    assert.equal(maySeeCopyPerson(lent, viewer(JUSTIN, 'member')), false);
    assert.equal(maySeeCopyPerson(lent, viewer(JUSTIN, 'guest')), false);
    assert.equal(maySeeCopyPerson(lent, viewer(JUSTIN, 'pending')), false);
  });

  it('an UNLINKED row is nobody’s own row — a member never matches a bare name', () => {
    const typed = row(2, { person_user_id: null, person_name: 'Samantha' });
    assert.equal(
      maySeeCopyPerson(typed, viewer(SAMANTHA, 'member')),
      false,
      'a null id must never equal a viewer id — a name match grants nothing',
    );
  });
});

describe('withCopyPeople — what each class actually receives', () => {
  it('class 1: an editor gets the member’s CURRENT display name, not the stored text', async () => {
    const { db } = stubDb({ [SAMANTHA]: 'Samantha Ellis' });
    const [out] = await withCopyPeople(
      db,
      [row(1, { person_user_id: SAMANTHA, person_name: 'Sam' })],
      viewer(1, 'moderator'),
    );
    assert.equal(out?.person_name, 'Samantha Ellis', 'the live join is the owner’s decision');
    assert.equal(out?.person_user_id, SAMANTHA);
  });

  it('class 2: the linked person sees their own row', async () => {
    const { db } = stubDb({ [SAMANTHA]: 'Samantha Ellis' });
    const [out] = await withCopyPeople(
      db,
      [row(1, { person_user_id: SAMANTHA, person_name: 'Sam' })],
      viewer(SAMANTHA, 'member'),
    );
    assert.equal(out?.person_name, 'Samantha Ellis');
  });

  it('class 3: a stranger gets nulls, and the status is left alone', async () => {
    const { db, asked } = stubDb({ [SAMANTHA]: 'Samantha Ellis' });
    const [out] = await withCopyPeople(
      db,
      [row(1, { status: 'lent', person_user_id: SAMANTHA, person_name: 'Sam' })],
      viewer(JUSTIN, 'member'),
    );
    assert.equal(out?.person_name, null, 'the name must not travel');
    assert.equal(out?.person_user_id, null, 'nor the id — it is a lookup key for the name');
    assert.equal(out?.status, 'lent', 'the STATUS WORD stays: lent is not the same as missing');
    assert.deepEqual(asked, [], 'a name nobody may see must not even be looked up');
  });

  it('a member sees their own row and nobody else’s, in one batch', async () => {
    const { db, asked } = stubDb({ [SAMANTHA]: 'Samantha Ellis', [JUSTIN]: 'Justin' });
    const out = await withCopyPeople(
      db,
      [
        row(1, { person_user_id: SAMANTHA, person_name: 'Sam' }),
        row(2, { person_user_id: JUSTIN, person_name: 'J' }),
        row(3, { person_user_id: null, person_name: 'a stranger' }),
      ],
      viewer(SAMANTHA, 'member'),
    );
    assert.equal(out[0]?.person_name, 'Samantha Ellis');
    assert.equal(out[1]?.person_name, null, 'somebody else’s borrower must not leak');
    assert.equal(out[2]?.person_name, null, 'a typed stranger is not this member’s business');
    assert.deepEqual(asked, [[SAMANTHA]], 'only the visible id was ever resolved');
  });

  it('the typed text is the FALLBACK when the link resolves to nothing', async () => {
    // A member whose Google account never supplied a display name, and an id
    // that no longer names anybody. Both must leave the record readable.
    const { db } = stubDb({ [SAMANTHA]: null });
    const out = await withCopyPeople(
      db,
      [
        row(1, { person_user_id: SAMANTHA, person_name: 'Sam' }),
        row(2, { person_user_id: 404, person_name: 'Gone Away' }),
      ],
      viewer(1, 'owner'),
    );
    assert.equal(out[0]?.person_name, 'Sam', 'a member with no display name falls back to the text');
    assert.equal(out[1]?.person_name, 'Gone Away', 'an id naming nobody still leaves a name');
  });

  it('a copy with no person at all costs no query', async () => {
    const { db, asked } = stubDb({});
    const out = await withCopyPeople(db, [row(1, { status: 'owned' })], viewer(1, 'owner'));
    assert.equal(out[0]?.person_name, null);
    assert.deepEqual(asked, [], 'the ordinary book page must not pay for this feature');
  });

  it('does not mutate the rows it was handed', async () => {
    const { db } = stubDb({ [SAMANTHA]: 'Samantha Ellis' });
    const input = row(1, { person_user_id: SAMANTHA, person_name: 'Sam' });
    await withCopyPeople(db, [input], viewer(JUSTIN, 'guest'));
    assert.equal(input.person_name, 'Sam', 'the caller’s row is the DB row — redact a copy of it');
  });
});
