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
  SKIP_LOCAL_ONLY,
  SHARED_ALWAYS,
  SHARED_OPT_IN,
  SHARED_SECRETS,
  SKIP_OPT_IN,
  SKIP_NOT_SELECTED,
  SKIP_UNSET,
  assertListsDisjoint,
  assertNoGluedValues,
  assertSharedListsDisjoint,
  findGluedValues,
  gluedRefusalMessage,
  isPerInstance,
  looksGlued,
  narrowTo,
  optInReason,
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
    // ⚠️ Per-APP on the index Worker, the READ direction's twin of the argument
    // above (classified 2026-08-25, when rung 2 went live). The index resolves
    // its machine callers BY THE VALUE, so main is `library` and padhard is
    // `library2`; one shared value would make the app name meaningless and one
    // leak would revoke both. This assertion used to say the opposite — that the
    // key was deliberately unclassified because the read half did not exist yet.
    assert.equal(SHARED_SECRETS.includes('INDEX_READ_TOKEN'), false);
    assert.ok(isPerInstance('INDEX_READ_TOKEN'));
    // ⚠️ It is on the MAIN allowlist too, exactly like ANTHROPIC_API_KEY: the
    // no-flag run must still push main's own value.
    assert.ok(PRODUCTION_SECRETS.includes('INDEX_READ_TOKEN'));
  });
});

