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
 *   npm run secrets:push -- --both --enable EBOOK_INGEST_TOKEN   # opt-in key
 *   npm run secrets:push:op            # …the same, sourced from 1Password
 *   npm run secrets:push:both:op -- --only HARDCOVER_API_TOKEN   # one key
 *
 * ## 🆕 `--source op` — the vault, not the file (owner decision 2026-08-26)
 *
 * The owner adopted 1Password on 2026-08-26 (option A, superseding the
 * 2026-08-25 "defer"). Plan of record:
 * `catalog-platform/docs/info/secrets-review-2026-08-26.md` §5.
 *
 * | `--source` | Values come from | needs `.dev.vars`? |
 * |---|---|---|
 * | `file` (**default, unchanged**) | `apps/worker/.dev.vars` | yes |
 * | `op` | vault `Estate`, via `op inject` on `apps/worker/.dev.vars.tpl` | **no** |
 *
 * `SECRETS_SOURCE=op` in the environment does the same thing, for a shell that
 * has switched over wholesale.
 *
 * ⚠️ **The default is still `file`, deliberately.** The `op` path is additive:
 * the allowlists, every refusal, the glued-value guard and the dry-run output are
 * the SAME code — only where the strings came from changes. Backing out is
 * dropping a flag, not reverting a rotation.
 *
 * ⚠️ **The `op` path never writes a value to disk.** `op inject` prints the
 * resolved template to STDOUT and this process parses it from memory. The
 * `-o apps/worker/.dev.vars` form exists for a human who wants the real file
 * back (`docs/access/secrets.md`) — and that file is then a build output to
 * delete, not a master to edit.
 *
 * ⚠️ **One `op` process, on purpose.** Every `op` process can raise an
 * authorization prompt that a HUMAN must approve in the desktop app, so
 * resolving 8 items with 8 `op read` calls would be 8 prompts. `op inject`
 * resolves the whole template in one.
 *
 * ⚠️ **A name in the template but not in the vault fails the WHOLE run.** That
 * is `op inject`'s behaviour and it is the right one here: a half-resolved
 * template would push some keys and silently skip others, which is the
 * partial-rotation failure `pushBoth` already refuses to create.
 *
 * ⚠️ This only ever *sets* secrets. Removing one from `.dev.vars` does not
 * delete it in production — use `wrangler secret delete` for that, so a typo
 * here can never quietly strip a live credential.
 *
 * ⚠️ `.dev.vars` is gitignored and must stay that way. It is the one file in
 * this repo that holds real key material.
 *
## `--only NAME` — narrow a run to one key (2026-08-26)
 *
 * Repeatable. ⚠️ **It can only ever REMOVE keys from what a run would send.** A
 * refusal stays a refusal, an unclassified key stays unclassified, and no key
 * the allowlists did not already contain can be added by naming it. `--enable`
 * is the flag that grants; this one only declines.
 *
 * It is how a single key is rotated without a bulk run, and it is how the `op`
 * source was first exercised in production: one already-live value, re-sent
 * unchanged, so the round trip was proved without moving anything.
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
 * | `SHARED_ALWAYS` | one value, two holders, **by design** | pushed |
 * | `SHARED_OPT_IN` | shared, but route-ENABLING on the receiver | only with `--enable NAME` |
 * | `PER_INSTANCE_SECRETS` | each instance has its OWN value | **refused, always** |
 * | anything else | not classified | refused with a sentence |
 *
 * (`SHARED_SECRETS` is still exported — it is the union of the first two, and
 * remains the answer to "may this key ever travel between instances at all?".)
 *
 * Friend pushes read the ONE main `.dev.vars` and send only the SHARED set, so
 * her `ANTHROPIC_API_KEY` and her estate identity can never be overwritten by a
 * bulk run — the property the old stub protected, kept, without the stub.
 *
 * ⚠️ **`.dev.vars.friend` still does not exist and must not be created.** It is
 * not read here for any flag. Creating one would be a custody change (§2 of the
 * estate credentials catalog), not a missing file to fill in.
 *
 * ## The two guards added after the 2026-08-25 rotation
 *
 * Both come from things that actually went wrong that day, not from imagination.
 *
 * 1. **A glued value refuses the WHOLE run.** A `>>` append onto a `.dev.vars`
 *    with no trailing newline welded `PEER_TOKEN=…` onto the END of
 *    `HARDCOVER_API_TOKEN`'s value, and `secrets:push:both` shipped the corrupt
 *    string to both instances. The parser cannot tell that from a legitimate
 *    value, so nothing downstream can either — `assertNoGluedValues` refuses
 *    before a single key is sent, naming the KEY and never the value.
 * 2. **Route-ENABLING shared keys are opt-in per instance.** See `SHARED_OPT_IN`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ⚠️ `op-cli.mjs`, NOT `op-import-dev-vars.mjs`. The import script imports THIS
