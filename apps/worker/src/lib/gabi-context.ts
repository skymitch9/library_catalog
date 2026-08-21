/**
 * GABI Personal Context — assembles who she is talking to.
 *
 * Called once per turn, always included in the system prefix (cached after
 * turn 1 at ~0.05¢/turn as a cache read — not worth the complexity of
 * conditional loading).
 *
 * Both surfaces (site panel + Discord) get this automatically because it is
 * injected where the system prompt is assembled, not per-surface.
 *
 * ⚠️ **NEVER THROWS.** Every failure path returns empty defaults. A broken
 * context query must degrade to "she forgets", never to "the panel 500s".
 * Same graceful-degradation principle as memory (see `gabi-turn.ts`'s header).
 */

export interface GabiPersonalContext {
  person: { name: string; role: string };
  currentlyReading: Array<{ title: string; authors: string; series?: string; volume?: string }>;
  recentlyFinished: Array<{ title: string; authors: string; finishedOn?: string; rating?: number }>;
  profile: { callMe?: string; notes: string[]; threads: Array<{ what: string }> };
}

interface ProfileJson {
  callMe?: string;
  notes?: string[];
  threads?: Array<{ what: string; at?: number }>;
}

const EMPTY_CONTEXT: GabiPersonalContext = {
  person: { name: '', role: '' },
  currentlyReading: [],
  recentlyFinished: [],
  profile: { notes: [], threads: [] },
};

/**
 * Load everything GABI needs to know about the person she is talking to.
 *
 * Queries: app_user, user_book JOIN work (reading), user_book JOIN work (read),
 * gabi_person_profile. Each wrapped in a try/catch so a single table issue
 * does not take down the whole context.
 */
export async function loadPersonalContext(
  db: D1Database,
  userId: number,
): Promise<GabiPersonalContext> {
  try {
    const [person, reading, finished, profile] = await Promise.all([
      loadPerson(db, userId),
      loadCurrentlyReading(db, userId),
      loadRecentlyFinished(db, userId),
      loadProfile(db, userId),
    ]);

    return { person, currentlyReading: reading, recentlyFinished: finished, profile };
  } catch {
    return EMPTY_CONTEXT;
  }
}

async function loadPerson(
  db: D1Database,
  userId: number,
): Promise<{ name: string; role: string }> {
  try {
    const row = await db
      .prepare('SELECT display_name, role FROM app_user WHERE id = ?')
      .bind(userId)
      .first<{ display_name: string | null; role: string }>();
    if (!row) return { name: '', role: '' };
    return { name: row.display_name ?? '', role: row.role };
  } catch {
    return { name: '', role: '' };
  }
}

async function loadCurrentlyReading(
  db: D1Database,
  userId: number,
): Promise<Array<{ title: string; authors: string; series?: string; volume?: string }>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT w.title, w.authors, w.series, w.series_index_display
         FROM user_book ub
         JOIN work w ON w.id = ub.work_id
         WHERE ub.user_id = ? AND ub.read_state = 'reading'`,
      )
      .bind(userId)
      .all<{ title: string; authors: string; series: string | null; series_index_display: string | null }>();
    return (results ?? []).map((r) => ({
      title: r.title,
      authors: r.authors,
      ...(r.series ? { series: r.series } : {}),
      ...(r.series_index_display ? { volume: r.series_index_display } : {}),
    }));
  } catch {
    return [];
  }
}

async function loadRecentlyFinished(
  db: D1Database,
  userId: number,
): Promise<Array<{ title: string; authors: string; finishedOn?: string; rating?: number }>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT w.title, w.authors, ub.finished_on, ub.rating_cached
         FROM user_book ub
         JOIN work w ON w.id = ub.work_id
         WHERE ub.user_id = ? AND ub.read_state = 'read'
         ORDER BY ub.finished_on DESC
         LIMIT 10`,
      )
      .bind(userId)
      .all<{ title: string; authors: string; finished_on: string | null; rating_cached: number | null }>();
    return (results ?? []).map((r) => ({
      title: r.title,
      authors: r.authors,
      ...(r.finished_on ? { finishedOn: r.finished_on } : {}),
      ...(r.rating_cached != null ? { rating: r.rating_cached } : {}),
    }));
  } catch {
    return [];
  }
}

async function loadProfile(
  db: D1Database,
  userId: number,
): Promise<{ callMe?: string; notes: string[]; threads: Array<{ what: string }> }> {
  try {
    const row = await db
      .prepare('SELECT profile FROM gabi_person_profile WHERE user_id = ?')
      .bind(userId)
      .first<{ profile: string }>();
    if (!row) return { notes: [], threads: [] };
    const parsed: ProfileJson = JSON.parse(row.profile);
    return {
      ...(parsed.callMe ? { callMe: parsed.callMe } : {}),
      notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 6) : [],
      threads: Array.isArray(parsed.threads)
        ? parsed.threads.slice(0, 5).map((t) => ({ what: t.what }))
        : [],
    };
  } catch {
    return { notes: [], threads: [] };
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

function ratingStars(rating: number): string {
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * Render the personal context as a readable text block for the system prompt.
 *
 * Returns an empty string when there is nothing useful — no books, no notes,
 * no profile. An empty string means "don't inject pointless context".
 */
export function formatContextForPrompt(ctx: GabiPersonalContext): string {
  const sections: string[] = [];

  // Person header
  const displayName = ctx.profile.callMe || ctx.person.name;
  if (displayName || ctx.person.role) {
    let line = '## About the person you\'re talking to\n';
    if (displayName) line += `\nName: ${displayName}`;
    if (ctx.person.role) line += `\nRole: ${ctx.person.role}`;
    sections.push(line);
  }

  // Currently reading
  if (ctx.currentlyReading.length > 0) {
    const lines = ctx.currentlyReading.map((b) => {
      let entry = b.title;
      if (b.series && b.volume) entry += ` (${b.series} #${b.volume})`;
      else if (b.series) entry += ` (${b.series})`;
      entry += ` by ${b.authors}`;
      return `- ${entry}`;
    });
    sections.push('Currently reading:\n' + lines.join('\n'));
  }

  // Recently finished
  if (ctx.recentlyFinished.length > 0) {
    const lines = ctx.recentlyFinished.map((b) => {
      let entry = `- ${b.title}`;
      if (b.rating != null) entry += ` — ${ratingStars(b.rating)}`;
      if (b.finishedOn) entry += `, finished ${formatDate(b.finishedOn)}`;
      return entry;
    });
    sections.push('Recently finished:\n' + lines.join('\n'));
  }

  // Notes
  if (ctx.profile.notes.length > 0) {
    const lines = ctx.profile.notes.map((n) => `- ${n}`);
    sections.push('Your notes about this person:\n' + lines.join('\n'));
  }

  // Threads
  if (ctx.profile.threads.length > 0) {
    const lines = ctx.profile.threads.map((t) => `- ${t.what}`);
    sections.push('Open threads:\n' + lines.join('\n'));
  }

  if (sections.length === 0) return '';
  return sections.join('\n\n');
}
