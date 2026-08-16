/**
 * The §14.5 gate, pinned in both observing and acting modes.
 *
 * Part 1 is the shadow suite (carried from the shadow-only revision — those
 * behaviours must survive the enforce build byte-for-byte where they are
 * logged). Part 2 mirrors it in enforce: every §3.1 row again, this time
 * asserting the DIRECTIVES — deny 403/503, autoGrant — and that shadow's
 * inertness properties hold exactly where they should and nowhere else.
 *
 * The canonical module's own tests (catalog-platform/packages/estate-auth)
 * pin the combination table and /seen client; these pin THIS repo's use of
 * them — what the gate tells the middleware to do, and what it never does.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  LIBRARY_POSTURE,
  estateGateCheck,
  parseEstateMode,
  type GateEnv,
  type GateSubject,
} from '../src/gate.js';
import { REVOCATION_DELAY_MS } from '../generated/seen.js';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const FRESH = new Date(NOW - 60_000).toISOString(); // 1 min old — inside TTL
const EXPIRED = new Date(NOW - REVOCATION_DELAY_MS - 60_000).toISOString();

const ENV: GateEnv = {
  ESTATE_CHECK: 'shadow',
  ESTATE_AUTH_URL: 'https://auth.example',
  ESTATE_APP_TOKEN_LIBRARY: 'token-under-test',
};
const ENFORCE: GateEnv = { ...ENV, ESTATE_CHECK: 'enforce' };

function subject(overrides: Partial<GateSubject> = {}): GateSubject {
  return {
    email: 'skylar@example.com',
    firebaseUid: 'uid-1',
    displayName: 'Skylar',
    role: 'member',
    approvedAt: '2026-08-01T00:00:00.000Z',
    estateStatus: null,
    estateCheckedAt: null,
    estateVisibilityJson: null,
    ...overrides,
  };
}

/** A fetch stub that answers /seen with the given status (or fails). */
function seenFetch(answer: string | 'network-error' | 500, visibility?: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (answer === 'network-error') throw new TypeError('fetch failed');
    if (answer === 500) return new Response('{}', { status: 500 });
    const body: Record<string, unknown> = { status: answer };
    if (visibility !== undefined) body['visibility'] = visibility;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

// ═════════════════════════════════ Part 1: the shadow suite, carried ════════

// ── the mode flag ────────────────────────────────────────────────────────────

test('parseEstateMode: unset and off are off; shadow/enforce recognised; typos are off but flagged', () => {
  assert.deepEqual(parseEstateMode(undefined), { mode: 'off', recognised: true });
  assert.deepEqual(parseEstateMode(''), { mode: 'off', recognised: true });
  assert.deepEqual(parseEstateMode('off'), { mode: 'off', recognised: true });
  assert.deepEqual(parseEstateMode('shadow'), { mode: 'shadow', recognised: true });
  assert.deepEqual(parseEstateMode(' shadow '), { mode: 'shadow', recognised: true });
  assert.deepEqual(parseEstateMode('enforce'), { mode: 'enforce', recognised: true });
  // The inert direction — a typo must never enforce by accident — but never
  // silently: caller logs `recognised: false`.
  assert.deepEqual(parseEstateMode('shdow'), { mode: 'off', recognised: false });
  assert.deepEqual(parseEstateMode('ON'), { mode: 'off', recognised: false });
});

test('off is INERT: no fetch, no refresh, no log line, no directives', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(
    { ...ENV, ESTATE_CHECK: 'off' },
    subject(),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.performed, false);
  assert.equal(out.skipReason, 'mode_off');
  assert.equal(out.verdict, null);
  assert.equal(out.wouldDeny, false);
  assert.equal(out.deny, null);
  assert.equal(out.autoGrant, null);
  assert.equal(out.refresh, null);
  assert.equal(out.logLine, null); // an inert deploy must not chatter
  assert.equal(calls.length, 0);
});

test('an unrecognised mode value is off WITH its name in the log', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(
    { ...ENV, ESTATE_CHECK: 'shdow' },
    subject(),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.performed, false);
  assert.equal(calls.length, 0);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.event, 'mode_unrecognised');
  assert.equal(line.estate_check_raw, 'shdow');
  assert.equal(line.treated_as, 'off');
});

// ── absent config: the state every deploy passes through ─────────────────────

test('shadow with no URL/token behaves as off, names what is missing, never fetches', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(
    { ESTATE_CHECK: 'shadow' },
    subject(),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.performed, false);
  assert.equal(out.skipReason, 'estate_config_unset');
  assert.equal(out.wouldDeny, false);
  assert.equal(out.refresh, null);
  assert.equal(calls.length, 0);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.event, 'estate_config_unset');
  assert.deepEqual(line.missing, ['ESTATE_AUTH_URL', 'ESTATE_APP_TOKEN_LIBRARY']);
});

