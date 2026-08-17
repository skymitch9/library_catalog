/**
 * The 503 off the photo-scanning path must read as an OUTAGE, never as a
 * permission refusal.
 *
 * ⚠️ The rule this pins is the estate's, and it exists because mislabelling an
 * outage sends someone to ask an admin for access they already hold: *a network
 * or server failure is NOT a permission failure.* The four refusal causes stay
 * four different sentences because they have four different fixes —
 *
 * | cause | who fixes it | how |
 * |---|---|---|
 * | not signed in | the person | sign in again |
 * | awaiting approval | an owner/admin | approve the account |
 * | insufficient role | an owner/admin | grant the role |
 * | **service unavailable** | **an operator** | **set `ANTHROPIC_API_KEY`** |
 *
 * — and only the last one is what a missing key is. The assertions below are
 * deliberately two-sided: the message must SAY the operator half, and must NOT
 * contain any of the phrases the other three causes own. A future reword that
 * drifts back toward "ask an owner or admin" fails here rather than in front of
 * someone holding a phone at a bookshelf.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  readShelf,
  SCAN_KEY_REJECTED_MESSAGE,
  SCAN_UNAVAILABLE_MESSAGE,
  VisionError,
} from './vision.js';

/**
 * Wording owned by the OTHER three refusal causes. Any of these in a scan-
 * outage message means the outage is wearing a permission's clothes.
 *
 * ⚠️ Note what is NOT banned: the word "permission" on its own. The message is
 * required to contain it, in the disclaimer — "not a permission problem" — so a
 * blanket ban would forbid the very sentence that fixes the bug.
 */
const PERMISSION_SHAPED =
  /ask an owner|ask an admin|ask your|your role does not|do not have permission|don't have permission|not allowed to|couldn'?t check your access|could not check your access|waiting to be approved|awaiting approval|sign in again|no longer has access|request access|grant (it|you|access)/i;

function assertOutageNotRefusal(message: string) {
  assert.ok(message.trim().length > 0, 'must not be empty');
  assert.ok(!message.includes('[object Object]'), 'must be words');
  assert.ok(!/^\d+$/.test(message.trim()), 'must never be a bare status');

  // What happened.
  assert.match(
    message,
    /unavailable|not available|not configured/i,
    `must say the SERVICE is unavailable — got: ${message}`,
  );
  // What it needs, and who does it.
  assert.match(message, /ANTHROPIC_API_KEY|API key/i, `must name the key — got: ${message}`);
  assert.match(
    message,
    /operator|secrets:push/i,
    `must say an OPERATOR fixes it, not the person reading — got: ${message}`,
  );
  // That it is not about the person asking.
  assert.match(
    message,
    /not a permission problem/i,
    `must say outright that it is not a permission problem — got: ${message}`,
  );
  // And none of the other three causes' vocabulary.
  assert.doesNotMatch(
    message,
    PERMISSION_SHAPED,
    `reads as a permission refusal, which is the exact regression this test exists to catch — got: ${message}`,
  );
}

describe('scan 503 wording — an outage, not a permission problem', () => {
  it('SCAN_UNAVAILABLE_MESSAGE says what happened, what it needs, and that it is not you', () => {
    assertOutageNotRefusal(SCAN_UNAVAILABLE_MESSAGE);
  });

  it('SCAN_KEY_REJECTED_MESSAGE does the same, and also clears the photo', () => {
    assertOutageNotRefusal(SCAN_KEY_REJECTED_MESSAGE);
    // The older half of this rule: a rejected key once surfaced as "could not
    // read that photo", which sent someone to check their lighting.
    assert.match(SCAN_KEY_REJECTED_MESSAGE, /not a problem with your photo/i);
  });

  it('the two messages are distinct — a missing key and a stale key have different fixes', () => {
    assert.notEqual(SCAN_UNAVAILABLE_MESSAGE, SCAN_KEY_REJECTED_MESSAGE);
  });

  it('readShelf with no key throws a 503 carrying that wording, and never calls out', async () => {
    // No network: the guard is the first statement in the function.
    await assert.rejects(
      () => readShelf(undefined, { data: 'x'.repeat(128), mediaType: 'image/jpeg' }),
      (err: unknown) => {
        assert.ok(err instanceof VisionError, 'must be a VisionError');
        assert.equal(err.status, 503, 'service unavailable, not 401/403');
        assert.equal(err.retryable, false, 'retrying cannot install a key');
        assertOutageNotRefusal(err.message);
        return true;
      },
    );
  });
});
