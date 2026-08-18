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
  DELEGATED_MSG,
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
 * A D1 stub answering exactly the two queries the authority check makes.
 * Anything else throws, so a new query in the route fails this file loudly
 * rather than silently resolving to "no such person" (which would look like a
 * passing test and behave like a lockout).
 */
function stubDb(user: { id: number; role: string; firebase_uid: string } | null, estateStatus: string | null = 'approved') {
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
          throw new Error(`stubDb: unexpected first() for: ${sql}`);
        },
      };
      return stmt;
    },
  } as unknown as Env['DB'];
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
  it('is exactly these three things', () => {
    // Adding a row here is a design decision somebody makes on purpose — the
    // same guard `GABI_TOOL_NAMES` carries, applied to the WRITE surface.
    assert.deepEqual([...DELEGATED_VERBS], ['whoami', 'add-isbn', 'run-details']);
  });

  it('each writing verb borrows the capability its equivalent BUTTON needs', () => {
    assert.equal(DELEGATED_VERB_CAPABILITY['add-isbn'], 'editCatalog');
    assert.equal(DELEGATED_VERB_CAPABILITY['run-details'], 'runResearch');
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
