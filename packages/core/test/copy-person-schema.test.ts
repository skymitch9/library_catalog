/**
 * The copy PATCH shape, where WHO has the book is concerned.
 *
 * Two properties, both of which have already cost this repo real bugs in other
 * fields and would cost it the same ones here:
 *
 * 1. ⚠️ **A one-key PATCH resets nothing.** `updateCopySchema` is
 *    `createCopySchema.partial()`, and `createCopySchema` carries `.default()`s
 *    (`status`, `currency`, `isSigned`). Zod wraps each field as
 *    `ZodOptional<ZodDefault<…>>` and an absent key short-circuits at the
 *    `ZodOptional`, so the default never fires. That is what makes
 *    `{ personName: 'Samantha' }` a safe request rather than one that silently
 *    sets the copy back to `owned`, `USD` and unsigned — and it is asserted
 *    here rather than assumed, because it is a property of zod's wrapping order
 *    and not of anything written in this file.
 *
 * 2. ⚠️ **`.strict()` still refuses an unknown key.** The reason is recorded at
 *    length beside `updateWorkSchema`: a silently stripped field returns 200
 *    having changed nothing, which an audit log then turns from a lie into
 *    manufactured evidence. Adding two fields is exactly the moment a
 *    near-miss spelling (`person_name`, `personId`) starts arriving.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCopySchema, updateCopySchema } from '../src/schemas.js';

describe('updateCopySchema — a one-key person PATCH resets nothing', () => {
  it('{ personName } parses to exactly that one key', () => {
    const parsed = updateCopySchema.parse({ personName: 'Samantha' });
    assert.deepEqual(parsed, { personName: 'Samantha' });
    // Said individually as well as by deepEqual, because these three are the
    // defaults that would do damage if they fired: a lend would come back
    // owned, in dollars, unsigned.
    assert.ok(!('status' in parsed), 'a default status would un-lend the copy');
    assert.ok(!('currency' in parsed), 'a default currency would rewrite the price');
    assert.ok(!('isSigned' in parsed), 'a default isSigned would erase a signature');
    assert.ok(!('personUserId' in parsed), 'an absent id must stay absent, not become null');
  });

  it('the pair the UI actually sends carries both keys and nothing else', () => {
    const parsed = updateCopySchema.parse({ personUserId: 7, personName: 'Samantha Ellis' });
    assert.deepEqual(parsed, { personUserId: 7, personName: 'Samantha Ellis' });
  });

  it('an explicit null unlinks — and is NOT the same as omitting the key', () => {
    assert.deepEqual(updateCopySchema.parse({ personUserId: null }), { personUserId: null });
    assert.deepEqual(updateCopySchema.parse({}), {});
  });

  it('a blank name is absent, not a name made of spaces', () => {
    // `optionalText` trims and folds '' to null, so clearing the box clears the
    // field rather than storing whitespace that renders as "Lent to  ".
    assert.deepEqual(updateCopySchema.parse({ personName: '   ' }), { personName: null });
  });

  it('a status change and a person travel together in one patch', () => {
    const parsed = updateCopySchema.parse({ status: 'lent', personName: 'Samantha' });
    assert.deepEqual(parsed, { status: 'lent', personName: 'Samantha' });
  });
});

describe('updateCopySchema — .strict() still refuses', () => {
  for (const stray of ['person_name', 'personId', 'lentToUser', 'personDisplayName']) {
    it(`refuses '${stray}' rather than stripping it`, () => {
      const res = updateCopySchema.safeParse({ [stray]: 'Samantha' });
      assert.equal(res.success, false, `'${stray}' was accepted — a stripped key is a silent lie`);
    });
  }

  it('names the offending key, so the 400 is a bug report', () => {
    const res = updateCopySchema.safeParse({ person_name: 'Samantha' });
    assert.equal(res.success, false);
    if (!res.success) {
      assert.match(JSON.stringify(res.error.issues), /person_name/);
    }
  });
});

describe('createCopySchema — the person fields on a create', () => {
  it('a positive integer id, or null, and nothing else', () => {
    assert.equal(createCopySchema.safeParse({ workId: 1, personUserId: 0 }).success, false);
    assert.equal(createCopySchema.safeParse({ workId: 1, personUserId: -3 }).success, false);
    assert.equal(createCopySchema.safeParse({ workId: 1, personUserId: 1.5 }).success, false);
    assert.equal(createCopySchema.safeParse({ workId: 1, personUserId: '7' }).success, false);
    assert.equal(createCopySchema.safeParse({ workId: 1, personUserId: null }).success, true);
    assert.equal(createCopySchema.safeParse({ workId: 1, personUserId: 7 }).success, true);
  });

  it('a create with neither is the ordinary case and still defaults to owned', () => {
    const parsed = createCopySchema.parse({ workId: 1 });
    assert.equal(parsed.status, 'owned');
    assert.equal(parsed.personUserId, undefined);
    assert.equal(parsed.personName, undefined);
  });
});