describe('planFor — the friend path', () => {
  const everything = [...PRODUCTION_SECRETS, 'DONOR_TOKEN', 'PEER_TOKEN', 'INDEX_READ_TOKEN'];

  it('pushes the SHARED_ALWAYS set and nothing else', () => {
    const plan = planFor(everything, { friend: true });
    for (const name of SHARED_ALWAYS) {
      assert.equal(
        actionFor(plan.friend, name),
        PUSH_FRIEND,
        `${name} is shared-always and should be pushed to friend`,
      );
    }
    // ⚠️ The opt-in half is NOT pushed without --enable. Changed 2026-08-25:
    // before the split this loop ran over all of SHARED_SECRETS and expected
    // PUSH_FRIEND for these two, which is exactly the accident it now prevents.
    for (const name of SHARED_OPT_IN) {
      assert.equal(actionFor(plan.friend, name), SKIP_OPT_IN, `${name} must be opt-in`);
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
    // ⚠️ The subject changed on 2026-08-25: INDEX_READ_TOKEN was the example
    // here until its custody was decided, and a test that kept asserting the old
    // answer would have gone green while the whole point moved. LIBRARYTHING_API_KEY
    // is a genuinely unclassified key today and stands in its place.
    const plan = planFor([...everything, 'LIBRARYTHING_API_KEY'], { friend: true });
    const row = plan.friend.find((r) => r.name === 'LIBRARYTHING_API_KEY');
    assert.equal(row?.action, REFUSE_UNCLASSIFIED);
    assert.match(row.why, /Classify it/);
  });

  it('⚠️ REFUSES the friend a machine READ token that would make her look like main', () => {
    const plan = planFor(everything, { friend: true });
    const row = plan.friend.find((r) => r.name === 'INDEX_READ_TOKEN');
    assert.equal(row?.action, REFUSE_PER_INSTANCE);
    // The sentence must name the drop-box, because a refusal with no route
    // forward is how a key ends up pasted somewhere it should not be.
    assert.match(row.why, /INDEX_READ_TOKEN_FRIEND_PADHARD/);
    assert.match(row.why, /secret:friend/);
  });

  it('the FRIEND drop-box line is local-only, and can never match an allowlist', () => {
    // Named rather than merely refused, so a bulk run explains it; and named
    // DIFFERENTLY from the live key on purpose — an allowlist match is a
    // string comparison, so the drop-box must not be that string.
    const plan = planFor([...everything, 'INDEX_READ_TOKEN_FRIEND_PADHARD'], { friend: true });
    assert.equal(actionFor(plan.friend, 'INDEX_READ_TOKEN_FRIEND_PADHARD'), SKIP_LOCAL_ONLY);
    assert.equal(PRODUCTION_SECRETS.includes('INDEX_READ_TOKEN_FRIEND_PADHARD'), false);
    assert.equal(SHARED_SECRETS.includes('INDEX_READ_TOKEN_FRIEND_PADHARD'), false);
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

  it('⚠️ keeps `KEY = value` with spaces around the `=` — .dev.vars really has those lines', () => {
    // Not cosmetic: `ANTHROPIC_API_KEY_FRIEND_SAM = ""` is written that way, and
    // a parser that lost the spaced form would silently stop seeing real keys.
    const got = parseDevVars(['A = 1', '  B  =  "two"  ', "C\t=\t'three'"].join('\n'));
    assert.deepEqual(got, { A: '1', B: 'two', C: 'three' });
  });
});

// ---------------------------------------------------------------------------
// GUARD 1 — a glued value refuses the whole run (incident 2026-08-25)
// ---------------------------------------------------------------------------

describe('the glued-value guard', () => {
  it('⚠️ catches the real incident: PEER_TOKEN welded onto the END of another value', () => {
    // The shape a `>>` append onto a file with no trailing newline produces.
    const vars = parseDevVars(
      ['GOOGLE_BOOKS_API_KEY=aaa', 'HARDCOVER_API_TOKEN=hc-real-valuePEER_TOKEN=pt-real-value'].join(
        '\n',
      ),
    );
    // The welded key never appears as a key at all — that is why nothing
    // downstream could notice.
    assert.equal('PEER_TOKEN' in vars, false);
    assert.deepEqual(findGluedValues(vars), ['HARDCOVER_API_TOKEN']);
  });

  it('refuses the WHOLE run, not just the offending key', () => {
    const vars = { A: 'fineA', HARDCOVER_API_TOKEN: 'hcPEER_TOKEN=pt', B: 'fineB' };
    assert.throws(() => assertNoGluedValues(vars, '.dev.vars'), /nothing was pushed/);
  });

  it('names the KEY and NEVER the value', () => {
    const msg = gluedRefusalMessage(['HARDCOVER_API_TOKEN'], '.dev.vars');
    assert.match(msg, /HARDCOVER_API_TOKEN/);
    assert.match(msg, /looks like two lines glued together \(a missing trailing newline\?\)/);
    assert.match(msg, /fix the file, nothing was pushed/);
    // The value must not be reachable from the message — the guard is only ever
    // given names to print.
    assert.equal(msg.includes('hc-real-value'), false);
    assert.equal(msg.includes('pt-real-value'), false);
  });

  it('catches a CR or an LF inside a value', () => {
    // Belt-and-braces: parseDevVars cannot produce one today, so this guards a
    // FUTURE parser that learns about quoted multi-line values.
    assert.ok(looksGlued('abc\ndef'));
    assert.ok(looksGlued('abc\rdef'));
    assert.deepEqual(findGluedValues({ K: 'a\nb' }), ['K']);
  });

  it('passes a clean file untouched', () => {
    const vars = parseDevVars(
      [
        '# comment',
        'GOOGLE_BOOKS_API_KEY=AIzaSyAbcdef-123456',
        'HARDCOVER_API_TOKEN="Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"',
        'PEER_TOKEN=6f1e2d3c4b5a',
        'DEV_EMAIL = someone@example.test',
      ].join('\n'),
    );
    assert.deepEqual(findGluedValues(vars), []);
    assert.doesNotThrow(() => assertNoGluedValues(vars, '.dev.vars'));
  });

  it('⚠️ does NOT refuse base64 padding — the false positive that would block a good rotation', () => {
    // `[A-Z][A-Z0-9_]{2,}=` matches the tail of plenty of legitimate base64.
    // A real weld always has the SECOND key's value after the `=`; padding does
    // not, so the remainder is what tells them apart.
    assert.equal(looksGlued('c29tZSBzZWNyZXQgQUJDRA='), false);
    assert.equal(looksGlued('c29tZSBzZWNyZXQgQUJDRA=='), false);
    assert.equal(looksGlued('lots+of/base64+ABC123=='), false);
    // …but padding-looking text followed by a value is still a weld.
    assert.ok(looksGlued('c29tZSBzZWNyZXQgQUJDRA==PEER_TOKEN=abc'));
  });

  it('does not fire on ordinary values that merely contain an `=`', () => {
    assert.equal(looksGlued('https://example.test/x?a=1&b=2'), false);
    assert.equal(looksGlued('key=value'), false, 'lowercase is not a KEY shape');
    assert.equal(looksGlued('AB=cd'), false, 'two chars is under the {2,} floor');
  });
});

// ---------------------------------------------------------------------------
// GUARD 2 — route-ENABLING shared keys are opt-in per instance
// ---------------------------------------------------------------------------

describe('SHARED_ALWAYS / SHARED_OPT_IN', () => {
  it('splits the shared list into unconditional and route-enabling halves', () => {
    assert.deepEqual(SHARED_ALWAYS, [
      'GOOGLE_BOOKS_API_KEY',
      'HARDCOVER_API_TOKEN',
      'DONOR_TOKEN',
      'PEER_TOKEN',
    ]);
    assert.deepEqual(SHARED_OPT_IN, ['EBOOK_INGEST_TOKEN', 'AUDIOBOOK_MAPPING_TOKEN']);
    // The union is still SHARED_SECRETS — "is this shared at all?" is unchanged.
    assert.deepEqual(SHARED_SECRETS, [...SHARED_ALWAYS, ...SHARED_OPT_IN]);
  });

  it('⚠️ a key on BOTH shared lists is a startup error, not a warning', () => {
    assert.doesNotThrow(() => assertSharedListsDisjoint());
    assert.throws(
      () => assertSharedListsDisjoint(['A', 'EBOOK_INGEST_TOKEN'], ['EBOOK_INGEST_TOKEN']),
      /overlap: EBOOK_INGEST_TOKEN/,
    );
  });

  it('keeps the SHARED ∩ PER_INSTANCE = ∅ invariant across the split', () => {
    for (const name of [...SHARED_ALWAYS, ...SHARED_OPT_IN]) {
      assert.equal(isPerInstance(name), false, `${name} must not also be per-instance`);
    }
    assert.doesNotThrow(() => assertListsDisjoint());
  });
});

describe('planFor — the opt-in rule', () => {
  const present = [...PRODUCTION_SECRETS, 'DONOR_TOKEN', 'PEER_TOKEN'];

  it('⚠️ --friend alone SKIPS the opt-in keys, naming the flag that would send them', () => {
    const plan = planFor(present, { friend: true });
    for (const name of SHARED_OPT_IN) {
      const row = plan.friend.find((r) => r.name === name);
      assert.equal(row?.action, SKIP_OPT_IN);
      assert.match(row.why, /route-ENABLING/);
      assert.match(row.why, new RegExp(`--enable ${name}`));
    }
  });

  it('⚠️ --both SKIPS them too — the exact 2026-08-25 side effect', () => {
    // `secrets:push:both` created EBOOK_INGEST_TOKEN on padhard as a side effect
    // of the PEER_TOKEN rotation. This assertion is that incident, frozen.
    const plan = planFor(present, { both: true });
    assert.equal(actionFor(plan.friend, 'EBOOK_INGEST_TOKEN'), SKIP_OPT_IN);
    assert.equal(actionFor(plan.friend, 'AUDIOBOOK_MAPPING_TOKEN'), SKIP_OPT_IN);
    // …and MAIN still gets both, because main is the source of truth.
    assert.equal(actionFor(plan.main, 'EBOOK_INGEST_TOKEN'), PUSH_MAIN);
    assert.equal(actionFor(plan.main, 'AUDIOBOOK_MAPPING_TOKEN'), PUSH_MAIN);
  });

  it('--enable NAME sends that ONE key and no other opt-in key', () => {
    const plan = planFor(present, { both: true, enable: ['EBOOK_INGEST_TOKEN'] });
    assert.equal(actionFor(plan.friend, 'EBOOK_INGEST_TOKEN'), PUSH_FRIEND);
    assert.equal(
      actionFor(plan.friend, 'AUDIOBOOK_MAPPING_TOKEN'),
      SKIP_OPT_IN,
      'enabling one opt-in key must not enable the other',
    );
  });

  it('--enable is repeatable', () => {
    const plan = planFor(present, { friend: true, enable: [...SHARED_OPT_IN] });
    for (const name of SHARED_OPT_IN) {
      assert.equal(actionFor(plan.friend, name), PUSH_FRIEND);
    }
  });

  it('says "not set locally", not "opt-in", for an opt-in key missing from .dev.vars', () => {
    // A key nobody has written down is a GAP; offering --enable for it would be
    // offering a flag that could not work.
    const plan = planFor(['GOOGLE_BOOKS_API_KEY'], { friend: true });
    assert.equal(actionFor(plan.friend, 'EBOOK_INGEST_TOKEN'), SKIP_UNSET);
  });

  it('--enable changes nothing about the per-instance refusals', () => {
    const plan = planFor([...present, 'ESTATE_APP_TOKEN_LIBRARY2'], {
      both: true,
      enable: [...SHARED_OPT_IN],
    });
    for (const name of ['ANTHROPIC_API_KEY', 'ESTATE_APP_TOKEN_LIBRARY', 'INDEX_PUSH_TOKEN']) {
      assert.equal(actionFor(plan.friend, name), REFUSE_PER_INSTANCE, `${name} stays refused`);
    }
  });

  it('leaves the MAIN half of --both byte-identical to before the split', () => {
    // The split reordered SHARED_SECRETS; main's list is
    // PRODUCTION ∪ (SHARED \ PRODUCTION) and must be unchanged by that.
    const plan = planFor(present, { both: true });
    assert.deepEqual(
      plan.main.map((r) => r.name),
      [...PRODUCTION_SECRETS, 'DONOR_TOKEN', 'PEER_TOKEN'],
    );
  });

  it('never puts a VALUE in an opt-in skip row either', () => {
    const plan = planFor(present, { both: true });
    for (const row of [...plan.main, ...plan.friend]) {
      assert.deepEqual(
        Object.keys(row).filter((k) => !['name', 'action', 'why'].includes(k)),
        [],
      );
    }
  });

  it('the printed action carries the flag a reader needs to type', () => {
    assert.equal(SKIP_OPT_IN, 'skip (opt-in; --enable NAME)');
    assert.match(optInReason('EBOOK_INGEST_TOKEN'), /capability grant, not a rotation/);
  });
});

// ---------------------------------------------------------------------------
// `--only NAME` — narrowing, and only ever narrowing (2026-08-26)
// ---------------------------------------------------------------------------

describe('narrowTo — the --only flag', () => {
  const present = [...PRODUCTION_SECRETS, 'DONOR_TOKEN', 'PEER_TOKEN'];

  it('keeps the named key and turns every other PUSH into a skip', () => {
    const plan = narrowTo(planFor(present, { both: true }), ['HARDCOVER_API_TOKEN']);
    assert.equal(actionFor(plan.main, 'HARDCOVER_API_TOKEN'), PUSH_MAIN);
    assert.equal(actionFor(plan.friend, 'HARDCOVER_API_TOKEN'), PUSH_FRIEND);
    assert.equal(actionFor(plan.main, 'GOOGLE_BOOKS_API_KEY'), SKIP_NOT_SELECTED);
    assert.equal(actionFor(plan.friend, 'PEER_TOKEN'), SKIP_NOT_SELECTED);
  });

  it('⚠️ can NEVER widen — a refusal stays a refusal even when named', () => {
    // The whole safety argument. --enable is the flag that grants; this one only
    // ever declines, so naming a per-instance key cannot smuggle it onto her
    // Worker, and naming an unclassified key cannot classify it.
    const plan = narrowTo(planFor([...present, 'LIBRARYTHING_API_KEY'], { both: true }), [
      'ANTHROPIC_API_KEY',
      'LIBRARYTHING_API_KEY',
      'EBOOK_INGEST_TOKEN',
    ]);
    assert.equal(actionFor(plan.friend, 'ANTHROPIC_API_KEY'), REFUSE_PER_INSTANCE);
    assert.equal(actionFor(plan.friend, 'LIBRARYTHING_API_KEY'), REFUSE_UNCLASSIFIED);
    // …and an opt-in key still needs --enable; --only does not stand in for it.
    assert.equal(actionFor(plan.friend, 'EBOOK_INGEST_TOKEN'), SKIP_OPT_IN);
  });

  it('names a key that is not set locally as unset, not as selected', () => {
    const plan = narrowTo(planFor(['GOOGLE_BOOKS_API_KEY'], { both: true }), ['HARDCOVER_API_TOKEN']);
    assert.equal(actionFor(plan.main, 'HARDCOVER_API_TOKEN'), SKIP_UNSET);
  });

  it('is a no-op with no --only, so every existing path is untouched', () => {
    const plan = planFor(present, { both: true });
    assert.deepEqual(narrowTo(plan, []), plan);
    assert.deepEqual(narrowTo(plan), plan);
  });

  it('never puts a VALUE in a narrowed row either', () => {
    const plan = narrowTo(planFor(present, { both: true }), ['PEER_TOKEN']);
    for (const row of [...plan.main, ...plan.friend]) {
      assert.deepEqual(
        Object.keys(row).filter((k) => !['name', 'action', 'why'].includes(k)),
        [],
      );
    }
  });
});
