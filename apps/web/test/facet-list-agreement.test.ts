/**
 * ⚠️ **The counts must describe the list they label.**
 *
 * `collectionFilter` exists as ONE builder so that the grid and the numbers
 * above it can never be answering different questions. That guarantee holds on
 * the server; it is broken on the CLIENT the moment the two calls are given
 * different params — and that is exactly how it broke:
 *
 * **F3, 2026-08-25.** "Owned 2+ (physical)" was threaded through the list
 * params, the reload deps and `collectionPath`, and the server read it on both
 * routes. The `api.facets(...)` call was not updated. Tick the box and the grid
 * narrows to (say) 12 works while the Series dropdown still reads *"Cradle
 * (6)"*, *"Cover needed (4)"*, *"Sold (9)"* — counted over the whole ~1,100-work
 * collection. Pick "Cradle (6)" and the list comes back EMPTY under a facet
 * that promised six. `series` turned out to be missing from the same call for
 * the same reason, with the same effect on every non-series facet.
 *
 * ⚠️ **Why this reads the source instead of rendering the page.** There is no
 * DOM harness in this lane, and rendering would not help anyway: the defect is
 * an ABSENT KEY in an object literal, which produces no error, no warning and a
 * page that looks completely normal — the numbers are simply counted over a
 * wider set. The only mechanical form of "these two calls narrow by the same
 * things" is to compare the two argument lists, so that is what this does. It
 * is the same shape as `queue-load-waterfall.test.ts`, which pins an await
 * ORDER the same way and for the same reason.
 *
 * A param that orders or slices the list — `sort`, `dir`, `page`, `pageSize` —
 * is not a narrowing and is not required here. `duplicates` is not either: it
 * REPLACES the grid with groups rather than filtering it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/pages/CollectionPage.tsx', import.meta.url)),
  'utf8',
);

/**
 * The keys of one object literal, given the text that opens it.
 *
 * Deliberately crude — it reads to the matching close brace and takes anything
 * that looks like a key. A parser would be more precise and would also be a
 * second thing to keep working; what this needs to catch is a key that is not
 * there at all, and a crude reader catches that just as well as an exact one.
 */
function keysOfObjectAfter(marker: string): string[] {
  const start = SOURCE.indexOf(marker);
  assert.notEqual(start, -1, `could not find \`${marker}\` in CollectionPage.tsx`);
  const open = SOURCE.indexOf('{', start);
  assert.notEqual(open, -1, `no object literal after \`${marker}\``);

  let depth = 0;
  let end = -1;
  for (let i = open; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === '{') depth += 1;
    else if (SOURCE[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `unbalanced braces after \`${marker}\``);

  const body = SOURCE.slice(open + 1, end)
    // Comments carry prose full of colons and would read as keys.
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // ⚠️ Lookbehind/lookahead rather than a consuming match: `q, series, universe`
  // on one line is three keys, and a pattern that eats the separating comma
  // would report every other one. Getting that wrong makes this file pass
  // vacuously, which is why the first test below asserts the counts look sane.
  const keys = new Set<string>();
  for (const m of body.matchAll(/(?<=[{,])\s*([A-Za-z_$][\w$]*)\s*(?=[,:}])/g)) keys.add(m[1]!);
  // The first key sits directly after the opening brace, which the loop above
  // covers, but a body that opens on a newline needs the same for its head.
  const head = /^\s*([A-Za-z_$][\w$]*)\s*(?=[,:}])/.exec(body);
  if (head) keys.add(head[1]!);
  return [...keys];
}

/** Orders or slices the list; does not change which books are in it. */
const PRESENTATION = new Set(['sort', 'dir', 'page', 'pageSize']);

describe('the facet counts are narrowed by everything the list is (F3)', () => {
  const listKeys = keysOfObjectAfter('const params = useMemo(');
  const facetKeys = keysOfObjectAfter('.facets(');

  it('reads both call sites — a rename must not silently pass this file', () => {
    // If either literal stops being found or stops carrying the params it is
    // supposed to, the assertions below would pass vacuously. They cannot.
    assert.ok(listKeys.length >= 10, `list params looked wrong: ${listKeys.join(', ')}`);
    assert.ok(facetKeys.length >= 8, `facet params looked wrong: ${facetKeys.join(', ')}`);
  });

  it('⚠️ every narrowing param the LIST sends, the FACETS send too', () => {
    const missing = listKeys.filter((k) => !PRESENTATION.has(k) && !facetKeys.includes(k));
    assert.deepEqual(
      missing,
      [],
      `these narrow the grid but not the counts labelling it: ${missing.join(', ')}. ` +
        'Either add them to the api.facets(...) call or, if the param genuinely ' +
        'does not narrow the list, add it to PRESENTATION above with a reason.',
    );
  });

  it('⚠️ owned2 specifically — the param whose absence was the finding', () => {
    assert.ok(listKeys.includes('owned2'));
    assert.ok(
      facetKeys.includes('owned2'),
      'Owned 2+ narrowed the grid while the counts above it were taken over the whole collection',
    );
  });

  it('the facets call is in an effect that re-runs when ownedTwice moves', () => {
    // The other half of F3: the value was absent from the effect's dependency
    // array too, so even a corrected call would have kept stale counts until
    // some other filter changed.
    const deps = SOURCE.slice(SOURCE.indexOf('.facets('));
    const array = deps.slice(deps.indexOf('}, ['), deps.indexOf(']);') + 1);
    assert.match(array, /ownedTwice/, 'ownedTwice must be a dependency of the facets effect');
  });
});
