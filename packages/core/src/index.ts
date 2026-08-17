/**
 * Shared domain vocabulary for the library catalog.
 *
 * Types, schemas and pure rules only — no database access, no fetch, no Worker
 * or Node globals. The Worker, the CLI and the web app all import it, so
 * anything with I/O in it belongs somewhere else.
 *
 * ⚠️ Import order matters: `constants.ts` is the leaf, `schemas.ts` builds on
 * it, and this file re-exports both. **Nothing under src/ may import from this
 * file.** Doing so reintroduces a cycle that makes `z.enum()` receive
 * `undefined` and every write endpoint return 500 with a misleading message, and
 * typecheck does not catch it. Carried across from the Board Game Catalog, where
 * it happened.
 */

import { z } from 'zod';
import { CAPABILITY_MATRIX } from './capabilities.js';
import { ROLES, type Role, type SourceTier } from './constants.js';

export * from './constants.js';
export * from './capabilities.js';
export * from './completeness.js';
export * from './covers.js';
export * from './gabi-tools.js';
export * from './gaps.js';
export * from './holdings.js';
export * from './ebook-holding.js';
export * from './preorders.js';
export * from './rescan.js';
export * from './isbn.js';
export * from './titles.js';
export * from './matching.js';
export * from './corroboration.js';
export * from './crowdfunding.js';
export * from './reviews.js';
export * from './readstate.js';
export * from './tbr.js';
export * from './warnings.js';
export * from './vision.js';
export * from './scanjobs.js';
export * from './schemas.js';

export const roleEnum = z.enum(ROLES);

export interface AppUser {
  id: number;
  email: string;
  firebaseUid: string | null;
  displayName: string | null;
  /** The name this person's reviews are filed under. See reviews.ts. */
  reviewName: string | null;
  photoUrl: string | null;
  role: Role;
  firstSeenAt: string;
  approvedAt: string | null;
}

export type Capability = keyof typeof CAPABILITY_MATRIX;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITY_MATRIX[capability] as readonly Role[]).includes(role);
}

/** Capabilities the given role holds, for the UI to gate on. */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITY_MATRIX) as Capability[]).filter((c) => can(role, c));
}

export function tierRank(tier: SourceTier): number {
  return (['official', 'crowdfunding', 'retail', 'community'] as readonly string[]).indexOf(tier);
}

/** True when `a` should beat `b` on a conflicting claim about the same field. */
export function outranks(a: SourceTier, b: SourceTier): boolean {
  return tierRank(a) < tierRank(b);
}
