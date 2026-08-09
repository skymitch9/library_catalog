import type { Role } from './constants.js';

/**
 * What each role may do, expressed once so the Worker and the UI cannot drift.
 * Routes gate on a capability rather than a role, so adding a role later does
 * not mean auditing every route.
 *
 * `reader` replaces the board game catalog's `rater`: reading is the thing a
 * second person does here, and rating rides along with it. Read-state is
 * per-person, so a reader must be able to write their own — which is why
 * `trackReading` is a capability and not folded into `editCatalog`.
 */
export const CAPABILITY_MATRIX = {
  /** See the collection at all. */
  read: ['owner', 'reader'],
  /** Set their own read-state, and rate a book. */
  trackReading: ['owner', 'reader'],
  /** Add or change works, editions, copies. */
  editCatalog: ['owner'],
  /** Scan — a photo costs money, an ISBN does not, and the gate is per-role not per-cost. */
  scan: ['owner'],
  /** Spend money: trigger LLM research runs. */
  runResearch: ['owner'],
  /** Accept or reject research findings into the catalog. */
  reviewFindings: ['owner'],
  /** Approve a pending user, change roles. */
  manageUsers: ['owner'],
} as const satisfies Record<string, readonly Role[]>;
