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
