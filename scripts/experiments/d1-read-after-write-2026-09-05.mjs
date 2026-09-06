/**
 * EXPERIMENT — is there a read-after-write visibility gap between `execute()`
 * and the `query()` immediately after it, on `--remote` D1?
 *
 * ## The hypothesis, and where it came from
 *
 * Two importers, a week apart, inserted editions and then read them straight
 * back to link their copies — and **twelve copies came out with
 * `edition_id = NULL`** (copies 104–115, works 224–235), seven to nine seconds
 * after the editions they should have matched. W6-DEFECTS narrowed it on
 * 2026-09-05 by ruling out, each measured:
 *
 *   - **not ordering** — editions 322–328 at `14:19:32`, copies 109–115 at
 *     `14:19:39`; the Illumicrate pair nine seconds apart;
 *   - **not the predicate's value** — `change_log` batch
 *     `fix-retailer-publishers-2026-09-02` proves those editions read
 *     `publisher = 'Barnes & Noble'` from import until 2026-09-02;
 *   - **not the `--file` summary bug** — `query()` moved to `--command` in
 *     `052a726`, 2026-08-10, before both runs;
 *   - **not the read path today** — both predicate shapes re-run against
 *     production return the right rows, correctly typed;
 *   - **not a double run** — 7 editions for 7 works, 5 for 5.
 *
 * What was left is a visibility gap, and it cannot be settled by reasoning: it
 * needs a write. The owner authorised ONE scratch-table experiment, 2026-09-05.
 *
 * ## What it does, and why it cannot touch anything real
 *
 * Everything happens in `_scratch_raw_test`, a table this script creates and
 * drops. It writes no row in any catalogue table, reads none, and the only
 * statements it issues name that one table. The teardown runs in a `finally`,
 * so a crash mid-run still drops it, and the drop is **verified against
 * `sqlite_master`** rather than assumed.
 *
 * Each trial mirrors the importers' exact shape rather than a simplified one:
 * **five rows in ONE `execute()`** (a batch written to a temp `.sql` file and
 * fed to `wrangler d1 execute --file`), then **one `query()`** for all five
 * through `--command`. Same two functions, same flags, same process.
 *
 * A miss is retried with a short backoff, because *how long* the rows take to
 * appear is the number that decides the fix: a gap of 200 ms is a bounded retry,
 * a gap that never closes is a different bug.
 *
 * ## Usage — MAIN, remote, only
 *
 *     node scripts/experiments/d1-read-after-write-2026-09-05.mjs --remote
 *     node scripts/experiments/d1-read-after-write-2026-09-05.mjs --remote --trials 20
 *
 * `--friend` is refused: the hypothesis is about the main instance's importers,
 * and a scratch table has no business appearing in somebody else's database.
 * A local run is refused too — miniflare is a different engine and would answer
 * a question nobody asked.
 *
 * ## Result
 *
 * The write-up lives in `docs/info/gotchas.md`, titled by the symptom
 * (*"a copy imported seconds after its edition comes out with edition_id NULL"*),
 * and the verdict is carried in `docs/TODO.md` beside the copy-edition-links
 * item. Re-run this file to re-measure rather than trusting either.
 */

import { execute, lit, query } from '../lib/d1.mjs';

const argv = process.argv.slice(2);
const TABLE = '_scratch_raw_test';
const ROWS_PER_TRIAL = 5; // the Illumicrate importer's batch size
const RETRY_MS = [100, 250, 500, 1000, 2000]; // only used after a miss

if (argv.includes('--friend')) {
  console.error(
    'REFUSED: --friend. This experiment creates and drops a scratch table, and it does that only ' +
      "in the OWNER's database. The defect it investigates is in the main instance's importers.",
  );
  process.exit(2);
}
if (!argv.includes('--remote')) {
  console.error(
    'REFUSED: --remote is required. The hypothesis is specifically about the REMOTE D1 HTTP path; ' +
      'miniflare is a different engine and a local answer would prove nothing about it.',
  );
  process.exit(2);
}

const trials = (() => {
  const i = argv.indexOf('--trials');
  const n = i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : 20;
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error(`--trials must be 1..200, got ${argv[i + 1]}`);
  return n;
})();

