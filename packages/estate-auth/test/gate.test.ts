/**
 * The §14.5 shadow path, pinned: mode flag semantics, absent-config sanity,
 * the §3.1 would-verdicts as the library derives them, cache/TTL behaviour,
 * and the log line the rollout will be read from.
 *
 * The canonical module's own 31 tests (catalog-platform/packages/estate-auth)
 * pin the combination table and /seen client themselves; these tests pin THIS
 * repo's use of them — what shadow logs, and above all what it never does.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  LIBRARY_POSTURE,
  estateShadowCheck,
  parseEstateMode,
  type ShadowEnv,
  type ShadowSubject,
} from '../src/shadow.js';
import { REVOCATION_DELAY_MS } from '../generated/seen.js';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const FRESH = new Date(NOW - 60_000).toISOString(); // 1 min old — inside TTL
const EXPIRED = new Date(NOW - REVOCATION_DELAY_MS - 60_000).toISOString();

const ENV: ShadowEnv = {
  ESTATE_CHECK: 'shadow',
  ESTATE_AUTH_URL: 'https://auth.example',
  ESTATE_APP_TOKEN_LIBRARY: 'token-under-test',
};

function subject(overrides: Partial<ShadowSubject> = {}): ShadowSubject {
  return {
    email: 'skylar@example.com',
    firebaseUid: 'uid-1',
    displayName: 'Skylar',
    role: 'reader',
    approvedAt: '2026-08-01T00:00:00.000Z',
    estateStatus: null,
    estateCheckedAt: null,
    ...overrides,
  };
}

/** A fetch stub that answers /seen with the given status (or fails). */
function seenFetch(answer: string | 'network-error' | 500) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (answer === 'network-error') throw new TypeError('fetch failed');
    if (answer === 500) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ status: answer }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

// ── the mode flag ────────────────────────────────────────────────────────────

test('parseEstateMode: unset and off are off; shadow/enforce recognised; typos are off but flagged', () => {
  assert.deepEqual(parseEstateMode(undefined), { mode: 'off', recognised: true });
  assert.deepEqual(parseEstateMode(''), { mode: 'off', recognised: true });
  assert.deepEqual(parseEstateMode('off'), { mode: 'off', recognised: true });
  assert.deepEqual(parseEstateMode('shadow'), { mode: 'shadow', recognised: true });
  assert.deepEqual(parseEstateMode(' shadow '), { mode: 'shadow', recognised: true });
  assert.deepEqual(parseEstateMode('enforce'), { mode: 'enforce', recognised: true });
  // The inert direction, but never silently: caller logs `recognised: false`.
  assert.deepEqual(parseEstateMode('shdow'), { mode: 'off', recognised: false });
  assert.deepEqual(parseEstateMode('ON'), { mode: 'off', recognised: false });
});

test('off is INERT: no fetch, no refresh, no log line', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateShadowCheck(
    { ...ENV, ESTATE_CHECK: 'off' },
    subject(),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.performed, false);
  assert.equal(out.skipReason, 'mode_off');
  assert.equal(out.verdict, null);
  assert.equal(out.wouldDeny, false);
  assert.equal(out.refresh, null);
  assert.equal(out.logLine, null); // an inert deploy must not chatter
  assert.equal(calls.length, 0);
});

