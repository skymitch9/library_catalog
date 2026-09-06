/**
 * billing-denied-shape.test.ts — what `billingDenied` MEANS as it crosses into
 * this repo.
 *
 * ⚠️ WHY THIS FILE EXISTS. On 2026-09-02 the pretest sync pulled billing phase 1
 * (catalog-platform `644338d`, design
 * `catalog-platform/docs/info/llm-billing-control-design.md` §3.4) and five
 * pinned shapes in `gate.test.ts` went red. Widening a pin because it went red
 * is how a repo stops noticing what its dependency does to it, so the pins were
 * widened only after answering *what does the new field mean*, and this file is
 * that answer written down where it can fail.
 *
 * 🔴 THE ONE RULE: `null` MEANS "UNKNOWN", NOT "NOTHING IS DENIED". An auth
 * Worker running pre-billing code answers no `billing_denied` at all, and a
 * consumer that read its absence as an empty deny-list would silently un-switch
 * every policy the owner had set — for as long as the deploy took, with nothing
 * anywhere going red. `[]` is a different fact: the directory answered, and
 * nothing is denied. The two must stay distinguishable at this boundary.
 *
 * ⚠️ NOTHING IN THIS REPO READS THE FIELD YET, and that is a gap rather than a
 * decision. `GateOutcome.refresh` in `../src/gate.ts` still declares three keys,
 * and `apps/worker/src/middleware/auth.ts` persists status/visibility/checkedAt
 * and drops this one, so no money path here is switchable from /admin. Billing
 * phase 3 (catalog-platform's TODO) is where that changes; `docs/KNOWN_ISSUES.md`
 * carries the entry. These tests pin the WIRE so that phase starts from a known
 * shape instead of a re-derived one.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { estateGateCheck, type GateEnv, type GateSubject } from '../src/gate.js';
import { REVOCATION_DELAY_MS } from '../generated/seen.js';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const FRESH = new Date(NOW - 60_000).toISOString();
const EXPIRED = new Date(NOW - REVOCATION_DELAY_MS - 60_000).toISOString();

const ENV: GateEnv = {
  ESTATE_CHECK: 'enforce',
  ESTATE_AUTH_URL: 'https://auth.example',
  ESTATE_APP_TOKEN_LIBRARY: 'token-under-test',
};

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

/** A /seen stub whose body is written out key by key, so "absent" is testable. */
function answering(body: Record<string, unknown>) {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

async function refreshFor(body: Record<string, unknown>) {
  const out = await estateGateCheck(ENV, subject(), { fetchImpl: answering(body), nowMs: NOW });
  return out.refresh as unknown as { billingDenied: string[] | null } | null;
}

test('a real deny-list rides through to the refresh, in the directory’s own order', async () => {
  const refresh = await refreshFor({ status: 'approved', billing_denied: ['research.covers', 'chapters.llm'] });
  assert.deepEqual(refresh?.billingDenied, ['research.covers', 'chapters.llm']);
});

test('🔴 an ABSENT billing_denied is null — "unknown", never "nothing is denied"', async () => {
  // This is what a pre-billing auth Worker answers, and what every /seen stub
  // in gate.test.ts sends. Reading it as [] would un-switch every policy the
  // owner had set for the length of a deploy, silently.
  const refresh = await refreshFor({ status: 'approved' });
  assert.equal(refresh?.billingDenied, null);
});

test('🔴 an EMPTY list is [] — a different fact from null, and it must stay different', async () => {
  // The directory answered and nothing is denied. A consumer may act on this;
  // it may not act on null the same way.
  const refresh = await refreshFor({ status: 'approved', billing_denied: [] });
  assert.deepEqual(refresh?.billingDenied, []);
  assert.notEqual(refresh?.billingDenied, null);
});

test('⚠️ a malformed billing_denied dies into null, not into a partial list', async () => {
  // Anything that is not an array is not an answer. Coercing a string into a
  // one-element deny-list would switch off a feature nobody named.
  for (const junk of ['research.covers', 42, { research: false }, null]) {
    const refresh = await refreshFor({ status: 'approved', billing_denied: junk });
    assert.equal(refresh?.billingDenied, null, `${JSON.stringify(junk)} should not survive`);
  }
});

test('⚠️ non-string entries are dropped, and the rest of the list still counts', async () => {
  // Refusing the WHOLE list on one bad entry would fail in the allowing
  // direction, which for a deny-list is the wrong way round: the ids the
  // directory did name are still names it meant.
  const refresh = await refreshFor({ status: 'approved', billing_denied: ['research.covers', 7, '', 'sweep.details'] });
  assert.deepEqual(refresh?.billingDenied, ['research.covers', 'sweep.details']);
});

test('the denials ride WITH the status and are stamped by the same checkedAt (§4.5)', async () => {
  const out = await estateGateCheck(ENV, subject(), {
    fetchImpl: answering({ status: 'approved', visibility: ['library'], billing_denied: ['chapters.llm'] }),
    nowMs: NOW,
  });
  // ⚠️ ONE ANSWER, ONE MOMENT. "May this person spend" and "is this person
  // still a member" are not two questions with two ages.
  assert.deepEqual(out.refresh as unknown, {
    status: 'approved',
    visibility: ['library'],
    billingDenied: ['chapters.llm'],
    checkedAt: new Date(NOW).toISOString(),
  });
});

test('⚠️ a fresh cache offers no refresh at all — and this repo caches no billing fact to offer', async () => {
  // `GateSubject` has estateStatus / estateCheckedAt / estateVisibilityJson and
  // no billing column, so a cache hit can only ever answer null for the money
  // question. That is the phase-3 gap, pinned rather than assumed: this
  // assertion is what will go red the day a billing cache column is added and
  // somebody forgets to teach the gate about it.
  const calls: string[] = [];
  const out = await estateGateCheck(
    ENV,
    subject({ estateStatus: 'approved', estateCheckedAt: FRESH, estateVisibilityJson: '["library"]' }),
    {
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
      nowMs: NOW,
    },
  );
  assert.equal(calls.length, 0, 'a fresh cache must not call /seen');
  assert.equal(out.refresh, null);
  assert.ok(!Object.prototype.hasOwnProperty.call(subject(), 'billingDenied'));
});

test('an expired cache calls /seen, and the fresh answer brings its denials with it', async () => {
  const out = await estateGateCheck(
    ENV,
    subject({ estateStatus: 'approved', estateCheckedAt: EXPIRED }),
    { fetchImpl: answering({ status: 'approved', billing_denied: ['research.isbn'] }), nowMs: NOW },
  );
  assert.deepEqual((out.refresh as unknown as { billingDenied: string[] }).billingDenied, ['research.isbn']);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE OTHER HALF OF THE DISTINCTION — added 2026-09-06
 *
 * Everything above this line feeds a `/seen` RESPONSE BODY and reads
 * `out.refresh.billingDenied` — the WIRE parser. The mutation run of
 * 2026-09-05 (`catalog-platform/docs/info/mutation-run-2026-09-05.md` §5 S3)
 * measured that the other two producers of the same value were unguarded, and
 * proved it by breaking them and watching all 45 cases stay green:
 *
 *   LC-07  `parseCachedBillingDenied`: a NULL COLUMN answers `[]`
 *   LC-08  the SKIPPED outcome answers `billingDenied: []` instead of `null`
 *
 * Both collapse UNKNOWN into "the directory answered and denied nothing" —
 * the single thing this file exists to keep apart — and both are read from
 * `out.billingDenied`, the EFFECTIVE value a money route acts on, which no
 * test here ever looked at.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A fetch that fails the test if it is called at all. */
const neverCalled = (async () => {
  throw new Error('/seen must not be called on this path');
}) as typeof fetch;

/**
 * The EFFECTIVE deny-set for a person whose cache is FRESH — so `estateCheck`
 * short-circuits on the cache and the only thing that can have produced this
 * value is `parseCachedBillingDenied` reading the 0440 column.
 */
async function cachedBillingDenied(json: string | null) {
  const out = await estateGateCheck(
    ENV,
    subject({
      estateStatus: 'approved',
      estateCheckedAt: FRESH,
      estateVisibilityJson: '["library"]',
      estateBillingDeniedJson: json,
    }),
    { fetchImpl: neverCalled, nowMs: NOW },
  );
  assert.equal(out.performed, true, 'the gate must actually have run');
  return out.billingDenied;
}

test('🔴 a NULL cache column is null — an absent answer is not an empty deny-list', async () => {
  // LC-07. Every row written before migration 0440, and every row belonging to
  // somebody the gate has not yet checked, holds NULL here. Answering `[]` for
  // them says "the directory denied nothing" about a directory nobody asked.
  assert.equal(await cachedBillingDenied(null), null);
});

test('🔴 a cached "[]" IS [] — the directory answered, and denied nothing', async () => {
  const denied = await cachedBillingDenied('[]');
  assert.deepEqual(denied, []);
  assert.notEqual(denied, null, 'the two facts must not collapse into one');
});

test('a cached real list rides through in the directory’s own order', async () => {
  assert.deepEqual(await cachedBillingDenied('["research.covers","chapters.llm"]'), [
    'research.covers',
    'chapters.llm',
  ]);
});

test('⚠️ cached GARBAGE dies into null, never into a partial or empty list', async () => {
  // The column crossed a network AND a database; parse it like the untrusted
  // text it is. Same failure direction as the wire parser above.
  for (const junk of ['not json', '{"a":1}', '42', '"research.covers"', 'null', '']) {
    assert.equal(await cachedBillingDenied(junk), null, `${JSON.stringify(junk)} should not survive`);
  }
});

test('non-string entries are dropped from a cached list, the rest still counts', async () => {
  assert.deepEqual(await cachedBillingDenied('["research.covers",7,"","sweep.details"]'), [
    'research.covers',
    'sweep.details',
  ]);
});

test('🔴 the log line carries the cached ARRAY, so null and [] stay apart in `wrangler tail` too', async () => {
  // Reading a COUNT off the log would collapse the distinction in the one
  // place an incident is actually read from.
  const line = async (json: string | null) => {
    const out = await estateGateCheck(
      ENV,
      subject({
        estateStatus: 'approved',
        estateCheckedAt: FRESH,
        estateVisibilityJson: '["library"]',
        estateBillingDeniedJson: json,
      }),
      { fetchImpl: neverCalled, nowMs: NOW },
    );
    return JSON.parse(out.logLine!) as { billing_denied: unknown };
  };
  assert.equal((await line(null)).billing_denied, null);
  assert.deepEqual((await line('[]')).billing_denied, []);
});

/* ── LC-08: a gate that sought no answer has no answer ────────────────────── */

/**
 * Every SKIPPED path, by the `skipReason` the outcome names. An off gate, a
 * gate with no bearer and a gate that cannot name its own app all made no
 * `/seen` call — so the only honest answer to "what may this person spend on"
 * is UNKNOWN.
 */
const SKIP_CASES: Array<{ name: string; env: GateEnv; reason: string }> = [
  {
    name: 'ESTATE_CHECK unset',
    env: { ESTATE_AUTH_URL: 'https://auth.example', ESTATE_APP_TOKEN_LIBRARY: 'token-under-test' },
    reason: 'mode_off',
  },
  {
    name: "ESTATE_CHECK 'off'",
    env: { ...ENV, ESTATE_CHECK: 'off' },
    reason: 'mode_off',
  },
  {
    name: 'an unrecognised ESTATE_CHECK (a typo falls to off)',
    env: { ...ENV, ESTATE_CHECK: 'enfroce' },
    reason: 'mode_off',
  },
  {
    name: 'no bearer configured',
    env: { ESTATE_CHECK: 'enforce', ESTATE_AUTH_URL: 'https://auth.example' },
    reason: 'estate_config_unset',
  },
  {
    name: 'no ESTATE_AUTH_URL',
    env: { ESTATE_CHECK: 'enforce', ESTATE_APP_TOKEN_LIBRARY: 'token-under-test' },
    reason: 'estate_config_unset',
  },
  {
    name: 'an unrecognised ESTATE_APP',
    env: { ...ENV, ESTATE_APP: 'libary' },
    reason: 'estate_app_unrecognised',
  },
];

for (const c of SKIP_CASES) {
  test(`🔴 a SKIPPED gate answers UNKNOWN, not "[]" — ${c.name}`, async () => {
    // LC-08. `null` proceeds and `[]` proceeds, so nothing goes red either
    // way today — but `[]` is a CLAIM that the directory was asked and named
    // nothing, and a money route is entitled to believe it. A gate that made
    // no call may not make that claim.
    const out = await estateGateCheck(c.env, subject(), { fetchImpl: neverCalled, nowMs: NOW });
    assert.equal(out.performed, false);
    assert.equal(out.skipReason, c.reason);
    assert.equal(out.billingDenied, null, 'an off gate sought no answer and has none');
  });
}

test('🔴 a skipped gate is silent about money in its log line too', async () => {
  // The two skip paths that DO log (a typo'd mode, a typo'd app) name the
  // misconfiguration and nothing else — `billing_denied` is absent, not `[]`.
  for (const env of [{ ...ENV, ESTATE_CHECK: 'enfroce' }, { ...ENV, ESTATE_APP: 'libary' }]) {
    const out = await estateGateCheck(env, subject(), { fetchImpl: neverCalled, nowMs: NOW });
    const logged = JSON.parse(out.logLine!) as Record<string, unknown>;
    assert.ok(
      !Object.prototype.hasOwnProperty.call(logged, 'billing_denied'),
      'a gate that asked nothing must not report a deny-set',
    );
  }
});
