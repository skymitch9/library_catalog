/**
 * `parseAudiobookCsv` — the row identity of the sibling audiobook catalog.
 *
 * The load-bearing claim these tests exist for is §3.2 of
 * `catalog-platform/docs/info/audiobook-association-route.md`: the script reads
 * `catalog.csv` off disk (LF, as git checks it out here) and the Worker will
 * fetch the SAME file over HTTP from Cloudflare Pages (CRLF, measured
 * 2026-09-05 — every differing line differed in line endings and nothing else).
 * **If those two transports could produce different rows, "one canonical
 * implementation" would be a slogan.** They cannot, because the parser
 * discards `\r`, and that is pinned below rather than asserted in a comment.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAudiobookCsv, parseCsv, type AudiobookRow } from '../src/audiobook-csv.js';

/** The 16 columns the live CSV carries, in the live order (measured 2026-09-05). */
const HEADER =
  'title,series,series_index_display,series_index_sort,author,narrator,year,' +
  'genre,duration_hhmm,cover_href,companion_files,desc,library_work_id,' +
  'library_formats,universe,series_gap';

function row(cells: Partial<Record<string, string>>): string {
  return HEADER.split(',')
    .map((h) => {
      const v = cells[h] ?? '';
      return /[",\n]/.test(v) ? `"${v.split('"').join('""')}"` : v;
    })
    .join(',');
}

describe('parseCsv — RFC4180 enough for this file', () => {
  it('reads quoted fields containing commas', () => {
    assert.deepEqual(parseCsv('a,"b,c",d\n'), [['a', 'b,c', 'd']]);
  });

  it('reads a doubled quote as one literal quote', () => {
    assert.deepEqual(parseCsv('a,"say ""hi""",c\n'), [['a', 'say "hi"', 'c']]);
  });

  it('reads a newline embedded in a quoted field', () => {
    assert.deepEqual(parseCsv('a,"one\ntwo",c\n'), [['a', 'one\ntwo', 'c']]);
  });

  it('keeps a trailing row that has no final newline', () => {
    assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
  });

  it('returns [] for the empty string', () => {
    assert.deepEqual(parseCsv(''), []);
  });
});

describe('parseAudiobookCsv — the row mapping', () => {
  it('maps the columns it needs and strips the series decoration from the title', () => {
    const csv =
      HEADER +
      '\n' +
      row({
        title: 'Domestication - A Fantasy LitRPG Adventure (Battle Mage Farmer, Book 1)',
        series: 'Battle Mage Farmer',
        series_index_display: 'Book 1',
        series_index_sort: '1',
        author: 'Seth Ring',
        narrator: 'Travis Baldree',
        year: '2023',
        genre: 'LitRPG',
        cover_href: 'covers/Seth Ring/Domestication.jpg',
        desc: 'A farmer, a battle mage.',
      }) +
      '\n';

    const rows = parseAudiobookCsv(csv);
    assert.equal(rows.length, 1);
    const r = rows[0] as AudiobookRow;

    // ⚠️ `rawTitle` is verbatim — it is `audio_key` (migration 0390) and the
    // content-warning key (0340). `title` is what a person is shown.
    assert.equal(
      r.rawTitle,
      'Domestication - A Fantasy LitRPG Adventure (Battle Mage Farmer, Book 1)',
    );
    assert.equal(r.title, 'Domestication - A Fantasy LitRPG Adventure');
    assert.equal(r.authors, 'Seth Ring');
    assert.equal(r.series, 'Battle Mage Farmer');
    assert.equal(r.seriesIndexDisplay, 'Book 1');
    assert.equal(r.seriesIndexSort, 1);
    assert.equal(r.narrator, 'Travis Baldree');
    assert.equal(r.coverHref, 'covers/Seth Ring/Domestication.jpg');
    assert.equal(r.year, '2023');
    assert.equal(r.genre, 'LitRPG');
    assert.equal(r.description, 'A farmer, a battle mage.');
    assert.equal(r.id, 1);
  });

  it('carries seriesIndex as a duplicate of seriesIndexSort, for buildWorkIndex', () => {
    const csv = `${HEADER}\n${row({ title: 'Elantris', series: 'Elantris', series_index_sort: '1', author: 'Brandon Sanderson' })}\n`;
    const r = parseAudiobookCsv(csv)[0] as AudiobookRow;
    // Not decoration: `MatchableWork.seriesIndex` is the field
    // `disambiguateByVolume` reads, and a rename would silently disable it.
    assert.equal(r.seriesIndex, r.seriesIndexSort);
    assert.equal(r.seriesIndex, 1);
  });

  it('blank optional columns become null, never empty strings', () => {
    const csv = `${HEADER}\n${row({ title: 'Goodnight Moon', author: 'Margaret Wise Brown' })}\n`;
    const r = parseAudiobookCsv(csv)[0] as AudiobookRow;
    assert.equal(r.series, null);
    assert.equal(r.seriesIndexSort, null);
    assert.equal(r.seriesIndexDisplay, null);
    assert.equal(r.narrator, null);
    assert.equal(r.coverHref, null);
    assert.equal(r.year, null);
    assert.equal(r.genre, null);
    assert.equal(r.description, null);
    // `authors` is deliberately NOT nullable — it is a string the author gate
    // reads, and the gate's "no author supplied" case is the empty string.
    assert.equal(r.authors, 'Margaret Wise Brown');
  });

  it('skips a row whose title is blank, and a short row', () => {
    const csv = [
      HEADER,
      row({ title: '   ', author: 'Nobody' }),
      'only,three,cells',
      row({ title: 'Real Book', author: 'Somebody' }),
      '',
    ].join('\n');
    const rows = parseAudiobookCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as AudiobookRow).title, 'Real Book');
    // ⚠️ `id` is assigned AFTER the filter, so it numbers the kept rows.
    assert.equal((rows[0] as AudiobookRow).id, 1);
  });

  it('a header-only file yields []', () => {
    assert.deepEqual(parseAudiobookCsv(`${HEADER}\n`), []);
    assert.deepEqual(parseAudiobookCsv(HEADER), []);
  });

  it('an empty string yields []', () => {
    assert.deepEqual(parseAudiobookCsv(''), []);
  });

  it('🔴 CRLF and LF produce IDENTICAL rows — the §3.2 transport equivalence', () => {
    const lf = [
      HEADER,
      row({
        title: 'Isles of the Emberdark',
        series: 'Secret Projects',
        series_index_display: 'Book 5',
        series_index_sort: '5',
        author: 'Brandon Sanderson',
        narrator: 'Kaleo Griffith, Jennifer Jill Araya',
        desc: 'A description with a comma, and "quotes".',
      }),
      row({ title: 'Elantris', series: 'Elantris', series_index_sort: '1', author: 'Brandon Sanderson' }),
      '',
    ].join('\n');
    const crlf = lf.split('\n').join('\r\n');

    assert.notEqual(lf, crlf, 'the fixture must actually differ, or this proves nothing');
    assert.deepEqual(parseAudiobookCsv(crlf), parseAudiobookCsv(lf));
    assert.equal(parseAudiobookCsv(lf).length, 2);
  });
});
