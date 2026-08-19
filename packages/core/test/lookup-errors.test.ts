/**
 * The spend cap that printed itself onto a live page (2026-08-17).
 *
 * ⚠️ The defect these pin: `research_run.error_message` held the Anthropic
 * SDK's own `Error.message`, which the SDK builds as
 * `${status} ${JSON.stringify(body)}` when the body has no top-level `message`
 * — and the error envelope never does. So the Missing/queue screen printed a
 * status, a JSON body and a request id to a person who is not an operator, and
 * `describeError` never noticed because the thing it returned *was* a string.
 *
 * Every assertion here is therefore two-sided: the output must SAY the useful
 * thing, and must NOT contain the envelope. `assertPersonSafe` is the second
 * half and runs on every single case, because any branch could regress into it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  KEY_REJECTED_MESSAGE,
  LOOKUP_FAILED_MESSAGE,
  TOO_MANY_AT_ONCE_MESSAGE,
  allowanceUsedUpMessage,
  classifyLookupFailure,
  humanDate,
  regainDate,
  wordLookupError,
} from '../src/lookup-errors.js';

/**
 * The exact string sitting in D1 today.
 *
 * ⚠️ Copied verbatim from `research_run` id 6 on `library-catalog-2nd`, read
 * live on 2026-08-17 — not reconstructed from memory. Run 5 is byte-identical
 * apart from its request id. These are the two rows the render-layer mapping
 * exists for.
 */
const STORED_RAW =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached ' +
  'your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC."},' +
  '"request_id":"req_011Ce8wV2ToKAQnsf1Ahq1V6"}';

/**
 * ⚠️ THE MUTATION GUARD. Delete the classifier or the page's call to it and
 * these assertions fail — that is the whole point of listing the envelope's
 * pieces individually rather than eyeballing the sentence.
 */
function assertPersonSafe(said: string) {
  assert.equal(typeof said, 'string');
  assert.ok(said.trim().length > 0, 'must never be empty');
  assert.ok(!said.includes('{'), `must never carry JSON — got: ${said}`);
  assert.ok(!said.includes('}'), `must never carry JSON — got: ${said}`);
  assert.ok(!/request_id|req_01/.test(said), `must never carry a request id — got: ${said}`);
  assert.ok(!/invalid_request_error|rate_limit_error|authentication_error/.test(said),
    `must never carry a machine error type — got: ${said}`);
  assert.ok(!/\[object Object\]/.test(said), `must never say [object Object] — got: ${said}`);
  assert.ok(!/^\d+$/.test(said.trim()), `must never be a bare status — got: ${said}`);
}

describe('the spend cap, in words', () => {
  it('THE DEFECT: the exact string stored on runs 5 and 6 becomes a sentence', () => {
    const said = wordLookupError(STORED_RAW);
    assertPersonSafe(said);
    // What happened, when it lifts, what it needs, and that it is not about you.
    assert.ok(/lookup allowance/i.test(said), said);
    assert.ok(said.includes('1 September 2026'), said);
    assert.ok(said.includes('platform.claude.com'), 'must say where an operator fixes it');
    assert.ok(/unaffected/i.test(said), 'must say the books are fine');
  });

  it('the raw body is classified, not merely stripped', () => {
    const found = classifyLookupFailure(STORED_RAW);
    assert.ok(found, 'the stored form must be recognised, not fall through');
    assert.equal(found.kind, 'allowance_used_up');
    assert.equal(found.regainsOn, '2026-09-01');
    assertPersonSafe(found.message);
  });

  it('the SDK error OBJECT classifies the same as its stringified message', () => {
    // What the Worker actually catches: an `Error` whose `.message` is the raw
    // envelope, with the parsed body hung off `.error`.
    const sdkError = Object.assign(new Error(STORED_RAW), {
      status: 400,
      type: 'invalid_request_error',
      error: {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC.',
        },
        request_id: 'req_011Ce8wV2ToKAQnsf1Ahq1V6',
      },
    });
    const found = classifyLookupFailure(sdkError);
    assert.ok(found);
    assert.equal(found.kind, 'allowance_used_up');
    assert.equal(found.message, wordLookupError(STORED_RAW), 'store time and render time agree');
    assertPersonSafe(found.message);
  });

  it('a cap with NO parseable date still reads as a sentence', () => {
    const found = classifyLookupFailure({
      status: 400,
      error: { error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits.' } },
    });
    assert.ok(found);
    assert.equal(found.kind, 'allowance_used_up');
    assert.equal(found.regainsOn, null);
    assertPersonSafe(found.message);
    // ⚠️ The failure this pins is a template printing its own hole.
    assert.ok(!/undefined|null|NaN|Invalid Date/.test(found.message), found.message);
    assert.ok(/resets/i.test(found.message), 'says it comes back, without inventing a day');
  });

  it('a nonsense date is treated as no date rather than printed', () => {
    assert.equal(humanDate('2026-13-01'), null, 'month 13 is not a month');
    assert.equal(humanDate('2026-09-99'), null, 'day 99 is not a day');
    assert.equal(humanDate('next Tuesday'), null);
    assert.equal(humanDate('2026-09-01'), '1 September 2026');
    assertPersonSafe(allowanceUsedUpMessage('2026-13-01'));
  });

  it('the reset date is READ, never computed', () => {
    assert.equal(
      regainDate('You will regain access on 2026-09-01 at 00:00 UTC.'),
      '2026-09-01',
    );
    assert.equal(regainDate('You have reached your specified API usage limits.'), null);
  });
});

