#!/usr/bin/env node
/**
 * Stand up a THIRD (fourth, fifth…) library instance from an accepted
 * `catalog_request` row — the owner-run provisioner of
 * `catalog-platform/docs/info/request-a-catalog-design.md` §7.4, phase 7 of §10.
 *
 * ## 🔴 It is NEVER web-triggered
 *
 * The owner runs it on his own machine, with his own wrangler login, from a
 * clean tree. Accepting a request in `/admin` sets a status and nothing else
 * (design §1: *"Accept never deploys"*); this script is the thing a person runs
 * afterwards. There is no route, no queue consumer and no cron that reaches it,
 * and there must not be: it creates databases, buckets, hostnames and secrets.
 *
 *   npm run provision:catalog -- --request 4 --dry      # print everything, touch nothing
 *   npm run provision:catalog -- --request 4            # do it, stopping at each manual step
 *   npm run provision:catalog -- --request 4 --resume   # continue after a manual step
 *
 * ## What it does, in the order §7.2 fixes
 *
 * | # | Step | §7.3 ledger |
 * |---|---|---|
 * | 1 | D1 create (binding stays `DB`) | AUTO |
 * | 2 | R2 covers bucket + its public `COVERS_BASE_URL` | AUTO / ⚠️ console for the URL |
 * | 3 | The `[env.<instance>]` block, templated from `[env.friend]` | AUTO |
 * | 4 | The `package.json` script twins | AUTO |
 * | 5 | Commit the allowlist (never `git add -A`) | AUTO |
 * | 6 | `db:migrate:<instance>` — **migrate BEFORE deploy** | AUTO |
 * | 7 | ⏸ **PAUSE #1 — Firebase authorised domain** | 🔴 MANUAL |
 * | 8 | ⏸ **PAUSE #2 — auth-worker `CONSUMER_APPS` + `vis_` migration + deploy** | 🔴 MANUAL |
 * | 9 | Mint the paired estate token, set it on BOTH sides | AUTO (stdin) |
 * | 10 | Per-instance secrets, incl. `ANTHROPIC_API_KEY` | AUTO (stdin) |
 * | 11 | `deploy:<instance>` through the repo's own guards | AUTO |
 * | 12 | Verify `/api/health?cb=` and mark the request `live` | AUTO |
 *
 * ## ⚠️ The naming rule, and where it DIVERGES from the design doc
 *
 * Design §7.1 makes every permanent resource identity-neutral (env `third`, D1
 * `library-catalog-2nd`, bucket `library-2nd-covers`) so that only the HOSTNAME
 * carries identity and a rename costs one line. The brief for this build asks
 * instead that **the wrangler env be named from `desired_subdomain`**. Both are
 * honoured, split on which name is expensive to change:
 *
 * | Name | Source | Why |
 * |---|---|---|
 * | wrangler env / Worker name | **the sanitised subdomain** | a Worker CAN be renamed (a redeploy under a new env; the old one is deleted by hand), and the operator types this name a dozen times |
 * | D1 name, R2 bucket | **ordinal** (`library-catalog-3rd`, `library-3rd-covers`) | neither can be renamed at all, and a rehost of a live bucket is a data migration |
 * | estate app id, its token NAME, its `vis_` column | **ordinal** (`library3`) | it is a CONTRACT with another repo (`CONSUMER_APPS`, `appTokenFor()`, a migration), pinned per catalog, never per person or host |
 * | hostname | `<desired_subdomain>.heygabi.ai` | design §7.1 — the only identity-bearing name |
 *
 * `--instance <name>` overrides the derived env name for an owner who prefers
 * the doc's ordinal convention; nothing else about the run changes.
 *
 * ### The sanitiser, stated as a rule
 *
 * `desired_subdomain` is already `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` at the
 * route (design §3.3), but this script must not trust a value it did not
 * validate. So: lowercase → every run of anything but `[a-z0-9]` becomes one
 * `-` → leading/trailing `-` trimmed → refused if empty, longer than 30, a
 * wrangler-reserved word (`default`, `production`, `preview`, `dev`, `staging`,
 * `local`, `test`, `none`), or the name of an `[env.*]` block that already
 * exists. 30 rather than 40 because the Worker name is `library-catalog-<env>`
 * and Cloudflare caps that at 63.
 *
 * ## ⚠️ `ANTHROPIC_API_KEY` — three sources, resolved HERE and nowhere else
 *
 * There is exactly ONE `ANTHROPIC_API_KEY` per instance, so precedence is not a
 * runtime rule — it is decided by which plaintext this script pipes into that
 * one secret (design §6.4). In order:
 *
 * | # | Source | What is logged | The row |
 * |---|---|---|---|
 * | 1 | the requester's sealed envelope, `reader/<id>.json` | `reader key used` | `reader_key_set` stays as the ROUTE set it |
 * | 2 | the owner's sealed envelope from Accept, `owner/<id>.json` | `owner-at-accept key used` | `owner_key_set = 1` |
 * | 3 | the owner's own local key | `owner key used — standing decision 2026-09-05` | `owner_key_set = 1` |
 *
 * Rows 1 and 2 are done by `catalog-platform/scripts/lib/catalog-seal.mjs`,
 * which fetches the envelope from the private R2 bucket, decrypts it in memory
 * with the provisioning private key on this machine, and pipes the plaintext
 * straight to `wrangler secret put` over stdin. ⚠️ **It returns a WORD, not a
 * value** — `{source: 'reader'|'owner'|'none'}` — so nothing here can print a
 * key even by accident, and there is no decrypt-to-READ path anywhere in the
 * estate (design §6.2). Row 3 is the fallback and it is the owner's standing
 * choice, on the record: *"Have it fall back to my Claude key for now"* (owner,
 * 2026-09-05 ~07:03 Phoenix).
 *
 * ⚠️ If the platform repo's seal lib is ABSENT this script SAYS SO and falls
 * through to row 3, rather than failing a whole provision over a file that is
 * only needed when somebody attached a key.
 *
 * 🔴 **Two consequences the operator is told about out loud whenever row 3
 * fires, because they are spend, not configuration:**
 *
 *  1. the new instance's hourly `"7 * * * *"` details sweep runs donor-then-AI
 *     and will spend that key every tick the donor cannot fully answer;
 *  2. `BILLING_POLICY` ships `"off"`, matching both existing instances, so
 *     nothing throttles it until the owner writes a rule.
 *
 * ⚠️ **The key's VALUE is never read by a person, never printed, never logged
 * and never written to disk.** This script reads `apps/worker/.dev.vars` — the
 * documented single source of truth (`push-secrets.mjs:141`) — in code, and pipes
 * what it finds straight to `wrangler secret put … ` over **stdin, never argv**
 * (`push-secrets.mjs:655–673`: *"so they never reach a process list"*).
 *
 * ⚠️ **`push-secrets.mjs`'s refusal lists are IMPORTED, not re-stated.**
 * `PER_INSTANCE_SECRETS` (`:314`) and `PER_INSTANCE_PREFIXES` (`:317`) are the
 * mechanical guard design §6.4 says must not be weakened, so a new instance gets
 * `SHARED_ALWAYS` and nothing else by default: `EBOOK_INGEST_TOKEN` and
 * `AUDIOBOOK_MAPPING_TOKEN` are route-ENABLING and need `--enable NAME`, and
 * every `ESTATE_APP_TOKEN_*` / `INDEX_*_TOKEN` is refused with the same sentence
 * a bulk push prints.
 *
 * ## `--dry` vs `--resume`, and why a plain run is neither
 *
 * - **`--dry`** prints the derivation, every step, every command it WOULD run
 *   (a piped secret shows as `<stdin>`), and the whole manual runbook. It reads
 *   D1 and reads the Firebase domain list; it writes nothing anywhere — no
 *   wrangler write, no file edit, no commit, no mint.
 * - **a plain run STOPS** when it finds an artifact that already exists. A D1
 *   named `library-catalog-3rd` that this run did not create is either a
 *   half-finished provision or somebody else's database, and quietly adopting it
 *   is how a new catalog ends up bound to the wrong data.
 * - **`--resume`** is the word that says *"yes, that was me"*: existing
 *   artifacts are skipped with a line naming each, and the two manual pauses are
 *   VERIFIED rather than announced (§7.4: *"any script that mints into a custody
 *   store and then does something fallible needs a resume path"*).
 *
 * ⚠️ **The manual steps are PAUSES, not silent skips** (§7.4 point 2). Each
 * prints a numbered, copy-pasteable runbook with exact paths and the exact diff
 * shape, and then stops the run.
 *
 * ### What `--resume` can actually MEASURE, and what it can only assert
 *
 * | Pause | Checked by | Strength |
 * |---|---|---|
 * | #1 Firebase authorised domain | `GET identitytoolkit.googleapis.com/v1/projects?key=<the public web key>` → `authorizedDomains[]` | 🟢 **a real measurement** — the console's own list, read live |
 * | #2 auth-worker registration | the app id in `CONSUMER_APPS`, a `case '<app>'` in `appTokenFor()`, a `vis_<app>` migration file — all read out of the sibling `catalog-platform` checkout | 🟡 **source, not production** — it proves the code is written, NOT that the auth Worker was migrated and deployed |
 * | #2 (deployed half) | nothing | 🔴 **unmeasurable from here.** `second-instance.md`'s three levels apply: only a real sign-in tailed with `"src":"seen"` proves the pairing |
 *
 * A check that cannot be made is SAID rather than assumed — the run prints what
 * it could not verify before it continues.
 *
 * ## Where the request row lives, and why wrangler reaches it from another repo
 *
 * The row is in the ESTATE directory D1 — `estate_auth`, binding `DB`, in
 * `catalog-platform/apps/auth-worker/wrangler.toml` — because the request exists
 * *before any catalog exists* (design §3.1). This script spawns wrangler with
 * `cwd` set to that Worker's directory, exactly as an operator would, so the
 * config it picks up is that repo's and no path of ours can leak into it. The
 * checkout is found by `scripts/lib/platform-repo.mjs`, the same resolver the
 * universes build already uses.
 *
 * ⚠️ **`wrangler d1 execute --command` takes no bound parameters**, so the
 * request id is interpolated — and is therefore forced through
 * `Number.isSafeInteger` first. Nothing else from the row is ever interpolated
 * into SQL except through `sqlLit()`.
 *
 * ## What this script deliberately does NOT do
 *
 * - **`kind = 'games'`** — refused with a message pointing at design §8, exit 2.
 *   The board-game repo has no `[env.*]` block, no script twin and a hard-coded
 *   estate identity; provisioning one is a build in another repo, not a run.
 * - **`PEERS` stays `[]`.** Peer reciprocity would let a new person's catalog
 *   read the owner's holdings, which is access-INCREASING and therefore the
 *   owner's explicit call, never a default. It is printed as a follow-up.
 * - **No auth-worker migration is applied.** The directory database is never
 *   migrated unattended (§7.4 point 5).
 * - **No `.dev.vars.<instance>` is created, ever** (`push-secrets.mjs:102`).
 */

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolvePlatformRepo } from './lib/platform-repo.mjs';
import {
  SHARED_ALWAYS,
  SHARED_OPT_IN,
  assertNoGluedValues,
  isPerInstance,
  optInReason,
  parseDevVars,
  perInstanceReason,
} from './push-secrets.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_TOML = join(ROOT, 'apps', 'worker', 'wrangler.toml');
const ROOT_PKG = join(ROOT, 'package.json');
const WORKER_PKG = join(ROOT, 'apps', 'worker', 'package.json');
const WRANGLER_BIN = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
/** Same override, same reason, as `push-secrets.mjs:141` — a git worktree has no `.dev.vars`. */
const DEV_VARS = process.env.SECRETS_DEV_VARS || join(ROOT, 'apps', 'worker', '.dev.vars');

