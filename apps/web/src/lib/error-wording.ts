/**
 * Leaf module: the sentence a 503 gets, and nothing else.
 *
 * ⚠️ **It imports nothing, and that is the whole reason it exists as a file.**
 * `errors.ts` imports `ApiError` from `../api.ts`, which imports `firebase.ts`,
 * which reads `import.meta.env` — a Vite-only global that is `undefined` under
 * `tsx`, so importing `describeError` in a test crashes at module load with
 * *"Cannot read properties of undefined (reading 'VITE_FIREBASE_API_KEY')"*
 * before a single assertion runs. (That is why `other-versions.test.ts` imports
 * only a *type* from `api.ts`: type imports are erased.) The decision worth
 * pinning is this one, so it lives where a test can reach it.
 */

/**
 * The 503 that genuinely IS about not being able to check access: the estate
 * directory could not be asked. Exported so the test asserts against the same
 * string the screen shows rather than a copy of it.
 */
export const ACCESS_UNAVAILABLE = "Couldn't check your access right now. Try again in a moment.";

/**
 * Which 503 this is, in words.
 *
 * ⚠️ Every 503 used to get `ACCESS_UNAVAILABLE`, which made a **scan service
 * outage read as a permission problem** — the exact thing the estate rule
 * forbids (*a network or server failure is NOT a permission failure*), and it
 * sends people asking for access they already have. The Worker now says which
 * outage it is (`error: 'scan_unavailable'`) and writes the sentence itself; a
 * body we do not recognise still falls back rather than showing a bare status.
 */
export function describeUnavailable(
  body: { error?: unknown; detail?: unknown } | null,
): string {
  if (body?.error === 'scan_unavailable' && typeof body.detail === 'string' && body.detail) {
    return body.detail;
  }
  return ACCESS_UNAVAILABLE;
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
