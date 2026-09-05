/**
 * THE SPENDING GATE FOR THE FIVE CLI SCRIPTS — L9–L13 of the money-path
 * inventory, and the second of the two steps left on billing phase 3
 * (`catalog-platform/docs/info/llm-billing-control-design.md` §9 Q5).
 *
 * Five paths — `backfill-missing-covers.mjs`, `backfill-missing-isbns.mjs`,
 * `research-queue.mjs`, `audit-universes.mjs`, `probe-universes.mjs` — whose
 * only gate until now was a command-line flag. This is the ONE helper all five
 * call; a sixth copy of "ask the directory, warn, offer the hatch" is exactly
 * the near-duplicate this project bans.
 *
 * ## What Q5 decided, and what that means in code
 *
 * > *"honour policy, but as a WARNING with an explicit `--ignore-policy` escape
 * > hatch, never a hard refusal. A local script the owner runs deliberately is
 * > not the threat model, and a CLI that refuses its operator is a CLI that gets
 * > edited."*
 *
 * ⚠️ **Read the two halves together, because they pull in opposite directions
 * and the wording of the banner settles it.** The design's own example line is
 * *"cover search is switched off for library; **re-run** with --ignore-policy"* —
 * you do not "re-run" something that already ran. So a deny **stops the run
 * before the first paid call**, and `--ignore-policy` goes through. That is the
 * estate's standard shape for a rule that matters: *promoted from prose to a
 * script, with a deliberate escape hatch* — never a wall. Nothing here can
 * refuse the operator; it can only make him say so.
 *
 * ⚠️ **And only a run that would SPEND is ever stopped.** A dry run, a
 * `--plan`, an estimate — none of them bill anything, so none of them are the
 * subject of a spending policy. Each script decides whether it is about to
 * spend and calls this only then, which is also why a policy-off machine and a
 * dry run behave byte-for-byte as they did before this file existed.
 *
 * ## Three callers, one resolver — and this is the FOURTH consumer
 *
 * The rules live in the auth Worker's `estate_auth` D1 and are resolved THERE
 * (design §3.4). This module presents a bearer, reads an array and decides
 * nothing about the rules themselves. It is modelled on
 * `apps/worker/src/lib/billing-system.ts` — the same door, the same
 * `null`-is-unknown discipline, the same fail-open direction — because a second
 * implementation of "most specific wins" is a second set of rules, and the two
 * would disagree on the day it mattered.
 *
 *     GET <ESTATE_AUTH_URL>/api/estate/billing/policy
 *     Authorization: Bearer <this instance's ESTATE_APP_TOKEN_*>
 *     → { site, system_denied: string[], cache_seconds: 600 }
 *
 * ## 🔴 THE ONE THING TO KNOW BEFORE TRUSTING THIS GATE
 *
 * The system door answers for `principal_kind = 'system'` ONLY — the resolver
 * refuses to match an `everyone` rule against a cron, deliberately and in both
 * directions (§11.2 departure 1). But the registry declares `cli.backfill`,
 * `research.covers` and `research.isbn` with `principals: ['person']`
 * (`catalog-platform/apps/auth-worker/src/billing-registry.ts`), so the
 * Spending panel's own cell writes an **`everyone`** rule for them — which this
 * door will never return.
 *
 * ⚠️ **So a click on the panel does not stop these scripts today.** What does:
 * a `system` rule written through `POST /api/estate/billing/rules`
 * (`{"feature":"cli.backfill","site":"library","principal_kind":"system",
 * "allow":0,"why":"…"}` — the write door validates the feature id and the
 * principal coherence, and does NOT require the id to declare `system`). The
 * one-line fix that would make the panel's own switch reach here is
 * `principals: ['person', 'system']` on those three registry rows, upstream,
 * where a pin test guards the list. That is not this repo's to make; it is
 * written down in `docs/TODO.md` and reported, not fixed here.
 *
 * ## Names only
 *
 * The bearer is read from `process.env` first and from the gitignored
 * `apps/worker/.dev.vars` second — the same order and the same reason as
 * `import-ebooks.mjs`: an unattended run needs no shell setup. ⚠️ Neither
 * `ESTATE_APP_TOKEN_LIBRARY` nor `ESTATE_APP_TOKEN_LIBRARY2` is in `.dev.vars`
 * today (both are measured custody gaps — `docs/access/secrets.md`), so the
 * gate reports the policy UNKNOWN and proceeds until one is set. That is stated
 * on screen rather than left to look like "nothing is denied".
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WRANGLER_TOML = path.join(ROOT, 'apps/worker/wrangler.toml');
const DEV_VARS = path.join(ROOT, 'apps/worker/.dev.vars');

/** How long the system door may hang before the run gives up on it. */
export const POLICY_TIMEOUT_MS = 5_000;

