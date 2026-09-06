/**
 * `import-shop-orders.mjs` — the two decisions, exercised with no database.
 *
 * 🔴 **The one this file exists for: the SHOP is not the PUBLISHER.** The
 * importer wrote `scan.vendor` into `edition.publisher` until 2026-09-05, and
 * all seven rows it had ever created carried the wrong value with nothing
 * checking. The owner settled it that day: `publisher` is NULL unless the order
 * line names a real publisher, and the shop goes to `copy.vendor`.
 *
 * The second decision is `matchEditionIds`. It is not cosmetic: the old
 * read-back predicate was `source = 'manual' AND publisher = <vendor>`, which
 * only located the right rows *because of* the bug. With `publisher` correctly
 * NULL that predicate matches every publisher-less manual edition in the
 * catalog — 97 of them on main, measured 2026-09-05 — and would hand copies an
 * arbitrary `edition_id`.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { matchEditionIds, planItem, publisherFor } from '../import-shop-orders.mjs';

/** A Barnes & Noble order line, with everything the importer reads. */
function item(over = {}) {
  return {
    title: 'The Wandering Inn',
    authors: 'pirateaba',
    format: 'hardcover',
    bnFormat: 'Hardcover',
    copyStatus: 'preordered',
    ...over,
  };
}

describe('publisherFor — the shop never lands in edition.publisher', () => {
  it('🔴 is NULL when the order line names no publisher', () => {
    assert.equal(publisherFor(item()), null);
  });

  it('🔴 is NULL even though the scan knows the shop — vendor is not consulted at all', () => {
    // The scan object carrying `vendor: 'Barnes & Noble'` is not even passed in.
    // That is the fix: there is no code path from the shop to this column.
    assert.equal(publisherFor(item({ bnFormat: 'BN Exclusive' })), null);
  });

  it('uses the order line when it genuinely carries a publisher', () => {
    assert.equal(publisherFor(item({ publisher: 'Harper Voyager' })), 'Harper Voyager');
  });

  it('a shop that really IS the publisher is allowed through — the source decides', () => {
    // Barnes & Noble Books and Barnes & Noble Classics are real imprints, and
    // two rows in this catalog are theirs. The rule is "use what the source
    // says", not "reject anything shop-shaped".
    assert.equal(publisherFor(item({ publisher: 'Barnes & Noble Classics' })), 'Barnes & Noble Classics');
  });

  it('⚠️ blank and whitespace both mean NULL, never the empty string', () => {
    // `publisher = ''` is invisible to every `publisher IS NULL` gap query the
    // ISBN ladder runs, so it would be a silent hole rather than a known one.
    assert.equal(publisherFor(item({ publisher: '' })), null);
    assert.equal(publisherFor(item({ publisher: '   ' })), null);
  });

  it('trims, and survives a missing or non-string field', () => {
    assert.equal(publisherFor(item({ publisher: '  Tor Books ' })), 'Tor Books');
    assert.equal(publisherFor({}), null);
    assert.equal(publisherFor(item({ publisher: 42 })), null);
    assert.equal(publisherFor(undefined), null);
  });
});

describe('planItem — the whole planned row', () => {
  it('carries a NULL publisher and still resolves format and kind', () => {
    const p = planItem(item({ editionName: 'B&N Exclusive Edition', bnFormat: 'BN Exclusive' }));
    assert.equal(p.publisher, null);
    assert.equal(p.fmt, 'hardcover');
    // `classifyEdition` reads "B&N Exclusive Edition" as `collectors` — measured
    // here rather than assumed, so a change to that ladder shows up as a failure
    // in the importer's own test and not only in the core one.
    assert.equal(p.kind, 'collectors');
  });

  it('finds a work we already hold by its work_key', () => {
    const bare = planItem(item());
    const p = planItem(item(), new Map([[bare.key, 229]]));
    assert.equal(p.workId, 229);
    assert.equal(planItem(item()).workId, null);
  });
});

describe('matchEditionIds — reading the new rows back without the publisher column', () => {
  const plan = [
    { workId: 229, fmt: 'hardcover', editionName: null },
    { workId: 235, fmt: 'hardcover', editionName: 'B&N Exclusive Edition' },
  ];

  it('matches on work + format + edition_name', () => {
    const eds = matchEditionIds(plan, [
      { id: 322, work_id: 229, format: 'hardcover', edition_name: null },
      { id: 328, work_id: 235, format: 'hardcover', edition_name: 'B&N Exclusive Edition' },
    ]);
    assert.equal(eds.get(229), 322);
    assert.equal(eds.get(235), 328);
  });

  it('⚠️ does NOT claim a pre-existing publisher-less manual edition of another format', () => {
    const eds = matchEditionIds(plan, [
      { id: 100, work_id: 229, format: 'paperback', edition_name: null },
    ]);
    assert.equal(eds.has(229), false);
  });

  it('⚠️ does NOT claim a row whose edition_name differs — the retailer naming is identity here', () => {
    const eds = matchEditionIds(plan, [
      { id: 101, work_id: 235, format: 'hardcover', edition_name: 'Deluxe Edition' },
    ]);
    assert.equal(eds.has(235), false);
  });

  it('the newest id wins when a work has two identical printings', () => {
    const eds = matchEditionIds(plan, [
      { id: 322, work_id: 229, format: 'hardcover', edition_name: null },
      { id: 999, work_id: 229, format: 'hardcover', edition_name: null },
    ]);
    assert.equal(eds.get(229), 999);
  });

  it('skips items with no work or no format — they get an edition-less copy by design', () => {
    const eds = matchEditionIds(
      [{ workId: null, fmt: 'hardcover' }, { workId: 300, fmt: null }],
      [{ id: 1, work_id: 300, format: 'hardcover', edition_name: null }],
    );
    assert.equal(eds.size, 0);
  });
});
