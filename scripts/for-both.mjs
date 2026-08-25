#!/usr/bin/env node
/**
 * Run one ops command against BOTH instances — main first, then padhard —
 * stopping on the first failure.
 *
 * Owner ask, 2026-08-25: *"we should do something so we dont need to always do
 * different things for these 2 libraries."*
 *
 *   node scripts/for-both.mjs deploy                    # deploy, then deploy:friend
 *   node scripts/for-both.mjs db:migrate                # db:migrate, then db:migrate:friend
 *   node scripts/for-both.mjs backfill:covers -- --remote --commit
 *
 * ## ⚠️ Why this is a RUNNER and not a `--both` flag in `scripts/lib/d1.mjs`
 *
 * That was the first design, and it does not fit. `parseFlags()` returns one
 * `{ commit, remote, friend, limit }` object and every backfill in `scripts/`
 * reads it ONCE and then runs its single pass — the sweep, the report and the
 * writes are all built around one target. Teaching `parseFlags` about `--both`
 * would make it return something no caller's control flow can use, so each of
 * the ~15 backfills would have to grow a loop of its own. Fifteen copies of the
 * same loop is exactly the near-duplicate this project bans.
 *
 * The loop belongs in ONE place, above the scripts, which is here. `--friend`
 * inside `d1.mjs` stays exactly as it is (remote-only, guarded), and this runner
 * simply supplies it twice.
 *
 * ## The two shapes it handles
 *
 * 1. **A `:friend` TWIN exists** (`deploy` ↔ `deploy:friend`) — run both npm
 *    scripts. This is the only correct form for `deploy` and `db:migrate`,
 *    whose friend variants change wrangler's `--env`, not a script flag.
 * 2. **No twin** (`backfill:covers`) — run the same script twice, appending
 *    `--friend` the second time. `d1.mjs` refuses `--friend` without `--remote`
 *    with a worded error, and that refusal is left to fire rather than being
 *    second-guessed here.
 *
 * ⚠️ It does NOT roll back. A failure on the second instance leaves the first
 * one applied, which is the honest state — the alternative is a runner that
 * un-deploys a good deploy. It says so plainly and exits non-zero.
 *
 * ## ⚠️ Why this commits `docs/deploys.log` between the halves
 *
 * Found the first time `deploy:both` was run, 2026-08-25: main deploys →
 * `postdeploy` runs `deploy-done.mjs`, whose whole job is to APPEND a line to
 * `docs/deploys.log` → the tree is now dirty → the friend half's
 * `predeploy:friend` runs `check-clean.mjs`, which refuses. The requirement is
 * circular — the deploy is what writes the file — so the runner settles it.
 *
 * ⚠️ **Path-limited, one file, and only when it is the ONLY dirty path.**
 * `git commit -- docs/deploys.log` commits that path alone and never touches
 * the index, so it is safe beside a human or another agent with work in
 * progress. Anything else dirty and the runner **STOPS** rather than
 * committing: the estate's rule for a job that commits is an explicit
 * allowlist, never `git add -A`, and this is that rule with a list of one.
 *
 * ⚠️ **`check-clean.mjs` is deliberately NOT relaxed.** Teaching a deploy guard
 * to ignore a path is a change to the thing that stops uncommitted CODE
 * reaching production, and it would apply to every deploy for ever. Committing
 * the log — which `deploy-done.mjs` already tells you to do — costs nothing and
 * leaves the guard exactly as strict as it was.
 */

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const script = argv[0];
if (!script || script.startsWith('-')) {
  console.error('usage: node scripts/for-both.mjs <npm-script> [-- <args passed to both runs>]');
  console.error('e.g.   node scripts/for-both.mjs backfill:covers -- --remote --commit');
  process.exit(1);
}
// Everything after the first `--` is forwarded to BOTH runs unchanged.
const sepIdx = argv.indexOf('--');
const passthrough = sepIdx === -1 ? argv.slice(1) : argv.slice(sepIdx + 1);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (!pkg.scripts?.[script]) {
  console.error(`for-both: package.json has no script "${script}".`);
  process.exit(1);
}
const twin = `${script}:friend`;
const hasTwin = Boolean(pkg.scripts?.[twin]);

