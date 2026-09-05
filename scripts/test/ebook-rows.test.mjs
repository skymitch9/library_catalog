/**
 * `scripts/lib/ebook-rows.mjs` - phase 5 of the ebook split, decided with no
 * database. The D1 reads either side of these functions are plumbing; the
 * predicates, the allowlists and the statement ORDER are the decisions, and
 * every one of them is a way this can go quietly wrong.
 *
 * ⚠️ Pins the seven things that make the retirement safe, each traced to a real
 * measurement or a real failure:
 *
 *   1. **the edition predicate keys on `source_url`, not `source`** - measured
 *      2026-09-05, the 2026-08-20 details sweep rewrote `edition.source` on 101
 *      of the importer's 127 rows, so `source='file'` now matches 26 and the
 *      design's stated instrument would have done a fifth of the job;
 *   2. **`ebook_kindle` can never be reached** - a licence with no bytes;
 *   3. **the ebook-only predicate is the SITE's predicate** - the same three
 *      tests as `EBOOK_ONLY_CLAUSE`, so "the site already hides exactly these"
 *      stays a true sentence;
 *   4. **`--keep` keeps the WHOLE work** - its row, its editions, its holding -
 *      because the design's zero-human-read-states precondition FAILED on
 *      2026-09-05 (3 rows, works 358/359/360) and this is the shape of the
 *      preservation it asked for;
 *   5. **`WORK_DEPENDENTS` is in FK-safe RESTORE order** - `research_run`
 *      before `gap_verdict` and `research_finding`, `copy` before `pledge_item`
 *      and `book_accessory`, `edition` first. The first draft had `gap_verdict`
 *      first and the local seed died on a foreign-key violation;
 *   6. **the generated SQL walks that list REVERSED** - children before
 *      parents - and never names `change_log`;
 *   7. **both allowlists have a tripwire** - a sixteenth table with a `work_id`,
 *      or a fifth column pointing at `edition(id)`, is a hole in the reversal
 *      path and must fail the run rather than be silently skipped.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  EDITION_REFERENCES,
  EXPORT_KIND,
  WORK_DEPENDENTS,
  clearByIds,
  ebookEditionClause,
  ebookOnlyClause,
  insertStatement,
  planRetirement,
  restoreStatements,
  retirementSql,
  unknownEditionReferences,
  unknownWorkReferences,
} from '../lib/ebook-rows.mjs';

describe('ebookEditionClause - what the retirement can reach', () => {
  it('⚠️ keys on source_url, NEVER on source', () => {
    const sql = ebookEditionClause('e');
    assert.ok(sql.includes('e.source_url IS NOT NULL'), sql);
    assert.ok(
      !sql.includes("source = 'file'") && !sql.includes("source='file'"),
      "the 2026-08-20 sweep rewrote `source` on 101 of 127 rows; matching on it does a fifth of the job",
    );
  });

  it('⚠️ never names ebook_kindle - a licence with no file to have moved', () => {
    assert.ok(!ebookEditionClause('e').includes('ebook_kindle'));
    assert.ok(!ebookEditionClause('e', true).includes('ebook_kindle'));
  });

  it('names all five file formats, and only those', () => {
    const sql = ebookEditionClause('e');
    for (const f of ['ebook_epub', 'ebook_mobi', 'ebook_azw3', 'ebook_kepub', 'ebook_pdf']) {
      assert.ok(sql.includes(`'${f}'`), `missing ${f}`);
    }
    for (const f of ['hardcover', 'paperback', 'mass_market']) {
      assert.ok(!sql.includes(`'${f}'`), `${f} must be unreachable`);
    }
  });

  it('--include-manual drops the source_url test and nothing else', () => {
    const wide = ebookEditionClause('e', true);
    assert.ok(!wide.includes('source_url'));
    assert.ok(wide.includes("e.format IN ('ebook_epub'"));
  });

  it('respects the alias it is given', () => {
    assert.ok(ebookEditionClause('x').startsWith('x.format IN ('));
  });
});

describe('ebookOnlyClause - the same three tests the SITE makes', () => {
  const sql = ebookOnlyClause('w');

  it('has a non-physical edition, has NO physical edition, has NO copy', () => {
    assert.ok(sql.includes('EXISTS (SELECT 1 FROM edition e WHERE e.work_id = w.id AND e.format NOT IN'));
    assert.ok(sql.includes('NOT EXISTS (SELECT 1 FROM edition e WHERE e.work_id = w.id AND e.format IN'));
    assert.ok(sql.includes('NOT EXISTS (SELECT 1 FROM copy c WHERE c.work_id = w.id)'));
  });

  it('⚠️ tests NON-PHYSICAL, not the five file formats', () => {
    // A work whose only edition is an `ebook_kindle` licence has nothing on a
    // shelf either, and `EBOOK_ONLY_CLAUSE` in packages/db already treats it so.
    // Narrowing this to the file formats would make the retirement and the
    // display filter disagree about what an ebook-only work IS.
    assert.ok(!sql.includes('ebook_epub'));
    assert.ok(sql.includes("'hardcover', 'paperback', 'mass_market'"));
  });
});

describe('planRetirement - what goes and what is kept', () => {
  const works = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const editions = [
    { id: 10, work_id: 1 },
    { id: 11, work_id: 2 },
    { id: 12, work_id: 3 },
    // an ebook edition on a work with physical presence - not in `works`
    { id: 13, work_id: 99 },
  ];

  it('with nothing kept, every listed work and every ebook edition is in scope', () => {
    const p = planRetirement({ works, editions });
    assert.deepEqual(p.retireWorkIds, [1, 2, 3]);
    assert.deepEqual(p.retireEditionIds, [10, 11, 12, 13]);
    assert.equal(p.editionsOnRetiredWorks, 3);
    assert.equal(p.editionsOnSurvivingWorks, 1);
    assert.deepEqual(p.keptWorkIds, []);
  });

  it('⚠️ a kept work keeps its EDITIONS too, not just its row', () => {
    // Works 358/359/360 on main carry human-asserted read states. A read state
    // that says "I read this" about a work with no edition left is a worse
    // record than one with an ebook edition nothing serves any more.
    const p = planRetirement({ works, editions, keep: [2] });
    assert.deepEqual(p.retireWorkIds, [1, 3]);
    assert.deepEqual(p.keptWorkIds, [2]);
    assert.ok(!p.retireEditionIds.includes(11), 'edition 11 belongs to the kept work');
    assert.deepEqual(p.retireEditionIds, [10, 12, 13]);
  });

  it('keeps an edition on a work that survives for other reasons in scope', () => {
    // Edition 13 hangs off work 99, which is NOT ebook-only (it has a physical
    // edition or a copy). Design section 3: those editions are replaced by
    // holding rows and pruned, and the work stays.
    const p = planRetirement({ works, editions, keep: [] });
    assert.ok(p.retireEditionIds.includes(13));
    assert.ok(!p.retireWorkIds.includes(99));
  });

  it('takes string ids as well as numbers, and always answers in numbers', () => {
    const p = planRetirement({ works: [{ id: '7' }], editions: [{ id: '8', work_id: '7' }], keep: ['7'] });
    assert.deepEqual(p.keptWorkIds, [7]);
    assert.deepEqual(p.retireWorkIds, []);
    assert.deepEqual(p.retireEditionIds, []);
  });

  it('an empty catalog plans an empty retirement rather than throwing', () => {
    const p = planRetirement({ works: [], editions: [] });
    assert.deepEqual(p.retireWorkIds, []);
    assert.deepEqual(p.retireEditionIds, []);
  });
});

describe('the two allowlist tripwires', () => {
  it('a schema this file fully knows reports nothing unknown', () => {
    const fks = WORK_DEPENDENTS.map((d) => ({ table: d.table, column: d.cols[0], references: 'work' }));
    assert.deepEqual(unknownWorkReferences(fks), []);
    assert.deepEqual(unknownEditionReferences(EDITION_REFERENCES.map((d) => ({ table: d.table, column: d.col, references: 'edition' }))), []);
  });

  it('⚠️ a sixteenth table with a work_id is NAMED, not skipped', () => {
    const fks = [
      { table: 'work_soundtrack', column: 'work_id', references: 'work' },
      { table: 'copy', column: 'work_id', references: 'work' },
    ];
    assert.deepEqual(unknownWorkReferences(fks), ['work_soundtrack']);
  });

  it('⚠️ a fifth column pointing at edition(id) is NAMED, with its column', () => {
    const fks = [
      { table: 'shelf_slot', column: 'edition_id', references: 'edition' },
      { table: 'copy', column: 'edition_id', references: 'edition' },
    ];
    assert.deepEqual(unknownEditionReferences(fks), ['shelf_slot.edition_id']);
  });

  it('references to other tables are none of its business', () => {
    assert.deepEqual(unknownWorkReferences([{ table: 'gabi_turn', column: 'conversation_id', references: 'gabi_conversation' }]), []);
    assert.deepEqual(unknownEditionReferences([{ table: 'gabi_turn', column: 'conversation_id', references: 'gabi_conversation' }]), []);
  });
});

describe('WORK_DEPENDENTS - the order is load-bearing', () => {
  const at = (t) => WORK_DEPENDENTS.findIndex((d) => d.table === t);

  it('⚠️ research_run comes before its children - the seed died on this', () => {
    assert.ok(at('research_run') < at('research_finding'), 'research_finding.run_id -> research_run');
    assert.ok(at('research_run') < at('gap_verdict'), 'gap_verdict.run_id -> research_run');
  });

  it('copy comes before the tables carrying a copy_id', () => {
    assert.ok(at('copy') < at('pledge_item'));
    assert.ok(at('copy') < at('book_accessory'));
  });

  it('edition is first - four tables carry an edition_id', () => {
    assert.equal(at('edition'), 0);
  });

  it('work_relation is listed with BOTH of its work columns', () => {
    assert.deepEqual(WORK_DEPENDENTS.find((d) => d.table === 'work_relation').cols, [
      'from_work_id',
      'to_work_id',
    ]);
  });

  it('⚠️ change_log is not in the list - the audit trail outlives its subject', () => {
    assert.equal(at('change_log'), -1);
  });
});

describe('insertStatement - the restore keeps the ids', () => {
  it('⚠️ writes the ORIGINAL id, which the ingest route cannot', () => {
    const sql = insertStatement('work', { id: 358, title: 'All The Skills', authors: 'Honour Rae' });
    assert.equal(
      sql,
      `INSERT OR IGNORE INTO work ("id", "title", "authors") VALUES (358, 'All The Skills', 'Honour Rae');`,
    );
  });

  it('OR IGNORE, so a re-run of a restore is a no-op', () => {
    assert.ok(insertStatement('copy', { id: 1 }).startsWith('INSERT OR IGNORE INTO copy '));
  });

  it("doubles an apostrophe rather than breaking out of the literal", () => {
    const sql = insertStatement('work', { title: "Frugal Wizard's Handbook" });
    assert.ok(sql.includes("'Frugal Wizard''s Handbook'"));
  });

  it('null and undefined both become SQL NULL', () => {
    assert.ok(insertStatement('edition', { isbn13: null, asin: undefined }).includes('VALUES (NULL, NULL)'));
  });

  it('an empty row is refused rather than emitted as broken SQL', () => {
    assert.throws(() => insertStatement('work', {}), /empty row/);
  });
});

describe('clearByIds - chunking, and nothing else', () => {
  it('one statement per chunk, ids preserved in order', () => {
    assert.deepEqual(clearByIds('edition', 'id', [1, 2, 3], 2), [
      'DELETE FROM edition WHERE id IN (1, 2);',
      'DELETE FROM edition WHERE id IN (3);',
    ]);
  });

  it('no ids means no statements - never an unqualified one', () => {
    assert.deepEqual(clearByIds('work', 'id', []), []);
    // The catastrophic typo this guards against.
    assert.ok(!clearByIds('work', 'id', []).join('').includes('DELETE FROM work;'));
  });
});

describe('retirementSql - the file the owner reads before saying yes', () => {
  const sql = retirementSql({ workIds: [1, 2], editionIds: [10, 11], header: '-- header' });

  it('the header survives verbatim', () => {
    assert.ok(sql.startsWith('-- header\n'));
  });

  it('editions go first, then dependents, then the works themselves', () => {
    const iEdition = sql.indexOf('DELETE FROM edition WHERE id IN');
    const iHolding = sql.indexOf('DELETE FROM ebook_holding');
    const iWork = sql.indexOf('DELETE FROM work WHERE id IN');
    assert.ok(iEdition >= 0 && iHolding > iEdition && iWork > iHolding, sql);
  });

  it('⚠️ dependents are cleared CHILDREN FIRST - WORK_DEPENDENTS reversed', () => {
    assert.ok(
      sql.indexOf('DELETE FROM gap_verdict') < sql.indexOf('DELETE FROM research_run'),
      'gap_verdict.run_id -> research_run, so gap_verdict must go first',
    );
    assert.ok(sql.indexOf('DELETE FROM pledge_item') < sql.indexOf('DELETE FROM copy'));
  });

  it('⚠️ never names change_log', () => {
    assert.ok(!sql.includes('change_log'));
  });

  it('⚠️ never emits a DELETE without a WHERE', () => {
    for (const line of sql.split('\n').filter((l) => l.startsWith('DELETE'))) {
      assert.ok(/ WHERE .+ IN \(/.test(line), `unqualified delete: ${line}`);
    }
  });

  it('clears work_relation on BOTH of its columns', () => {
    assert.ok(sql.includes('DELETE FROM work_relation WHERE from_work_id IN'));
    assert.ok(sql.includes('DELETE FROM work_relation WHERE to_work_id IN'));
  });

  it('an empty plan produces a file with no DELETE in it at all', () => {
    const empty = retirementSql({ workIds: [], editionIds: [], header: '-- nothing to do' });
    assert.ok(!empty.includes('DELETE'));
    assert.ok(empty.trimEnd().endsWith('-- end.'));
  });

  it('editions alone (a padhard-shaped no-op on works) touches no work table', () => {
    const only = retirementSql({ workIds: [], editionIds: [5], header: '-- h' });
    assert.ok(only.includes('DELETE FROM edition WHERE id IN (5);'));
    assert.ok(!only.includes('DELETE FROM work '));
    assert.ok(!only.includes('DELETE FROM ebook_holding'));
  });
});

describe('restoreStatements - parents before children', () => {
  const data = {
    works: [{ id: 1, title: 'W' }],
    editions: [{ id: 10, work_id: 1 }],
    dependents: {
      gap_verdict: [{ id: 5, work_id: 1, run_id: 7 }],
      research_run: [{ id: 7, work_id: 1 }],
      ebook_holding: [{ work_id: 1, title: 'W', formats: 'epub', edition_source: 'file', derived_via: 'edition' }],
    },
  };
  const sql = restoreStatements(data).join('\n');

  it('work first, then edition', () => {
    assert.ok(sql.indexOf('INTO work ') < sql.indexOf('INTO edition '));
  });

  it('⚠️ research_run before gap_verdict - the FK that broke the first seed', () => {
    assert.ok(sql.indexOf('INTO research_run ') < sql.indexOf('INTO gap_verdict '));
  });

  it('a table absent from the export contributes nothing', () => {
    assert.ok(!sql.includes('INTO work_watch '));
  });

  it('an empty export restores nothing rather than throwing', () => {
    assert.deepEqual(restoreStatements({}), []);
    assert.deepEqual(restoreStatements({ works: [], editions: [], dependents: {} }), []);
  });
});

describe('the export contract', () => {
  it('the kind string is what both entry points check on the way in', () => {
    assert.equal(EXPORT_KIND, 'library_catalog/ebook-retirement');
  });
});
