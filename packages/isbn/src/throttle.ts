/**
 * One request to Open Library at a time, a beat apart.
 *
 * ⚠️ **This file is what makes the automatic lookup pass safe.** The pass fires
 * a chunk of eight searches with `Promise.all`, which reads like eight parallel
 * requests and is not: every one of them goes through `schedule`, so the actual
 * upstream concurrency from a Worker isolate is **one**, with `MIN_GAP_MS`
 * between calls. Remove this and a shelf photograph becomes a burst of eight
 * simultaneous searches from one IP, which is the shape that gets an IP
 * throttled by a free, donation-funded service we depend on entirely.
 *
 * Ported from the Board Game Catalog's `packages/bgg/src/client.ts`, which grew
 * it for BoardGameGeek and states the rule as "be a good citizen".
 *
 * ## What is and is not on the queue
 *
 * **On it:** the title searches in `search.ts`. They are the bulk path — one
 * shelf photograph is fifteen of them, arriving at machine speed with nobody
 * waiting on any individual answer.
 *
 * **Deliberately off it:** `lookupOpenLibraryByIsbn` in `resolve.ts`. A barcode
 * lookup is on a person's critical path — they want the title back before they
 * put the book down — and it is already paced by how fast someone can turn a
 * book over. Putting it behind a shared queue would mean a scan landing behind
 * eight background searches and taking nine seconds to answer, which trades a
 * problem we do not have for one we would notice immediately.
 *
 * ## ⚠️ `MIN_GAP_MS` is a politeness figure, not a measurement
 *
 * 1100ms is carried across from the sibling's BGG client, where it came from
 * BGG's published "roughly one request a second". **Open Library's own rate
 * guidance has not been checked against this number**, and no 429 from Open
 * Library has ever been observed from this app. It is deliberately the only
 * knob: if a shelf turns out to be too slow, or a 429 ever appears, this
 * constant is the one line to change.
 *
 * ## Per isolate, not global
 *
 * A Worker isolate has its own module scope, so two concurrent invocations have
 * two queues. That is the same bound the sibling accepts. What keeps the total
 * down here is one layer up: a job runs one chunk at a time, and the route
 * refuses to start a second pass over a job that is already running one.
 */

/** BGG's published rate, borrowed. See the header — not measured here. */
export const MIN_GAP_MS = 1100;

/** Serialises calls within this isolate and keeps them a beat apart. */
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

export function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  // Keep the chain alive when a call rejects. Without this a single failed
  // search poisons the queue and every later one rejects with its error.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
