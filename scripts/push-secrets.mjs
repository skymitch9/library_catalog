#!/usr/bin/env node
/**
 * Push secrets from apps/worker/.dev.vars to the deployed Worker.
 *
 * Ported from the Board Game Catalog, where it exists because `wrangler secret
 * put` prompts for one value at a time — rotating a key took three commands and
 * got the ordering wrong once, leaving production holding the pre-rotation key
 * while `.dev.vars` held the new one.
 *
 * **`.dev.vars` is the single source of truth: edit it, run this, done.** One
 * place to change a key, which is the whole point.
 *
 *   npm run secrets:push          # push every allowlisted key present
 *   npm run secrets:push -- --dry # show what would be pushed, names only
 *
 * ⚠️ This only ever *sets* secrets. Removing one from `.dev.vars` does not
 * delete it in production — use `wrangler secret delete` for that, so a typo
 * here can never quietly strip a live credential.
 *
 * ⚠️ `.dev.vars` is gitignored and must stay that way. It is the one file in
 * this repo that holds real key material.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `--env friend` targets the second instance (wrangler `[env.friend]`): reads
 * `.dev.vars.friend` — wrangler's own per-environment convention, so
 * `wrangler dev --env friend` would read the same file — and pushes with
 * `--env friend`. No flag = the main instance, `.dev.vars`, unchanged.
 * ⚠️ Two files on purpose: the instances hold DIFFERENT key material, and one
 * shared file would make pushing the owner's keys to her Worker a default
 * instead of a choice. (It once said "hers deliberately has no
 * ANTHROPIC_API_KEY" — stale since 2026-08-16 late, when she got her own; the
 * two-file reason survives the correction unchanged.)
 *
 * ⚠️ **AND `.dev.vars.friend` DOES NOT EXIST, ON PURPOSE** (estate credentials
 * catalog F-6). Her env has never been push-synced: every secret on it was
 * piped one at a time — `npm run secret:friend -- NAME`, or the drop-box
 * pattern (a named line in the MAIN `.dev.vars`, piped, then blanked) for the
 * ones that must never sit in an allowlist. So `--env friend` here is a
 * command with no source file, and the failure below says that in words
 * rather than telling you to copy an example that would create a second,
 * competing home for her key material. If you ever DO want push-sync for her,
 * that is a deliberate custody change (§2 of the credentials catalog: write
 * down which of read-access / redeploy-behaviour / rotation-cost you are
 * changing), not a missing file to fill in.
 */
const envArgIdx = process.argv.findIndex((a) => a === '--env' || a.startsWith('--env='));
const wranglerEnv =
  envArgIdx === -1
    ? null
    : process.argv[envArgIdx].includes('=')
      ? process.argv[envArgIdx].split('=')[1]
      : (process.argv[envArgIdx + 1] ?? null);
if (envArgIdx !== -1 && !wranglerEnv) {
  console.error('--env needs a value, e.g. --env friend');
  process.exit(1);
}

const DEV_VARS = join(root, 'apps', 'worker', wranglerEnv ? `.dev.vars.${wranglerEnv}` : '.dev.vars');
const CONFIG = join(root, 'apps', 'worker', 'wrangler.toml');

/**
 * An allowlist, not a denylist, and deliberately so: a new local-only variable
 * added to `.dev.vars` should never reach production just because nobody
 * remembered to exclude it.
 */
