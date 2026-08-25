/**
 * `scripts/push-secrets.mjs` — the list logic behind "one command for BOTH
 * instances" (owner ask, 2026-08-25).
 *
 * ⚠️ **Nothing here calls wrangler, and nothing here reads `.dev.vars`.** The
 * unit under test is `planFor`, which is pure: it takes a list of key NAMES and
 * returns what would happen to each on each instance. Importing the module is
 * safe because its imperative half is behind an `isEntrypoint` guard — if that
 * guard ever regresses, these tests are what will try to push secrets and fail
 * loudly, which is the right way round.
 *
 * The property that matters is the one the old `--env friend` stub protected:
 * **a bulk run can never replace padhard's own key material.** Every refusal
 * assertion below is that property in a different disguise.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  LOCAL_ONLY,
  PER_INSTANCE_PREFIXES,
  PER_INSTANCE_SECRETS,
  PRODUCTION_SECRETS,
  PUSH_FRIEND,
  PUSH_MAIN,
  REFUSE_PER_INSTANCE,
  REFUSE_UNCLASSIFIED,
  SHARED_SECRETS,
  SKIP_UNSET,
  assertListsDisjoint,
  isPerInstance,
  parseDevVars,
  planFor,
} from '../push-secrets.mjs';

/** The action recorded for one key on one instance, or undefined. */
function actionFor(rows, name) {
  return rows.find((r) => r.name === name)?.action;
}

describe('the two lists', () => {
  it('⚠️ SHARED ∩ PER_INSTANCE = ∅ — the invariant the whole design rests on', () => {
    for (const name of SHARED_SECRETS) {
      assert.equal(
        isPerInstance(name),
        false,
        `${name} is on SHARED_SECRETS and also matches a per-instance rule`,
      );
    }
    assert.doesNotThrow(() => assertListsDisjoint());
  });

  it('⚠️ a key on BOTH lists is a startup error, not a warning', () => {
    assert.throws(
      () => assertListsDisjoint(['GOOGLE_BOOKS_API_KEY', 'ANTHROPIC_API_KEY'], ['ANTHROPIC_API_KEY'], []),
      /overlap: ANTHROPIC_API_KEY/,
    );
  });

  it('refuses a duplicated entry in SHARED_SECRETS', () => {
    assert.throws(() => assertListsDisjoint(['A', 'A'], [], []), /lists A twice/);
  });

  it('matches every ESTATE_APP_TOKEN_* by PREFIX, including ones nobody has minted', () => {
    assert.ok(PER_INSTANCE_PREFIXES.includes('ESTATE_APP_TOKEN_'));
    assert.ok(isPerInstance('ESTATE_APP_TOKEN_LIBRARY'));
    assert.ok(isPerInstance('ESTATE_APP_TOKEN_LIBRARY2'));
    assert.ok(isPerInstance('ESTATE_APP_TOKEN_DISCORD'));
    assert.ok(isPerInstance('ESTATE_APP_TOKEN_SOMETHING_LATER'));
    assert.ok(PER_INSTANCE_SECRETS.includes('ANTHROPIC_API_KEY'));
  });

  it('classifies the keys that are the same value on both instances BY DESIGN', () => {
    // Checked against the live secret NAMES on 2026-08-25 (names only).
    for (const name of [
      'GOOGLE_BOOKS_API_KEY',
      'HARDCOVER_API_TOKEN',
      'EBOOK_INGEST_TOKEN',
      'AUDIOBOOK_MAPPING_TOKEN',
      'DONOR_TOKEN',
      'PEER_TOKEN',
    ]) {
      assert.ok(SHARED_SECRETS.includes(name), `${name} should be shared`);
    }
    // ⚠️ Per-SOURCE on the index Worker (INDEX_PUSH_TOKEN_LIBRARY): main's value
    // would label padhard's rows `library`. Same mistake as her stale
    // ESTATE_APP_TOKEN_LIBRARY, which was deleted 2026-08-25.
    assert.equal(SHARED_SECRETS.includes('INDEX_PUSH_TOKEN'), false);
    assert.ok(isPerInstance('INDEX_PUSH_TOKEN'));
    // Unclassified on purpose — set on main, absent from PRODUCTION_SECRETS and
    // from her list, and the read half of the index does not exist yet.
    assert.equal(SHARED_SECRETS.includes('INDEX_READ_TOKEN'), false);
    assert.equal(isPerInstance('INDEX_READ_TOKEN'), false);
  });
});

