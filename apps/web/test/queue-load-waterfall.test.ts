/**
 * The details queue asks for its data in as few ROUND TRIPS as it can.
 *
 * WHY THIS IS PINNED. Reported 2026-08-19: `/queue` "not loading like the
 * previous one". The Worker was not the problem — measured against live prod
 * the same morning, `/api/health` answered in 52 ms and the worklist itself in
 * 115 ms. The page was the problem, and specifically the SHAPE of `load()`:
 *
 *     301→ 458  securetoken refresh            157 ms  ┐ Firebase restoring
 *     459→ 641  accounts:lookup                182 ms  ┘ the session
 *     642→ 910  auth.heygabi.ai/api/session    268 ms
 *     643→1003  /api/me                        360 ms
 *    1040→1154  /api/research/queue            115 ms  ← the actual worklist
 *    1155→1262  /api/research/auto-applied     107 ms  ← serial behind it
 *    1262→1361  /api/me  (a SECOND time)        98 ms  ← and serial behind that
 *
 * 1,361 ms, of which the data everyone came for was 115. The last two hops —
 * 205 ms, a sixth of the load — queued behind the first for no reason: the
 * auto-applied list does not depend on the queue, and the second `/api/me` asks
 * a question `App` answered milliseconds earlier (it gates rendering this page
 * on being signed in, so `me` cannot be stale here on the first load).
 *
 * ⚠️ THE COST IS PER ROUND TRIP, WHICH IS WHY THIS IS WORTH A TEST. On a wired
 * desktop a wasted hop is ~100 ms; on the phone this was reported from, over
 * cellular, each hop carries its own latency again. Removing trips beats
 * shrinking them, and the regression — someone adding `await` between two
 * independent fetches — is invisible in review and invisible in the UI. It only
 * shows up as "feels slower", which is exactly how this one was found.
 *
 * ⚠️ Stated plainly, in the house style: **this does not render the component.**
 * There is no DOM harness in this lane, and the invariant is about the ORDER of
 * awaits, which a render test would not see either. This reads the source. The
 * live proof is the waterfall above, re-measured.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/pages/DetailsQueuePage.tsx', import.meta.url)),
  'utf8',
);

/**
 * `load()`'s body, comments stripped.
 *
 * ⚠️ Stripping matters: the function now carries the measured waterfall above
 * it in a comment, naming `await` and `/api/me` repeatedly. A plain substring
 * search would find the explanation and mistake it for the code.
 */
function loadBody(): string {
  const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const start = stripped.indexOf('const load = useCallback(');
  assert.notEqual(start, -1, 'DetailsQueuePage no longer defines load()');
  const end = stripped.indexOf('useEffect(', start);
  assert.notEqual(end, -1, 'the effect that calls load() is gone');
  return stripped.slice(start, end);
}

describe('the queue page loads in as few round trips as it can', () => {
  it('fetches the worklist and the undo list CONCURRENTLY', () => {
    const body = loadBody();
    assert.match(
      body,
      /await Promise\.all\(\[/,
      'load() no longer awaits its two independent fetches together — the undo ' +
        'list is queueing behind the worklist again (~107 ms per load, more on a phone)',
    );
    assert.doesNotMatch(
      body,
      /await loadAutoApplied\(\)/,
      'loadAutoApplied() is awaited on its own line again, which puts it after ' +
        'the queue fetch instead of alongside it',
    );
  });

  it('still awaits BOTH before returning — "reloaded together, always"', () => {
    const body = loadBody();
    // The pairing is the point, not the concurrency: a worklist refreshed
    // without its undo list shows a book vanishing with nothing to say what
    // filled it in, which reads as data loss. Promise.all keeps both awaited.
    assert.match(body, /Promise\.all\(\[[\s\S]*loadAutoApplied\(\)[\s\S]*\]\)/, 'loadAutoApplied() is no longer inside the awaited group');
    assert.match(body, /Promise\.all\(\[[\s\S]*api\.queue\(\)[\s\S]*\]\)/, 'api.queue() is no longer inside the awaited group');
  });

  it('does not re-ask /api/me on the FIRST load', () => {
    const body = loadBody();
    assert.match(
      body,
      /if\s*\(\s*loadedOnce\.current\s*\)\s*onChoresChanged\(\)/,
      'the first load calls onChoresChanged() again, buying a /api/me answer ' +
        'App fetched milliseconds earlier — a third serial round trip, and a ' +
        'write (the auth middleware upserts the user row on every call)',
    );
    assert.match(body, /loadedOnce\.current = true/, 'nothing ever arms the later loads');
  });

  it('LATER loads still refresh the chore count', () => {
    // The badge exists for the case where auto-apply drains the queue while the
    // page is open. Skipping the refresh outright would leave "Missing (116)"
    // sitting over an empty worklist — the bug the callback was added to fix.
    assert.match(
      SOURCE,
      /onChoresChanged\(\)/,
      'onChoresChanged is never called at all; the nav count will freeze at its opening value',
    );
    const body = loadBody();
    assert.doesNotMatch(
      body,
      /loadedOnce\.current\s*\?\s*undefined/,
      'the refresh has been disabled rather than deferred past the first load',
    );
  });

  it('the first-load guard is a ref, so flipping it cannot respin the page', () => {
    // ⚠️ `useState` here would re-render on the flip and — because `load` is a
    // dependency of the effect that calls it — could re-enter the fetch. The
    // same trap `refreshChores`'s dep-free useCallback in App.tsx exists to
    // avoid; its own comment says so.
    assert.match(
      SOURCE,
      /const loadedOnce = useRef\(false\)/,
      'loadedOnce is no longer a ref — state here risks a fetch loop',
    );
  });
});