test('an unrecognised mode value is off WITH its name in the log', async () => {
  const { impl, calls } = seenFetch('approved');
  const out = await estateShadowCheck(
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
  const out = await estateShadowCheck(
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
  const out = await estateShadowCheck(
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
  const out = await estateShadowCheck(ENV, subject({ role: 'owner' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.performed, true);
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.wouldDeny, false);
  assert.equal(out.wouldAutoGrant, null);
  // Fresh answer → cache refresh for the caller to persist. `visibility` rides
  // with the status since §4.5 (upstream seen.ts); null = "no visibility fact
  // in the answer", which upstream documents as behaving exactly as before.
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

test('estate approved + local pending never decided → would auto-grant reader, writes nothing', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateShadowCheck(
    ENV,
    subject({ role: 'pending', approvedAt: null }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'default_grant');
  assert.equal(out.wouldAutoGrant, 'reader'); // §5.4, from the posture — visible, inert
  assert.equal(out.wouldDeny, false); // a grant is not a denial
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.would_auto_grant, 'reader');
  assert.equal(line.would_deny, false);
  // The outcome offers the caller ONLY a cache refresh — no role, no grant.
  // (`visibility` is part of the cache record since §4.5, not a grant.)
  assert.deepEqual(Object.keys(out.refresh ?? {}).sort(), ['checkedAt', 'status', 'visibility']);
});

test('estate approved + locally DEMOTED pending → request_screen (the estate does not overrule)', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateShadowCheck(
    ENV,
    subject({ role: 'pending', approvedAt: '2026-08-02T00:00:00.000Z' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.verdict, 'request_screen');
  assert.equal(out.wouldAutoGrant, null);
  assert.equal(out.wouldDeny, false); // pending already sees the request screen today
});

test('estate revoked + local owner → would-deny (revocation overrules everything)', async () => {
  const { impl } = seenFetch('revoked');
  const out = await estateShadowCheck(ENV, subject({ role: 'owner' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'revoked');
  assert.equal(out.wouldDeny, true);
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.would_deny, true);
  assert.equal(line.estate, 'revoked');
});

test('estate pending + active local role → proceed (local wins, §3.1 seed-gap row)', async () => {
  const { impl } = seenFetch('pending');
  const out = await estateShadowCheck(ENV, subject({ role: 'reader' }), {
    fetchImpl: impl,
    nowMs: NOW,
  });
  assert.equal(out.verdict, 'proceed');
  assert.equal(out.wouldDeny, false);
});

// ── unreachable estate: §6 row 1 in both directions ──────────────────────────

test('estate down + no cache + local pending → would-deny as estate_unreachable, named', async () => {
  const { impl } = seenFetch('network-error');
  const out = await estateShadowCheck(
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
  const out = await estateShadowCheck(
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
  const out = await estateShadowCheck(
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
  const out = await estateShadowCheck(
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
  const out = await estateShadowCheck(
    ENV,
    subject({ estateStatus: 'banana', estateCheckedAt: 'not-a-date' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(calls.length, 1); // unusable cache → ask
  assert.equal(out.verdict, 'proceed');
});

// ── enforce: not built, and loud about it ────────────────────────────────────

test('enforce behaves as shadow and flags enforce_requested on every line', async () => {
  const { impl } = seenFetch('revoked');
  const out = await estateShadowCheck(
    { ...ENV, ESTATE_CHECK: 'enforce' },
    subject({ role: 'owner' }),
    { fetchImpl: impl, nowMs: NOW },
  );
  assert.equal(out.performed, true);
  assert.equal(out.verdict, 'revoked');
  assert.equal(out.wouldDeny, true); // still a WOULD — the caller never acts on it
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.enforce_requested, true);
  assert.match(line.note, /not built/i);
});

// ── the log line itself: the artifact the rollout is read from ───────────────

test('the shadow log line is one valid JSON object with the greppable fields', async () => {
  const { impl } = seenFetch('approved');
  const out = await estateShadowCheck(ENV, subject(), { fetchImpl: impl, nowMs: NOW });
  const line = JSON.parse(out.logLine ?? 'null');
  assert.equal(line.tag, 'estate_shadow');
  assert.equal(line.app, 'library');
  assert.equal(line.mode, 'shadow');
  assert.equal(line.email, 'skylar@example.com');
  assert.equal(line.local_role, 'reader');
  assert.equal(line.estate, 'approved');
  assert.equal(line.verdict, 'proceed');
  assert.equal(typeof line.would_deny, 'boolean');
  assert.ok(!out.logLine!.includes('\n'), 'must be a single line for tail-grepping');
});

test('the posture declaration is the §5.4 config: library, not public, reader', () => {
  assert.equal(LIBRARY_POSTURE.app, 'library');
  assert.equal(LIBRARY_POSTURE.public, false);
  assert.equal(LIBRARY_POSTURE.defaultRole, 'reader');
  assert.ok(Object.isFrozen(LIBRARY_POSTURE));
});