// file for its lists and its glued-value guard, so reaching back the other way
// is a CYCLE — and because the last statement here is a top-level `await
// main()`, the cycle deadlocks: Node prints "Detected unsettled top-level
// await" and exits 13 with no other output. Measured 2026-08-26, with a
// dynamic `import()` that looked like it broke the cycle and did not. Both
// files depend on the plumbing module and on nothing of each other's.
import { isAuthorizationRefusal, opBinary, runOp } from './op-cli.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ⚠️ `SECRETS_DEV_VARS` exists so this can run from a git WORKTREE, where
 * `.dev.vars` is gitignored and therefore absent while the real one sits in the
 * primary checkout. Read-only, the glued-value guard still applies, and every
 * run prints which path it read — it is not a quiet way to push another file.
 */
const DEV_VARS = process.env.SECRETS_DEV_VARS || join(root, 'apps', 'worker', '.dev.vars');
/** TRACKED, and safe in a public repo: names + `op://` pointers, never values. */
const TEMPLATE = process.env.SECRETS_TEMPLATE || join(root, 'apps', 'worker', '.dev.vars.tpl');
const CONFIG = join(root, 'apps', 'worker', 'wrangler.toml');
/** Named here only so a refusal can say WHERE the values came from. */
const VAULT_NAME = 'Estate';
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
  // The shared-index READ bearer — the OTHER direction, and a DIFFERENT
  // credential (free-details ladder rung 2, live 2026-08-25). The index Worker
  // holds MAIN's value as INDEX_READ_TOKEN_LIBRARY. ⚠️ It is ALSO on
  // PER_INSTANCE_SECRETS: this list is the MAIN instance's set, and padhard
  // holds her own value under the same name — see the note there.
  'INDEX_READ_TOKEN',
];

/**
 * **The same value on BOTH instances, by design — and sent unconditionally.**
 *
 * ⚠️ Split out of `SHARED_SECRETS` on 2026-08-25: the two route-ENABLING keys
 * that used to sit in this list now live in `SHARED_OPT_IN` below, because
 * pushing one of THOSE to an instance opens a machine-writable route rather than
 * re-sending a value the receiver already holds. Everything left here is safe to
 * send to any instance any number of times.
 *
 * Every entry here is the
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
 * ⚠️ **`INDEX_READ_TOKEN` is still NOT here — but it is no longer unclassified.**
 * This note used to say the read half of the index "does not exist yet" and that
 * the key was therefore refused by default, which was the right answer while
 * nobody had decided its custody. It was decided on **2026-08-25**: the index's
 * machine read surface resolves the CALLING APP from the value presented
 * (`MACHINE_APPS` in `catalog-platform/apps/index-worker/src/env.ts`), and the
 * two instances are two apps — main is `library`, padhard is `library2`. So the
 * value is **per-instance by construction**, exactly like `INDEX_PUSH_TOKEN`,
 * and it now lives in `PER_INSTANCE_SECRETS` and `PRODUCTION_SECRETS`. Giving
 * her main's value would not merely be untidy: it would make the app name
 * meaningless and one leak would revoke both instances at once.
 */
