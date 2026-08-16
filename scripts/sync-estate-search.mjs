/**
 * Materialise the shared <estate-search> custom element into
 * apps/web/public/estate/.
 *
 * Fourth sibling of sync-universes.mjs / sync-estate-auth.mjs /
 * sync-estate-theme.mjs, same pattern, same reasoning: the ONE cross-catalog
 * search component lives in
 * `catalog-platform/sites/heygabi-home/public/assets/estate-search.js` (the
 * extracted-from-find.js element, catalog-platform docs/TODO.md §0.1) and a
 * search improvement made THERE has to reach this app rather than dying at the
 * apex. This script runs as `prebuild`, `pretest` and `pretypecheck` beside the
 * other three, so anything that compiles this repo has a current copy and
 * nothing has to remember to run it.
 *
 * ⚠️ THE VENDORED FILE IS A BUILD ARTIFACT, NOT A FORK. It is gitignored (the
 * `apps/web/public/estate/` rule, shared with the theme) and rewritten every
 * run. If the search needs a new attribute or a ranking looks wrong, the edit
 * belongs in catalog-platform — a local edit here is silently overwritten by
 * the next build, which is the worst kind of lost work.
 *
 * ⚠️ IT LANDS BESIDE THE THEME ON PURPOSE, in the SAME directory. The
 * component resolves its optional sibling modules relative to `import.meta.url`
 * (`estate-auth.js`, `estate-scan.js`), so "vendor sibling assets together" is
 * the upstream contract, not a tidiness preference. Each sync script owns its
 * own provenance file (`SOURCE.txt` is the theme's; this one writes
 * `SOURCE-estate-search.txt`) so two scripts writing one directory cannot
 * clobber each other's record.
 *
 * NOT vendored, deliberately, and neither is a gap:
 *   - `estate-auth.js` — the component only dynamic-imports it when
 *     `auth="authed"` AND no `.authAdapter` property is set. This app sets that
 *     property, from its OWN firebase.ts (same Firebase project, same session),
 *     so the import never fires. Copying it in would put a SECOND Firebase SDK
 *     loader on a page that already has one — see
 *     apps/web/src/lib/estate-search.ts for the whole argument.
 *   - `estate-scan.js` — only reached when the `scan` attribute is present.
 *     This app does not set it: scanning here is a first-class screen of its
 *     own (`/add`, apps/web/src/pages/ScanPage.tsx) with the catalog's own
 *     add-to-shelf flow behind it, which a search box cannot do.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo (or the asset inside it) is
 * missing. Chosen, not incidental — the React wrapper imports `/estate/
 * estate-search.js` at runtime, so a missing file is a search box that renders
 * an apology instead of a search box. Better to stop with a message that says
 * what to clone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, resolvePlatformRepo } from './lib/platform-repo.mjs';

const OUT_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'estate');

function fail(message) {
  console.error(`\nsync-estate-search: ${message}\n`);
  process.exit(1);
}

let platformDir;
try {
  const { dir, how } = resolvePlatformRepo();
  platformDir = dir;
  console.log(`sync-estate-search: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

const SRC_DIR = join(platformDir, 'sites', 'heygabi-home', 'public', 'assets');
const SRC = join(SRC_DIR, 'estate-search.js');
if (!existsSync(SRC)) {
  fail(
    `catalog-platform found at ${platformDir}, but sites/heygabi-home/public/assets/estate-search.js is not there.\n` +
      'The component shipped 2026-08-15 (that repo\'s docs/TODO.md §0.1) — an old\n' +
      'checkout predates it. `git pull` in catalog-platform.',
  );
}

const body = readFileSync(SRC, 'utf8');
if (body.trim().length === 0) fail('estate-search.js is empty at the source — refusing to copy nothing.');

// Pattern-checked rather than copied blind, for the same reason the theme sync
// checks its font URLs: this file is loaded by TAG NAME from a React wrapper
// that cannot tell "the element was never defined" from "the network was slow".
// If the define call is ever renamed upstream, that must be a loud failure here
// and not a search panel that spins forever in production.
const DEFINE = "customElements.define('estate-search'";
if (!body.includes(DEFINE)) {
  fail(
    `estate-search.js no longer contains ${DEFINE}… — the element was renamed or\n` +
      'restructured upstream. Read the new file and update BOTH this check and the\n' +
      "tag name in apps/web/src/lib/estate-search.ts before shipping; the wrapper\n" +
      'waits on `customElements.whenDefined()` and would otherwise hang forever.',
  );
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'estate-search.js'), body, 'utf8');

writeFileSync(
  join(OUT_DIR, 'SOURCE-estate-search.txt'),
  [
    'GENERATED — do not edit, do not commit. Rewritten by scripts/sync-estate-search.mjs',
    'on every build, test and typecheck.',
    '',
    `source:     ${SRC}`,
    `generated:  ${new Date().toISOString()}`,
    '',
    'The ONE <estate-search> implementation lives in catalog-platform',
    '(sites/heygabi-home/public/assets/estate-search.js, contract in its',
    'docs/TODO.md §0.1). Edit it there. Nothing is transformed on the way in —',
    'unlike the theme CSS, this file is copied verbatim.',
    '',
    'Consumed by apps/web/src/lib/estate-search.ts, which imports it by URL at',
    'runtime and then waits on customElements.whenDefined(\'estate-search\').',
    '',
  ].join('\n'),
  'utf8',
);

console.log('sync-estate-search: wrote 2 files to apps/web/public/estate/ (gitignored build artifact).');