/** The estate directory database (design §3.1). */
export const ESTATE_DB = 'estate_auth';
export const APEX = 'heygabi.ai';
/** Shared by every catalog — one Google account is one person estate-wide (§7.2 step 4). */
export const FIREBASE_PROJECT = 'audiobook-catalog';
/**
 * The Firebase WEB api key. Public by design (it identifies a project, it does
 * not authorise anything) and already a build constant in the shipped bundle —
 * `apps/web/src/lib/firebase.ts:56`. It is here so PAUSE #1 can be MEASURED
 * rather than asserted; `VITE_FIREBASE_API_KEY` overrides it, as it does there.
 */
const FIREBASE_WEB_KEY =
  process.env.VITE_FIREBASE_API_KEY || 'AIzaSyDgAblkxzVxl7nFbd7jXOo6PpuNPsJw11Y';

/** The main library — the new instance's donor, and its `PEERS` are deliberately empty. */
const MAIN_ORIGIN = 'https://library.heygabi.ai';
const ESTATE_AUTH_URL = 'https://auth.heygabi.ai';
const INDEX_URL = 'https://index.heygabi.ai';

// ---------------------------------------------------------------------------
// Pure helpers — everything below this line up to `main()` is testable with no
// wrangler, no network and no filesystem beyond what a caller hands it.
// ---------------------------------------------------------------------------

/**
 * Wrangler env names that would collide with something else's meaning.
 * ⚠️ `friend` is on the list because it is TAKEN, not because it is reserved —
 * the existing-env check catches it too, and the belt-and-braces duplicate is
 * cheap next to a run that deploys over padhard.
 */
export const RESERVED_INSTANCE_NAMES = [
  'default',
  'production',
  'preview',
  'dev',
  'development',
  'staging',
  'local',
  'test',
  'none',
  'friend',
];

/** The Worker is `library-catalog-<env>` and Cloudflare caps a Worker name at 63. */
export const INSTANCE_MAX = 30;

/**
 * A wrangler env name from a requested subdomain. See the header's rule table.
 *
 * @returns {{ name: string, changed: boolean }}
 * @throws  {Error} worded for a person: what happened, what it needs, how to fix.
 */
export function sanitiseInstanceName(subdomain, { existingEnvs = [] } = {}) {
  if (typeof subdomain !== 'string' || !subdomain.trim()) {
    throw new Error(
      'The request has no desired_subdomain, so there is no name to derive an ' +
        'instance from. Fix the row, or pass --instance <name>.',
    );
  }
  const name = subdomain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!name) {
    throw new Error(
      `"${subdomain}" has no letters or digits in it, so it cannot name a wrangler ` +
        'environment. Pass --instance <name> with something a Worker can be called.',
    );
  }
  if (name.length > INSTANCE_MAX) {
    throw new Error(
      `"${name}" is ${name.length} characters; an instance name is capped at ${INSTANCE_MAX} ` +
        `because the Worker is called library-catalog-<instance> and Cloudflare stops at 63. ` +
        'Pass a shorter --instance <name>.',
    );
  }
  if (RESERVED_INSTANCE_NAMES.includes(name)) {
    throw new Error(
      `"${name}" is a reserved wrangler environment name, so a block called [env.${name}] ` +
        'would mean something other than "this catalog". Pass --instance <name>.',
    );
  }
  if (existingEnvs.includes(name)) {
    throw new Error(
      `[env.${name}] already exists in apps/worker/wrangler.toml. That is either a ` +
        'half-finished provision — re-run with --resume — or a different catalog. ' +
        'Pass --instance <name> for a new one.',
    );
  }
  return { name, changed: name !== subdomain };
}

