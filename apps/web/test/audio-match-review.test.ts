/**
 * **Is this the right audio?** — the verdict the owner records in the edit box,
 * and what it changes on the shelf. Migration 0450.
 *
 * ## The ask this pins (owner, 2026-09-03 ~14:37 Phoenix, verbatim)
 *
 *   > "Also I see a lot of books asking if this is the right audio, can we make
 *   >  all of those question ones show the audio even if not sure and then we
 *   >  can confirm if it's right in the edit menu later? Any dramatic misses
 *   >  ping me about"
 *
 * Approved as a pair (*"Yes do it"*, 15:03): the chips stop hedging
 * (`audio-edition-chip.test.ts` pins that half) and the doubt becomes a
 * decision, stored in its own table because the three-times-a-day sync rewrites
 * `matched_via` and would erase a verdict kept there — migration 0110's
 * argument, applied one grain finer.
 *
 * ## ⚠️ Why this is its own file rather than more of `shelf-view.test.ts`
 *
 * Two reasons, and the first is the load-bearing one:
 *
 * 1. **`review` is a filter with a null-means-YES rule**, and that inversion is
 *    the whole risk. `null` / `undefined` is *un-reviewed*, which is the state
 *    of every recording in both catalogs today; a reader that treated absence
 *    as a rejection would empty the Audio section of the entire shelf, and it
 *    would do it silently. Every test here asserts the un-reviewed case beside
 *    the rejected one for exactly that reason.
 * 2. The shelf file is large and was being edited concurrently. A new
 *    behaviour gets a new file; the two pins that genuinely belonged in the old
 *    one (the reworded provenance sentence) were amended there in place.
 *
 * Pure functions only — `deriveShelfView` and `matchProvenance`, no DOM, the
 * house pattern.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { REJECTION_COST, deriveShelfView, matchProvenance } from '../src/lib/shelf-view.ts';

const NONE = {
  copies: [],
  editions: [],
  audiobookHolding: null,
  audioEditions: [],
  audioEditionCount: undefined,
  ebookHolding: null,
  peerHoldings: [],
};

/** The `audiobook_holding` view's row, as the work payload carries it. */
function holding(over: Record<string, unknown> = {}) {
  return {
    title: 'Harry Potter and the Chamber of Secrets',
    rawTitle: 'Harry Potter and the Chamber of Secrets (Full-Cast Edition)',
    authors: 'J.K. Rowling',
    series: 'Harry Potter',
    indexDisplay: 'Book 2',
    coverHref: null,
    matchedVia: 'containment',
    titleSimilarity: 0.81,
    staleAt: null,
    review: null,
    ...over,
  } as never;
}

/** One row of `audiobook_edition_holding` — migration 0390. */
function edition(over: Record<string, unknown> = {}) {
  return {
    audioKey: 'Elantris',
    title: 'Elantris',
    authors: 'Brandon Sanderson',
    series: null,
    indexDisplay: null,
    narrator: 'full cast',
    coverHref: null,
    matchedVia: 'exact',
    titleSimilarity: 1,
    staleAt: null,
    review: null,
    ...over,
  } as never;
}

const audioRows = (v: { rows: { medium?: string | null }[] }) =>
  v.rows.filter((r) => r.medium === 'audio');