export const SHARED_ALWAYS = [
  'GOOGLE_BOOKS_API_KEY',
  'HARDCOVER_API_TOKEN',
  'DONOR_TOKEN',
  'PEER_TOKEN',
];

/**
 * **Shared by design, but pushing one to an instance TURNS A ROUTE ON there.**
 *
 * `EBOOK_INGEST_TOKEN` and `AUDIOBOOK_MAPPING_TOKEN` authenticate a PIPELINE to
 * a shelf, and the receiving Worker treats *unset* as *route disabled*. So for
 * these two — and only these two — a bulk push is not a rotation, it is a
 * **capability grant**: the difference between re-sending a value someone
 * already holds and opening a machine-writable door on a catalog that did not
 * have one.
 *
 * ⚠️ **This list exists because that happened by accident.** Measured
 * 2026-08-25: the `PEER_TOKEN` rotation ran `secrets:push:both`, which created
 * `EBOOK_INGEST_TOKEN` on padhard as a side effect and enabled her ingest route.
 * It was reverted the same minute (`wrangler secret delete … --env friend`).
 * Nothing was lost; the lesson is that a *convenience* command silently widened
 * a *permission*, and no output said so.
 *
 * So on a NON-MAIN instance these are pushed only with an explicit
 * `--enable NAME` (repeatable), and skipped with a named line otherwise. Main is
 * unaffected: it is the source of truth and already holds both.
 *
 * ### 📌 Owner decision, 2026-08-25 — padhard is ON, future instances are not
 *
 * > *"her and I share audio and ebooks … they're already pre-mixed with mine;
 * > they should count as she owns them too"*
 *
 * padhard (`env.friend`) is the owner's partner and they **share one audio and
 * ebook pool**, so she counts as owning it. Both keys were therefore set on her
 * instance **by hand on 2026-08-25** and her routes are live — this flag is not
 * what turned them on and does not turn them off.
 *
 * ⚠️ **Any FUTURE library instance is opt-in by the OWNER**, one key at a time,
 * which is exactly what `--enable` makes someone type. A third instance
 * inheriting a machine-write route because a rotation ran is the thing this
 * refuses to do.
 */
export const SHARED_OPT_IN = ['EBOOK_INGEST_TOKEN', 'AUDIOBOOK_MAPPING_TOKEN'];

/**
 * Every key that may travel between instances at all — the union of the two
 * lists above, and still the answer to "is this key's value shared by design?".
 * `SHARED_OPT_IN` narrows *when* it is sent, never *whether* it is shared.
 */
export const SHARED_SECRETS = [...SHARED_ALWAYS, ...SHARED_OPT_IN];

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
 * - `INDEX_READ_TOKEN` — per-APP on the index Worker, the read direction's twin
 *   of the same argument (2026-08-25). The index tells its machine callers apart
 *   BY THE VALUE, so main's is its `INDEX_READ_TOKEN_LIBRARY` and hers is its
 *   `INDEX_READ_TOKEN_LIBRARY2`. Hers is set from the drop-box line
 *   `INDEX_READ_TOKEN_FRIEND_PADHARD` in the MAIN `.dev.vars`, piped then
 *   blanked — the `ANTHROPIC_API_KEY_FRIEND_SAM` idiom, and for the same reason:
 *   a value that must never reach an allowlist should not look like one that can.
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
export const PER_INSTANCE_SECRETS = ['ANTHROPIC_API_KEY', 'INDEX_PUSH_TOKEN', 'INDEX_READ_TOKEN'];

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
  // The FRIEND instance's machine READ token, parked here between minting and
  // piping (2026-08-25). Named so a bulk run says WHY it skipped it rather than
  // reporting an unclassified key — and it is deliberately not the live name, so
  // no allowlist can ever match it. Blanked once piped.
  INDEX_READ_TOKEN_FRIEND_PADHARD:
    "the FRIEND instance's machine read token — set with `npm run secret:friend -- INDEX_READ_TOKEN`, never pushed from here",
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

