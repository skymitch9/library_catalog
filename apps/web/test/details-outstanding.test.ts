/**
 * ⚠️ **What "Look up all" is allowed to offer.** These tests exist because the
 * button lied, twice, in the same afternoon, in opposite directions.
 *
 * ## The defect, in the owner's words: *"the button didnt fix"*
 *
 * 2026-08-19, `padhard.heygabi.ai/queue`. The primary button read **"Every one
 * already asked"** and was disabled, one line below the page's own sentence
 * *"51 books are waiting for a lookup."* Both were true. The page had:
 *
 * ```ts
 * const outstanding = shown.filter((w) => runs[w.workId] === undefined);
 * ```
 *
 * `runs` is keyed **by work**, so "already asked" was a fact about a BOOK. A
 * research pass had filled `series` on 57 books — marking all 57 asked — and
 * the volume question only comes into existence once a book HAS a series
 * (`detailFieldsFor`). Fifty-one questions nobody had ever put were therefore
 * born behind an "already asked" marker.
 *
 * ## Both directions are lies, and the tests below pin both
 *
 * | | must not |
 * |---|---|
 * | offer | a question a finished run already bought — every run costs 2–8¢, and about half this library has no free record anywhere, so "asked, came back empty" is the expected outcome and not a retryable failure |
 * | hide | a question no finished run has put — that is the bug above |
 *
 * The two are only simultaneously satisfiable per **(work, field)**. Anything
 * that collapses to per-work reproduces one or the other.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  askedByRun,
  askedFor,
  outstandingFields,
  outstandingWorks,
  withSessionAsked,
} from '../src/lib/details-outstanding.js';

/** A queue row as `/api/research/queue` returns it, trimmed to what matters. */
const row = (workId: number, missing: string[], asked: string[] = []) =>
  ({ workId, missing, asked }) as never;

describe('outstandingFields — the (work, field) rule', () => {
  it('⚠️ THE DEFECT: a run that covered `series` leaves `seriesIndex` outstanding', () => {
    // Exactly the padhard row, 57 of them. The run asked about `series` and
    // `description`, found both, and by finding the series it BROUGHT THE
    // VOLUME QUESTION INTO EXISTENCE. Nobody has ever asked it.
    const work = row(1, ['seriesIndex'], ['series', 'description']);
    assert.deepEqual(outstandingFields(work), ['seriesIndex']);
    assert.equal(outstandingWorks([work]).length, 1);
  });

  it('⚠️ THE MARKER STILL WORKS: every open gap asked means nothing to offer', () => {
    // The refusal that stops a paid re-ask loop. This book was asked its one
    // open question, the answer did not close it, and buying it again returns
    // the same nothing. It stays on the worklist and waits for a person —
    // `residueSentence` is the row that says so in words.
    const work = row(2, ['seriesIndex'], ['seriesIndex']);
    assert.deepEqual(outstandingFields(work), []);
    assert.equal(outstandingWorks([work]).length, 0);
  });

  it('is outstanding when ANY of its gaps is unasked, not only when all are', () => {
    const work = row(3, ['seriesIndex', 'description'], ['description']);
    assert.deepEqual(outstandingFields(work), ['seriesIndex']);
  });

  it('a book nothing has ever been asked of is outstanding in full', () => {
    const work = row(4, ['firstPublished', 'series', 'description']);
    assert.deepEqual(outstandingFields(work), ['firstPublished', 'series', 'description']);
  });

  it('⚠️ tolerates a response with no `asked` at all', () => {
    // A cached bundle talking to a Worker that predates the field, or the other
    // way round. Missing must mean "nothing asked" — the direction that offers
    // work rather than the one that hides it, since offering is recoverable by
    // pressing Stop and hiding is not recoverable at all.
    const work = { workId: 5, missing: ['description'] } as never;
    assert.deepEqual(outstandingFields(work), ['description']);
  });

  it('an asked field the book no longer owes does not resurrect it', () => {
    // `missing` is recomputed from the columns on every read, so a filled gap
    // is simply absent. Nothing here may add to it.
    const work = row(6, [], ['series']);
    assert.deepEqual(outstandingFields(work), []);
  });
});

