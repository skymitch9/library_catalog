/**
 * Prove the Python fold and the TypeScript fold still agree.
 *
 * ## Why this script exists
 *
 * `work_key` is the bridge between this catalog and the audiobook one, and it is
 * computed in **two languages**: `packages/core/src/titles.ts` (the Worker, the
 * web app, the review backfill) and `scripts/index_cwa_library.py` (the ebook
 * indexer, which runs inside a Docker container with no Node in it).
 *
 * Two implementations of one rule is exactly the shape this household has
 * already been bitten by — `audiobook_catalog` has **four** author-splitters and
 * two of them disagree, and its own docs record that keeping them in sync was a
 * real, silent bug.
 *
 * Here it would be worse than silent. A drifted fold does not throw. It writes a
 * `work` whose reviews are invisible, and a review whose book cannot be found,
 * and both look completely normal until someone notices a rating that should be
 * there and is not.
 *
 * So: the TypeScript is authoritative, the Python is a port, and this script is
 * the thing that catches the port going stale.
 *
 *     npm run check:fold
 *
 * ⚠️ Run it after **any** change to `normaliseTitle`, `splitAuthors`,
 * `primaryAuthor` or `workKeyFor`. `npm test` does not cover this — it cannot,
 * because it would need a Python interpreter.
 *
 * Requires `python` on PATH. Skips with a clear message if there is none, rather
 * than failing a checkout that simply has no Python.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { workKeyFor } from '../packages/core/src/titles.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

/**
 * The fixture. Every line is `title|authors`.
 *
 * Each one is here because it exercises a rule that could plausibly be ported
 * wrong, not for coverage's sake:
 */
const CASES = [
  // diacritic folding and the ampersand rule
  'The Café & Bar|Brandon Sanderson',
  // the plain case, and the one the whole bridge was designed around
  'Firefight|Brandon Sanderson',
  // leading article stripped from the title but NOT from a series name
  'A Court of Mist and Fury|Sarah J. Maas',
  // a colon subtitle survives — it is part of the title
  'Mistborn: The Final Empire|Brandon Sanderson',
  // a bare trailing number IS the title and must not be treated as a volume
  'Summoner 6|Eric Vall',
  // multi-author, and a translator who must never become the primary author
  "The Healer's Way|Oleg Sapphire, Alexey Kovtunov, Jennifer E. Sunseri - Translator",
  // ' and ' as a separator, not as part of a name
  'Warrior Fae|Caroline Peckham and Susanne Valenti',
  // punctuation-only difference from the row above
  'Warrior Fae|Caroline Peckham, Susanne Valenti',
  // an apostrophe inside a single-word author
  "Dragon's Justice|Bruce Sentar",
  // a title that is only punctuation once folded, guarding against an empty half
  'Gold|Raven Kennedy',
];

const dir = mkdtempSync(path.join(tmpdir(), 'fold-parity-'));
const fixture = path.join(dir, 'keys.txt');
writeFileSync(fixture, CASES.join('\n') + '\n', 'utf8');

const tsKeys = CASES.map((line) => {
  const i = line.indexOf('|');
  return workKeyFor(line.slice(0, i), line.slice(i + 1));
});

const PY = `
import sys, types, importlib.util
sys.modules.setdefault("requests", types.ModuleType("requests"))
sys.modules["requests"].RequestException = Exception
spec = importlib.util.spec_from_file_location("idx", ${JSON.stringify(
  path.join(repo, 'scripts', 'index_cwa_library.py'),
)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for line in open(${JSON.stringify(fixture)}, encoding='utf-8'):
    line = line.strip()
    if not line: continue
    t, a = line.split('|', 1)
    print(m.work_key(t, a))
`;

let pyOut;
try {
  pyOut = execFileSync('python', ['-c', PY], { encoding: 'utf8' });
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('no `python` on PATH — skipping fold parity check');
    process.exit(0);
  }
  console.error('python failed:\n', err.stderr || err.message);
  process.exit(1);
}

const pyKeys = pyOut.trim().split(/\r?\n/);

let failures = 0;
for (let i = 0; i < CASES.length; i++) {
  if (pyKeys[i] !== tsKeys[i]) {
    failures++;
    console.error(`MISMATCH  ${CASES[i]}`);
    console.error(`   ts: ${tsKeys[i]}`);
    console.error(`   py: ${pyKeys[i]}`);
  }
}

if (pyKeys.length !== tsKeys.length) {
  failures++;
  console.error(`line count differs: ts ${tsKeys.length}, py ${pyKeys.length}`);
}

if (failures) {
  console.error(
    `\n${failures} mismatch(es). The TypeScript is authoritative — fix ` +
      'normalise_title / primary_author in scripts/index_cwa_library.py to match, ' +
      'then consider whether any work_key already stored has moved.',
  );
  process.exit(1);
}

console.log(`fold parity OK — ${CASES.length} cases identical in both languages`);
