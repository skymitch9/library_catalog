/**
 * The audiobook sweep's D1 half — step 7 of
 * `catalog-platform/docs/info/audiobook-association-route.md` §9.
 *
 * Four claims, each of which failed silently somewhere in this estate before it
 * had a test:
 *
 *   1. **ONE rendering.** The script and the Worker write the same SQL because
 *      they share `audiobookSweepStatements`, not because two people kept two
 *      copies in step. The equality is asserted here against the script's own
 *      renderer, so a change to either side fails this file.
 *   2. **Idempotent.** A second run inside one minute produces the same
 *      statements and the same rows — `ON CONFLICT … stale_at = NULL` on every
 *      INSERT, per §6.1.
 *   3. **Transitions only.** A work that gained or lost audio writes ONE
 *      `change_log` row; a run that reproduced what was already there writes
 *      NONE. §6.3's whole point: six ticks a day over every live row would
 *      otherwise bury a person's own edits.
 *   4. **One batch.** The audit rows land in the SAME `db.batch()` as the
 *      mutation they describe — `changes.ts`'s rule. Two awaits would be the
 *      "flag written in a second request" bug wearing an audit costume.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SweepPlan } from '@lc/core';
import {
  applyAudiobookSweepPlan,
  audiobookSweepStatements,
  audiobookSweepTransitions,
  type ExistingEditionRow,
} from '../src/audiobook-holdings.ts';
// The script's renderer, and the escaping rule it renders with. Imported so the
// "one canonical rendering" claim is asserted rather than asserted-about.
import { renderSweepStatements } from '../../../scripts/lib/audiobook-sql.mjs';
import { lit } from '../../../scripts/lib/d1.mjs';

// ---------------------------------------------------------------------------
// Fixtures — the Elantris pair (migration 0390's own worked example)
// ---------------------------------------------------------------------------

const EDITION = {
  workId: 514,
  audioKey: 'Elantris - Tenth Anniversary Special Edition',
  title: 'Elantris',
  rawTitle: 'Elantris - Tenth Anniversary Special Edition',
  authors: 'Brandon Sanderson',
  series: 'Elantris',
  indexDisplay: 'Book 1',
  indexSort: 1,
  coverHref: "covers/Brandon Sanderson/O'Elantris.jpg",
  narrator: 'Jack Garrett',
  matchedVia: 'exact' as const,
  titleSimilarity: 1,
  viaAlias: null,
};

const RUNG = {
  series: 'The Primal Hunter',
  indexSort: 2,
  title: 'The Primal Hunter 2',
  authors: 'Zogarth',
  audiobookSeries: 'The Primal Hunter',
  indexDisplay: '2',
  coverHref: 'covers/Zogarth/The Primal Hunter 2.jpg',
  seriesMatchedVia: 'work_match' as const,
};

/** The report half is not what this file is about; it is filled to satisfy the type. */
function planOf(over: Partial<SweepPlan> = {}): SweepPlan {
  return {
    editionUpserts: [EDITION],
    editionStales: [{ workId: 72, audioKey: 'Tamer: King of Dinosaurs' }],
    rungUpserts: [RUNG],
    rungStales: [{ series: 'A Series Nobody Holds Any More', indexSort: 4 }],
    scope: { kind: 'all' },
    report: {
      workCount: 2,
      audiobookCount: 2,
      matched: [],
      missed: [],
      byVia: { exact: 1, alias: 0, containment: 0 },
      viaAliasCount: 0,
      liveEditions: [],
      multiEdition: [],
      editionsGoneStale: 1,
      rungs: [],
      rungsGoneStale: 1,
      foldSeriesDeferred: [],
    },
    ...over,
  } as SweepPlan;
}

// ---------------------------------------------------------------------------
// A fake D1 that records what it was handed, and nothing else
// ---------------------------------------------------------------------------

interface Recorded {
  sql: string;
  binds: unknown[];
}

