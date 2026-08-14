/**
 * Materialise the canonical estate-auth module into packages/estate-auth/generated/.
 *
 * Runs as `prebuild`, `pretest` and `pretypecheck` beside sync-universes.mjs, so
 * anything that compiles or exercises this repo has a current copy and nothing
 * has to remember to run it.
 *
 * ⚠️ THE GENERATED FILES ARE A BUILD ARTIFACT, NOT A FORK. They are gitignored
 * and rewritten every run. The ONE implementation of estate auth lives in
 * `catalog-platform/packages/estate-auth/src/` — the whole reason it exists is
 * that this repo and the games repo once held two copies of `auth.ts` and only
 * one of them received a security hardening (estate-auth-design.md §1.1). If
 * you are tempted to edit a generated file, the edit belongs in that repo,
 * where its 31 unit tests live.
 *
 * Why materialise instead of importing across repos by relative path: same
 * argument as sync-universes.mjs — the bundler needs a static path and
 * `../../catalog-platform/...` is only correct for one checkout layout.
 * Resolution happens once, in scripts/lib/platform-repo.mjs, which names
 * CATALOG_PLATFORM_DIR and every path it tried when it fails.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo (or the module inside it) is
 * missing. Chosen, not incidental: a Worker bundled without the estate module
 * would fail at import time anyway — better to stop the build with a message
 * that says what to clone than to ship a bundle that cannot exist.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, resolvePlatformRepo } from './lib/platform-repo.mjs';

const OUT_DIR = join(REPO_ROOT, 'packages', 'estate-auth', 'generated');

function fail(message) {
  console.error(`\nsync-estate-auth: ${message}\n`);
  process.exit(1);
}

let platformDir;
try {
  const { dir, how } = resolvePlatformRepo();
  platformDir = dir;
  console.log(`sync-estate-auth: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

const SRC_DIR = join(platformDir, 'packages', 'estate-auth', 'src');
if (!existsSync(SRC_DIR)) {
  fail(
    `catalog-platform found at ${platformDir}, but packages/estate-auth/src is not there.\n` +
      'The canonical module ships with the platform repo (design §14.2) — an old\n' +
      'checkout predates it. `git pull` in catalog-platform.',
  );
}

// The module's public surface. Named explicitly rather than globbed blind, so a
// file appearing or vanishing upstream is a loud diff here, not a silent one.
const EXPECTED = ['combine.ts', 'config.ts', 'index.ts', 'probes.ts', 'seen.ts', 'verify.ts'];

const present = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'));
const missing = EXPECTED.filter((f) => !present.includes(f));
if (missing.length > 0) {
  fail(
    `the canonical module is missing expected file(s): ${missing.join(', ')}.\n` +
      'Either the platform checkout is stale (git pull) or the module was\n' +
      'restructured upstream — in which case update EXPECTED in this script\n' +
      'and re-check what packages/estate-auth/src/index.ts re-exports.',
  );
}
const unexpected = present.filter((f) => !EXPECTED.includes(f));
if (unexpected.length > 0) {
  fail(
    `the canonical module grew file(s) this sync does not know: ${unexpected.join(', ')}.\n` +
      'Deliberate friction: a new upstream file may carry new exports this repo\n' +
      'should notice. Add it to EXPECTED after reading it.',
  );
}

mkdirSync(OUT_DIR, { recursive: true });

for (const name of EXPECTED) {
  const body = readFileSync(join(SRC_DIR, name), 'utf8');
  if (body.trim().length === 0) fail(`${name} is empty at the source — refusing to copy nothing.`);
  writeFileSync(join(OUT_DIR, name), body, 'utf8');
}

writeFileSync(
  join(OUT_DIR, 'SOURCE.txt'),
  [
    'GENERATED — do not edit, do not commit. Rewritten by scripts/sync-estate-auth.mjs',
    'on every build, test and typecheck.',
    '',
    `source:     ${SRC_DIR}`,
    `generated:  ${new Date().toISOString()}`,
    '',
    'The ONE estate-auth implementation lives in catalog-platform (design §8.1,',
    '§14.2, with its own unit tests). Edit it there; a local edit here is',
    'overwritten by the next build, silently, which is the worst kind of lost work.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(
  `sync-estate-auth: wrote ${EXPECTED.length} files to packages/estate-auth/generated/ (gitignored build artifact).`,
);
