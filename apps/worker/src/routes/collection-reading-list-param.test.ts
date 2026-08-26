/**
 * `readingListIdsFrom` — the two-param reading-list narrowing, as the Worker
 * reads it off the query string.
 *
 * Owner, 2026-08-26: *"can we also add a filter in each of the search bars for
 * tbr and other read states"*.
 *
 * ## ⚠️ What earns a test file for one small parser
 *
 * The whole risk in this feature lives here and **none of it is visible to the
 * type system** — both params are strings, and every mistake produces a page
 * that renders normally:
 *
 *   1. ⚠️ **`?list=tbr` with NO ids must mean `[]`, not `undefined`.** That is
 *      "asked, and this catalogue holds none of them" against "nobody asked",
 *      and `workIdsClause` turns the first into `0 = 1` and the second into no
 *      clause at all. Get it wrong and an empty to-read list answers with the
 *      **entire collection**, which reads as the control being ignored.
 *   2. ⚠️ **Ids with no `list` are IGNORED.** The status is what switches the
 *      narrowing on; a stray `?listIds=` on its own must not silently filter a
 *      page nobody asked to filter.
 *   3. ⚠️ **A status outside `READING_LIST_STATUSES` adds no clause**, the rule
 *      `MEDIUM_CLAUSE` and the sort allowlist both follow: a stale bookmark
 *      shows the collection, never a 400.
 *   4. ⚠️ **Only positive integers survive.** `workIdsClause` INLINES these into
 *      the statement rather than binding them (D1 caps a statement at 100 bound
 *      parameters and a real list carries three hundred ids), so this filter is
 *      one of the two guards that keeps caller text out of SQL.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readingListIdsFrom } from './catalog.js';

/** The one thing the parser reads: a query-string getter. */
function ctx(params: Record<string, string>) {
  return { req: { query: (k: string) => params[k] } };
}

describe('readingListIdsFrom — the pair rule', () => {
  it('no params at all is "nobody asked"', () => {
    assert.equal(readingListIdsFrom(ctx({})), undefined);
  });

  it('⚠️ a status with NO ids is an EMPTY LIST, not an absent one', () => {
    // The expensive one. `[]` reaches `workIdsClause` as `0 = 1`; `undefined`
    // would add no clause and show the whole collection under a filter the
    // person has already applied.
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'tbr' })), []);
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'read', listIds: '' })), []);
  });

  it('⚠️ ids with NO status are ignored — the status is the switch', () => {
    assert.equal(readingListIdsFrom(ctx({ listIds: '1,2,3' })), undefined);
  });

  it('⚠️ a status this store has never held adds no clause, never a 400', () => {
    for (const list of ['dnf', 'reading', 'TBR', 'junk', '']) {
      assert.equal(
        readingListIdsFrom(ctx({ list, listIds: '1,2' })),
        undefined,
        `"${list}" must not switch the narrowing on`,
      );
    }
  });

  it('parses both real statuses', () => {
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'tbr', listIds: '4,9' })), [4, 9]);
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'read', listIds: '4,9' })), [4, 9]);
  });

  it('tolerates whitespace and trailing separators', () => {
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'tbr', listIds: ' 1 , 2 ,,3, ' })), [1, 2, 3]);
  });

  it('⚠️ drops anything that is not a positive integer — the SQL guard', () => {
    // These are inlined into the statement by `workIdsClause`, so this filter
    // and its twin on that side are what keep caller text out of SQL.
    const ids = readingListIdsFrom(
      ctx({ list: 'tbr', listIds: "1, 2.5, -3, 0, abc, 1 OR 1=1, ');DROP TABLE work;--, 7" }),
    );
    assert.deepEqual(ids, [1, 7]);
  });

  it('an all-rubbish id list still reads as "asked, nothing matched"', () => {
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'tbr', listIds: 'abc,,-1' })), []);
  });

  it('deduplicates — two documents can resolve to one work (the media fold)', () => {
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'tbr', listIds: '5,5,6,5' })), [5, 6]);
  });

  it('keeps first-seen order, so the caller decides and nothing here re-sorts', () => {
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'read', listIds: '9,3,7' })), [9, 3, 7]);
  });

  it('handles a list far past D1’s 100-bind ceiling without truncating', () => {
    const many = Array.from({ length: 350 }, (_, i) => i + 1);
    assert.deepEqual(readingListIdsFrom(ctx({ list: 'tbr', listIds: many.join(',') })), many);
  });
});
