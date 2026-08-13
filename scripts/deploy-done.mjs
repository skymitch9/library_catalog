/**
 * Release the deploy lock and record what went live.
 *
 * Runs as `postdeploy`, so it only fires when the deploy succeeded — which is
 * exactly right: a failed deploy did not change what is live, so the log must not
 * claim it did. ⚠️ The cost of that choice is a lock left behind by a crashed
 * deploy, which `deploy-guard.mjs` handles with its staleness timeout rather than
 * by writing an optimistic log entry here.
 *
 * `docs/deploys.log` is **tracked in git**, deliberately. It is the one record
 * both concurrent runs can read, it is what the guard's ancestry check keys on,
 * and committing it means "what is live" is answerable from the repo alone rather
 * than by asking Cloudflare.
 *
 * ⚠️ It writes the log but does NOT commit it — committing from a deploy hook
 * would create commits nobody asked for, in the middle of someone else's work.
 * The run that deployed commits it, which is also what puts it in front of a human.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const LOCK = join(ROOT, '.deploy.lock');
const LOG = join(ROOT, 'docs', 'deploys.log');

const holder = process.env['DEPLOY_HOLDER'] || 'unknown';

let head = 'unknown';
try {
  head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout — still worth releasing the lock */
}

/**
 * Best-effort: ask Cloudflare which version is now live, so the log carries the
 * same id the dashboard shows. Wrapped because it is a network call in a hook —
 * a slow or failed lookup must not fail a deploy that already succeeded.
 */
let version = '';
try {
  const out = execFileSync(
    'npx',
    ['wrangler', 'deployments', 'list', '--config', 'apps/worker/wrangler.toml'],
    { cwd: ROOT, encoding: 'utf8', timeout: 45_000, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  version = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? '';
} catch {
  /* leave it blank rather than guess */
}

mkdirSync(dirname(LOG), { recursive: true });
appendFileSync(
  LOG,
  `${new Date().toISOString()}\t${head}\t${holder}\t${version || 'version-unknown'}\n`,
);
if (existsSync(LOCK)) rmSync(LOCK);

console.log(
  `deploy-done: recorded ${head.slice(0, 8)} by "${holder}"` +
    `${version ? ` as ${version.slice(0, 8)}` : ''} in docs/deploys.log — lock released.`,
);
console.log('deploy-done: ⚠️ commit docs/deploys.log so the other run can see it.');
