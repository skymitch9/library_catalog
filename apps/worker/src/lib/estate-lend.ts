/**
 * Lending to an estate member who may never have signed in here — the two
 * halves the routes call: the merged name-picker roster, and resolving a
 * picked `personEstateId` to a local account on save.
 *
 * ⚠️ **Estate-only names are for `manageUsers` callers only** (owner + admin).
 * The owner's ask was *"allow ME to lend books to estate members"*: the estate
 * roster is the whole household's membership list, which the narrow
 * `editCatalog` picker was deliberately kept from. Every other editor gets the
 * local members exactly as before, and the server never calls the auth Worker
 * on their behalf.
 */

import { can, type Role } from '@lc/core';
import {
  PlaceholderRefusedError,
  ensureLendPlaceholder,
  listMembers,
  listedMemberEmails,
  statusCanCarryPerson,
} from '@lc/db';
import type { Env } from '../env.js';
import { fetchEstateMembers } from './estate-members.js';

/**
 * One name in the picker. `id` keeps its old meaning (a local `app_user` id,
 * so an old client that reads only `id` + `displayName` still works); an
 * estate-only entry has `id: null` and an opaque `estateId` instead.
 * ⚠️ No email, ever.
 */
export interface PickerMember {
  id: number | null;
  estateId: string | null;
  displayName: string;
}

/** Whether the estate half of the roster is in the answer, in a word the UI can say. */
export type EstateRosterState = 'ok' | 'unavailable' | 'not_requested';

export async function buildMemberRoster(
  db: D1Database,
  env: Env,
  role: Role,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ members: PickerMember[]; estate: EstateRosterState }> {
  const local: PickerMember[] = (await listMembers(db)).map((m) => ({
    id: m.id,
    estateId: null,
    displayName: m.displayName,
  }));
  if (!can(role, 'manageUsers')) return { members: local, estate: 'not_requested' };

  const roster = await fetchEstateMembers(env, opts);
  if (roster === null) return { members: local, estate: 'unavailable' };

  // Dedupe by lower-cased email against exactly the rows listed above, so a
  // person is never offered twice. A local row that is pending or a
  // placeholder is NOT listed above, so that person comes through here — and
  // resolves back to the same row by email when saved.
  const listed = await listedMemberEmails(db);
  const extra: PickerMember[] = roster
    .filter((m) => m.displayName !== null && !listed.has(m.email))
    .map((m) => ({ id: null, estateId: m.estateId, displayName: m.displayName as string }));

  const members = [...local, ...extra].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
  return { members, estate: 'ok' };
}

/** A refusal the route relays as `{ error, detail }` — always in words. */
export interface EstateLendRefusal {
  ok: false;
  status: 400 | 403 | 503;
  body: Record<string, unknown>;
}

/**
 * Turn a write body's `personEstateId` into `personUserId` + `personName`, or
 * refuse in words having changed nothing.
 *
 * Order matters — every cheap refusal comes BEFORE the placeholder is created,
 * so a refused save never leaves a new account behind:
 *   1. `manageUsers` (on top of whatever the route already required);
 *   2. not beside a non-null `personUserId` — two people in one save;
 *   3. the status the copy will have can carry a person (`@lc/db`'s one rule);
 *   4. the roster, re-fetched NOW: unavailable or the id absent → refuse;
 *   5. only then find-or-create the local row.
 *
 * A body without `personEstateId` is returned untouched.
 */
export async function resolveEstateLink<
  T extends { personEstateId?: string | undefined; personUserId?: number | null | undefined; personName?: string | null | undefined },
>(
  db: D1Database,
  env: Env,
  actor: { id: number; role: Role },
  data: T,
  nextStatus: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; data: Omit<T, 'personEstateId'> } | EstateLendRefusal> {
  const { personEstateId, ...rest } = data;
  if (personEstateId === undefined) return { ok: true, data: rest };

  if (!can(actor.role, 'manageUsers')) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'forbidden',
        capability: 'manageUsers',
        role: actor.role,
        detail:
          'Lending to an estate member who has not signed in here needs the owner or admin role. ' +
          'Type their name instead to record it as plain text.',
      },
    };
  }
  if (rest.personUserId !== undefined && rest.personUserId !== null) {
    return refuse(400, 'Pick one person — that save named both a member here and an estate member.');
  }
  if (!statusCanCarryPerson(nextStatus)) {
    return refuse(
      400,
      `a copy can only record who has it when it is lent out, borrowed or sold — this one is "${nextStatus}". ` +
        'Change the status first, then say who has it.',
    );
  }

  const roster = await fetchEstateMembers(env, opts);
  if (roster === null) {
    return {
      ok: false,
      status: 503,
      body: {
        error: 'estate_roster_unavailable',
        detail:
          'The estate member list could not be reached, so that name was not linked and nothing was saved. ' +
          'Try again, or type the name to record it as plain text.',
      },
    };
  }
  const member = roster.find((m) => m.estateId === personEstateId);
  if (!member || member.displayName === null) {
    return refuse(
      400,
      'That estate member was not found among approved members — nothing was saved. ' +
        'Pick the name again, or type it to record it as plain text.',
    );
  }

  try {
    const { user } = await ensureLendPlaceholder(db, {
      email: member.email,
      displayName: member.displayName,
      actorId: actor.id,
    });
    // The display name recorded is the one the picker showed. A real account
    // that already exists keeps its own live name on the card regardless
    // (`withCopyPeople`); this is the typed-text fallback.
    return {
      ok: true,
      data: { ...rest, personUserId: user.id, personName: member.displayName },
    };
  } catch (err) {
    if (err instanceof PlaceholderRefusedError) return refuse(400, err.message);
    throw err;
  }
}

function refuse(status: 400, detail: string): EstateLendRefusal {
  return { ok: false, status, body: { error: 'bad_request', detail } };
}
