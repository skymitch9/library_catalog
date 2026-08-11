import { Hono } from 'hono';
import { capabilitiesFor, updateRoleSchema } from '@lc/core';
import { countOwners, gapSummary, listUsers, setUserRole } from '@lc/db';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

export const userRoutes = new Hono<AppBindings>()
  /** Who am I and what may I do — the first call the web app makes. */
  .get('/me', async (c) => {
    const user = c.get('user');

    /**
     * How much work is outstanding, riding along on the call the app already
     * makes — the sibling Board Game Catalog's pattern, and copied deliberately.
     *
     * It puts the count on the face of the nav link ("Missing (12)") and hides
     * the link entirely once there is nothing behind it, so a tap can be judged
     * before it is spent and a screen with nothing on it does not earn a
     * permanent slot on a 360px phone.
     *
     * ⚠️ A failure answers `null`, never `0`. The two mean opposite things to
     * the nav: `0` hides the link, `null` shows it without a count. Swallowing
     * an error into `0` would make a broken query look like a finished job.
     */
    let chores: { missingDetails: number } | null = null;
    try {
      const gaps = await gapSummary(c.env.DB);
      chores = { missingDetails: gaps.reduce((n, g) => n + g.missing, 0) };
    } catch {
      chores = null;
    }

    return c.json({
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      capabilities: capabilitiesFor(user.role),
      chores,
      // The browser writes reviews to Firestore itself, and the document id is
      // `{bookId}_{displayNameLower}`. Send the name we have on file so it
      // updates the person's existing review rather than writing a second one
      // beside it under a slightly different spelling.
      reviewName: user.reviewName,
    });
  })

  .get('/users', requireCapability('manageUsers'), async (c) =>
    c.json({ users: await listUsers(c.env.DB) }),
  )

  .patch('/users/:id/role', requireCapability('manageUsers'), async (c) => {
    const actor = c.get('user');
    const userId = Number(c.req.param('id'));
    if (!Number.isInteger(userId)) {
      return c.json({ error: 'bad_request', detail: 'user id must be an integer' }, 400);
    }

    const parsed = updateRoleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues }, 400);
    }

    // Don't let the last owner demote themselves and lock everyone out.
    if (userId === actor.id && parsed.data.role !== 'owner') {
      if ((await countOwners(c.env.DB)) <= 1) {
        return c.json(
          { error: 'bad_request', detail: 'you are the only owner — promote someone else first' },
          400,
        );
      }
    }

    const updated = await setUserRole(c.env.DB, {
      userId,
      role: parsed.data.role,
      approvedBy: actor.id,
    });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ user: updated });
  });