test('token present but URL missing is still config_unset, naming only the URL', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(
    { ESTATE_CHECK: 'shadow', ESTATE_APP_TOKEN_LIBRARY: 't' },
    subject(),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.skipReason, 'estate_config_unset');
  assert.deepEqual(JSON.parse(out.logLine ?? 'null').missing, ['ESTATE_AUTH_URL']);
  assert.equal(calls.length, 0);
});

// ── the would-verdicts, per §3.1 as the library derives local standing ───────

test('household member: estate approved + active local role → proceed, no would-deny', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(ENV, subject({ role: 'owner' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.performed, true);
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.wouldDeny, false);
  assert.equal(out.wouldAutoGrant, null);
  // Fresh answer → cache refresh for the caller to persist. `visibility` rides
  // with the status since §4.5; null = "no visibility fact in the answer".
  assert.deepEqual(out.refresh, {
    status: 'approved',
    visibility: null,
    checkedAt: new Date(NOW).toISOString(),
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.endsWith('/api/estate/seen'));
  // The per-app bearer, not the user's token (§4.4).
  assert.equal(
    (calls[0]!.init?.headers as Record<string, string>).Authorization,
    'Bearer token-under-test',
  );
});

test('estate approved + local pending never decided → would auto-grant member, no directive in shadow', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateGateCheck(
    ENV,
    subject({ role: 'pending', approvedAt: null }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'default_grant');
  assert.equal(out.wouldAutoGrant, 'member'); // §5.4, from the posture — visible, inert
  assert.equal(out.autoGrant, null); // ⚠️ shadow NEVER hands the caller a grant
  assert.equal(out.wouldDeny, false); // a grant is not a denial
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.would_auto_grant, 'member');
  assert.equal(line.would_deny, false);
  // The outcome offers the caller ONLY a cache refresh — no role, no grant.
  assert.deepEqual(Object.keys(out.refresh ?? {}).sort(), ['checkedAt', 'status', 'visibility']);
});

