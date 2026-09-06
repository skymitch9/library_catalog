/**
 * The two standing audits' shared rules — and the test that makes "one
 * implementation, two callers" a MEASUREMENT rather than a claim.
 *
 * 🔴 **The centre of this file is `describe('the conversion changed nothing')`.**
 * Both scripts were rewritten on 2026-09-06 to import their rules from
 * `@lc/core` instead of holding them inline, so that `apps/worker` could share
 * them. The whole conversion is only worth doing if the scripts still say
 * exactly what they said before — otherwise the estate has traded a duplicated
 * rule for a changed one, which is strictly worse.
 *
 * So the PRE-CONVERSION logic is kept here **verbatim**, copied out of the
 * scripts at commit `85082f2`, and run beside the new shared functions on one
 * fixture. The assertion is on the printed BYTES. That is the only form of this
 * test that cannot pass by accident: a test that re-derived the expected text
 * from the new formatter would prove the formatter equals itself.
 *
 * ⚠️ **Do not "tidy" the oracles below to call the shared code.** They are dead
 * copies on purpose; the moment they import anything from `audits.ts` this file
 * stops testing anything at all.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COVER_HEALTH_MIN_BYTES,
  auditSeriesAggregates,
  auditWindow,
  formatCoverHealthHeader,
  formatCoverHealthReport,
  formatSeriesAggregateReport,
  judgeCoverProbe,
  resolveCoverUrl,
  type CoverHealthFinding,
  type SeriesAggregateWork,
} from '../src/audits.js';
import { foldSeriesNames, isBareSeriesTitle } from '../src/matching.js';

// ---------------------------------------------------------------------------
// THE ORACLES — the pre-conversion script logic, copied verbatim
// ---------------------------------------------------------------------------

/**
 * `scripts/check-cover-health.mjs` at `85082f2`, lines 19–60, with `fetch`
 * replaced by a canned answer so it can run offline. Nothing else is changed:
 * the same constant, the same branch order, the same strings, the same padding.
 */
const OLD_MIN_BYTES = 1000;

function oldCoverHealth(
  rows: readonly { id: number; title: string; cover_url: string }[],
  base: string,
  answers: ReadonlyMap<number, { ok: boolean; status: number; ct: string; size: number } | Error>,
): { header: string; report: string } {
  const header = `Checking ${rows.length} cover(s) from library-catalog against ${base}...\n`;

  const broken: { id: number; title: string; reason: string; url: string }[] = [];
  let checked = 0;

  for (const r of rows) {
    const url = r.cover_url.startsWith('http') ? r.cover_url : `${base}${r.cover_url}`;
    const answer = answers.get(r.id);
    if (answer instanceof Error) {
      broken.push({ ...r, reason: answer.message?.slice(0, 50), url });
    } else if (answer) {
      const ct = answer.ct || '';
      const size = answer.size;
      if (!answer.ok) {
        broken.push({ ...r, reason: `HTTP ${answer.status}`, url });
      } else if (!ct.startsWith('image/')) {
        broken.push({ ...r, reason: `not an image (${ct})`, url });
      } else if (size > 0 && size < OLD_MIN_BYTES) {
        broken.push({ ...r, reason: `${size}B placeholder`, url });
      }
    }
    checked++;
  }

  const lines = [`\nChecked: ${checked}`, `Broken:  ${broken.length}`];
  if (broken.length > 0) {
    lines.push('\nBroken covers:');
    for (const b of broken) {
      lines.push(`  ${String(b.id).padStart(4)}  ${b.title.slice(0, 40).padEnd(40)}  ${b.reason}`);
    }
  }
  return { header, report: lines.join('\n') };
}

/**
 * `scripts/audit-series-aggregates.mjs` at `85082f2`, lines 39–84, with the
 * `query()` calls replaced by their fixture rows and `process.exit` replaced by
 * a returned code. The fold, the filter and every printed byte are untouched.
 */
