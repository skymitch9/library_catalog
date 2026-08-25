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

import {
  ACCESS_UNAVAILABLE,
  NOT_CONFIGURED,
  SERVER_PROBLEM,
  describeServerFailure,
  describeUnavailable,
} from '../src/lib/error-wording.ts';

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

// ---------------------------------------------------------------------------
// ⚠️ F2 / F13 / F17 — the paid cover search's two refusals (2026-08-25)
// ---------------------------------------------------------------------------
//
// `POST /works/:id/cover/find` is held by owner, admin AND moderator, and it
// can refuse in two ways that a person must be able to tell apart from a
// permission problem — which is precisely what neither of them managed:
//
//   F2  503 `not_configured` (no ANTHROPIC_API_KEY on this instance) fell
//       through to ACCESS_UNAVAILABLE, so somebody who clicked the button was
//       told their ACCESS could not be checked, and went and asked for a role
//       they already held. A missing key is a configuration fact.
//   F13 502 `search_failed` was eaten by the generic `status >= 500` branch, so
//       the sentence the route deliberately wrote — timeout / budget / upstream,
//       and whether the ~6¢ search had already been billed — never rendered.
//       "Try again in a moment" is an invitation to be charged twice.
//   F17 the 503's detail told whoever clicked it to edit `apps/worker/.dev.vars`
//       and run `npm run secrets:push`. A moderator cannot do either.

describe('the cover search is not set up on this instance (F2/F17)', () => {
  const detail = "The cover search isn't set up on this catalog yet — ask the owner to configure the AI key.";

  it('⚠️ is a CONFIGURATION sentence, never an access one', () => {
    const said = describeUnavailable(body({ error: 'not_configured', detail }));
    assert.equal(said, detail);
    assert.notEqual(
      said,
      ACCESS_UNAVAILABLE,
      'a missing API key is not a permission problem, and saying it is sends people asking for access they hold',
    );
  });

  it('says so even when the route wrote no sentence of its own', () => {
    const said = describeUnavailable(body({ error: 'not_configured' }));
    assert.equal(said, NOT_CONFIGURED);
    assert.notEqual(said, ACCESS_UNAVAILABLE);
    assert.ok(!said.includes('not_configured'), 'nobody may be shown a bare code');
  });

  it('⚠️ F17: the sentence names a person to ask, not a file to edit', () => {
    for (const said of [detail, NOT_CONFIGURED]) {
      assert.ok(!/\.dev\.vars/.test(said), 'a moderator cannot edit a dotfile on the deploy machine');
      assert.ok(!/secrets:push|npm run/.test(said), 'a developer command is not a person-facing instruction');
      assert.ok(/admin|owner/i.test(said), 'it must say WHO can fix it');
    }
  });
});

describe('the cover search ran and failed (F13)', () => {
  const detail =
    'The cover search failed before it could answer. Nothing was saved, but the search may ' +
    'already have been charged — check the spend before running it again (upstream timeout).';

  it('⚠️ renders the sentence the route wrote, not the generic 5xx one', () => {
    const said = describeServerFailure(body({ error: 'search_failed', detail }));
    assert.equal(said, detail);
    assert.notEqual(
      said,
      SERVER_PROBLEM,
      '"try again in a moment" is an invitation to be billed a second time',
    );
  });

  it('an unnamed 5xx still gets the generic sentence, not a leaked detail', () => {
    // ⚠️ The allowlist earns its keep here: `detail` on an unhandled 500 is as
    // likely to be a stack fragment as a sentence, and a person may see neither
    // that nor a bare status.
    const said = describeServerFailure(body({ error: 'kaboom', detail: 'TypeError: x is not a function' }));
    assert.equal(said, SERVER_PROBLEM);
    assert.ok(!said.includes('TypeError'));
  });

  it('search_failed with no sentence falls back rather than showing the code', () => {
    for (const missing of [{}, { detail: '' }, { detail: 42 }]) {
      const said = describeServerFailure(body({ error: 'search_failed', ...missing }));
      assert.equal(said, SERVER_PROBLEM);
      assert.ok(!said.includes('search_failed'));
    }
  });

  it('no body at all is still a sentence', () => {
    assert.equal(describeServerFailure(null), SERVER_PROBLEM);
    assert.ok(!SERVER_PROBLEM.includes('502'), 'nobody may be shown a bare HTTP status');
  });
});