/** `3` → `3rd`. Used for the two names that can never be renamed. */
export function ordinalWord(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

/** Every `[env.<name>]` / `[env.<name>.x]` / `[[env.<name>.x]]` in a wrangler.toml. */
export function parseEnvNames(toml) {
  const found = new Set();
  for (const m of toml.matchAll(/^\s*\[{1,2}env\.([A-Za-z0-9_-]+)[\].]/gm)) found.add(m[1]);
  return [...found].sort();
}

/** Every `ESTATE_APP = "…"` value already claimed in this repo's config. */
export function parseEstateApps(toml) {
  const found = new Set();
  for (const m of toml.matchAll(/^\s*ESTATE_APP\s*=\s*"([^"]+)"/gm)) found.add(m[1]);
  return [...found].sort();
}

/**
 * The next free `library<N>` estate app id, and the N behind it.
 *
 * ⚠️ N is ALSO the ordinal for the D1 and the bucket, deliberately: one number
 * per catalog means the three names that must never be renamed cannot drift
 * apart, and `library3` / `library-catalog-3rd` / `library-3rd-covers` read as
 * one thing on a console page listing all of them.
 */
export function nextEstateApp(estateApps) {
  const taken = new Set(estateApps);
  // `library` is instance 1 and carries no digit — the estate's own convention.
  for (let n = 2; n < 100; n++) {
    if (!taken.has(`library${n}`)) return { app: `library${n}`, n };
  }
  throw new Error('No free library<N> estate app id below 100 — that is a design problem, not a bug.');
}

/** ⚠️ Refuse anything that is not a BOOKS request that the owner has accepted. */
export function assertProvisionable(row) {
  if (!row || typeof row !== 'object') {
    throw Object.assign(new Error('No request row was found for that --request id.'), { code: 1 });
  }
  if (row.kind === 'games') {
    throw Object.assign(
      new Error(
        'This is a GAMES request, and there is no games provisioning path yet.\n\n' +
          'boardbuddy/Board_Game_Catalog is single-instance today: zero [env.*] blocks, no\n' +
          'script twins, no scripts/lib/d1.mjs, and its estate identity is hard-coded\n' +
          "(apps/worker/src/env.ts:141 reads a fixed ESTATE_APP_TOKEN_GAMES), so a second\n" +
          'games instance would silently assert the FIRST one\'s identity — the exact bug\n' +
          'this library shipped and ran with for months.\n\n' +
          'What it needs first is catalog-platform/docs/info/request-a-catalog-design.md §8\n' +
          'items 1–3 (build phase 8): instance-aware guards, ESTATE_APP lifted out of\n' +
          'source with a same-id build guard, then the first [env.*] block.\n\n' +
          'Accepting a games request is fine; provisioning one is a build in another repo.',
      ),
      { code: 2 },
    );
  }
  if (row.kind !== 'books') {
    throw Object.assign(
      new Error(
        `kind = "${row.kind}" is not a kind this estate knows. The schema's CHECK allows ` +
          "'books' and 'games' only — a row outside that is data corruption, not a request.",
      ),
      { code: 2 },
    );
  }
  if (row.status !== 'accepted') {
    throw Object.assign(
      new Error(
        `Request ${row.id} is "${row.status}", and only an ACCEPTED request can be provisioned.\n` +
          (row.status === 'pending'
            ? '  It is still waiting on the owner: accept it at https://heygabi.ai/admin/ first.\n'
            : row.status === 'live'
              ? '  It is already live' +
                (row.provisioned_host ? ` at https://${row.provisioned_host}` : '') +
                '. Nothing to do.\n'
              : '  A declined or cancelled request is not re-provisioned; the requester files a new one.\n'),
      ),
      { code: 2 },
    );
  }
  return row;
}

/**
 * Everything derived from the row. Nothing here is ever asked of a person.
 *
 * ⚠️ `forceEstateApp` is what makes `--resume` safe. A resumed run reads a
 * wrangler.toml that ALREADY contains this instance's `ESTATE_APP = "library3"`,
 * so `nextEstateApp` would hand back `library4` and the second half of the run
 * would mint a bearer under a name the first half never used. On a resume the
 * caller reads the id back out of the existing block and pins it here.
 */
export function deriveNames(
  row,
  { envNames = [], estateApps = [], instance = null, forceEstateApp = null } = {},
) {
  const subdomain = String(row.desired_subdomain || '').trim();
  const inst = instance
    ? sanitiseInstanceName(instance, { existingEnvs: envNames })
    : sanitiseInstanceName(subdomain, { existingEnvs: envNames });
  const next = nextEstateApp(estateApps);
  const estateApp = forceEstateApp || next.app;
  const n = forceEstateApp ? Number(forceEstateApp.replace(/^\D+/, '')) || next.n : next.n;
  const ord = ordinalWord(n);
  return {
    requestId: row.id,
    kind: row.kind,
    instance: inst.name,
    instanceWasSanitised: inst.changed,
    workerName: `library-catalog-${inst.name}`,
    host: `${subdomain}.${APEX}`,
    siteOrigin: `https://${subdomain}.${APEX}`,
    displayName: String(row.display_name || subdomain),
    requesterEmail: String(row.requester_email || '').trim().toLowerCase(),
    d1Name: `library-catalog-${ord}`,
    bucketName: `library-${ord}-covers`,
    estateApp,
    estateAppNumber: n,
    tokenName: `ESTATE_APP_TOKEN_${estateApp.toUpperCase()}`,
    visColumn: `vis_${estateApp}`,
    peerSelfId: inst.name,
  };
}

/** A TOML basic-string body: only `"` and `\` need escaping for our values. */
export function tomlString(value) {
  return `"${String(value).split('\\').join('\\\\').split('"').join('\\"')}"`;
}

/**
 * The `[env.<instance>]` block, templated from `[env.friend]`.
 *
 * 🔴 **Wrangler environments inherit NOTHING** — not `[vars]`, not bindings, not
 * routes, not triggers (design §7.1). Every field is restated here or it is
 * simply missing on the new Worker, which is why this is a whole block rather
 * than a diff and why `scripts/test/provision-catalog.test.mjs` asserts that
 * every var `[env.friend]` carries appears here too. That test is the guard: add
 * a var to the friend block and forget it here and the suite fails, instead of a
 * third instance quietly shipping without it.
 *
 * The values that are NOT copies of padhard's, and why:
 *
 * | Var | Here | Why not padhard's |
 * |---|---|---|
 * | `DEFAULT_THEME` | `apple` | the estate default (`info/estate-theme.md`); `hearts` is padhard's own, chosen by the owner for her |
 * | `GABI_PANEL` | `off` | GABI spends the key and is a per-instance owner decision; padhard's `on` was made explicitly for her |
 * | `OWNER_EMAILS` | the requester | design §7.2 step 9 option 1 — forced `owner` at every sign-in, so they cannot be locked out of their own shelf |
 * | `PEERS` | `[]` | letting a new catalog read the owner's holdings is access-INCREASING; it is a printed follow-up, never a default |
 * | `ESTATE_APP` | `library<N>` | its own consumer identity — the whole of the F-5 fix |
 */
export function renderEnvBlock(names, { coversBaseUrl, databaseId, ownerEmails, cron = '7 * * * *' }) {
  const i = names.instance;
  return `
# ═════════════════════════════════════════════════════════════════════════════
# THIRD-PARTY INSTANCE — ${names.displayName} · https://${names.host}
#
# Provisioned by scripts/provision-catalog.mjs from catalog_request
# #${names.requestId} (estate D1 \`${ESTATE_DB}\`). Runbook:
# docs/access/provision-catalog.md.
#
# ⚠️ NAMING (design §7.1, and this repo's own rule at [env.friend]): the
# HOSTNAME is the only identity-bearing name. The D1 \`${names.d1Name}\` and the
# bucket \`${names.bucketName}\` are ORDINAL and can never be renamed; the env
# name \`${i}\` is the operator-facing one and follows the subdomain.
#
# ⚠️ Wrangler environments inherit NOTHING. Every var below is restated on
# purpose — a missing line here is a missing value on the Worker, not a
# fallback to the top-level [vars].
#
# Deploy with \`npm run deploy:${i}\` (never a bare \`wrangler deploy --env ${i}\`
# — the npm script carries check-clean, deploy-guard and deploy-done).
# ═════════════════════════════════════════════════════════════════════════════

[env.${i}]
name = ${tomlString(names.workerName)}
workers_dev = true

# The same built PWA as every other instance — one product, N Workers.
[env.${i}.assets]
directory = "../web/dist"
binding = "ASSETS"

[[env.${i}.d1_databases]]
# ⚠️ The binding stays DB — NOT the name wrangler suggests in its copy-paste
# snippet. Every instance binds DB, which is also why scripts/lib/d1.mjs refuses
# a local run against a non-main instance.
binding = "DB"
database_name = ${tomlString(names.d1Name)}
database_id = ${tomlString(databaseId)}
# Shared with every instance: the new database is migrated from the same files.
migrations_dir = "../../migrations"

[[env.${i}.r2_buckets]]
binding = "COVERS"
bucket_name = ${tomlString(names.bucketName)}

# ⚠️ The SAME cron STRING as every other instance, deliberately: scheduled() in
# src/index.ts dispatches on DETAILS_SWEEP_CRON and an unrecognised cron does
# nothing at all. A different minute here is a details sweep that never runs.
#
# ⚠️ This tick SPENDS MONEY. The sweep is donor-then-AI, and this instance's
# ANTHROPIC_API_KEY is the OWNER'S key (standing decision 2026-09-05), so every
# tick the donor cannot fully answer is billed to him. BILLING_POLICY below is
# "off" like both existing instances, so nothing throttles it until a rule
# exists — write one at https://heygabi.ai/admin/ before this matters.
[env.${i}.triggers]
crons = ["${cron}"]

# ⚠️ Firebase: this host must be on Authentication → Settings → Authorised
# domains of the \`${FIREBASE_PROJECT}\` project BEFORE anyone relies on it, or
# Google sign-in fails auth/unauthorized-domain. custom_domain = true makes
# Cloudflare create and manage the DNS record and the certificate.
# ⚠️ This LAN negative-caches a new subdomain for ~30 min — a dead-looking host
# right after the deploy is the router, not the deploy. Test via workers.dev.
[[env.${i}.routes]]
pattern = ${tomlString(names.host)}
custom_domain = true

[env.${i}.vars]
APP_VERSION = "0.1.0"
ENVIRONMENT = "production"

# The estate default (info/estate-theme.md). padhard's "hearts" is HER default,
# chosen for her by the owner; a new catalog starts on the estate's own look and
# its owner changes it with the topbar cog.
DEFAULT_THEME = "apple"

# ⚠️ GABI is OFF on a new instance. Phase 0 is read-only, so switching her on
# risks nothing in the data — but she SPENDS THE KEY, and on this instance the
# key is the owner's. It gates the ROUTE as well as the panel (a worded 404,
# never a 403). Turning her on is one line and an owner decision.
GABI_PANEL = "off"
# Inert while GABI_PANEL is "off". Written out anyway, because the parse fails
# OPEN: a reader comparing two instances must not have to know that to compare
# them (the reasoning at [env.friend]'s own GABI_EDGE, applied verbatim).
GABI_EDGE = "full"

# The covers bucket's public base. ⚠️ BOTH the COVERS binding above AND this,
# or neither — the cover route refuses to write with only one.
# This is the launch tier (the managed r2.dev URL): it works, and it is
# rate-limited and uncacheable. Swap it for a bucket custom domain plus a 1-year
# Edge-TTL Cache Rule when the catalog is busy enough to care — safe only
# because object keys are content hashes, so a replaced cover is a new URL.
# ⚠️ A bucket custom domain belongs to exactly ONE bucket: bookcovers. and
# covers. are taken, so a third catalog needs a third name, checked free first.
COVERS_BASE_URL = ${tomlString(coversBaseUrl)}

# ⚠️ The SHARED Firebase project, immutable. Never a second project: sharing one
# is the entire mechanism by which one Google account is one person estate-wide.
FIREBASE_PROJECT_ID = ${tomlString(FIREBASE_PROJECT)}

# Design §7.2 step 9, option 1 (RECOMMENDED): the requester is forced \`owner\`
# at every sign-in, so they cannot be locked out of their own shelf and no
# post-sign-in promotion is needed. ⚠️ This differs from [env.friend] on
# purpose, where OWNER_EMAILS is the ESTATE owner's break-glass and the friend is
# admin through an app_user grant.
OWNER_EMAILS = ${tomlString(ownerEmails)}

# ── Donor-first details sweep ────────────────────────────────────────────────
# The main library answers what it already knows, for free, BEFORE any AI
# lookup — the owner's *"if I have Stormlight Archive don't have her look it
# up"*. Needs the shared DONOR_TOKEN secret on both sides or the donor 404s.
# ⚠️ Reciprocity is NOT set: the main instance has no DONOR_URL pointing here,
# and adding one is a separate owner decision.
DONOR_URL = ${tomlString(MAIN_ORIGIN)}

# ── Cross-library peer push (migration 0370) ─────────────────────────────────
# ⚠️ PEERS IS EMPTY, DELIBERATELY. A peer entry lets this catalog read another
# household's holdings, which is access-INCREASING and therefore an explicit
# owner decision, never a provisioning default. Adding one is a line here plus
# an entry in every existing instance's PEERS and a redeploy of each.
PEER_SELF_ID = ${tomlString(names.peerSelfId)}
PEER_SELF_LABEL = ${tomlString(names.displayName)}
SITE_ORIGIN = ${tomlString(names.siteOrigin)}
PEERS = "[]"

# ── The estate index ─────────────────────────────────────────────────────────
# READ (free-details ladder rung 2) needs INDEX_READ_TOKEN, which is per-APP and
# deliberately UNSET here, so this host is inert. PUSH additionally needs
# INDEX_PUSH_TOKEN, also unset — federation labels rows on a shelf other people
# can see, and that is its own decision.
INDEX_URL = ${tomlString(INDEX_URL)}

# Estate auth, same posture as both existing instances. ⚠️ Until
# ${names.tokenName} is set on THIS env the gate logs
# estate_config_unset and behaves as OFF — local auth only, nobody locked out,
# new sign-ins land \`pending\`. Code before secret is the safe order.
ESTATE_CHECK = "enforce"
ESTATE_AUTH_URL = ${tomlString(ESTATE_AUTH_URL)}

# ── THIS instance is \`${names.estateApp}\` ────────────────────────────────────
# Its own estate consumer: its own bearer (${names.tokenName}),
# its own \`seen:${names.estateApp}\` origin on a newcomer's directory row, and the
# ${names.visColumn} column in the auth Worker (DEFAULT 0 — another household's
# shelf, granted by hand).
# ⚠️ Setting this to anything another instance uses is an identity change at the
# directory; packages/estate-auth/test/instance-estate-app.test.ts refuses it.
ESTATE_APP = ${tomlString(names.estateApp)}

# ── SPENDING POLICY ──────────────────────────────────────────────────────────
# ⚠️ Its OWN switch, keyed on ESTATE_APP above: a switch pressed for \`library\`
# must not reach this catalog. "off" matches both existing instances; the flip
# to "shadow" then "enforce" is one line and its own commit (the gate test reads
# this file and fails unless it says what it is supposed to say).
BILLING_POLICY = "off"
`;
}

/** The three root-package twins §7.2 step 10 asks for, mirroring the `:friend` triple. */
export function rootScriptTwins(instance) {
  return {
    [`predeploy:${instance}`]: `node scripts/check-clean.mjs && node scripts/deploy-guard.mjs --instance=${instance} && npm run test`,
    [`deploy:${instance}`]: `npm run build && npm run deploy:${instance} --workspace @lc/worker`,
    [`postdeploy:${instance}`]: `node scripts/deploy-done.mjs --instance=${instance}`,
  };
}

/** The worker-package twins. `db:migrate:<i>` is what makes migrate-before-deploy runnable. */
export function workerScriptTwins(instance, d1Name) {
  return {
    [`deploy:${instance}`]: `wrangler deploy --env ${instance}`,
    [`db:migrate:${instance}`]: `wrangler d1 migrations apply ${d1Name} --remote --env ${instance}`,
    [`tail:${instance}`]: `wrangler tail --env ${instance}`,
  };
}

/**
 * Insert new script keys immediately after an anchor key, so the twins read as a
 * group instead of landing at the bottom of the object.
 * @returns {{ scripts: object, added: string[] }}
 */
export function insertScripts(scripts, additions, afterKey) {
  const added = Object.keys(additions).filter((k) => !(k in scripts));
  if (!added.length) return { scripts, added };
  const out = {};
  let done = false;
  for (const [k, v] of Object.entries(scripts)) {
    out[k] = v;
    if (k === afterKey) {
      for (const name of added) out[name] = additions[name];
      done = true;
    }
  }
  if (!done) for (const name of added) out[name] = additions[name];
  return { scripts: out, added };
}

/** A SQL string literal — doubling the quote is the whole of SQLite's escaping. */
export function sqlLit(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`refusing to write ${value} as a number`);
    return String(value);
  }
  return `'${String(value).split("'").join("''")}'`;
}

