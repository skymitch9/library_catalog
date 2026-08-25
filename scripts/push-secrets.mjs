#!/usr/bin/env node
/**
 * Push secrets from apps/worker/.dev.vars to the deployed Worker(s).
 *
 * Ported from the Board Game Catalog, where it exists because `wrangler secret
 * put` prompts for one value at a time — rotating a key took three commands and
 * got the ordering wrong once, leaving production holding the pre-rotation key
 * while `.dev.vars` held the new one.
 *
 * **`.dev.vars` is the single source of truth: edit it, run this, done.** One
 * place to change a key, which is the whole point.
 *
 *   npm run secrets:push               # MAIN, every allowlisted key present
 *   npm run secrets:push -- --dry      # show what would be pushed, names only
 *   npm run secrets:push -- --both     # MAIN and FRIEND in one command
 *   npm run secrets:push -- --friend   # FRIEND only (shared keys)
 *   npm run secrets:push -- --both --dry-run   # print the plan, push nothing
 *
 * ⚠️ This only ever *sets* secrets. Removing one from `.dev.vars` does not
 * delete it in production — use `wrangler secret delete` for that, so a typo
 * here can never quietly strip a live credential.
 *
 * ⚠️ `.dev.vars` is gitignored and must stay that way. It is the one file in
 * this repo that holds real key material.
 *
 * ## The "one command for BOTH instances" change (owner ask, 2026-08-25)
 *
 * > *"we should do something so we dont need to always do different things for
 * > these 2 libraries."*
 *
 * Before this, `--env friend` was a deliberate stub that refused, because there
 * is no `.dev.vars.friend` and there is not meant to be one: a bulk push from a
 * second file would make "push the owner's keys onto her Worker" the default
 * instead of a choice. That reasoning was right about the *risk* and wrong about
 * the *remedy* — the risk is not the file, it is pushing the keys that are HERS.
 *
 * So the answer is two explicit lists rather than a second file:
 *
 * | List | Meaning | Friend |
 * |---|---|---|
 * | `SHARED_SECRETS` | one value, two holders, **by design** | pushed |
 * | `PER_INSTANCE_SECRETS` | each instance has its OWN value | **refused, always** |
 * | anything else | not classified | refused with a sentence |
 *
 * Friend pushes read the ONE main `.dev.vars` and send only the SHARED set, so
 * her `ANTHROPIC_API_KEY` and her estate identity can never be overwritten by a
 * bulk run — the property the old stub protected, kept, without the stub.
 *
 * ⚠️ **`.dev.vars.friend` still does not exist and must not be created.** It is
 * not read here for any flag. Creating one would be a custody change (§2 of the
 * estate credentials catalog), not a missing file to fill in.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEV_VARS = join(root, 'apps', 'worker', '.dev.vars');
const CONFIG = join(root, 'apps', 'worker', 'wrangler.toml');
/** wrangler's `[env.friend]` — padhard. The only second instance that exists. */
const FRIEND_ENV = 'friend';

/**
 * An allowlist, not a denylist, and deliberately so: a new local-only variable
 * added to `.dev.vars` should never reach production just because nobody
 * remembered to exclude it.
 *
 * ⚠️ **This list is the MAIN instance's set and nothing else.** `npm run
 * secrets:push` with no flags pushes exactly these, exactly as it did before the
 * "both instances" change — that behaviour is deliberately untouched.
 */
export const PRODUCTION_SECRETS = [
  'GOOGLE_BOOKS_API_KEY',
  'HARDCOVER_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'EBOOK_INGEST_TOKEN',
  // The audiobook pipeline's mapping export bearer (routes/audiobook-mapping.ts).
  // The audiobook_catalog repo holds the same value as LIBRARY_MAPPING_TOKEN.
  'AUDIOBOOK_MAPPING_TOKEN',
  // The estate /seen bearer (estate-auth-design.md §4.4). The auth Worker
  // holds the matching value under the same name; minted at the dispatcher's
  // deploy step. Absent here = simply not pushed — the Worker then logs
  // estate_config_unset and the estate check stays off, by design.
  'ESTATE_APP_TOKEN_LIBRARY',
  // The shared-index push bearer (index-worker-design.md §5). The index
  // Worker holds the matching value as INDEX_PUSH_TOKEN_LIBRARY; minted at
  // the dispatcher's deploy step. Absent = not pushed — the push triggers in
  // lib/index-push.ts then log one line and do nothing, by design.
  'INDEX_PUSH_TOKEN',
];

