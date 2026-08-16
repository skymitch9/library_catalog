import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@lc/core';
import { api, type Me, type Person } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * The 2026-08-16 ladder, cumulative low to high: guest < member < contributor
 * < moderator < admin < owner. Kept as the role badge's tooltip — informational,
 * not a control, so it survived the read-only rewrite below.
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

/**
 * Who is in, and what they may do — READ-ONLY.
 *
 * ⚠️ **Made read-only 2026-08-16.** This page used to be where roles were
 * granted and revoked. It no longer writes anything: the owner's decision
 * (2026-08-16) was *"remove all people stuff from the individual sites and
 * have it all redirect back to the admin page on heygabi,"* refined to
 * **read-only rather than a hard redirect** for a specific reason —
 * heygabi.ai/admin is itself gated on being an *estate approver*, and an app
 * `admin` (this repo's own delegated role, `manageUsers`) is not guaranteed
 * to be one. A redirect would bounce exactly the person the `admin` rung was
 * created to delegate to. Read-only keeps this screen useful — everyone who
 * could always see it still can — while leaving mutation to exactly one
 * place.
 *
 * ## What changed
 *
 * Removed entirely: every role button (`Make member` / `Make admin` / …,
 * `Revoke`), the last-owner self-demotion guard that only existed to grey
 * those buttons, and `setRole`/`onSelfChanged` — there is nothing here left
 * for a changed-own-role redirect to react to.
 *
 * Kept: the roster itself — name, email, role, first-seen date, review name
 * — exactly as it rendered before, plus the per-person link to
 * heygabi.ai/admin (now doubled by one at the top of the page, since it is
 * the only way left to act on anything shown here).
 *
 * ⚠️ **The server-side routes are unchanged and still load-bearing.**
 * `GET /api/users` (still called, for the read) and
 * `PATCH /api/users/:id/role` (no longer called from here, but still gated
 * by `requireCapability('manageUsers')` in `apps/worker/src/routes/users.ts`)
 * are exactly how heygabi.ai/admin's federation edits this app's roles —
 * removing or weakening either would break the estate admin page, not just
 * this one.
 */
export function PeoplePage({ me }: { me: Me }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .users()
      .then((r) => setPeople(r.users))
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  useEffect(load, [load]);

  if (error && !people) return <main className="centre">Could not load the people: {error}</main>;
  if (!people) return <main className="muted">Loading…</main>;

  const pending = people.filter((p) => p.role === 'pending');

  return (
    <main>
      <h2>People</h2>
      <p className="muted">
        Anyone with a Google account can sign in. Everyone listed here as anything other than
        pending can see the collection.
      </p>

      {/* The one write path left. Prominent on purpose: this used to be a
          page full of buttons, and it is now a page with none — the reason
          has to be right where the buttons used to be, not buried below the
          list. */}
      <p className="notice">
        <strong>
          <a href="https://heygabi.ai/admin" target="_blank" rel="noreferrer">
            Manage roles at heygabi.ai/admin →
          </a>
        </strong>{' '}
        This page is read-only. Approving people, changing a role, or revoking one all happen
        there now.
      </p>

      {pending.length > 0 && (
        <p className="notice">
          <strong>
            {pending.length} {pending.length === 1 ? 'person is' : 'people are'} waiting.
          </strong>{' '}
          They have signed in and are looking at a holding screen until an owner or admin lets
          them in — at heygabi.ai/admin.
        </p>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      <ul className="plain people">
        {people.map((p) => {
          const isMe = p.email === me.email;

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

                {isMe && <span className="muted small">that&apos;s you</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
