#!/usr/bin/env node
/**
 * Import `apps/worker/.dev.vars` into the 1Password vault `Estate`, so the file
 * stops being a hand-edited MASTER and becomes a GENERATED artifact.
 *
 * Owner decision 2026-08-26 (option A, superseding the 2026-08-25 "defer"):
 * adopt 1Password now. The plan of record is
 * `catalog-platform/docs/info/secrets-review-2026-08-26.md` §5.
 *
 *   node scripts/op-import-dev-vars.mjs --dry-run     # names + actions, no writes
 *   node scripts/op-import-dev-vars.mjs               # create/update items
 *   node scripts/op-import-dev-vars.mjs --write-template   # (re)generate the .tpl
 *   node scripts/op-import-dev-vars.mjs --keys-dir <dir>   # one-value-per-file mode
 *
 * ## ⚠️ The rule this file exists under
 *
 * **A value moves from the file into the vault and never anywhere else.** It is
 * held in this process's memory and handed to `op` over **stdin**, never argv:
 * `op item create --help` says so itself — *"Command arguments get logged in
 * your command history, and can be visible to other processes on your machine.
 * If you're assigning sensitive values, use a JSON template instead."* Same
 * argument, same conclusion, as `push-secrets.mjs`'s `spawnBulk`.
 *
 * Every line this script prints is a NAME and an ACTION. No value, no
 * fingerprint, no length. That is deliberately stricter than
 * `secrets:push`'s last-4 — there is no rotation here to tell apart.
 *
 * ## The item-title convention, and why it is not `<holder>/<NAME>`
 *
 * ⚠️ **A `/` cannot appear in an item title.** A secret reference is
 * `op://<vault>/<item>/[<section>/]<field>`, so `op://Estate/library/ANTHROPIC_API_KEY/password`
 * would parse as vault `Estate`, item `library`, section `ANTHROPIC_API_KEY`.
 * The separator is therefore a **dot**: `library.ANTHROPIC_API_KEY`.
 *
 * The axis is *"does this NAME identify exactly one value across the whole
 * estate?"*:
 *
 * | Title | When | Examples |
 * |---|---|---|
 * | `<NAME>` | one NAME, one value, however many holders | `HARDCOVER_API_TOKEN`, `PEER_TOKEN`, `ESTATE_APP_TOKEN_LIBRARY` |
 * | `<holder>.<NAME>` | the same NAME means a DIFFERENT value on another holder | `library.ANTHROPIC_API_KEY`, `library2.INDEX_READ_TOKEN` |
 *
 * ⚠️ **`ESTATE_APP_TOKEN_*` is deliberately BARE** even though
 * `push-secrets.mjs` classifies it per-instance. Those two lists answer
 * different questions: `PER_INSTANCE_SECRETS` asks *"may a bulk run send this to
 * her Worker?"* (no — hers is a different token), while the title asks *"does
 * this name identify one value?"* (yes — the instance is already in the SUFFIX,
 * `…_LIBRARY` vs `…_LIBRARY2`, and each is one value shared by its two holders).
 * Scoping them would produce `library.ESTATE_APP_TOKEN_LIBRARY`, which says the
 * instance twice and still would not be the estate-auth side's name.
 *
 * **Unclassified keys default to holder-scoped**, which is the safe direction: a
 * key nobody has decided about must never be mistaken for an estate-wide shared
 * value that a later session feels free to push somewhere else.
 *
 * ## Idempotent, and what it costs in `op` processes
 *
 * ⚠️ **Each `op` process can raise an authorization prompt in the desktop app
 * that a HUMAN must approve.** So the run is one Node process that spawns as few
 * `op` calls as it can: `1` (list the vault) `+ E` (read each item that already
 * exists, to tell `update` from `unchanged`) `+ C` (create/update the ones that
 * changed). On a first import into an empty vault, E is 0.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename, extname } from 'node:path';

import {
  LOCAL_ONLY,
  PRODUCTION_SECRETS,
  SHARED_SECRETS,
  assertNoGluedValues,
} from './push-secrets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The estate's vault. Created by the owner 2026-08-26; nothing else is touched. */
export const VAULT = 'Estate';

/** This repo's MAIN instance, as the estate directory knows it (`ESTATE_APP`). */
export const HOLDER = 'library';