describe('planFor — the friend path', () => {
  const everything = [...PRODUCTION_SECRETS, 'DONOR_TOKEN', 'PEER_TOKEN', 'INDEX_READ_TOKEN'];

  it('pushes the SHARED set and nothing else', () => {
    const plan = planFor(everything, { friend: true });
    for (const name of SHARED_SECRETS) {
      assert.equal(
        actionFor(plan.friend, name),
        PUSH_FRIEND,
        `${name} is shared and should be pushed to friend`,
      );
    }
    assert.deepEqual(plan.main, [], 'a --friend run must not touch main');
  });

  it('⚠️ REFUSES every per-instance key, with a sentence naming what to do instead', () => {
    const plan = planFor([...everything, 'ESTATE_APP_TOKEN_LIBRARY2'], { friend: true });
    for (const name of ['ANTHROPIC_API_KEY', 'ESTATE_APP_TOKEN_LIBRARY', 'INDEX_PUSH_TOKEN']) {
      const row = plan.friend.find((r) => r.name === name);
      assert.equal(row?.action, REFUSE_PER_INSTANCE, `${name} must be refused for friend`);
      assert.ok(row.why && row.why.length > 30, `${name} must say WHY in a sentence`);
    }
    // Her own estate bearer is per-instance too, even though it is also in
    // LOCAL_ONLY — the per-instance rule wins, which is the safe precedence.
    assert.equal(actionFor(plan.friend, 'ESTATE_APP_TOKEN_LIBRARY2'), REFUSE_PER_INSTANCE);
  });

  it('names an UNCLASSIFIED key rather than guessing its custody', () => {
    const plan = planFor(everything, { friend: true });
    const row = plan.friend.find((r) => r.name === 'INDEX_READ_TOKEN');
    assert.equal(row?.action, REFUSE_UNCLASSIFIED);
    assert.match(row.why, /Classify it/);
  });

  it('says "not set locally" for a shared key missing from .dev.vars, not "refused"', () => {
    // The difference is the whole reason both words exist: a key nobody has
    // written down is a gap, and a key we decline to send is a decision.
    const plan = planFor(['GOOGLE_BOOKS_API_KEY'], { friend: true });
    assert.equal(actionFor(plan.friend, 'GOOGLE_BOOKS_API_KEY'), PUSH_FRIEND);
    assert.equal(actionFor(plan.friend, 'HARDCOVER_API_TOKEN'), SKIP_UNSET);
  });

  it('never puts a VALUE in a plan entry — names and reasons only', () => {
    const plan = planFor(['GOOGLE_BOOKS_API_KEY', 'PEER_TOKEN'], { both: true });
    for (const row of [...plan.main, ...plan.friend]) {
      assert.deepEqual(
        Object.keys(row).filter((k) => !['name', 'action', 'why'].includes(k)),
        [],
        'a plan row carries name/action/why and nothing that could hold key material',
      );
    }
  });
});

describe('planFor — --both', () => {
  const present = [...PRODUCTION_SECRETS, 'DONOR_TOKEN', 'PEER_TOKEN'];

  it('pushes to MAIN everything the no-flag run would, and never less', () => {
    const plan = planFor(present, { both: true });
    for (const name of PRODUCTION_SECRETS) {
      assert.equal(
        actionFor(plan.main, name),
        PUSH_MAIN,
        `--both must not push less to main than secrets:push does (${name})`,
      );
    }
    // …plus the shared-by-design keys that predate the allowlist.
    assert.equal(actionFor(plan.main, 'DONOR_TOKEN'), PUSH_MAIN);
    assert.equal(actionFor(plan.main, 'PEER_TOKEN'), PUSH_MAIN);
  });

  it('⚠️ still refuses the per-instance keys on the FRIEND half', () => {
    const plan = planFor(present, { both: true });
    assert.equal(actionFor(plan.main, 'ANTHROPIC_API_KEY'), PUSH_MAIN, "main's own key still goes");
    assert.equal(
      actionFor(plan.friend, 'ANTHROPIC_API_KEY'),
      REFUSE_PER_INSTANCE,
      "hers must never be replaced by the owner's",
    );
    assert.equal(actionFor(plan.friend, 'ESTATE_APP_TOKEN_LIBRARY'), REFUSE_PER_INSTANCE);
  });

  it('plans nothing at all with no flags — the no-flag path is a separate code path', () => {
    const plan = planFor(present, {});
    assert.deepEqual(plan, { main: [], friend: [] });
  });
});

describe('parseDevVars — unchanged behaviour the no-flag path depends on', () => {
  it('reads NAME=value, strips quotes, ignores comments and blanks', () => {
    const got = parseDevVars(
      ['# a comment', '', 'A=1', 'B="two"', "C='three'", 'D=', 'NOTAPAIR'].join('\n'),
    );
    assert.deepEqual(got, { A: '1', B: 'two', C: 'three' });
  });

  it('still knows the LOCAL_ONLY keys by name', () => {
    assert.ok('DEV_EMAIL' in LOCAL_ONLY);
    assert.ok('ESTATE_APP_TOKEN_LIBRARY2' in LOCAL_ONLY);
  });
});