describe('the other two provider failures, kept apart', () => {
  it('429 is a wait-a-minute, not a month-long pause', () => {
    const found = classifyLookupFailure({
      status: 429,
      error: { error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } },
    });
    assert.ok(found);
    assert.equal(found.kind, 'too_many_at_once');
    assert.equal(found.message, TOO_MANY_AT_ONCE_MESSAGE);
    assertPersonSafe(found.message);
    assert.ok(/Look again/.test(found.message), 'names the affordance that is still on the row');
    // ⚠️ Must not be worded into either of the others.
    assert.ok(!/allowance/i.test(found.message), found.message);
    assert.ok(!/operator/i.test(found.message), 'nothing for an operator to do here');
  });

  it('401 is a server configuration problem and says so — NOT a permission problem', () => {
    const found = classifyLookupFailure({
      status: 401,
      error: { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    });
    assert.ok(found);
    assert.equal(found.kind, 'key_rejected');
    assert.equal(found.message, KEY_REJECTED_MESSAGE);
    assertPersonSafe(found.message);
    // The estate rule that a server failure must never wear a permission's
    // clothes — the same two-sided assertion `vision.test.ts` makes.
    assert.ok(/not a permission problem/i.test(found.message), found.message);
    assert.ok(/your account is fine/i.test(found.message), found.message);
    assert.ok(/operator/i.test(found.message), 'says whose job the fix is');
  });

  it('the bare type is enough when no status came through', () => {
    assert.equal(classifyLookupFailure({ type: 'rate_limit_error' })?.kind, 'too_many_at_once');
    assert.equal(classifyLookupFailure({ type: 'authentication_error' })?.kind, 'key_rejected');
  });
});

describe('what must NOT be claimed', () => {
  it('an ordinary 400 stays a bug and is not dressed up as a spend cap', () => {
    const ordinary = classifyLookupFailure({
      status: 400,
      error: { error: { type: 'invalid_request_error', message: 'messages: roles must alternate between "user" and "assistant"' } },
    });
    assert.equal(ordinary, null, 'a malformed request is a defect, not an allowance');
  });

  it('the word "limit" alone does not make a spend cap', () => {
    // ⚠️ The over-matching this pins: plenty of validation errors say "limit".
    assert.equal(
      classifyLookupFailure({ status: 400, message: "max_tokens exceeds the model's limit" }),
      null,
    );
  });

  it('a database error is left alone for its own matcher', () => {
    // `routes/catalog.ts` matches /UNIQUE constraint failed/ against this text;
    // swallowing it here would turn a duplicate ISBN back into a raw 500.
    assert.equal(classifyLookupFailure(new Error('D1_ERROR: UNIQUE constraint failed: edition.isbn13')), null);
  });
});

describe('wordLookupError — the render layer never prints an envelope', () => {
  it('an unrecognised envelope is stripped to its own sentence', () => {
    const said = wordLookupError(
      '503 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_abc"}',
    );
    assertPersonSafe(said);
    assert.ok(/Overloaded/.test(said), 'the diagnostic survives — only the wrapper goes');
  });

  it('an envelope buried inside a sentence is stripped too', () => {
    const said = wordLookupError(
      'Could not read that photo: 500 {"type":"error","error":{"message":"internal server error"}}',
    );
    assertPersonSafe(said);
    assert.ok(/Could not read that photo/.test(said), said);
    assert.ok(/internal server error/.test(said), said);
  });

  it('a body too broken to parse still gives up its sentence', () => {
    const said = wordLookupError('400 {"type":"error","error":{"message":"the tap ran dry"');
    assertPersonSafe(said);
    assert.ok(/tap ran dry/.test(said), said);
  });

  it('unknown garbage stays worded rather than becoming blank', () => {
    for (const junk of [null, undefined, '', '   ', '{}', '[object Object]', '503', '{"weird":true}']) {
      const said = wordLookupError(junk as string | null);
      assertPersonSafe(said);
    }
    assert.equal(wordLookupError(null), LOOKUP_FAILED_MESSAGE);
    assert.equal(wordLookupError('{}'), LOOKUP_FAILED_MESSAGE);
  });

  it('an already-worded message is passed through untouched', () => {
    const worded = 'That book was deleted while the lookup was running.';
    assert.equal(wordLookupError(worded), worded);
    // Including the ones this module wrote — words in, same words out.
    assert.equal(wordLookupError(KEY_REJECTED_MESSAGE), KEY_REJECTED_MESSAGE);
    assert.equal(wordLookupError(TOO_MANY_AT_ONCE_MESSAGE), TOO_MANY_AT_ONCE_MESSAGE);
  });
});

