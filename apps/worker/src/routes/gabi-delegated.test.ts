/**
 * The delegated GABI door — the four properties whose failure would be silent.
 *
 * 1. **The bearer gate fails CLOSED and says which kind of wrong it is.** Unset
 *    secret is a *configuration* answer (503, worded); a wrong or absent bearer
 *    is an *authentication* answer (401, worded). ⚠️ Deliberately NOT the donor
 *    route's uniform blank 404: these refusals are relayed into a Discord
 *    message, where a silent 404 surfaces as GABI saying nothing at all.
 *
 * 2. **The bot's bearer authorises NO WRITE by itself.** Past the gate, every
 *    writing verb still resolves the on-behalf-of uid to an `app_user` row on
 *    THIS instance and checks that person's own capability. Four causes, four
 *    different sentences, because they need four different fixes: unknown here
 *    / estate-revoked / awaiting approval / role too low.
 *
 * 3. **The verb allowlist and its capability mapping are pinned**, and pinned
 *    *against `CAPABILITY_MATRIX` itself* rather than against a copy — so
 *    widening `editCatalog` in the matrix cannot silently widen who GABI writes
 *    for without this file noticing.
 *
 * 4. **She refuses to guess.** A price add-on and an ASIN are worded refusals
 *    that never reach the network, and the report sentence names what could NOT
 *    be fixed as loudly as what could.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { CAPABILITY_MATRIX, can } from '@lc/core';
import type { AppBindings, Env } from '../env.js';
import {
  BROWSE_DEFAULT_LIMIT,
  BROWSE_MAX_LIMIT,
  DELEGATED_MSG,
  DELEGATED_READ_VERBS,
  DELEGATED_VERBS,
  DELEGATED_VERB_CAPABILITY,
  gabiDelegatedRoutes,
  instanceLabel,
  sweepSentence,
} from './gabi-delegated.js';

const TOKEN = 'bot-bearer-value';

function app() {
  const a = new Hono<AppBindings>();
  a.route('/api/gabi/delegated', gabiDelegatedRoutes);
  return a;
}

/**
 * One row as `browse-works`'s projection reads it out of D1 — the raw column
 * names, so the stub exercises the mapping rather than pre-doing it.
 */
interface StubWorkRow {
  id: number;
  title: string;
  authors: string;
  series: string | null;
  series_index_display: string | null;
  series_index_sort: number | null;
  first_published: number | null;
  formats: string | null;
}

/**
 * A D1 stub answering exactly the queries this door makes.
 * Anything else throws, so a new query in the route fails this file loudly
 * rather than silently resolving to "no such person" (which would look like a
 * passing test and behave like a lockout).
 *
 * ⚠️ `works` defaults to `null`, meaning *"this test does not expect the shelf
 * to be read"* — and then a stray read throws. A default of `[]` would let a
 * verb quietly grow a catalog query that no test noticed.
 */
function stubDb(
  user: { id: number; role: string; firebase_uid: string } | null,
  estateStatus: string | null = 'approved',
  works: StubWorkRow[] | null = null,
) {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first() {
          if (sql.includes('WHERE firebase_uid = ?')) {
            return user && user.firebase_uid === bound[0]
              ? {
                  id: user.id,
                  email: 'someone@example.test',
                  firebase_uid: user.firebase_uid,
                  display_name: 'Someone',
                  review_name: 'Someone',
                  photo_url: null,
                  role: user.role,
                  first_seen_at: '2026-01-01 00:00:00',
                  approved_at: '2026-01-01 00:00:00',
                }
              : null;
          }
          if (sql.includes('estate_status')) {
            return {
              estate_status: estateStatus,
              estate_checked_at: '2026-08-18T00:00:00.000Z',
              estate_visibility: null,
            };
          }
          if (sql.includes('COUNT(*) AS n') && sql.includes('FROM work w')) {
            if (!works) throw new Error('stubDb: the shelf was read and this test did not expect it');
            return { n: works.length };
          }
          throw new Error(`stubDb: unexpected first() for: ${sql}`);
        },
        async all() {
          if (sql.includes('FROM work w') && sql.includes('LIMIT ? OFFSET ?')) {
            if (!works) throw new Error('stubDb: the shelf was read and this test did not expect it');
            // ⚠️ The two trailing binds ARE the clamped limit/offset the route
            // decided. Slicing with them is what lets a test assert the clamp
            // reached SQL, rather than only that the response echoed a number.
            const offset = Number(bound[bound.length - 1]);
            const limit = Number(bound[bound.length - 2]);
            return { results: works.slice(offset, offset + limit) };
          }
          throw new Error(`stubDb: unexpected all() for: ${sql}`);
        },
      };
      return stmt;
    },
  } as unknown as Env['DB'];
}

