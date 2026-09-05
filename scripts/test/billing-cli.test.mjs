/**
 * Guards for the CLI spending gate — L9–L13, billing design §9 Q5.
 *
 * ⚠️ **No test here writes a policy row, and none may.** The rules live in the
 * auth Worker's production `estate_auth` D1; a test that wrote one would be a
 * test that switched a real household's spending off. Every deny in this file
 * is a STUBBED `system_denied` answer handed to the same code the real door
 * feeds, which is the whole reason `fetchSystemDenied` takes a `fetchImpl` and
 * `decideCliBilling` is pure.
 *
 * The five scripts run on import, so — exactly as `backfill-safety.test.mjs`
 * does — the decision lives in `scripts/lib/billing-cli.mjs` and is tested
 * here, and the scripts' own wiring is guarded structurally against their
 * (import-unsafe) sources at the foot of this file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  CLI_BILLING_FEATURES,
  CLI_FEATURE_SETS,
  appTokenVarFor,
  billingPostureFor,
  billingSiteFor,
  checkCliBilling,
  decideCliBilling,
  estateAuthUrlFor,
  fetchSystemDenied,
  policyBanner,
  readIgnorePolicy,
  tomlTableValue,
} from '../lib/billing-cli.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'scripts');

/** A wrangler.toml stand-in, so posture tests do not depend on the real file. */
function toml({ main = 'off', friend = 'off' } = {}) {
  return [
    '[vars]',
    'ESTATE_AUTH_URL = "https://auth.heygabi.ai"',
    'ESTATE_APP = "library"',
    `BILLING_POLICY = "${main}"`,
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    '',
    '[env.friend.vars]',
    'ESTATE_AUTH_URL = "https://auth.heygabi.ai"',
    'ESTATE_APP = "library2"',
    `BILLING_POLICY = "${friend}"`,
    '',
  ].join('\n');
}

