/**
 * `import-illumicrate-percy-jackson.mjs` — the two statements it builds,
 * exercised with no database.
 *
 * 🔴 **The one this file exists for: the SHOP is not the PUBLISHER.** The
 * importer wrote its `VENDOR` constant (*"Illumicrate"*) into
 * `edition.publisher` until 2026-09-05, and all five rows it had ever created
 * carried it, with nothing checking. Same defect, same week, same fix as
 * `scripts/import-shop-orders.mjs` — the owner's decision of that date governs
 * both (`docs/info/crowdfunding-and-accessories.md` §9.1, both halves):
 * `edition.publisher` NULL unless the source names a publisher, and the shop in
 * `copy.vendor`.
 *
 * ⚠️ Illumicrate is a subscription box that commissions exclusive printings from
 * the trade publisher. The announcement page this import was read off names no
 * publisher at all, so NULL here is what the source says, not a placeholder —
 * and looking one up inside an importer is the research/import split
 * `docs/info/isbn-ladder.md` exists to keep.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  BOOKS,
  EDITION_NAME,
  PUBLISHER,
  VENDOR,
  copySql,
  editionSql,
} from '../import-illumicrate-percy-jackson.mjs';
import { matchEditionIds } from '../import-shop-orders.mjs';

describe('editionSql — the shop never lands in edition.publisher', () => {
  it('🔴 writes a literal NULL publisher', () => {
    const s = editionSql(224);
    assert.match(s, /VALUES \(224, 'hardcover', 'Illumicrate Exclusive', NULL, 'manual'\)/);
  });

  it('🔴 the vendor string appears NOWHERE in the edition statement', () => {
    // The regression that would re-create the defect is a one-word edit, so the
    // guard is on the word itself and not only on the column order.
    const s = editionSql(224);
    assert.equal(PUBLISHER, null);
    assert.equal(s.includes(`'${VENDOR}'`), false, 'the shop is back in the edition INSERT');
  });

  it('⚠️ NULL, never the empty string — a publisher IS NULL gap query must see it', () => {
    assert.equal(editionSql(1).includes("''"), false);
  });

  it('keeps the retailer\'s own name for the printing in edition_name', () => {
    // The name is the printing's identity and is not this defect's business —
    // the same line `fix-retailer-publishers-2026-09-02.mjs` drew.
    assert.equal(EDITION_NAME, 'Illumicrate Exclusive');
    assert.match(editionSql(9), /'Illumicrate Exclusive'/);
  });
});

describe('copySql — the shop DOES belong on the copy', () => {
  it('writes the vendor', () => {
    assert.match(copySql(224, 307), /'owned', 'Illumicrate'/);
  });

  it('links the copy to the edition it was given', () => {
    assert.match(copySql(224, 307), /VALUES \(224, 307, 'owned'/);
  });

  it('⚠️ an unmatched edition writes a literal NULL — the shape of the 2026-08-11 defect', () => {
    // Copies 104–108 on main are exactly this row: written unlinked while their
    // editions existed. Repaired by fix-copy-edition-links-2026-09-05.mjs.
    assert.match(copySql(224, null), /VALUES \(224, NULL, 'owned'/);
    assert.match(copySql(224, undefined), /VALUES \(224, NULL, 'owned'/);
  });

  it('is_signed stays 0 — "digitally signed" is a printed reproduction', () => {
    assert.match(copySql(224, 307), /'new', 0,/);
  });

  it('records the set price in pence with the currency named', () => {
    // £125 across five books.
    assert.match(copySql(224, 307), /2500, 'GBP'/);
    assert.equal(BOOKS.length, 5);
  });
});

describe('the read-back is the shared matchEditionIds, not a name-only lookup', () => {
  const rows = [
    { id: 307, work_id: 224, format: 'hardcover', edition_name: 'Illumicrate Exclusive' },
    { id: 606, work_id: 224, format: 'hardcover', edition_name: 'Volume of the slipcase set' },
    { id: 647, work_id: 224, format: 'paperback', edition_name: null },
  ];
  const plan = [{ workId: 224, fmt: 'hardcover', editionName: 'Illumicrate Exclusive' }];

  it('picks the exclusive printing out of a work that holds three', () => {
    // Work 224 really does hold all three of these rows on main today, which is
    // why a name-only lookup was not good enough.
    assert.equal(matchEditionIds(plan, rows).get(224), 307);
  });

  it('matches nothing rather than guessing when the printing is absent', () => {
    const without = rows.filter((r) => r.id !== 307);
    assert.equal(matchEditionIds(plan, without).has(224), false);
  });

  it('newest id wins on a tie, so a re-run links to the row it just wrote', () => {
    const twice = [...rows, { id: 900, work_id: 224, format: 'hardcover', edition_name: 'Illumicrate Exclusive' }];
    assert.equal(matchEditionIds(plan, twice).get(224), 900);
  });
});