/**
 * The mark-live UPDATE, as a pure function of the names and the KEY SOURCE.
 *
 * ⚠️ EXTRACTED SO THE BOOLEANS ARE TESTABLE. They are a claim about custody —
 * "whose money does this catalog spend" — and until this was a function the
 * statement hard-coded `owner_key_set = 1` for every run, which is now wrong in
 * exactly the case the sealed-key feature exists for.
 *
 * | source | what this writes | why |
 * |---|---|---|
 * | `'reader'` | NEITHER boolean | `reader_key_set` was set by the ROUTE when the envelope was stored; re-asserting it here would be a second writer of one fact, and setting `owner_key_set` would be a lie |
 * | `'owner'` | `owner_key_set = 1` | the owner's Accept-time key; the route set it too, and this is idempotent |
 * | `'none'` | `owner_key_set = 1` | design §6.4 row 3 — the owner's own key, his standing decision |
 *
 * The `AND status = 'accepted'` guard is what makes a re-run safe: a row that is
 * already `live` matches nothing and the statement reports `changes: 0`.
 */
export function markLiveUpdate(names, keySource = 'none') {
  const sets = [
    `status = 'live'`,
    `provisioned_instance = ${sqlLit(names.instance)}`,
    `provisioned_host = ${sqlLit(names.host)}`,
  ];
  if (keySource !== 'reader') sets.push('owner_key_set = 1');
  return (
    `UPDATE catalog_request SET ${sets.join(', ')} ` +
    `WHERE id = ${names.requestId} AND status = 'accepted'`
  );
}

/**
 * Load `catalog-platform/scripts/lib/catalog-seal.mjs`, or return null.
 *
 * ⚠️ A DYNAMIC import, and `pathToFileURL` is not optional: Node's ESM loader
 * reads a bare Windows path as a URL scheme (`C:` looks like a protocol), the
 * same trap `lib/platform-repo.mjs` records for the universes lib.
 *
 * ⚠️ AND IT RETURNS NULL RATHER THAN THROWING. The seal lib is only needed when
 * somebody attached a key; a checkout of this repo beside an older
 * catalog-platform must still be able to provision, saying out loud that it
 * cannot look for envelopes rather than dying at step 10 of 12.
 */
export async function loadSealLib(platformDir, { log = console.log } = {}) {
  const path = join(platformDir, 'scripts', 'lib', 'catalog-seal.mjs');
  if (!existsSync(path)) {
    log(`  ⚠️ no sealed-key lib at ${path}`);
    log('     Nobody\'s attached key can be read, so this run falls back to the owner\'s own key.');
    return null;
  }
  return import(pathToFileURL(path).href);
}

/**
 * Pull the JSON array out of wrangler `--json` output.
 *
 * ⚠️ Copied from `scripts/lib/d1.mjs:224` rather than imported, because that
 * module hard-codes the two LIBRARY databases and the row this reads is in
 * another repo's D1. Its two lessons are copied with it: slice to the true
 * matching bracket (a trailing deprecation notice breaks a naive parse), and try
 * the next `[` when one does not parse (a warning containing a bracket wins
 * otherwise). Both were real failures there.
 */
