/**
 * Materialise the estate THEME asset into apps/web/public/estate/.
 *
 * Sibling of sync-estate-auth.mjs — same pattern, third package: the canonical
 * theme system (`--et-*` token contract, three themes × two modes, the
 * switcher, the self-hosted fonts) lives in
 * `catalog-platform/sites/heygabi-home/public/assets/` and is documented in
 * that repo's docs/info/estate-themes.md. This script runs as `prebuild`,
 * `pretest` and `pretypecheck`, so anything that compiles this repo has a
 * current copy and nothing has to remember to run it.
 *
 * ⚠️ THE VENDORED FILES ARE A BUILD ARTIFACT, NOT A FORK. They are gitignored
 * and rewritten every run. If a theme needs a new token or a value looks
 * wrong, the edit belongs in catalog-platform — a local edit here is silently
 * overwritten by the next build.
 *
 * ONE deliberate transformation, not a fork: the canonical CSS references its
 * fonts at `/assets/fonts/…`, but this app's `/assets/*` is Vite's hashed
 * bundle space with a year-long immutable cache (_headers), so everything
 * estate lands under `/estate/…` instead and the font URLs are rewritten to
 * match. The rewrite is pattern-checked — zero replacements fails the build,
 * because that means upstream moved its fonts and this script is now lying.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo (or the asset inside it) is
 * missing. Chosen, not incidental — an index.html that names /estate/theme.js
 * would otherwise ship a 404 and every visitor would get an unstyled,
 * unswitchable page. Better to stop with a message that says what to clone.
 *
 * NOT vendored, on purpose: motion.js (reveal / hero recede / apple tilt) is
 * marketing-page choreography; this is a data-dense catalog you use standing
 * at a shelf, and none of its screens has a hero to recede. estate-auth.js and
 * find.js belong to other systems.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, resolvePlatformRepo } from './lib/platform-repo.mjs';

const OUT_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'estate');

function fail(message) {
  console.error(`\nsync-estate-theme: ${message}\n`);
  process.exit(1);
}

let platformDir;
try {
  const { dir, how } = resolvePlatformRepo();
  platformDir = dir;
  console.log(`sync-estate-theme: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

const SRC_DIR = join(platformDir, 'sites', 'heygabi-home', 'public', 'assets');
if (!existsSync(join(SRC_DIR, 'estate-theme.css'))) {
  fail(
    `catalog-platform found at ${platformDir}, but sites/heygabi-home/public/assets/estate-theme.css is not there.\n` +
      'The theme asset shipped 2026-08-13 (docs/info/estate-themes.md) — an old\n' +
      'checkout predates it. `git pull` in catalog-platform.',
  );
}

// Named explicitly rather than globbed blind, so a file appearing or vanishing
// upstream is a loud diff here, not a silent one. The licence file travels
// with the fonts — self-hosting under the OFL requires it.
const FILES = ['theme.js'];
const FONT_FILES = [
  'rajdhani-400.woff2',
  'rajdhani-600.woff2',
  'rajdhani-700.woff2',
  'share-tech-mono-400.woff2',
  'bangers.woff2',
  'luckiest-guy.woff2',
  'OFL-bangers-luckiestguy.txt',
];

mkdirSync(join(OUT_DIR, 'fonts'), { recursive: true });

// --- estate-theme.css: the one rewritten file ------------------------------
let css = readFileSync(join(SRC_DIR, 'estate-theme.css'), 'utf8');
if (css.trim().length === 0) fail('estate-theme.css is empty at the source — refusing to copy nothing.');
const FONT_URL = /url\('\/assets\/fonts\//g;
const hits = css.match(FONT_URL);
if (!hits || hits.length === 0) {
  fail(
    "estate-theme.css no longer contains url('/assets/fonts/… — upstream moved its\n" +
      'fonts. Update the rewrite in this script after reading the new @font-face block.',
  );
}
css = css.replace(FONT_URL, "url('/estate/fonts/");
writeFileSync(join(OUT_DIR, 'estate-theme.css'), css, 'utf8');
console.log(`sync-estate-theme: estate-theme.css written (${hits.length} font URLs re-rooted to /estate/fonts/).`);

// --- verbatim copies -------------------------------------------------------
for (const name of FILES) {
  const src = join(SRC_DIR, name);
  if (!existsSync(src)) fail(`${name} is missing at the source (${SRC_DIR}).`);
  const body = readFileSync(src, 'utf8');
  if (body.trim().length === 0) fail(`${name} is empty at the source — refusing to copy nothing.`);
  writeFileSync(join(OUT_DIR, name), body, 'utf8');
}
for (const name of FONT_FILES) {
  const src = join(SRC_DIR, 'fonts', name);
  if (!existsSync(src)) {
    fail(
      `fonts/${name} is missing at the source. The self-hosted faces are part of the\n` +
        'contract (no Google Fonts, ever — docs/info/estate-themes.md §6); a theme\n' +
        'without its faces renders in fallbacks and lies about itself.',
    );
  }
  writeFileSync(join(OUT_DIR, 'fonts', name), readFileSync(src));
}

writeFileSync(
  join(OUT_DIR, 'SOURCE.txt'),
  [
    'GENERATED — do not edit, do not commit. Rewritten by scripts/sync-estate-theme.mjs',
    'on every build, test and typecheck.',
    '',
    `source:     ${SRC_DIR}`,
    `generated:  ${new Date().toISOString()}`,
    '',
    'The ONE estate theme implementation lives in catalog-platform',
    '(sites/heygabi-home/public/assets/, contract in docs/info/estate-themes.md).',
    'Edit it there. The only local transformation is the font URL root:',
    "url('/assets/fonts/…') → url('/estate/fonts/…'), because this app's /assets/*",
    'is Vite hash space with an immutable cache rule.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(
  `sync-estate-theme: wrote ${1 + FILES.length + FONT_FILES.length + 1} files to apps/web/public/estate/ (gitignored build artifact).`,
);
