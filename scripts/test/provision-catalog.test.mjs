/**
 * The provisioner's two decisions, exercised with no wrangler, no network and no
 * Cloudflare account: **what the new instance is CALLED** and **what its
 * `[env.<name>]` block SAYS**. Everything else in
 * `scripts/provision-catalog.mjs` is plumbing around those two.
 *
 * ⚠️ The load-bearing case is the DRIFT test at the bottom. Wrangler
 * environments inherit NOTHING (design §7.1), so a var added to `[env.friend]`
 * and forgotten in the generator is not a lint failure — it is a third instance
 * that silently ships without it, exactly the class of bug the F-5 hard-coded
 * identity was. That test reads the REAL `apps/worker/wrangler.toml` and fails
 * the build when the two blocks disagree about which keys exist.
 *
 * ⚠️ Nothing here touches `.dev.vars`, mints anything, or spawns wrangler.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { resolvePlatformRepo } from '../lib/platform-repo.mjs';

import {
  APEX,
  INSTANCE_MAX,
  ROOT,
  RESERVED_INSTANCE_NAMES,
  assertProvisionable,
  checkAuthWorkerRegistration,
  deriveNames,
  existingVar,
  extractJsonArray,
  insertScripts,
  loadSealLib,
  markLiveUpdate,
  manualRunbook,
  nextEstateApp,
  ordinalWord,
  parseDatabaseId,
  parseEnvNames,
  parseEstateApps,
  registryInsertSql,
  renderEnvBlock,
  runbookSection,
  rootScriptTwins,
  sanitiseInstanceName,
  secretPlan,
  sqlLit,
  tomlString,
  workerScriptTwins,
} from '../provision-catalog.mjs';

/** `assert.throws` returns undefined, so the error itself is caught by hand. */
function caught(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected a throw, and nothing was thrown');
}

/** A row shaped exactly like migration 0018's `catalog_request`. */
const ROW = {
  id: 4,
  kind: 'books',
  requester_email: 'amber@example.com',
  requester_display_name: 'Amber',
  desired_subdomain: 'amber',
  display_name: "Amber's Library",
  status: 'accepted',
  provisioned_instance: null,
  provisioned_host: null,
  reader_key_set: 0,
  owner_key_set: 0,
  created_at: '2026-09-05 14:00:00',
};

const EXISTING_ENVS = ['friend'];
const EXISTING_APPS = ['library', 'library2'];

describe('sanitiseInstanceName — the subdomain becomes a wrangler env name', () => {
  it('a clean subdomain passes through untouched', () => {
    assert.deepEqual(sanitiseInstanceName('amber', { existingEnvs: EXISTING_ENVS }), {
      name: 'amber',
      changed: false,
    });
  });

  it('lowercases, and every run of anything else becomes ONE hyphen', () => {
    // The route's own shape check (design §3.3) would never let these through;
    // this script does not trust a value it did not validate itself.
    assert.equal(sanitiseInstanceName('Amber_Reads.Books').name, 'amber-reads-books');
    assert.equal(sanitiseInstanceName('a  b').name, 'a-b');
    assert.equal(sanitiseInstanceName('--edge--').name, 'edge');
  });

  it('reports that it changed the name, so the run can SAY so', () => {
    assert.equal(sanitiseInstanceName('Amber').changed, true);
  });

  it('a digit may start it — TOML bare keys and Worker names both allow one', () => {
    assert.equal(sanitiseInstanceName('3rdshelf').name, '3rdshelf');
  });

  it('⚠️ refuses a name with nothing left in it, rather than inventing one', () => {
    assert.throws(() => sanitiseInstanceName('---'), /no letters or digits/);
    assert.throws(() => sanitiseInstanceName(''), /no desired_subdomain/);
    assert.throws(() => sanitiseInstanceName(null), /no desired_subdomain/);
  });

  it(`⚠️ refuses over ${INSTANCE_MAX} chars — the Worker is library-catalog-<instance>, capped at 63`, () => {
    assert.throws(() => sanitiseInstanceName('a'.repeat(INSTANCE_MAX + 1)), /capped at 30/);
    assert.equal(sanitiseInstanceName('a'.repeat(INSTANCE_MAX)).name, 'a'.repeat(INSTANCE_MAX));
  });

  it('⚠️ refuses a reserved wrangler word — [env.production] means something else', () => {
    for (const word of RESERVED_INSTANCE_NAMES) {
      assert.throws(() => sanitiseInstanceName(word), /reserved wrangler environment name/, word);
    }
  });

  it('🔴 refuses an env that already exists — deploying over padhard is the failure', () => {
    assert.throws(
      () => sanitiseInstanceName('friend', { existingEnvs: EXISTING_ENVS }),
      /reserved wrangler environment name|already exists/,
    );
    assert.throws(
      () => sanitiseInstanceName('amber', { existingEnvs: ['amber'] }),
      /\[env\.amber\] already exists/,
    );
  });

  it('every refusal says what to do next — never a bare "invalid"', () => {
    for (const bad of ['---', 'production', 'a'.repeat(99)]) {
      assert.throws(() => sanitiseInstanceName(bad), /--instance/, bad);
    }
  });
});

