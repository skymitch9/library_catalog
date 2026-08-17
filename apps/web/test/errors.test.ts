/**
 * Which 503 a person is shown — the branch that used to make an outage read as
 * a permission problem.
 *
 * The Worker half shipped first (`error: 'scan_unavailable'` plus a worded
 * `detail`, so a scan service that is not configured says so in words). The
 * client half still mapped **every** 503 to *"Couldn't check your access right
 * now"* — a sentence that belongs to `estate_unreachable` alone, and which
 * breaks the estate rule outright: **a network or server failure is NOT a
 * permission failure**, and mislabelling an outage sends people asking for
 * access they already have.
 *
 * Both sides are pinned, in the two-sided style `vision.test.ts` uses: the
 * specific 503 must reach the screen, and the generic one must not have been
 * broken while making room for it.
 *
 * ⚠️ Driven through `describeUnavailable` rather than `describeError`, and not
 * by preference: `errors.ts` → `api.ts` → `firebase.ts` reads
 * `import.meta.env`, which is `undefined` outside Vite, so importing
 * `describeError` under `tsx` dies at module load before any assertion runs.
 * The decision under test lives in a leaf with no imports for exactly that
 * reason; `describeError`'s 503 branch is one line that calls it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACCESS_UNAVAILABLE, describeUnavailable } from '../src/lib/error-wording.ts';

/** The body as `request()` decodes it from the Worker's 503. */
function body(fields: Record<string, unknown>) {
  return fields as { error?: unknown; detail?: unknown };
}

describe('describeUnavailable — which 503 is this', () => {
  it('a scan outage says what the Worker said, not that access could not be checked', () => {
    const detail =
      'Photo scanning is not switched on for this site yet, so the scan could not run. Nothing is wrong with your account.';
    const said = describeUnavailable(body({ error: 'scan_unavailable', detail }));
    assert.equal(said, detail);
    assert.notEqual(
      said,
      ACCESS_UNAVAILABLE,
      'a scan outage must never be dressed up as a permission problem',
    );
  });

  it('estate_unreachable keeps the access wording — it is the 503 that IS about checking access', () => {
    assert.equal(describeUnavailable(body({ error: 'estate_unreachable' })), ACCESS_UNAVAILABLE);
  });

  it('an unknown 503 still gets a sentence rather than a bare status', () => {
    // The fallback is why the branch survives: a person must never see "503",
    // and a body nobody recognises is exactly when that could happen.
    const said = describeUnavailable(body({ error: 'something_new' }));
    assert.equal(said, ACCESS_UNAVAILABLE);
    assert.ok(!said.includes('503'), 'nobody may be shown a bare HTTP status');
  });

  it('scan_unavailable without a worded detail falls back rather than showing the code', () => {
    // The Worker always writes one, but a body is a body: a missing sentence
    // must not surface `scan_unavailable` to a person.
    for (const missing of [{}, { detail: '' }, { detail: 42 }]) {
      const said = describeUnavailable(body({ error: 'scan_unavailable', ...missing }));
      assert.equal(said, ACCESS_UNAVAILABLE);
      assert.ok(!said.includes('scan_unavailable'));
    }
  });

  it('no body at all is still a sentence', () => {
    assert.equal(describeUnavailable(null), ACCESS_UNAVAILABLE);
  });
});