/**
 * **The same value on BOTH instances, by design.** Every entry here is the
 * estate's *one value, two holders, the same NAME on both sides* idiom: the
 * value identifies a CALLER (a pipeline, a peer, a keyed vendor account), not
 * an instance, so both Workers holding it is the intended state and a bulk push
 * cannot overwrite anything that belongs to one of them.
 *
 * ⚠️ Membership was checked against the live secret NAMES on 2026-08-25
 * (`npm run secret:list` / `secret:list:friend` — names only, never values).
 *
 * | Key | Why it is the same on both |
 * |---|---|
 * | `GOOGLE_BOOKS_API_KEY` | one keyed vendor account for the household |
 * | `HARDCOVER_API_TOKEN` | ditto — free tier, 5,000 req/day, one account |
 * | `EBOOK_INGEST_TOKEN` | ⚠️ authenticates the ebook IMPORTER (one pipeline, not a person) to a shelf. Unset = the route is disabled, so pushing it to friend is what turns her ingest route on — a deliberate act, not a tidy-up |
 * | `AUDIOBOOK_MAPPING_TOKEN` | ⚠️ same shape: the audiobook pipeline's read bearer; `audiobook_catalog` holds the value as `LIBRARY_MAPPING_TOKEN`. Unset = route disabled |
 * | `DONOR_TOKEN` | the cross-instance donor call — the two instances ask EACH OTHER with it, so a differing value is the bug |
 * | `PEER_TOKEN` | the cross-instance peer-holdings bearer, same argument |
 *
 * ⚠️ **`INDEX_PUSH_TOKEN` is deliberately NOT here** even though the brief for
 * this change listed it. It is a PER-SOURCE bearer: the index Worker holds it
 * as `INDEX_PUSH_TOKEN_LIBRARY` and resolves the pushing source from *which*
 * suffixed secret matched (`catalog-platform/apps/index-worker/src/env.ts`).
 * Giving friend main's value would make her rows arrive labelled `library`
 * rather than `library2` — the exact `ESTATE_APP_TOKEN_LIBRARY`-on-her-instance
 * mistake that was cleaned up on 2026-08-25. Her side is unset on purpose until
 * federation day mints a `library2` token (`search-route.ts`, friend-ingest
 * design §7). It is in `PER_INSTANCE_SECRETS` instead.
 *
 * ⚠️ **`INDEX_READ_TOKEN` is NOT here either**, and not in `PER_INSTANCE_SECRETS`:
 * it is set live on MAIN but is in neither `PRODUCTION_SECRETS` nor the friend
 * instance's secret list, and the read half of the index does not exist yet
 * (`env.ts` says so at length). Unclassified means REFUSED for friend with a
 * sentence, which is the correct answer for a credential nobody has decided the
 * custody of.
 */
export const SHARED_SECRETS = [
  'GOOGLE_BOOKS_API_KEY',
  'HARDCOVER_API_TOKEN',
  'EBOOK_INGEST_TOKEN',
  'AUDIOBOOK_MAPPING_TOKEN',
  'DONOR_TOKEN',
  'PEER_TOKEN',
];