describe('the ordinal, and the estate app id behind it', () => {
  it('3rd / 4th / 11th / 21st / 22nd', () => {
    assert.deepEqual([3, 4, 11, 12, 13, 21, 22, 23].map(ordinalWord), [
      '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd',
    ]);
  });

  it('library + library2 taken → library3, and N = 3 names the D1 and the bucket', () => {
    assert.deepEqual(nextEstateApp(EXISTING_APPS), { app: 'library3', n: 3 });
    assert.deepEqual(nextEstateApp(['library', 'library2', 'library3']), { app: 'library4', n: 4 });
  });

  it('⚠️ `library` is instance 1 and carries no digit — the estate convention', () => {
    assert.equal(nextEstateApp(['library']).app, 'library2');
  });
});

describe('deriveNames — every name, from the row alone', () => {
  const names = deriveNames(ROW, { envNames: EXISTING_ENVS, estateApps: EXISTING_APPS });

  it('the hostname is the ONLY identity-bearing name', () => {
    assert.equal(names.host, `amber.${APEX}`);
    assert.equal(names.siteOrigin, 'https://amber.heygabi.ai');
  });

  it('the D1 and the bucket are ORDINAL, because neither can ever be renamed', () => {
    assert.equal(names.d1Name, 'library-catalog-3rd');
    assert.equal(names.bucketName, 'library-3rd-covers');
  });

  it('the estate app id, its token NAME and its column all come off one number', () => {
    assert.equal(names.estateApp, 'library3');
    assert.equal(names.tokenName, 'ESTATE_APP_TOKEN_LIBRARY3');
    assert.equal(names.visColumn, 'vis_library3');
  });

  it('the env name follows the subdomain; the Worker follows the env name', () => {
    assert.equal(names.instance, 'amber');
    assert.equal(names.workerName, 'library-catalog-amber');
  });

  it('--instance overrides the env name and NOTHING else', () => {
    const third = deriveNames(ROW, {
      envNames: EXISTING_ENVS,
      estateApps: EXISTING_APPS,
      instance: 'third',
    });
    assert.equal(third.instance, 'third');
    assert.equal(third.workerName, 'library-catalog-third');
    assert.equal(third.host, names.host);
    assert.equal(third.estateApp, names.estateApp);
    assert.equal(third.d1Name, names.d1Name);
  });

  it('🔴 forceEstateApp pins the id on a --resume, instead of advancing it', () => {
    // Without this a resumed run reads its OWN ESTATE_APP = "library3" out of the
    // toml, decides the next free id is library4, and mints a bearer under a name
    // the first half of the run never used.
    const resumed = deriveNames(ROW, {
      envNames: [],
      estateApps: ['library', 'library2', 'library3'],
      forceEstateApp: 'library3',
    });
    assert.equal(resumed.estateApp, 'library3');
    assert.equal(resumed.tokenName, 'ESTATE_APP_TOKEN_LIBRARY3');
    assert.equal(resumed.d1Name, 'library-catalog-3rd');
  });

  it('the email is lowercased — it is the estate join key', () => {
    const shouty = deriveNames({ ...ROW, requester_email: 'Amber@Example.COM' }, {
      envNames: EXISTING_ENVS,
      estateApps: EXISTING_APPS,
    });
    assert.equal(shouty.requesterEmail, 'amber@example.com');
  });
});

describe('assertProvisionable — what this script refuses to touch', () => {
  it('an accepted books request passes', () => {
    assert.equal(assertProvisionable(ROW), ROW);
  });

  it('🔴 a games request is refused with exit code 2 and points at design §8', () => {
    const err = caught(() => assertProvisionable({ ...ROW, kind: 'games' }));
    assert.equal(err.code, 2);
    assert.match(err.message, /§8/);
    assert.match(err.message, /hard-coded/);
    // The refusal must say what it needs and how to get it, never just "no".
    assert.match(err.message, /Accepting a games request is fine/);
  });

  it('a pending request is refused, and says where to accept it', () => {
    const err = caught(() => assertProvisionable({ ...ROW, status: 'pending' }));
    assert.equal(err.code, 2);
    assert.match(err.message, /heygabi\.ai\/admin/);
  });

  it('a request already live says so and does not offer to do it again', () => {
    const err = caught(() =>
      assertProvisionable({ ...ROW, status: 'live', provisioned_host: 'amber.heygabi.ai' }),
    );
    assert.match(err.message, /already live at https:\/\/amber\.heygabi\.ai/);
  });

  it('a declined or cancelled row is not re-provisioned', () => {
    for (const status of ['declined', 'cancelled']) {
      assert.throws(() => assertProvisionable({ ...ROW, status }), /new one/, status);
    }
  });

  it('a kind outside the closed vocabulary is data corruption, and says so', () => {
    assert.throws(() => assertProvisionable({ ...ROW, kind: 'films' }), /data corruption/);
  });

  it('no row at all is a plain exit 1, not a crash', () => {
    assert.equal(caught(() => assertProvisionable(undefined)).code, 1);
  });
});

