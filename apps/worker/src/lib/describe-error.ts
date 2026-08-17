/**
 * One sentence for anything a `catch` block can see.
 *
 * ## ⚠️ Why this exists: `String(err)` is `'[object Object]'`
 *
 * Four places in the Worker were writing `err instanceof Error ? err.message :
 * String(err)`, and the second half of that expression is the bug. A `throw`
 * that is not an `Error` — and the two that reach us most often are not — falls
 * through to `String()`:
 *
 * | Thrown shape | `String(err)` | what a person needed to read |
 * |---|---|---|
 * | `{ status: 503, error: { message: 'overloaded' } }` | `[object Object]` | `overloaded (HTTP 503)` |
 * | a parsed JSON error body | `[object Object]` | the body's own sentence |
 * | `503` | `503` | a bare status, which the estate rule forbids outright |
 *
 * `[object Object]` then got *persisted*: `scan_job.error` stores whatever this
 * produced, so a failed shelf read recorded the string `[object Object]` in D1
 * and the queue screen printed it back weeks later. There is no recovering the
 * real cause from that row.
 *
 * ## The contract
 *
 * Every return value is **words**. Never `[object Object]`, never a bare status
 * number, never the empty string. When there is genuinely nothing to say, it
 * says that in a sentence rather than handing the caller something falsy to
 * interpolate.
 *
 * ⚠️ This is the Worker's copy of a standard the web app also implements
 * (`apps/web/src/lib/errors.ts`, `describeError`). They are **not**
 * interchangeable and neither should import the other: the web one decodes an
 * `ApiError` — a *status* — into the sentence a person reads on screen, and it
 * knows about roles and capabilities. This one decodes a *thrown value* into
 * the sentence that goes into `detail`, a D1 row, or a log line, and it knows
 * nothing about who is asking. Merging them would make the server's diagnostic
 * text leak role vocabulary into places where no role was involved.
 */

/** Fields that carry a human sentence, in the order we trust them. */
const MESSAGE_FIELDS = ['message', 'detail', 'description', 'error_description', 'statusText'] as const;

/** Fields that may hold a *nested* failure (Anthropic and fetch envelopes both do). */
const NESTED_FIELDS = ['error', 'cause', 'data', 'body'] as const;

/** Said when every branch below comes back empty. Words, on purpose. */
const NOTHING_TO_SAY = 'Something failed and the failure carried no message.';

/** Deep enough for `{ error: { cause: { message } } }`; short enough to end. */
const MAX_DEPTH = 4;

/** How much raw JSON is worth showing before it stops being readable. */
const MAX_JSON = 240;

/**
 * Describe a thrown value in words.
 *
 * Safe on anything: `Error`, a nested `cause` chain, an SDK error object, a
 * parsed JSON body, an array of zod issues, a bare string, a bare number,
 * `null`, `undefined`, or an object with a circular reference.
 */
export function describeError(err: unknown): string {
  const said = describe(err, 0);
  return said && said.trim() ? said.trim() : NOTHING_TO_SAY;
}

function describe(err: unknown, depth: number): string | null {
  if (depth > MAX_DEPTH) return null;
  if (err === null || err === undefined) return null;

  if (typeof err === 'string') return err.trim() || null;

  // ⚠️ A bare number is the one case where the obvious answer is forbidden:
  // returning `'503'` puts a naked status in front of a person, which is
  // exactly what the estate rule says must never happen.
  if (typeof err === 'number' || typeof err === 'bigint') {
    return `The call failed with code ${err} and no message.`;
  }
  if (typeof err !== 'object') return null;

  if (err instanceof Error) {
    const head = err.message.trim() || `${err.name || 'Error'} was thrown with no message.`;
    // `cause` is where the real reason usually is when a wrapper rethrows.
    const cause = describe((err as { cause?: unknown }).cause, depth + 1);
    const withCause = cause && !head.includes(cause) ? `${head} (caused by: ${cause})` : head;
    return withStatus(withCause, err as unknown as Record<string, unknown>);
  }

  return describeObject(err as Record<string, unknown>, depth);
}

function describeObject(o: Record<string, unknown>, depth: number): string | null {
  // A zod `issues` array, or any list of failures: say all of them.
  if (Array.isArray(o)) {
    const parts = o.map((item) => describe(item, depth + 1)).filter((s): s is string => !!s);
    return parts.length ? parts.join('; ') : null;
  }

  for (const field of MESSAGE_FIELDS) {
    const v = o[field];
    if (typeof v === 'string' && v.trim()) return withStatus(v.trim(), o);
  }

  for (const field of NESTED_FIELDS) {
    const nested = describe(o[field], depth + 1);
    if (nested) return withStatus(nested, o);
  }

  // An object with a real `toString` of its own (a `URL`, a custom class) is
  // worth reading. `Object.prototype.toString` is not — it is the source of
  // `[object Object]` and is deliberately excluded.
  const own = ownToString(o);
  if (own) return withStatus(own, o);

  // An object that is nothing BUT a status reads better as a sentence than as
  // its own JSON: `{"status":502}` is a bare status wearing braces.
  const keys = Object.keys(o);
  if (keys.length > 0 && keys.every((k) => k === 'status' || k === 'statusCode' || k === 'code')) {
    const only = statusOnly(o);
    if (only) return only;
  }

  // Anything else keeps its shape — a diagnostic nobody can read is still
  // better than one that was thrown away.
  const json = safeJson(o);
  if (json) return withStatus(`The failure was reported as ${json}`, o);

  return statusOnly(o);
}

/**
 * Append `(HTTP nnn)` when a status is present and the sentence does not
 * already say it. The status is context on a worded message, never the message.
 */
function withStatus(message: string, o: Record<string, unknown>): string {
  // ⚠️ `code` is deliberately NOT consulted here. Plenty of libraries put a
  // non-HTTP number in it (zod, node's errno), and `(HTTP 3)` is a lie that
  // reads like a fact. `statusOnly` still uses it, where it is all we have.
  const status = o.status ?? o.statusCode;
  if (typeof status !== 'number' || !Number.isFinite(status)) return message;
  if (message.includes(String(status))) return message;
  return `${message} (HTTP ${status})`;
}

function statusOnly(o: Record<string, unknown>): string | null {
  const status = o.status ?? o.statusCode ?? o.code;
  if (typeof status === 'number' && Number.isFinite(status)) {
    return `The service answered HTTP ${status} with no message.`;
  }
  if (typeof status === 'string' && status.trim()) {
    return `The service failed with code ${status.trim()} and no message.`;
  }
  return null;
}

function ownToString(o: object): string | null {
  const fn = (o as { toString?: unknown }).toString;
  if (typeof fn !== 'function' || fn === Object.prototype.toString) return null;
  try {
    const s = String(o).trim();
    return s && s !== '[object Object]' ? s : null;
  } catch {
    return null;
  }
}

function safeJson(o: object): string | null {
  let s: string;
  try {
    // A circular reference throws here rather than escaping into the caller.
    s = JSON.stringify(o) ?? '';
  } catch {
    return null;
  }
  if (!s || s === '{}' || s === '[]') return null;
  return s.length > MAX_JSON ? `${s.slice(0, MAX_JSON)}…` : s;
}
