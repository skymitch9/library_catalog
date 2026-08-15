// scripts/lib/platform-repo.mjs
//
// Finding the sibling `catalog-platform` checkout.
//
// ⚠️ catalog-platform is a CODE DEPENDENCY of this repo, not a docs repo. It
// owns data/universes.json — the shared fictional-universe list that this
// catalog and audiobook_catalog both read. Neither keeps a copy in git.
//
// A bare relative path (`../../catalog-platform/...`) would work on this machine
// and break on any checkout laid out differently, so resolution is explicit and
// its failure is loud. A build that quietly ships no universes is worse than a
// build that stops: the first is discovered months later by a wrong answer, the
// second by the person who caused it, immediately.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

/** The env var that overrides everything. Named in every failure message. */
export const ENV_VAR = 'CATALOG_PLATFORM_DIR';

/** Relative to this repo's root, in the order they are tried. */
const CANDIDATES = [
  join('..', 'catalog-platform'), // bookbuddy/catalog-platform
  join('..', '..', 'catalog-platform'), // vs-code-repos/catalog-platform  ← the real layout
  join('..', '..', '..', 'catalog-platform'),
];

/** A directory is the platform repo if it holds the file we came for. */
function looksRight(dir) {
  return existsSync(join(dir, 'data', 'universes.json'));
}

/**
 * @returns {{ dir: string, how: string, tried: string[] }}
 * @throws  {Error} with a message that says what to do about it.
 */
export function resolvePlatformRepo() {
  const tried = [];

  const fromEnv = process.env[ENV_VAR];
  if (fromEnv) {
    const dir = resolve(fromEnv);
    tried.push(`${ENV_VAR}=${dir}`);
    if (looksRight(dir)) return { dir, how: ENV_VAR, tried };
    throw new Error(
      `${ENV_VAR} is set to ${dir}, but there is no data/universes.json there.\n` +
        `Point it at the root of the catalog-platform checkout, not at data/.`,
    );
  }

  for (const rel of CANDIDATES) {
    const dir = resolve(REPO_ROOT, rel);
    tried.push(dir);
    if (looksRight(dir)) return { dir, how: `sibling lookup (${rel})`, tried };
  }

  throw new Error(
    'Cannot find the catalog-platform checkout.\n\n' +
      'It owns data/universes.json, the shared universe list this repo reads at\n' +
      'build time. It is a code dependency, not documentation — there is no copy\n' +
      'in this repo on purpose, because two copies drift.\n\n' +
      'Tried:\n' +
      tried.map((t) => `  - ${t}`).join('\n') +
      `\n\nFix: clone catalog-platform next to this repo, or set ${ENV_VAR} to its root:\n` +
      `  PowerShell   $env:${ENV_VAR} = "C:\\path\\to\\catalog-platform"\n` +
      `  bash         export ${ENV_VAR}=/path/to/catalog-platform\n`,
  );
}

/** Paths inside the platform repo, once it is found. */
export function platformPaths(dir) {
  return {
    dir,
    universes: join(dir, 'data', 'universes.json'),
    fixtures: join(dir, 'data', 'universes.fixtures.json'),
    // The fold-pinning fixtures for the index Worker's join key. Same contract
    // shape as the universes fixtures: one file, N implementations, each
    // repo's CI reproduces every case. This repo's normaliseTitle is the
    // implementation being pinned — see packages/core/test/fold-fixtures.test.ts.
    foldFixtures: join(dir, 'data', 'match-fold.fixtures.json'),
    // The TITLE/KEY cross-language drift guard (normalization item 1):
    // normaliseTitle, bookIdFromTitle, splitAuthors, workKeyFor,
    // cleanAudiobookTitle/cleanTitleWithSeries, splitSeriesPrefix — every
    // function whose output is a PERSISTED key. This repo's titles.ts/
    // reviews.ts are the canon for all but bookIdFromTitle (audiobook's
    // site/reviews.js). See packages/core/test/title-key-fixtures.test.ts.
    titleKeyFixtures: join(dir, 'data', 'title-key-fixtures.json'),
    cli: join(dir, 'tools', 'universes.mjs'),
    // ⚠️ Node's ESM loader rejects a bare Windows path ("C:/..." reads as a URL
    // scheme). Anything doing a dynamic import of the platform's lib needs this.
    libUrl: pathToFileURL(join(dir, 'tools', 'lib', 'universes.mjs')).href,
  };
}
