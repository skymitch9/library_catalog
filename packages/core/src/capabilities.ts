import { ROLE_LADDER, type Role } from './constants.js';

/**
 * What each role may do, expressed once so the Worker and the UI cannot drift.
 * Routes gate on a capability rather than a role, so adding a role later does
 * not mean auditing every route.
 *
 * ## The 2026-08-16 ladder redesign — owner-approved verbatim ("Role matrix
 * approved")
 *
 * Six roles now, cumulative: `guest < member < contributor < moderator <
 * admin < owner` (constants.ts). `manager` → `moderator` and `reader` →
 * `member` (migration 0300); every row below is written so **`manager`'s old
 * set is a strict subset of `moderator`'s new one** — nobody who could do
 * something yesterday loses it today. `guest`, `contributor` and `admin` are
 * new rungs; nobody is migrated into them.
 *
 * `reader` used to replace the board game catalog's `rater`, for the reason
 * recorded here originally: reading is the thing a second person does, and
 * rating rides along with it. `member` inherits that same pairing —
 * `trackReading` is still its own capability, not folded into `editCatalog`,
 * because read-state is per-person and a member must be able to write their
 * own.
 */
export const CAPABILITY_MATRIX = {
  /** See the collection at all. */
  read: ['owner', 'admin', 'moderator', 'contributor', 'member', 'guest'],
  /** Set their own read-state, and rate a book. */
  trackReading: ['owner', 'admin', 'moderator', 'contributor', 'member'],
  /**
   * Ask for a thing — "I want this" — split #1's member half. Creates the
   * underlying `work` row (if the book is not catalogued yet) and a `wanted`
   * / `preordered` `copy`. Never edits or removes anyone's ask, including
   * their own past the moment of asking — that is `manageWishlist`.
   */
  suggestWishlist: ['owner', 'admin', 'moderator', 'contributor', 'member'],
  /** Add or change works, editions, copies. */
  editCatalog: ['owner', 'admin', 'moderator', 'contributor'],
  /**
   * Curate the wishlist — edit, remove, prioritise, or promote a wanted copy
   * to owned. Split #1's contributor half: today's wishlist sat wholly inside
   * `editCatalog`, so only a manager (now moderator+) could touch it at all;
   * `suggestWishlist` above is what now lets a member ask without needing
   * this.
   */
  manageWishlist: ['owner', 'admin', 'moderator', 'contributor'],
  /**
   * Scan a barcode — free, no vision call. Split #2's contributor half: this
   * repo used to have one `scan` capability covering both a barcode and a
   * photo; see `scanPhoto` immediately below for why they are now two and
   * what this comment used to say about the line to move.
   */
  scanBarcode: ['owner', 'admin', 'moderator', 'contributor'],
  /**
   * ⚠️ Scan a PHOTO — a shelf or a single cover — which bills the vision API.
   * Split #2's moderator half, done 2026-08-16 **because it costs money**:
   * `scanBarcode` stays free at contributor+, this moved to moderator+. This
   * repo's own `scan-jobs.ts` had already gated its two photo routes
   * (`/shelf`, `/single`) on `runResearch` rather than the old `scan`, for
   * exactly this reason, before this capability existed to say so by name —
   * both routes are repointed here now that it does. The old `scan`
   * capability's comment named this the line to change "if the spend ever
   * becomes uncomfortable"; this is that change.
   */
  scanPhoto: ['owner', 'admin', 'moderator'],
  /**
   * Spend money: trigger LLM research runs.
   *
   * `moderator` (formerly `manager`) is included by the owner's explicit
   * choice, unchanged from the original decision and just renamed. With
   * `scanPhoto`, these are the two capabilities here that carry a bill and
   * have no cap in the app — if the spend ever becomes uncomfortable these
   * are still the lines to change, not the role.
   */
  runResearch: ['owner', 'admin', 'moderator'],
  /** Accept or reject research findings into the catalog. */
  reviewFindings: ['owner', 'admin', 'moderator'],
  /**
   * Approve a pending user, change roles.
   *
   * ⚠️ No longer owner-exclusive. `admin` is new 2026-08-16, specifically to
   * delegate this without handing over everything else — the old comment
   * here said keeping this one job to itself was "the entire point of
   * `manager`"; that job is now `admin`'s. `canGrantRole` below is the cap
   * that makes the delegation safe: an admin may grant anything strictly
   * beneath its own rung and nothing at or above it, so only `owner` may
   * grant `admin` (or `owner`).
   */
  manageUsers: ['owner', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

/**
 * Whether `granterRole` may set somebody's role to `targetRole`.
 *
 * Owner-decided escalation limit (2026-08-16, role matrix approved verbatim):
 * *"you may grant any role strictly beneath your own"* — no self-escalation,
 * no peer-promotion. This is what stops `admin` — which holds `manageUsers`,
 * see CAPABILITY_MATRIX above — from minting another `admin` or an `owner`;
 * only `owner` can do either. Used by `apps/worker/src/routes/users.ts` and
 * `routes/admin.ts`, the two routes that write `app_user.role`, alongside
 * their existing "the last owner cannot demote themselves" guard — the two
 * checks are independent and both must pass.
 *
 * Ranked on `ROLE_LADDER` (constants.ts), which excludes `pending` on
 * purpose: `pending` is a status, not a rung, so it is handled separately
 * here rather than ranked —
 *   - granting `pending` (a revoke) is always allowed: it removes standing,
 *     never grants any, so the escalation rule has nothing to say about it.
 *   - a `pending` actor grants nothing. `manageUsers` never reaches one in
 *     practice (CAPABILITY_MATRIX has no `pending` row for it), but this
 *     stays a total function and refuses rather than mis-ranking an input it
 *     should never see.
 *
 * `owner` is deliberately UNBOUNDED rather than "strictly beneath owner",
 * which would forbid an owner from ever granting `owner` — including to a
 * second person. That case is real, not hypothetical: migration 0008's own
 * history is two people who were BOTH `owner` purely so both could add books,
 * before `manager` (now `moderator`) existed to make that unnecessary for the
 * catalog half of the job. The escalation limit exists to cap `admin`, which
 * is new and holds a capability it never held before; it was never meant to
 * take away something an owner could already do.
 */
export function canGrantRole(granterRole: Role, targetRole: Role): boolean {
  if (targetRole === 'pending') return true;
  if (granterRole === 'owner') return true;
  if (granterRole === 'pending') return false;
  return ROLE_LADDER.indexOf(targetRole as (typeof ROLE_LADDER)[number]) <
    ROLE_LADDER.indexOf(granterRole as (typeof ROLE_LADDER)[number]);
}
