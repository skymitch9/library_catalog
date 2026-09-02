/**
 * Leaf module: the sentence a 503 gets, and nothing else.
 *
 * ⚠️ **It imports nothing, and that is the whole reason it exists as a file.**
 * `errors.ts` imports `ApiError` from `../api.ts`, which imports `firebase.ts`,
 * which reads `import.meta.env` — a Vite-only global that is `undefined` under
 * `tsx`, so importing `describeError` in a test crashes at module load with
 * *"Cannot read properties of undefined (reading 'VITE_FIREBASE_API_KEY')"*
 * before a single assertion runs. (That is why `shelf-view.test.ts` imports only
 * *types* from `api.ts`: type imports are erased.) The decision worth
 * pinning is this one, so it lives where a test can reach it.
 */

/**
 * The 503 that genuinely IS about not being able to check access: the estate
 * directory could not be asked. Exported so the test asserts against the same
 * string the screen shows rather than a copy of it.
 */
export const ACCESS_UNAVAILABLE = "Couldn't check your access right now. Try again in a moment.";

/** The generic 5xx sentence — what a failure nobody named gets. */
export const SERVER_PROBLEM = 'The server had a problem. Try again in a moment.';

/**
 * A feature that is not SET UP on this instance, which is neither an outage nor
 * a permission problem and must not be worded as either.
 *
 * Used when the Worker names `not_configured` without writing its own sentence.
 * ⚠️ It names the **AI key** and an **admin**, not a file — see F17: `runResearch`
 * is held by moderators too, and *"put ANTHROPIC_API_KEY in
 * apps/worker/.dev.vars, then `npm run secrets:push`"* is not an action a
 * moderator has any way to take. The remediation for whoever CAN act lives in
 * the Worker log, beside the refusal.
 */
export const NOT_CONFIGURED =
  "This isn't set up on this catalog yet — an admin needs to add the AI key.";

/**
 * Error codes whose route wrote a sentence FOR A PERSON and means it to render.
 *
 * ⚠️ An allowlist, not "any code with a `detail`": `detail` is also where a
 * validation dump and a raw upstream message land, and neither is a sentence.
 * A route joins this set by writing prose a person can act on.
 */
const CARRIES_ITS_OWN_SENTENCE = new Set([
  // The scan service is unconfigured — an outage with nothing to do with the
  // person asking.
  'scan_unavailable',
  // The paid cover search has no API key on this instance (F2).
  'not_configured',
  // The paid cover search was reached and failed (F13) — timeout, budget,
  // upstream. The sentence says whether the attempt is believed to have been
  // billed, which is the question a person actually has before retrying.
  'search_failed',
]);

/** Did the route write its own person-facing sentence for this body? */
function ownSentence(body: { error?: unknown; detail?: unknown } | null): string | null {
  const error = typeof body?.error === 'string' ? body.error : '';
  const detail = typeof body?.detail === 'string' ? body.detail : '';
  return CARRIES_ITS_OWN_SENTENCE.has(error) && detail ? detail : null;
}

/**
 * Which 503 this is, in words.
 *
 * ⚠️ Every 503 used to get `ACCESS_UNAVAILABLE`, which made a **scan service
 * outage read as a permission problem** — the exact thing the estate rule
 * forbids (*a network or server failure is NOT a permission failure*), and it
 * sends people asking for access they already have. The Worker now says which
 * outage it is and writes the sentence itself; a body we do not recognise still
 * falls back rather than showing a bare status.
 *
 * ⚠️ **`not_configured` was the same bug wearing a different code** (F2,
 * 2026-08-25). The paid cover-search route answers 503 `not_configured` when
 * the instance has no `ANTHROPIC_API_KEY`, and every 503 that was not
 * `scan_unavailable` fell through to *"Couldn't check your access right now"* —
 * so an owner clicking **Search the web for a cover** on an instance with no key
 * was told their ACCESS could not be checked, and went and asked for a role they
 * already held. A missing key is a configuration fact, and it is now said as one.
 */
export function describeUnavailable(
  body: { error?: unknown; detail?: unknown } | null,
): string {
  const said = ownSentence(body);
  if (said) return said;
  if (body?.error === 'not_configured') return NOT_CONFIGURED;
  return ACCESS_UNAVAILABLE;
}

/**
 * Which 5xx this is, in words.
 *
 * ⚠️ **The generic branch used to eat a sentence the route had deliberately
 * written** (F13, 2026-08-25). `describeError` handled `status >= 500` before it
 * ever reached the `detail` fallback, so the cover search's 502 `search_failed`
 * — *timeout / budget exhausted / upstream* — rendered as *"The server had a
 * problem. Try again in a moment."* The person could not tell whether the
 * search had run (and been billed at ~6¢) before it died, so the reasonable
 * thing to do was click again and be billed twice.
 *
 * Codes are allowlisted rather than "any 5xx with a detail", because a `detail`
 * on an unhandled 500 is as likely to be a stack fragment as a sentence.
 */
export function describeServerFailure(
  body: { error?: unknown; detail?: unknown } | null,
): string {
  return ownSentence(body) ?? SERVER_PROBLEM;
}

/**
 * A **Firestore** failure, in words — the other store, the one `describeError`
 * knows nothing about.
 *
 * ⚠️ This exists because the shared collections are written by the BROWSER, not
 * by the Worker (`routes/reviews.ts` on why there is no service account), so a
 * refusal there arrives as a `FirebaseError` and never as an `ApiError`. Left
 * alone it surfaces as the SDK's own *"Missing or insufficient permissions."* —
 * a bare code in a sentence's clothing, which says nothing about what would
 * help. Mirrors `describeActionError` in
 * `audiobook_catalog/site/permission-ux.js`, which is the estate's canonical
 * copy of this idea.
 *
 * ⚠️ **`unavailable` is an OUTAGE, not a permission problem**, and it is
 * separated here for the reason the estate rule states outright: mislabelling
 * one sends people asking for access they already have.
 *
 * @param need what the caller knows the write requires, named in the sentence
 *   when the store refuses — e.g. `'the estate-wide moderator role'`.
 */
export function describeStoreError(err: unknown, opts?: { need?: string }): string {
  const code = String((err as { code?: unknown })?.code ?? '');
  const message = err instanceof Error ? err.message : String(err ?? '');

  if (code === 'permission-denied' || /insufficient permissions/i.test(message)) {
    return opts?.need
      ? `That was refused. It needs ${opts.need} — ask an owner or admin to grant it.`
      : 'That was refused: your account is not allowed to change this. Ask an owner or admin for access.';
  }
  if (code === 'unauthenticated') {
    return 'Your session has expired. Sign in again to continue.';
  }
  if (code === 'unavailable' || err instanceof TypeError) {
    return "Couldn't reach the shared store. Check your connection and try again.";
  }
  if (code === 'not-found') {
    return 'That note is already gone.';
  }
  return message || 'Something went wrong reaching the shared store.';
}
