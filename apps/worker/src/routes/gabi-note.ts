/**
 * `POST /api/gabi/note` — persist a note GABI made about the person.
 *
 * This is the server-side half of `note_about_person`. The tool itself runs in
 * the browser (like every GABI tool), and the browser posts here to save the
 * note into `gabi_person_profile`.
 *
 * Gated on `read` capability — any signed-in user can save notes about
 * themselves. The tool is `mutates: false` because it does not change the
 * CATALOG; it is metadata about the person.
 */

import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

interface ProfileJson {
  callMe?: string;
  notes?: string[];
  threads?: Array<{ what: string; at: number }>;
}

export const gabiNoteRoutes = new Hono<AppBindings>().post(
  '/',
  requireCapability('read'),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      note?: unknown;
      kind?: unknown;
    };

    const note = String(body.note ?? '').trim().slice(0, 120);
    const kind = String(body.kind ?? '');

    if (!note) {
      return c.json({ error: 'bad_request', detail: 'A note is required.' }, 400);
    }
    if (!['preference', 'thread', 'name'].includes(kind)) {
      return c.json(
        { error: 'bad_request', detail: "kind must be 'preference', 'thread', or 'name'." },
        400,
      );
    }

    const userId = c.get('user').id;

    // Load existing profile (or start fresh)
    let profile: ProfileJson = {};
    try {
      const row = await c.env.DB.prepare(
        'SELECT profile FROM gabi_person_profile WHERE user_id = ?',
      )
        .bind(userId)
        .first<{ profile: string }>();
      if (row) {
        profile = JSON.parse(row.profile);
      }
    } catch {
      // Start with empty profile on any parse/read failure
      profile = {};
    }

    // Apply the note
    switch (kind) {
      case 'name':
        profile.callMe = note;
        break;
      case 'preference': {
        if (!Array.isArray(profile.notes)) profile.notes = [];
        profile.notes.push(note);
        // Cap at 6, drop oldest if full
        if (profile.notes.length > 6) {
          profile.notes = profile.notes.slice(-6);
        }
        break;
      }
      case 'thread': {
        if (!Array.isArray(profile.threads)) profile.threads = [];
        profile.threads.push({ what: note, at: Date.now() });
        // Cap at 5, drop oldest if full
        if (profile.threads.length > 5) {
          profile.threads = profile.threads.slice(-5);
        }
        break;
      }
    }

    // Upsert
    const profileJson = JSON.stringify(profile);
    await c.env.DB.prepare(
      `INSERT INTO gabi_person_profile (user_id, profile, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         profile = excluded.profile,
         updated_at = excluded.updated_at`,
    )
      .bind(userId, profileJson)
      .run();

    return c.json({ ok: true });
  },
);