describe('a REJECTED recording leaves the shelf — migration 0450', () => {
  /*
   * ⚠️ The control case, and it is not ceremony. `review: null` is what every
   * recording in both catalogs carries today; if this ever goes red the filter
   * has inverted and the Audio section is empty catalogue-wide.
   */
  it('an UN-REVIEWED recording renders exactly as it always did', () => {
    const v = deriveShelfView({ ...NONE, audiobookHolding: holding(), audioEditionCount: 1 });
    assert.equal(audioRows(v).length, 1);
  });

  it('an undefined `review` — a response cached before 0450 — also renders', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: holding({ review: undefined }),
      audioEditionCount: 1,
    });
    assert.equal(audioRows(v).length, 1, 'absent must read as un-reviewed, never as rejected');
  });

  it('a rejected holding gives NO audio row, and no empty Audio heading', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: holding({ review: 'rejected' }),
      audioEditionCount: 0,
    });
    assert.equal(audioRows(v).length, 0);
    // ⚠️ AMENDED 2026-09-03 (SHELF round 2): the shelf's mediums became format
    // TABS, so what this asks is now "no Audio TAB" rather than "no Audio
    // section". The claim is unchanged — an empty bucket is not built at all,
    // never rendered as a heading (or a tab) over nothing.
    assert.equal(
      v.tabs.find((t) => t.key === 'audio'),
      undefined,
      'an empty tab is omitted, not offered as a tab over nothing',
    );
  });

  /*
   * ⚠️ This is the case that separates "rejected" from "stale", and the two
   * must not be collapsed. A STALE row is the other catalog withdrawing a match
   * that was once true — worth showing with a caveat. A REJECTED row is the
   * owner saying it was never this book; there is nothing left to caveat, and a
   * row under the heading "Audio" is itself the claim.
   */
  it('a STALE recording still renders — only a rejected one is hidden', () => {
    const stale = deriveShelfView({
      ...NONE,
      audiobookHolding: holding({ staleAt: '2026-08-23 04:00:00' }),
      audioEditionCount: 0,
    });
    assert.equal(audioRows(stale).length, 1, 'hiding a stale row looks like "never matched"');
  });

  /*
   * ⚠️ The survivor here is the HOLDING (`audioEditions[0]`, both orderings
   * identical by construction), so the row keeps the `own-audio` key and is not
   * re-derived from the list. That is deliberate and predates 0450: five other
   * callers trust `audiobookHolding` to be the row the view picked, and a
   * one-recording book must never start depending on a field an older cached
   * response may not carry. What 0450 changes is the COUNT — two rows on record,
   * one recording held.
   */
  it('two recordings, one rejected → one row, from the holding', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: holding({ title: 'Elantris', rawTitle: 'Elantris' }),
      audioEditions: [
        edition(),
        edition({
          audioKey: 'Elantris - Tenth Anniversary Special Edition',
          title: 'Elantris - Tenth Anniversary Special Edition',
          narrator: 'Jack Garrett',
          review: 'rejected',
        }),
      ],
      audioEditionCount: 1,
    });
    const rows = audioRows(v) as { key: string; count: number | null }[];
    assert.equal(rows.length, 1, 'the rejected recording is not a row');
    assert.equal(rows[0]!.key, 'own-audio');
    assert.equal(rows[0]!.count, null, 'one held recording wears no count badge');
  });

  /*
   * The awkward shape the naive filter gets wrong: the PRIMARY row — the one
   * the `audiobook_holding` view picked and five other callers trust — is the
   * rejected one, and a second recording survives. An empty Audio section over
   * a book the household demonstrably owns on audio would be worse than either
   * outcome, so the survivor is rendered.
   */
  it('the PRIMARY recording rejected, a second one live → the second is shown', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: holding({
        title: 'Elantris',
        rawTitle: 'Elantris',
        review: 'rejected',
      }),
      audioEditions: [
        edition({ review: 'rejected' }),
        edition({
          audioKey: 'Elantris - Tenth Anniversary Special Edition',
          title: 'Elantris - Tenth Anniversary Special Edition',
          narrator: 'Jack Garrett',
        }),
      ],
      audioEditionCount: 1,
    });
    const rows = audioRows(v) as { key: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.key, 'audio:Elantris - Tenth Anniversary Special Edition');
  });

  /*
   * ⚠️ The count fallback has to agree with `audioEditionCountSql`, which now
   * excludes rejected rows server-side. Two halves of one number disagreeing is
   * the exact drift that fragment's "one definition" rule exists to prevent.
   */
  it('the client-side count fallback drops rejected recordings too', () => {
    const v = deriveShelfView({
      ...NONE,
      audiobookHolding: holding({ title: 'Elantris', rawTitle: 'Elantris' }),
      audioEditions: [
        edition(),
        edition({ audioKey: 'Elantris - Tenth', title: 'Elantris - Tenth', review: 'rejected' }),
      ],
      // The server field ABSENT — an old cached body — so the fallback runs.
      audioEditionCount: undefined,
    });
    const rows = audioRows(v) as { count: number | null }[];
    // One survivor, so it renders from the holding and the ×N is silent at 1.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.count, null, 'one recording wears no count badge');
  });
});

/**
 * ⚠️ **The edit-box line — shipped 2026-09-07 WITH the bridge filter, not after
 * it.** The `rejected` filter reached `reviews.ts`'s `/bookid-index` and
 * `@lc/db`'s TBR bridge on that date; the recommendation it shipped under said
 * in the same breath that it *"should ship beside a line on the edit box saying
 * what a rejection removes"*, because the 8 live containment matches on the
 * main instance each carry a real read state and cached rating that arrived
 * **through** those bridges.
 *
 * Asserted on the exported string rather than on rendered DOM: this harness has
 * no jsdom, and the properties that matter are properties of the WORDS.
 * ⚠️ **The one placement claim is checked by READING THE SOURCE**, the pattern
 * `copy-special-toggles.test.ts` already uses — the component imports
 * `../api.js`, which loads Firebase at module scope and cannot be imported
 * here. ⚠️ **NOT covered: that the paragraph is legible, or that it renders at
 * all.** Nobody has opened the tab.
 */