function oldSeriesAggregates(
  seriesNames: readonly string[],
  works: readonly SeriesAggregateWork[],
  where: string,
): { text: string; code: number } {
  const seriesKeys = foldSeriesNames(seriesNames);
  const flagged = works.filter((w) => isBareSeriesTitle(w.title, seriesKeys));

  const out: string[] = [];
  out.push(
    `${where}: ${seriesKeys.size} known series name(s), ` +
      `${works.length} work(s) with 2+ editions, ${flagged.length} flagged.`,
  );

  if (flagged.length === 0) {
    out.push('Clean — no series-titled work carries multiple editions.');
    return { text: out.join('\n'), code: 0 };
  }

  out.push(
    '\n⚠️ Series-titled works with 2+ editions. Each is either the OL work-level\n' +
      'aggregate bug recurring (docs/TODO.md, 2026-08-13) or a real multi-printing\n' +
      'volume 1. A person should eyeball each one:\n',
  );
  for (const w of flagged) {
    out.push(
      `  #${String(w.id).padStart(4)}  ${w.title} — ${w.authors} ` +
        `(${w.editions} editions, ${w.copies} copies)`,
    );
  }
  return { text: out.join('\n'), code: 1 };
}

// ---------------------------------------------------------------------------
// The fixture — one of every shape the audits have ever met in production
// ---------------------------------------------------------------------------

const COVER_ROWS = [
  { id: 7, title: 'The Primal Hunter', cover_url: '/covers/primal-hunter.jpg' },
  { id: 42, title: 'Dungeon Crawler Carl', cover_url: 'https://covers.example/dcc.jpg' },
  { id: 113, title: 'Summer in the City', cover_url: 'https://books.google.com/content?id=x' },
  { id: 199, title: 'Foxy Tales', cover_url: 'https://i.gr-assets.com/222114404._SX50_.jpg' },
  { id: 356, title: 'Evocation', cover_url: 'https://archive.org/evocation.jpg' },
  {
    id: 512,
    title: 'A Title Long Enough To Be Cut At Exactly Forty Characters And Then Some',
    cover_url: '/covers/long.jpg',
  },
];

/** One of each verdict, including the two the byte floor is blind to (KI-6). */
const COVER_ANSWERS = new Map<
  number,
  { ok: boolean; status: number; ct: string; size: number } | Error
>([
  [7, { ok: true, status: 200, ct: 'image/jpeg', size: 84_000 }],
  [42, { ok: false, status: 404, ct: 'text/html', size: 512 }],
  // ⚠️ KI-6's card: a genuine 4,013-byte JPEG that CLEARS the floor. It must
  // still read as `ok` — this audit is not the instrument for it, and pretending
  // otherwise here would start failing 25 real covers on main.
  [113, { ok: true, status: 200, ct: 'image/jpeg', size: 4013 }],
  [199, { ok: true, status: 200, ct: 'image/jpeg', size: 43 }],
  [356, new Error('The operation was aborted due to timeout')],
  [512, { ok: true, status: 200, ct: 'text/html; charset=utf-8', size: 9000 }],
]);

const BASE = 'https://library.heygabi.ai';

function newCoverFindings(): { findings: CoverHealthFinding[]; checked: number } {
  const findings: CoverHealthFinding[] = [];
  let checked = 0;
  for (const r of COVER_ROWS) {
    const url = resolveCoverUrl(r.cover_url, BASE);
    const answer = COVER_ANSWERS.get(r.id);
    const verdict =
      answer instanceof Error
        ? judgeCoverProbe({
            ok: false,
            status: 0,
            contentType: null,
            contentLength: null,
            error: answer.message,
          })
        : judgeCoverProbe({
            ok: answer!.ok,
            status: answer!.status,
            contentType: answer!.ct,
            contentLength: answer!.size,
          });
    if (verdict.verdict !== 'ok') {
      findings.push({
        id: r.id,
        title: r.title,
        coverUrl: r.cover_url,
        url,
        verdict: verdict.verdict,
        reason: verdict.reason,
      });
    }
    checked += 1;
  }
  return { findings, checked };
}

const SERIES_NAMES = [
  'The Wandering Inn',
  'Dungeon Crawler Carl',
  'Space Knight',
  'The Primal Hunter',
  'Cosmere',
];