/**
 * ⚠️ **The same argument one level down: `SHARED_ALWAYS ∩ SHARED_OPT_IN = ∅`.**
 *
 * These two answer opposite halves of *when* a shared key is sent, so a key on
 * both means whichever list is consulted first decides whether a route gets
 * enabled — silently. Fails at module load, before anything can be pushed.
 */
export function assertSharedListsDisjoint(always = SHARED_ALWAYS, optIn = SHARED_OPT_IN) {
  const clash = always.filter((name) => optIn.includes(name));
  if (clash.length) {
    throw new Error(
      `SHARED_ALWAYS and SHARED_OPT_IN overlap: ${clash.join(', ')}. ` +
        'A shared key is either sent unconditionally or only with `--enable NAME` — ' +
        'decide, and put it on exactly one list. See the header of scripts/push-secrets.mjs.',
    );
  }
}

// Runs at module load: the lists are wrong or nothing runs at all.
assertListsDisjoint();
assertSharedListsDisjoint();

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

/**
 * ⚠️ **Does this value look like TWO lines welded into one?**
 *
 * The incident (`info/gotchas.md`, 2026-08-25): `apps/worker/.dev.vars` had no
 * trailing newline, a `>>` append landed `PEER_TOKEN=<value>` on the END of the
 * `HARDCOVER_API_TOKEN` line, and `secrets:push:both` shipped the welded string
 * to BOTH instances as Hardcover's token — while `PEER_TOKEN` itself never
 * appeared as a key at all. Nothing downstream can catch this: a secret is an
 * opaque string, so "corrupt" and "rotated" look identical from here on.
 *
 * The signature is a KEY-shaped run followed by `=` *inside* a value. Two
 * deliberate narrowings, both to avoid refusing a run over a good file:
 *
 * - **base64 padding is not a glue.** A value ending `…ABQ0Q=` or `…ABQ0Q==`
 *   matches the raw pattern and is perfectly legitimate, so a match whose
 *   remainder is empty or all `=` does not count. A real weld always has the
 *   second key's VALUE after the `=`, which is what is required here.
 * - **the check names the KEY and never the value**, in the message and in the
 *   return type, because this file's whole contract is that key material never
 *   reaches a console, a log or a plan row.
 *
 * The CR/LF arm is belt-and-braces: `parseDevVars` splits on newlines and trims,
 * so it cannot itself produce one today. It is here so a future parser that
 * learns about quoted multi-line values cannot quietly re-open the hole.
 */
export const GLUED_VALUE_RE = /[A-Z][A-Z0-9_]{2,}=/g;

/** True if this ONE value looks glued. Takes a value, returns a boolean — never echoes it. */
export function looksGlued(value) {
  if (typeof value !== 'string') return false;
  if (/[\r\n]/.test(value)) return true;
  for (const m of value.matchAll(GLUED_VALUE_RE)) {
    const after = value.slice(m.index + m[0].length);
    if (after !== '' && !/^=+$/.test(after)) return true;
  }
  return false;
}

/** The NAMES of every key whose value looks glued, sorted. Names only. */
export function findGluedValues(vars) {
  return Object.keys(vars)
    .filter((name) => looksGlued(vars[name]))
    .sort();
}

/** One sentence per offending key. The value is never interpolated. */
export function gluedRefusalMessage(names, file = DEV_VARS) {
  return names
    .map(
      (name) =>
        `${name} in ${file} looks like two lines glued together ` +
        '(a missing trailing newline?) — fix the file, nothing was pushed.',
    )
    .join('\n');
}

/**
 * ⚠️ Refuses the WHOLE run, not the offending key: if one line is welded, the
 * file was appended to badly, and the NEXT key in that file is exactly as
 * suspect. Pushing "the good ones" would ship a partial rotation across two
 * instances — the failure `pushBoth` already stops on, arrived at from the
 * other direction.
 */
export function assertNoGluedValues(vars, file = DEV_VARS) {
  const bad = findGluedValues(vars);
  if (bad.length) throw new Error(gluedRefusalMessage(bad, file));
}