/**
 * ⚠️ A dot, not a slash — a slash is the `op://vault/item/field` delimiter and
 * an item title containing one is unaddressable. See the header.
 */
export const TITLE_SEP = '.';

/**
 * Names that identify ONE value estate-wide despite not being on a shared list.
 *
 * `LIBRARYTHING_API_KEY` is one keyed vendor account for the household, exactly
 * like `GOOGLE_BOOKS_API_KEY` — it is merely unclassified in `push-secrets.mjs`
 * because no bulk run has ever needed to decide whether it may travel.
 */
export const BARE_EXTRA = ['LIBRARYTHING_API_KEY'];

/** Bare-titled iff the NAME is the whole identity of one value. */
export function isBareTitled(name) {
  if (name.startsWith('ESTATE_APP_TOKEN_')) return true;
  if (SHARED_SECRETS.includes(name)) return true;
  return BARE_EXTRA.includes(name);
}

/** `HARDCOVER_API_TOKEN` or `library.ANTHROPIC_API_KEY`. Never a slash. */
export function itemTitle(name, holder = HOLDER) {
  return isBareTitled(name) ? name : `${holder}${TITLE_SEP}${name}`;
}

/** The `op://` reference a template line carries. Names only — no value. */
export function secretRef(name, holder = HOLDER, vault = VAULT) {
  return `op://${vault}/${itemTitle(name, holder)}/password`;
}

/**
 * ⚠️ **Which holders receive this value** — the fact `§3.3` of the secrets
 * review could only assert in a table that goes stale. Written into the item's
 * notes so the vault item IS the custody record.
 *
 * Measured 2026-08-26 (`wrangler secret list`, names only) and from
 * `push-secrets.mjs`'s own lists.
 */
export const HOLDERS = {
  GOOGLE_BOOKS_API_KEY: 'library-catalog (main) + library-catalog-friend (padhard)',
  HARDCOVER_API_TOKEN: 'library-catalog (main) + library-catalog-friend (padhard)',
  DONOR_TOKEN:
    'library-catalog (main) + library-catalog-friend (padhard) — double duty: each instance both SENDS it to DONOR_URL and verifies it inbound',
  PEER_TOKEN: 'library-catalog (main) + library-catalog-friend (padhard)',
  EBOOK_INGEST_TOKEN:
    'library-catalog (main) + library-catalog-friend (padhard) + scripts/import-ebooks.mjs. ROUTE-ENABLING on the receiver',
  AUDIOBOOK_MAPPING_TOKEN:
    'library-catalog (main) + library-catalog-friend (padhard) + audiobook_catalog/.env as LIBRARY_MAPPING_TOKEN. ROUTE-ENABLING on the receiver',
  ESTATE_APP_TOKEN_LIBRARY: 'estate-auth (verifier) + library-catalog (main, presenter)',
  ESTATE_APP_TOKEN_LIBRARY2: 'estate-auth (verifier) + library-catalog-friend (presenter)',
  ESTATE_APP_TOKEN_DISCORD:
    'estate-discord (presenter) + library-catalog (main) + library-catalog-friend (verifiers). Also MAC key material for the confirm lane',
  ANTHROPIC_API_KEY: 'library-catalog (main) + catalog-index (the same value by design)',
  INDEX_READ_TOKEN: 'library-catalog (main) + catalog-index as INDEX_READ_TOKEN_LIBRARY',
  INDEX_PUSH_TOKEN: 'library-catalog (main) + catalog-index as INDEX_PUSH_TOKEN_LIBRARY',
  LIBRARYTHING_API_KEY: 'library-catalog (main) only',
};

/** What the notes field says when nothing more specific is known. */
export function holdersNote(name) {
  if (HOLDERS[name]) return HOLDERS[name];
  if (name in LOCAL_ONLY) {
    return `local dev only — ${LOCAL_ONLY[name]}. Not a credential; kept here so .dev.vars can be regenerated whole.`;
  }
  return 'holders not yet recorded — classify it in scripts/push-secrets.mjs and re-run this import.';
}

