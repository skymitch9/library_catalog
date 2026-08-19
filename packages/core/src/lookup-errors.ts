/**
 * What an AI-lookup failure MEANS, in words a person can act on.
 *
 * ## ⚠️ Why this exists: the owner read a JSON error body off a live page
 *
 * 2026-08-17, padhard's Missing/queue screen. A research run had failed because
 * that instance's Anthropic key had hit its monthly spend cap, and the FAILED
 * row printed this, verbatim, to a person who is not an operator:
 *
 * ```
 * 400 {"type":"error","error":{"type":"invalid_request_error","message":"You have
 * reached your specified API usage limits. You will regain access on 2026-09-01 at
 * 00:00 UTC."},"request_id":"req_011Ce8wV2ToKAQnsf1Ahq1V6"}
 * ```
 *
 * That string is the Anthropic SDK's own `Error.message`. The SDK builds it as
 * `${status} ${JSON.stringify(body)}` whenever the body has no top-level
 * `message` field — and the error envelope never does, because its sentence is
 * nested at `error.error.message`. So `describeError` did exactly what it
 * promises (it read `err.message`, which IS a string, and IS words in the
 * loosest sense) and still shipped a raw status plus a raw body plus a request
 * id onto the screen. **A worded output is not the same as a worded message.**
 *
 * The estate law it broke: a person must NEVER see a bare status or a raw error
 * body. Every refusal says three things — what happened, what it needs, and how
 * to get it — and a spend cap in particular must say the one thing the JSON
 * never did: *your books are fine, and this is not about you.*
 *
 * ## Why it lives in `@lc/core` rather than beside either caller
 *
 * Two layers need the same answer and they cannot share code any other way:
 *
 * | Layer | Why it needs this |
 * |---|---|
 * | `apps/worker` (`lib/describe-error.ts`) | Classifies at **store time**, so `research_run.error_message` holds the worded form from now on |
 * | `apps/web` (`pages/DetailsQueuePage.tsx`) | Words the **legacy raw rows already in D1** — runs 5 and 6 on `library-catalog-2nd` store the body above, and no store-time fix reaches back and rewrites them |
 *
 * Doing it in only one place leaves half the problem: classify-at-store and the
 * two old rows still print JSON; word-at-render only and every new row is
 * persisted unreadable, which is the defect that outlived its own session last
 * time (see `describe-error.ts`). **Both, deliberately, through this one
 * function** — so the sentence a person reads cannot drift between the two.
 *
 * ⚠️ This is NOT a third `describeError`. The Worker's decodes a *thrown value*;
 * the web's (`lib/errors.ts`) decodes an *HTTP status* into role vocabulary.
 * This one decodes an *upstream AI-provider failure* into a sentence about the
 * catalog's lookup allowance, and it knows nothing about roles or requests.
 * It is a leaf: it imports nothing, so a test can reach it and so the Worker,
 * the browser and a script can all hold the same opinion about what a spend cap
 * means.
 */

/**
 * The three provider failures worth naming, because each has a different fix.
 *
 * ⚠️ Kept apart on purpose — the estate rule about not wording one refusal into
 * another applies here too. "Used up until September" is a *wait*, "too many at
 * once" is a *retry*, and "key rejected" is an *operator action*. Collapsing
 * them into one "lookups are unavailable" sentence would send someone to wait a
 * month for something a re-push fixes in a minute.
 */
export type LookupFailureKind = 'allowance_used_up' | 'too_many_at_once' | 'key_rejected';

export interface LookupFailure {
  kind: LookupFailureKind;
  /**
   * The sentence a person reads. Never JSON, never a bare status, never a
   * request id — the test suite asserts all three about every branch.
   */
  message: string;
  /**
   * The day access returns, `YYYY-MM-DD`, when the upstream message names one.
   * Null when it does not — and the message says something honest instead of
   * printing `undefined`.
   */
  regainsOn: string | null;
}

/** Said when the allowance is spent and the upstream message names the reset day. */
export function allowanceUsedUpMessage(regainsOn: string | null): string {
  const day = regainsOn ? humanDate(regainsOn) : null;
  const when = day
    ? `is used up until ${day} — lookups pause until then`
    : 'is used up, so lookups are paused until it resets';
  return (
    `This catalog's lookup allowance ${when}. ` +
    'An operator can raise the limit at platform.claude.com. ' +
    'Your books and everything already filled in are unaffected.'
  );
}

/**
 * Said on a 429.
 *
 * ⚠️ Names the retry, because this is the one of the three a person can
 * actually resolve themselves — and says plainly that it is not about them, so
 * nobody goes asking for access they already hold.
 */
