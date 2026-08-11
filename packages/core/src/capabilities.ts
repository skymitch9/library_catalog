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
  read: ['owner', 'manager', 'reader'],
  /** Set their own read-state, and rate a book. */
  trackReading: ['owner', 'manager', 'reader'],
  /** Add or change works, editions, copies. */
  editCatalog: ['owner', 'manager'],
  /** Scan — a photo costs money, an ISBN does not, and the gate is per-role not per-cost. */
  scan: ['owner', 'manager'],
  /**
   * Spend money: trigger LLM research runs.
   *
   * `manager` is included by the owner's explicit choice. With `scan`, these are
   * the two capabilities here that carry a bill and have no cap in the app, so
   * if the spend ever becomes uncomfortable these are the lines to change —
   * not the role.
   */
  runResearch: ['owner', 'manager'],
  /** Accept or reject research findings into the catalog. */
  reviewFindings: ['owner', 'manager'],
  /**
   * Approve a pending user, change roles.
   *
   * ⚠️ **The only owner-exclusive capability, and the entire point of `manager`.**
   * Every other row above lists `manager`, which makes the rule one sentence: a
   * manager can do anything to the catalog and nothing to the guest list.
   *
   * Keep it that way. If a capability is added later and `manager` is left out
   * without a reason written beside it, the role quietly stops meaning what it
   * is called — and the People page tells a human it means "everything except
   * managing people".
   */
  manageUsers: ['owner'],
} as const satisfies Record<string, readonly Role[]>;