function fakeDb() {
  const batches: Recorded[][] = [];
  let pending: Recorded[] = [];
  const db = {
    prepare(sql: string) {
      const rec: Recorded = { sql, binds: [] };
      const stmt = {
        bind(...args: unknown[]) {
          rec.binds = args;
          pending.push(rec);
          return stmt;
        },
        async run() {
          pending.push(rec);
          return { meta: { changes: 1 } };
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        _rec: rec,
      };
      return stmt;
    },
    async batch(statements: unknown[]) {
      // Everything bound since the last batch IS this batch — the fake's whole
      // point is that a second await would show up as a second entry here.
      batches.push(pending.slice(0, statements.length));
      pending = [];
      return statements.map(() => ({ success: true }));
    },
    _batches: batches,
  };
  return db as unknown as D1Database & { _batches: Recorded[][] };
}

/** Rebuild the script's text from the shared list — see test 1. */
function fillLocally(sql: string, binds: unknown[]): string {
  let i = 0;
  return `${sql.replace(/\?/g, () => lit(binds[i++]))};`;
}

// ---------------------------------------------------------------------------

describe('one canonical rendering — the script and the Worker write the same SQL', () => {
  it('the script renders exactly the shared statement list, filled', () => {
    // 🔴 The claim that makes the consolidation real. If somebody adds a column
    // to the Worker's binder and not to the script's renderer, there is now no
    // "the script's renderer" to forget — and this fails if that ever changes
    // back.
    const plan = planOf();
    const shared = audiobookSweepStatements(plan);
    const rendered = renderSweepStatements(plan);
    assert.equal(rendered.length, shared.length);
    assert.deepEqual(
      rendered,
      shared.map((s) => fillLocally(s.sql, s.binds)),
    );
  });

  it('the placeholder count matches the bind count on every statement', () => {
    // A mismatch shifts every value one column to the left, silently — the
    // single worst thing the fill could do quietly, so it is pinned on the
    // shared list rather than left to the renderer's own throw.
    for (const s of audiobookSweepStatements(planOf())) {
      assert.equal(
        s.sql.split('?').length - 1,
        s.binds.length,
        `placeholders and binds disagree: ${s.sql}`,
      );
    }
  });

  it('⚠️ the statement ORDER is upserts before stales, per table', () => {
    // A stale UPDATE running before its INSERT would immediately un-stale the
    // row it had just marked.
    const kinds = audiobookSweepStatements(planOf()).map((s) =>
      /^INSERT INTO audiobook_edition_holding/.test(s.sql)
        ? 'edition-upsert'
        : /^UPDATE audiobook_edition_holding/.test(s.sql)
          ? 'edition-stale'
          : /^INSERT INTO audiobook_series_holding/.test(s.sql)
            ? 'rung-upsert'
            : 'rung-stale',
    );
    assert.deepEqual(kinds, ['edition-upsert', 'edition-stale', 'rung-upsert', 'rung-stale']);
  });

  it('writes the TABLE, never the view', () => {
    // `audiobook_holding` is a read-only VIEW since 0390; writing it would fail
    // at runtime, and reading it would hide every second edition.
    for (const s of audiobookSweepStatements(planOf())) {
      assert.ok(
        !/\baudiobook_holding\b/.test(s.sql),
        `statement names the view rather than the table: ${s.sql}`,
      );
    }
  });
});

describe('idempotency — §6.1', () => {
  it('every INSERT clears stale_at and refreshes last_seen_at on conflict', () => {
    for (const s of audiobookSweepStatements(planOf())) {
      if (!s.sql.startsWith('INSERT')) continue;
      assert.match(s.sql, /ON CONFLICT/);
      assert.match(s.sql, /stale_at = NULL/);
      assert.match(s.sql, /last_seen_at = datetime\('now'\)/);
    }
  });

  it('a second apply of the same plan issues byte-identical statements', async () => {
    const plan = planOf();
    const existing: ExistingEditionRow[] = [];
    const a = fakeDb();
    const b = fakeDb();
    await applyAudiobookSweepPlan(a, plan, { trigger: 'cron', existingEditions: existing });
    await applyAudiobookSweepPlan(b, plan, { trigger: 'cron', existingEditions: existing });
    const sqlOf = (db: ReturnType<typeof fakeDb>) => db._batches[0]!.map((r) => r.sql);
    assert.deepEqual(sqlOf(a), sqlOf(b));
  });

  it('nothing is DELETEd — marked, never deleted (migration 0010)', () => {
    for (const s of audiobookSweepStatements(planOf())) {
      assert.ok(!/^\s*DELETE/i.test(s.sql), s.sql);
    }
  });

  it('a stale UPDATE is guarded by `stale_at IS NULL` — never re-stamped', () => {
    for (const s of audiobookSweepStatements(planOf())) {
      if (!s.sql.startsWith('UPDATE')) continue;
      assert.match(s.sql, /stale_at IS NULL/);
    }
  });
});

describe('transitions — §6.3, one row per CHANGE and none otherwise', () => {
  it('a work that gains audio writes one row, null → the editions', () => {
    const t = audiobookSweepTransitions(planOf({ editionStales: [] }), []);
    assert.equal(t.length, 1);
    assert.equal(t[0]!.workId, 514);
    assert.equal(t[0]!.before, null);
    assert.deepEqual(t[0]!.after, {
      editions: [{ audioKey: EDITION.audioKey, matchedVia: 'exact' }],
    });
  });

  it('a work that loses its last recording writes one row, the editions → null', () => {
    const existing: ExistingEditionRow[] = [
      { workId: 72, audioKey: 'Tamer: King of Dinosaurs', matchedVia: 'containment', staleAt: null },
    ];
    const t = audiobookSweepTransitions(planOf({ editionUpserts: [] }), existing);
    assert.equal(t.length, 1);
    assert.equal(t[0]!.workId, 72);
    assert.deepEqual(t[0]!.before, {
      editions: [{ audioKey: 'Tamer: King of Dinosaurs', matchedVia: 'containment' }],
    });
    assert.equal(t[0]!.after, null);
  });

  it('🔴 a run that reproduced what was already there writes NOTHING', () => {
    // The property the whole design rests on: the sweep touches every live row
    // six times a day, and in steady state this must be silent.
    const existing: ExistingEditionRow[] = [
      { workId: 514, audioKey: EDITION.audioKey, matchedVia: 'exact', staleAt: null },
    ];
    const t = audiobookSweepTransitions(
      planOf({ editionUpserts: [EDITION], editionStales: [] }),
      existing,
    );
    assert.deepEqual(t, []);
  });

  it('a STALE row does not count as an association it could lose again', () => {
    // A stale row is the record of an association that ended. Counting it as
    // "before" would make re-finding the recording look like no change at all.
    const existing: ExistingEditionRow[] = [
      { workId: 514, audioKey: EDITION.audioKey, matchedVia: 'exact', staleAt: '2026-09-01' },
    ];
    const t = audiobookSweepTransitions(
      planOf({ editionUpserts: [EDITION], editionStales: [] }),
      existing,
    );
    assert.equal(t.length, 1);
    assert.equal(t[0]!.before, null);
  });

  it('a work the run never looked at is never reported', () => {
    const existing: ExistingEditionRow[] = [
      { workId: 999, audioKey: 'Something Else', matchedVia: 'exact', staleAt: null },
    ];
    const t = audiobookSweepTransitions(
      planOf({ editionUpserts: [], editionStales: [] }),
      existing,
    );
    assert.deepEqual(t, []);
  });
});

describe('the write — one batch, and the trigger on the audit row', () => {
  it('🔴 the audit rows land in the SAME batch as the mutation', async () => {
    const db = fakeDb();
    const result = await applyAudiobookSweepPlan(db, planOf({ editionStales: [] }), {
      trigger: 'cron',
      existingEditions: [],
    });
    assert.equal(db._batches.length, 1, 'a second batch is a second transaction');
    const batch = db._batches[0]!;
    const audit = batch.filter((r) => /INSERT INTO change_log/.test(r.sql));
    assert.equal(audit.length, 1);
    assert.equal(result.transitions, 1);
    // Holdings AND audit, together.
    assert.ok(batch.length > audit.length);
  });

  it('the audit row says WHICH TRIGGER fired — the fact §6.3 keeps', async () => {
    for (const [trigger, note] of [
      ['cron', 'audiobook sweep (cron)'],
      ['on-add', 'audiobook sweep (on add)'],
      ['admin', 'audiobook sweep (admin)'],
    ] as const) {
      const db = fakeDb();
      await applyAudiobookSweepPlan(db, planOf({ editionStales: [] }), {
        trigger,
        existingEditions: [],
      });
      const audit = db._batches[0]!.find((r) => /INSERT INTO change_log/.test(r.sql))!;
      // binds: batch_id, entity, entity_id, field, old_json, new_json,
      //        changed_by, changed_how, note
      assert.equal(audit.binds[1], 'audiobook_holding');
      assert.equal(audit.binds[2], 514);
      assert.equal(audit.binds[3], '__row__');
      assert.equal(audit.binds[4], 'null');
      assert.equal(audit.binds[6], null, 'changed_by is NULL — nobody read these values');
      assert.equal(audit.binds[7], 'auto');
      assert.equal(audit.binds[8], note);
    }
  });

  it('one batch id groups a run’s audit rows', async () => {
    const db = fakeDb();
    const plan = planOf({
      editionUpserts: [EDITION, { ...EDITION, workId: 515 }],
      editionStales: [],
    });
    const result = await applyAudiobookSweepPlan(db, plan, {
      trigger: 'admin',
      existingEditions: [],
    });
    const audit = db._batches[0]!.filter((r) => /INSERT INTO change_log/.test(r.sql));
    assert.equal(audit.length, 2);
    assert.equal(audit[0]!.binds[0], result.batchId);
    assert.equal(audit[1]!.binds[0], result.batchId);
  });

  it('an empty plan touches the database not at all', async () => {
    const db = fakeDb();
    const result = await applyAudiobookSweepPlan(
      db,
      planOf({ editionUpserts: [], editionStales: [], rungUpserts: [], rungStales: [] }),
      { trigger: 'cron', existingEditions: [] },
    );
    assert.equal(db._batches.length, 0);
    assert.equal(result.statements, 0);
    assert.equal(result.transitions, 0);
  });
});