/** `credential` or `local-config`, so nobody mistakes a dev flag for key material. */
export function tagsFor(name) {
  const kind =
    name in LOCAL_ONLY || !(PRODUCTION_SECRETS.includes(name) || SHARED_SECRETS.includes(name) || HOLDERS[name])
      ? 'local-config'
      : 'credential';
  return ['estate', 'library_catalog', kind];
}

// ---------------------------------------------------------------------------
// The plan — pure, so the tests can prove the naming without `op` existing.
// ---------------------------------------------------------------------------

export const CREATE = 'create';
export const UPDATE = 'update';
export const UNCHANGED = 'unchanged';
export const SKIP_EMPTY = 'skip (empty)';

/**
 * ⚠️ **An EMPTY value is never imported.** The three empty lines in the main
 * `.dev.vars` are DROP-BOXES (`ANTHROPIC_API_KEY_FRIEND_SAM`,
 * `INDEX_READ_TOKEN_FRIEND_PADHARD`, `CLOUDFLARE_API_TOKEN_CI`) — a filled one
 * is an unfinished operation, never storage (`secrets.md` §"safe channels"), and
 * an empty one is the correct resting state. Storing an empty item would invite
 * a later session to treat the drop-box as a master.
 */
export function planImport(vars, existingTitles = [], holder = HOLDER) {
  const existing = new Set(existingTitles);
  const rows = [];
  for (const [name, value] of Object.entries(vars)) {
    const title = itemTitle(name, holder);
    if (!value) {
      rows.push({ name, title, action: SKIP_EMPTY });
      continue;
    }
    rows.push({ name, title, action: existing.has(title) ? UPDATE : CREATE });
  }
  return rows;
}

/** The item JSON `op` reads from stdin. The ONLY place a value is interpolated. */
export function itemTemplate(name, value, holder = HOLDER) {
  return {
    title: itemTitle(name, holder),
    category: 'PASSWORD',
    tags: tagsFor(name),
    fields: [
      { id: 'password', type: 'CONCEALED', purpose: 'PASSWORD', value },
      { id: 'notesPlain', type: 'STRING', purpose: 'NOTES', value: holdersNote(name) },
    ],
  };
}

/**
 * The generated `.dev.vars.tpl` — TRACKED, and safe in a PUBLIC repo because
 * every line is a NAME and a POINTER.
 *
 * Generated rather than hand-written so the titles here can never drift from the
 * titles the import creates: one implementation of `itemTitle`, two consumers.
 */
