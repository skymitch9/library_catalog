/**
 * Leaf module: what the content-notes panel OFFERS, decided away from React.
 *
 * ⚠️ **It imports `@lc/core` and nothing else, and that is the whole reason it
 * is a file.** `ContentNotes.tsx` imports `api.ts` and `firebase.ts`, and
 * `firebase.ts` reads `import.meta.env` at module scope — a Vite-only global
 * that is `undefined` under `tsx`, so a test importing the component crashes at
 * load with *"Cannot read properties of undefined (reading
 * 'VITE_FIREBASE_API_KEY')"* before a single assertion runs. Measured while
 * writing `apps/web/test/content-notes.test.ts`, which is exactly the trap
 * `error-wording.ts`'s header already records for the 503 wording.
 *
 * The rules here are worth a test rather than a browser check: a Remove control
 * drawn for somebody `firestore.rules` will refuse looks fine until it is
 * pressed, and one withheld from a person who may use it is indistinguishable
 * from the feature not existing.
 */

import { warningDeleteVerdict } from '@lc/core';

/** The fields of a warning document these rules read. Nothing else. */
export interface NoteSource {
  id: string;
  label: string;
  displayName?: string | null;
  authorUid?: string | null;
}

/** One reader note, reduced to what the list renders. */
export interface NoteRow {
  id: string;
  label: string;
  /** Who added it. Falls back to a stated absence, never to a blank. */
  credit: string;
  /** Draw the remove control? */
  canDelete: boolean;
  /** Why not, when not — a sentence, never a code. Null when it can. */
  refusal: string | null;
  /** True when the control is offered for the ROLE, not for authorship. */
  asModerator: boolean;
}

/**
 * ⚠️ The verdict itself is `warningDeleteVerdict` in `@lc/core`, the ONE
 * implementation — it mirrors `canDeleteUserWarning()` in the audiobook
 * catalog's `firestore.rules`, and a second copy of "may I delete this" living
 * inside a component is how the two would drift apart the first time those
 * rules changed. This function only turns a verdict into a row.
 */
export function buildNoteRows(params: {
  warnings: readonly NoteSource[];
  uid: string | null;
  displayName: string | null;
  canModerate: boolean;
}): NoteRow[] {
  return params.warnings.map((w) => {
    const verdict = warningDeleteVerdict(w, {
      uid: params.uid,
      displayName: params.displayName,
      canModerate: params.canModerate,
    });
    return {
      id: w.id,
      label: w.label,
      // ⚠️ Never blank. An unattributed note is a real state — legacy sessions
      // on the audiobook site wrote some — and "somebody" is honest where an
      // empty span reads as a rendering bug.
      credit: (w.displayName ?? '').trim() || 'somebody',
      canDelete: verdict.allowed,
      refusal: verdict.allowed ? null : verdict.reason,
      asModerator: verdict.allowed && verdict.via === 'moderator',
    };
  });
}
