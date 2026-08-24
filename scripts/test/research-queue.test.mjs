/**
 * The offline details runner mirrors, in an in-memory node:sqlite database, the
 * tables the Worker's real functions touch, and diffs each book's writes back to
 * production. It broke on schema drift: `claimRun` became alias-aware (it reads
 * `work_alias`, migration 0410) and `updateWork` writes an audit row to
 * `change_log` (migration 0120) in the SAME `db.batch()` as the `work` UPDATE.
 * The mirror listed neither table, so a run threw `no such table` — and because
 * `makeShim.batch` ran each statement on its own, a failing audit insert left
 * `work.series` written with no audit row (a partial write measured on a real
 * run).
 *
 * These tests exercise the REAL `claimRun` and `updateWork` against the fixed
 * shim over an in-memory database built from the ACTUAL migration chain (zero
 * schema drift), and prove three things:
 *
 *   1. the mirror now initializes with EVERY mirrored table, `work_alias` and
 *      `change_log` included;
 *   2. the code paths that previously crashed on the missing tables no longer
 *      do — `claimRun` reads `work_alias`, `updateWork` writes `change_log`;
 *   3. `makeShim.batch` is atomic — a forced failure rolls BOTH the `work`
 *      write and the (attempted) audit insert back together.
 *
 * No paid research, no Anthropic call, no wrangler, no --remote write: the shim
 * is the whole D1 surface and it is in memory. `runDetailsResearch` (the paid
 * step) is deliberately NOT called; `updateWork` is what it would call to land a
 * finding, and it is the write whose atomicity is under test.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach } from 'node:test';

import { listAliasesForWork, updateWork, getWork } from '@lc/db';

import { claimRun } from '../../apps/worker/src/lib/research-run.ts';
import { makeShim, MIRRORED } from '../research-queue.mjs';

const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));

/** A reference database with the FULL production schema — the migration chain. */
function referenceDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

/**
 * Build the mirror the way `buildMirror` actually does: create the schema for
 * ONLY the `MIRRORED` tables (and their indexes), pulled from a real
 * `sqlite_master` — the exact query and ordering `buildMirror` runs against
 * production. This is what makes the drift regression testable: if a table is
 * dropped from `MIRRORED`, it is genuinely absent from the mirror and the code
 * that reads it crashes, just as it did in production.
 */
function mirrorDb() {
  const ref = referenceDb();
  const names = MIRRORED.map((t) => `'${t}'`).join(', ');
  const schema = ref
    .prepare(
      `SELECT sql FROM sqlite_master WHERE tbl_name IN (${names}) AND sql IS NOT NULL ORDER BY type DESC`,
    )
    .all();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const { sql } of schema) db.exec(sql);
  return db;
}

/**
 * Seed one work with every detail field blank, and a title alias.
 *
 * ⚠️ No `app_user` row: `app_user` is NOT a mirrored table (foreign keys are
 * off precisely so `change_log.changed_by` and the like can reference rows the
 * mirror never holds), so it does not exist in the mirror — exactly as in the
 * real run, where the mirror holds only what `MIRRORED` names.
 */
function seed(db, { workId = 1 } = {}) {
  db.prepare(
    `INSERT INTO work (id, title, authors, primary_author, work_key, series, first_published, description)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  ).run(workId, 'The Ex Hex Duo', 'Erin Sterling', 'Sterling, Erin', 'the ex hex duo|sterling erin');
  db.prepare(
    `INSERT INTO work_alias (work_id, alias, kind, source) VALUES (?, ?, 'title', 'manual')`,
  ).run(workId, 'The Ex Hex');
  return workId;
}

function changeRows(db, workId) {
  return db
    .prepare(`SELECT field, changed_how, entity FROM change_log WHERE entity = 'work' AND entity_id = ?`)
    .all(workId);
}

describe('research-queue mirror — schema drift fix', () => {
  it('MIRRORED now lists work_alias and change_log', () => {
    assert.ok(MIRRORED.includes('work_alias'), 'work_alias must be mirrored (claimRun reads it)');
    assert.ok(MIRRORED.includes('change_log'), 'change_log must be mirrored (updateWork writes it)');
  });

  it('the mirror initializes with every mirrored table present', () => {
    const db = mirrorDb();
    const have = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    for (const table of MIRRORED) {
      assert.ok(have.has(table), `mirror schema is missing ${table}`);
    }
  });

  describe('the real claimRun + updateWork against the shim', () => {
    let db;
    let shim;
    let workId;

    beforeEach(() => {
      db = mirrorDb();
      workId = seed(db);
      shim = makeShim(db);
    });

    it('claimRun reads work_alias without crashing (the 0410 drift)', async () => {
      // The alias is readable through the shim — the exact call claimRun makes.
      const aliases = await listAliasesForWork(shim, workId);
      assert.deepEqual(
        aliases.map((a) => a.alias),
        ['The Ex Hex'],
      );

      // And the whole claim path runs: before the fix this threw
      // `no such table: work_alias` inside listAliasesForWork.
      const claim = await claimRun(shim, workId, 1);
      assert.equal(claim.kind, 'claimed', `expected a claim, got ${claim.kind}`);
    });

    it('updateWork writes a change_log audit row (the 0120 drift)', async () => {
      assert.equal(changeRows(db, workId).length, 0, 'no audit rows before the write');

      const updated = await updateWork(shim, workId, { series: 'Ex Hex' }, { userId: 1, how: 'auto' });
      assert.equal(updated?.series, 'Ex Hex', 'work.series must be written');

      const rows = changeRows(db, workId);
      const series = rows.find((r) => r.field === 'series');
      assert.ok(series, 'a change_log row for the series edit must exist');
      assert.equal(series.changed_how, 'auto', 'the details queue writes are auto, never human');
    });

    it('makeShim.batch is atomic — a failed audit insert rolls the work write back', async () => {
      // Land a known value first, so we can prove the failed batch does not move it.
      await updateWork(shim, workId, { series: 'Original' }, { userId: 1, how: 'auto' });
      const auditBefore = changeRows(db, workId).length;

      // A batch shaped like updateWork's — a work UPDATE, then a change_log
      // INSERT — but the audit insert is malformed (omits NOT NULL columns) and
      // throws at run(). The pre-fix shim would have left the UPDATE committed.
      const batch = [
        shim.prepare('UPDATE work SET series = ? WHERE id = ?').bind('SHOULD_ROLL_BACK', workId),
        shim.prepare("INSERT INTO change_log (batch_id) VALUES ('orphan')"),
      ];

      await assert.rejects(shim.batch(batch), /NOT NULL|constraint/i, 'the malformed audit insert must throw');

      const after = await getWork(shim, workId);
      assert.equal(after?.series, 'Original', 'the work UPDATE must have rolled back with the failed insert');
      assert.equal(changeRows(db, workId).length, auditBefore, 'no audit row may have leaked from the failed batch');
    });
  });
});