/**
 * ⚠️ The round trip, added 2026-08-19.
 *
 * `describeError` classifies at STORE time, so every run that has failed since
 * 2026-08-17 holds one of THIS MODULE'S sentences in `research_run.error_message`
 * rather than the provider's envelope. That was the whole point — and it quietly
 * made the stored row unclassifiable, because the vocabulary only ever matched
 * Anthropic's phrasing.
 *
 * It stopped being cosmetic when something started asking *what kind* of failure
 * a stored row was: `detailsRunHistory` exempts account failures from the sweep's
 * rotation, so a cap that read as "unrecognised" would demote the book exactly as
 * the raw-bodied one did. A classifier that cannot read its own handwriting is a
 * classifier that works once.
 */
describe('a stored sentence classifies as the failure it describes', () => {
  it('recognises its own allowance message, and keeps the date', () => {
    const stored = allowanceUsedUpMessage('2026-09-01');
    const again = classifyLookupFailure(stored);
    assert.equal(again?.kind, 'allowance_used_up');
    assert.equal(again?.regainsOn, '2026-09-01');
    // ⚠️ And the sentence must come back IDENTICAL. Losing the date here would
    // re-word a screen that already reads correctly into the vaguer variant.
    assert.equal(again?.message, stored);
  });

  it('recognises the dateless allowance message without inventing a date', () => {
    const stored = allowanceUsedUpMessage(null);
    const again = classifyLookupFailure(stored);
    assert.equal(again?.kind, 'allowance_used_up');
    assert.equal(again?.regainsOn, null);
    assert.equal(again?.message, stored);
  });

  it('recognises the rate-limit and rejected-key messages', () => {
    assert.equal(classifyLookupFailure(TOO_MANY_AT_ONCE_MESSAGE)?.kind, 'too_many_at_once');
    assert.equal(classifyLookupFailure(KEY_REJECTED_MESSAGE)?.kind, 'key_rejected');
  });

  it('every message this module writes classifies back to its own kind', () => {
    // The general property, so a fourth message cannot be added without a
    // matching clause in `wordedKind`.
    const cases = [
      ['allowance_used_up', allowanceUsedUpMessage('2026-09-01')],
      ['allowance_used_up', allowanceUsedUpMessage(null)],
      ['too_many_at_once', TOO_MANY_AT_ONCE_MESSAGE],
      ['key_rejected', KEY_REJECTED_MESSAGE],
    ] as const;
    for (const [kind, message] of cases) {
      assert.equal(classifyLookupFailure(message)?.kind, kind, message);
      // Still person-safe on the way back out.
      assertPersonSafe(wordLookupError(message));
    }
  });

  it('still refuses to guess at an ordinary sentence', () => {
    // ⚠️ The counterweight. The clauses are distinctive on purpose — a bug
    // report that happens to mention lookups must not be dressed up as a cap.
    for (const ordinary of [
      'That book was deleted while the lookup was running.',
      'The lookup returned an answer we could not read.',
      'Too many books were selected.',
      LOOKUP_FAILED_MESSAGE,
    ]) {
      assert.equal(classifyLookupFailure(ordinary), null, ordinary);
    }
  });

  it('reads a human date only where a reset is being described', () => {
    assert.equal(regainDate('used up until 1 September 2026 — lookups pause'), '2026-09-01');
    assert.equal(regainDate('used up until 12 December 2027.'), '2027-12-12');
    assert.equal(regainDate('until 31 Smarch 2026'), null, 'not a month');
    assert.equal(regainDate('nothing about dates here'), null);
    // The ISO branch still wins, and humanDate is still its inverse.
    assert.equal(regainDate('You will regain access on 2026-09-01 at 00:00 UTC.'), '2026-09-01');
    assert.equal(humanDate('2026-09-01'), '1 September 2026');
  });
});
