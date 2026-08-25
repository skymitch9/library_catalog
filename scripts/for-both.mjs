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
 */

import { spawn } from 'node:child_process';
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
}

console.log(`\nfor-both: ${script} completed on BOTH instances.`);