/**
 * The registry ids these scripts check.
 *
 * ⚠️ **The double cover is DELIBERATE and is reproduced verbatim, not tidied.**
 * §3.2 puts L9 under `research.covers` as well as `cli.backfill`, and L10 under
 * `research.isbn` as well — and §11.2 departure 4 records that the duplication
 * was kept on purpose and pinned by a test upstream. It is safe because policy
 * can only DENY: **a path under two switches is refused if EITHER denies.**
 * Removing one would be a change to the spec wearing a cleanup's clothes.
 */
export const CLI_BILLING_FEATURES = Object.freeze({
  backfill: 'cli.backfill',
  covers: 'research.covers',
  isbn: 'research.isbn',
});

/** L9–L13 → the ids each one is refused by. */
export const CLI_FEATURE_SETS = Object.freeze({
  /** L9 — `backfill-missing-covers.mjs --llm`. */
  covers: Object.freeze([CLI_BILLING_FEATURES.backfill, CLI_BILLING_FEATURES.covers]),
  /** L10 — `backfill-missing-isbns.mjs --llm`. */
  isbns: Object.freeze([CLI_BILLING_FEATURES.backfill, CLI_BILLING_FEATURES.isbn]),
  /** L11 — `research-queue.mjs --commit`. */
  researchQueue: Object.freeze([CLI_BILLING_FEATURES.backfill]),
  /** L12 — `audit-universes.mjs` (a `--plan` run spends nothing and is not gated). */
  auditUniverses: Object.freeze([CLI_BILLING_FEATURES.backfill]),
  /** L13 — `probe-universes.mjs`. */
  probeUniverses: Object.freeze([CLI_BILLING_FEATURES.backfill]),
});

export const BILLING_POSTURES = Object.freeze(['off', 'shadow', 'enforce']);

/* ------------------------------------------------------------------ *
 * Reading this instance's identity out of the config of record
 * ------------------------------------------------------------------ */

/**
 * One key out of one TOML table.
 *
 * ⚠️ Section-aware on purpose. `wrangler.toml` states `ESTATE_APP`,
 * `ESTATE_AUTH_URL` and `BILLING_POLICY` **twice** — once in `[vars]` and once
 * in `[env.friend.vars]` — and the whole point of this module is telling the
 * two instances apart. A bare `/^ESTATE_APP\s*=/m` would find the main
 * instance's line for a `--friend` run and ask the directory about the wrong
 * catalogue, which is estate-credentials F-5 in a new costume.
 *
 * @param {string} text  the file contents
 * @param {string} table e.g. `vars` or `env.friend.vars`
 * @param {string} key
 * @returns {string | null}
 */
export function tomlTableValue(text, table, key) {
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('#')) continue;
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      current = header[1].trim();
      continue;
    }
    if (current !== table) continue;
    const m = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`).exec(line);
    if (m) return m[1];
  }
  return null;
}

/** `[vars]` for the main instance, `[env.friend.vars]` for padhard. */
export function varsTableFor({ friend = false } = {}) {
  return friend ? 'env.friend.vars' : 'vars';
}

function tomlText(configText) {
  return configText ?? readFileSync(WRANGLER_TOML, 'utf8');
}

/**
 * The estate site this run spends against — `library` or `library2`.
 *
 * ⚠️ Read from `wrangler.toml`, never mapped from `--friend` in here. The
 * Worker's own gate makes the same choice for the same reason
 * (`apps/worker/src/lib/billing-gate.ts`): hard-coding the identity is how her
 * instance ends up asserting his, and how a switch the owner pressed on padhard
 * does nothing.
 */
export function billingSiteFor({ friend = false, configText = null } = {}) {
  return tomlTableValue(tomlText(configText), varsTableFor({ friend }), 'ESTATE_APP');
}

/**
 * The posture for the instance this run targets.
 *
 * ⚠️ `off` is not "assume allowed" — it is "this site's switch is not acting
 * yet", the state both instances ship in today. Anything unrecognised falls to
 * `off` and says so, copied from `billingPosture` in the Worker's gate: a typo
 * in a wrangler var must not half-enable a money gate, and must not be silent
 * about it either.
 */
export function billingPostureFor({ friend = false, configText = null } = {}) {
  const raw = tomlTableValue(tomlText(configText), varsTableFor({ friend }), 'BILLING_POLICY');
  if (raw === null || raw === '') return 'off';
  const v = raw.trim().toLowerCase();
  if (BILLING_POSTURES.includes(v)) return v;
  console.warn(
    `⚠️ BILLING_POLICY is "${raw}" in [${varsTableFor({ friend })}], which is not off|shadow|enforce — treating it as "off".`,
  );
  return 'off';
}

export function estateAuthUrlFor({ friend = false, configText = null } = {}) {
  return tomlTableValue(tomlText(configText), varsTableFor({ friend }), 'ESTATE_AUTH_URL');
}

/**
 * The env var NAME holding this instance's bearer.
 *
 * ⚠️ The names are the auth Worker's own and the pairing rule is *same name,
 * both sides* — `APP_TOKEN_VAR` in `packages/estate-auth/src/gate.ts`. A switch,
 * not an index expression, so the set of secrets this module may read stays
 * greppable and no future var name can be reached by data.
 */
export function appTokenVarFor({ friend = false, configText = null } = {}) {
  switch (billingSiteFor({ friend, configText })) {
    case 'library':
      return 'ESTATE_APP_TOKEN_LIBRARY';
    case 'library2':
      return 'ESTATE_APP_TOKEN_LIBRARY2';
    default:
      return null;
  }
}

/**
 * Read one NAMED var: environment first, then the gitignored `.dev.vars`.
 * Never printed, never logged, never returned to a caller that prints.
 *
 * ⚠️ Exported ONLY so a test can substitute a stub for it. A test that read the
 * real `.dev.vars` would pass or fail depending on whether the owner happened
 * to have regenerated the file that hour, and no test may open it anyway.
 */
export function readToken(name) {
  const fromEnv = (process.env[name] ?? '').trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(DEV_VARS)) return '';
  const m = new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*"?([^"\\r\\n]+)"?`, 'm').exec(
    readFileSync(DEV_VARS, 'utf8'),
  );
  return m?.[1]?.trim() ?? '';
}