/**
 * **Each instance holds its OWN value. Refused for friend, always.**
 *
 * Not "not yet supported" — refused. A bulk push that could reach one of these
 * is a bulk push that can silently replace her key material with the owner's,
 * which is the failure the old `--env friend` stub existed to make impossible.
 *
 * - `ANTHROPIC_API_KEY` — she has her own since 2026-08-16 late; it is her
 *   spend, on her billing, and the drop-box line in the MAIN `.dev.vars`
 *   (`ANTHROPIC_API_KEY_FRIEND_SAM`, piped then blanked) exists precisely so it
 *   can never reach an allowlist.
 * - `INDEX_PUSH_TOKEN` — per-source on the index Worker; see `SHARED_SECRETS`.
 * - every `ESTATE_APP_TOKEN_*` — these assert *which consumer is speaking to
 *   the estate directory*, and the two instances are two consumers. Main's is
 *   `…_LIBRARY`, hers is `…_LIBRARY2`, and her stale `…_LIBRARY` was deleted on
 *   2026-08-25 for exactly this reason. Matched by PREFIX so a third consumer
 *   added later is refused by default rather than by memory.
 *
 * ⚠️ `ESTATE_APP_TOKEN_DISCORD` is on both instances under the same name and is
 * *still* refused here. That is the safe direction: it is the estate Discord
 * Worker's bearer, minted elsewhere and piped to three holders, so a rotation is
 * a coordinated act, not a side effect of a library push.
 */
export const PER_INSTANCE_SECRETS = ['ANTHROPIC_API_KEY', 'INDEX_PUSH_TOKEN'];

/** Prefix rule, so a consumer nobody has thought of yet is refused by default. */
export const PER_INSTANCE_PREFIXES = ['ESTATE_APP_TOKEN_'];

/** Local-only by design. Listed so the script can say *why* it skipped them. */
export const LOCAL_ONLY = {
  ENVIRONMENT: 'set in wrangler.toml for production',
  DEV_EMAIL: 'local auth bypass — must NEVER exist in production',
  DEV_NAME: 'local auth bypass only',
  ESTATE_CHECK: 'set in wrangler.toml for production (off until the dispatcher flips it)',
  ESTATE_AUTH_URL: 'set in wrangler.toml for production',
  ESTATE_APP: 'set in wrangler.toml per env — the instance identity is config of record, not a secret',
  INDEX_URL: 'set in wrangler.toml [vars] for production (commented until the index deploy step)',
  // The friend instance's estate bearer (added with the F-5 fix, 2026-08-17).
  // Named here rather than in PRODUCTION_SECRETS on purpose: THE NO-FLAG PATH
  // PUSHES THE MAIN INSTANCE, whose ESTATE_APP is `library` — it would never
  // read a library2 token, and pushing it there would put a live credential
  // somewhere nothing consumes it. It is ALSO per-instance by the
  // ESTATE_APP_TOKEN_ prefix rule above, so a `--friend` run refuses it too:
  // set it one value at a time with
  // `npm run secret:friend -- ESTATE_APP_TOKEN_LIBRARY2`.
  ESTATE_APP_TOKEN_LIBRARY2:
    "the FRIEND instance's estate bearer — set with `npm run secret:friend -- ESTATE_APP_TOKEN_LIBRARY2`, never pushed from here",
};

/** True for a key each instance must hold its own copy of. */
export function isPerInstance(
  name,
  perInstance = PER_INSTANCE_SECRETS,
  prefixes = PER_INSTANCE_PREFIXES,
) {
  return perInstance.includes(name) || prefixes.some((p) => name.startsWith(p));
}

/**
 * ⚠️ **A key on BOTH lists is a startup error, not a warning.**
 *
 * The two lists answer opposite questions about the same key — "may a bulk run
 * send this to her Worker?" — and a key on both means whichever loop runs last
 * decides. That is precisely the silent-failure shape the whole design exists to
 * prevent, so it fails at module load, before anything can be pushed.
 */