describe('⚠️ the edit box says what "Not this one" costs — BEFORE it is pressed', () => {
  it('names the review and to-be-read bridges, which are what the filter closed', () => {
    assert.ok(REJECTION_COST.includes('review'), REJECTION_COST);
    assert.ok(REJECTION_COST.includes('to-be-read'), REJECTION_COST);
  });

  it('still names the three surfaces 0450 already hid it from', () => {
    for (const surface of ['shelf', 'series ladder', 'audiobook filter']) {
      assert.ok(REJECTION_COST.includes(surface), `${surface} missing from: ${REJECTION_COST}`);
    }
  });

  /*
   * 🔴 The half that is easiest to lose in a later edit, and the one that would
   * be a lie. `applyObservedRatings` only ever WRITES — it never clears a read
   * state and refuses any row a person stamped — so the filter stops a rating
   * being re-derived and undoes nothing already recorded. A sentence promising
   * a retraction would describe a feature that does not exist.
   */
  it('⚠️ promises no retraction — it says what already exists STAYS', () => {
    assert.ok(/stays|does not undo/.test(REJECTION_COST), REJECTION_COST);
    assert.ok(
      !/remove[sd]? (the|your) (rating|read state)/i.test(REJECTION_COST),
      'must not claim it takes back a rating it cannot take back',
    );
  });

  it('says the record is kept and the press is reversible', () => {
    assert.ok(REJECTION_COST.includes('Nothing is deleted'), REJECTION_COST);
    assert.ok(REJECTION_COST.includes('Yes, this is it'), REJECTION_COST);
  });

  /* A bare status or a bare verb would be exactly the refusal-wording failure
   * the estate rule names. It is a sentence, in words, to a person. */
  it('is prose, not a label', () => {
    assert.ok(REJECTION_COST.length > 200, 'too short to have said what it removes');
  });

  /*
   * ⚠️ A warning UNDER the button it warns about is a warning nobody read. The
   * only way to check placement without a DOM is to read the file, which is
   * what `copy-special-toggles.test.ts` does for the same reason.
   */
  it('⚠️ the tab prints it ABOVE the buttons, not after the press', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/components/AudioMatchReview.tsx', import.meta.url)),
      'utf8',
    );
    const line = src.indexOf('{REJECTION_COST}');
    const button = src.indexOf("'Yes, this is it'");
    assert.ok(line > 0, 'the component no longer renders REJECTION_COST at all');
    assert.ok(button > 0, 'the confirm button was renamed — re-check this test');
    assert.ok(line < button, 'the cost of a rejection must be readable before it is pressed');
  });
});

describe('the provenance sentence, once a verdict exists', () => {
  it('CONFIRMED says who settled it, and stops describing the guess', () => {
    assert.equal(
      matchProvenance({ matchedVia: 'containment', titleSimilarity: 0.81, review: 'confirmed' }),
      'Confirmed by you as the right recording.',
    );
  });

  /*
   * ⚠️ It supersedes EVERY rung, not just containment. Migration 0110's rule
   * one grain down: the app must not launder a person's word into evidence, and
   * "Matched by exact title" beside a verdict would be the app claiming the
   * corroboration for itself.
   */
  it('CONFIRMED supersedes an exact match too — the person answered, not the matcher', () => {
    assert.equal(
      matchProvenance({ matchedVia: 'exact', titleSimilarity: 1, review: 'confirmed' }),
      'Confirmed by you as the right recording.',
    );
  });

  it('an un-reviewed containment match points at the control that settles it', () => {
    assert.equal(
      matchProvenance({ matchedVia: 'containment', titleSimilarity: 0.81, review: null }),
      'Matched on a partial title (81% title match) — confirm it in ✎ Edit this book.',
    );
  });

  it('⚠️ the sentence still SAYS the match was partial — migration 0010, reworded not removed', () => {
    const s = matchProvenance({ matchedVia: 'containment', titleSimilarity: 0.8 });
    assert.ok(s.includes('partial title'), s);
    assert.ok(!s.includes('?'), 'it is a pointer now, not a question');
  });

  it('the other rungs are untouched by 0450', () => {
    assert.equal(
      matchProvenance({ matchedVia: 'exact', titleSimilarity: 1 }),
      'Matched by exact title (100% title match).',
    );
    assert.equal(
      matchProvenance({ matchedVia: 'series_link', titleSimilarity: null }),
      'Matched to the audiobook series you confirmed — by series and volume number.',
    );
  });
});