describe('renderEnvBlock — the [env.<i>] block', () => {
  const names = deriveNames(ROW, { envNames: EXISTING_ENVS, estateApps: EXISTING_APPS });
  const block = renderEnvBlock(names, {
    coversBaseUrl: 'https://pub-abc.r2.dev',
    databaseId: '11111111-2222-3333-4444-555555555555',
    ownerEmails: 'amber@example.com',
  });

  it('declares every table wrangler needs, because nothing is inherited', () => {
    for (const table of [
      '[env.amber]',
      '[env.amber.assets]',
      '[[env.amber.d1_databases]]',
      '[[env.amber.r2_buckets]]',
      '[env.amber.triggers]',
      '[[env.amber.routes]]',
      '[env.amber.vars]',
    ]) {
      assert.ok(block.includes(table), `missing ${table}`);
    }
  });

  it('⚠️ the D1 binding stays DB, NOT the name wrangler suggests', () => {
    assert.match(block, /\[\[env\.amber\.d1_databases\]\]\n(#[^\n]*\n)*binding = "DB"/);
    assert.match(block, /database_name = "library-catalog-3rd"/);
    assert.match(block, /database_id = "11111111-2222-3333-4444-555555555555"/);
    assert.match(block, /migrations_dir = "\.\.\/\.\.\/migrations"/);
  });

  it('the route is a custom domain, so DNS and the certificate live in git', () => {
    assert.match(block, /pattern = "amber\.heygabi\.ai"\ncustom_domain = true/);
  });

  it('⚠️ BOTH cron STRINGS are byte-identical to the other instances', () => {
    // scheduled() dispatches on DETAILS_SWEEP_CRON and AUDIOBOOK_SWEEP_CRON;
    // "roughly the same" is a sweep that never runs. ⚠️ The second string
    // joined 2026-09-05: a new instance given the audiobook MODE without the
    // audiobook TRIGGER would sit in shadow and never tick, which from the
    // outside reads exactly like a sweep that is working and finding nothing.
    assert.match(block, /crons = \["7 \* \* \* \*", "23 \*\/4 \* \* \*"\]/);
  });

  it('the audiobook sweep ships SHADOW on a new instance, never enforce', () => {
    // A brand-new catalog nobody has looked at is the worst possible place to
    // start ENFORCING a sweep whose stale phase marks rows across the whole
    // catalogue.
    assert.match(block, /AUDIOBOOK_SWEEP_MODE = "shadow"/);
  });

  it('OWNER_EMAILS is the REQUESTER — they cannot be locked out of their own shelf', () => {
    assert.match(block, /OWNER_EMAILS = "amber@example\.com"/);
  });

  it('🔴 PEERS is empty — peering is access-INCREASING and is never a default', () => {
    assert.match(block, /PEERS = "\[\]"/);
    assert.match(block, /access-INCREASING/);
  });

  it('GABI ships OFF, because she spends the key', () => {
    assert.match(block, /GABI_PANEL = "off"/);
  });

  it('the estate identity is this instance\'s own', () => {
    assert.match(block, /ESTATE_APP = "library3"/);
    assert.match(block, /ESTATE_CHECK = "enforce"/);
    assert.match(block, /ESTATE_AUTH_URL = "https:\/\/auth\.heygabi\.ai"/);
  });

  it('the shared Firebase project, never a second one', () => {
    assert.match(block, /FIREBASE_PROJECT_ID = "audiobook-catalog"/);
  });

  it('BILLING_POLICY ships "off", like both existing instances', () => {
    assert.match(block, /BILLING_POLICY = "off"/);
  });

  it('🔴 no secret NAME is ever given a value here — secrets are not vars', () => {
    for (const secret of [
      'ANTHROPIC_API_KEY',
      'GOOGLE_BOOKS_API_KEY',
      'HARDCOVER_API_TOKEN',
      'DONOR_TOKEN',
      'PEER_TOKEN',
      'INDEX_READ_TOKEN',
      'INDEX_PUSH_TOKEN',
    ]) {
      assert.ok(
        !new RegExp(`^${secret}\\s*=`, 'm').test(block),
        `${secret} must never be assigned in wrangler.toml — it is a secret`,
      );
    }
    // The estate bearer's NAME may be mentioned in a comment; it must not be assigned.
    assert.ok(!/^ESTATE_APP_TOKEN_\w+\s*=/m.test(block));
  });

  it('a quote or a backslash in a display name cannot break the TOML', () => {
    const odd = renderEnvBlock(
      deriveNames({ ...ROW, display_name: 'A "quoted" \\ name' }, {
        envNames: EXISTING_ENVS,
        estateApps: EXISTING_APPS,
      }),
      { coversBaseUrl: 'https://x', databaseId: 'id', ownerEmails: 'a@b.c' },
    );
    assert.match(odd, /PEER_SELF_LABEL = "A \\"quoted\\" \\\\ name"/);
  });

  it('tomlString escapes both, and nothing else', () => {
    assert.equal(tomlString('plain'), '"plain"');
    assert.equal(tomlString('a"b'), '"a\\"b"');
    assert.equal(tomlString('a\\b'), '"a\\\\b"');
  });
});

describe('🔴 DRIFT: the generated block covers every var [env.friend] carries', () => {
  // Wrangler inherits nothing. A var added to the friend block and forgotten
  // here is a third instance that silently ships without it — so this reads the
  // real file rather than a fixture, and fails the build when they disagree.
  const toml = readFileSync(join(ROOT, 'apps', 'worker', 'wrangler.toml'), 'utf8');

  /**
   * The bare keys of one `[env.<i>.vars]` section, in file order.
   *
   * ⚠️ The section is found with a LINE-ANCHORED regex, not `indexOf`. The
   * string `[env.friend.vars]` also appears inside a comment in the top-level
   * `[vars]` block, ~3,000 characters earlier — an `indexOf` lands there and
   * reads the MAIN instance's vars while claiming to read the friend's. That is
   * the first thing this test caught, and it caught it in itself.
   */
  function varKeys(text, instance) {
    const header = new RegExp(`^\\[env\\.${instance}\\.vars\\]\\s*$`, 'm');
    const start = text.search(header);
    assert.notEqual(start, -1, `no [env.${instance}.vars] section`);
    const rest = text.slice(start + `[env.${instance}.vars]`.length);
    const end = rest.search(/^\s*\[{1,2}[A-Za-z]/m);
    const section = end === -1 ? rest : rest.slice(0, end);
    return [...section.matchAll(/^([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]);
  }

  const friendKeys = varKeys(toml, 'friend');
  const generated = renderEnvBlock(
    deriveNames(ROW, { envNames: parseEnvNames(toml), estateApps: parseEstateApps(toml) }),
    { coversBaseUrl: 'https://pub-abc.r2.dev', databaseId: 'id', ownerEmails: 'a@b.c' },
  );
  const generatedKeys = varKeys(generated, 'amber');

  it('reads a real friend block with a real set of vars (the fixture is the repo)', () => {
    assert.ok(friendKeys.length >= 15, `only ${friendKeys.length} vars found — did the parse break?`);
    assert.ok(friendKeys.includes('ESTATE_APP'));
  });

  it('every [env.friend.vars] key is present in the generated block', () => {
    const missing = friendKeys.filter((k) => !generatedKeys.includes(k));
    assert.deepEqual(
      missing,
      [],
      `renderEnvBlock() is missing ${missing.join(', ')} — wrangler inherits NOTHING, so a ` +
        'var that is not restated is simply absent on the new Worker.',
    );
  });

  it('and the generated block adds nothing the friend block does not have', () => {
    // Not a style rule: an extra var here is one nobody has decided the value of
    // for a stranger's catalog.
    const extra = generatedKeys.filter((k) => !friendKeys.includes(k));
    assert.deepEqual(extra, []);
  });

  it('the real file has exactly the two instances this repo documents', () => {
    assert.deepEqual(parseEnvNames(toml), ['friend']);
    assert.deepEqual(parseEstateApps(toml), ['library', 'library2']);
  });
});

describe('the package.json twins', () => {
  it('the root triple mirrors the :friend one, guard for guard', () => {
    const t = rootScriptTwins('amber');
    assert.match(t['predeploy:amber'], /check-clean\.mjs/);
    assert.match(t['predeploy:amber'], /deploy-guard\.mjs --instance=amber/);
    assert.match(t['predeploy:amber'], /npm run test/);
    assert.equal(t['deploy:amber'], 'npm run build && npm run deploy:amber --workspace @lc/worker');
    assert.equal(t['postdeploy:amber'], 'node scripts/deploy-done.mjs --instance=amber');
  });

  it('the worker twins carry --env and the instance\'s OWN database name', () => {
    const t = workerScriptTwins('amber', 'library-catalog-3rd');
    assert.equal(t['deploy:amber'], 'wrangler deploy --env amber');
    assert.equal(
      t['db:migrate:amber'],
      'wrangler d1 migrations apply library-catalog-3rd --remote --env amber',
    );
    assert.equal(t['tail:amber'], 'wrangler tail --env amber');
  });

  it('the real repo scripts match what the twins are modelled on', () => {
    const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const worker = JSON.parse(readFileSync(join(ROOT, 'apps', 'worker', 'package.json'), 'utf8'));
    assert.equal(
      root.scripts['predeploy:friend'],
      'node scripts/check-clean.mjs && node scripts/deploy-guard.mjs --instance=friend && npm run test',
    );
    assert.equal(worker.scripts['deploy:friend'], 'wrangler deploy --env friend');
  });

  it('insertScripts puts the twins beside their anchor and adds nothing twice', () => {
    const before = { a: '1', 'postdeploy:friend': '2', z: '3' };
    const { scripts, added } = insertScripts(before, { 'deploy:amber': 'x' }, 'postdeploy:friend');
    assert.deepEqual(Object.keys(scripts), ['a', 'postdeploy:friend', 'deploy:amber', 'z']);
    assert.deepEqual(added, ['deploy:amber']);

    const again = insertScripts(scripts, { 'deploy:amber': 'x' }, 'postdeploy:friend');
    assert.deepEqual(again.added, []);
    assert.deepEqual(Object.keys(again.scripts), Object.keys(scripts));
  });

  it('a missing anchor appends rather than losing the twin', () => {
    const { scripts } = insertScripts({ a: '1' }, { b: '2' }, 'nope');
    assert.deepEqual(Object.keys(scripts), ['a', 'b']);
  });
});

describe('secretPlan — push-secrets\' classification, imported not restated', () => {
  it('the shared-always set is pushed', () => {
    const { push } = secretPlan();
    assert.deepEqual(push.sort(), [
      'DONOR_TOKEN', 'GOOGLE_BOOKS_API_KEY', 'HARDCOVER_API_TOKEN', 'PEER_TOKEN',
    ]);
  });

  it('🔴 a route-ENABLING key is skipped until --enable names it', () => {
    const off = secretPlan();
    assert.ok(!off.push.includes('EBOOK_INGEST_TOKEN'));
    assert.ok(off.lines.some((l) => /skip \(opt-in\)\s+EBOOK_INGEST_TOKEN/.test(l)));

    const on = secretPlan(['EBOOK_INGEST_TOKEN']);
    assert.ok(on.push.includes('EBOOK_INGEST_TOKEN'));
    assert.ok(on.lines.some((l) => /ENABLES that machine route/.test(l)));
  });

  it('⚠️ per-instance keys are refused WITH the sentence a bulk push prints', () => {
    const { push, lines } = secretPlan();
    for (const name of ['INDEX_PUSH_TOKEN', 'INDEX_READ_TOKEN']) {
      assert.ok(!push.includes(name));
      assert.ok(lines.some((l) => l.includes(name) && l.includes('refuse (per-instance)')));
    }
    assert.ok(lines.some((l) => /per-instance: the index resolves the CALLING APP/.test(l)));
  });

  it('ANTHROPIC_API_KEY is SPECIAL and names the standing decision', () => {
    const { push, lines } = secretPlan();
    assert.ok(!push.includes('ANTHROPIC_API_KEY'), 'it is set on its own, not in the bulk payload');
    assert.ok(lines.some((l) => /2026-09-05/.test(l)));
    assert.ok(lines.some((l) => /never printed/.test(l)));
  });

  it('🔴 the guard fires if a per-instance key is ever added to the push set', () => {
    // The mechanical half of design §6.4's "must not be weakened".
    assert.throws(
      () => secretPlan([], { always: ['ANTHROPIC_API_KEY'], optIn: [] }),
      /would push per-instance secrets \(ANTHROPIC_API_KEY\)/,
    );
    assert.throws(
      () => secretPlan([], { always: ['ESTATE_APP_TOKEN_LIBRARY'], optIn: [] }),
      /do not weaken it/,
    );
  });
});

describe('the manual runbook', () => {
  const names = deriveNames(ROW, { envNames: EXISTING_ENVS, estateApps: EXISTING_APPS });
  const text = manualRunbook(names, { platformDir: '/repos/catalog-platform' }).join('\n');

  it('both pauses are there, numbered, with exact paths', () => {
    assert.match(text, /PAUSE #1 — Firebase authorised domain/);
    assert.match(text, /PAUSE #2 — auth-worker consumer registration/);
    assert.match(text, /\/repos\/catalog-platform\/apps\/auth-worker\/src\/env\.ts:4/);
  });

  it('the diff shape is copy-pasteable, not described', () => {
    assert.match(text, /\+export const CONSUMER_APPS = \[.*'library3'\] as const;/);
    assert.match(text, /\+    case 'library3':/);
    assert.match(text, /\+      return env\.ESTATE_APP_TOKEN_LIBRARY3;/);
    assert.match(text, /ALTER TABLE estate_user ADD COLUMN vis_library3 INTEGER NOT NULL DEFAULT 0;/);
  });

  it('⚠️ it says DEFAULT 0 is deliberate, and warns about migration number drift', () => {
    assert.match(text, /DEFAULT 0, the/);
    assert.match(text, /next free number first/);
  });

  it('it names the follow-ups this script deliberately does not take', () => {
    assert.match(text, /PEERS is "\[\]"/);
    assert.match(text, /spends the OWNER'S/);
    assert.match(text, /sealed Claude key/);
  });

  it('never a second Firebase project', () => {
    assert.match(text, /Do NOT create a second Firebase project/);
  });

  /* ────────────────────────────────────────────────────────────────────────
   * ⚠️ THE COMPLETENESS TESTS — survey §7, added 2026-09-06.
   *
   * These are not "does the string appear" pedantry. §7 measured that a
   * `library3` needs ~28 hand-edits and that this runbook named 3, and the
   * cost of each MISSING line is a specific, known failure: a bare 500, a
   * shelf enumerable by anybody, a page that reads as an outage. A test per
   * item is what stops one being dropped in a later tidy-up — a checklist
   * silently losing an entry looks exactly like a shorter checklist.
   * ──────────────────────────────────────────────────────────────────────── */

  it('🔴 the index entry.source MIGRATION is named, with the exact widened CHECK line', () => {
    assert.match(text, /00NN_entry_source_library3\.sql/);
    assert.match(
      text,
      /\+ {2}source TEXT NOT NULL CHECK \(source IN \('game','library','audiobook','library2','library3'\)\),/,
    );
    // ⚠️ The whole trap in one sentence: the tool that would normally tell you
    // answers "nothing pending", truthfully. A runbook that omits this sends
    // the operator to a command that confirms the wrong thing.
    assert.match(text, /No migrations/);
    assert.match(text, /is TRUE and it is not the question/);
    // Widen, never drop — the constraint is the fence that made this loud.
    assert.match(text, /never drop it/);
  });

  it('🔴 UNSCOPED_LOOKUP_EXCLUDED is named as failing OPEN, not merely as an edit', () => {
    assert.match(text, /read\.ts:69 — UNSCOPED_LOOKUP_EXCLUDED/);
    assert.match(text, /FAILS OPEN/);
    assert.match(text, /can enumerate/);
    assert.match(text, /this catalog by title/);
    assert.match(text, /vis_library3 grant at all/);
    // The owner already decided this one; the runbook must not re-open it.
    assert.match(text, /2026-09-05 16:08/);
  });

  it('the rest of the index checklist: SOURCES, pushTokenFor, the search vocabulary, MACHINE_APPS', () => {
    assert.match(text, /rows\.ts:33 — SOURCES \+ 'library3'/);
    assert.match(text, /\+ {4}case 'library3':/);
    assert.match(text, /\+ {6}return env\.INDEX_PUSH_TOKEN_LIBRARY3;/);
    assert.match(text, /SOURCE_FOR_CATALOG and/);
    assert.match(text, /MACHINE_APPS \+ readTokenFor\(\) \+/);
    assert.match(text, /INDEX_READ_TOKEN_LIBRARY3/);
    // ⚠️ Being an APP is not being a SHELF — MACHINE_VISIBILITY stays deny.
    assert.match(text, /being an APP is not being a SHELF/);
  });

  it('⚠️ READ_ORIGINS is EMITTED for the owner and never applied — it is access-increasing', () => {
    assert.match(text, /OWNER, ACCESS-INCREASING/);
    assert.match(text, /wrangler\.toml:65 — READ_ORIGINS/);
    // The pasteable line itself, ending in the new host.
    assert.match(text, /READ_ORIGINS = "https:\/\/heygabi\.ai,.*,https:\/\/amber\.heygabi\.ai"/);
    assert.match(text, /does NOT apply it and must not/);
    // 🔴 And it must tell him to read the LIVE list first: pasting a template
    // would REVOKE any origin added since this string was written.
    assert.match(text, /silently REVOKE an/);
  });

  it('the auth Worker items the checklist was missing: visibility ×2 files, CORS, RESERVED_SUBDOMAINS', () => {
    assert.match(text, /packages\/estate-auth\/src\/visibility\.ts/);
    assert.match(text, /apps\/auth-worker\/src\/visibility\.ts/);
    assert.match(text, /storedVisibility\(\) {2}\+ if \(row\.vis_library3 === 1\)/);
    assert.match(text, /visibilityToFlags\(\) \+ vis_library3: visibility\.includes\('library3'\)/);
    assert.match(text, /Do NOT hand-edit the GENERATED copies/);
    // CORS: and the reason it is worth a line — the failure looks like an outage.
    assert.match(text, /the CORS allowlist gains the new host/);
    assert.match(text, /\+ {2}'https:\/\/amber\.heygabi\.ai',/);
    assert.match(text, /NETWORK ERROR/);
    // RESERVED_SUBDOMAINS: the books twin never printed it; the games one did.
    assert.match(text, /catalog-names\.ts:109 — RESERVED_SUBDOMAINS/);
    assert.match(text, /\+ {2}'amber',/);
    assert.match(text, /told it is free/);
  });

  it('✅ it says which §7 rows the REGISTRY now handles, so nobody hand-edits a label', () => {
    assert.match(text, /WHAT THE REGISTRY ROW \(step 12\) ALREADY DOES/);
    assert.match(text, /api\/catalogs/);
    assert.match(text, /10 minutes/);
    // ⚠️ /admin is the exception and must stay one: a permission surface must
    // not fail closed on a cache miss.
    assert.match(text, /admin's CATALOGS array stays hand-kept/);
  });

  it('the theme and the /status cadence are named as deliberate NON-actions', () => {
    assert.match(text, /data-default-theme-by-host/);
    assert.match(text, /will not GRADE this catalog's index freshness/);
    assert.match(text, /Guessing a cadence/);
  });
});

/* --------------------------------------------------------------------------
 * runbookSection — the pauses are found by HEADING, not by line offset
 * ------------------------------------------------------------------------ */

describe('runbookSection', () => {
  const names = deriveNames(ROW, { envNames: EXISTING_ENVS, estateApps: EXISTING_APPS });
  const first = runbookSection(names, '/repos/catalog-platform', 1);
  const second = runbookSection(names, '/repos/catalog-platform', 2);

  it('🔴 pause #1 stops at pause #2 — the old .slice(0, 12) was a line offset', () => {
    // The bug this replaced had not fired yet: adding one line to PAUSE #1
    // would have printed half of it plus the head of the next pause, to
    // somebody standing at a checkpoint. The runbook grew ~90 lines the day
    // this test was written, which is when it would have happened.
    assert.match(first.join('\n'), /PAUSE #1 — Firebase authorised domain/);
    assert.ok(!first.some((l) => l.includes('PAUSE #2')), 'pause #1 must not run into pause #2');
    assert.match(first.join('\n'), /Add domain → amber\.heygabi\.ai/);
  });

  it("pause #2 carries everything after it — the other repo's work belongs together", () => {
    assert.match(second[0], /PAUSE #2/);
    assert.ok(!second.some((l) => l.includes('PAUSE #1')));
    const text2 = second.join('\n');
    assert.match(text2, /THE ESTATE INDEX/);
    assert.match(text2, /READ_ORIGINS/);
    assert.match(text2, /AFTERWARDS/);
  });

  it('the two halves reassemble into the whole runbook, losing nothing', () => {
    assert.deepEqual(
      [...first, ...second],
      manualRunbook(names, { platformDir: '/repos/catalog-platform' }),
    );
  });
});

/* --------------------------------------------------------------------------
 * registryInsertSql — how a new catalog gets a NAME and an OWNER
 *
 * ⚠️ WHAT IS TESTED IS THE SHAPE OF A CLAIM ABOUT OWNERSHIP. The canonical
 * writer is the auth Worker's /live route (`insertCatalog`, migration 0020),
 * which this script cannot call — it is `requireDevops()` and needs a Firebase
 * ID token, and the provisioner runs on a wrangler login with no browser near
 * it. The two are deliberate near-duplicates and are NOT interchangeable; if
 * one changes the other must, which is what these assertions are for.
 * ------------------------------------------------------------------------ */

describe('registryInsertSql — the catalog registry row (0020)', () => {
  const names = deriveNames(ROW, { envNames: EXISTING_ENVS, estateApps: EXISTING_APPS });
  const sql = registryInsertSql(names, ROW, { now: new Date('2026-09-06T12:00:00.000Z') });

  it('writes the id, the push source, the label and the host', () => {
    assert.match(
      sql,
      /INSERT INTO estate_catalog \(id, push_source, kind, label, owner_name, holding, shared, host, sort_order, request_id, created_at\)/,
    );
    assert.match(sql, /'library3', 'library3', 'books'/);
    assert.match(sql, /'Amber''s Library'/);
    assert.match(sql, /'amber\.heygabi\.ai'/);
    assert.match(sql, /, 4, /); // the request id, so the row traces back
  });

  it("the OWNER is the requester, and the holding model is the owner's settled one", () => {
    assert.match(sql, /'Amber'/);
    // physical, not shared — 2026-09-05: a provisioned library3… is "the
    // requester's name, physical". Constants, not fields a caller can flip.
    assert.match(sql, /'physical', 0,/);
  });

  it('🔴 ON CONFLICT DO NOTHING — a --resume must never rename a live catalog', () => {
    assert.match(sql, /ON CONFLICT\(id\) DO NOTHING$/);
  });

  it('a NULL owner is written as NULL, never as an empty string or a guess', () => {
    // requester_display_name is a nullable snapshot from the SSO profile. An
    // unattributed physical shelf is honest; an invented name on the estate's
    // front door is not.
    const anon = registryInsertSql(names, { ...ROW, requester_display_name: null });
    assert.match(anon, /'books', 'Amber''s Library', NULL, 'physical'/);
  });

  it('a label with a quote in it cannot break the statement', () => {
    const odd = registryInsertSql(names, { ...ROW, display_name: "O'Brien's" });
    assert.match(odd, /'O''Brien''s'/);
  });

  it('falls back to the derived display name when the row carries none', () => {
    const bare = registryInsertSql(names, {});
    assert.match(bare, /'library3', 'library3', 'books', 'Amber'/);
    assert.match(bare, /NULL, 'physical'/);
  });
});

describe('checkAuthWorkerRegistration — what --resume can read out of the source', () => {
  const names = deriveNames(ROW, { envNames: EXISTING_ENVS, estateApps: EXISTING_APPS });
  const done = `
    export const CONSUMER_APPS = ['library', 'games', 'index', 'audiobook', 'library2', 'library3'] as const;
    export interface Env { ESTATE_APP_TOKEN_LIBRARY3?: string; }
    export function appTokenFor(env: Env, app: ConsumerApp) {
      switch (app) { case 'library3': return env.ESTATE_APP_TOKEN_LIBRARY3; }
    }`;

  it('all four checks pass on a finished registration', () => {
    const r = checkAuthWorkerRegistration(names, '/x', {
      read: () => done,
      list: () => ['0007_vis_library2.sql', '0019_vis_library3.sql'],
    });
    assert.equal(r.ok, true);
    assert.equal(r.checks.length, 4);
  });

  it('🔴 a half-done registration is NOT ok, and names which half', () => {
    const r = checkAuthWorkerRegistration(names, '/x', {
      read: () => done,
      list: () => ['0007_vis_library2.sql'],
    });
    assert.equal(r.ok, false);
    const failed = r.checks.filter(([ok]) => !ok).map(([, what]) => what);
    assert.deepEqual(failed, ['a migration adding vis_library3 exists']);
  });

  it('an unreadable checkout fails every check rather than passing quietly', () => {
    const r = checkAuthWorkerRegistration(names, '/x', { read: () => '', list: () => [] });
    assert.equal(r.ok, false);
    assert.equal(r.checks.filter(([ok]) => ok).length, 0);
  });

  it('the real sibling checkout has NOT been registered for library3 yet', () => {
    // Measured, not assumed: this is the state PAUSE #2 exists to change, and if
    // it ever passes by accident the pause has stopped meaning anything.
    const platform = join(ROOT, '..', '..', 'catalog-platform', 'apps', 'auth-worker');
    assert.equal(checkAuthWorkerRegistration(names, platform).ok, false);
  });
});

describe('the small parsers', () => {
  it('parseEnvNames finds a name from every table shape', () => {
    assert.deepEqual(
      parseEnvNames('[env.a]\n[env.b.vars]\n[[env.c.routes]]\n[vars]\n[env.a.assets]'),
      ['a', 'b', 'c'],
    );
  });

  it('parseEstateApps reads the values already claimed', () => {
    assert.deepEqual(parseEstateApps('ESTATE_APP = "library"\nESTATE_APP = "library2"'), [
      'library',
      'library2',
    ]);
  });

  it('existingVar reads a var out of THIS instance\'s section, not another\'s', () => {
    const toml =
      '[env.friend.vars]\nCOVERS_BASE_URL = "https://friend"\nESTATE_APP = "library2"\n' +
      '[env.amber.vars]\nCOVERS_BASE_URL = "https://amber"\nESTATE_APP = "library3"\n';
    assert.equal(existingVar(toml, 'amber', 'COVERS_BASE_URL'), 'https://amber');
    assert.equal(existingVar(toml, 'amber', 'ESTATE_APP'), 'library3');
    assert.equal(existingVar(toml, 'nope', 'ESTATE_APP'), null);
  });

  it('parseDatabaseId reads the id out of wrangler\'s copy-paste snippet', () => {
    const out = `✅ Successfully created DB 'library-catalog-3rd'\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "library-catalog-3rd"\ndatabase_id = "9dcf4af9-d1a2-4de4-adcf-ac7eea77f1c8"\n`;
    assert.equal(parseDatabaseId(out), '9dcf4af9-d1a2-4de4-adcf-ac7eea77f1c8');
    assert.equal(parseDatabaseId('nothing here'), null);
  });

  it('extractJsonArray survives a warning that contains a bracket, and trailing noise', () => {
    const out = 'warning: [experimental] whatever\n[{"results":[{"n":1}]}]\nAssertion failed: teardown';
    assert.deepEqual(extractJsonArray(out), [{ results: [{ n: 1 }] }]);
  });

  it('sqlLit doubles the quote, and refuses a non-finite number', () => {
    assert.equal(sqlLit("O'Brien"), "'O''Brien'");
    assert.equal(sqlLit(null), 'NULL');
    assert.equal(sqlLit(4), '4');
    assert.throws(() => sqlLit(Infinity), /refusing to write/);
  });
});

/* --------------------------------------------------------------------------
 * The sealed Claude key — design §6.4, landed 2026-09-05
 *
 * ⚠️ WHAT IS TESTED HERE IS THE CUSTODY CLAIM, not the cryptography. The round
 * trip (browser seals → provisioner opens) is pinned in
 * `catalog-platform/scripts/test/catalog-seal.test.mjs`, which owns the
 * envelope. What this repo owns is the SQL it writes about whose key a live
 * catalog spends, and the fact that it looks for an envelope before falling
 * back to the owner's own key.
 * ------------------------------------------------------------------------ */

describe('markLiveUpdate — the key-custody booleans', () => {
  const NAMES = { instance: 'amber', host: 'amber.heygabi.ai', requestId: 4 };

  it('always writes the status, the instance and the host, guarded on accepted', () => {
    const sql = markLiveUpdate(NAMES, 'none');
    assert.match(sql, /UPDATE catalog_request SET status = 'live'/);
    assert.match(sql, /provisioned_instance = 'amber'/);
    assert.match(sql, /provisioned_host = 'amber\.heygabi\.ai'/);
    // ⚠️ The guard is what makes a --resume safe: a row that is already live
    // matches nothing and the statement reports changes: 0 instead of
    // re-stamping a catalog somebody has been using.
    assert.match(sql, /WHERE id = 4 AND status = 'accepted'$/);
  });

  it("🔴 a READER key writes NEITHER boolean — reader_key_set has one writer, the route", () => {
    const sql = markLiveUpdate(NAMES, 'reader');
    assert.ok(!/owner_key_set/.test(sql), 'claiming owner_key_set on a reader-keyed catalog is a lie about custody');
    assert.ok(!/reader_key_set/.test(sql), 'the route already set it; a second writer of one fact is drift waiting');
  });

  it('an owner-at-accept key sets owner_key_set, idempotently', () => {
    assert.match(markLiveUpdate(NAMES, 'owner'), /owner_key_set = 1/);
  });

  it('no key at all sets owner_key_set — §6.4 row 3, the standing decision', () => {
    assert.match(markLiveUpdate(NAMES, 'none'), /owner_key_set = 1/);
    // The default argument must be the SAFE one: an unnamed source is the
    // owner's key, which is what actually gets spent.
    assert.equal(markLiveUpdate(NAMES), markLiveUpdate(NAMES, 'none'));
  });

  it('a name with a quote in it still cannot break the statement', () => {
    const sql = markLiveUpdate({ instance: "o'brien", host: "o'brien.heygabi.ai", requestId: 9 }, 'none');
    assert.match(sql, /provisioned_instance = 'o''brien'/);
  });
});

describe('loadSealLib — absent is a sentence, not a crash', () => {
  it('returns null and says why when catalog-platform has no seal lib', async () => {
    const said = [];
    const mod = await loadSealLib(join(ROOT, 'no', 'such', 'platform'), { log: (l) => said.push(l) });
    assert.equal(mod, null);
    const text = said.join('\n');
    assert.match(text, /no sealed-key lib/);
    // ⚠️ It must say what the CONSEQUENCE is, not just that a file is missing.
    assert.match(text, /falls back to the owner's own key/);
  });

  it('loads the real one from the sibling checkout, and it exports injectSealedKey', async () => {
    const platform = resolvePlatformRepo();
    const mod = await loadSealLib(platform.dir, { log: () => {} });
    // ⚠️ Not skipped when absent: a checkout without catalog-platform cannot
    // run any of this suite (the drift test reads its wrangler.toml), so a
    // missing lib here is a real regression, not an environment quirk.
    assert.ok(mod, 'the sibling catalog-platform has no scripts/lib/catalog-seal.mjs');
    assert.equal(typeof mod.injectSealedKey, 'function');
    // The candidates it will look for, in the order that IS the policy.
    assert.deepEqual(
      mod.envelopeCandidates(ROW.id).map((c) => c.key),
      [`reader/${ROW.id}.json`, `owner/${ROW.id}.json`],
    );
  });
});

describe('the fixture row carries both key booleans', () => {
  it('a request that arrived with a sealed reader key', () => {
    const row = { ...ROW, reader_key_set: 1, owner_key_set: 0 };
    assert.doesNotThrow(() => assertProvisionable(row));
    // Both are 0/1 integers on the row, never strings — the admin UI and this
    // script both compare them numerically.
    for (const v of [row.reader_key_set, row.owner_key_set]) assert.equal(typeof v, 'number');
  });

  it('a request the owner keyed at Accept', () => {
    const row = { ...ROW, reader_key_set: 0, owner_key_set: 1 };
    assert.doesNotThrow(() => assertProvisionable(row));
  });

  it('both set is a legal state — the owner set one and the reader still wins', () => {
    const row = { ...ROW, reader_key_set: 1, owner_key_set: 1 };
    assert.doesNotThrow(() => assertProvisionable(row));
    assert.match(markLiveUpdate({ instance: 'amber', host: 'amber.heygabi.ai', requestId: row.id }, 'reader'), /SET status/);
  });
});