export function extractJsonArray(out) {
  for (let i = out.indexOf('['); i >= 0; i = out.indexOf('[', i + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < out.length; j++) {
      const ch = out[j];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(out.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error(`could not find a JSON array in wrangler output. First 500 chars:\n${out.slice(0, 500)}`);
}

/** The numbered manual runbook — printed by `--dry`, and at each pause. */
export function manualRunbook(names, { platformDir = '<catalog-platform>' } = {}) {
  // Forward slashes throughout, so a path is copy-pasteable into either shell on
  // this machine — Git Bash chokes on a backslash, PowerShell accepts both.
  const dir = String(platformDir).replace(/\\/g, '/');
  const authSrc = `${dir}/apps/auth-worker/src/env.ts`;
  return [
    `⏸  PAUSE #1 — Firebase authorised domain  (🔴 MANUAL, checkpoint #1)`,
    ``,
    `    Nothing can script this: the authorised-domain list is Identity Platform`,
    `    admin config and firebase-tools has no command for it.`,
    ``,
    `      1. https://console.firebase.google.com/project/${FIREBASE_PROJECT}/authentication/settings`,
    `      2. Authorised domains → Add domain → ${names.host}`,
    `      3. ⚠️ Do NOT create a second Firebase project. One project is the whole`,
    `         mechanism by which one Google account is one person estate-wide.`,
    ``,
    `    Verified on --resume by reading the list back live, so this one is a`,
    `    measurement rather than a promise.`,
    ``,
    `⏸  PAUSE #2 — auth-worker consumer registration  (🔴 MANUAL, checkpoint #2)`,
    ``,
    `    It touches CONSUMER_APPS, which is a security surface, and it migrates the`,
    `    estate directory database. Neither is done unattended.`,
    ``,
    `    a) ${authSrc}:4 — add the app id`,
    ``,
    `         -export const CONSUMER_APPS = ['library', 'games', 'index', 'audiobook', 'library2'] as const;`,
    `         +export const CONSUMER_APPS = ['library', 'games', 'index', 'audiobook', 'library2', '${names.estateApp}'] as const;`,
    ``,
    `    b) ${authSrc} — declare the bearer in Env (the block at :107–184)`,
    ``,
    `         +  /** The ${names.displayName} catalog's /seen bearer. Same NAME on both sides. */`,
    `         +  ${names.tokenName}?: string;`,
    ``,
    `    c) ${authSrc}:478–491 — a case arm in appTokenFor()`,
    ``,
    `         +    case '${names.estateApp}':`,
    `         +      return env.${names.tokenName};`,
    ``,
    `    d) ${authSrc}:349 — add the column to EstateUserRow, beside vis_library2 (:390)`,
    ``,
    `         +  ${names.visColumn}: number;`,
    ``,
    `    e) a new migration, following 0007_vis_library2.sql — ⚠️ DEFAULT 0, the`,
    `       deliberate opposite of 0002's DEFAULT 1, because it is another`,
    `       household's shelf and is granted by hand:`,
    ``,
    `         ${dir}/apps/auth-worker/migrations/00NN_${names.visColumn}.sql`,
    `         ALTER TABLE estate_user ADD COLUMN ${names.visColumn} INTEGER NOT NULL DEFAULT 0;`,
    ``,
    `       ⚠️ Check the directory for the next free number first — 0018 was taken`,
    `       by catalog_request, and number drift is what 0017's own header records.`,
    ``,
    `    f) migrate the directory D1, THEN deploy the auth Worker (in that order):`,
    ``,
    `         cd ${dir}/apps/auth-worker`,
    `         npx wrangler d1 migrations apply ${ESTATE_DB} --remote`,
    `         npx wrangler deploy`,
    ``,
    `    On --resume this script reads (a), (c) and (e) out of the source and says`,
    `    so. ⚠️ It CANNOT see whether the Worker was migrated and deployed — only a`,
    `    real sign-in tailed with "src":"seen" proves the pairing.`,
    ``,
    `📋 AFTERWARDS — follow-ups this script deliberately does not take`,
    ``,
    `      • PEERS is "[]" on the new instance and no existing instance names it.`,
    `        Peering is access-INCREASING (it reads another household's holdings)`,
    `        and is the owner's explicit call: a line in each instance's PEERS and`,
    `        a redeploy of every one of them.`,
    `      • BILLING_POLICY is "off" and the hourly sweep spends the OWNER'S`,
    `        Anthropic key. Write a rule at https://heygabi.ai/admin/ before that`,
    `        matters, or drop [env.${names.instance}.triggers] to stop the tick.`,
    `      • COVERS_BASE_URL is the rate-limited r2.dev tier. A bucket custom`,
    `        domain plus a 1-year Cache Rule is the upgrade, and it needs a third`,
    `        covers hostname — bookcovers. and covers. are taken.`,
    `      • The requester's own sealed Claude key (design §6) is a later phase.`,
    `        Until it lands this instance runs on the owner's key.`,
  ];
}

// ---------------------------------------------------------------------------
// Impure: process spawning, the filesystem, the network.
// ---------------------------------------------------------------------------

/**
 * One thing this run would do to the outside world.
 * `stdinSecret` is a NAME, never a value — the printer can never leak what it
 * cannot see, which is the point of keeping the two apart in the type.
 */
function cmd(label, { bin = WRANGLER_BIN, args, cwd = ROOT, stdinSecret = null }) {
  return { label, bin, args, cwd, stdinSecret };
}

function printCmd(c, prefix = '    ') {
  const head = c.bin === WRANGLER_BIN ? 'npx wrangler' : `node ${c.bin}`;
  const shown = [head, ...c.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(' ');
  console.log(`${prefix}$ ${shown}`);
  if (c.cwd !== ROOT) console.log(`${prefix}    (cwd: ${c.cwd})`);
  if (c.stdinSecret) {
    console.log(`${prefix}    ← <stdin>   ${c.stdinSecret} — the value is never printed, logged or written to disk`);
  }
}

/** Run wrangler and return stdout. Values, when there are any, go over stdin. */
function runWrangler({ bin = WRANGLER_BIN, args, cwd = ROOT }) {
  try {
    return execFileSync(process.execPath, [bin, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // ⚠️ wrangler on Windows prints its result and then sometimes exits non-zero
    // on a libuv teardown quirk (`scripts/lib/d1.mjs` header). So a non-zero exit
    // with usable stdout is not a failure; a real one has nothing parseable.
    const out = err?.stdout ?? '';
    if (typeof out === 'string' && out.trim()) return out;
    throw new Error(`wrangler failed: ${String(err?.stderr || err?.message || err).trim()}`);
  }
}

/** Pipe ONE value into `wrangler secret put`. Never argv, never a temp file. */
function putSecret(name, value, { env = null, cwd = ROOT, bin = WRANGLER_BIN, config = null }) {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        bin,
        'secret',
        'put',
        name,
        ...(config ? ['--config', config] : []),
        ...(env ? ['--env', env] : []),
      ],
      { cwd, stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.on('error', fail);
    child.stdin.end(value);
    child.on('exit', (code) => done(code));
  });
}

/** `wrangler secret bulk` over stdin — the push-secrets idiom, for the shared set. */
function bulkSecrets(payload, env) {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [WRANGLER_BIN, 'secret', 'bulk', '--config', WRANGLER_TOML, ...(env ? ['--env', env] : [])],
      { cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.on('error', fail);
    child.stdin.end(JSON.stringify(payload));
    child.on('exit', (code) => done(code));
  });
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function npmRun(script) {
  // Not `npm` directly: on Windows that is npm.cmd and Node refuses to spawn a
  // .cmd through execFile (the same trap deploy-done.mjs records). npm's own JS
  // entry is not reliably locatable, so this one goes through a shell with the
  // script name quoted — and the script name is derived from a name this file
  // sanitised, never from a raw row value.
  execFileSync('npm', ['run', script], { cwd: ROOT, stdio: 'inherit', shell: true });
}

// ---------------------------------------------------------------------------
// The estate directory D1 — reads and the one write, from the auth-worker dir.
// ---------------------------------------------------------------------------

const REQUEST_COLUMNS = [
  'id',
  'kind',
  'requester_email',
  'requester_display_name',
  'desired_subdomain',
  'display_name',
  'status',
  'provisioned_instance',
  'provisioned_host',
  'reader_key_set',
  'owner_key_set',
  'created_at',
].join(', ');

function estateSql(sql, { authWorkerDir, platformWrangler }) {
  const out = runWrangler({
    bin: platformWrangler,
    cwd: authWorkerDir,
    args: ['d1', 'execute', ESTATE_DB, '--remote', '--json', '--command', sql.replace(/\s+/g, ' ').trim()],
  });
  return extractJsonArray(out)[0]?.results ?? [];
}

function readRequest(id, ctx) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`--request ${id}: an id is a positive whole number.`);
  }
  return estateSql(
    `SELECT ${REQUEST_COLUMNS} FROM catalog_request WHERE id = ${id}`,
    ctx,
  )[0];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) await main();

function flagValue(argv, name) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return null;
  const v = argv[i].includes('=') ? argv[i].slice(`--${name}=`.length) : (argv[i + 1] ?? null);
  if (!v || v.startsWith('--')) {
    console.error(`--${name} needs a value.`);
    process.exit(1);
  }
  return v;
}

