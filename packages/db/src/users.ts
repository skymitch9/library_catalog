import type { AppUser, Role } from '@lc/core';
import { ROW_FIELD, changeLogInsert } from './changes.js';

interface UserRow {
  id: number;
  email: string;
  firebase_uid: string | null;
  display_name: string | null;
  review_name: string | null;
  photo_url: string | null;
  role: string;
  first_seen_at: string;
  approved_at: string | null;
  /** Migration 0490. Absent on a fake that predates it, which reads as 0. */
  placeholder?: number | null;
}

const COLS =
  'id, email, firebase_uid, display_name, review_name, photo_url, role, first_seen_at, approved_at, placeholder';

function toUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    firebaseUid: row.firebase_uid,
    displayName: row.display_name,
    reviewName: row.review_name,
    photoUrl: row.photo_url,
    role: row.role as Role,
    firstSeenAt: row.first_seen_at,
    approvedAt: row.approved_at,
    placeholder: row.placeholder === 1,
  };
}

export async function findUserByEmail(db: D1Database, email: string): Promise<AppUser | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM app_user WHERE email = ?`)
    .bind(email.toLowerCase())
    .first<UserRow>();
  return row ? toUser(row) : null;
}

/**
 * Find a catalog user by the Firebase uid recorded on their row.
 *
 * ⚠️ **A LOOKUP, NEVER A CREATE — and that asymmetry is the whole safety of the
 * delegated GABI verbs** (`apps/worker/src/routes/gabi-delegated.ts`). Every
 * other door into this table is `upsertUserOnLogin`, which runs only after a
 * Firebase ID token this Worker verified itself. The delegated door has no such
 * token: it carries a bot's app bearer plus somebody else's uid, so it must
 * never be able to *mint* standing on this instance. A uid nobody here has
 * signed in with resolves to `null`, and the caller answers in words.
 *
 * ⚠️ **The join is deliberately on `firebase_uid`, not on email**, even though
 * `upsertUserOnLogin` keys on email for the reasons written above it. The
 * Discord `/link` document records a `firebaseUid` and no email at all (that is
 * a deliberate minimisation in `catalog-platform/apps/discord-worker/src/link.ts`),
 * so a uid is the only identifier the bot can present. It is also the one that
 * survives an email change on the Google account.
 *
 * ⚠️ **A row whose `firebase_uid` is NULL can never match**, because the bind is
 * a real string and SQL never equates NULL. That is the correct direction: those
 * rows predate uid capture, and matching one on an empty uid would hand a
 * stranger the first unmigrated account in the table.
 */
export async function findUserByFirebaseUid(
  db: D1Database,
  firebaseUid: string,
): Promise<AppUser | null> {
  const uid = firebaseUid.trim();
  if (!uid) return null;
  const row = await db
    .prepare(`SELECT ${COLS} FROM app_user WHERE firebase_uid = ?`)
    .bind(uid)
    .first<UserRow>();
  return row ? toUser(row) : null;
}

/**
 * Resolve the signed-in Google identity to a catalog user, creating the row on
 * first sight.
 *
 * ## ⚠️ Keyed on email, and that is the whole point
 *
 * The owner's requirement is one account across this catalog and
 * `audiobook_catalog`. That site's identity is a Google sign-in whose email it
 * stores as `ab_identity_email`, and whose `isAdmin()` deliberately keys on the
 * email rather than the display name — because a Google display name can change
 * at any time and would silently drop access if it did.
 *
 * So this table keys on email too. `firebase_uid` is recorded because it is the
 * only identifier that survives an email change on the Google account, but
 * nothing joins on it: the *other* site has no uid to join to, since it signs
 * out of Firebase Auth immediately after capturing the identity.
 *
 * ## `reviewName`
 *
 * The name this person's reviews are filed under, because review document ids
 * are `{bookId}_{displayNameLower}`. Taken from the Google display name, which
 * is what that site writes. If it ever diverges, a person's reviews split into
 * two sets and neither is wrong — which is why it is stored rather than derived
 * per request, and why changing it is a deliberate act with a backfill attached.
 *
 * ## Bootstrap
 *
 * If the table is empty the first person to sign in becomes `owner` — that is
 * you, moments after deploying, because nobody else has the URL. Everyone
 * afterwards lands as `pending`. The rule is self-limiting: once any owner
 * exists it never applies again, so there is no window for a second claim.
 */
export async function upsertUserOnLogin(
  db: D1Database,
  params: {
    email: string;
    firebaseUid?: string | null;
    displayName?: string | null;
    photoUrl?: string | null;
    ownerEmails?: string[];
  },
): Promise<AppUser> {
  const email = params.email.toLowerCase();
  const existing = await findUserByEmail(db, email);
  const isRecoveryOwner = (params.ownerEmails ?? []).some(
    (e) => e.trim().toLowerCase() === email,
  );

  // A lend placeholder (migration 0490) is claimed as if this were a fresh
  // first sign-in — see claimPlaceholder. Every other existing row below.
  if (existing?.placeholder) {
    return claimPlaceholder(db, existing, params, email, isRecoveryOwner);
  }

  if (existing) {
    // Refresh the mutable Google-side facts, but never review_name once it is
    // set — see the note above.
    const nextName = params.displayName ?? existing.displayName;
    const nextPhoto = params.photoUrl ?? existing.photoUrl;
    const nextUid = params.firebaseUid ?? existing.firebaseUid;

    // ⚠️ THE RECOVERY HATCH, re-applied on sign-in — not only at INSERT. An
    // email in OWNER_EMAILS is forced back to `owner` whenever its existing row
    // holds any other role. Before this, OWNER_EMAILS was applied only when a
    // NEW row was created, so it could not recover the one situation it is
    // documented for: a row that already EXISTS with the wrong role (e.g. an
    // owner demoted by mistake). OWNER_EMAILS is an owner-controlled deploy var,
    // so this is the owner granting through a config only they can set, not an
    // open escalation. The role change carries an audit row like every other.
    const forceOwner = isRecoveryOwner && existing.role !== 'owner';
    const factsChanged =
      nextName !== existing.displayName ||
      nextPhoto !== existing.photoUrl ||
      nextUid !== existing.firebaseUid;

    if (forceOwner) {
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            `UPDATE app_user
                SET display_name = ?, photo_url = ?, firebase_uid = ?,
                    role = 'owner', approved_at = ?, approved_by = NULL
              WHERE id = ?`,
          )
          .bind(nextName, nextPhoto, nextUid, now, existing.id),
        changeLogInsert(db, {
          batchId: crypto.randomUUID(),
          entity: 'app_user',
          entityId: existing.id,
          field: 'role',
          oldJson: JSON.stringify(existing.role),
          newJson: JSON.stringify('owner'),
          actor: { userId: null, how: 'auto' },
          note: 'OWNER_EMAILS recovery hatch: re-forced owner on sign-in',
        }),
      ]);
      return {
        ...existing,
        displayName: nextName,
        photoUrl: nextPhoto,
        firebaseUid: nextUid,
        role: 'owner',
      };
    }

    if (factsChanged) {
      await db
        .prepare(
          'UPDATE app_user SET display_name = ?, photo_url = ?, firebase_uid = ? WHERE id = ?',
        )
        .bind(nextName, nextPhoto, nextUid, existing.id)
        .run();
      return { ...existing, displayName: nextName, photoUrl: nextPhoto, firebaseUid: nextUid };
    }
    return existing;
  }

  const reviewName = params.displayName ?? email;

  // The role decision happens inside the INSERT so "is the table empty?" and the
  // write are one atomic statement — two simultaneous first sign-ins cannot both
  // come out as owner.
  await db
    .prepare(
      `INSERT INTO app_user (email, firebase_uid, display_name, review_name, photo_url, role, approved_at)
       SELECT ?, ?, ?, ?, ?,
              CASE WHEN ? = 1 OR (SELECT COUNT(*) FROM app_user) = 0
                   THEN 'owner' ELSE 'pending' END,
              CASE WHEN ? = 1 OR (SELECT COUNT(*) FROM app_user) = 0
                   THEN ? ELSE NULL END
        WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE email = ?)`,
    )
    .bind(
      email,
      params.firebaseUid ?? null,
      params.displayName ?? null,
      reviewName,
      params.photoUrl ?? null,
      isRecoveryOwner ? 1 : 0,
      isRecoveryOwner ? 1 : 0,
      new Date().toISOString(),
      email,
    )
    .run();

  const created = await findUserByEmail(db, email);
  if (!created) throw new Error(`failed to create user record for ${email}`);
  return created;
}

/**
 * The real person's FIRST sign-in onto a lend placeholder (migration 0490).
 *
 * ⚠️ **The row must come out exactly as a fresh first sign-in would have made
 * it**, because a placeholder was written by somebody else, from the estate's
 * roster, and nothing on it is the person's own:
 *
 *   * `display_name`, `photo_url`, `firebase_uid` are the Google facts of THIS
 *     sign-in, with no fallback to the placeholder's estate display name — the
 *     INSERT branch writes `params.displayName ?? null`, so this does too;
 *   * `review_name` is what the INSERT branch would choose
 *     (`displayName ?? email`) when it is still NULL. Review document ids are
 *     `{bookId}_{reviewNameLower}`, so letting the estate's spelling of their
 *     name land here would file their reviews under a name they never chose;
 *   * `role` / `approved_at` are LEFT ALONE (a placeholder is `pending` and
 *     never approved — the state a new row is judged from, so the estate gate
 *     default-grants it the ordinary way), with ONE exception: OWNER_EMAILS
 *     forces `owner` exactly as it does for a new row. If an owner approved
 *     the placeholder on the People page before they ever signed in, that is a
 *     local decision and it stands, as it would on any row;
 *   * `first_seen_at` restarts: the placeholder's stamp is when the book was
 *     lent, not when this person was first seen.
 *
 * The UPDATE re-asserts `placeholder = 1`, so two simultaneous first sign-ins
 * cannot both claim it; the loser re-reads the winner's row. Audit rows guard
 * on `changes()` (the `grantEstateDefaultRole` pattern) so a lost race writes
 * no record of a claim that did not happen.
 */
async function claimPlaceholder(
  db: D1Database,
  existing: AppUser,
  params: {
    firebaseUid?: string | null;
    displayName?: string | null;
    photoUrl?: string | null;
  },
  email: string,
  isRecoveryOwner: boolean,
): Promise<AppUser> {
  const now = new Date().toISOString();
  const reviewName = existing.reviewName ?? params.displayName ?? email;
  const forceOwner = isRecoveryOwner && existing.role !== 'owner';
  const nextRole = forceOwner ? 'owner' : existing.role;
  const nextApprovedAt = forceOwner ? now : existing.approvedAt;
  const batchId = crypto.randomUUID();

  const stmts = [
    db
      .prepare(
        `UPDATE app_user
            SET display_name = ?, photo_url = ?, firebase_uid = ?, review_name = ?,
                role = ?, approved_at = ?, first_seen_at = datetime('now'), placeholder = 0
          WHERE id = ? AND placeholder = 1`,
      )
      .bind(
        params.displayName ?? null,
        params.photoUrl ?? null,
        params.firebaseUid ?? null,
        reviewName,
        nextRole,
        nextApprovedAt,
        existing.id,
      ),
    db
      .prepare(
        `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json,
                                 changed_by, changed_how, note)
         SELECT ?, 'app_user', ?, 'placeholder', ?, ?, NULL, 'auto', ?
          WHERE (SELECT changes()) > 0`,
      )
      .bind(
        batchId,
        existing.id,
        JSON.stringify(1),
        JSON.stringify(0),
        'first sign-in: the lend placeholder is now a real account',
      ),
  ];
  if (forceOwner) {
    // This `changes()` reads the change_log INSERT just above, which wrote a
    // row only if the claim landed — so the role row lands only with the claim.
    stmts.push(
      db
        .prepare(
          `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json,
                                   changed_by, changed_how, note)
           SELECT ?, 'app_user', ?, 'role', ?, ?, NULL, 'auto', ?
            WHERE (SELECT changes()) > 0`,
        )
        .bind(
          batchId,
          existing.id,
          JSON.stringify(existing.role),
          JSON.stringify('owner'),
          'OWNER_EMAILS recovery hatch: forced owner on first sign-in (was a lend placeholder)',
        ),
    );
  }
  await db.batch(stmts);

  const claimed = await findUserByEmail(db, email);
  if (!claimed) throw new Error(`failed to claim user record for ${email}`);
  return claimed;
}

/** Why a lend placeholder was not created — the caller relays it in words. */
export class PlaceholderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaceholderRefusedError';
  }
}

/**
 * The local account a lend to an estate member links to — the existing row
 * for that email, or a new INERT placeholder (migration 0490).
 *
 * The caller has already proved the email belongs to an APPROVED estate member
 * (the worker re-fetches the roster on every save); this decides only "which
 * row".
 *
 * ## The placeholder, and why it is inert
 *
 * `role='pending'`, `approved_at`/`approved_by`/`firebase_uid`/`photo_url`/
 * `review_name` all NULL, `placeholder=1` — the exact state a brand-new
 * sign-in is judged from, so it grants nothing and pre-decides nothing.
 * `upsertUserOnLogin` turns it into a real account on their first sign-in
 * (`claimPlaceholder`).
 *
 * ⚠️ **Never into an EMPTY table, nor one without an owner.** The bootstrap
 * rule makes the first row `owner`; a placeholder must neither trigger it nor
 * use it up. The condition is inside the INSERT, so there is no window between
 * the check and the write. (There is nobody to be lending yet, either.)
 *
 * The email is normalised exactly as `findUserByEmail` does, and the INSERT is
 * `WHERE NOT EXISTS` like `upsertUserOnLogin`'s, so the same person twice — or
 * a concurrent sign-in by them — yields ONE row. The audit row rides in the
 * same batch, guarded on `changes()`, so a lost race records nothing.
 */
export async function ensureLendPlaceholder(
  db: D1Database,
  params: { email: string; displayName: string; actorId: number },
): Promise<{ user: AppUser; created: boolean }> {
  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName.trim();
  if (!email || !displayName) {
    throw new PlaceholderRefusedError('That estate member has no usable name to record.');
  }
  const existing = await findUserByEmail(db, email);
  if (existing) return { user: existing, created: false };

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO app_user (email, firebase_uid, display_name, review_name, photo_url,
                               role, approved_at, approved_by, placeholder)
         SELECT ?, NULL, ?, NULL, NULL, 'pending', NULL, NULL, 1
          WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE email = ?)
            AND EXISTS (SELECT 1 FROM app_user WHERE role = 'owner')`,
      )
      .bind(email, displayName, email),
    db
      .prepare(
        `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json,
                                 changed_by, changed_how, note)
         SELECT ?, 'app_user', last_insert_rowid(), ?, 'null', ?, ?, 'human', ?
          WHERE (SELECT changes()) > 0`,
      )
      .bind(
        crypto.randomUUID(),
        ROW_FIELD,
        JSON.stringify({ displayName, role: 'pending', placeholder: true }),
        params.actorId,
        `lend placeholder created by user ${params.actorId}: an estate member who has never signed in here`,
      ),
  ]);
  const inserted = ((results[0]?.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;

  const row = await findUserByEmail(db, email);
  if (!row) {
    throw new PlaceholderRefusedError(
      'This catalog has no owner yet, so nobody can be recorded as a borrower.',
    );
  }
  return { user: row, created: inserted };
}

/**
 * The lower-cased emails of every local row the name picker already offers —
 * the dedupe half of the merged `GET /api/members` roster.
 *
 * ⚠️ Server-side only. Emails never reach the browser; this exists so the
 * worker can drop an estate member who is already listed locally. The
 * predicate is `listMembers`'s own (`LISTED_MEMBER_WHERE`), so "already
 * offered" means exactly "in that list". A pending or placeholder row is NOT
 * in it, so that person is offered through their estate entry — which resolves
 * back to the SAME row by email on save (`ensureLendPlaceholder`), never a
 * second one.
 */
export async function listedMemberEmails(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT email FROM app_user WHERE ${LISTED_MEMBER_WHERE}`)
    .all<{ email: string }>();
  return new Set(results.map((r) => r.email.toLowerCase()));
}

/**
 * The estate-membership cache columns (migrations 0140 + 0150,
 * estate-auth-design §5.2 / §4.5). Deliberately NOT part of `AppUser` or
 * `COLS`: they are protocol bookkeeping for the estate check, not a fact about
 * the person that any route or the web client should see — and while
 * `ESTATE_CHECK` is `off` they must cost nothing, so they are read only by the
 * middleware's estate step, in their own narrow query, when the mode asks.
 */
export interface EstateCacheRow {
  /** 'pending' | 'approved' | 'revoked', or null = never checked. */
  status: string | null;
  /** ISO timestamp of the last successful /seen answer, or null. */
  checkedAt: string | null;
  /**
   * The §4.5 visibility half of that same answer, as the stored JSON-array
   * text ('["audiobook","library","games"]'), or null = no visibility fact.
   * Raw on purpose — the canonical module's `parseVisibility` is the one
   * validator, applied at the boundary by the gate, so garbage dies there
   * rather than in a second parser here.
   */
  visibilityJson: string | null;
  /**
   * The BILLING half of that same answer (migration 0440, billing design
   * §3.4) — the denied money-path ids as the stored JSON-array text
   * (`'["research.covers"]'`), or null.
   *
   * 🔴 **null is "UNKNOWN", not "nothing is denied".** `'[]'` is the directory
   * answering and denying nothing; null is no answer existing at all — a row
   * that predates 0440, or an auth Worker mid-deploy still running pre-0016
   * code. A consumer that collapsed the two would un-switch every policy the
   * owner had set for the length of that deploy, with nothing going red.
   * Raw on purpose, same as `visibilityJson`: the canonical module parses it
   * at the boundary so garbage dies there and not in a second parser here.
   */
  billingDeniedJson: string | null;
}

export async function readEstateCache(db: D1Database, userId: number): Promise<EstateCacheRow> {
  const row = await db
    .prepare(
      'SELECT estate_status, estate_checked_at, estate_visibility, estate_billing_denied FROM app_user WHERE id = ?',
    )
    .bind(userId)
    .first<{
      estate_status: string | null;
      estate_checked_at: string | null;
      estate_visibility: string | null;
      estate_billing_denied: string | null;
    }>();
  return {
    status: row?.estate_status ?? null,
    checkedAt: row?.estate_checked_at ?? null,
    visibilityJson: row?.estate_visibility ?? null,
    billingDeniedJson: row?.estate_billing_denied ?? null,
  };
}

/**
 * Persist a fresh /seen answer — all FOUR columns in one write, because the
 * §4.5 one-answer rule says status, visibility and the billing deny-set must
 * not age separately (they share `estate_checked_at` as their single freshness
 * stamp). The cache is the protocol's own bookkeeping (§5.2), never an
 * enforcement act, and pointedly never touches `role` / `approved_at`.
 * `visibilityJson: null` is written as NULL — an answer without a visibility
 * fact (a pre-§4.5 server) must not leave a stale set behind pretending to
 * belong to the new status.
 *
 * 🔴 The same holds, harder, for `billingDeniedJson`. NULL is written when the
 * fresh answer carried no clean array — a pre-0016 auth Worker mid-deploy —
 * and NULL means UNKNOWN. It must NOT be written as `'[]'`: that would be the
 * old Worker's silence recorded as *"the directory says nothing is denied"*,
 * which un-switches every policy the owner set until the deploy finishes.
 */
export async function writeEstateCache(
  db: D1Database,
  userId: number,
  cache: {
    status: string;
    checkedAt: string;
    visibilityJson: string | null;
    billingDeniedJson: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      'UPDATE app_user SET estate_status = ?, estate_checked_at = ?, estate_visibility = ?, estate_billing_denied = ? WHERE id = ?',
    )
    .bind(
      cache.status,
      cache.checkedAt,
      cache.visibilityJson,
      cache.billingDeniedJson,
      userId,
    )
    .run();
}

/**
 * The §5.4 default-grant — the write half of the enforce arm's `default_grant`
 * verdict: estate says `approved`, the local row is `pending` and was never
 * locally decided, so the app assigns its configured default role.
 *
 * ## The estate-actor convention (§5.4 / §14.5)
 *
 * `approved_by` is NULL — no human approved this here — and the audit row is
 * `changed_how='auto'` with a note naming the estate, so the grant is forever
 * distinguishable from an owner's tap on the People page (which stamps
 * `approved_by` and logs `changed_how='human'` via `setUserRole`).
 *
 * ## Why the UPDATE re-checks its precondition, and how the audit row stays
 * honest anyway
 *
 * The WHERE re-asserts `role='pending' AND approved_at IS NULL` so a
 * concurrent LOCAL decision (an owner tapping People mid-request) wins over
 * the auto-grant — §3.1's "a local decision is standing" applied at the row
 * level, same as the games arm. That makes the change_log INSERT conditional
 * on a statement whose effect is unknowable until it runs — so the audit row
 * guards itself with `(SELECT changes()) > 0`, which SQLite evaluates AFTER
 * the preceding statement in the same batch (D1 runs a batch sequentially on
 * one session — the same property `changes.ts` already leans on for
 * `last_insert_rowid()`). One atomic batch, and either both the grant and its
 * record land or neither does; a lost race writes nothing, not an orphan
 * audit row describing a grant that never happened.
 *
 * Returns true only when the grant actually landed.
 */
export async function grantEstateDefaultRole(
  db: D1Database,
  params: { userId: number; role: Role },
): Promise<boolean> {
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE app_user SET role = ?, approved_at = ?, approved_by = NULL
          WHERE id = ? AND role = 'pending' AND approved_at IS NULL`,
      )
      .bind(params.role, now, params.userId),
    // Shaped exactly as changeLogInsert would (same columns, same JSON-text
    // encoding, entity 'app_user' / field 'role' matching setUserRole's human
    // rows) — hand-built only because the changes() guard needs INSERT…SELECT,
    // which the plain VALUES builder cannot express.
    db
      .prepare(
        `INSERT INTO change_log (batch_id, entity, entity_id, field, old_json, new_json,
                                 changed_by, changed_how, note)
         SELECT ?, 'app_user', ?, 'role', ?, ?, NULL, 'auto', ?
          WHERE (SELECT changes()) > 0`,
      )
      .bind(
        crypto.randomUUID(),
        params.userId,
        JSON.stringify('pending'),
        JSON.stringify(params.role),
        'estate default-grant: approved estate-wide, never locally decided (design §5.4)',
      ),
  ]);
  return ((results[0]?.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

export async function listUsers(db: D1Database): Promise<AppUser[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM app_user
        ORDER BY CASE role WHEN 'pending' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END, email`,
    )
    .all<UserRow>();
  return results.map(toUser);
}

/**
 * Who the local half of the name picker offers — shared by `listMembers` and
 * `listedMemberEmails` so "offered" and "deduped against" cannot drift apart.
 * A placeholder is `pending`, so it is never offered here.
 */
const LISTED_MEMBER_WHERE = `role != 'pending'
          AND display_name IS NOT NULL
          AND trim(display_name) != ''`;

/** The autocomplete roster — a member's id and the name to show, nothing else. */
export interface MemberSummary {
  id: number;
  displayName: string;
}

/**
 * The estate's members as a NAME PICKER sees them — `{ id, displayName }` and
 * not one field more.
 *
 * ⚠️ **This is deliberately NOT `listUsers`.** `listUsers` is the People page's
 * admin roster and hands out email, photo, role and timestamps behind
 * `manageUsers` (owner/admin only). This is the OR-1 person picker's source: any
 * `editCatalog` editor recording who has a book needs a member's display name to
 * link the row to their account, and needs *nothing else about them*. Two
 * queries, so the wide one can never leak through the narrow door — the export
 * rule that a projection lists its allowed fields explicitly rather than
 * subtracting from `SELECT *`.
 *
 * **Who is a member here:** anyone past the `pending` gate — an approved estate
 * identity — who has a display name to show. A `pending` row is an account
 * nobody has approved yet and is never offered; a row with no display name
 * cannot be picked (the field matches on the shown name) and is left out rather
 * than offered blank. Ordered by name, case-folded, so the datalist reads.
 */
export async function listMembers(db: D1Database): Promise<MemberSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, display_name FROM app_user
        WHERE ${LISTED_MEMBER_WHERE}
        ORDER BY display_name COLLATE NOCASE`,
    )
    .all<{ id: number; display_name: string }>();
  return results.map((r) => ({ id: r.id, displayName: r.display_name }));
}

/**
 * Change a person's role — the ONE role-write path (the People page and the
 * federated /api/admin surface both land here, so both audit identically).
 *
 * ⚠️ The audit row rides in the same `db.batch()` as the UPDATE (changes.ts's
 * atomicity rule: a change and its record land together or not at all). A
 * write that does not move the role (re-approving the same role) still
 * restamps approved_at/approved_by but logs nothing — an audit row whose
 * old and new values are equal records no change.
 */
export type SetUserRoleResult =
  | { ok: true; user: AppUser }
  | { ok: false; reason: 'not_found' | 'last_owner' };

export async function setUserRole(
  db: D1Database,
  params: { userId: number; role: Role; approvedBy: number },
): Promise<SetUserRoleResult> {
  const before = await db
    .prepare(`SELECT ${COLS} FROM app_user WHERE id = ?`)
    .bind(params.userId)
    .first<UserRow>();
  if (!before) return { ok: false, reason: 'not_found' };

  // ⚠️ Last-owner guard, enforced HERE because this is the one role-write path
  // (the People page and the /api/admin surface both land here). Any write that
  // would demote the FINAL owner is refused — not only a self-demotion. The old
  // route-level guard fired only when the actor edited themselves, so an admin
  // could demote every *other* owner down to countOwners()==0, after which no
  // role in the app can mint an owner again. Firing on the target's current
  // role closes that: if the target is an owner and the new role is not, and
  // there is only one owner left, the target IS that last owner.
  if (before.role === 'owner' && params.role !== 'owner') {
    const owners = await countOwners(db);
    if (owners <= 1) return { ok: false, reason: 'last_owner' };
  }

  const update = db
    .prepare('UPDATE app_user SET role = ?, approved_at = ?, approved_by = ? WHERE id = ?')
    .bind(params.role, new Date().toISOString(), params.approvedBy, params.userId);

  if (before.role !== params.role) {
    await db.batch([
      update,
      changeLogInsert(db, {
        batchId: crypto.randomUUID(),
        entity: 'app_user',
        entityId: params.userId,
        field: 'role',
        oldJson: JSON.stringify(before.role),
        newJson: JSON.stringify(params.role),
        actor: { userId: params.approvedBy, how: 'human' },
      }),
    ]);
  } else {
    await update.run();
  }

  const row = await db
    .prepare(`SELECT ${COLS} FROM app_user WHERE id = ?`)
    .bind(params.userId)
    .first<UserRow>();
  // The row was present as `before` and the UPDATE cannot delete it, so this
  // re-read always finds it; treat an impossible miss as not_found.
  return row ? { ok: true, user: toUser(row) } : { ok: false, reason: 'not_found' };
}

export async function countOwners(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM app_user WHERE role = 'owner'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