export const TOO_MANY_AT_ONCE_MESSAGE =
  'Too many lookups at once, so the lookup service asked us to slow down. ' +
  'Nothing is wrong with your books or your account — leave it a minute and press Look again.';

/**
 * Said on a 401.
 *
 * ⚠️ Deliberately parallel to `SCAN_KEY_REJECTED_MESSAGE` in the Worker's
 * `lib/vision.ts`: an upstream 401 is a **server configuration** problem, and
 * describing it in the vocabulary of access sends people to ask an admin for a
 * permission that was never involved.
 */
export const KEY_REJECTED_MESSAGE =
  "The lookup service rejected this catalog's key, so no lookup can run. " +
  'This is a server configuration problem, not a permission problem — your account is fine and nothing about it needs changing. ' +
  'An operator fixes it by replacing the key at platform.claude.com and running `npm run secrets:push`.';

/** Last resort. Words, on purpose — see the head of this file. */
export const LOOKUP_FAILED_MESSAGE = 'The lookup failed and did not say why.';

/**
 * Name an upstream lookup failure, or return null if it is not one we know.
 *
 * Accepts anything the two callers can hold: a thrown SDK error object, a
 * parsed body, or the **string already sitting in `research_run.error_message`**
 * — which is the whole reason it takes `unknown` rather than an error type.
 *
 * ⚠️ Returns null rather than guessing. An ordinary 400 ("roles must alternate")
 * is a bug, not a spend cap, and dressing it up as one would hide a real defect
 * behind a reassuring sentence. Only the limit vocabulary below claims a 400.
 */
export function classifyLookupFailure(raw: unknown): LookupFailure | null {
  const seen = read(raw);
  if (!seen) return null;

  // ⚠️ The message is checked BEFORE the status, because the spend cap arrives
  // as a 400 `invalid_request_error` — the same status and the same error type
  // as a malformed request. Only the wording tells them apart.
  if (seen.message && LIMIT_VOCABULARY.test(seen.message)) {
    const regainsOn = regainDate(seen.message);
    return { kind: 'allowance_used_up', message: allowanceUsedUpMessage(regainsOn), regainsOn };
  }

  // ⚠️ **This module must be able to read back its own handwriting** — added
  // 2026-08-19. `describeError` classifies at STORE time, so from 2026-08-17
  // onwards `research_run.error_message` holds the sentences below rather than
  // the provider's envelope. A classifier blind to them can word a screen
  // (`wordLookupError` passes an already-worded string through) but cannot
  // answer *what kind of failure was that*, which is a question something now
  // asks: `detailsRunHistory` decides whether an errored book keeps its place
  // in the sweep's rotation, and a cap that read as "unrecognised" would demote
  // the book exactly as the raw-bodied one used to.
  //
  // ⚠️ Matched on a distinctive clause of each sentence, never on the whole
  // string — the middle of these messages carries an operator URL and a reset
  // date that legitimately vary.
  const worded = seen.message ? wordedKind(seen.message) : null;
  if (worded === 'allowance_used_up') {
    const regainsOn = regainDate(seen.message as string);
    return { kind: 'allowance_used_up', message: allowanceUsedUpMessage(regainsOn), regainsOn };
  }
  if (worded === 'too_many_at_once') {
    return { kind: 'too_many_at_once', message: TOO_MANY_AT_ONCE_MESSAGE, regainsOn: null };
  }
  if (worded === 'key_rejected') {
    return { kind: 'key_rejected', message: KEY_REJECTED_MESSAGE, regainsOn: null };
  }

  if (seen.status === 429 || seen.type === 'rate_limit_error') {
    return { kind: 'too_many_at_once', message: TOO_MANY_AT_ONCE_MESSAGE, regainsOn: null };
  }

  if (seen.status === 401 || seen.type === 'authentication_error') {
    return { kind: 'key_rejected', message: KEY_REJECTED_MESSAGE, regainsOn: null };
  }

  return null;
}

/**
 * Which of this module's own sentences a stored string is, if any.
 *
 * ⚠️ The clauses below are the load-bearing halves of the three messages above
 * and changing either without the other breaks the round trip silently — which
 * is why `lookup-errors.test.ts` feeds each message straight back in.
 */