const PRODUCTION_SECRETS = [
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

/** Local-only by design. Listed so the script can say *why* it skipped them. */
const LOCAL_ONLY = {
  ENVIRONMENT: 'set in wrangler.toml for production',
  DEV_EMAIL: 'local auth bypass — must NEVER exist in production',
  DEV_NAME: 'local auth bypass only',
  ESTATE_CHECK: 'set in wrangler.toml for production (off until the dispatcher flips it)',
  ESTATE_AUTH_URL: 'set in wrangler.toml for production',
  ESTATE_APP: 'set in wrangler.toml per env — the instance identity is config of record, not a secret',
  INDEX_URL: 'set in wrangler.toml [vars] for production (commented until the index deploy step)',
  // The friend instance's estate bearer (added with the F-5 fix, 2026-08-17).
  // Named here rather than in PRODUCTION_SECRETS on purpose: THIS FILE PUSHES
  // THE MAIN INSTANCE, whose ESTATE_APP is `library` — it would never read a
  // library2 token, and pushing it there would put a live credential somewhere
  // nothing consumes it. Her env is not push-synced at all (see the FRIEND
  // note above the .dev.vars read); it is set one value at a time with
  // `npm run secret:friend -- ESTATE_APP_TOKEN_LIBRARY2`.
  ESTATE_APP_TOKEN_LIBRARY2:
    "the FRIEND instance's estate bearer — set with `npm run secret:friend -- ESTATE_APP_TOKEN_LIBRARY2`, never pushed from here",
};

function parseDevVars(text) {
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

let raw;
try {
  raw = readFileSync(DEV_VARS, 'utf8');
} catch {
  if (wranglerEnv === 'friend') {
    // The honest answer, not "file not found". There is no .dev.vars.friend
    // and there is not meant to be one — see the FRIEND note in the header.
    // Telling someone to copy the example here would hand them a second home
    // for her key material and a rotation path that pushes the OWNER'S keys
    // onto HER Worker by default.
    console.error('`secrets:push --env friend` has no source file, and that is by design.');
    console.error('');
    console.error(`  looked for:  ${DEV_VARS}`);
    console.error('');
    console.error("The friend instance's secrets are NOT push-synced. Each one was piped");
    console.error('individually and deliberately:');
    console.error('');
    console.error('  one secret          npm run secret:friend -- NAME      (prompts for the value)');
    console.error('  confirm it landed   npm run secret:list:friend         (names only, never values)');
    console.error('');
    console.error('Drop-box keys (a named line in the MAIN apps/worker/.dev.vars, piped to her');
    console.error('env, then BLANKED) exist so they can never reach an allowlist by accident —');
    console.error('ANTHROPIC_API_KEY_FRIEND_SAM is the one in use. Do not rename them.');
    console.error('');
    console.error('Her estate bearer is ESTATE_APP_TOKEN_LIBRARY2, not _LIBRARY: her wrangler');
    console.error('env declares ESTATE_APP = "library2" and the gate reads the matching name.');
    console.error('');
    console.error('Runbook: docs/access/second-instance.md ("Secrets — names only").');
    console.error('Creating .dev.vars.friend would be a custody change, not a fix — read §2 of');
    console.error('the estate credentials catalog before deciding to make one.');
    process.exit(1);
  }
  console.error(`No .dev.vars at ${DEV_VARS}. Nothing to push.`);
  console.error('Copy apps/worker/.dev.vars.example and fill it in.');
  process.exit(1);
}

const vars = parseDevVars(raw);
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

if (process.argv.includes('--dry')) {
  console.log('\nDry run — nothing sent.');
  process.exit(0);
}

// Run wrangler's JS entrypoint under this same node binary rather than the
// `npx` shim. On Windows, Node 20+ refuses to spawn a .cmd directly (EINVAL),
// and the `shell: true` workaround is deprecated for arg-injection reasons —
// this sidesteps both. Secrets go over stdin, never argv, so they never reach a
// command line, a process listing, or shell history.
const WRANGLER = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

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
  {
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);

child.stdin.end(JSON.stringify(payload));
child.on('exit', (code) => {
  // wrangler on Windows sometimes prints success then exits non-zero (a libuv
  // teardown quirk), so report rather than trusting the code blindly.
  console.log(
    code === 0
      ? `\nPushed ${names.length} secret${names.length === 1 ? '' : 's'}.`
      : `\nwrangler exited ${code} — read the output above before assuming it failed.`,
  );
  process.exit(0);
});
