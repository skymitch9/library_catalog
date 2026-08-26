/**
 * Spawning the 1Password CLI, and telling its failures apart. Plumbing only —
 * no naming policy, no allowlists, no knowledge of this repo's secrets.
 *
 * ⚠️ **It lives in its own file to break an import CYCLE, and that cycle was a
 * DEADLOCK, not a warning.** `op-import-dev-vars.mjs` imports the lists and the
 * glued-value guard from `push-secrets.mjs`; when `push-secrets.mjs` then
 * reached back for `runOp` with a dynamic `import()`, the request queued behind
 * its own module evaluation — which was blocked on `if (isEntrypoint) await
 * main()`. Node reported it as *"Detected unsettled top-level await"* and exited
 * **13** with no other output: a hang wearing a crash's clothes. Both modules
 * now depend on this one and on nothing of each other's.
 */

import { spawn } from 'node:child_process';

/**
 * ⚠️ `op` is installed by winget and is NOT on PATH in any shell that predates
 * the install (measured 2026-08-26, CLI 2.34.1). Resolved by name first — so a
 * later PATH install or a non-Windows machine wins — then at the winget package
 * path. `OP_CLI` overrides both.
 */
export const OP_FALLBACK =
  'C:\\Users\\nbasl\\AppData\\Local\\Microsoft\\WinGet\\Packages\\AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe\\op.exe';

export function opBinary(env = process.env) {
  if (env.OP_CLI) return env.OP_CLI;
  return process.platform === 'win32' ? OP_FALLBACK : 'op';
}

/**
 * Spawn `op`, optionally writing `stdin`. Resolves `{ code, stdout, stderr }`
 * and never rejects — a caller decides what a failure means.
 *
 * ⚠️ **Sensitive values go in `stdin`, never in `args`.** `op item create
 * --help` gives this instruction itself: *"Command arguments get logged in your
 * command history, and can be visible to other processes on your machine."*
 * Same reasoning as `push-secrets.mjs`'s `spawnBulk`.
 */
export function runOp(args, { stdin = null, bin = opBinary() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/**
 * ⚠️ **The authorization prompt is a HUMAN step, and its failure has a name.**
 *
 * The 1Password desktop app raises an approval prompt for an `op` process.
 * Dismissed or unanswered, `op` writes `authorization prompt dismissed` /
 * `authorization timeout` to stderr — measured 2026-08-26, both forms, before
 * the first successful import. It is not a bug to retry blindly and it is not a
 * permission the estate can grant: somebody has to click Approve.
 */
export function isAuthorizationRefusal(stderr = '') {
  return /authorization (prompt dismissed|timeout)|not currently signed in/i.test(stderr);
}

/** A sentence a person can act on. ⚠️ Never a bare exit code. */
export function opFailureMessage(action, title, { code, stderr }) {
  if (isAuthorizationRefusal(stderr)) {
    return (
      `${action} ${title}: 1Password did not authorize the request. The desktop app ` +
      'raises an approval prompt for each `op` process — approve it (Windows Hello ' +
      'or your account password) and run this again. Nothing was written.'
    );
  }
  const first = (stderr || '').trim().split('\n')[0] || 'No detail on stderr.';
  return `${action} ${title}: op exited ${code}. ${first}`;
}
