/**
 * Which failures count as a book's turn, and which are about the account.
 *
 * ## The incident
 *
 * 2026-08-17, `library-catalog-2nd`: the friend instance's Anthropic key reached
 * its monthly cap mid-queue. Three runs died with
 *
 *     "You have reached your specified API usage limits.
 *      You will regain access on 2026-09-01 at 00:00 UTC."
 *
 * Nothing was asked, nothing was spent, nothing about those three books was
 * learned. `detailsRunHistory` nevertheless recorded the newest attempt of ANY
 * status, so all three were demoted behind every book that had actually been
 * answered — and stayed demoted after the owner cleared the cap, because the
 * timestamp does not know why it was written.
 *
 * ⚠️ The rule this pins is deliberately NARROW, and the narrowness is the
 * design. Eligibility is untouched: `asked` has always ignored every error, so
 * an errored book was always re-askable. What moves here is ORDER, and only for
 * failures `classifyLookupFailure` names as the key's — because the opposite
 * mistake is worse. A book whose lookups keep timing out must keep going to the
 * back, or it takes a slot every hour for ever, which is exactly the starvation
 * the original any-status rule was written to prevent.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lastRealAttempt } from '../src/research.js';

/** The string the cap actually persisted into `research_run.error_message`. */
const ALLOWANCE_RAW =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached ' +
  'your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC."},' +
  '"request_id":"req_011Ce8wUrCAmfVx64EGfUBQA"}';

/**
 * And the worded form, which is what rows written after `describeError` learned
 * to classify hold instead. ⚠️ Both shapes are live in the same table on the
 * same instance — runs 5 and 6 hold the raw body, run 7 holds this — so the
 * rule has to survive both or it works for half the incident.
 */
const ALLOWANCE_WORDED =
  "This catalog's lookup allowance is used up until 1 September 2026 — lookups pause until " +
  'then. An operator can raise the limit at platform.claude.com. Your books and everything ' +
  'already filled in are unaffected.';

test('a cap failure does not count as a turn — either shape it is stored in', () => {
  // The book had a real attempt on the 15th and a cap failure on the 17th. Its
  // place in the rotation is the 15th: the cap taught it nothing.
  assert.equal(
    lastRealAttempt('2026-08-15 06:00:00', '2026-08-17 20:19:30', ALLOWANCE_RAW),
    '2026-08-15 06:00:00',
  );
  assert.equal(
    lastRealAttempt('2026-08-15 06:00:00', '2026-08-17 21:07:56', ALLOWANCE_WORDED),
    '2026-08-15 06:00:00',
  );
});

test('a book whose only attempt was a cap failure goes back to never-attempted', () => {
  // ⚠️ Null, not the error time. `planSweep` sorts nulls first, so a book the
  // outage caught before it ever had a turn gets the turn it never had — which
  // is the whole point. While the cap is still on it fails again instantly and
  // cheaply; when the key works it is at the front.
  assert.equal(lastRealAttempt(null, '2026-08-17 20:19:30', ALLOWANCE_RAW), null);
});

test('an ordinary failure IS a turn, and still goes to the back', () => {
  // The starvation guard. A timeout, an unreadable answer, a book that breaks
  // the lookup every time — these are facts about the BOOK, and one slot once
  // is the right price for them.
  assert.equal(
    lastRealAttempt('2026-08-15 06:00:00', '2026-08-17 20:19:30', 'The lookup timed out.'),
    '2026-08-17 20:19:30',
  );
  assert.equal(lastRealAttempt(null, '2026-08-17 20:19:30', 'The lookup timed out.'), '2026-08-17 20:19:30');
});

test('an unexplained failure is treated as the book’s own', () => {
  // ⚠️ `classifyLookupFailure` returns null rather than guessing, and the
  // fallback here has to be the CONSERVATIVE side of that: an error nobody can
  // name is assumed to be about this book, so it demotes. Assuming the opposite
  // would let one unrecognised recurring failure hold the front of the queue.
  assert.equal(lastRealAttempt(null, '2026-08-17 20:19:30', null), '2026-08-17 20:19:30');
  assert.equal(lastRealAttempt(null, '2026-08-17 20:19:30', ''), '2026-08-17 20:19:30');
});

test('the newest real attempt wins when it is newer than the error', () => {
  // An old ordinary error under a newer success: the success is the turn.
  assert.equal(
    lastRealAttempt('2026-08-18 06:00:00', '2026-08-17 20:19:30', 'The lookup timed out.'),
    '2026-08-18 06:00:00',
  );
});

test('no error at all leaves the answer exactly as it was', () => {
  // The overwhelmingly common row, and the one a refactor here would break
  // silently: no error, so nothing to classify, so nothing to change.
  assert.equal(lastRealAttempt('2026-08-18 06:00:00', null, null), '2026-08-18 06:00:00');
  assert.equal(lastRealAttempt(null, null, null), null);
});

test('a rate limit and a rejected key are the account too', () => {
  // The other two `LookupFailureKind`s. Each has a different fix for a person,
  // and none of the three is a fact about the book — which is the only thing
  // the rotation cares about.
  assert.equal(
    lastRealAttempt(
      '2026-08-15 06:00:00',
      '2026-08-17 20:19:30',
      'Too many lookups at once, so the lookup service asked us to slow down.',
    ),
    '2026-08-15 06:00:00',
  );
  assert.equal(
    lastRealAttempt('2026-08-15 06:00:00', '2026-08-17 20:19:30', '401 {"type":"authentication_error"}'),
    '2026-08-15 06:00:00',
  );
});