export function assertListsDisjoint(
  shared = SHARED_SECRETS,
  perInstance = PER_INSTANCE_SECRETS,
  prefixes = PER_INSTANCE_PREFIXES,
) {
  const clash = shared.filter((name) => isPerInstance(name, perInstance, prefixes));
  if (clash.length) {
    throw new Error(
      `SHARED_SECRETS and PER_INSTANCE_SECRETS overlap: ${clash.join(', ')}. ` +
        'A key is either the same value on both instances or it is not — decide, ' +
        'and put it on exactly one list. See the header of scripts/push-secrets.mjs.',
    );
  }
  const dupes = shared.filter((n, i) => shared.indexOf(n) !== i);
  if (dupes.length) throw new Error(`SHARED_SECRETS lists ${dupes.join(', ')} twice.`);
}

// Runs at module load: the lists are wrong or nothing runs at all.
assertListsDisjoint();

export function parseDevVars(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

/** The four things that can happen to one key on one instance. */
export const PUSH_MAIN = 'push main';
export const PUSH_FRIEND = 'push friend';
export const REFUSE_PER_INSTANCE = 'refuse (per-instance)';
export const SKIP_UNSET = 'skip (not set locally)';
export const SKIP_LOCAL_ONLY = 'skip (local only)';
export const REFUSE_UNCLASSIFIED = 'refuse (not a shared secret)';

/**
 * What a `--friend` / `--both` run WOULD do, as data — names only, no values.
 *
 * ⚠️ Pure on purpose: it takes the parsed `.dev.vars` object and returns a plan,
 * so the tests can prove the refusal rules without wrangler existing. Nothing in
 * here spawns anything.
 *
 * `names` is only ever a list of KEY NAMES. A value never enters a plan entry.
 */
export function planFor(
  varNames,
  { both = false, friend = false } = {},
  lists = {},
) {
  const shared = lists.shared ?? SHARED_SECRETS;
  const production = lists.production ?? PRODUCTION_SECRETS;
  const localOnly = lists.localOnly ?? LOCAL_ONLY;
  const present = new Set(varNames);
  const plan = { main: [], friend: [] };

  if (both) {
    // ⚠️ MAIN's set is `PRODUCTION_SECRETS ∪ SHARED_SECRETS`, a superset of what
    // the no-flag run sends. The union rather than either list alone because
    // `--both` must never push LESS to main than `secrets:push` does (that would
    // make the convenient command the lossy one), and `DONOR_TOKEN` /
    // `PEER_TOKEN` are shared-by-design keys that predate the allowlist and were
    // set on main by hand.
    for (const name of [...production, ...shared.filter((n) => !production.includes(n))]) {
      plan.main.push({ name, action: present.has(name) ? PUSH_MAIN : SKIP_UNSET });
    }
  }

  if (both || friend) {
    for (const name of shared) {
      plan.friend.push({ name, action: present.has(name) ? PUSH_FRIEND : SKIP_UNSET });
    }
    // Everything else anyone might expect to travel: named, with the reason.
    // Per-instance first, because that is the refusal that matters.
    const rest = new Set([...production, ...varNames].filter((n) => !shared.includes(n)));
    for (const name of [...rest].sort()) {
      if (isPerInstance(name)) {
        plan.friend.push({ name, action: REFUSE_PER_INSTANCE, why: perInstanceReason(name) });
      } else if (name in localOnly) {
        plan.friend.push({ name, action: SKIP_LOCAL_ONLY, why: localOnly[name] });
      } else {
        plan.friend.push({
          name,
          action: REFUSE_UNCLASSIFIED,
          why:
            'not on SHARED_SECRETS or PER_INSTANCE_SECRETS — nobody has decided ' +
            'whether both instances should hold the same value. Classify it in ' +
            'scripts/push-secrets.mjs before a bulk run can send it.',
        });
      }
    }
  }

  return plan;
}

/** One sentence, printed beside the refusal, saying what to do instead. */
export function perInstanceReason(name) {
  if (name.startsWith('ESTATE_APP_TOKEN_')) {
    return (
      'per-instance: an ESTATE_APP_TOKEN_* asserts WHICH consumer is speaking to ' +
      "the estate directory, and padhard is its own consumer (ESTATE_APP = \"library2\"). " +
      'Set hers with `npm run secret:friend -- ESTATE_APP_TOKEN_LIBRARY2`.'
    );
  }
  if (name === 'ANTHROPIC_API_KEY') {
    return (
      'per-instance: padhard has her OWN key on her own spend since 2026-08-16. ' +
      'Set it with `npm run secret:friend -- ANTHROPIC_API_KEY` (the drop-box line ' +
      'ANTHROPIC_API_KEY_FRIEND_SAM in the MAIN .dev.vars is piped, then blanked).'
    );
  }
  if (name === 'INDEX_PUSH_TOKEN') {
    return (
      'per-instance: the index Worker resolves the pushing SOURCE from which ' +
      'INDEX_PUSH_TOKEN_<SOURCE> matched, so main\'s value would label her rows ' +
      '`library`. Hers is unset on purpose until federation mints a library2 token.'
    );
  }
  return 'per-instance: each instance holds its own value — set it one at a time.';
}

/** `wrangler secret bulk`, values over STDIN. Never argv, never a temp file. */
function spawnBulk(payload, wranglerEnv) {
  // Run wrangler's JS entrypoint under this same node binary rather than the
  // `npx` shim. On Windows, Node 20+ refuses to spawn a .cmd directly (EINVAL),
  // and the `shell: true` workaround is deprecated for arg-injection reasons —
  // this sidesteps both. Secrets go over stdin, never argv, so they never reach a
  // command line, a process listing, or shell history. A temp JSON file would
  // work too and is what the vendor documents; stdin is strictly better because
  // there is no window in which the file exists to be read or left behind.
  const WRANGLER = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  return new Promise((resolveExit) => {
    const child = spawn(
      process.execPath,
      [
        WRANGLER,
        'secret',
        'bulk',
        '--config',
        CONFIG,
        ...(wranglerEnv ? ['--env', wranglerEnv] : []),
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.stdin.end(JSON.stringify(payload));
    child.on('exit', (code) => resolveExit(code));
  });
}

// ---------------------------------------------------------------------------
// Everything below runs only when this file is the entrypoint, so the tests can
// import the lists and `planFor` without pushing anything anywhere.
// ---------------------------------------------------------------------------

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) await main();

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry') || argv.includes('--dry-run');
  const both = argv.includes('--both');
  // `--env friend` is kept as an alias for `--friend`: it is what
  // `secrets:push:friend` said for months and what the runbook printed.
  const envIdx = argv.findIndex((a) => a === '--env' || a.startsWith('--env='));
  let envValue = null;
  if (envIdx !== -1) {
    envValue = argv[envIdx].includes('=') ? argv[envIdx].split('=')[1] : (argv[envIdx + 1] ?? null);
    if (!envValue) {
      console.error('--env needs a value, e.g. --env friend');
      process.exit(1);
    }
    if (envValue !== FRIEND_ENV) {
      console.error(`--env ${envValue}: the only second instance is \`${FRIEND_ENV}\` (padhard).`);
      process.exit(1);
    }
  }
  const friend = argv.includes('--friend') || envValue === FRIEND_ENV;

  let raw;
  try {
    raw = readFileSync(DEV_VARS, 'utf8');
  } catch {
    console.error(`No .dev.vars at ${DEV_VARS}. Nothing to push.`);
    console.error('Copy apps/worker/.dev.vars.example and fill it in.');
    if (friend || both) {
      console.error('');
      console.error('⚠️ There is no `.dev.vars.friend` and there must not be one: the FRIEND');
      console.error('push reads this same MAIN file and sends only the SHARED_SECRETS set.');
    }
    process.exit(1);
  }
  const vars = parseDevVars(raw);

  if (!both && !friend) return await pushMainOnly(vars, dry);
  return await pushBoth(vars, { both, friend, dry });
}

/**
 * ⚠️ The pre-2026-08-25 behaviour, unchanged down to the spacing. `npm run
 * secrets:push` with no flags must keep doing exactly what the runbook says it
 * does; the "both instances" work is additive and lives in `pushBoth`.
 */
async function pushMainOnly(vars, dry) {
  const payload = {};
  const skipped = [];

  for (const key of PRODUCTION_SECRETS) {
    if (vars[key]) payload[key] = vars[key];
    else skipped.push(`${key} — not set locally`);
  }
  for (const [key, why] of Object.entries(LOCAL_ONLY)) {
    if (vars[key]) skipped.push(`${key} — ${why}`);
  }
  for (const key of Object.keys(vars)) {
    if (!PRODUCTION_SECRETS.includes(key) && !(key in LOCAL_ONLY)) {
      skipped.push(`${key} — not in the allowlist; add it to PRODUCTION_SECRETS if it belongs`);
    }
  }

  const names = Object.keys(payload);
  // A last-4 fingerprint, so you can confirm *which* value went up without ever
  // printing the secret. Enough to tell a rotation apart, useless to anyone else.
  for (const name of names) {
    console.log(`  push  ${name}  (…${payload[name].slice(-4)})`);
  }
  for (const note of skipped) console.log(`  skip  ${note}`);

  if (names.length === 0) {
    console.error('\nNothing to push.');
    process.exit(1);
  }

  if (dry) {
    console.log('\nDry run — nothing sent.');
    process.exit(0);
  }

  const code = await spawnBulk(payload, null);
  // wrangler on Windows sometimes prints success then exits non-zero (a libuv
  // teardown quirk), so report rather than trusting the code blindly.
  console.log(
    code === 0
      ? `\nPushed ${names.length} secret${names.length === 1 ? '' : 's'}.`
      : `\nwrangler exited ${code} — read the output above before assuming it failed.`,
  );
  process.exit(0);
}

/** The `--both` / `--friend` path: one command, both instances, names only. */
async function pushBoth(vars, { both, friend, dry }) {
  const plan = planFor(Object.keys(vars), { both, friend });

  const say = (rows, heading) => {
    if (!rows.length) return;
    console.log(`\n${heading}`);
    for (const row of rows) {
      console.log(`  ${row.action.padEnd(24)} ${row.name}`);
      if (row.why) console.log(`  ${' '.repeat(24)}   ↳ ${row.why}`);
    }
  };

  say(plan.main, `MAIN — library.heygabi.ai`);
  say(plan.friend, `FRIEND — padhard.heygabi.ai (env ${FRIEND_ENV})`);

  const mainNames = plan.main.filter((r) => r.action === PUSH_MAIN).map((r) => r.name);
  const friendNames = plan.friend.filter((r) => r.action === PUSH_FRIEND).map((r) => r.name);

  if (!mainNames.length && !friendNames.length) {
    console.error('\nNothing to push — no shared key is set in .dev.vars.');
    process.exit(1);
  }

  if (dry) {
    console.log('\nDry run — nothing sent.');
    process.exit(0);
  }

  // Main first, then friend, and STOP on the first failure: a half-applied
  // rotation across two instances is worse than a failed one, because the pair
  // then disagrees about a value that is shared BY DESIGN.
  for (const [label, env, names] of [
    ['MAIN', null, mainNames],
    ['FRIEND', FRIEND_ENV, friendNames],
  ]) {
    if (!names.length) continue;
    const payload = Object.fromEntries(names.map((n) => [n, vars[n]]));
    const code = await spawnBulk(payload, env);
    if (code !== 0) {
      // Same Windows teardown quirk as above: report, do not conclude. But do
      // not go on to the next instance — read the output first.
      console.error(
        `\nwrangler exited ${code} on ${label} — read the output above. ` +
          'Stopping before the next instance so a rotation cannot land on one side only.',
      );
      process.exit(1);
    }
    console.log(`\n${label}: pushed ${names.length} secret${names.length === 1 ? '' : 's'}.`);
  }
  process.exit(0);
}