const target = { remote: true, friend: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (t0) => Number((performance.now() - t0).toFixed(1));

/** Does the scratch table exist right now? Read from sqlite_master, never assumed. */
function scratchExists() {
  const rows = query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${lit(TABLE)}`,
    target,
  );
  return rows.length > 0;
}

const results = [];
let created = false;

try {
  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  console.log(`\nCreating ${TABLE} on the MAIN remote D1…`);
  execute([`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY, t TEXT);`], target);
  created = true;
  if (!scratchExists()) throw new Error(`${TABLE} did not appear after CREATE — nothing else can be trusted.`);
  console.log(`${TABLE} exists. Running ${trials} trial(s) of ${ROWS_PER_TRIAL} row(s) each.\n`);

  console.log('trial | write ms | read ms | found | verdict');
  console.log('------+----------+---------+-------+--------');

  for (let i = 1; i <= trials; i++) {
    const marker = `t${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inserts = Array.from(
      { length: ROWS_PER_TRIAL },
      (_, k) => `INSERT INTO ${TABLE} (t) VALUES (${lit(`${marker}#${k}`)});`,
    );

    // The write — the importers' exact path: a batch through execute().
    const w0 = performance.now();
    execute(inserts, target);
    const writeMs = ms(w0);

    // The read — the importers' exact path: query() immediately after, no pause.
    const r0 = performance.now();
    const back = query(`SELECT id, t FROM ${TABLE} WHERE t LIKE ${lit(`${marker}#%`)}`, target);
    const readMs = ms(r0);

    let found = back.length;
    let verdict = found === ROWS_PER_TRIAL ? 'HIT' : 'MISS';
    let recoveredAfter = null;

    if (verdict === 'MISS') {
      // How long does the gap last? That number decides the fix.
      let waited = 0;
      for (const pause of RETRY_MS) {
        await sleep(pause);
        waited += pause;
        const again = query(`SELECT id, t FROM ${TABLE} WHERE t LIKE ${lit(`${marker}#%`)}`, target);
        if (again.length === ROWS_PER_TRIAL) {
          found = again.length;
          recoveredAfter = waited;
          verdict = `MISS→recovered after ${waited}ms`;
          break;
        }
        found = again.length;
      }
      if (recoveredAfter == null) verdict = `MISS→still ${found}/${ROWS_PER_TRIAL} after ${waited}ms`;
    }

    results.push({ trial: i, writeMs, readMs, found, verdict, recoveredAfter });
    console.log(
      `${String(i).padStart(5)} | ${String(writeMs).padStart(8)} | ${String(readMs).padStart(7)} | ` +
        `${String(found).padStart(2)}/${ROWS_PER_TRIAL} | ${verdict}`,
    );
  }

  // -------------------------------------------------------------------------
  // The answer
  // -------------------------------------------------------------------------
  const hits = results.filter((r) => r.found === ROWS_PER_TRIAL && r.recoveredAfter == null).length;
  const recovered = results.filter((r) => r.recoveredAfter != null);
  const stuck = results.filter((r) => r.found !== ROWS_PER_TRIAL);
  const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : 'n/a');

  console.log(`\nHIT RATE: ${hits}/${trials} immediate.`);
  console.log(`  recovered after a wait: ${recovered.length}` +
    (recovered.length ? ` (${recovered.map((r) => `${r.recoveredAfter}ms`).join(', ')})` : ''));
  console.log(`  never became visible:   ${stuck.length}`);
  console.log(`  mean write ${avg(results.map((r) => r.writeMs))} ms, mean read ${avg(results.map((r) => r.readMs))} ms`);
  console.log(
    hits === trials
      ? '\nThe read-after-write hypothesis is WEAKENED, not killed: this exercises the same two ' +
          'functions against the same remote D1, but not the same colo, load, or D1 build as the ' +
          'August runs, and a rare race does not have to reproduce in 20 tries.'
      : '\n🔴 A visibility gap REPRODUCED. The proportionate fix goes in scripts/lib/d1.mjs — see ' +
          'the write-up in docs/info/gotchas.md.',
  );
} finally {
  // -------------------------------------------------------------------------
  // Teardown — in a finally, so a crash mid-run still drops it, and VERIFIED.
  // -------------------------------------------------------------------------
  if (created) {
    try {
      execute([`DROP TABLE IF EXISTS ${TABLE};`], target);
      const still = scratchExists();
      console.log(
        still
          ? `\n🔴 ${TABLE} IS STILL THERE. Drop it by hand: ` +
              `cd apps/worker; npx wrangler d1 execute DB --remote --command "DROP TABLE ${TABLE}"`
          : `\n${TABLE} dropped, and verified gone from sqlite_master.`,
      );
      if (still) process.exitCode = 1;
    } catch (err) {
      console.error(
        `\n🔴 TEARDOWN FAILED: ${err?.message ?? err}\n` +
          `Drop it by hand: cd apps/worker; npx wrangler d1 execute DB --remote --command "DROP TABLE ${TABLE}"`,
      );
      process.exitCode = 1;
    }
  }
}
