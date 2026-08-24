/**
 * Materialise GABI's canonical conversation substrate into
 * `packages/gabi-conv/generated/`.
 *
 * Runs as `prebuild`, `pretest` and `pretypecheck` beside sync-universes.mjs and
 * sync-estate-auth.mjs, so anything that compiles or exercises this repo has a
 * current copy and nothing has to remember to run it.
 *
 * ⚠️ THE GENERATED FILE IS A BUILD ARTIFACT, NOT A FORK. It is gitignored and
 * rewritten every run. The ONE conversation implementation lives in
 * `catalog-platform/packages/gabi-conversation/src/` — the record shape, the
 * 30-minute/20-turn window, the storage-key rule and the alternation
 * enforcement. GABI's Discord surface reads the same file. That is the entire
 * point: `docs/info/gabi-conversation-continuity.md` in that repo was written
 * before this panel existed, warning that *"the failure mode to avoid is the one
 * every second surface hits: a store whose fields are secretly Discord's, so the
 * web version either re-implements it or carries dead columns."* This script is
 * how that is avoided rather than merely hoped for.
 *
 * If you are tempted to edit the generated file, the edit belongs in that repo,
 * where the substrate's own unit tests live — and where the Discord surface will
 * get it too. An edit here is overwritten by the next build, silently, which is
 * the worst kind of lost work.
 *
 * Why materialise instead of importing across repos by relative path: same
 * argument as sync-universes.mjs and sync-estate-auth.mjs — the bundler needs a
 * static path and `../../catalog-platform/...` is only correct for one checkout
 * layout. Resolution happens once, in scripts/lib/platform-repo.mjs, which names
 * CATALOG_PLATFORM_DIR and every path it tried when it fails.
 *
 * ⚠️ THIS FAILS THE BUILD when the platform repo (or the module inside it) is
 * missing — the same choice sync-estate-auth.mjs makes, for the same reason: a
 * Worker bundled without the module would fail at import time anyway, so it is
 * better to stop with a message that says what to clone.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, resolvePlatformRepo } from './lib/platform-repo.mjs';

const OUT_DIR = join(REPO_ROOT, 'packages', 'gabi-conv', 'generated');

function fail(message) {
  console.error(`\nsync-gabi-conversation: ${message}\n`);
  process.exit(1);
}

let platformDir;
try {
  const { dir, how } = resolvePlatformRepo();
  platformDir = dir;
  console.log(`sync-gabi-conversation: catalog-platform found via ${how} → ${dir}`);
} catch (err) {
  fail(err.message);
}

const SRC_DIR = join(platformDir, 'packages', 'gabi-conversation', 'src');
if (!existsSync(SRC_DIR)) {
  fail(
    `catalog-platform found at ${platformDir}, but packages/gabi-conversation/src is not there.\n` +
      'The substrate was extracted from apps/discord-worker/src/conversation.ts on\n' +
      '2026-08-18 — an older checkout predates it. `git pull` in catalog-platform.',
  );
}

// The module's public surface. Named explicitly rather than globbed blind, so a
// file appearing or vanishing upstream is a loud diff here, not a silent one.
// confirm.ts joined 2026-08-24 with the T2 confirm lane (proposal shape,
// compareAndSet, Restatement, MAC material). index.ts re-exports it; the panel
// imports from here.
const EXPECTED = ['index.ts', 'confirm.ts'];

const present = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'));
const missing = EXPECTED.filter((f) => !present.includes(f));
if (missing.length > 0) {
  fail(
    `the canonical module is missing expected file(s): ${missing.join(', ')}.\n` +
      'Either the platform checkout is stale (git pull) or the module was\n' +
      'restructured upstream — in which case update EXPECTED in this script.',
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

// ⚠️ A structural check per file, not a checksum: a truncated copy typechecks
// for a surprisingly long time before anything notices. Each file names one
// token it must carry — the window constants for index.ts, the confirm grammar
// for confirm.ts — so a restructure that drops the substance fails loudly.
const MARKERS = {
  'index.ts': ['CONVERSATION_WINDOW_MS', 'CONVERSATION_MAX_TURNS', 'withRemembered', 'pruneConversation'],
  'confirm.ts': ['ConfirmChangePending', 'compareAndSet', 'buildRestatement', 'T2_CONFIRMABLE_FIELDS'],
};

for (const name of EXPECTED) {
  const body = readFileSync(join(SRC_DIR, name), 'utf8');
  if (body.trim().length === 0) fail(`${name} is empty at the source — refusing to copy nothing.`);
  for (const token of MARKERS[name] ?? []) {
    if (!body.includes(token)) {
      fail(`${name} arrived without \`${token}\` — the copy is truncated or the module was restructured.`);
    }
  }
  writeFileSync(join(OUT_DIR, name), body, 'utf8');
}

writeFileSync(
  join(OUT_DIR, 'SOURCE.txt'),
  [
    'GENERATED — do not edit, do not commit. Rewritten by scripts/sync-gabi-conversation.mjs',
    'on every build, test and typecheck.',
    '',
    `source:     ${SRC_DIR}`,
    `generated:  ${new Date().toISOString()}`,
    '',
    "The ONE GABI conversation implementation lives in catalog-platform's",
    '@platform/gabi-conversation, shared with the Discord surface. Edit it there;',
    'a local edit here is overwritten by the next build, silently, and would give',
    'the site panel a memory that behaves differently from the one GABI has in',
    'Discord — which is precisely the drift the package exists to prevent.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(
  `sync-gabi-conversation: wrote ${EXPECTED.length} file(s) to packages/gabi-conv/generated/ (gitignored build artifact).`,
);