/* ------------------------------------------------------------------ *
 * The door
 * ------------------------------------------------------------------ */

/**
 * Fetch the `system` deny-set for the instance this run targets.
 *
 * 🔴 RETURNS `null` FOR "UNKNOWN", AND UNKNOWN PROCEEDS — §3.5 row 3, the same
 * fail-open direction every other consumer takes, chosen out loud. `[]` is the
 * other fact — the directory answered and denied nothing — and the two are kept
 * apart all the way down, exactly as they are on `/seen`.
 *
 * Never throws: a refusal to run because the directory was slow would be a
 * spending policy that costs the owner his evening.
 *
 * @returns {Promise<{ denied: string[] | null, why: string | null }>}
 */
export async function fetchSystemDenied({
  friend = false,
  fetchImpl = null,
  configText = null,
  tokenReader = readToken,
} = {}) {
  const site = billingSiteFor({ friend, configText });
  const tokenVar = appTokenVarFor({ friend, configText });
  const baseUrl = (estateAuthUrlFor({ friend, configText }) ?? '').trim();

  if (site === null || tokenVar === null) {
    return {
      denied: null,
      why: `ESTATE_APP in [${varsTableFor({ friend })}] is not library|library2 — the spending gate cannot name its site`,
    };
  }
  const token = tokenReader(tokenVar);
  if (!baseUrl || !token) {
    return {
      denied: null,
      why: `the system door is not configured here (needs ESTATE_AUTH_URL in wrangler.toml and ${tokenVar} in the environment or apps/worker/.dev.vars)`,
    };
  }

  const doFetch = fetchImpl ?? fetch;
  try {
    const resp = await doFetch(`${baseUrl.replace(/\/+$/, '')}/api/estate/billing/policy`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(POLICY_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return { denied: null, why: `the system door answered ${resp.status}` };
    }
    const body = await resp.json();
    const raw = body?.system_denied;
    // ⚠️ Not an array is not an answer. Coercing a string into a one-element
    // deny-list would switch off a run nobody named.
    if (!Array.isArray(raw)) return { denied: null, why: 'the system door answered without a system_denied array' };
    return { denied: raw.filter((v) => typeof v === 'string' && v.length > 0), why: null };
  } catch (err) {
    return { denied: null, why: `the system door could not be reached (${err?.message ?? err})` };
  }
}

/* ------------------------------------------------------------------ *
 * The decision, and the words
 * ------------------------------------------------------------------ */

/** Did this run ask for the hatch? The long spelling is the whole point. */
export function readIgnorePolicy(argv = process.argv.slice(2)) {
  return argv.includes('--ignore-policy');
}

/**
 * The pure half — decide, touching no network and no clock, so every row of the
 * truth table is a plain unit test.
 *
 * 🔴 `denied === null` IS "UNKNOWN" AND UNKNOWN PROCEEDS, for the reason stated
 * on `fetchSystemDenied`. `[]` proceeds too, for a different reason, and the
 * two never collapse into one another — `checked` says which happened.
 *
 * @param {{ posture: string, site: string | null, features: readonly string[],
 *           denied: string[] | null, ignorePolicy?: boolean }} args
 * @returns {{ deniedFeatures: string[], blocked: boolean, overridden: boolean, checked: boolean }}
 */
export function decideCliBilling(args) {
  const { posture, site, features, denied, ignorePolicy = false } = args;
  if (posture === 'off' || site === null) {
    return { deniedFeatures: [], blocked: false, overridden: false, checked: false };
  }
  const deniedFeatures = Array.isArray(denied) ? features.filter((f) => denied.includes(f)) : [];
  return {
    deniedFeatures,
    // ⚠️ NEVER a hard refusal: `--ignore-policy` always goes through, on every
    // posture including `enforce`. Q5 — a CLI that refuses its operator is a CLI
    // that gets edited.
    blocked: deniedFeatures.length > 0 && !ignorePolicy,
    overridden: deniedFeatures.length > 0 && ignorePolicy,
    checked: Array.isArray(denied),
  };
}

/**
 * The banner. ⚠️ Three things, per the estate's standing rule that a person
 * never meets a bare status: what happened, what it needs, and how to get past
 * it — here, the exact re-run.
 *
 * @param {{ label: string, site: string, deniedFeatures: readonly string[],
 *           overridden?: boolean }} args
 */
export function policyBanner({ label, site, deniedFeatures, overridden = false }) {
  const ids = deniedFeatures.join(', ');
  if (overridden) {
    return (
      `⚠️ OVERRIDE ACTIVE — --ignore-policy. ${label} is switched off for ${site} ` +
      `(${ids}), and this run is spending anyway.\n` +
      `   The owner switched it off from the Spending panel on https://heygabi.ai/admin/.`
    );
  }
  return (
    `⚠️ ${label} is switched off for ${site}; re-run with --ignore-policy.\n` +
    `   Denied by spending policy: ${ids}\n` +
    `   Nothing was asked and nothing was spent.\n` +
    `   To turn it back on: the Spending panel on https://heygabi.ai/admin/ ` +
    `(a change takes effect within 10 minutes).\n` +
    `   To spend anyway, deliberately: re-run this command with --ignore-policy.`
  );
}

/**
 * The one call a script makes, immediately before its first paid call.
 *
 * ⚠️ **Only call this on a run that will actually SPEND.** A dry run, a
 * `--plan` or an estimate bills nothing and is not the subject of a spending
 * policy; gating one would change behaviour the policy never meant to touch.
 *
 * ⚠️ Returns rather than exits. The script owns its own exit code and its own
 * "nothing was written" wording; a helper that called `process.exit` would take
 * that away and be untestable besides.
 *
 * @param {{ friend?: boolean, features: readonly string[], label: string,
 *           argv?: string[], fetchImpl?: typeof fetch | null,
 *           log?: (s: string) => void, configText?: string | null }} args
 * @returns {Promise<{ blocked: boolean, deniedFeatures: string[], site: string | null,
 *                     posture: string, checked: boolean, overridden: boolean }>}
 */
export async function checkCliBilling({
  friend = false,
  features,
  label,
  argv = process.argv.slice(2),
  fetchImpl = null,
  log = console.log,
  configText = null,
  tokenReader = readToken,
}) {
  const posture = billingPostureFor({ friend, configText });
  const site = billingSiteFor({ friend, configText });

  // ⚠️ `off` makes NO network call and prints NOTHING. Both instances ship
  // `off`, so until a site is flipped these five scripts behave byte for byte
  // as they did before this gate existed — which is the only way to be sure the
  // gate did not change something else on the way in.
  if (posture === 'off' || site === null) {
    if (posture !== 'off' && site === null) {
      log(
        `⚠️ ESTATE_APP in [${varsTableFor({ friend })}] is not library|library2 — ` +
          'the spending gate cannot name its site and is behaving as off.',
      );
    }
    return { blocked: false, deniedFeatures: [], site, posture, checked: false, overridden: false };
  }

  const { denied, why } = await fetchSystemDenied({ friend, fetchImpl, configText, tokenReader });
  const decision = decideCliBilling({
    posture,
    site,
    features,
    denied,
    ignorePolicy: readIgnorePolicy(argv),
  });

  if (denied === null) {
    // Named rather than silent: a half-configured gate that said nothing would
    // read as "nothing is denied", which is false comfort of exactly the kind
    // shadow mode exists to prevent.
    log(`⚠️ Spending policy for ${site} is UNKNOWN — ${why}. Proceeding, as an unreachable directory must never stop a run.`);
  } else if (decision.deniedFeatures.length > 0) {
    log('');
    log(policyBanner({ label, site, deniedFeatures: decision.deniedFeatures, overridden: decision.overridden }));
    log('');
  }

  return { ...decision, site, posture };
}
