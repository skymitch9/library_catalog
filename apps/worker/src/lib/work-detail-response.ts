/**
 * The ONE place the `GET /api/works/:id` response object is shaped.
 *
 * ⚠️ **This module exists because of a real outage (2026-08-24).** A refactor
 * dropped `editions` from this handler's `c.json({...})`; `WorkPage.tsx`
 * destructures `editions` and calls `editions.find(...)`, so with it `undefined`
 * the React route threw `TypeError: Cannot read properties of undefined
 * (reading 'find')` and **every** work page rendered blank in production. The
 * field was in no test and `verify:home` only hits 200s after the prod deploy,
 * so nothing caught it. Fix committed as `1b40080`; this guard makes the class
 * un-repeatable.
 *
 * Two rules keep it that way:
 *   1. The route builds its response ONLY through this function — never an
 *      inline object literal — so the response shape has a single home.
 *   2. `work-detail-contract.test.ts` reads the frontend's own consumer
 *      (`deriveWorkView` in `apps/web/src/lib/work-view.ts`) and fails the build
 *      if any field that consumer reads is missing from this object. Drop a
 *      field here (or the frontend grows a new one) and the test goes red before
 *      a deploy can.
 *
 * Every part is passed in already-computed; this function does no I/O and makes
 * no decisions. It only guarantees the KEYS, so that "present but null" and
 * "absent" stay distinguishable — a null that travels is a legitimate value, a
 * missing key is the outage.
 */

/** The pieces the route fetches, each under the exact key the page reads. */
export interface WorkDetailParts<
  Work = unknown,
  Editions = unknown,
  Copies = unknown,
  Reading = unknown,
  Watches = unknown,
  AudiobookHolding = unknown,
  AudioEditions = unknown,
  EbookHolding = unknown,
  PeerHoldings = unknown,
> {
  work: Work;
  editions: Editions;
  copies: Copies;
  reading: Reading;
  watches: Watches;
  audiobookHolding: AudiobookHolding;
  audioEditions: AudioEditions;
  /**
   * How many recordings the household holds NOW. ⚠️ Optional ON THE WIRE by
   * design — a response cached from before this field existed must render
   * exactly what it rendered before, never "0 audiobooks" — but the live route
   * always supplies it, so it is always built here.
   */
  audioEditionCount: number | undefined;
  ebookHolding: EbookHolding;
  peerHoldings: PeerHoldings;
  /** Which shared world, or null. null is the ordinary answer; the page draws nothing for it. */
  universe: string | null;
}

/**
 * Assemble the `GET /api/works/:id` body. The key set here IS the contract the
 * work page depends on; changing it is a change to that contract and the
 * contract test must move with it.
 */
export function buildWorkDetailResponse(parts: WorkDetailParts) {
  return {
    work: parts.work,
    // ⚠️ The field the outage dropped. The page `.find()`s over it; it must
    // always travel, even as an empty array.
    editions: parts.editions,
    copies: parts.copies,
    reading: parts.reading,
    watches: parts.watches,
    audiobookHolding: parts.audiobookHolding,
    audioEditions: parts.audioEditions,
    audioEditionCount: parts.audioEditionCount,
    ebookHolding: parts.ebookHolding,
    peerHoldings: parts.peerHoldings,
    universe: parts.universe,
  };
}