function heading(text) {
  console.log(`\n${text}`);
  console.log('─'.repeat(Math.min(text.length, 78)));
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry') || argv.includes('--dry-run');
  const resumeMode = argv.includes('--resume');
  const requestId = Number(flagValue(argv, 'request'));
  const fixture = flagValue(argv, 'fixture');
  const instanceOverride = flagValue(argv, 'instance');
  const coversFlag = flagValue(argv, 'covers-base-url');
  const ownerBreakGlass = argv.includes('--owner-break-glass');
  const enable = argv.filter((a) => a.startsWith('--enable=')).map((a) => a.slice('--enable='.length));
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--enable' && argv[i + 1]) enable.push(argv[i + 1]);

  if (!Number.isFinite(requestId)) {
    console.error('provision-catalog: --request <id> is required.');
    console.error('');
    console.error('  npm run provision:catalog -- --request 4 --dry');
    console.error('  npm run provision:catalog -- --request 4');
    console.error('  npm run provision:catalog -- --request 4 --resume');
    console.error('');
    console.error('The id is a catalog_request row in the estate directory D1.');
    process.exit(1);
  }
  for (const name of enable) {
    if (!SHARED_OPT_IN.includes(name)) {
      console.error(`--enable ${name}: not an opt-in key, so this flag would do nothing.`);
      console.error(`Opt-in keys: ${SHARED_OPT_IN.join(', ')}`);
      process.exit(1);
    }
  }

  const platform = resolvePlatformRepo();
  const ctx = {
    authWorkerDir: join(platform.dir, 'apps', 'auth-worker'),
    platformWrangler: join(platform.dir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  };
  if (!existsSync(ctx.platformWrangler)) ctx.platformWrangler = WRANGLER_BIN;

  console.log(`provision-catalog — request #${requestId}${dry ? '   [DRY RUN — nothing is written]' : ''}`);
  console.log(`  estate directory : ${ESTATE_DB} (${ctx.authWorkerDir})`);
  console.log(`  this repo        : ${ROOT}`);
  if (resumeMode) console.log('  mode             : --resume — existing artifacts are skipped, pauses are verified');

  /* ── the row ───────────────────────────────────────────────────────────── */

  let row;
  if (fixture) {
    // ⚠️ A fixture is for a DRY run only. It is how the ten steps and the
    // runbook are exercised before migration 0018 has been applied remotely —
    // never a way to provision against a row nobody accepted.
    if (!dry) {
      console.error('--fixture is a DRY-RUN aid only: a real provision reads the accepted row from D1.');
      process.exit(1);
    }
    row = JSON.parse(readFileSync(fixture, 'utf8'));
    console.log(`  request row      : ${fixture}  ⚠️ FIXTURE, not the live directory`);
  } else {
    try {
      row = readRequest(requestId, ctx);
    } catch (err) {
      console.error(`\nCould not read catalog_request #${requestId} from ${ESTATE_DB}.`);
      console.error(String(err.message).split('\n').slice(0, 6).join('\n'));
      console.error('');
      console.error('If the message says "no such table", migration 0018 has not been applied to');
      console.error(`the remote directory yet — that is phase 1's step, not this script's.`);
      process.exit(1);
    }
  }

  try {
    assertProvisionable(row);
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(err.code ?? 1);
  }

  /* ── derivation ────────────────────────────────────────────────────────── */

  const toml = readFileSync(WRANGLER_TOML, 'utf8');
  const envNames = parseEnvNames(toml);
  const estateApps = parseEstateApps(toml);
  // On a resume this instance's own [env.<name>] block is expected to be there
  // already, so it is not a collision — and its ESTATE_APP is pinned rather than
  // advanced. See deriveNames' forceEstateApp.
  const ownName = sanitiseSafe(row, instanceOverride);
  const resumingOwnBlock = resumeMode && ownName && envNames.includes(ownName);
  let names;
  try {
    names = deriveNames(row, {
      envNames: resumingOwnBlock ? envNames.filter((e) => e !== ownName) : envNames,
      estateApps,
      instance: instanceOverride,
      forceEstateApp: resumingOwnBlock ? existingVar(toml, ownName, 'ESTATE_APP') : null,
    });
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
  const ownerEmails = ownerBreakGlass
    ? `${names.requesterEmail},nbaslamking@gmail.com`
    : names.requesterEmail;

  heading('Derived — nothing here is asked of a person');
  const rows = [
    ['requester', `${row.requester_display_name || '—'} <${names.requesterEmail}>`],
    ['catalog name', names.displayName],
    ['hostname', `${names.host}   ← the only identity-bearing name`],
    ['wrangler env', `${names.instance}${names.instanceWasSanitised ? '   (sanitised from the subdomain)' : ''}`],
    ['Worker', names.workerName],
    ['D1', `${names.d1Name}   (binding DB, shared migrations_dir)`],
    ['R2 bucket', `${names.bucketName}   (binding COVERS)`],
    ['estate app id', names.estateApp],
    ['estate token', names.tokenName],
    ['visibility col', `${names.visColumn}   (auth-worker migration, DEFAULT 0)`],
    ['OWNER_EMAILS', ownerEmails],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(16)} ${v}`);

  if (!names.requesterEmail) {
    console.error('\nThe request row has no requester_email, so OWNER_EMAILS would be empty and');
    console.error('the requester could not sign into their own catalog. Fix the row first.');
    process.exit(1);
  }

  /* ── the steps ─────────────────────────────────────────────────────────── */

  const state = { databaseId: null, coversBaseUrl: coversFlag };
  const skipped = [];
  const notVerified = [];

  // Step 1 — D1
  heading('1 · D1 create + migrate   (§7.3: AUTO)');
  const existingD1 = dry && fixture ? null : findD1(names.d1Name);
  if (existingD1) {
    state.databaseId = existingD1;
    if (!resumeMode && !dry) {
      stop(
        `A D1 called ${names.d1Name} already exists (${existingD1}).`,
        'That is either a half-finished provision — re-run with --resume — or another',
        "catalog's database. Adopting it silently is how a new catalog ends up bound to",
        'the wrong data, so this run stops instead.',
      );
    }
    console.log(`  exists already   ${names.d1Name}  ${existingD1}${resumeMode ? '  — skipped (--resume)' : ''}`);
    skipped.push(`D1 ${names.d1Name}`);
  } else {
    printCmd(cmd('create', { args: ['d1', 'create', names.d1Name] }));
    if (!dry) {
      const out = runWrangler({ args: ['d1', 'create', names.d1Name] });
      state.databaseId = parseDatabaseId(out);
      if (!state.databaseId) {
        stop(
          `wrangler created ${names.d1Name} but no database_id could be read from its output.`,
          'Run `npx wrangler d1 list --json`, find the id, and re-run with --resume.',
        );
      }
      console.log(`  created          ${names.d1Name}  ${state.databaseId}`);
    } else {
      state.databaseId = '<database_id from wrangler d1 create>';
    }
  }
  console.log('  ⚠️ The binding stays DB, and migrations_dir is the shared ../../migrations.');

  // Step 2 — R2
  heading('2 · R2 covers bucket + COVERS_BASE_URL   (§7.3: AUTO / ⚠️ console for the URL)');
  const bucketExists = dry && fixture ? false : hasBucket(names.bucketName);
  if (bucketExists) {
    console.log(`  exists already   ${names.bucketName}${resumeMode ? '  — skipped (--resume)' : ''}`);
    if (!resumeMode && !dry) {
      stop(
        `An R2 bucket called ${names.bucketName} already exists.`,
        'Re-run with --resume if that was this provision; otherwise pick a free ordinal.',
      );
    }
    skipped.push(`R2 ${names.bucketName}`);
  } else {
    printCmd(cmd('create', { args: ['r2', 'bucket', 'create', names.bucketName] }));
    if (!dry) {
      runWrangler({ args: ['r2', 'bucket', 'create', names.bucketName] });
      console.log(`  created          ${names.bucketName}`);
    }
  }
  if (!state.coversBaseUrl) {
    const fromToml = existingCoversBaseUrl(toml, names.instance);
    if (fromToml) state.coversBaseUrl = fromToml;
  }
  if (!state.coversBaseUrl) {
    console.log('');
    console.log('  ⏸ The bucket has no public base URL yet, and enabling one is a console step.');
    console.log('');
    console.log(`      1. https://dash.cloudflare.com → R2 → ${names.bucketName} → Settings`);
    console.log('      2. Public access → R2.dev subdomain → Allow Access');
    console.log('      3. Copy the https://pub-….r2.dev URL');
    console.log('');
    console.log(`      then: npm run provision:catalog -- --request ${requestId} --resume \\`);
    console.log('              --covers-base-url https://pub-….r2.dev');
    console.log('');
    console.log('  ⚠️ BOTH the COVERS binding AND COVERS_BASE_URL, or neither — the cover route');
    console.log('     refuses to write with only one of them. So the block is not written yet.');
    if (dry) {
      state.coversBaseUrl = 'https://pub-<id>.r2.dev';
      console.log('  (dry run: continuing with a placeholder so the rest of the plan prints)');
    } else {
      await closeHttpPool();
      process.exit(3);
    }
  } else {
    console.log(`  COVERS_BASE_URL  ${state.coversBaseUrl}`);
  }

  // Step 3 — the toml block
  heading('3 · The [env.' + names.instance + '] block, templated from [env.friend]   (§7.3: AUTO)');
  const block = renderEnvBlock(names, {
    coversBaseUrl: state.coversBaseUrl,
    databaseId: state.databaseId,
    ownerEmails,
  });
  const blockPresent = envNames.includes(names.instance);
  if (blockPresent) {
    console.log(`  exists already   [env.${names.instance}] is in apps/worker/wrangler.toml — skipped`);
    skipped.push(`[env.${names.instance}]`);
  } else if (dry) {
    console.log(`  would append ${block.split('\n').length} lines to apps/worker/wrangler.toml:`);
    console.log('');
    for (const line of block.split('\n')) console.log(`    │ ${line}`);
  } else {
    const current = readFileSync(WRANGLER_TOML, 'utf8');
    writeFileSync(WRANGLER_TOML, `${current.replace(/\n*$/, '\n')}${block}`, 'utf8');
    console.log(`  appended         [env.${names.instance}] → apps/worker/wrangler.toml`);
  }

  // Step 4 — package.json twins
  heading('4 · package.json script twins   (§7.3: AUTO)');
  const rootAdd = rootScriptTwins(names.instance);
  const workerAdd = workerScriptTwins(names.instance, names.d1Name);
  for (const [file, additions, anchor] of [
    [ROOT_PKG, rootAdd, 'postdeploy:friend'],
    [WORKER_PKG, workerAdd, 'db:migrate:friend'],
  ]) {
    const where = file.replace(ROOT, '.').split('\\').join('/');
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const { scripts, added } = insertScripts(pkg.scripts, additions, anchor);
    if (!added.length) {
      console.log(`  exists already   ${where} — every twin is present`);
      continue;
    }
    // ⚠️ The file is named on every line: `deploy:<instance>` legitimately exists
    // in BOTH package.json files with DIFFERENT bodies (the root one builds and
    // delegates; the worker one is the bare wrangler call), and two identical
    // lines with different meanings is how a reader concludes the run repeated
    // itself.
    for (const name of added) {
      console.log(`  ${(dry ? 'would add' : 'added').padEnd(9)}  ${where}  ${name}  →  ${additions[name]}`);
    }
    if (!dry) {
      pkg.scripts = scripts;
      writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    }
  }
  console.log('  ⚠️ deploy-guard.mjs and deploy-done.mjs already take --instance=<name>; the');
  console.log('     twins are the only thing a new instance needs from this repo.');

  // Step 5 — commit
  heading('5 · Commit the allowlist   (§7.4 point 3 — never `git add -A`)');
  const allowlist = ['apps/worker/wrangler.toml', 'package.json', 'apps/worker/package.json'];
  console.log(`  staged by name   ${allowlist.join('  ')}`);
  if (dry) {
    console.log('    $ git add ' + allowlist.join(' '));
    console.log(`    $ git commit -F <message file>`);
  } else if (blockPresent && !Object.keys(rootAdd).length) {
    console.log('  nothing to commit — the config was already in place');
  } else {
    const msg = join(ROOT, '.provision-commit.msg');
    writeFileSync(
      msg,
      `provision: [env.${names.instance}] — ${names.displayName} at ${names.host}\n\n` +
        `catalog_request #${names.requestId}, estate app ${names.estateApp}, D1 ${names.d1Name},\n` +
        `bucket ${names.bucketName}. Generated by scripts/provision-catalog.mjs.\n`,
      'utf8',
    );
    try {
      git(['add', ...allowlist]);
      git(['commit', '-F', msg]);
      console.log(`  committed        ${git(['rev-parse', '--short', 'HEAD'])}`);
    } finally {
      rmSync(msg, { force: true });
    }
  }

  // Step 6 — migrate
  heading('6 · Migrate the new D1 — BEFORE any deploy   (§7.3: AUTO)');
  console.log(`    $ npm run db:migrate:${names.instance}`);
  console.log('  ⚠️ Silence from migrate is a FAILED migration — expect the checkbox table.');
  if (!dry) npmRun(`db:migrate:${names.instance}`);

  // Step 7 — PAUSE #1
  heading('7 · ⏸ PAUSE #1 — Firebase authorised domain   (🔴 MANUAL)');
  const domains = await firebaseAuthorisedDomains();
  if (domains === null) {
    notVerified.push('the Firebase authorised-domain list (the read failed — not that the domain is absent)');
    console.log('  ⚠️ Could not read the authorised-domain list. That is a failed READ, not a');
    console.log('     verdict about the domain — treat it as unknown.');
  } else if (domains.includes(names.host)) {
    console.log(`  ✅ measured      ${names.host} is on the ${FIREBASE_PROJECT} authorised list`);
  } else {
    console.log(`  ❌ measured      ${names.host} is NOT on the ${FIREBASE_PROJECT} authorised list`);
    console.log(`     the list holds: ${domains.join(', ')}`);
    for (const line of manualRunbook(names, { platformDir: platform.dir }).slice(0, 12)) {
      console.log(`  ${line}`);
    }
    if (!dry) {
      console.log('');
      console.log(`  Do it, then: npm run provision:catalog -- --request ${requestId} --resume`);
      await closeHttpPool();
      process.exit(3);
    }
  }

  // Step 8 — PAUSE #2
  heading('8 · ⏸ PAUSE #2 — auth-worker consumer registration   (🔴 MANUAL, reviewed code)');
  const reg = checkAuthWorkerRegistration(names, ctx.authWorkerDir);
  for (const [ok, what] of reg.checks) console.log(`  ${ok ? '✅' : '❌'} ${what}`);
  console.log('  ⚠️ Those read the SOURCE. Nothing here proves the auth Worker was migrated and');
  console.log('     deployed — only a real sign-in tailed with "src":"seen" does.');
  notVerified.push('that the auth Worker was migrated and deployed (source is not production)');
  if (!reg.ok) {
    console.log('');
    for (const line of manualRunbook(names, { platformDir: platform.dir }).slice(13)) console.log(`  ${line}`);
    if (!dry) {
      console.log('');
      console.log(`  Do it, then: npm run provision:catalog -- --request ${requestId} --resume`);
      await closeHttpPool();
      process.exit(3);
    }
  }

  // Step 9 — the paired estate token
  heading('9 · The paired estate token — one value, two holders, the same NAME   (§7.3: AUTO)');
  console.log(`  ⚠️ PIPE FIRST, DEPLOY SECOND — there is no inert window that way round.`);
  console.log('  ⚠️ Minted with node crypto, hex, no trailing newline and no BOM: an invisible');
  console.log('     BOM makes a bearer fail while looking perfect everywhere a human can check.');
  printCmd(cmd('put', { args: ['secret', 'put', names.tokenName, '--config', WRANGLER_TOML, '--env', names.instance], stdinSecret: names.tokenName }));
  printCmd(cmd('put', { bin: ctx.platformWrangler, cwd: ctx.authWorkerDir, args: ['secret', 'put', names.tokenName], stdinSecret: names.tokenName }));
  if (!dry) {
    const already = secretNames(names.instance).includes(names.tokenName);
    if (already && resumeMode) {
      console.log(`  exists already   ${names.tokenName} on env ${names.instance} — skipped (--resume)`);
      skipped.push(names.tokenName);
      notVerified.push(`that the existing ${names.tokenName} matches the auth Worker's copy (a value cannot be read back)`);
    } else {
      const token = randomBytes(32).toString('hex');
      const a = await putSecret(names.tokenName, token, { env: names.instance, config: WRANGLER_TOML });
      const b = await putSecret(names.tokenName, token, {
        cwd: ctx.authWorkerDir,
        bin: ctx.platformWrangler,
      });
      if (a !== 0 || b !== 0) {
        stop(
          `Setting ${names.tokenName} exited ${a} on the instance and ${b} on the auth Worker.`,
          'Read the wrangler output above. If only ONE side landed, set the other by hand',
          'with the same value or mint a fresh pair — a half-set bearer is a 401 the gate',
          'reports as estate_unreachable.',
        );
      }
      console.log(`  set on both      ${names.tokenName}`);
    }
  }

  // Step 10 — the rest of the secrets
  heading('10 · Per-instance secrets   (§7.3: AUTO · ANTHROPIC_API_KEY is SPECIAL)');
  /** 'reader' | 'owner' | 'none' — decided below, read again at step 12. */
  let keySource = 'none';
  const plan = secretPlan(enable);
  for (const line of plan.lines) console.log(`  ${line}`);
  printCmd(cmd('bulk', { args: ['secret', 'bulk', '--config', WRANGLER_TOML, '--env', names.instance], stdinSecret: plan.push.join(', ') || '(none)' }));
  printCmd(cmd('put', { args: ['secret', 'put', 'ANTHROPIC_API_KEY', '--config', WRANGLER_TOML, '--env', names.instance], stdinSecret: 'ANTHROPIC_API_KEY' }));
  if (!dry) {
    const vars = readDevVars();
    const payload = {};
    for (const name of plan.push) if (vars[name]) payload[name] = vars[name];
    const missing = plan.push.filter((n) => !vars[n]);
    for (const n of missing) console.log(`  skip (not set locally)   ${n}`);
    if (Object.keys(payload).length) {
      const code = await bulkSecrets(payload, names.instance);
      if (code !== 0) {
        console.log(`  ⚠️ wrangler exited ${code} — read the output above before assuming it failed.`);
      } else {
        console.log(`  pushed ${Object.keys(payload).length} shared secret(s)`);
      }
    }
  }

  /* ── ANTHROPIC_API_KEY — the §6.4 ladder, resolved here ──────────────────
   *
   * 🔴 THE SEALED ENVELOPES ARE TRIED FIRST, ALWAYS. Falling to the owner's own
   * key when a requester attached one would silently spend HIS money on
   * somebody else's catalog while a perfectly good key sat unread in a bucket —
   * a money bug, invisible until a bill, and the exact inversion the ordering
   * in `envelopeCandidates` exists to prevent. */
  const seal = await loadSealLib(platform.dir);
  if (seal) {
    const result = await seal.injectSealedKey({
      requestId: names.requestId,
      // Run `wrangler secret put` from the worker directory, so it reads THIS
      // repo's wrangler.toml and the `--env` names one of its blocks.
      workerDir: dirname(WRANGLER_TOML),
      envName: names.instance,
      secretName: 'ANTHROPIC_API_KEY',
      dry,
      log: console.log,
    });
    keySource = result.source;
  }

  if (keySource === 'none') {
    console.log('  owner key used — standing decision 2026-09-05 (design §6.4 row 3)');
    console.log('  ⚠️ This instance spends the OWNER\'S Anthropic key, hourly, on its details sweep.');
    if (!dry) {
      const vars = readDevVars();
      if (!vars.ANTHROPIC_API_KEY) {
        stop(
          `ANTHROPIC_API_KEY is not set in ${DEV_VARS}, so there is no owner key to pipe,`,
          'and neither the requester nor you attached a sealed one.',
          'The standing decision (2026-09-05) is that a new catalog runs on the owner\'s key;',
          'set it there, or in the vault and re-run with SECRETS_SOURCE=op-style values,',
          'then re-run this with --resume.',
        );
      }
      const code = await putSecret('ANTHROPIC_API_KEY', vars.ANTHROPIC_API_KEY, {
        env: names.instance,
        config: WRANGLER_TOML,
      });
      if (code !== 0) console.log(`  ⚠️ wrangler exited ${code} setting ANTHROPIC_API_KEY — read the output above.`);
      else console.log('  set              ANTHROPIC_API_KEY   (owner key used — standing decision 2026-09-05)');
    }
  } else {
    // ⚠️ The SOURCE is logged, never the value. Design §6.4's closing note: the
    // run must log which instances spend whose key, so a later reader can see
    // it without asking anybody to decrypt anything.
    console.log(
      keySource === 'reader'
        ? '  ⚠️ This instance spends the REQUESTER\'S own Anthropic key, not the owner\'s.'
        : '  ⚠️ This instance spends the key YOU set when you accepted the request.',
    );
  }

  // Step 11 — deploy
  heading('11 · Deploy, through this repo\'s own guards   (§7.3: AUTO, owner-run)');
  console.log(`    $ npm run deploy:${names.instance}`);
  console.log('  It runs check-clean (a dirty tree is refused — the deploy uploads the');
  console.log('  WORKING-TREE apps/web/dist), deploy-guard --instance (ancestry against the');
  console.log(`  last env=${names.instance} line; a first-ever deploy skips it) and deploy-done,`);
  console.log('  which appends the deploys.log line. ⚠️ Commit that line afterwards.');
  if (!dry) {
    npmRun(`deploy:${names.instance}`);
    npmRun(`postdeploy:${names.instance}`);
  }

  // Step 12 — verify, then mark live
  heading('12 · Verify live, then mark the request live   (§7.3: AUTO)');
  const healthUrl = `https://${names.host}/api/health?cb=${randomBytes(6).toString('hex')}`;
  console.log(`    GET ${healthUrl}`);
  console.log('  ⚠️ The cache-buster is not decoration: /api/health is EDGE-CACHED on a custom');
  console.log('     domain, and a plain fetch right after a deploy returns the PREVIOUS body.');
  // ⚠️ The booleans follow the KEY SOURCE step 10 resolved, not a constant.
  // `reader_key_set` is left exactly as the ROUTE set it when the envelope was
  // stored — one fact, one writer.
  const update = markLiveUpdate(names, keySource);
  printCmd(cmd('update', {
    bin: ctx.platformWrangler,
    cwd: ctx.authWorkerDir,
    args: ['d1', 'execute', ESTATE_DB, '--remote', '--json', '--command', update],
  }));
  if (!dry) {
    const ok = await healthOk(healthUrl);
    if (!ok) {
      stop(
        `${names.host} did not answer 200 on /api/health, so the request is NOT marked live.`,
        '⚠️ This LAN negative-caches a new subdomain for ~30 minutes; try the workers.dev',
        `host (${names.workerName}.<account>.workers.dev), which is not fronted by the cache,`,
        'and re-run with --resume once the name resolves.',
      );
    }
    console.log('  ✅ 200 from /api/health');
    estateSql(update, ctx);
    const after = readRequest(names.requestId, ctx);
    console.log(`  row now          status=${after?.status} instance=${after?.provisioned_instance} host=${after?.provisioned_host}`);
    // ⚠️ BOTH booleans, and the source beside them. `reader_key_set=1` with
    // `owner_key_set=1` is a legal and meaningful state — the owner set one at
    // Accept and the reader's still won — so printing one of them names the
    // wrong custody as often as the right one.
    console.log(`  key custody      reader_key_set=${after?.reader_key_set} owner_key_set=${after?.owner_key_set}   (source: ${keySource})`);
  }

  /* ── the tail ──────────────────────────────────────────────────────────── */

  heading('The manual runbook, in full');
  for (const line of manualRunbook(names, { platformDir: platform.dir })) console.log(`  ${line}`);

  heading('Review it');
  console.log(`  https://${names.host}/`);
  console.log(`  https://${names.host}/api/health?cb=1   (estate.app should read ${names.estateApp})`);
  console.log(`  https://heygabi.ai/admin/               (the request row, now live)`);
  console.log('');
  console.log(`  Then, ONCE, watch a real sign-in — the only proof the bearer is right:`);
  console.log(`    npm run tail --workspace @lc/worker -- --env ${names.instance}`);
  console.log(`    look for "app":"${names.estateApp}" with "src":"seen"  ("none" or "stale_cache" = wrong value)`);

  if (skipped.length) {
    heading('Skipped because it already existed');
    for (const s of skipped) console.log(`  • ${s}`);
  }
  heading('⚠️ NOT verified by this run');
  for (const n of notVerified) console.log(`  • ${n}`);
  console.log('  • that the requester can actually sign in (needs a real browser and their account)');

  if (dry) {
    console.log('\nDry run — nothing was created, written, committed, minted or deployed.');
  }
  // ⚠️ NOT `process.exit(0)`. Measured 2026-09-05: a successful --dry run exited
  // **127** with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — node
  // tearing itself down while an undici keep-alive socket from the Firebase read
  // was still closing. A success that reports 127 is worse than no exit code at
  // all, because anything scripting this reads it as a failure. Closing the pool
  // and letting node exit on its own is the fix; every FAILURE path above still
  // exits explicitly and non-zero.
  await closeHttpPool();
  process.exitCode = 0;
}

/** Let undici's keep-alive sockets go, so the process can exit cleanly. */
async function closeHttpPool() {
  try {
    const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (dispatcher && typeof dispatcher.close === 'function') await dispatcher.close();
  } catch {
    /* best effort — an unclosed pool is a slow exit, never a wrong answer */
  }
}

/** Only used to let `--resume` re-derive a name whose env block already exists. */
function sanitiseSafe(row, override) {
  try {
    return sanitiseInstanceName(override || row.desired_subdomain || '', { existingEnvs: [] }).name;
  } catch {
    return null;
  }
}

function stop(...lines) {
  console.error('');
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
}

/** The database_id out of `wrangler d1 create`'s copy-paste snippet. */
export function parseDatabaseId(out) {
  const m = out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i) || out.match(/"uuid"\s*:\s*"([0-9a-f-]{36})"/i);
  return m ? m[1] : null;
}

