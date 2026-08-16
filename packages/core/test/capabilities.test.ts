/**
 * The 2026-08-16 role ladder redesign, pinned.
 *
 * Three things this guards, each silently: the migration invariant that
 * `manager`'s old capabilities are a strict subset of `moderator`'s new ones
 * (nobody who could do something yesterday may lose it today — constants.ts
 * and capabilities.ts both cite this), the two wishlist/scan splits actually
 * landing at the rungs the owner approved, and `canGrantRole`'s no-
 * self-escalation rule, which is the one thing standing between `admin` and
 * `admin` minting more admins.
 *
 * Run with `npm test` (Node 22+ strips the types; no build step, no framework).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAPABILITY_MATRIX, canGrantRole } from '../src/capabilities.ts';
import { ROLE_LADDER, ROLES, type Role } from '../src/constants.ts';

function can(role: Role, capability: keyof typeof CAPABILITY_MATRIX): boolean {
  return (CAPABILITY_MATRIX[capability] as readonly Role[]).includes(role);
}

describe('the ladder itself', () => {
  it('is cumulative low to high, pending excluded', () => {
    assert.deepEqual(ROLE_LADDER, [
      'guest',
      'member',
      'contributor',
      'moderator',
      'admin',
      'owner',
    ]);
    assert.ok(!(ROLE_LADDER as readonly string[]).includes('pending'));
  });

  it('ROLES carries every ladder rung plus the pending status', () => {
    for (const r of ROLE_LADDER) assert.ok((ROLES as readonly string[]).includes(r));
    assert.ok((ROLES as readonly string[]).includes('pending'));
    assert.equal(ROLES.length, ROLE_LADDER.length + 1);
  });

  it('the old manager/reader names are gone', () => {
    assert.ok(!(ROLES as readonly string[]).includes('manager'));
    assert.ok(!(ROLES as readonly string[]).includes('reader'));
  });
});

describe('migration invariant: manager -> moderator loses nothing', () => {
  // The pre-redesign CAPABILITY_MATRIX, verbatim from git history (0008's
  // shape), so this test fails loudly if anyone "simplifies" it away instead
  // of asking whether the invariant it pins still holds.
  const OLD_MANAGER_CAPABILITIES = new Set([
    'read',
    'trackReading',
    'editCatalog',
    'scan',
    'runResearch',
    'reviewFindings',
  ]);

  it('every capability the old manager held, moderator still holds', () => {
    // scan -> split into scanBarcode (contributor+) and scanPhoto
    // (moderator+); manager held the whole thing, so moderator must hold
    // both halves for the subset claim to hold on the split capability too.
    const NEW_EQUIVALENT: Record<string, readonly string[]> = {
      scan: ['scanBarcode', 'scanPhoto'],
    };
    for (const oldCap of OLD_MANAGER_CAPABILITIES) {
      const newCaps = NEW_EQUIVALENT[oldCap] ?? [oldCap];
      for (const newCap of newCaps) {
        assert.ok(
          can('moderator', newCap as keyof typeof CAPABILITY_MATRIX),
          `moderator lost old manager capability '${oldCap}' (as '${newCap}')`,
        );
      }
    }
  });

  it('manageUsers stays the one capability manager never had, that moderator still lacks', () => {
    assert.equal(can('moderator', 'manageUsers'), false);
  });
});

describe('split #1: wishlist (suggest vs manage)', () => {
  it('member may suggest but not manage', () => {
    assert.equal(can('member', 'suggestWishlist'), true);
    assert.equal(can('member', 'manageWishlist'), false);
  });

  it('contributor and above may do both', () => {
    for (const role of ['contributor', 'moderator', 'admin', 'owner'] as const) {
      assert.equal(can(role, 'suggestWishlist'), true, `${role} should suggestWishlist`);
      assert.equal(can(role, 'manageWishlist'), true, `${role} should manageWishlist`);
    }
  });

  it('guest may do neither', () => {
    assert.equal(can('guest', 'suggestWishlist'), false);
    assert.equal(can('guest', 'manageWishlist'), false);
  });
});

describe('split #2: scan (barcode free vs photo costs money)', () => {
  it('contributor may scan a barcode but not a photo', () => {
    assert.equal(can('contributor', 'scanBarcode'), true);
    assert.equal(can('contributor', 'scanPhoto'), false);
  });

  it('moderator and above may do both', () => {
    for (const role of ['moderator', 'admin', 'owner'] as const) {
      assert.equal(can(role, 'scanBarcode'), true, `${role} should scanBarcode`);
      assert.equal(can(role, 'scanPhoto'), true, `${role} should scanPhoto`);
    }
  });

  it('member may do neither', () => {
    assert.equal(can('member', 'scanBarcode'), false);
    assert.equal(can('member', 'scanPhoto'), false);
  });
});

describe('split #3: admin is new, holds manageUsers, capped by canGrantRole', () => {
  it('admin holds manageUsers; moderator does not', () => {
    assert.equal(can('admin', 'manageUsers'), true);
    assert.equal(can('moderator', 'manageUsers'), false);
  });

  it('admin attempting to grant admin -> FAILS (no self-escalation)', () => {
    assert.equal(canGrantRole('admin', 'admin'), false);
  });

  it('admin attempting to grant moderator -> PASSES (strictly beneath)', () => {
    assert.equal(canGrantRole('admin', 'moderator'), true);
  });

  it('moderator attempting to grant admin -> FAILS (moderator has no manageUsers anyway)', () => {
    assert.equal(canGrantRole('moderator', 'admin'), false);
  });

  it('owner granting admin -> PASSES', () => {
    assert.equal(canGrantRole('owner', 'admin'), true);
  });

  it('owner granting owner -> PASSES, deliberately: owner is unbounded, not "strictly beneath owner" — see the comment on canGrantRole for why (a second owner is a real, historical case, migration 0008)', () => {
    assert.equal(canGrantRole('owner', 'owner'), true);
  });

  it('every role may grant pending (a revoke), including a rank below itself', () => {
    for (const role of ROLE_LADDER) assert.equal(canGrantRole(role, 'pending'), true);
  });

  it('a pending actor grants no real role (granting pending itself is the vacuous revoke case, always true)', () => {
    for (const role of ROLE_LADDER) assert.equal(canGrantRole('pending', role), false);
    assert.equal(canGrantRole('pending', 'pending'), true);
  });

  it('the full ladder: strictly-beneath holds for every pair except owner', () => {
    for (const granter of ROLE_LADDER) {
      for (const target of ROLE_LADDER) {
        const expected =
          granter === 'owner' ? true : ROLE_LADDER.indexOf(target) < ROLE_LADDER.indexOf(granter);
        assert.equal(
          canGrantRole(granter, target),
          expected,
          `canGrantRole(${granter}, ${target})`,
        );
      }
    }
  });
});

describe('read stays universal short of pending', () => {
  it('every ladder role can read, including guest', () => {
    for (const role of ROLE_LADDER) assert.equal(can(role, 'read'), true, `${role} should read`);
  });
});
