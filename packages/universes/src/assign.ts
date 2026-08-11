/**
 * What to STORE on a work, given what the list says and what is already there.
 *
 * ⚠️ This is not a second lookup. `universeFor` in `lookup.ts` is the only thing
 * that decides which universe a book is in, and this file never inspects the
 * index itself — it calls that one function and then answers a different
 * question: *may we overwrite what the row already says?*
 *
 * The split is deliberate and it is why this is a separate file:
 *
 *   lookup.ts   is the CROSS-REPO contract. `audiobook_catalog` has a Python
 *               twin of it, `universes.fixtures.json` pins them together, and
 *               changing the resolution order there means changing it in four
 *               places (`docs/info/universes.md` §5).
 *   assign.ts   is local to this repo, and has no Python counterpart on purpose.
 *               The audiobook side is a static build with no rows to stamp and
 *               nowhere to record a human answer; storage provenance is a
 *               question only a database has.
 *
 * Migration 0080 carries the rest of the reasoning, including why the value is
 * stored rather than recomputed on every read.
 */

import type { UniverseSource } from '@lc/core';
import { universeFor, type UniverseIndex, type UniverseQuery } from './lookup.js';

/**
 * A universe and the evidence for it, as the pair is stored on `work`.
 *
 * ⚠️ The two travel together and must never be written separately. `universe`
 * alone cannot distinguish "the list has nothing to say" from "a person says no"
 * — and those need opposite treatment from the next backfill.
 */
export interface UniverseAssignment {
  /** The owner's canonical name, or null for *in no universe*. */
  universe: string | null;
  /** `'list'`, `'human'`, or null when nobody and nothing has decided. */
  how: UniverseSource | null;
}

/** Nothing decided. The state of every row before 0080, and of most rows after. */
export const NO_UNIVERSE: UniverseAssignment = { universe: null, how: null };

/**
 * Resolve a brand-new work.
 *
 * ⚠️ **A miss is `{ null, null }`, not `{ null, 'list' }`.** The temptation is to
 * record that the list was consulted, and it would be actively harmful: it turns
 * "the list has nothing to say about this book" into a stored decision, and the
 * backfill that re-resolves machine rows when the list grows would then have to
 * treat a stamped miss and an unexamined row identically anyway. Recording a
 * negative that nothing observed is the same mistake migration 0070 refused when
 * it declined to backfill NULL read-states to 'human'.
 *
 * This costs one Map lookup against bundled JSON. No network, no LLM — ⚠️ **the
 * add path must never call a model.** The list is curated by hand through
 * `catalog-platform/tools/universes.mjs`, which refuses an edit that cannot say
 * why it happened; a book arriving on a shelf is not where a universe gets
 * invented, and a guess is the one outcome the whole list exists to prevent.
 */
export function universeOnCreate(index: UniverseIndex, query: UniverseQuery): UniverseAssignment {
  const universe = universeFor(index, query);
  return universe === null ? NO_UNIVERSE : { universe, how: 'list' };
}

/**
 * Re-resolve an existing work whose title or series may have moved.
 *
 * ⚠️ **A human answer is never overwritten, including a human "no universe".**
 * `{ universe: null, how: 'human' }` is somebody saying *this book is in no
 * verse*, and it is the case that makes the pair worth storing at all: without
 * the `how`, the very next edit to the title would quietly put the list's
 * opinion back over a correction the owner had just made. Same rule
 * `read_state_how = 'human'` follows, for the same reason.
 *
 * Everything else re-resolves, including a previous `{ null, null }`. A book
 * catalogued from a barcode arrives with no series — the scan line has no such
 * field — so the series usually lands *later*, from `backfill:series` or from
 * the details queue. If an update did not re-resolve, case two of the owner's
 * ask ("a new book in a series we already know") would never fire for a scanned
 * book at all.
 */
export function universeOnUpdate(
  index: UniverseIndex,
  current: UniverseAssignment,
  next: UniverseQuery,
): UniverseAssignment {
  if (current.how === 'human') return current;
  return universeOnCreate(index, next);
}

/**
 * A person's answer, replacing whatever was there.
 *
 * Folded onto the owner's spelling when it is recognisable, kept verbatim when
 * it is not. ⚠️ The fold is not tidiness: `Cosmere` and `The Cosmere` already
 * exist in this estate as two spellings of one thing — as *series* values on two
 * different works, recorded under The Cosmere's `notes` — and two spellings in
 * this column would split every "show me the Cosmere shelf" query in half
 * without ever looking wrong on a page. Keeping an unrecognised name verbatim is
 * the other half of the rule: a person naming a universe the list has not got
 * yet is the reason this function exists, so refusing it would defeat the point.
 *
 * `canonicalUniverseName` is passed in rather than imported so this stays a pure
 * decision over strings; `@lc/db` supplies the bound index.
 */
export function universeAsserted(
  canonicalise: (name: string) => string | null,
  asserted: string | null,
): UniverseAssignment {
  if (asserted === null) return { universe: null, how: 'human' };
  return { universe: canonicalise(asserted) ?? asserted, how: 'human' };
}
