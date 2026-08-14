import type { AppUser, Role } from '@lc/core';

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
}

const COLS =
  'id, email, firebase_uid, display_name, review_name, photo_url, role, first_seen_at, approved_at';

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

  if (existing) {
    // Refresh the mutable Google-side facts, but never the role and never
    // review_name once it is set — see the note above.
    const nextName = params.displayName ?? existing.displayName;
    const nextPhoto = params.photoUrl ?? existing.photoUrl;
    const nextUid = params.firebaseUid ?? existing.firebaseUid;
    if (
      nextName !== existing.displayName ||
      nextPhoto !== existing.photoUrl ||
      nextUid !== existing.firebaseUid
    ) {
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

  const isRecoveryOwner = (params.ownerEmails ?? []).some(
    (e) => e.trim().toLowerCase() === email,
  );
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
 * The two estate-membership cache columns (migration 0140, estate-auth-design
 * §5.2). Deliberately NOT part of `AppUser` or `COLS`: they are protocol
 * bookkeeping for the estate check, not a fact about the person that any route
 * or the web client should see — and while `ESTATE_CHECK` is `off` (the
 * deployed default) they must cost nothing, so they are read only by the
 * middleware's shadow step, in their own narrow query, when the mode asks.
 */
export interface EstateCacheRow {
  /** 'pending' | 'approved' | 'revoked', or null = never checked. */
  status: string | null;
  /** ISO timestamp of the last successful /seen answer, or null. */
  checkedAt: string | null;
}

export async function readEstateCache(db: D1Database, userId: number): Promise<EstateCacheRow> {
  const row = await db
    .prepare('SELECT estate_status, estate_checked_at FROM app_user WHERE id = ?')
    .bind(userId)
    .first<{ estate_status: string | null; estate_checked_at: string | null }>();
  return { status: row?.estate_status ?? null, checkedAt: row?.estate_checked_at ?? null };
}

/**
 * Persist a fresh /seen answer. The ONLY write the shadow step performs — the
 * cache is the protocol's own bookkeeping (§5.2), never an enforcement act,
 * and pointedly never touches `role` / `approved_at`.
 */
export async function writeEstateCache(
  db: D1Database,
  userId: number,
  cache: { status: string; checkedAt: string },
): Promise<void> {
  await db
    .prepare('UPDATE app_user SET estate_status = ?, estate_checked_at = ? WHERE id = ?')
    .bind(cache.status, cache.checkedAt, userId)
    .run();
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

export async function setUserRole(
  db: D1Database,
  params: { userId: number; role: Role; approvedBy: number },
): Promise<AppUser | null> {
  await db
    .prepare('UPDATE app_user SET role = ?, approved_at = ?, approved_by = ? WHERE id = ?')
    .bind(params.role, new Date().toISOString(), params.approvedBy, params.userId)
    .run();
  const row = await db
    .prepare(`SELECT ${COLS} FROM app_user WHERE id = ?`)
    .bind(params.userId)
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function countOwners(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM app_user WHERE role = 'owner'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