/** A `fetch` that answers the system door with a fixed body. */
function stubDoor(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

describe('tomlTableValue — the two instances are told apart by SECTION', () => {
  it('reads the main instance out of [vars]', () => {
    assert.equal(tomlTableValue(toml(), 'vars', 'ESTATE_APP'), 'library');
  });

  it('⚠️ reads padhard out of [env.friend.vars], not the first match in the file', () => {
    assert.equal(tomlTableValue(toml(), 'env.friend.vars', 'ESTATE_APP'), 'library2');
  });

  it('an array-of-tables header does not swallow the keys after it', () => {
    assert.equal(tomlTableValue(toml(), 'env.friend.vars', 'BILLING_POLICY'), 'off');
  });

  it('a key that is not in that table is null, never another table’s value', () => {
    assert.equal(tomlTableValue(toml(), 'vars', 'NOT_A_KEY'), null);
  });

  it('a commented-out line is not a value', () => {
    const text = '[vars]\n# ESTATE_APP = "library9"\nESTATE_APP = "library"\n';
    assert.equal(tomlTableValue(text, 'vars', 'ESTATE_APP'), 'library');
  });
});

describe('the site, the posture and the bearer NAME follow the instance', () => {
  it('a main run spends against library and presents ESTATE_APP_TOKEN_LIBRARY', () => {
    const configText = toml();
    assert.equal(billingSiteFor({ friend: false, configText }), 'library');
    assert.equal(appTokenVarFor({ friend: false, configText }), 'ESTATE_APP_TOKEN_LIBRARY');
  });

  it('⚠️ a --friend run spends against library2 and presents ESTATE_APP_TOKEN_LIBRARY2', () => {
    const configText = toml();
    assert.equal(billingSiteFor({ friend: true, configText }), 'library2');
    assert.equal(appTokenVarFor({ friend: true, configText }), 'ESTATE_APP_TOKEN_LIBRARY2');
  });

  it('the two instances carry SEPARATE postures', () => {
    const configText = toml({ main: 'off', friend: 'shadow' });
    assert.equal(billingPostureFor({ friend: false, configText }), 'off');
    assert.equal(billingPostureFor({ friend: true, configText }), 'shadow');
  });

  it('anything unrecognised falls to off rather than half-enabling a money gate', () => {
    assert.equal(billingPostureFor({ friend: false, configText: toml({ main: 'ON' }) }), 'off');
    assert.equal(billingPostureFor({ friend: false, configText: toml({ main: '' }) }), 'off');
  });

  it('reads the auth URL from the same table', () => {
    assert.equal(estateAuthUrlFor({ friend: true, configText: toml() }), 'https://auth.heygabi.ai');
  });

  it('🔴 the real wrangler.toml still ships BILLING_POLICY = "off" on BOTH instances', () => {
    // The CLI twin of apps/worker/src/lib/billing-gate.test.ts's guard. A flip
    // has to be deliberate on this side too — these scripts read the same var.
    const configText = readFileSync(path.join(ROOT, 'apps/worker/wrangler.toml'), 'utf8');
    assert.equal(billingPostureFor({ friend: false, configText }), 'off');
    assert.equal(billingPostureFor({ friend: true, configText }), 'off');
    assert.equal(billingSiteFor({ friend: false, configText }), 'library');
    assert.equal(billingSiteFor({ friend: true, configText }), 'library2');
  });
});

describe('decideCliBilling — the truth table', () => {
  const features = CLI_FEATURE_SETS.covers;

  it('posture off decides nothing and checks nothing', () => {
    const d = decideCliBilling({
      posture: 'off',
      site: 'library',
      features,
      denied: [CLI_BILLING_FEATURES.covers],
    });
    assert.deepEqual(d, { deniedFeatures: [], blocked: false, overridden: false, checked: false });
  });

  it('a null site behaves as off — failing into today’s behaviour', () => {
    const d = decideCliBilling({
      posture: 'enforce',
      site: null,
      features,
      denied: [CLI_BILLING_FEATURES.backfill],
    });
    assert.equal(d.blocked, false);
    assert.equal(d.checked, false);
  });

  it('🔴 null is UNKNOWN and unknown PROCEEDS', () => {
    const d = decideCliBilling({ posture: 'shadow', site: 'library', features, denied: null });
    assert.deepEqual(d.deniedFeatures, []);
    assert.equal(d.blocked, false);
    assert.equal(d.checked, false, 'unknown must not read as "the directory answered"');
  });

  it('🔴 [] is the OTHER fact — the directory answered and denied nothing', () => {
    const d = decideCliBilling({ posture: 'shadow', site: 'library', features, denied: [] });
    assert.equal(d.blocked, false);
    assert.equal(d.checked, true, '[] and null must never collapse into one another');
  });

  it('a deny on cli.backfill stops the run', () => {
    const d = decideCliBilling({
      posture: 'shadow',
      site: 'library',
      features,
      denied: [CLI_BILLING_FEATURES.backfill],
    });
    assert.deepEqual(d.deniedFeatures, [CLI_BILLING_FEATURES.backfill]);
    assert.equal(d.blocked, true);
  });

  it('⚠️ the DOUBLE COVER: research.covers alone also stops the cover backfill', () => {
    // §3.2 puts L9 under both switches and §11.2 departure 4 keeps it that way:
    // a path under two switches is refused if EITHER denies.
    const d = decideCliBilling({
      posture: 'shadow',
      site: 'library',
      features: CLI_FEATURE_SETS.covers,
      denied: [CLI_BILLING_FEATURES.covers],
    });
    assert.deepEqual(d.deniedFeatures, [CLI_BILLING_FEATURES.covers]);
    assert.equal(d.blocked, true);
  });

  it('⚠️ the DOUBLE COVER: research.isbn alone also stops the ISBN backfill', () => {
    const d = decideCliBilling({
      posture: 'shadow',
      site: 'library',
      features: CLI_FEATURE_SETS.isbns,
      denied: [CLI_BILLING_FEATURES.isbn],
    });
    assert.deepEqual(d.deniedFeatures, [CLI_BILLING_FEATURES.isbn]);
    assert.equal(d.blocked, true);
  });

  it('research.isbn does NOT stop the cover backfill — the sets do not bleed', () => {
    const d = decideCliBilling({
      posture: 'shadow',
      site: 'library',
      features: CLI_FEATURE_SETS.covers,
      denied: [CLI_BILLING_FEATURES.isbn],
    });
    assert.equal(d.blocked, false);
    assert.equal(d.checked, true);
  });

  it('both switches denying is reported as both, not as one', () => {
    const d = decideCliBilling({
      posture: 'shadow',
      site: 'library',
      features: CLI_FEATURE_SETS.covers,
      denied: [CLI_BILLING_FEATURES.covers, CLI_BILLING_FEATURES.backfill, 'gabi.chat'],
    });
    assert.deepEqual(d.deniedFeatures, [CLI_BILLING_FEATURES.backfill, CLI_BILLING_FEATURES.covers]);
  });

  it('🔴 --ignore-policy ALWAYS goes through — never a hard refusal, even on enforce', () => {
    const d = decideCliBilling({
      posture: 'enforce',
      site: 'library',
      features,
      denied: [CLI_BILLING_FEATURES.backfill],
      ignorePolicy: true,
    });
    assert.equal(d.blocked, false);
    assert.equal(d.overridden, true);
    assert.deepEqual(d.deniedFeatures, [CLI_BILLING_FEATURES.backfill]);
  });

  it('--ignore-policy on a run nothing denies is not an override', () => {
    const d = decideCliBilling({
      posture: 'shadow',
      site: 'library',
      features,
      denied: [],
      ignorePolicy: true,
    });
    assert.equal(d.overridden, false);
    assert.equal(d.blocked, false);
  });
});

describe('readIgnorePolicy — the long spelling, and only the long spelling', () => {
  it('finds the flag', () => {
    assert.equal(readIgnorePolicy(['--remote', '--ignore-policy']), true);
  });
  it('is absent by default', () => {
    assert.equal(readIgnorePolicy(['--remote', '--llm']), false);
  });
  it('⚠️ no short form and no near-miss — a bill-changing flag is never guessed', () => {
    assert.equal(readIgnorePolicy(['--ignore']), false);
    assert.equal(readIgnorePolicy(['--ignore-policy=1']), false);
    assert.equal(readIgnorePolicy(['-i']), false);
  });
});

describe('policyBanner — what happened, what it needs, how to get past it', () => {
  const banner = policyBanner({
    label: 'Paid cover search',
    site: 'library',
    deniedFeatures: ['cli.backfill', 'research.covers'],
  });

  it('names the thing, the site and the hatch — the design’s own wording', () => {
    assert.match(banner, /switched off for library/);
    assert.match(banner, /re-run with --ignore-policy/);
  });

  it('says nothing was spent, so a stopped run is not mistaken for a failed one', () => {
    assert.match(banner, /Nothing was asked and nothing was spent/);
  });

  it('names both denying switches, and says where to turn it back on', () => {
    assert.match(banner, /cli\.backfill, research\.covers/);
    assert.match(banner, /heygabi\.ai\/admin\//);
    assert.match(banner, /within 10 minutes/);
  });

  it('the override banner says OVERRIDE ACTIVE and that it is spending anyway', () => {
    const over = policyBanner({
      label: 'Paid cover search',
      site: 'library2',
      deniedFeatures: ['cli.backfill'],
      overridden: true,
    });
    assert.match(over, /OVERRIDE ACTIVE — --ignore-policy/);
    assert.match(over, /spending anyway/);
    assert.match(over, /library2/);
  });
});

/**
 * A stand-in for the bearer read.
 *
 * ⚠️ Every test injects one. Reading the real `apps/worker/.dev.vars` would
 * make these tests pass or fail on whether the owner happened to have
 * regenerated that file — and an agent may not open it at all.
 */
function tokens(map) {
  return (name) => map[name] ?? '';
}
const NO_TOKENS = tokens({});

describe('fetchSystemDenied — the door, stubbed', () => {
  it('reads system_denied off a 200', async () => {
    const impl = stubDoor({ site: 'library', system_denied: ['cli.backfill'], cache_seconds: 600 });
    const { denied, why } = await fetchSystemDenied({
      friend: false,
      fetchImpl: impl,
      configText: toml(),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(why, null);
    assert.deepEqual(denied, ['cli.backfill']);
    assert.equal(impl.calls.length, 1);
    assert.equal(
      impl.calls[0].url,
      'https://auth.heygabi.ai/api/estate/billing/policy',
    );
    assert.equal(impl.calls[0].init.headers.Authorization, 'Bearer stub');
  });

  it('⚠️ no bearer is UNKNOWN and says which NAME is missing — never "nothing is denied"', async () => {
    const impl = stubDoor({ site: 'library', system_denied: [] });
    const { denied, why } = await fetchSystemDenied({
      friend: false,
      fetchImpl: impl,
      configText: toml(),
      tokenReader: NO_TOKENS,
    });
    assert.equal(denied, null);
    assert.match(why, /ESTATE_APP_TOKEN_LIBRARY/);
    assert.equal(impl.calls.length, 0, 'no call is made without a bearer');
  });

  it('a non-2xx is UNKNOWN, not empty', async () => {
    const impl = stubDoor({ error: 'unauthorized' }, { status: 401 });
    const { denied, why } = await fetchSystemDenied({
      friend: false,
      fetchImpl: impl,
      configText: toml(),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(denied, null);
    assert.match(why, /401/);
  });

  it('⚠️ a non-array system_denied is UNKNOWN — a string is not a one-element deny-list', async () => {
    const impl = stubDoor({ site: 'library', system_denied: 'cli.backfill' });
    const { denied } = await fetchSystemDenied({
      friend: false,
      fetchImpl: impl,
      configText: toml(),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(denied, null);
  });

  it('non-string entries are dropped rather than voiding the list', async () => {
    // Voiding on one bad entry fails in the ALLOWING direction — wrong way
    // round for a deny-list. Mirrors the Worker gate's own parser.
    const impl = stubDoor({ site: 'library', system_denied: ['cli.backfill', 7, '', null] });
    const { denied } = await fetchSystemDenied({
      friend: false,
      fetchImpl: impl,
      configText: toml(),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.deepEqual(denied, ['cli.backfill']);
  });

  it('a throwing fetch is UNKNOWN, never an exception into the run', async () => {
    const impl = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const { denied, why } = await fetchSystemDenied({
      friend: false,
      fetchImpl: impl,
      configText: toml(),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(denied, null);
    assert.match(why, /ENOTFOUND/);
  });

  it('⚠️ the --friend run presents the FRIEND bearer, and a main-only token does not answer for her', async () => {
    const impl = stubDoor({ site: 'library2', system_denied: [] });
    const { denied, why } = await fetchSystemDenied({
      friend: true,
      fetchImpl: impl,
      configText: toml(),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'his' }),
    });
    assert.equal(denied, null, 'his token must never be presented as hers');
    assert.match(why, /ESTATE_APP_TOKEN_LIBRARY2/);
    assert.equal(impl.calls.length, 0);
  });
});

describe('checkCliBilling — end to end, with a stubbed door', () => {
  it('🔴 posture off makes NO network call and prints NOTHING', async () => {
    const impl = stubDoor({ site: 'library', system_denied: ['cli.backfill'] });
    const lines = [];
    const r = await checkCliBilling({
      friend: false,
      features: CLI_FEATURE_SETS.covers,
      label: 'Paid cover search',
      argv: [],
      fetchImpl: impl,
      log: (s) => lines.push(s),
      configText: toml({ main: 'off' }),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(r.blocked, false);
    assert.equal(impl.calls.length, 0, 'off must not even ask — that is what "unchanged" means');
    assert.deepEqual(lines, []);
  });

  it('shadow + a deny stops the run and prints the banner', async () => {
    const impl = stubDoor({ site: 'library', system_denied: ['research.covers'] });
    const lines = [];
    const r = await checkCliBilling({
      friend: false,
      features: CLI_FEATURE_SETS.covers,
      label: 'Paid cover search',
      argv: ['--remote', '--llm', '--commit'],
      fetchImpl: impl,
      log: (s) => lines.push(s),
      configText: toml({ main: 'shadow' }),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(r.blocked, true);
    assert.equal(impl.calls.length, 1);
    assert.match(impl.calls[0].url, /\/api\/estate\/billing\/policy$/);
    assert.match(lines.join('\n'), /re-run with --ignore-policy/);
  });

  it('shadow + a deny + --ignore-policy proceeds, loudly', async () => {
    const impl = stubDoor({ site: 'library', system_denied: ['cli.backfill'] });
    const lines = [];
    const r = await checkCliBilling({
      friend: false,
      features: CLI_FEATURE_SETS.probeUniverses,
      label: 'Command-line backfills',
      argv: ['--ignore-policy'],
      fetchImpl: impl,
      log: (s) => lines.push(s),
      configText: toml({ main: 'enforce' }),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(r.blocked, false);
    assert.equal(r.overridden, true);
    assert.match(lines.join('\n'), /OVERRIDE ACTIVE/);
  });

  it('shadow + an unreachable directory proceeds and SAYS the policy is unknown', async () => {
    const impl = async () => {
      throw new Error('boom');
    };
    const lines = [];
    const r = await checkCliBilling({
      friend: false,
      features: CLI_FEATURE_SETS.researchQueue,
      label: 'Details research run',
      argv: [],
      fetchImpl: impl,
      log: (s) => lines.push(s),
      configText: toml({ main: 'shadow' }),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY: 'stub' }),
    });
    assert.equal(r.blocked, false);
    assert.match(lines.join('\n'), /UNKNOWN/);
  });

  it('⚠️ padhard is asked about library2, not library', async () => {
    const impl = stubDoor({ site: 'library2', system_denied: ['cli.backfill'] });
    const lines = [];
    const r = await checkCliBilling({
      friend: true,
      features: CLI_FEATURE_SETS.isbns,
      label: 'ISBN backfill (LLM rung)',
      argv: ['--remote', '--friend', '--llm'],
      fetchImpl: impl,
      log: (s) => lines.push(s),
      configText: toml({ friend: 'shadow' }),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY2: 'hers' }),
    });
    assert.equal(r.site, 'library2');
    assert.equal(r.blocked, true);
    assert.match(lines.join('\n'), /switched off for library2/);
    assert.equal(impl.calls[0].init.headers.Authorization, 'Bearer hers');
  });

  it('⚠️ the main instance being flipped does not gate a --friend run, or vice versa', async () => {
    // TWO switches, one per site (§4.2, and the deploy pair rule). A run must
    // read the posture of the instance it is actually aimed at.
    const impl = stubDoor({ site: 'library2', system_denied: ['cli.backfill'] });
    const r = await checkCliBilling({
      friend: true,
      features: CLI_FEATURE_SETS.auditUniverses,
      label: 'Command-line backfills',
      argv: [],
      fetchImpl: impl,
      log: () => {},
      configText: toml({ main: 'enforce', friend: 'off' }),
      tokenReader: tokens({ ESTATE_APP_TOKEN_LIBRARY2: 'hers' }),
    });
    assert.equal(r.posture, 'off');
    assert.equal(r.blocked, false);
    assert.equal(impl.calls.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * The wiring — guarded against the sources, because the scripts run on import
 * ------------------------------------------------------------------ */

describe('all five CLI money paths are wired to the ONE helper', () => {
  const wiring = [
    ['backfill-missing-covers.mjs', 'CLI_FEATURE_SETS.covers'],
    ['backfill-missing-isbns.mjs', 'CLI_FEATURE_SETS.isbns'],
    ['research-queue.mjs', 'CLI_FEATURE_SETS.researchQueue'],
    ['audit-universes.mjs', 'CLI_FEATURE_SETS.auditUniverses'],
    ['probe-universes.mjs', 'CLI_FEATURE_SETS.probeUniverses'],
  ];

  for (const [file, featureSet] of wiring) {
    it(`${file} imports the helper and checks ${featureSet}`, () => {
      // ⚠️ `includes`, never `assert.match`, on an 800-line source: a failing
      // regex assertion prints the WHOLE file into the test output, which
      // buries every other failure in the run.
      const src = readFileSync(path.join(SCRIPTS, file), 'utf8');
      assert.ok(
        src.includes("from './lib/billing-cli.mjs'"),
        `${file} must import the ONE helper — a second copy of the gate is exactly what this test exists to prevent`,
      );
      assert.ok(src.includes('await checkCliBilling('), `${file} must call checkCliBilling()`);
      assert.ok(src.includes(featureSet), `${file} must check ${featureSet}`);
      assert.ok(src.includes('--ignore-policy'), `${file} must name the escape hatch in its header`);
    });
  }

  it('⚠️ no script re-implements the door or the deny check', () => {
    for (const [file] of wiring) {
      const src = readFileSync(path.join(SCRIPTS, file), 'utf8');
      assert.ok(
        !src.includes('/api/estate/billing/policy'),
        `${file} must go through scripts/lib/billing-cli.mjs, never call the door itself`,
      );
    }
  });
});