function wordedKind(message: string): LookupFailureKind | null {
  if (/\blookup allowance is used up\b/i.test(message)) return 'allowance_used_up';
  if (/\btoo many lookups at once\b/i.test(message)) return 'too_many_at_once';
  if (/\bthe lookup service rejected this catalog's key\b/i.test(message)) return 'key_rejected';
  return null;
}

/**
 * The render layer's one call: whatever is stored, in words.
 *
 * ⚠️ This is the half that covers rows written before the classifier existed,
 * and it is not optional. `research_run.error_message` is persisted, so the
 * store-time fix only helps runs that have not happened yet; runs 5 and 6 on
 * `library-catalog-2nd` hold the raw body quoted at the head of this file and
 * will hold it forever.
 *
 * Three passes, in order:
 *
 * 1. **Classify.** A shape we recognise gets its own sentence.
 * 2. **Strip.** An envelope we do NOT recognise still must not reach a screen —
 *    its own nested sentence is dug out and the status, the braces and the
 *    request id are dropped. An unreadable diagnostic is better than none; a
 *    raw body in front of a person is neither.
 * 3. **Pass through.** Anything already worded is left exactly as it was.
 */
export function wordLookupError(stored: string | null | undefined): string {
  const known = classifyLookupFailure(stored);
  if (known) return known.message;

  const text = typeof stored === 'string' ? stored.trim() : '';
  if (!text) return LOOKUP_FAILED_MESSAGE;

  const stripped = withoutEnvelope(text);
  return stripped || LOOKUP_FAILED_MESSAGE;
}

// ---------------------------------------------------------------------------
// Reading the shapes
// ---------------------------------------------------------------------------

/**
 * The vocabulary that makes a 400 a spend cap.
 *
 * ⚠️ Anchored on phrases the API actually sends, not on the bare word "limit" —
 * which appears in plenty of ordinary validation errors ("max_tokens exceeds
 * the model's limit") that are bugs and must keep reading like bugs.
 */
const LIMIT_VOCABULARY =
  /\busage limits?\b|\bspend (?:cap|limit)\b|\bcredit balance is too low\b|\bmonthly (?:spend )?limit\b|\bquota (?:exceeded|reached)\b/i;

interface Seen {
  status: number | null;
  type: string | null;
  message: string | null;
}

/** How deep to chase `{ error: { error: { … } } }`. Deep enough; short enough to end. */
const MAX_DEPTH = 4;

function read(raw: unknown, depth = 0): Seen | null {
  if (depth > MAX_DEPTH || raw === null || raw === undefined) return null;

  if (typeof raw === 'string') return fromString(raw);
  if (typeof raw !== 'object') return null;

  const o = raw as Record<string, unknown>;

  const status = numberOf(o.status) ?? numberOf(o.statusCode);
  // The SDK puts the parsed body on `.error`, and the body nests the real one
  // under its own `.error`. Both rungs carry `type`; only the inner one carries
  // the sentence.
  const nested = read(o.error, depth + 1) ?? read(o.body, depth + 1) ?? read(o.cause, depth + 1);

  let message = stringOf(o.message);
  // ⚠️ An SDK error's own `.message` is `"400 {json}"` — the very string this
  // module exists to keep off the screen. When there is a nested body, its
  // sentence always wins.
  if (message && looksLikeEnvelope(message)) {
    const inner = fromString(message);
    message = inner?.message ?? null;
  }

  const seen: Seen = {
    status: status ?? nested?.status ?? null,
    type: stringOf(o.type) ?? nested?.type ?? null,
    message: nested?.message ?? message,
  };

  return seen.status === null && seen.type === null && seen.message === null ? null : seen;
}

/**
 * Read `"400 {…}"`, a bare JSON body, or an ordinary sentence.
 *
 * The first form is the SDK's `Error.message` and is exactly what got persisted.
 */
function fromString(raw: string): Seen | null {
  const text = raw.trim();
  if (!text) return null;

  const withStatus = /^(\d{3})\s+(\{[\s\S]*\})$/.exec(text);
  const status = withStatus ? Number(withStatus[1]) : null;
  const jsonPart = withStatus ? withStatus[2] : text.startsWith('{') ? text : null;

  if (jsonPart) {
    const parsed = parseJson(jsonPart);
    if (parsed) {
      const body = read(parsed, 1);
      return {
        status: status ?? body?.status ?? null,
        type: body?.type ?? null,
        message: body?.message ?? null,
      };
    }
    // Truncated or otherwise unparseable, and a substring search still finds
    // the sentence. Better than declaring the whole thing unreadable.
    return { status, type: null, message: firstQuotedMessage(jsonPart) };
  }

  // A plain sentence — possibly one this module already wrote, possibly one
  // with an envelope buried in it ("Could not read that photo: 400 {…}").
  const buried = lastJsonBlock(text);
  if (buried) {
    const inner = fromString(buried);
    if (inner?.message) return inner;
  }
  return { status: null, type: null, message: text };
}

/**
 * Strip an envelope out of a sentence, leaving whatever can still be read.
 *
 * ⚠️ **The postcondition is absolute: the return value contains no brace.** Not
 * "usually", not "when the body parses" — a truncated body, a body of a shape
 * nobody has seen yet, and a body that is pure machine noise all leave through
 * the same door. That is what makes this safe to call on a column whose future
 * contents nobody controls; anything less and the next unrecognised shape is
 * the same incident again.
 */
function withoutEnvelope(text: string): string {
  const open = text.indexOf('{');
  if (open < 0) return bareStatusToSentence(text);

  const block = lastJsonBlock(text);
  // A parsed body first; failing that, the sentence pulled out by hand — a
  // truncated log line still knows what went wrong.
  const sentence = (block ? (fromString(block)?.message ?? null) : null) ?? firstQuotedMessage(text.slice(open));

  const prefix = text.slice(0, open).replace(/\s*\d{3}\s*$/, '').trim();
  // With nothing to follow it, a dangling "Could not read that photo:" is worse
  // than the bare clause.
  const head = sentence ? prefix : prefix.replace(/[:;,\-–—\s]+$/, '');

  const joined = [head, sentence].filter((s): s is string => !!s && s.length > 0).join(' ').trim();
  const safe = joined.includes('{') || joined.includes('}') ? '' : joined;
  return safe || LOOKUP_FAILED_MESSAGE;
}

/**
 * A bare `"503"` is forbidden outright by the estate rule, so it becomes a
 * sentence. Anything already worded passes through exactly as written.
 */
function bareStatusToSentence(text: string): string {
  if (/^\d+$/.test(text)) return `The lookup failed with code ${text} and no message.`;
  if (text === '[object Object]') return LOOKUP_FAILED_MESSAGE;
  return text;
}

/** The last `{ … }` run in a string, if there is one. */
function lastJsonBlock(text: string): string | null {
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  return open >= 0 && close > open ? text.slice(open, close + 1) : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** `"message":"…"` pulled out by hand, for a body too broken to parse. */
function firstQuotedMessage(text: string): string | null {
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (!m) return null;
  const unescaped = parseJson(`"${m[1]}"`);
  return typeof unescaped === 'string' && unescaped.trim() ? unescaped.trim() : null;
}

function looksLikeEnvelope(text: string): boolean {
  return /^\d{3}\s+\{/.test(text.trim()) || text.trim().startsWith('{');
}

function numberOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stringOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// The reset date
// ---------------------------------------------------------------------------

/**
 * `"You will regain access on 2026-09-01 at 00:00 UTC."` → `'2026-09-01'`.
 *
 * ⚠️ Read from the message rather than computed. "The first of next month" is
 * the obvious guess and it is wrong for any limit that is not calendar-monthly;
 * a date nobody stated is a date that will eventually be a lie.
 */
export function regainDate(message: string): string | null {
  const iso = /(?:regain (?:access|it)|resets?|available again)\D{0,20}(\d{4}-\d{2}-\d{2})/i.exec(
    message,
  );
  if (iso?.[1]) return iso[1];

  // ⚠️ The HUMAN form, because this module's own sentence is what gets stored.
  // `allowanceUsedUpMessage` writes "used up until 1 September 2026", and from
  // 2026-08-17 that string — not the provider's ISO one — is what sits in
  // `research_run.error_message`. Without this branch, re-classifying a stored
  // row silently loses the date and re-words the sentence into the vaguer
  // "until it resets" variant, which is a worse message than the one already on
  // the screen. Round-trip, not one-way.
  const human = /\buntil\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/.exec(message);
  if (human) {
    const month = MONTHS.findIndex((m) => m.toLowerCase() === human[2]!.toLowerCase());
    const day = Number(human[1]);
    if (month >= 0 && day >= 1 && day <= 31) {
      return `${human[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `'2026-09-01'` → `'1 September 2026'`, or null if it is not a real date.
 *
 * ⚠️ Formatted by hand rather than through `Intl`/`Date`. A `Date` would drag a
 * timezone into a day that was quoted in UTC — off-by-one on the exact date a
 * person is being asked to wait for — and hand-formatting is also the reason
 * this is pinnable by a test that cannot drift with a locale.
 */
export function humanDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || !(day >= 1 && day <= 31)) return null;
  return `${day} ${month} ${m[1]}`;
}