/** The things that can happen to one key on one instance. */
export const PUSH_MAIN = 'push main';
export const PUSH_FRIEND = 'push friend';
export const REFUSE_PER_INSTANCE = 'refuse (per-instance)';
export const SKIP_UNSET = 'skip (not set locally)';
export const SKIP_LOCAL_ONLY = 'skip (local only)';
export const REFUSE_UNCLASSIFIED = 'refuse (not a shared secret)';
/**
 * Shared, present locally, and deliberately NOT sent: it would enable a route on
 * the receiver. `NAME` is left as a placeholder on purpose — the concrete key is
 * the very next column of the same line, and the `why` beneath it spells the
 * whole command out.
 */
export const SKIP_OPT_IN = 'skip (opt-in; --enable NAME)';
/**
 * ⚠️ **`--only NAME` NARROWS a plan and can never widen one.** It turns a row
 * that would have been pushed into a skip; it cannot turn a refusal into a push,
 * and it cannot add a key the allowlists did not already contain. That direction
 * is the whole safety argument — `--enable` is the flag that grants, and this
 * one only ever declines.
 *
 * It exists because the safest way to exercise a new value SOURCE is to send one
 * already-live value and change nothing (secrets review §5 step 1), and because
 * a single-key rotation should not have to be a bulk run. The same
 * one-pair-at-a-time discipline the rotation plan (§4) asks for by hand.
 */
export const SKIP_NOT_SELECTED = 'skip (not selected; --only)';

