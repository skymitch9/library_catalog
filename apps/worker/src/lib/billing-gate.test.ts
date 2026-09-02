/**
 * billing-gate.test.ts — the spending gate's truth table, its wording, and the
 * two things about it that fail SILENTLY if they are ever got wrong.
 *
 * Design: `catalog-platform/docs/info/llm-billing-control-design.md` §3.5
 * (failure directions), §4 (postures), §6 (what a refusal says). Closes
 * `docs/KNOWN_ISSUES.md` KI-13, whose own "what would change it" names the wire
 * pins in `packages/estate-auth/test/billing-denied-shape.test.ts` as where
 * phase 3 starts — this file is the other end of that wire.
 *
 * 🔴 THE TWO SILENT FAILURES THIS FILE EXISTS TO CATCH:
 *
 *   1. `null` collapsing into `[]`. An auth Worker mid-deploy answers no
 *      `billing_denied` at all; reading that absence as "nothing is denied"
 *      un-switches every policy the owner set, for the length of the deploy,
 *      with nothing anywhere going red.
 *   2. A feature id that does not match the registry. A Worker checking
 *      `research.cover` (singular) against a registry holding `research.covers`
 *      fails open FOREVER and nothing ever complains. The literal pin below is
 *      the same guard the registry has one layer up.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  BILLING_FEATURES,
  BILLING_POSTURES,
  billingPosture,
  billingRefusalFor,
  billingSite,
  decideBilling,
  parseCachedDenied,
} from './billing-gate.js';

const ENV = { BILLING_POLICY: 'enforce', ESTATE_APP: 'library' } as const;

// ---------------------------------------------------------------------------
// The posture, coerced the same way ESTATE_CHECK is.
// ---------------------------------------------------------------------------

test('the three postures are recognised, trimmed and case-folded', () => {
  for (const p of BILLING_POSTURES) {
    assert.equal(billingPosture(p), p);
    assert.equal(billingPosture(` ${p.toUpperCase()} `), p);
  }
});

test('⚠️ unset, empty and typo’d all fall to off — the inert direction', () => {
  assert.equal(billingPosture(undefined), 'off');
  assert.equal(billingPosture(''), 'off');
  // A typo must not silently half-enable a money gate. `enforc` is not
  // "enforce with a letter missing", it is off — and it says so on the console
  // (not asserted here; the point is the VALUE).
  assert.equal(billingPosture('enforc'), 'off');
  assert.equal(billingPosture('ON'), 'off');
});

// ---------------------------------------------------------------------------
// The site — the one place this Worker differs from the index Worker's gate.
// ---------------------------------------------------------------------------

test('🔴 the site follows ESTATE_APP, so padhard is judged as library2 and not as library', () => {
  assert.equal(billingSite({ ESTATE_APP: 'library' }), 'library');
  assert.equal(billingSite({ ESTATE_APP: 'library2' }), 'library2');
  // Unset is the main instance's identity, matching `resolveEstateApp`.
  assert.equal(billingSite({ ESTATE_APP: undefined }), 'library');
});

test('⚠️ an unrecognised ESTATE_APP has NO site, and no site behaves as off', () => {
  // Estate credentials F-5 in miniature: falling back to `library` here would
  // judge the friend instance's spending against the main library's rules.
  assert.equal(billingSite({ ESTATE_APP: 'libary' }), null);
  const out = decideBilling({
    posture: 'enforce',
    site: null,
    feature: BILLING_FEATURES.covers,
    denied: [BILLING_FEATURES.covers],
  });
  assert.deepEqual(out, { wouldDeny: false, proceeded: true, log: false });
});

// ---------------------------------------------------------------------------
// The truth table.
// ---------------------------------------------------------------------------

test('off resolves nothing, logs nothing and proceeds — even on a denied feature', () => {
  const out = decideBilling({
    posture: 'off',
    site: 'library',
    feature: BILLING_FEATURES.covers,
    denied: [BILLING_FEATURES.covers],
  });
  assert.deepEqual(out, { wouldDeny: false, proceeded: true, log: false });
});

test('🔴 shadow LOGS AND BILLS — `proceeded` is true on a would-deny, and that field is the point', () => {
  // The lesson `info/audiobook-auth-soak-2026-08-16.md` cost the estate once:
  // a soak line with no outcome field cannot separate a true regression from
  // the gate merely agreeing with today's rules.
  const out = decideBilling({
    posture: 'shadow',
    site: 'library',
    feature: BILLING_FEATURES.covers,
    denied: [BILLING_FEATURES.covers],
  });
  assert.deepEqual(out, { wouldDeny: true, proceeded: true, log: true });
});

test('shadow logs the AGREEING decisions too — a soak with no denominator is not a soak', () => {
  const out = decideBilling({
    posture: 'shadow',
    site: 'library',
    feature: BILLING_FEATURES.covers,
    denied: [],
  });
  assert.deepEqual(out, { wouldDeny: false, proceeded: true, log: true });
});

test('enforce refuses a denied feature and nothing else', () => {
  assert.deepEqual(
    decideBilling({
      posture: 'enforce',
      site: 'library',
      feature: BILLING_FEATURES.covers,
      denied: [BILLING_FEATURES.covers, BILLING_FEATURES.series],
    }),
    { wouldDeny: true, proceeded: false, log: true },
  );
  assert.deepEqual(
    decideBilling({
      posture: 'enforce',
      site: 'library',
      feature: BILLING_FEATURES.details,
      denied: [BILLING_FEATURES.covers],
    }),
    { wouldDeny: false, proceeded: true, log: false },
  );
});

test('🔴 null is UNKNOWN and UNKNOWN PROCEEDS, even in enforce', () => {
  // §3.5 row 3, chosen out loud: denying every paid feature when the directory
  // is unreachable turns an auth outage into a household-wide "everything is
  // broken". The wallet is bounded by SWEEP_LIMIT and the timeouts, not here.
  assert.deepEqual(
    decideBilling({
      posture: 'enforce',
      site: 'library',
      feature: BILLING_FEATURES.covers,
      denied: null,
    }),
    { wouldDeny: false, proceeded: true, log: false },
  );
});

test('🔴 [] is a REAL ANSWER — "the directory denied nothing" — and is not null', () => {
  // Both proceed, for different reasons, and the reasons must stay
  // distinguishable: one is a fact, the other is the absence of one.
  const empty = decideBilling({
    posture: 'shadow',
    site: 'library',
    feature: BILLING_FEATURES.covers,
    denied: [],
  });
  const unknown = decideBilling({
    posture: 'shadow',
    site: 'library',
    feature: BILLING_FEATURES.covers,
    denied: null,
  });
  assert.equal(empty.log, true, '[] is an answer worth a soak line');
  assert.equal(unknown.log, true, 'shadow logs unknown too, so the soak can count outages');
  assert.equal(empty.proceeded, true);
  assert.equal(unknown.proceeded, true);
});

// ---------------------------------------------------------------------------
// The cached column, parsed like the untrusted text it is.
// ---------------------------------------------------------------------------

test('🔴 the cached column keeps null and [] apart', () => {
  assert.equal(parseCachedDenied(null), null, 'no column value is UNKNOWN');
  assert.deepEqual(parseCachedDenied('[]'), [], 'a stored empty array is a real answer');
});

test('⚠️ garbage in the column dies into null, never into a partial deny-list', () => {
  for (const junk of ['not json', '"research.covers"', '42', '{"a":1}', 'null']) {
    assert.equal(parseCachedDenied(junk), null, `${junk} should not survive`);
  }
});

test('⚠️ non-string entries are dropped and the rest of the list still counts', () => {
  // Voiding the whole list on one bad entry fails in the ALLOWING direction,
  // which for a deny-list is the wrong way round: the ids the directory did
  // name are still names it meant.
  assert.deepEqual(parseCachedDenied('["research.covers",7,"","sweep.details"]'), [
    'research.covers',
    'sweep.details',
  ]);
});

// ---------------------------------------------------------------------------
// The refusal body — never a bare status.
// ---------------------------------------------------------------------------

test('🔴 the refusal says what happened, what it needs and how to change it', () => {
  const out = billingRefusalFor(ENV, {
    feature: BILLING_FEATURES.covers,
    label: 'Paid cover search',
    estCents: '6',
    denied: [BILLING_FEATURES.covers],
    principal: 'someone@example.com',
  });
  assert.ok(out, 'enforce + denied must refuse');
  assert.equal(out.status, 403);
  assert.equal(out.body['error'], 'billing_denied');
  assert.equal(
    out.body['detail'],
    'Paid cover search is switched off for this catalogue. The owner can turn it back on.',
  );
  assert.equal(out.body['needs'], 'the estate owner');
  // ⚠️ The HOW names the Spending panel and the ten-minute delay. A page that
  // implies "instantly" invites the owner to press it twice (§3.4).
  assert.match(String(out.body['how']), /Spending panel/);
  assert.match(String(out.body['how']), /10 minutes/);
});

test('⚠️ the SITE sentence, not the person one — this Worker cannot tell which rule matched', () => {
  // It is handed a resolved SET, not the rules. Guessing "switched off for
  // you" when it was switched off for the whole catalogue sends somebody to
  // ask the owner for something nobody there can grant (§6's site/person
  // split, which is load-bearing).
  const out = billingRefusalFor(ENV, {
    feature: BILLING_FEATURES.series,
    label: 'Series volume scan',
    estCents: '8',
    denied: [BILLING_FEATURES.series],
  });
  assert.match(String(out?.body['detail']), /for this catalogue/);
  assert.doesNotMatch(String(out?.body['detail']), /for you/);
});

test('the refusal body carries no `why` — that column is the owner’s note and may name people', () => {
  const out = billingRefusalFor(ENV, {
    feature: BILLING_FEATURES.details,
    label: 'Details research',
    estCents: '2-8',
    denied: [BILLING_FEATURES.details],
  });
  assert.deepEqual(Object.keys(out?.body ?? {}).sort(), [
    'detail',
    'error',
    'feature',
    'how',
    'needs',
  ]);
});

test('shadow never refuses, whatever the deny-set says', () => {
  const out = billingRefusalFor(
    { BILLING_POLICY: 'shadow', ESTATE_APP: 'library2' },
    {
      feature: BILLING_FEATURES.scanPhoto,
      label: 'Photo scanning',
      estCents: '$5/$25 per MTok',
      denied: [BILLING_FEATURES.scanPhoto],
    },
  );
  assert.equal(out, null);
});

// ---------------------------------------------------------------------------
// 🔴 The literal pins.
// ---------------------------------------------------------------------------

test('🔴 every feature id this Worker checks is the registry’s exact string', () => {
  // The registry lives in catalog-platform's auth Worker and is NOT importable
  // from here, so this is a literal pin — the same shape the registry's own
  // pin test uses one layer up, for the same reason: a Worker that checks an
  // id the registry does not hold fails SILENTLY OPEN, forever, and no test
  // anywhere else in the estate would notice.
  assert.deepEqual(BILLING_FEATURES, {
    details: 'research.details',
    covers: 'research.covers',
    series: 'research.series',
    scanPhoto: 'scan.photo',
    gabiPanel: 'gabi.panel',
    sweep: 'sweep.details',
  });
});

test('⚠️ `gabi.panel` is this repo’s id — `gabi.chat` is the Discord Worker’s, and they are two switches', () => {
  assert.notEqual(BILLING_FEATURES.gabiPanel as string, 'gabi.chat');
});

test('🔴 wrangler.toml ships BILLING_POLICY = "off" on BOTH instances', () => {
  // A mechanical guard, not advice: a site is flipped one at a time, on
  // evidence, and never as a side effect of an unrelated deploy (§4.2). This
  // fails the moment a flip is committed, so the flip has to be deliberate —
  // the same trick `Board_Game_Catalog`'s estate-refusals test plays on
  // ESTATE_CHECK's comment block.
  const toml = readFileSync(
    fileURLToPath(new URL('../../wrangler.toml', import.meta.url).href),
    'utf8',
  );
  const values = [...toml.matchAll(/^BILLING_POLICY\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
  assert.equal(values.length, 2, 'one BILLING_POLICY for [vars], one for [env.friend.vars]');
  assert.deepEqual(values, ['off', 'off']);
});
