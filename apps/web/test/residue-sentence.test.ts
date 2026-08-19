/**
 * The named residue on the details queue.
 *
 * ## ⚠️ The incident, and the owner rule it produced
 *
 * 2026-08-19: the owner reported *"Sam has 55 missing details, the button didnt
 * fix"* about a button that had run ~45 successful paid lookups that afternoon
 * and written 73 descriptions and 57 series names. Part of that was a real
 * predicate bug; part of it was that **a row research had answered looked
 * identical to a row nobody had got to**, and a count that never falls is
 * indistinguishable from a broken feature.
 *
 * His rule: *"a book missing details either gets them filled automatically
 * within a day, or sits in a NAMED residue category that the queue page
 * displays with those words — never an anonymous count that looks like a bug."*
 *
 * `residueSentence` is that judgement, and these are its edges. The two that
 * matter most are the refusals: it must not call a book settled while any of
 * its questions is still unasked, and it must not call an ERRORED lookup an
 * answer — that would be the opposite lie from the one it exists to fix.
 *
 * ⚠️ **The second argument changed on 2026-08-19** from "the latest run" to
 * "the set of questions finished runs have put". The latest run alone is only
 * part of the record — a book asked about `series` in one run and `seriesIndex`
 * in the next has two runs behind it — and it left this sentence and the "Look
 * up N" button working from two different definitions of already-asked. The
 * error rule did not go away; it moved one layer out, to `askedByRun`, which
 * has its own tests beside these.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { residueSentence } from '../src/lib/details-residue.js';
import { askedByRun } from '../src/lib/details-outstanding.js';

describe('residueSentence', () => {
  it('names the volume-number case specifically, and points at the person', () => {
    const said = residueSentence(['seriesIndex'], ['seriesIndex']);
    assert.ok(said, 'expected a sentence');
    assert.match(said, /which volume/i);
    assert.match(said, /another lookup will not help/i);
  });

  it('names the could-not-identify case as an ANSWER, not a failure', () => {
    // ⚠️ The wording is the feature. isbn-ladder.md §4.2 measured 16 of 30
    // sampled titles as having no free record anywhere, so "nothing found" is
    // the expected outcome for much of this library. A page that presents it as
    // a failure teaches the owner to distrust a working system.
    const said = residueSentence(
      ['firstPublished', 'description'],
      ['firstPublished', 'description'],
    );
    assert.ok(said);
    assert.match(said, /could not identify/i);
    assert.match(said, /answer rather than a failure/i);
  });

  it('⚠️ says nothing while ANY open question is still unasked', () => {
    // Half-answered is not settled. This row is still genuinely queued, and
    // labelling it as looked-at would hide work the sweep is about to do.
    assert.equal(residueSentence(['seriesIndex', 'description'], ['description']), null);
  });

  it('⚠️ an errored run contributes nothing, so its row is not residue', () => {
    // An error never got an answer — the book is still waiting its turn, and
    // `detailsRunHistory` deliberately does not count it as asked either.
    const contributed = askedByRun({ status: 'error', asked: ['description'] });
    assert.deepEqual(contributed, []);
    assert.equal(residueSentence(['description'], contributed), null);
  });

  it('says nothing for a book that has never been looked up', () => {
    assert.equal(residueSentence(['description'], []), null);
  });

  it('says nothing when the runs asked about something the book no longer owes', () => {
    // The ordinary success case: asked about `series`, got it, and the only
    // thing left is a question that has never been put. ⚠️ This is the padhard
    // row — 57 of them — and the whole reason the button lied.
    assert.equal(residueSentence(['seriesIndex'], ['series']), null);
  });

  it('⚠️ reads the WHOLE run history, not just the latest run', () => {
    // Two runs: one asked `series` (and filled it), a later one asked
    // `seriesIndex` (and could not). The book is genuinely settled. Reading only
    // the latest run happens to get this one right; reading only the FIRST — or
    // any single row — does not, which is why the caller passes the union.
    assert.ok(residueSentence(['seriesIndex'], ['series', 'seriesIndex']));
  });
});
