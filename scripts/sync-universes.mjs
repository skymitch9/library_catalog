/**
 * Materialise the shared universe list into packages/universes/generated/.
 *
 * Runs as `prebuild`, `pretest` and `pretypecheck`, so anything that compiles or
 * exercises this repo has a current copy and nothing has to remember to run it.
 *
 * ⚠️ THE GENERATED FILES ARE A BUILD ARTIFACT, NOT A SECOND SOURCE OF TRUTH.
 * They are gitignored and rewritten every run. The one copy of these decisions
 * lives in catalog-platform/data/. If you are tempted to edit the generated
 * file, you want `node tools/universes.mjs` in that repo — it is the editor,
 * and it refuses an edit that cannot say why it happened.
 *
 * Why materialise instead of importing across repos by relative path: the
 * bundler needs a static path, and `../../catalog-platform/...` is only correct
 * for one checkout layout. Resolution happens here, once, in JavaScript that can
 * explain itself when it fails — see scripts/lib/platform-repo.mjs.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo is missing. That is chosen, not
 * incidental. A Worker bundled with an empty universe list would answer "no
 * universe" to every question and look like a data problem for months.
 * audiobook_catalog makes the opposite choice for the opposite reason — its
 * pipeline runs unattended three times a day and must not die over reference
 * data. Both are documented in catalog-platform/docs/UNIVERSES.md §6.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, platformPaths, resolvePlatformRepo } from './lib/platform-repo.mjs';

const OUT_DIR = join(REPO_ROOT, 'packages', 'universes', 'generated');

function fail(message) {
  console.error(`\nsync-universes: ${message}\n`);
  process.exit(1);
}

let paths;
try {
  const { dir, how } = resolvePlatformRepo();
  paths = platformPaths(dir);
  console.log(`sync-universes: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

// Validate at the source, with the source's own validator. One implementation of
// the rules, in the repo that owns them — this repo never re-implements them.
try {
  execFileSync(process.execPath, [paths.cli, 'validate'], { stdio: 'pipe', encoding: 'utf8' });
  execFileSync(process.execPath, [paths.cli, 'fixtures'], { stdio: 'pipe', encoding: 'utf8' });
} catch (err) {
  fail(
    'the shared universe list did not pass its own validation, so nothing was copied.\n' +
      'Fix it in catalog-platform, not here:\n\n' +
      `  node tools/universes.mjs validate\n  node tools/universes.mjs fixtures\n\n` +
      `${err.stdout ?? ''}${err.stderr ?? ''}`,
  );
}

mkdirSync(OUT_DIR, { recursive: true });

let count = 0;
for (const [name, src] of [
  ['universes.json', paths.universes],
  ['universes.fixtures.json', paths.fixtures],
  // ⚠️ Not universe data: the fold-pinning fixtures for the shared index
  // Worker (catalog-platform/apps/index-worker). Its work_fold replicates what
  // this repo's work_key means, so its fold is pinned to normaliseTitle by
  // this file, and packages/core/test/fold-fixtures.test.ts asserts every case
  // reproduces. It rides this sync because the mechanism is identical: one
  // tracked copy in catalog-platform, gitignored materialised copies here.
  ['match-fold.fixtures.json', paths.foldFixtures],
]) {
  const body = readFileSync(src, 'utf8');
  JSON.parse(body); // belt and braces: never write something the bundler cannot parse
  writeFileSync(join(OUT_DIR, name), body, 'utf8');
  count += 1;
}

writeFileSync(
  join(OUT_DIR, 'SOURCE.txt'),
  [
    'GENERATED — do not edit, do not commit. Rewritten by scripts/sync-universes.mjs',
    'on every build, test and typecheck.',
    '',
    `source:     ${paths.dir}`,
    `generated:  ${new Date().toISOString()}`,
    '',
    'The one copy of these decisions lives in catalog-platform/data/. Edit it there,',
    'through `node tools/universes.mjs`, which refuses an edit with no reason.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`sync-universes: wrote ${count} files to packages/universes/generated/ (gitignored build artifact).`);