test('estate approved + locally DEMOTED pending → request_screen (the estate does not overrule)', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateGateCheck(
    ENV,
    subject({ role: 'pending', approvedAt: '2026-08-02T00:00:00.000Z' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'request_screen');
  assert.equal(out.wouldAutoGrant, null);
  assert.equal(out.wouldDeny, false); // pending already sees the request screen today
});

test('estate revoked + local owner → would-deny (revocation overrules everything), no directive in shadow', async () => {
  const { impl } = seenFetch('revoked');
  const out = await estateGateCheck(ENV, subject({ role: 'owner' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'revoked');
  assert.equal(out.wouldDeny, true);
  assert.equal(out.deny, null); // ⚠️ shadow NEVER hands the caller a refusal
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.would_deny, true);
  assert.equal(line.estate, 'revoked');
});

test('estate pending + active local role → proceed (local wins, §3.1 seed-gap row)', async () => {
  const { impl } = seenFetch('pending');
  const out = await estateGateCheck(ENV, subject({ role: 'member' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.wouldDeny, false);
});

// ── unreachable estate: §6 row 1 in both directions ──────────────────────────

test('estate down + no cache + local pending → would-deny as estate_unreachable, named', async () => {
  const { impl } = seenFetch('network-error');
  const out = await estateGateCheck(
    ENV,
    subject({ role: 'pending', approvedAt: null }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'estate_unreachable');
  assert.equal(out.wouldDeny, true);
  assert.equal(out.refresh, null);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.src, 'none');
  assert.equal(line.estate, null);
});

test('estate down + stale approved cache + active local → proceed on the stale value, marked stale', async () => {
  const { impl } = seenFetch(500);
  const out = await estateGateCheck(
    ENV,
    subject({ estateStatus: 'approved', estateCheckedAt: EXPIRED }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.wouldDeny, false);
  assert.equal(out.refresh, null); // a failed call refreshes nothing
  assert.equal(JSON.parse(out.logLine ?? 'null').src, 'stale_cache');
});

// ── the TTL cache ────────────────────────────────────────────────────────────

test('fresh cache: no /seen call at all, verdict from the cached status', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(
    ENV,
    subject({ estateStatus: 'revoked', estateCheckedAt: FRESH, role: 'owner' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(calls.length, 0); // the whole point of the cache
  assert.equal(out.verdict, 'revoked');
  assert.equal(out.refresh, null);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.src, 'cache');
  assert.equal(line.seen_ms, null);
});

test('expired cache: /seen called, fresh answer replaces the cached status', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(
    ENV,
    subject({ estateStatus: 'pending', estateCheckedAt: EXPIRED }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(calls.length, 1);
  assert.equal(out.verdict, 'proceed');
  assert.deepEqual(out.refresh, {
    status: 'approved',
    visibility: null,
    checkedAt: new Date(NOW).toISOString(),
  });
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.src, 'seen');
  assert.equal(typeof line.seen_ms, 'number');
});

test('garbage on the cache columns is treated as no cache, not a crash', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateGateCheck(
    ENV,
    subject({ estateStatus: 'banana', estateCheckedAt: 'not-a-date' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(calls.length, 1); // unusable cache → ask
  assert.equal(out.verdict, 'proceed');
});

// ── the log line itself: the artifact the rollout is read from ───────────────

test('the shadow log line is one valid JSON object with the greppable fields', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateGateCheck(ENV, subject(), { fetchImpl: impl, nowMs: NOW });
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.tag, 'estate_shadow');
  assert.equal(line.app, 'library');
  assert.equal(line.mode, 'shadow');
  assert.equal(line.email, 'skylar@example.com');
  assert.equal(line.local_role, 'member');
  assert.equal(line.estate, 'approved');
  assert.equal(line.verdict, 'proceed');
  assert.equal(typeof line.would_deny, 'boolean');
  assert.ok(!out.logLine!.includes('\n'), 'must be a single line for tail-grepping');
});

test('the posture declaration is the §5.4 config: library, not public, member', () => {
  assert.equal(LIBRARY_POSTURE.app, 'library');
  assert.equal(LIBRARY_POSTURE.public, false);
  assert.equal(LIBRARY_POSTURE.defaultRole, 'member');
  assert.ok(Object.isFrozen(LIBRARY_POSTURE));
});

// ═════════════════════════ Part 2: the enforce arm, §3.1 row by row ═════════

test('enforce / revoked + local owner → deny 403 estate_revoked (row 1: anything, even owner)', async () => {
  const { impl } = seenFetch('revoked');
  const out = await estateGateCheck(ENFORCE, subject({ role: 'owner' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'revoked');
  assert.deepEqual(out.deny, { status: 403, body: { error: 'estate_revoked' } });
  // Computed, not stored: the ONLY writes offered are the cache columns —
  // the outcome carries no role write, so a later re-approval restores the
  // person exactly as they were.
  assert.equal(out.autoGrant, null);
  assert.deepEqual(Object.keys(out.refresh ?? {}).sort(), ['checkedAt', 'status', 'visibility']);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.tag, 'estate_enforce');
  assert.equal(line.denied, true);
});

test('enforce / approved + active local role → proceed, no directives (row 2)', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateGateCheck(ENFORCE, subject({ role: 'member' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.deny, null);
  assert.equal(out.autoGrant, null);
  assert.equal(JSON.parse(out.logLine ?? 'null').denied, false);
});

test('enforce / approved + never-locally-decided pending → autoGrant member (row 3, §5.4)', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateGateCheck(
    ENFORCE,
    subject({ role: 'pending', approvedAt: null }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'default_grant');
  assert.deepEqual(out.autoGrant, { role: 'member' });
  assert.equal(out.deny, null);
  assert.equal(out.wouldDeny, false);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.auto_grant, 'member');
  assert.equal(line.denied, false);
});

test('enforce / approved + locally DEMOTED pending → request_screen, NO grant (row 4)', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateGateCheck(
    ENFORCE,
    subject({ role: 'pending', approvedAt: '2026-08-02T00:00:00.000Z' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'request_screen');
  assert.equal(out.autoGrant, null); // a local owner's demotion is standing
  assert.equal(out.deny, null);
});

test('enforce / estate pending + active local → proceed (row 5: local wins, seed gap)', async () => {
  const { impl } = seenFetch('pending');
  const out = await estateGateCheck(ENFORCE, subject({ role: 'moderator' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.deny, null);
  assert.equal(out.autoGrant, null);
});

test('enforce / estate pending + local pending → request_screen, nothing refused (row 6)', async () => {
  const { impl } = seenFetch('pending');
  const out = await estateGateCheck(
    ENFORCE,
    subject({ role: 'pending', approvedAt: null }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'request_screen');
  assert.equal(out.deny, null);
  assert.equal(out.autoGrant, null);
});

test('enforce / estate down + stale approved cache + active local → proceed on stale (row 7)', async () => {
  const { impl } = seenFetch('network-error');
  const out = await estateGateCheck(
    ENFORCE,
    subject({ estateStatus: 'approved', estateCheckedAt: EXPIRED, role: 'member' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.deny, null);
  assert.equal(JSON.parse(out.logLine ?? 'null').src, 'stale_cache');
});

test('enforce / estate down + NO cache + active local (break-glass lane) → proceed (row 7 / §6 row 4)', async () => {
  // An OWNER_EMAILS holder reaches the gate with a local owner role (the
  // upsert hatch runs first); with the directory down and no cache at all,
  // local standing alone must keep serving them — recovery never depends on
  // the thing being recovered.
  const { impl } = seenFetch('network-error');
  const out = await estateGateCheck(ENFORCE, subject({ role: 'owner' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.deny, null);
});

test('enforce / estate down + no cache + no standing → deny 503 estate_unreachable, NAMED (row 8)', async () => {
  const { impl } = seenFetch('network-error');
  const out = await estateGateCheck(
    ENFORCE,
    subject({ role: 'pending', approvedAt: null }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'estate_unreachable');
  assert.equal(out.deny?.status, 503);
  assert.equal(out.deny?.body.error, 'estate_unreachable');
  // Named so an outage never reads as a denial (§6 row 1).
  assert.match((out.deny?.body as { detail: string }).detail, /did not answer/);
});

test('enforce / fresh revoked cache → deny 403 WITHOUT a /seen call (TTL is the revocation delay)', async () => {
  const { impl, calls } = seenFetch('approved'); // would say approved — must not be asked
  const out = await estateGateCheck(
    ENFORCE,
    subject({ estateStatus: 'revoked', estateCheckedAt: FRESH, role: 'owner' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(calls.length, 0);
  assert.equal(out.deny?.status, 403);
});

test('enforce with config unset behaves as OFF — a half-configured enforce must never lock out', async () => {
  const { impl, calls } = seenFetch('revoked');
  const out = await estateGateCheck(
    { ESTATE_CHECK: 'enforce' },
    subject({ role: 'pending', approvedAt: null }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.performed, false);
  assert.equal(out.skipReason, 'estate_config_unset');
  assert.equal(out.deny, null);
  assert.equal(out.autoGrant, null);
  assert.equal(calls.length, 0);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.tag, 'estate_enforce'); // greppable in the enforce stream
  assert.equal(line.event, 'estate_config_unset');
});

test('the enforce log line carries the acting vocabulary, single-line JSON', async () => {
  const { impl } = seenFetch('revoked');
  const out = await estateGateCheck(ENFORCE, subject({ role: 'owner' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.tag, 'estate_enforce');
  assert.equal(line.mode, 'enforce');
  assert.equal(line.denied, true);
  assert.equal(line.auto_grant, null);
  assert.equal('would_deny' in line, false); // would-vocabulary is shadow's
  assert.ok(!out.logLine!.includes('\n'), 'must be a single line for tail-grepping');
});

// ── §4.5 visibility rides with the status, both modes ────────────────────────

test('a /seen answer with visibility → refresh carries the canonical array, and it is logged', async () => {
  const { impl } = seenFetch('approved', ['library', 'audiobook']); // wrong order on purpose
  const out = await estateGateCheck(ENFORCE, subject({ role: 'member' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  // Canonicalised by the module: CATALOGS order, deduped.
  assert.deepEqual(out.refresh?.visibility, ['audiobook', 'library']);
  assert.deepEqual(JSON.parse(out.logLine ?? 'null').visibility, ['audiobook', 'library']);
});

test('garbage visibility in the answer dies into null; the status half still counts', async () => {
  const { impl } = seenFetch('approved', ['library', 'narnia']);
  const out = await estateGateCheck(ENV, subject({ role: 'member' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'proceed');
  assert.deepEqual(out.refresh, {
    status: 'approved',
    visibility: null,
    checkedAt: new Date(NOW).toISOString(),
  });
});

test('cached visibility JSON is parsed at the boundary; garbage text is no fact, not a crash', async () => {
  const { impl, calls } = seenFetch('approved', ['audiobook', 'library', 'games']);
  // Fresh cache with valid visibility text: no call, visibility logged from cache.
  const cached = await estateGateCheck(
    ENFORCE,
    subject({
      estateStatus: 'approved',
      estateCheckedAt: FRESH,
      estateVisibilityJson: '["audiobook","library"]',
    }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(cached.logLine ?? 'null').visibility, ['audiobook', 'library']);
  // Unparseable text → treated as no visibility fact; the fresh status still
  // short-circuits (the library is a status-only gate, not a scope consumer).
  const garbage = await estateGateCheck(
    ENFORCE,
    subject({
      estateStatus: 'approved',
      estateCheckedAt: FRESH,
      estateVisibilityJson: 'not-json{',
    }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(calls.length, 0);
  assert.equal(garbage.verdict, 'proceed');
  assert.equal(JSON.parse(garbage.logLine ?? 'null').visibility, null);
});