function findD1(name) {
  try {
    const list = extractJsonArray(runWrangler({ args: ['d1', 'list', '--json'] }));
    const hit = list.find((d) => d?.name === name);
    return hit?.uuid || hit?.database_id || null;
  } catch {
    return null;
  }
}

function hasBucket(name) {
  try {
    const out = runWrangler({ args: ['r2', 'bucket', 'list'] });
    return new RegExp(`(^|[\\s:"])${name}([\\s"]|$)`, 'm').test(out);
  } catch {
    return false;
  }
}

/**
 * One var already written into this instance's `[env.<i>.vars]` block, for
 * `--resume` — the block IS the record of what the first half of the run chose.
 */
export function existingVar(toml, instance, key) {
  // ⚠️ Line-anchored, NOT indexOf: `[env.friend.vars]` is MENTIONED in a comment
  // in the top-level [vars] block, ~3,000 characters before the real table, and
  // an indexOf lands there and reads the main instance's values as the friend's.
  // Measured while writing the drift test, which is exactly what it is for.
  const start = toml.search(new RegExp(`^\\[env\\.${instance}\\.vars\\]\\s*$`, 'm'));
  if (start === -1) return null;
  const section = toml.slice(start);
  const m = section.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return m ? m[1] : null;
}

/** @deprecated thin wrapper kept because the covers URL is the one read by name. */
export function existingCoversBaseUrl(toml, instance) {
  return existingVar(toml, instance, 'COVERS_BASE_URL');
}