describe('askedByRun — an error is not an answer', () => {
  it('⚠️ an errored run contributes nothing, so the question stays open', () => {
    // The second lie, one layer up. `detailsRunHistory` excludes error runs in
    // SQL for the same reason: the money was not spent and the question was not
    // put. Recording it here would hide open work behind a marker again.
    assert.deepEqual(askedByRun({ status: 'error', asked: ['description'] }), []);
  });

  it('a finished run contributes exactly what it covered', () => {
    assert.deepEqual(askedByRun({ status: 'done', asked: ['series', 'seriesIndex'] }), [
      'series',
      'seriesIndex',
    ]);
  });

  it('a run still out contributes nothing yet', () => {
    assert.deepEqual(askedByRun({ status: 'running', asked: ['description'] }), []);
    assert.deepEqual(askedByRun({ status: 'queued', asked: ['description'] }), []);
  });
});

describe('the session record — the count has to fall as a sweep works', () => {
  it('a book asked during this visit stops being offered without a reload', () => {
    // The page does not refetch the worklist between books, so without this the
    // "Look up 51" count would sit still through 51 paid lookups — which is
    // itself indistinguishable from a broken button.
    const work = row(7, ['description']);
    assert.equal(outstandingWorks([work]).length, 1);

    const after = withSessionAsked({}, 7, askedByRun({ status: 'done', asked: ['description'] }));
    assert.equal(outstandingWorks([work], after).length, 0);
  });

  it('⚠️ a book whose lookup ERRORED stays offered', () => {
    const work = row(8, ['description']);
    const after = withSessionAsked({}, 8, askedByRun({ status: 'error', asked: ['description'] }));
    assert.equal(outstandingWorks([work], after).length, 1);
    // Nothing was recorded at all, so the object is untouched.
    assert.deepEqual(after, {});
  });

  it('a run that covered only some of the gaps leaves the rest offered', () => {
    const work = row(9, ['seriesIndex', 'description']);
    const after = withSessionAsked({}, 9, askedByRun({ status: 'done', asked: ['description'] }));
    assert.deepEqual(outstandingFields(work, after), ['seriesIndex']);
  });

  it('never mutates, and unions with what the server already knew', () => {
    const before = { 10: ['description'] } as const;
    const after = withSessionAsked(before, 10, ['series']);
    assert.deepEqual(before, { 10: ['description'] });
    assert.deepEqual(after[10], ['description', 'series']);
    assert.deepEqual(askedFor(row(10, ['seriesIndex'], ['firstPublished']), after).sort(), [
      'description',
      'firstPublished',
      'series',
    ]);
  });

  it('the session record is keyed by work and does not leak between books', () => {
    const after = withSessionAsked({}, 11, ['description']);
    assert.deepEqual(outstandingFields(row(12, ['description']), after), ['description']);
  });
});

describe('the page-level agreement the incident turned on', () => {
  it('⚠️ "waiting" and "outstanding" are the same set, never two definitions', () => {
    // The screen said "51 books are waiting for a lookup" and "Every one already
    // asked" at the same time because two pieces of code answered the same
    // question differently. The page now derives both from this one list.
    const works = [
      row(20, ['seriesIndex'], ['series']), // asked series, volume question is new
      row(21, ['seriesIndex'], ['seriesIndex']), // asked and unanswerable — residue
      row(22, ['description']), // never touched
    ];
    const waiting = outstandingWorks(works);
    assert.deepEqual(
      waiting.map((w) => w.workId),
      [20, 22],
    );
    const settled = works.length - waiting.length;
    assert.equal(settled, 1);
  });
});