export function renderTemplate(names, emptyNames = [], holder = HOLDER, vault = VAULT) {
  const empty = new Set(emptyNames);
  const lines = [
    '# apps/worker/.dev.vars.tpl — GENERATED. Names + op:// pointers, never values.',
    '#',
    '# ⚠️ This file is TRACKED and this repo is PUBLIC. Every line below is a NAME',
    '# and a POINTER into the 1Password vault `' + vault + '`. Nothing here is secret.',
    '#',
    '# Regenerate `.dev.vars` from the vault:',
    '#   op inject -i apps/worker/.dev.vars.tpl -o apps/worker/.dev.vars',
    '#   npm run secrets:push                  # …then push',
    '#   rm apps/worker/.dev.vars              # …then DELETE it again',
    '#',
    '# Or never touch the disk at all — the push reads the vault directly:',
    '#   npm run secrets:push:op',
    '#',
    '# Regenerate THIS file (after adding a key to the vault):',
    '#   node scripts/op-import-dev-vars.mjs --write-template',
    '#',
    '# ⚠️ The blank lines at the bottom are DROP-BOXES, not gaps. A filled',
    '# drop-box is an unfinished operation, never storage — pipe it, then blank it.',
    '',
  ];
  for (const name of names) {
    if (empty.has(name)) continue;
    lines.push(`${name}={{ ${secretRef(name, holder, vault)} }}`);
  }
  if (emptyNames.length) {
    lines.push('');
    lines.push('# Drop-boxes — deliberately empty, deliberately NOT in the vault.');
    for (const name of emptyNames) lines.push(`${name}=`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// `op` — every value goes over stdin, never argv.
// ---------------------------------------------------------------------------

/**
 * ⚠️ `op` is installed by winget and is not on PATH in shells that predate the
 * install. Resolved by name first (so a PATH install wins), then at the winget
 * package path measured 2026-08-26.
 */
export const OP_FALLBACK =
  'C:\\Users\\nbasl\\AppData\\Local\\Microsoft\\WinGet\\Packages\\AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe\\op.exe';

export function opBinary(env = process.env) {
  return env.OP_CLI || (process.platform === 'win32' ? OP_FALLBACK : 'op');
}

/** Spawn `op`, optionally writing `stdin`. Resolves { code, stdout, stderr }. */
export function runOp(args, { stdin = null, bin = opBinary() } = {}) {
  return new Promise((res) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => res({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => res({ code, stdout, stderr }));
    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/**
 * ⚠️ **The authorization prompt is a HUMAN step, and its failure has a name.**
 * `op` reports `authorization prompt dismissed` / `authorization timeout` on
 * stderr and this is not a bug to retry blindly — somebody has to click Approve
 * in the 1Password desktop app.
 */
export function isAuthorizationRefusal(stderr = '') {
  return /authorization (prompt dismissed|timeout)|not currently signed in/i.test(stderr);
}

/** A sentence a person can act on — never a bare exit code. */
export function opFailureMessage(action, title, { code, stderr }) {
  if (isAuthorizationRefusal(stderr)) {
    return (
      `${action} ${title}: 1Password did not authorize the request. The desktop app ` +
      'raises an approval prompt for each `op` process — approve it (Touch ID / ' +
      'Windows Hello / your account password) and run this again. Nothing was written.'
    );
  }
  return `${action} ${title}: op exited ${code}. ${(stderr || '').trim().split('\n')[0] || 'No detail on stderr.'}`;
}

/**
 * ⚠️ **The argv for a create / an edit, built WITHOUT the value.**
 *
 * Exported so a test can assert the property directly rather than trusting the
 * call sites: whatever the value is, it cannot appear in a command line, a
 * process listing or a shell history, because it is not in this array. It goes
 * over stdin. (`op item create --help` gives this same instruction.)
 */
export function createArgs(vault = VAULT) {
  return ['item', 'create', '--vault', vault];
}
export function editArgs(title, vault = VAULT) {
  return ['item', 'edit', title, '--vault', vault];
}

/** Titles already in the vault. One `op` process. */
export async function listVaultTitles({ vault = VAULT, bin = opBinary(), run = runOp } = {}) {
  const r = await run(['item', 'list', '--vault', vault, '--format=json'], { bin });
  if (r.code !== 0) {
    throw new Error(
      opFailureMessage('list', vault, r) +
        '\n(This is the FIRST op call of the run — approving it usually covers the rest.)',
    );
  }
  const parsed = JSON.parse(r.stdout || '[]');
  return parsed.map((i) => ({ id: i.id, title: i.title }));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) await main();

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run') || argv.includes('--dry');
  const writeTemplate = argv.includes('--write-template');
  const flag = (n) => {
    const i = argv.findIndex((a) => a === n || a.startsWith(`${n}=`));
    if (i === -1) return null;
    return argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : (argv[i + 1] ?? null);
  };
  const holder = flag('--holder') || HOLDER;
  const vault = flag('--vault') || VAULT;
  const keysDir = flag('--keys-dir');

  // ⚠️ `--file` exists so this can run from a git WORKTREE, where `.dev.vars` is
  // gitignored and therefore absent. It is read-only and the glued-value guard
  // still applies; it is not a way to import an arbitrary file quietly, because
  // every run prints the path it read.
  const devVarsPath =
    flag('--file') || process.env.SECRETS_DEV_VARS || join(root, 'apps', 'worker', '.dev.vars');

  let vars;
  let source;
  if (keysDir) {
    ({ vars, source } = readKeysDir(keysDir));
  } else {
    source = devVarsPath;
    let raw;
    try {
      raw = readFileSync(devVarsPath, 'utf8');
    } catch {
      console.error(`No file at ${devVarsPath}. Nothing to import.`);
      console.error('Pass --file <path>, or set SECRETS_DEV_VARS, if you are in a worktree.');
      process.exit(1);
    }
    vars = parseAllPairs(raw);
  }

  console.log(`source: ${source}`);
  console.log(`vault:  ${vault}   holder: ${holder}`);

  // ⚠️ Before anything reaches the vault: a welded value is a broken FILE, and
  // importing one would make the vault the master of a corrupt string — the
  // 2026-08-25 incident, one layer deeper and permanent. Names only.
  try {
    assertNoGluedValues(
      Object.fromEntries(Object.entries(vars).filter(([, v]) => v)),
      source,
    );
  } catch (err) {
    console.error(err.message);
    console.error('');
    console.error('Nothing was imported. Fix the file first:');
    console.error('  tail -c1 <file> | od -c        # want \\n');
    process.exit(1);
  }

  const names = Object.keys(vars);
  const emptyNames = names.filter((n) => !vars[n]);

  if (writeTemplate) {
    const out = join(root, 'apps', 'worker', '.dev.vars.tpl');
    writeFileSync(out, renderTemplate(names, emptyNames, holder, vault), 'utf8');
    console.log(`\nwrote ${out} — ${names.length - emptyNames.length} references, ${emptyNames.length} drop-boxes.`);
    if (!argv.includes('--import')) return;
  }

  let existing = [];
  if (!dry) {
    existing = await listVaultTitles({ vault });
  } else {
    try {
      existing = await listVaultTitles({ vault });
    } catch (err) {
      console.error(`\n⚠️ Could not read the vault, so this plan cannot tell create from update.`);
      console.error(err.message);
    }
  }
  const byTitle = new Map(existing.map((i) => [i.title, i.id]));

  const plan = planImport(vars, [...byTitle.keys()], holder);
  for (const row of plan) {
    console.log(`  ${row.action.padEnd(14)} ${row.title}`);
  }

  if (dry) {
    console.log('\nDry run — the vault was not written to.');
    return;
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const failures = [];

  for (const row of plan) {
    if (row.action === SKIP_EMPTY) continue;
    const value = vars[row.name];
    const template = JSON.stringify(itemTemplate(row.name, value, holder));

    if (row.action === UPDATE) {
      // Read what is there now, so an unchanged value costs no write and no
      // version churn. `--reveal` is required for a CONCEALED field; the value
      // is compared in memory and never printed.
      const cur = await runOp(['read', `op://${vault}/${row.title}/password`]);
      if (cur.code === 0 && cur.stdout.replace(/\r?\n$/, '') === value) {
        console.log(`  ${UNCHANGED.padEnd(14)} ${row.title}`);
        unchanged++;
        continue;
      }
      const r = await runOp(editArgs(row.title, vault), { stdin: template });
      if (r.code !== 0) failures.push(opFailureMessage('update', row.title, r));
      else updated++;
      continue;
    }

    const r = await runOp(createArgs(vault), { stdin: template });
    if (r.code !== 0) failures.push(opFailureMessage('create', row.title, r));
    else created++;
  }

  console.log(
    `\ncreated ${created} · updated ${updated} · unchanged ${unchanged} · ` +
      `skipped ${plan.filter((r) => r.action === SKIP_EMPTY).length} empty · failed ${failures.length}`,
  );
  for (const f of failures) console.error(`  ⚠️ ${f}`);
  if (failures.length) process.exit(1);
}

/**
 * `NAME=value` including the EMPTY ones — `parseDevVars` drops those, and a
 * drop-box line must still appear in the template as a blank.
 */
export function parseAllPairs(text) {
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
    out[key] = value;
  }
  return out;
}

/**
 * ⚠️ **`--keys-dir` — the SECOND caller** (secrets review §5 step 2).
 * `catalog-platform/docs/access/keys/` holds one RAW VALUE per file, no `NAME=`.
 * The item title comes from the FILE NAME
 * (`estate-conductor-token.txt` → `ESTATE_CONDUCTOR_TOKEN`), and the values are
 * estate-wide singletons, so they are bare-titled.
 */
export function keyNameFromFile(filename) {
  return basename(filename, extname(filename)).replace(/[-\s.]+/g, '_').toUpperCase();
}

function readKeysDir(dir) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.txt'));
  const vars = {};
  for (const f of files) {
    // ⚠️ `keys/README.md` records "one value per file, no trailing newline".
    // Trim anyway: a trailing newline stored in the vault would be pushed to a
    // Worker and would not match, which is the worst kind of near-miss.
    vars[keyNameFromFile(f)] = readFileSync(join(dir, f), 'utf8').trim();
  }
  return { vars, source: `${dir} (${files.length} .txt files)` };
}
