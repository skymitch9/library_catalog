/**
 * The universe page must not show a person a bare status code.
 *
 * ⚠️ THE DEFECT THIS PINS. `UniversePage.tsx` caught a failed
 * `api.universe()` and did `setError(err instanceof Error ? err.message :
 * String(err))`. An `ApiError`'s `message` is the SERVER'S MACHINE CODE —
 * `body?.error ?? "HTTP <status>"` — so the page rendered the literal word
 * `forbidden`, or the literal string `HTTP 503`, straight at a household
 * member. That is the estate rule broken twice over: a bare status, and an
 * OUTAGE (`estate_unreachable`, a 503) worded identically to a refusal, which
 * sends people asking for access they already have. Found by the LLM-billing
 * design read (`catalog-platform/docs/info/llm-billing-control-design.md`
 * §6.1, defect 2 of 3) and fixed 2026-08-26 by routing through
 * `describeError`, the one place that turns a failure into words.
 *
 * ⚠️ WHY THIS IS A SOURCE-GREP AND NOT A RENDER TEST — the same reason
 * `errors.test.ts`'s own header gives, and it is not preference: the import
 * chain `errors.ts → api.ts → firebase.ts` reads `import.meta.env`, which is
 * `undefined` outside Vite, so importing either `describeError` or the page
 * under `tsx` dies at module load before any assertion could run. The repo's
 * existing answer to that is a source assertion (`instance-default-theme`,
 * `facet-list-agreement`, `bulk-action-bar-hooks` all do this), so this
 * follows the same shape.
 *
 * It asserts the file was actually READ and the catch block was actually
 * FOUND before it asserts anything about them — a grep-based guard's failure
 * mode is passing vacuously against a file it could not parse.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

function repoFile(relative: string): string {
  // fileURLToPath, not a URL object — readFileSync(URL) does not typecheck
  // across this repo's two TS libs (instance-default-theme.test.ts hit this).
  return readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url).href), 'utf8');
}

const SOURCE = repoFile('apps/web/src/pages/UniversePage.tsx');

/**
 * ⚠️ Comments are stripped before the "never renders err.message" assertion,
 * and finding that out cost a red test on the first run: the fix's OWN comment
 * explains what `err.message` would have shown, so a whole-file grep failed on
 * the very change it was written to protect. Stripping is not a loosening —
 * the point is that the CODE must not do it, and a guard that forbids naming
 * the defect in prose is a guard that deletes its own explanation.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const CODE = code(SOURCE);

describe('UniversePage — no bare status ever reaches a person', () => {
  it('the source was read and still contains the failing api.universe() call', () => {
    assert.ok(SOURCE.length > 0, 'UniversePage.tsx read as empty — an empty read is a failed read');
    assert.ok(CODE.length > 0, 'comment-stripping ate the whole file — the stripper is wrong, not the page');
    assert.match(
      CODE,
      /api\s*\n?\s*\.universe\(name\)/,
      'api.universe(name) is gone — if the page was rewritten, re-point this test; do NOT delete it',
    );
    assert.match(CODE, /\.catch\(/, 'no catch block — the failure path this test guards has moved');
  });

  it('⚠️ routes the failure through describeError', () => {
    assert.match(
      CODE,
      /import \{ describeError \} from '\.\.\/lib\/errors\.js'/,
      'UniversePage no longer imports describeError — every screen shows errors through lib/errors.ts',
    );
    assert.match(CODE, /setError\(describeError\(err\)\)/, 'the catch block stopped calling describeError');
  });

  it('🔴 never renders err.message — that is the server’s machine code', () => {
    assert.doesNotMatch(
      CODE,
      /err\.message/,
      'UniversePage renders err.message again. For an ApiError that is `body?.error ?? "HTTP <status>"`, ' +
        'so a person sees the literal word `forbidden` or the literal string `HTTP 503`.',
    );
  });

  it('the 404 branch is untouched — a wrong address is still "Not a universe", not an error', () => {
    // The fix must not have swallowed the closed-vocabulary miss into the
    // generic error notice; they say different things on purpose.
    assert.match(CODE, /err instanceof ApiError && err\.status === 404\) setMissing\(true\)/);
  });
});