/** A shelf row, with only the interesting field spelled out per test. */
function work(id: number, over: Partial<StubWorkRow> = {}): StubWorkRow {
  return {
    id,
    title: `Book ${id}`,
    authors: 'Brandon Sanderson',
    series: null,
    series_index_display: null,
    series_index_sort: null,
    first_published: null,
    formats: 'paperback',
    ...over,
  };
}

async function post(
  path: string,
  body: unknown,
  env: Partial<Env>,
  headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` },
) {
  return app().request(
    `/api/gabi/delegated/${path}`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } },
    env as Env,
  );
}

// ── 1. the gate ─────────────────────────────────────────────────────────────

describe('the bearer gate — closed by default, and worded either way', () => {
  it('unset secret: 503 and a CONFIGURATION sentence, never a permissions one', async () => {
    const res = await post('whoami', { onBehalfOf: 'uid-123456' }, {});
    assert.equal(res.status, 503, 'an unset secret must disable the door, never open it');
    const body = (await res.json()) as { message?: string };
    assert.match(String(body.message), /configuration gap/i);
    // ⚠️ It must say the word "permissions" only to DENY being one. An outage
    // dressed as a refusal sends people asking for access they already hold.
    assert.match(String(body.message), /NOT a permissions problem/);
  });

  it('no Authorization header: 401 with words a person can act on', async () => {
    const res = await post('whoami', { onBehalfOf: 'uid-123456' }, { ESTATE_APP_TOKEN_DISCORD: TOKEN }, {});
    assert.equal(res.status, 401);
    assert.match(String(((await res.json()) as { message?: string }).message), /credential/i);
  });

  it('wrong bearer: 401 — and it says whose problem it is', async () => {
    const res = await post(
      'whoami',
      { onBehalfOf: 'uid-123456' },
      { ESTATE_APP_TOKEN_DISCORD: TOKEN },
      { Authorization: 'Bearer not-the-value' },
    );
    assert.equal(res.status, 401);
    assert.match(String(((await res.json()) as { message?: string }).message), /owner fix, not yours/i);
  });

  it('right bearer, junk body: 400 — proves the handler ran rather than the gate', async () => {
    const res = await post('whoami', {}, { ESTATE_APP_TOKEN_DISCORD: TOKEN });
    assert.equal(res.status, 400);
  });
});

// ── 2. the authority check, which is the actual security ────────────────────

describe('⚠️ the bot bearer authorises NOTHING on its own', () => {
  const env = (db: Env['DB'], extra: Partial<Env> = {}): Partial<Env> => ({
    ESTATE_APP_TOKEN_DISCORD: TOKEN,
    ESTATE_APP: 'library',
    DB: db,
    ...extra,
  });

  it('a uid with no account HERE is refused in words — and never created', async () => {
    const res = await post('add-isbn', { onBehalfOf: 'uid-stranger', isbn: '9780765326355' }, env(stubDb(null)));
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; message?: string };
    assert.equal(body.error, 'unknown_here');
    assert.match(String(body.message), /sign in once at library\.heygabi\.ai/i);
  });

  it('a role that cannot edit the catalog is refused, and the refusal names the fix', async () => {
    const res = await post(
      'add-isbn',
      { onBehalfOf: 'uid-123456', isbn: '9780765326355' },
      env(stubDb({ id: 4, role: 'member', firebase_uid: 'uid-123456' })),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; capability?: string; role?: string; message?: string };
    assert.equal(body.error, 'forbidden');
    assert.equal(body.capability, 'editCatalog');
    assert.equal(body.role, 'member');
    assert.match(String(body.message), /contributor/i, 'a refusal must say which role would work');
  });

  it('awaiting approval is its OWN sentence — a different fix from a low role', async () => {
    const res = await post(
      'run-details',
      { onBehalfOf: 'uid-123456' },
      env(stubDb({ id: 4, role: 'pending', firebase_uid: 'uid-123456' })),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; message?: string };
    assert.equal(body.error, 'pending');
    assert.match(String(body.message), /waiting to be approved/i);
  });

  it('an estate-revoked person is refused even at owner rank', async () => {
    const res = await post(
      'run-details',
      { onBehalfOf: 'uid-123456' },
      env(stubDb({ id: 1, role: 'owner', firebase_uid: 'uid-123456' }, 'revoked')),
    );
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error?: string }).error, 'estate_revoked');
  });

  it('the SITE named in a refusal is the instance that refused, not a constant', async () => {
    const res = await post(
      'add-isbn',
      { onBehalfOf: 'uid-stranger', isbn: '9780765326355' },
      env(stubDb(null), { ESTATE_APP: 'library2' }),
    );
    assert.match(String(((await res.json()) as { message?: string }).message), /padhard\.heygabi\.ai/);
  });

  it('whoami answers 200 known:false for a stranger — routing depends on it not being an error', async () => {
    const res = await post('whoami', { onBehalfOf: 'uid-stranger' }, env(stubDb(null)));
    assert.equal(res.status, 200, 'the bot asks BOTH shelves; "not here" is the ordinary answer');
    const body = (await res.json()) as { known?: boolean; site?: string };
    assert.equal(body.known, false);
    assert.equal(body.site, 'library.heygabi.ai');
  });

  it('whoami reports the capabilities the two writing verbs are gated on', async () => {
    const res = await post(
      'whoami',
      { onBehalfOf: 'uid-123456' },
      env(stubDb({ id: 4, role: 'contributor', firebase_uid: 'uid-123456' })),
    );
    const body = (await res.json()) as { capabilities?: Record<string, boolean> };
    assert.equal(body.capabilities?.editCatalog, true, 'a contributor may add');
    assert.equal(body.capabilities?.runResearch, false, 'a contributor may not spend money');
  });
});

// ── 3. the allowlist, pinned against the matrix rather than a copy ──────────

describe('⚠️ the delegated verb allowlist', () => {
  it('is exactly these four things', () => {
    // Adding a row here is a design decision somebody makes on purpose — the
    // same guard `GABI_TOOL_NAMES` carries, applied to the delegated surface.
    // ⚠️ `browse-works` (2026-08-19) is the first that only READS, and the
    // allowlist is the reason that had to be decided rather than assumed.
    assert.deepEqual([...DELEGATED_VERBS], ['whoami', 'add-isbn', 'run-details', 'browse-works']);
  });

  it('exactly two verbs change anything, and the other two are named as reads', () => {
    // The split decides how a refusal is WORDED. A read that says "nothing was
    // changed" is describing work it was never going to do.
    assert.deepEqual([...DELEGATED_READ_VERBS], ['whoami', 'browse-works']);
    const writers = DELEGATED_VERBS.filter((v) => !DELEGATED_READ_VERBS.includes(v));
    assert.deepEqual(writers, ['add-isbn', 'run-details']);
  });

  it('each gated verb borrows the capability its equivalent BUTTON needs', () => {
    assert.equal(DELEGATED_VERB_CAPABILITY['add-isbn'], 'editCatalog');
    assert.equal(DELEGATED_VERB_CAPABILITY['run-details'], 'runResearch');
    // ⚠️ `read`, not `editCatalog`: "a reader with no edit rights can still
    // walk to the bookcase" (the Discord side's own note on this gate). It is
    // the floor the collection grid itself stands on — no new gate invented.
    assert.equal(DELEGATED_VERB_CAPABILITY['browse-works'], 'read');
    assert.deepEqual(
      [...CAPABILITY_MATRIX.read],
      ['owner', 'admin', 'moderator', 'contributor', 'member', 'guest'],
    );
    assert.equal(can('guest', 'read'), true, 'the lowest standing there is may still look');
    assert.equal(can('pending', 'read'), false, 'and awaiting approval is not standing');
    // ⚠️ Asserted against the matrix itself. If `editCatalog` is ever widened
    // to `member`, that is a decision about the whole app — and this line makes
    // it a decision about GABI too, visibly, rather than a silent side effect.
    assert.deepEqual([...CAPABILITY_MATRIX.editCatalog], ['owner', 'admin', 'moderator', 'contributor']);
    assert.deepEqual([...CAPABILITY_MATRIX.runResearch], ['owner', 'admin', 'moderator']);
    assert.equal(can('member', 'editCatalog'), false);
    assert.equal(can('contributor', 'runResearch'), false, 'spending money is a higher rung than adding');
  });

  it('no delegated verb names an estate, deploy, role or moderation power (T4 is a wall)', () => {
    for (const verb of DELEGATED_VERBS) {
      assert.doesNotMatch(verb, /role|grant|revoke|deploy|secret|user|admin|delete|moderat/i);
    }
  });
});

// ── 4. she refuses to guess ─────────────────────────────────────────────────

describe('add-isbn refuses before it spends', () => {
  const env = {
    ESTATE_APP_TOKEN_DISCORD: TOKEN,
    ESTATE_APP: 'library',
    DB: stubDb({ id: 4, role: 'contributor', firebase_uid: 'uid-123456' }),
  } as Partial<Env>;

  it('the five-digit price add-on is a worded refusal, not a lookup', async () => {
    // The single most common thing a sweep locks onto by mistake. A stubDb that
    // throws on any query beyond the authority check is what proves nothing
    // else was touched.
    const res = await post('add-isbn', { onBehalfOf: 'uid-123456', isbn: '51999' }, env);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { outcome?: string; message?: string };
    assert.equal(body.outcome, 'not_an_isbn');
    assert.match(String(body.message), /add-on or a shop SKU/i);
  });

  it('an ASIN says why it cannot be looked up rather than failing quietly', async () => {
    const res = await post('add-isbn', { onBehalfOf: 'uid-123456', isbn: 'B08XYZ1234' }, env);
    const body = (await res.json()) as { outcome?: string; message?: string };
    assert.equal(body.outcome, 'not_an_isbn');
    assert.match(String(body.message), /ASIN/);
  });

  it('the "already on the shelf" wording never says the person owns nothing', () => {
    const msg = DELEGATED_MSG.alreadyOwned('Mistborn', 'library.heygabi.ai');
    assert.match(msg, /already there/i);
    assert.doesNotMatch(msg, /you do not|don't own/i);
  });

  it('the rescan refusal states plainly that NOTHING was changed', () => {
    const msg = DELEGATED_MSG.needsAPerson('Mistborn', '9780765311788', 'library.heygabi.ai');
    assert.match(msg, /\*\*Nothing was changed\.\*\*/);
    assert.match(msg, /four different things/i, 'the person is told WHY she would not guess');
  });
});

describe('the report sentence', () => {
  const base = { queued: 0, attempted: 0, filled: 0, donorFilled: 0, notFound: 0, errored: 0, heldForPerson: 0 };

  it('an empty queue is said plainly, not dressed up as work done', () => {
    assert.match(sweepSentence(base, 'library.heygabi.ai'), /queue is empty/i);
  });

  it('names the misses as loudly as the fills', () => {
    const said = sweepSentence(
      { ...base, queued: 40, attempted: 2, filled: 1, donorFilled: 1, notFound: 1 },
      'library.heygabi.ai',
    );
    assert.match(said, /filled 1 of the 2/);
    assert.match(said, /free from the other library/i);
    assert.match(said, /came back with nothing/i);
    assert.match(said, /40 books .* still have something missing/);
  });

  it('a converged-but-unanswerable queue explains why nothing was bought', () => {
    const said = sweepSentence({ ...base, queued: 55 }, 'padhard.heygabi.ai');
    assert.match(said, /already been asked/i);
    assert.match(said, /did not spend/i);
  });
});

// ── 5. the one READ verb ────────────────────────────────────────────────────

describe('browse-works — the shelf, for somebody the instance knows', () => {
  const shelf = [
    work(1, { title: 'The Way of Kings', series: 'The Stormlight Archive', series_index_display: '1', series_index_sort: 1, first_published: 2010, formats: 'hardcover,paperback' }),
    work(2, { title: 'Elantris', first_published: 2005, formats: 'paperback' }),
    work(3, { title: 'A Photographed Spine', formats: null }),
  ];
  const env = (
    user: { id: number; role: string; firebase_uid: string } | null,
    estate: string | null = 'approved',
    rows: StubWorkRow[] | null = shelf,
  ): Partial<Env> => ({
    ESTATE_APP_TOKEN_DISCORD: TOKEN,
    ESTATE_APP: 'library',
    DB: stubDb(user, estate, rows),
  });
  const guest = { id: 9, role: 'guest', firebase_uid: 'uid-123456' };

  it('a guest — the lowest standing there is — may look', async () => {
    // The whole point of gating on `read` rather than `editCatalog`. Somebody
    // who may not touch a single row can still be told where a book is.
    const res = await post('browse-works', { onBehalfOf: 'uid-123456' }, env(guest));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { outcome?: string; total?: number; rows?: unknown[] };
    assert.equal(body.outcome, 'works');
    assert.equal(body.total, 3);
    assert.equal(body.rows?.length, 3);
  });

  it('⚠️ hands out ONLY the allow-listed fields — no copies, no prices, no notes', async () => {
    // Default-deny, pinned by key list. `gabi-browse.ts`'s header names what is
    // never exported; this is the line that fails when a field arrives as a
    // side effect of a feature.
    const res = await post('browse-works', { onBehalfOf: 'uid-123456' }, env(guest));
    const body = (await res.json()) as { rows?: Record<string, unknown>[] };
    const row = body.rows?.[0];
    assert.ok(row);
    assert.deepEqual(Object.keys(row).sort(), [
      'authors',
      'formats',
      'id',
      'seriesIndex',
      'series',
      'title',
      'url',
      'year',
    ].sort());
  });

  it('says what it holds in words the rest of the estate already uses', async () => {
    const res = await post('browse-works', { onBehalfOf: 'uid-123456' }, env(guest));
    const body = (await res.json()) as { rows?: Record<string, unknown>[] };
    assert.deepEqual(body.rows?.[0]?.formats, ['Hardcover', 'Paperback']);
    assert.equal(body.rows?.[0]?.series, 'The Stormlight Archive');
    assert.equal(body.rows?.[0]?.seriesIndex, '1');
    assert.equal(body.rows?.[0]?.year, 2010);
  });

  it('⚠️ an empty formats list is a book with no printing typed in, NOT a book that is not there', async () => {
    // Six of the 341 matching works were in this state when the verb shipped.
    // A consumer reading [] as "no print copy" inverts the meaning of exactly
    // the rows the clause exists to keep — so the row is present and honest.
    const res = await post('browse-works', { onBehalfOf: 'uid-123456' }, env(guest));
    const body = (await res.json()) as { rows?: Record<string, unknown>[] };
    const photographed = body.rows?.find((r) => r.title === 'A Photographed Spine');
    assert.ok(photographed, 'it is on the shelf and must be offerable');
    assert.deepEqual(photographed.formats, []);
  });

  it('builds the link HERE, against the instance that answered', async () => {
    // Pointer construction, like `index-projection.ts`'s detail_url — so no
    // consumer has to know how this app's URLs are shaped, and a friend-instance
    // answer never links somebody at the main shelf.
    const main = await post('browse-works', { onBehalfOf: 'uid-123456' }, env(guest));
    assert.equal(
      ((await main.json()) as { rows?: Record<string, unknown>[] }).rows?.[0]?.url,
      'https://library.heygabi.ai/work/1',
    );
    const friend = await post('browse-works', { onBehalfOf: 'uid-123456' }, {
      ...env(guest),
      ESTATE_APP: 'library2',
    });
    assert.equal(
      ((await friend.json()) as { rows?: Record<string, unknown>[] }).rows?.[0]?.url,
      'https://padhard.heygabi.ai/work/1',
    );
  });

  it('the door’s own refusals hold — an unknown caller is told nothing about the shelf', async () => {
    // ⚠️ `works: null` on the stub: if the route read the catalog before
    // deciding who was asking, the stub throws rather than passing quietly.
    const res = await post('browse-works', { onBehalfOf: 'uid-stranger' }, env(null, 'approved', null));
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string; message?: string; rows?: unknown };
    assert.equal(body.error, 'unknown_here');
    assert.equal(body.rows, undefined, 'a refusal carries no rows');
    assert.match(String(body.message), /sign in once at library\.heygabi\.ai/i);
  });

  it('⚠️ a read refusal never claims "nothing was changed" — it was never going to change anything', async () => {
    const stranger = (await (
      await post('browse-works', { onBehalfOf: 'uid-stranger' }, env(null, 'approved', null))
    ).json()) as { message?: string };
    assert.doesNotMatch(String(stranger.message), /changed/i);
    assert.match(String(stranger.message), /show you anything/i);

    const pending = (await (
      await post('browse-works', { onBehalfOf: 'uid-123456' }, env({ id: 4, role: 'pending', firebase_uid: 'uid-123456' }, 'approved', null))
    ).json()) as { message?: string };
    assert.doesNotMatch(String(pending.message), /changed/i);

    const revoked = (await (
      await post('browse-works', { onBehalfOf: 'uid-123456' }, env({ id: 1, role: 'owner', firebase_uid: 'uid-123456' }, 'revoked', null))
    ).json()) as { message?: string };
    assert.doesNotMatch(String(revoked.message), /changed/i);

    // And the WRITE verbs still say it, because for them it is true.
    const write = (await (
      await post('add-isbn', { onBehalfOf: 'uid-stranger', isbn: '9780765326355' }, env(null, 'approved', null))
    ).json()) as { message?: string };
    assert.match(String(write.message), /did not change anything/i);
  });

  it('an estate-revoked person is refused even at owner rank, and a pending one too', async () => {
    for (const [user, estate, error] of [
      [{ id: 1, role: 'owner', firebase_uid: 'uid-123456' }, 'revoked', 'estate_revoked'],
      [{ id: 4, role: 'pending', firebase_uid: 'uid-123456' }, 'approved', 'pending'],
    ] as const) {
      const res = await post('browse-works', { onBehalfOf: 'uid-123456' }, env(user, estate, null));
      assert.equal(res.status, 403);
      assert.equal(((await res.json()) as { error?: string }).error, error);
    }
  });

  it('the bearer gate is the same gate — no bearer, no shelf', async () => {
    const res = await post('browse-works', { onBehalfOf: 'uid-123456' }, { ESTATE_APP_TOKEN_DISCORD: TOKEN }, {});
    assert.equal(res.status, 401);
    const unset = await post('browse-works', { onBehalfOf: 'uid-123456' }, {});
    assert.equal(unset.status, 503);
  });

  it('a missing onBehalfOf is a 400 — this verb has no anonymous mode', async () => {
    const res = await post('browse-works', {}, env(guest, 'approved', null));
    assert.equal(res.status, 400);
  });

  it('⚠️ the cap is HARD and is applied to the QUERY, not just echoed', async () => {
    const many = Array.from({ length: 12 }, (_, i) => work(i + 1));
    const res = await post(
      'browse-works',
      { onBehalfOf: 'uid-123456', limit: 5 },
      env(guest, 'approved', many),
    );
    const body = (await res.json()) as { total?: number; limit?: number; rows?: unknown[] };
    assert.equal(body.limit, 5);
    assert.equal(body.rows?.length, 5, 'the stub slices by the binds the route actually sent');
    assert.equal(body.total, 12, 'and the total says plainly that it was truncated');
  });

  it('offset pages the shelf, so a cap is not a silent bias toward the front', async () => {
    const many = Array.from({ length: 12 }, (_, i) => work(i + 1));
    const res = await post(
      'browse-works',
      { onBehalfOf: 'uid-123456', limit: 5, offset: 10 },
      env(guest, 'approved', many),
    );
    const body = (await res.json()) as { offset?: number; rows?: { id: number }[] };
    assert.equal(body.offset, 10);
    assert.deepEqual(body.rows?.map((r) => r.id), [11, 12]);
  });

  it('⚠️ junk in the limit CLAMPS rather than refuses — GABI must not decline over a number', async () => {
    const many = Array.from({ length: 12 }, (_, i) => work(i + 1));
    for (const [limit, expected] of [
      [10_000, BROWSE_MAX_LIMIT],
      [0, 1],
      [-5, 1],
      [1.5, BROWSE_DEFAULT_LIMIT],
      ['200', BROWSE_DEFAULT_LIMIT],
      [null, BROWSE_DEFAULT_LIMIT],
      // ⚠️ The two that a bare Math.min/Math.max would launder: NaN sails
      // through both comparisons and reaches SQL, Infinity clamps and looks fine.
      [Number.NaN, BROWSE_DEFAULT_LIMIT],
      [Number.POSITIVE_INFINITY, BROWSE_DEFAULT_LIMIT],
    ] as const) {
      const res = await post(
        'browse-works',
        { onBehalfOf: 'uid-123456', limit },
        env(guest, 'approved', many),
      );
      assert.equal(res.status, 200, `limit ${String(limit)} must not be an error`);
      assert.equal(
        ((await res.json()) as { limit?: number }).limit,
        expected,
        `limit ${String(limit)} clamps to ${expected}`,
      );
    }
  });

  it('the ceiling is one call for the whole shelf as measured', () => {
    // 341 works matched the clause on 2026-08-19. If the shelf outgrows the
    // ceiling this line is the reminder that the caller must start paging.
    assert.equal(BROWSE_DEFAULT_LIMIT, 200);
    assert.equal(BROWSE_MAX_LIMIT, 500);
    assert.ok(BROWSE_MAX_LIMIT > 341, 'one call at the ceiling was the whole shelf when this shipped');
  });

  it('names no estate, deploy, role or moderation power — T4 is still a wall', () => {
    // The read verb is inside the same fence as the writes, restated because a
    // read is exactly the kind of verb somebody widens without thinking.
    assert.doesNotMatch('browse-works', /role|grant|revoke|deploy|secret|user|admin|delete|moderat/i);
  });
});

describe('instanceLabel', () => {
  it('reads ESTATE_APP rather than hard-coding an instance (the 2026-08-17 bug)', () => {
    assert.deepEqual(instanceLabel({ ESTATE_APP: 'library' }), {
      app: 'library',
      site: 'library.heygabi.ai',
    });
    assert.deepEqual(instanceLabel({ ESTATE_APP: 'library2' }), {
      app: 'library2',
      site: 'padhard.heygabi.ai',
    });
    assert.equal(instanceLabel({}).app, 'library', 'unset means the main instance, as the gate does');
  });
});