/** wrangler `secret list --env <i>` → the NAMES it holds. Never a value; there is none to read. */
function secretNames(instance) {
  try {
    const out = runWrangler({ args: ['secret', 'list', '--config', WRANGLER_TOML, '--env', instance] });
    return [...out.matchAll(/"name"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/**
 * What a new instance gets, and what it is refused — the `push-secrets.mjs`
 * classification, imported rather than restated so a change there reaches here.
 */
export function secretPlan(enable = [], lists = {}) {
  const always = lists.always ?? SHARED_ALWAYS;
  const optIn = lists.optIn ?? SHARED_OPT_IN;
  const push = [];
  const lines = [];
  for (const name of always) {
    push.push(name);
    lines.push(`push (shared)            ${name}`);
  }
  for (const name of optIn) {
    if (enable.includes(name)) {
      push.push(name);
      lines.push(`push (--enable)          ${name}   ⚠️ this ENABLES that machine route here`);
    } else {
      lines.push(`skip (opt-in)            ${name}`);
      lines.push(`                           ↳ ${optInReason(name)}`);
    }
  }
  for (const name of ['INDEX_PUSH_TOKEN', 'INDEX_READ_TOKEN']) {
    lines.push(`refuse (per-instance)    ${name}`);
    lines.push(`                           ↳ ${perInstanceReason(name)}`);
  }
  lines.push('special                  ANTHROPIC_API_KEY');
  lines.push('                           ↳ the OWNER\'S key (design §6.4 row 3, standing decision 2026-09-05).');
  lines.push('                             Read from .dev.vars in code, piped over stdin, never printed.');
  // A belt-and-braces assertion: nothing per-instance may enter the push set.
  const leak = push.filter((n) => isPerInstance(n));
  if (leak.length) {
    throw new Error(
      `provision-catalog would push per-instance secrets (${leak.join(', ')}). ` +
        'That is the guard push-secrets.mjs exists to hold — fix the lists, do not weaken it.',
    );
  }
  return { push, lines };
}

/** Reads `.dev.vars` IN CODE. No value ever reaches a console, a log or a file. */
function readDevVars() {
  let raw;
  try {
    raw = readFileSync(DEV_VARS, 'utf8');
  } catch {
    stop(
      `No .dev.vars at ${DEV_VARS}, so there are no values to send.`,
      'It is this repo\'s documented single source of truth for key material',
      '(docs/access/secrets.md). Restore it, or resolve it from the vault first:',
      '  npm run secrets:import:op',
    );
  }
  const vars = parseDevVars(raw);
  // The 2026-08-25 weld: a `>>` append onto a file with no trailing newline put
  // one key's value on the end of another's. Names only, never a value.
  assertNoGluedValues(vars, DEV_VARS);
  return vars;
}

/**
 * The authorised-domain list, read LIVE from Identity Platform with the public
 * web api key. Returns null when the READ failed — which is not the same fact as
 * "the domain is absent", and the caller says so.
 */
async function firebaseAuthorisedDomains() {
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(FIREBASE_WEB_KEY)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!r.ok) return null;
    const body = await r.json();
    return Array.isArray(body?.authorizedDomains) ? body.authorizedDomains : null;
  } catch {
    return null;
  }
}

/** Whatever of PAUSE #2 can be read out of the sibling checkout's source. */
export function checkAuthWorkerRegistration(names, authWorkerDir, { read = readIfExists, list = listIfExists } = {}) {
  const envTs = read(join(authWorkerDir, 'src', 'env.ts'));
  const migrations = list(join(authWorkerDir, 'migrations'));
  const inConsumers = new RegExp(`CONSUMER_APPS[^;]*'${names.estateApp}'`, 's').test(envTs);
  const hasCase = new RegExp(`case '${names.estateApp}'`).test(envTs);
  const hasEnvField = new RegExp(`${names.tokenName}\\??\\s*:`).test(envTs);
  const hasMigration = migrations.some((f) => f.includes(names.visColumn));
  const checks = [
    [inConsumers, `CONSUMER_APPS contains '${names.estateApp}'  (src/env.ts:4)`],
    [hasEnvField, `Env declares ${names.tokenName}`],
    [hasCase, `appTokenFor() has a case '${names.estateApp}' arm`],
    [hasMigration, `a migration adding ${names.visColumn} exists`],
  ];
  return { ok: checks.every(([ok]) => ok), checks };
}

function readIfExists(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function listIfExists(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function healthOk(url) {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    return r.status === 200;
  } catch {
    return false;
  }
}
