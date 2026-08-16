import { useCallback, useEffect, useState } from 'react';
import { ROLES, canGrantRole, type Role } from '@lc/core';
import { api, type Me, type Person } from '../api.js';

/**
 * Who is in, and what they may do.
 *
 * Anyone with a Google account can sign in — `middleware/auth.ts` verifies the
 * token and `upsertUserOnLogin` files them as `pending`. This screen is where
 * pending becomes real, which is why it lives in the app rather than in a console
 * somewhere: the person who decides is the person holding the phone.
 *
 * ## ⚠️ The three guards, and where they actually live
 *
 * Small household, real consequences. All three rules are enforced by
 * `apps/worker/src/routes/users.ts` and only *reflected* here:
 *
 *  1. **Only an owner or admin can change roles.** `requireCapability('manageUsers')`
 *     gates both endpoints, and `App.tsx` will not even route anyone else to this
 *     screen. Disabling a button is a courtesy; the 403 is the rule.
 *  2. **Nobody can grant a role at or above their own.** `canGrantRole` (`@lc/core`)
 *     caps an admin at strictly-beneath-admin, so an admin can hand out anything
 *     up to moderator but never admin or owner — only an owner can grant either.
 *  3. **The last owner cannot demote themselves.** The server counts owners
 *     inside the request and refuses. This page also greys the buttons, because a
 *     control that exists and always fails is worse than one that is visibly
 *     unavailable — but the count it greys them from is the list it last loaded,
 *     and the server's is the one that decides.
 *
 * ⚠️ There is deliberately no delete. `app_user.id` is referenced by `user_book`
 * with `ON DELETE CASCADE`, so removing a person would take their entire reading
 * history with them — the sibling project's migration 0023 has the measured
 * version of that lesson. `pending` is the revoke: they keep their history and
 * see nothing.
 */

/**
 * The 2026-08-16 ladder, cumulative low to high: guest < member < contributor
 * < moderator < admin < owner. `manager` → `moderator` and `reader` →
 * `member` (migration 0300); every blurb below states what a role adds ON TOP
 * of the one before it, matching CAPABILITY_MATRIX in `@lc/core`.
 */
const ROLE_BLURB: Record<Role, string> = {
  owner: 'Everything an admin can do, plus granting the admin role itself.',
  admin:
    'Everything a moderator can do, plus approving people and changing roles — except granting admin or owner; only an owner can do that.',
  moderator:
    'Add and edit books, curate the wishlist, scan a barcode or a photo, run research, review its findings. Cannot change anyone’s role.',
  contributor:
    'Add and edit books, curate the wishlist, scan a barcode (free). Cannot photograph a shelf/cover or run research — those cost money.',
  member: 'Ask for a book ("want this"), track their own reading, and leave reviews. Cannot edit the catalog.',
  guest: 'Browse the shelf. Nothing else.',
  pending: 'Signed in, and sees a holding screen until an owner or admin lets them in.',
};

/** What the button says. "Revoke" reads as an action; "Make pending" reads as a typo. */
function actionLabel(role: Role): string {
  return role === 'pending' ? 'Revoke' : `Make ${role}`;
}

export function PeoplePage({ me, onSelfChanged }: { me: Me; onSelfChanged: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .users()
      .then((r) => setPeople(r.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  async function setRole(person: Person, role: Role) {
    setBusy(person.id);
    setError(null);
    try {
      await api.setRole(person.id, role);

      // ⚠️ Stepping down is the one change that takes this screen away from the
      // person making it, and the naive `load()` is visibly wrong when it does:
      // the PATCH succeeds, the refetch of `/api/users` 403s because you are no
      // longer an owner, and you are left looking at a stale list with the word
      // "forbidden" over it — which reads as "the change failed" when it is the
      // change working. Found by clicking it. Hand back to `App`, which re-reads
      // `/api/me` and redraws the app you now actually have.
      if (person.email === me.email && role !== 'owner') {
        onSelfChanged();
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (error && !people) return <main className="centre">Could not load the people: {error}</main>;
  if (!people) return <main className="muted">Loading…</main>;

  const owners = people.filter((p) => p.role === 'owner').length;
  const pending = people.filter((p) => p.role === 'pending');

  return (
    <main>
      <h2>People</h2>
      <p className="muted">
        Anyone with a Google account can sign in. Everyone listed here as anything other than
        pending can see the collection.
      </p>

      {pending.length > 0 && (
        <p className="notice">
          <strong>
            {pending.length} {pending.length === 1 ? 'person is' : 'people are'} waiting.
          </strong>{' '}
          They have signed in and are looking at a holding screen until you decide.
        </p>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      <ul className="plain people">
        {people.map((p) => {
          const isMe = p.email === me.email;
          // The exact rule the server applies, mirrored: only self-demotion by
          // the last owner is refused. An owner demoting a *different* owner
          // always leaves at least themselves.
          const lastOwner = isMe && p.role === 'owner' && owners <= 1;

          return (
            <li key={p.id}>
              <div className="person">
                <div className="person__id">
                  <strong>{p.displayName || p.email}</strong>
                  {p.displayName && <span className="muted small">{p.email}</span>}
                  <span className="muted small">
                    first seen {p.firstSeenAt.replace('T', ' ').slice(0, 16)}
                    {p.reviewName ? ` · reviews as ${p.reviewName}` : ''}
                  </span>
                  {/* Entry point only, never a control: estate-wide grants live
                      solely on heygabi.ai/admin, which is its own gate. This
                      page is already owner/admin-only (App.tsx routes it behind
                      manageUsers), so everyone who can see this can use it. */}
                  <a
                    className="muted small"
                    href={`https://heygabi.ai/admin#member=${encodeURIComponent(p.email)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Estate admin →
                  </a>
                </div>

                <span className={`mark mark--role mark--role-${p.role}`} title={ROLE_BLURB[p.role]}>
                  {p.role}
                </span>

                <div className="row-tight">
                  {/* Derived from ROLES rather than listed again. The sibling
                      project shipped a hardcoded copy of this list and a whole
                      role became assignable nowhere.

                      ⚠️ Also filtered through `canGrantRole(me.role, role)` —
                      the courtesy half of guard #2 above. An admin viewing
                      this page would otherwise see "Make admin" / "Make owner"
                      buttons that the server always 403s; a button that exists
                      and always fails is exactly what the last-owner guard
                      already says to avoid. */}
                  {ROLES.filter((r) => r !== p.role && canGrantRole(me.role, r)).map((role) => (
                    <button
                      key={role}
                      className={role === 'pending' ? 'chip' : 'chip'}
                      disabled={busy === p.id || lastOwner}
                      title={lastOwner ? undefined : ROLE_BLURB[role]}
                      onClick={() => void setRole(p, role)}
                    >
                      {actionLabel(role)}
                    </button>
                  ))}
                  {isMe && <span className="muted small">that&apos;s you</span>}
                </div>
              </div>

              {lastOwner && (
                <p className="muted small">
                  You are the only owner, so you cannot step down — promote somebody else first,
                  or there would be nobody left who can let anyone in.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
