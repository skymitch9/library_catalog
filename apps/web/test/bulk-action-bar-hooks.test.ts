/**
 * Regression guard for the CRITICAL hooks-order bug in BulkActionBar
 * (2026-08 audit, `apps/web/src/components/BulkActionBar.tsx:26`).
 *
 * The bug: `if (count === 0) return null;` sat BEFORE the two `useCallback`
 * hooks. React counts hooks per component instance and requires the count to be
 * invariant across renders. The first time a book was selected, `count` went
 * 0 → 1, the early return no longer fired, and the component suddenly ran two
 * hooks where the previous (empty) render ran none — React throws "Rendered
 * more hooks than during the previous render." With no error boundary anywhere
 * in the app, the whole collection page white-screened.
 *
 * The fix moves the early return to AFTER both hooks so the hook count is the
 * same on every render.
 *
 * Why this is a source-structure test and not a render test: the violation
 * only manifests across re-renders of a live fiber, which server rendering
 * cannot reproduce (each SSR pass renders a component exactly once), and this
 * repo has no DOM renderer. Importing the component to render it is also not
 * possible here — it pulls in `../api.js` → `firebase.ts`, which reads Vite's
 * `import.meta.env` at module load and throws under the tsx test runner (this
 * is why the repo has no component-render tests). So we assert the exact
 * invariant the bug violated directly on the source: every hook call must
 * appear before the `count === 0` early return. This fails on the pre-fix
 * source and passes on the fixed source.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const source = readFileSync(
  fileURLToPath(new URL('../src/components/BulkActionBar.tsx', import.meta.url)),
  'utf8',
);

describe('BulkActionBar — hooks-order invariant (audit CRITICAL)', () => {
  it('places the count===0 early return AFTER every hook call', () => {
    const guardIdx = source.indexOf('if (count === 0) return null;');
    assert.notEqual(guardIdx, -1, 'expected the count===0 early return to exist');

    // Every hook call must come before the early return, so a render that
    // returns null (count 0) and a render that does not (count > 0) run the
    // same number of hooks — the invariant React enforces per fiber.
    for (const hook of ['useState(', 'useCallback(']) {
      const lastHookIdx = source.lastIndexOf(hook);
      assert.notEqual(lastHookIdx, -1, `expected a ${hook} call in the file`);
      assert.ok(
        lastHookIdx < guardIdx,
        `a ${hook} call appears AFTER the count===0 early return — ` +
          'this is the hooks-order bug that white-screened the collection page',
      );
    }
  });
});