/** Narrow a finished plan to the named keys. Pushes become skips, nothing else moves. */
export function narrowTo(plan, only = []) {
  if (!only.length) return plan;
  const keep = new Set(only);
  const narrow = (rows) =>
    rows.map((row) =>
      (row.action === PUSH_MAIN || row.action === PUSH_FRIEND) && !keep.has(row.name)
        ? { name: row.name, action: SKIP_NOT_SELECTED }
        : row,
    );
  return { main: narrow(plan.main), friend: narrow(plan.friend) };
}

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
  { both = false, friend = false, enable = [] } = {},
  lists = {},
) {
  const shared = lists.shared ?? SHARED_SECRETS;
  const optIn = lists.sharedOptIn ?? SHARED_OPT_IN;
  const production = lists.production ?? PRODUCTION_SECRETS;
  const localOnly = lists.localOnly ?? LOCAL_ONLY;
  const present = new Set(varNames);
  const enabled = new Set(enable);
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
      // "not set locally" first: a key nobody has written down is a GAP, and
      // saying "opt-in" about it would offer a flag that could not work anyway.
      if (!present.has(name)) {
        plan.friend.push({ name, action: SKIP_UNSET });
      } else if (optIn.includes(name) && !enabled.has(name)) {
        plan.friend.push({ name, action: SKIP_OPT_IN, why: optInReason(name) });
      } else {
        plan.friend.push({ name, action: PUSH_FRIEND });
      }
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

/** One sentence, printed beside an opt-in skip, saying what enabling it MEANS. */
export function optInReason(name) {
  const what =
    name === 'EBOOK_INGEST_TOKEN'
      ? 'the ebook importer’s write bearer'
      : name === 'AUDIOBOOK_MAPPING_TOKEN'
        ? 'the audiobook pipeline’s mapping bearer'
        : 'a machine route’s bearer';
  return (
    `route-ENABLING: ${what}. Unset on the receiving instance means that route is ` +
    `DISABLED, so sending it is a capability grant, not a rotation. Push it with ` +
    `\`--enable ${name}\` once the owner has said that instance should have it.`
  );
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
  if (name === 'INDEX_READ_TOKEN') {
    return (
      'per-instance: the index resolves the CALLING APP from which machine read ' +
      "token matched, so main's value would make her requests indistinguishable " +
      "from main's. Hers is piped from the INDEX_READ_TOKEN_FRIEND_PADHARD " +
      'drop-box line with `npm run secret:friend -- INDEX_READ_TOKEN`.'
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

  // `--enable NAME`, repeatable, `--enable=NAME` too. A capability grant should
  // be typed once per key, deliberately — not implied by a batch flag.
  const enable = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--enable' && !a.startsWith('--enable=')) continue;
    const value = a.includes('=') ? a.slice('--enable='.length) : (argv[i + 1] ?? null);
    if (!value || value.startsWith('--')) {
      console.error('--enable needs a key NAME, e.g. --enable EBOOK_INGEST_TOKEN');
      console.error(`Opt-in keys: ${SHARED_OPT_IN.join(', ')}`);
      process.exit(1);
    }
    if (!SHARED_OPT_IN.includes(value)) {
      // Loud, because a typo'd --enable would otherwise look like it worked and
      // silently skip the key the operator meant to turn on.
      console.error(`--enable ${value}: not an opt-in key, so this flag would do nothing.`);
      console.error(`Opt-in keys: ${SHARED_OPT_IN.join(', ')}`);
      console.error('Everything on SHARED_ALWAYS is pushed without a flag; per-instance');
      console.error('keys are refused with a sentence and cannot be enabled from here.');
      process.exit(1);
    }
    enable.push(value);
  }
  // `--only NAME`, repeatable. NARROWS what a run sends; see SKIP_NOT_SELECTED.
  const only = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--only' && !a.startsWith('--only=')) continue;
    const value = a.includes('=') ? a.slice('--only='.length) : (argv[i + 1] ?? null);
    if (!value || value.startsWith('--')) {
      console.error('--only needs a key NAME, e.g. --only HARDCOVER_API_TOKEN');
      process.exit(1);
    }
    only.push(value);
  }

  if (enable.length && !both && !friend) {
    console.error('--enable only applies to a non-main instance — add --friend or --both.');
    console.error('MAIN is the source of truth and already holds these keys.');
    process.exit(1);
  }

  // `--source file` (default) | `--source op`. `SECRETS_SOURCE` does the same.
  const sourceIdx = argv.findIndex((a) => a === '--source' || a.startsWith('--source='));
  let source = process.env.SECRETS_SOURCE || 'file';
  if (sourceIdx !== -1) {
    source = argv[sourceIdx].includes('=')
      ? argv[sourceIdx].split('=')[1]
      : (argv[sourceIdx + 1] ?? '');
  }
  if (source !== 'file' && source !== 'op') {
    console.error(`--source ${source || '(missing)'}: the sources are \`file\` and \`op\`.`);
    console.error('  file — apps/worker/.dev.vars (the default, unchanged)');
    console.error('  op   — the 1Password vault Estate, via apps/worker/.dev.vars.tpl');
    process.exit(1);
  }

  let vars;
  if (source === 'op') {
    vars = await readFromVault({ friend, both });
  } else {
    let raw;
    try {
      raw = readFileSync(DEV_VARS, 'utf8');
    } catch {
      console.error(`No .dev.vars at ${DEV_VARS}. Nothing to push.`);
      console.error('Copy apps/worker/.dev.vars.example and fill it in,');
      console.error('or take the values from the vault instead:  --source op');
      if (friend || both) {
        console.error('');
        console.error('⚠️ There is no `.dev.vars.friend` and there must not be one: the FRIEND');
        console.error('push reads this same MAIN file and sends only the SHARED_SECRETS set.');
      }
      process.exit(1);
    }
    vars = parseDevVars(raw);
  }

  // ⚠️ Before ANY path, including the no-flag one and including --dry-run: a
  // welded value is a broken FILE, and the plan printed from a broken file is
  // itself wrong. Names only — the value never reaches this console.
  //
  // ⚠️ It runs on the `op` path too. A vault item cannot be welded by a `>>`
  // append, but it CAN have been imported from a file that was — and then the
  // corruption is permanent and wears a master's clothes. Cheap; keep it.
  try {
    assertNoGluedValues(vars, source === 'op' ? `the ${VAULT_NAME} vault` : DEV_VARS);
  } catch (err) {
    console.error(err.message);
    console.error('');
    if (source === 'op') {
      console.error('The VAULT item holds a welded value — almost certainly imported from a');
      console.error('.dev.vars that was broken at the time. Fix the item in 1Password, then:');
      console.error('  node scripts/op-import-dev-vars.mjs --dry-run');
    } else {
      console.error('Check the trailing newline before appending:');
      console.error('  tail -c1 apps/worker/.dev.vars | od -c     # want \\n');
      console.error("  printf '\\nKEY=%s\\n' \"$VALUE\" >> apps/worker/.dev.vars");
    }
    process.exit(1);
  }

  console.log(`source: ${source === 'op' ? `1Password vault ${VAULT_NAME} (${TEMPLATE})` : DEV_VARS}`);

  if (!both && !friend) return await pushMainOnly(vars, dry, only);
  return await pushBoth(vars, { both, friend, dry, enable, only });
}

/**
 * Resolve `apps/worker/.dev.vars.tpl` against the vault and parse the result in
 * MEMORY. One `op` process; nothing is written to disk at any point.
 *
 * ⚠️ `op inject` prints the resolved template to stdout, which is exactly what
 * makes the disk-free path possible — and exactly why nothing here may print
 * that stdout. It goes straight into `parseDevVars` and never to a console.
 */
async function readFromVault({ friend, both }) {
  if (!existsSync(TEMPLATE)) {
    console.error(`No template at ${TEMPLATE}, so there is nothing to resolve.`);
    console.error('Generate it from the file that still exists:');
    console.error('  node scripts/op-import-dev-vars.mjs --write-template');
    process.exit(1);
  }

  const r = await runOp(['inject', '-i', TEMPLATE], { bin: opBinary() });
  if (r.code !== 0) {
    // ⚠️ A person must never see a bare exit code: say what happened, what it
    // needs, and how to get it.
    if (isAuthorizationRefusal(r.stderr)) {
      console.error('1Password did not authorize the request, so nothing was read and');
      console.error('nothing was pushed. The desktop app raises an approval prompt for each');
      console.error('`op` process — approve it (Windows Hello / your account password) and');
      console.error('run this again.');
    } else if (/isn't an item|not found|no item matching/i.test(r.stderr)) {
      console.error('The template names an item that is not in the vault, so `op inject`');
      console.error('refused to resolve it. Nothing was pushed — a half-resolved template');
      console.error('would push some keys and silently skip others.');
      console.error('See which items exist, then re-import what is missing:');
      console.error(`  op item list --vault ${VAULT_NAME}`);
      console.error('  node scripts/op-import-dev-vars.mjs --dry-run');
    } else {
      console.error(`op inject failed (exit ${r.code}). Nothing was pushed.`);
      console.error((r.stderr || '').trim().split('\n').slice(0, 3).join('\n'));
    }
    if (friend || both) {
      console.error('');
      console.error('⚠️ Stopped BEFORE either instance — a rotation must not land on one side.');
    }
    process.exit(1);
  }
  return parseDevVars(r.stdout);
}

/**
 * ⚠️ The pre-2026-08-25 behaviour, unchanged down to the spacing. `npm run
 * secrets:push` with no flags must keep doing exactly what the runbook says it
 * does; the "both instances" work is additive and lives in `pushBoth`.
 */
async function pushMainOnly(vars, dry, only = []) {
  const payload = {};
  const skipped = [];
  const selected = (key) => !only.length || only.includes(key);

  for (const key of PRODUCTION_SECRETS) {
    if (!selected(key)) skipped.push(`${key} — not selected (--only)`);
    else if (vars[key]) payload[key] = vars[key];
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
async function pushBoth(vars, { both, friend, dry, enable = [], only = [] }) {
  const plan = narrowTo(planFor(Object.keys(vars), { both, friend, enable }), only);

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

  // A capability grant says so out loud, even on a dry run.
  if (enable.length) {
    console.log(
      `\n⚠️ --enable ${enable.join(', ')} — this ENABLES the matching machine ` +
        'route on the receiving instance, not just the key.',
    );
  }

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
