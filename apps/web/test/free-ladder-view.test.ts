/**
 * *Why did this run cost money?* — the sentences that answer it.
 *
 * ## The failure being pinned
 *
 * > *"tell me why padhard library wasn't resolved by the free lookup with
 * > series and description?"* — the owner, 2026-08-26, after a **paid** run on
 * > padhard #578 *After Life*.
 *
 * The free ladder had run. `research_run.result_json` for run 738 was **261
 * bytes naming `sources: llm`**, so nothing recorded which rungs were asked or
 * what each said, and the question had to be answered by reading code and
 * querying tables by hand. The record now exists; these are the sentences it
 * becomes.
 *
 * ⚠️ **The assertions that matter are the three states of "a rung said
 * nothing"**, because printing them the same way is the mistake this project
 * has already paid for once — the covers sweep reported *"no cover anywhere"*
 * for a rung that was never asked (`covers-and-series.md` §0):
 *
 * 1. no record at all (an old run) → say NOTHING
 * 2. a rung below the answer → **not reached**, never *found nothing*
 * 3. a rung with a skip line → its own words, verbatim
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  freeLadderAsked,
  freeLadderFilled,
  freeLadderSkips,
  hasFreeLadderRecord,
  paidAskSentence,
  sourceLabel,
} from '../src/lib/free-ladder-view.js';
import type { FreeLadderView } from '../src/api.js';

/** padhard #578 *After Life* — the run that prompted all of this. */
const run738: FreeLadderView = {
  rungs: ['audiobook', 'index', 'openlibrary', 'googlebooks', 'hardcover', 'wikidata'],
  skipped: [
    'the audiobook catalogue: no audio edition is linked to this book',
    'the estate index: no shelf in the estate holds this title',
    'Open Library: 3 edition(s) read, none naming a series',
    'Google Books: the title claims no series',
    'Hardcover: the record names no series',
    'Wikidata: no ISBN match',
  ],
  applied: [],
  stillOpen: ['series', 'seriesIndex'],
};

describe('hasFreeLadderRecord — the difference between silence and a measurement', () => {
  it('⚠️ null renders as nothing — every run before 2026-09-02 is in that state', () => {
    assert.equal(hasFreeLadderRecord(null), false);
    assert.equal(hasFreeLadderRecord(undefined), false);
  });

  it('⚠️ an EMPTY record is still a record — the ladder ran and reported nothing', () => {
    assert.equal(hasFreeLadderRecord({}), true);
    assert.equal(hasFreeLadderRecord({ rungs: [], skipped: [] }), true);
  });
});

describe('freeLadderAsked — which rungs were TRIED', () => {
  it('names every rung that was asked', () => {
    const said = freeLadderAsked(run738);
    assert.ok(said);
    for (const name of [
      'the audiobook catalogue',
      'the estate index',
      'Open Library',
      'Google Books',
      'Hardcover',
      'Wikidata',
    ]) {
      assert.ok(said.includes(name), `${name} is missing from: ${said}`);
    }
  });

  it('says nothing about "not reached" when the whole ladder ran', () => {
    assert.ok(!(freeLadderAsked(run738) ?? '').includes('Not reached'));
  });

  it('⚠️ a rung BELOW the answer reads "not reached", never "found nothing"', () => {
    // The Elantris shape: the audiobook row is silent, Open Library answers,
    // and the four rungs behind it are never called.
    const said = freeLadderAsked({ rungs: ['audiobook', 'index', 'openlibrary'] });
    assert.ok(said);
    assert.ok(said.includes('Not reached: Google Books, Hardcover and Wikidata.'), said);
    assert.ok(!said.includes('nothing'), said);
  });

  it('⚠️ returns null when the run recorded no rung list — nothing may be claimed', () => {
    assert.equal(freeLadderAsked({ skipped: ['something'] }), null);
  });

  it('an empty rung list is a fact, and it says so', () => {
    assert.equal(freeLadderAsked({ rungs: [] }), 'Free lookups: none were asked.');
  });

  it('an unknown rung key renders as itself rather than vanishing', () => {
    const said = freeLadderAsked({ rungs: ['audiobook', 'somethingnew'] });
    assert.ok(said?.includes('somethingnew'), said ?? '(null)');
  });
});

describe('freeLadderSkips — each rung in its own words', () => {
  it('passes the ladder’s lines through verbatim', () => {
    assert.deepEqual(freeLadderSkips(run738), run738.skipped);
  });

  it('an absent list is empty, not an error', () => {
    assert.deepEqual(freeLadderSkips({}), []);
  });
});

describe('paidAskSentence — what the money was actually spent on', () => {
  it('names the fields handed to the paid rung', () => {
    assert.equal(
      paidAskSentence(run738),
      'The paid lookup was asked for: series and volume number.',
    );
  });

  it('⚠️ says nothing when the run was free — a zero here reads as a charge', () => {
    assert.equal(paidAskSentence({ stillOpen: [] }), null);
    assert.equal(paidAskSentence({}), null);
  });

  it('one field takes no list grammar', () => {
    assert.equal(
      paidAskSentence({ stillOpen: ['description'] }),
      'The paid lookup was asked for: description.',
    );
  });
});

describe('freeLadderFilled — the arithmetic beside the cost', () => {
  it('counts what was free against what was missing', () => {
    assert.equal(
      freeLadderFilled({ applied: ['Series set to Elantris.'], stillOpen: ['description'] }),
      'The free checks filled in 1 of the 2 things that were missing.',
    );
  });

  it('a wholly free run says so', () => {
    assert.equal(
      freeLadderFilled({ applied: ['a', 'b', 'c'], stillOpen: [] }),
      'The free checks filled in 3 of the 3 things that were missing.',
    );
  });

  it('⚠️ silent when the free rungs wrote nothing — a proud zero is a boast about failure', () => {
    assert.equal(freeLadderFilled(run738), null);
    assert.equal(freeLadderFilled({}), null);
  });

  it('singular when there was one thing missing', () => {
    assert.equal(
      freeLadderFilled({ applied: ['Series set to Cradle.'], stillOpen: [] }),
      'The free checks filled in 1 of the one thing that was missing.',
    );
  });
});

describe('sourceLabel', () => {
  it('words every rung the ladder can name', () => {
    assert.equal(sourceLabel('audiobook'), 'the audiobook catalogue');
    assert.equal(sourceLabel('index'), 'the estate index');
    assert.equal(sourceLabel('openlibrary'), 'Open Library');
    assert.equal(sourceLabel('googlebooks'), 'Google Books');
    assert.equal(sourceLabel('hardcover'), 'Hardcover');
    assert.equal(sourceLabel('wikidata'), 'Wikidata');
    assert.equal(sourceLabel('llm'), 'a paid lookup');
  });

  it('⚠️ falls through to the bare key — visibly unfinished beats silently absent', () => {
    assert.equal(sourceLabel('newrung'), 'newrung');
  });
});