const SERIES_WORKS: SeriesAggregateWork[] = [
  { id: 300, title: 'Space Knight', authors: 'Unknown', editions: 6, copies: 6 },
  { id: 12, title: 'The Wandering Inn', authors: 'pirateaba', editions: 2, copies: 3 },
  { id: 88, title: 'Dungeon Crawler Carl 2', authors: 'Matt Dinniman', editions: 2, copies: 2 },
  { id: 91, title: 'The Book Thief', authors: 'Markus Zusak', editions: 3, copies: 3 },
];

// ---------------------------------------------------------------------------

describe('🔴 the conversion changed nothing — old path vs new path, byte for byte', () => {
  it('cover health: the header is identical', () => {
    const old = oldCoverHealth(COVER_ROWS, BASE, COVER_ANSWERS);
    assert.equal(
      formatCoverHealthHeader(COVER_ROWS.length, 'library-catalog', BASE),
      old.header,
    );
  });

  it('cover health: the report is identical', () => {
    const old = oldCoverHealth(COVER_ROWS, BASE, COVER_ANSWERS);
    const fresh = newCoverFindings();
    assert.equal(formatCoverHealthReport(fresh.findings, fresh.checked), old.report);
  });

  it('cover health: the same rows are flagged, with the same reasons', () => {
    // Belt and braces beside the byte test. The two are not redundant: the byte
    // test would still pass if BOTH sides silently dropped a row, and this one
    // pins the set and the count independently of any formatting.
    const old = oldCoverHealth(COVER_ROWS, BASE, COVER_ANSWERS);
    const fresh = newCoverFindings();
    const oldRows = old.report.split('\n').filter((l) => /^ {2}\s*\d+ {2}/.test(l));

    assert.equal(fresh.findings.length, oldRows.length, 'a different number of rows was flagged');
    assert.ok(fresh.findings.length >= 4, 'the fixture must actually flag something');
    for (const f of fresh.findings) {
      assert.ok(
        oldRows.some((l) => l.includes(String(f.id)) && l.endsWith(f.reason)),
        `the old path did not flag #${f.id} with reason "${f.reason}"`,
      );
    }
  });

  it('cover health: the URL each row is asked for is identical', () => {
    for (const r of COVER_ROWS) {
      const oldUrl = r.cover_url.startsWith('http') ? r.cover_url : `${BASE}${r.cover_url}`;
      assert.equal(resolveCoverUrl(r.cover_url, BASE), oldUrl);
    }
  });

  it('series aggregates: the FLAGGED report is identical, and the exit code is 1', () => {
    const old = oldSeriesAggregates(SERIES_NAMES, SERIES_WORKS, 'production');
    const findings = auditSeriesAggregates({ seriesNames: SERIES_NAMES, works: SERIES_WORKS });
    assert.equal(formatSeriesAggregateReport(findings, 'production'), old.text);
    assert.equal(old.code, 1);
    assert.ok(findings.flagged.length > 0);
  });

  it('series aggregates: the CLEAN report is identical, and the exit code is 0', () => {
    // The production case since the 2026-08-13 cleanup — and therefore the one
    // that will actually be printed every night, so it is the one most worth
    // pinning.
    const clean = SERIES_WORKS.filter((w) => w.id !== 300 && w.id !== 12);
    const old = oldSeriesAggregates(SERIES_NAMES, clean, 'local');
    const findings = auditSeriesAggregates({ seriesNames: SERIES_NAMES, works: clean });
    assert.equal(formatSeriesAggregateReport(findings, 'local'), old.text);
    assert.equal(old.code, 0);
    assert.equal(findings.flagged.length, 0);
  });

  it('series aggregates: the same works are flagged', () => {
    const old = oldSeriesAggregates(SERIES_NAMES, SERIES_WORKS, 'production');
    const findings = auditSeriesAggregates({ seriesNames: SERIES_NAMES, works: SERIES_WORKS });
    for (const w of findings.flagged) assert.ok(old.text.includes(`#${String(w.id).padStart(4)}`));
    assert.equal(findings.flagged.length, (old.text.match(/^ {2}#/gm) ?? []).length);
  });
});

describe('the cover verdict ladder', () => {
  it('a healthy image is `ok`', () => {
    assert.deepEqual(
      judgeCoverProbe({ ok: true, status: 200, contentType: 'image/jpeg', contentLength: 84_000 }),
      { verdict: 'ok', reason: '' },
    );
  });

  it('a non-2xx is `broken`, and the STATUS is what it says', () => {
    // Order matters: a 404 page is also "not an image", and the status is the
    // more useful of the two things to print.
    assert.deepEqual(
      judgeCoverProbe({ ok: false, status: 404, contentType: 'text/html', contentLength: 512 }),
      { verdict: 'broken', reason: 'HTTP 404' },
    );
  });

  it('a 200 that is not an image is `broken`', () => {
    assert.deepEqual(
      judgeCoverProbe({ ok: true, status: 200, contentType: 'text/html', contentLength: 9000 }),
      { verdict: 'broken', reason: 'not an image (text/html)' },
    );
  });

  it('a missing content-type reads as not-an-image rather than crashing', () => {
    assert.equal(
      judgeCoverProbe({ ok: true, status: 200, contentType: null, contentLength: 9000 }).verdict,
      'broken',
    );
  });

  it(`under ${COVER_HEALTH_MIN_BYTES} bytes is a placeholder`, () => {
    assert.deepEqual(
      judgeCoverProbe({ ok: true, status: 200, contentType: 'image/png', contentLength: 43 }),
      { verdict: 'broken', reason: '43B placeholder' },
    );
  });

  it('⚠️ a MISSING content-length is not a zero-byte placeholder', () => {
    // An origin that sends none (chunked, or a CDN that will not) reports 0, and
    // treating that as a placeholder would fail every cover behind such a host.
    for (const contentLength of [0, null]) {
      assert.equal(
        judgeCoverProbe({ ok: true, status: 200, contentType: 'image/jpeg', contentLength })
          .verdict,
        'ok',
      );
    }
  });

  it('🔴 a request that never got an answer is `unreachable`, NOT `broken`', () => {
    // The split the route adds and the script folds back. A Worker with flaky
    // egress would otherwise file every cover in the catalog as broken, and the
    // next person would hunt four hundred dead covers that were all fine.
    const v = judgeCoverProbe({
      ok: false,
      status: 0,
      contentType: null,
      contentLength: null,
      error: 'The operation was aborted due to timeout',
    });
    assert.equal(v.verdict, 'unreachable');
    assert.equal(v.reason, 'The operation was aborted due to timeout');
  });

  it('a long error message is cut at 50 characters, as the script always did', () => {
    const v = judgeCoverProbe({
      ok: false,
      status: 0,
      contentType: null,
      contentLength: null,
      error: 'x'.repeat(400),
    });
    assert.equal(v.reason.length, 50);
  });

  it('⚠️ KI-6 is NOT caught, deliberately — 4,013 bytes clears the floor', () => {
    // Widening the floor here would start failing 25 real covers on main. KI-6
    // names the instrument that would catch it (a hash deny-list in
    // `verifyCoverUrl`) and the condition for building it (a second hit).
    assert.equal(
      judgeCoverProbe({ ok: true, status: 200, contentType: 'image/jpeg', contentLength: 4013 })
        .verdict,
      'ok',
    );
  });
});

describe('resolveCoverUrl', () => {
  it('leaves an absolute URL alone, http or https', () => {
    for (const url of ['https://a.example/x.jpg', 'http://a.example/x.jpg']) {
      assert.equal(resolveCoverUrl(url, BASE), url);
    }
  });

  it('joins a relative path to the base', () => {
    assert.equal(resolveCoverUrl('/covers/a.jpg', BASE), `${BASE}/covers/a.jpg`);
  });

  it('does not double the slash, and does not lose one', () => {
    assert.equal(resolveCoverUrl('/covers/a.jpg', `${BASE}/`), `${BASE}/covers/a.jpg`);
    assert.equal(resolveCoverUrl('covers/a.jpg', BASE), `${BASE}/covers/a.jpg`);
  });
});

describe('🔴 auditWindow — a cap without rotation is worse than no cap', () => {
  const rows = Array.from({ length: 10 }, (_, i) => i);

  it('a cap at or above the total takes everything, at offset 0', () => {
    for (const cap of [10, 11, 1000]) {
      const w = auditWindow(rows, cap, 5);
      assert.deepEqual(w.slice, rows);
      assert.equal(w.skipped, 0);
      assert.equal(w.offset, 0);
    }
  });

  it('successive ticks advance by one whole cap', () => {
    assert.deepEqual(auditWindow(rows, 4, 0).slice, [0, 1, 2, 3]);
    assert.deepEqual(auditWindow(rows, 4, 1).slice, [4, 5, 6, 7]);
  });

  it('🔴 the window WRAPS — the last tick of a cycle covers the tail AND the head', () => {
    // This is the whole point. `ORDER BY id LIMIT 4` would audit rows 0–3 every
    // night forever and report itself clean while never once looking at 4–9.
    assert.deepEqual(auditWindow(rows, 4, 2).slice, [8, 9, 0, 1]);
  });

  it('every row is reached within ceil(total / cap) ticks', () => {
    const cap = 4;
    const seen = new Set<number>();
    for (let tick = 0; tick < Math.ceil(rows.length / cap); tick += 1) {
      for (const r of auditWindow(rows, cap, tick).slice) seen.add(r);
    }
    assert.equal(seen.size, rows.length);
  });

  it('the cycle repeats — tick N and tick N + windows are the same window', () => {
    const windows = Math.ceil(rows.length / 4);
    assert.deepEqual(auditWindow(rows, 4, 3).slice, auditWindow(rows, 4, 3 + windows).slice);
  });

  it('⚠️ a negative or non-finite tick does not produce a negative offset', () => {
    // `slice(-n)` would silently audit the tail forever.
    for (const tick of [-1, -37, Number.NaN, Number.POSITIVE_INFINITY]) {
      const w = auditWindow(rows, 4, tick);
      assert.ok(w.offset >= 0, `offset ${w.offset} for tick ${tick}`);
      assert.equal(w.slice.length, 4);
    }
  });

  it('an empty catalog is an empty window, not a crash', () => {
    assert.deepEqual(auditWindow([], 250, 1), { slice: [], offset: 0, skipped: 0 });
  });

  it('a cap of zero or less defers everything rather than taking everything', () => {
    for (const cap of [0, -1]) {
      const w = auditWindow(rows, cap, 1);
      assert.equal(w.slice.length, 0);
      assert.equal(w.skipped, rows.length);
    }
  });
});

describe('auditSeriesAggregates — the alarm itself', () => {
  it('flags a bare series title carrying 2+ editions', () => {
    const f = auditSeriesAggregates({ seriesNames: SERIES_NAMES, works: SERIES_WORKS });
    assert.deepEqual(
      f.flagged.map((w) => w.id).sort((a, b) => a - b),
      [12, 300],
    );
  });

  it('⚠️ a title carrying a VOLUME NUMBER is never flagged', () => {
    // `isBareSeriesTitle`'s digit test: "Dungeon Crawler Carl 2" is a book, not
    // an aggregate wearing the series name.
    const f = auditSeriesAggregates({ seriesNames: SERIES_NAMES, works: SERIES_WORKS });
    assert.ok(!f.flagged.some((w) => w.id === 88));
  });

  it('a title that is not a series name is never flagged', () => {
    const f = auditSeriesAggregates({ seriesNames: SERIES_NAMES, works: SERIES_WORKS });
    assert.ok(!f.flagged.some((w) => w.id === 91));
  });

  it('reports the fold size and the denominator, not just the hits', () => {
    // `seriesKeys` is the fold's own health check: a deploy that shipped an
    // empty series list would report 0 known names and 0 flagged, which looks
    // exactly like a clean catalog.
    const f = auditSeriesAggregates({ seriesNames: SERIES_NAMES, works: SERIES_WORKS });
    assert.equal(f.seriesKeys, foldSeriesNames(SERIES_NAMES).size);
    assert.equal(f.multiEditionWorks, SERIES_WORKS.length);
  });

  it('no series names at all flags nothing — and says the fold is empty', () => {
    const f = auditSeriesAggregates({ seriesNames: [], works: SERIES_WORKS });
    assert.equal(f.seriesKeys, 0);
    assert.equal(f.flagged.length, 0);
  });
});
