import { DETAIL_FIELD_LABEL, type DetailField } from '@lc/core';

import type { FreeLadderView } from '../api.js';

/**
 * *Why did this run cost money?* — the free ladder, in words.
 *
 * ## The question this exists to answer
 *
 * > *"tell me why padhard library wasn't resolved by the free lookup with
 * > series and description?"* — the owner, 2026-08-26 22:55, after a **paid**
 * > run on padhard #578 *After Life*.
 *
 * It took a session with the code and the tables open to answer him. The free
 * ladder HAD run — `research-run.ts` calls it before the model, always — but
 * run 738's whole `result_json` was **261 bytes naming `sources: llm`**, so
 * which rungs were asked, what each said, and why each fell through were
 * nowhere. The run record could say what was bought and could not say what was
 * tried first.
 *
 * These functions turn the record that now IS stored into the sentences the
 * page shows. They are pure and live in `lib/` for the reason
 * `details-residue.ts` does: this app has **no DOM renderer**, so a sentence
 * written inline in JSX is a sentence nothing can pin.
 *
 * ## ⚠️ The distinction every function here is built around
 *
 * **Three states, and they must never be printed the same way:**
 *
 * | state | means | shows as |
 * |---|---|---|
 * | `free` is `null` | nobody wrote the ladder down. Every run before 2026-09-02 | **nothing at all** |
 * | a rung in `rungs` with no skip line | it was asked and it ANSWERED | the source line already says so |
 * | a rung in `rungs` with a skip line | asked, and could not answer — the line says why | the skip, verbatim |
 * | a rung NOT in `rungs` | never reached, because the fields closed above it | *"not reached"*, never *"found nothing"* |
 *
 * The last row is the one that costs real time when it is got wrong: the covers
 * sweep printed *"no cover anywhere"* for a rung that was never asked and the
 * mistake survived two sessions (`covers-and-series.md` §0).
 */

/**
 * The rungs, in words.
 *
 * ⚠️ **Keep in step with `FreeRung` in `apps/worker/src/lib/free-details.ts`.**
 * An unrecognised key falls through to itself rather than vanishing, so a
 * missed rung renders as the bare identifier (`wikidata`) — visibly unfinished
 * rather than silently absent, which is exactly how `wikidata` was caught
 * missing when `hardcover` was added on 2026-08-25.
 *
 * ⚠️ Deliberately NOT shared with the Worker's own `RUNG_LABEL`. These strings
 * are what a person reads; the Worker's copy is what goes into a run's stored
 * sentence. The two are allowed to be worded differently for their two
 * audiences. What must not drift is the KEY.
 */
export const SOURCE_LABEL: Record<string, string> = {
  audiobook: 'the audiobook catalogue',
  index: 'the estate index',
  openlibrary: 'Open Library',
  googlebooks: 'Google Books',
  hardcover: 'Hardcover',
  wikidata: 'Wikidata',
  llm: 'a paid lookup',
};

/** Every free rung, in the order `FREE_LADDER_RUNGS` asks them. */
export const FREE_RUNGS: readonly string[] = [
  'audiobook',
  'index',
  'openlibrary',
  'googlebooks',
  'hardcover',
  'wikidata',
];

export function sourceLabel(rung: string): string {
  return SOURCE_LABEL[rung] ?? rung;
}

function fieldLabel(field: string): string {
  return DETAIL_FIELD_LABEL[field as DetailField] ?? field;
}

/** A list in English: `a`, `a and b`, `a, b and c`. */
function andList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

/**
 * Is there anything to show at all?
 *
 * ⚠️ **A record with every array empty still counts as something**, because it
 * is a measurement: the ladder ran and reported nothing. Only `null` — the run
 * that predates the record — renders as silence. `freeLadderAsked` below is
 * what carries that sentence.
 */
export function hasFreeLadderRecord(free: FreeLadderView | null | undefined): free is FreeLadderView {
  return free != null;
}

/**
 * *"Free lookups asked: the audiobook catalogue, Open Library and Google
 * Books. Not reached: Hardcover, Wikidata."*
 *
 * ⚠️ **The "not reached" half is the point.** A ladder that stopped at rung 3
 * because rung 3 answered is a ladder that did its job, and printing the four
 * unasked rungs as silent would read as four sources that knew nothing about
 * the book.
 *
 * Returns `null` when the run recorded no `rungs` array at all — an older
 * Worker's record, about which nothing may be claimed.
 */
export function freeLadderAsked(free: FreeLadderView): string | null {
  const rungs = free.rungs;
  if (!rungs) return null;
  if (rungs.length === 0) {
    // The ladder returned before it reached a single rung. That happens for a
    // real reason every time — every field already settled by a verdict, or the
    // only open field being one no free rung will answer — and `skipped` is
    // carrying that reason, so this says the fact and not the cause.
    return 'Free lookups: none were asked.';
  }
  const asked = rungs.map(sourceLabel);
  const notReached = FREE_RUNGS.filter((r) => !rungs.includes(r)).map(sourceLabel);
  const parts = [`Free lookups asked: ${andList(asked)}.`];
  if (notReached.length > 0) {
    parts.push(`Not reached: ${andList(notReached)}.`);
  }
  return parts.join(' ');
}

/**
 * What each rung said for itself, verbatim.
 *
 * ⚠️ **Verbatim, and not re-worded here.** The ladder's skip lines already
 * distinguish *could not be asked* from *asked and knew nothing* — that is the
 * rule `free-details.ts` is built on and the reason they are strings rather
 * than an enum. Summarising them into a count would delete the only content
 * they have.
 */
export function freeLadderSkips(free: FreeLadderView): string[] {
  return free.skipped ?? [];
}

/**
 * *"The paid lookup was asked for: series and volume number."*
 *
 * The line that closes the loop on the owner's question. Returns `null` when
 * nothing was left over — the run was free, and `detail` already says so in
 * those words.
 */
export function paidAskSentence(free: FreeLadderView): string | null {
  const open = free.stillOpen;
  if (!open || open.length === 0) return null;
  return `The paid lookup was asked for: ${andList(open.map(fieldLabel))}.`;
}

/**
 * *"The free checks filled in 2 of the 3 things that were missing."*
 *
 * ⚠️ Not a substitute for the run's own `detail`, which quotes what each value
 * BECAME. This is the one-line arithmetic that makes the cost legible beside
 * it, and it is skipped entirely when the free rungs wrote nothing — a zero
 * stated proudly reads as a boast about failure.
 */
export function freeLadderFilled(free: FreeLadderView): string | null {
  const applied = free.applied;
  if (!applied || applied.length === 0) return null;
  const open = free.stillOpen?.length ?? 0;
  const total = applied.length + open;
  const missing =
    total === 1 ? 'the one thing that was missing' : `the ${total} things that were missing`;
  return `The free checks filled in ${applied.length} of ${missing}.`;
}