/** One `npm run` child, inheriting stdio so the underlying output is the output. */
function runNpm(name, args) {
  return new Promise((resolveExit) => {
    // `shell: true` because npm is a .cmd on Windows and Node 20+ refuses to
    // spawn one directly (EINVAL). Nothing here interpolates user input beyond
    // the argv this process was given, and the parts are quoted.
    const parts = ['run', name, ...(args.length ? ['--', ...args] : [])];
    const child = spawn('npm', parts.map((p) => `"${String(p).split('"').join('\\"')}"`), {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => resolveExit(code ?? 1));
  });
}

/** The one file this runner may ever commit. See the header. */
const DEPLOY_LOG = 'docs/deploys.log';

function git(args) {
  // No shell: nothing here goes near PowerShell quoting, which is why a commit
  // message can be passed with -m safely from this script and not from a
  // chained shell command.
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

/** `XY path`, or `XY old -> new` for a rename. */
function pathOf(line) {
  const rest = line.slice(3).trim();
  const arrow = rest.indexOf(' -> ');
  return (arrow === -1 ? rest : rest.slice(arrow + 4)).replace(/^"|"$/g, '');
}

/**
 * Commit the deploy log the half that just finished wrote, so the NEXT half's
 * `check-clean` sees a clean tree. Returns false when it cannot, having said
 * why — the caller then stops rather than producing a confusing guard failure.
 */
function settleDeployLog(label) {
  let dirty;
  try {
    dirty = git(['status', '--porcelain']).split('\n').filter((l) => l.trim() !== '');
  } catch {
    console.log('for-both: no git available — leaving the tree alone.');
    return true;
  }
  if (dirty.length === 0) return true;

  const others = dirty.filter((l) => pathOf(l) !== DEPLOY_LOG);
  if (others.length > 0) {
    console.error(`\nfor-both: STOPPING after ${label}. The tree is dirty beyond ${DEPLOY_LOG}:\n`);
    for (const line of others.slice(0, 20)) console.error(`  ${line}`);
    console.error(
      [
        '',
        'The next instance would be refused by check-clean, and this runner will not',
        'commit anything but the deploy log. Commit or set aside the work above, then',
        'run the remaining half on its own (e.g. `npm run deploy:friend`).',
        '',
      ].join('\n'),
    );
    return false;
  }

  git(['commit', '-m', `deploys.log: ${script} — ${label} half (for-both)`, '--', DEPLOY_LOG]);
  console.log(`\nfor-both: committed ${DEPLOY_LOG} for the ${label} half.`);
  return true;
}

const runs = hasTwin
  ? [
      { label: 'MAIN', name: script, args: passthrough },
      { label: 'FRIEND', name: twin, args: passthrough },
    ]
  : [
      { label: 'MAIN', name: script, args: passthrough },
      { label: 'FRIEND', name: script, args: [...passthrough, '--friend'] },
    ];

for (const [i, run] of runs.entries()) {
  console.log(`\n=== for-both ${i + 1}/${runs.length}: ${run.label} — npm run ${run.name} ===\n`);
  const code = await runNpm(run.name, run.args);
  if (code !== 0) {
    console.error(
      `\nfor-both: ${run.label} exited ${code}. STOPPING.` +
        (i === 0
          ? ' Nothing ran against the second instance.'
          : ' ⚠️ MAIN already succeeded — the instances are now out of step until this is re-run.'),
    );
    process.exit(code);
  }
  // Between halves only. After the LAST one the caller owns the tree, and a
  // runner that tidied up behind itself would hide what just changed.
  if (i < runs.length - 1 && !settleDeployLog(run.label)) process.exit(1);
}

console.log(`\nfor-both: ${script} completed on BOTH instances.`);
console.log(`⚠️ commit ${DEPLOY_LOG} — the last half's line is still uncommitted.`);
