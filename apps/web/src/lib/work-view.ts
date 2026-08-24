/**
 * The work page's render-critical derivation, split out of `WorkPage.tsx` so it
 * can be exercised WITHOUT a DOM — the `buildVersionEntries` / `note-rows.ts`
 * pattern this repo uses because `WorkPage.tsx` reaches `firebase.ts`, which
 * reads `import.meta.env` at module scope and cannot be imported under the
 * node test runner.
 *
 * ⚠️ **This is where the 2026-08-24 outage lived.** `WorkPage` destructured
 * `editions` from the `/api/works/:id` response and called `editions.find(...)`;
 * the worker had dropped `editions`, so `.find` ran on `undefined` and every
 * work page rendered blank. That exact call now lives here, behind one function
 * the render smoke-test (`apps/web/test/work-page-render.test.ts`) drives across
 * the empty-array and null shapes where `.find()`/`.map()` crashes hide.
 *
 * ⚠️ **`WorkDetail` here is the CONSUMER contract.** The worker's contract test
 * (`apps/worker/src/lib/work-detail-contract.test.ts`) reads the `detail.<field>`
 * accesses in `deriveWorkView` below and asserts the worker's response builder
 * supplies every one of them. Add a `detail.` read here and the worker must grow
 * the field to match, or the build goes red.
 */
import type { Me, Watch, WorkAudioEdition, WorkAudiobookHolding, WorkEbookHolding } from '../api.js';
import type { CopyView } from '../components/Copies.js';
import type { EditionView } from '../components/Editions.js';
import { shouldShowDriveLinks } from './formats.js';

/**
 * The shape of the `GET /api/works/:id` response, as the work page consumes it.
 * The worker assembles this in `apps/worker/src/lib/work-detail-response.ts`;
 * the two are bridged by the contract test.
 */
export interface WorkDetail {
  work: {
    id: number;
    title: string;
    subtitle: string | null;
    /** Null for a book added without an author — see EditTitleAuthor. */
    authors: string | null;
    series: string | null;
    seriesIndexDisplay: string | null;
    /**
     * Where it sorts, and — by owner rule 2026-08-19 — the VOLUME itself.
     * `seriesIndexDisplay` is the optional designation a printing physically
     * carries; `docs/info/volume-numbers.md` is the canonical semantics.
     */
    seriesIndexSort: number | null;
    /** One series slot, several physical volumes. Human-set only (0360). */
    multiVolumePrinting: boolean;
    firstPublished: number | null;
    description: string | null;
    coverUrl: string | null;
    /** 'ok' | 'standin' | null. ⚠️ null is "nobody has looked", not "fine". */
    coverStatus: 'ok' | 'standin' | null;
    /**
     * The illustrator credit, or null for *unrecorded*. Migration 0130.
     * ⚠️ Null renders as NOTHING — not an empty label. Most novels have none,
     * and absence already says it; same rule as `universe: null` below.
     */
    illustrator: string | null;
    workKey: string;
  };
  /**
   * The shared world this book belongs to, or null.
   *
   * ⚠️ **null is the ordinary answer.** Most of this catalog is children's
   * picture books that belong to no universe and are correctly filed; the head
   * renders nothing at all for them.
   */
  universe: string | null;
  editions: EditionView[];
  copies: CopyView[];
  /** Open and resolved both — see `listWatchesForWork`. Rides along with the work. */
  watches: Watch[];
  /**
   * What the sibling audiobook catalog holds for this work, or null. Rides along
   * with the work because it is a fact about the book, not a second request.
   */
  audiobookHolding: WorkAudiobookHolding | null;
  /**
   * Every audiobook edition of this work — migration 0390. Beside
   * `audiobookHolding`, ordered the same way, so `[0]` is the edition that field
   * describes. Empty on a book with no audio; length 2 is the case 0390 exists for.
   */
  audioEditions: WorkAudioEdition[];
  /**
   * How many recordings of this book the household holds **now**.
   *
   * ⚠️ Optional: an API response cached from before this field existed must
   * render exactly what it rendered before, never "0 audiobooks". Because it is
   * optional, the contract test does NOT require it in the response — every
   * other field here IS required.
   */
  audioEditionCount?: number;
  /**
   * The shared pool's ebook holding cache — migration 0310. Runs BESIDE the
   * edition rows, never instead of them. Null is the ordinary physical-only book.
   */
  ebookHolding: WorkEbookHolding | null;
  peerHoldings: Array<{
    peerId: string;
    peerLabel: string;
    detailUrl: string | null;
    formats: string | null;
  }>;
  reading: {
    read_state: string;
    started_on: string | null;
    finished_on: string | null;
    read_format: string | null;
    /** `'human' | 'rating' | null`. Migration 0070. NULL is "unrecorded". */
    read_state_how: string | null;
  } | null;
}

/** Everything the work page's JSX needs, derived once so nothing is read twice. */
export interface WorkView {
  work: WorkDetail['work'];
  editions: EditionView[];
  copies: CopyView[];
  reading: WorkDetail['reading'];
  watches: Watch[];
  audioEditions: WorkAudioEdition[];
  audioEditionCount: number | undefined;
  peerHoldings: WorkDetail['peerHoldings'];
  audiobookHolding: WorkAudiobookHolding | null;
  ebookHolding: WorkEbookHolding | null;
  universe: string | null;
  /**
   * The first edition that names a file — the best Drive search term for this
   * book. ⚠️ This is the `editions.find(...)` the outage crashed on; it is here,
   * behind the test, on purpose.
   */
  fileEdition: EditionView | null;
  showDrive: boolean;
  canTrack: boolean;
}

/**
 * Read the `/api/works/:id` response into the values the page renders.
 *
 * ⚠️ Reads `detail.<field>` explicitly (never a `const {...} = detail`) so the
 * worker contract test can enumerate exactly which response fields the page
 * depends on. Keep it that way.
 *
 * ⚠️ It is deliberately NOT defensive about `editions`: `detail.editions.find`
 * will throw if the field is missing, which is precisely the outage. The guard
 * against that is the contract test (the field cannot go missing), not a `?? []`
 * that would hide a broken response as an empty shelf.
 */
export function deriveWorkView(detail: WorkDetail, me: Me): WorkView {
  const editions = detail.editions;
  return {
    work: detail.work,
    editions,
    copies: detail.copies,
    reading: detail.reading,
    watches: detail.watches ?? [],
    audioEditions: detail.audioEditions ?? [],
    audioEditionCount: detail.audioEditionCount,
    peerHoldings: detail.peerHoldings,
    audiobookHolding: detail.audiobookHolding,
    ebookHolding: detail.ebookHolding,
    universe: detail.universe,
    fileEdition: editions.find((e) => e.source_url) ?? null,
    showDrive: shouldShowDriveLinks(editions),
    canTrack: me.capabilities.includes('trackReading'),
  };
}
