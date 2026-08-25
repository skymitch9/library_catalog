/**
 * ⚠️ What a scan's ADD actually writes onto a NEW work — named field by field.
 *
 * This file exists because the same object literal has now lost a field twice,
 * and both times it was an ABSENCE, which is the failure mode no behavioural
 * test catches:
 *
 *  1. **The cover.** The work was created from `{ title, authors }` alone while
 *     the edition beside it took `line.coverUrl`. Every list in the app renders
 *     `work.cover_url`, so a barcode scan produced a book with a perfectly good
 *     cover URL stored one table away and a blank tile on screen. Measured
 *     before the fix: 143 editions carried 20 covers, and all 20 belonged to
 *     works showing none.
 *  2. **The description** (F4, 2026-08-25). `bestCandidate` in `@lc/isbn` was
 *     taught to borrow a blurb from whichever lookup rung has one — Open
 *     Library's `jscmd=data` carries none at all — and *nothing on the scan path
 *     read it*. The line had no field for it and the create body did not name
 *     it, so a free description was dropped at the scan and then bought from
 *     the paid details ladder minutes later. No error, no red test.
 *
 * So the assertions here NAME the fields rather than exercising an outcome. A
 * field `bestCandidate` learns to borrow that this body forgets to carry fails
 * here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blankLine, workCreateFrom, type ScanLine } from '../src/index.js';

/** A barcode line as the Worker hands it back once the lookup answered. */
function resolvedLine(over: Partial<ScanLine> = {}): ScanLine {
  return {
    ...blankLine(1, 'barcode', '9780765350374'),
    state: 'found',
    lookedUp: true,
    isbn13: '9780765350374',
    resolvedTitle: 'Elantris',
    resolvedAuthors: 'Brandon Sanderson',
    publisher: 'Tor',
    publishedYear: 2005,
    coverUrl: 'https://covers.example/e.jpg',
    description: 'The capital of Arelon.',
    ...over,
  };
}

describe('the work a scan creates', () => {
  it('⚠️ carries the DESCRIPTION the lookup borrowed (F4)', () => {
    assert.equal(
      workCreateFrom(resolvedLine(), 'Elantris', 'Brandon Sanderson').description,
      'The capital of Arelon.',
    );
  });

  it('⚠️ carries the COVER, so the tile is not blank while the edition has one', () => {
    assert.equal(
      workCreateFrom(resolvedLine(), 'Elantris', 'Brandon Sanderson').coverUrl,
      'https://covers.example/e.jpg',
    );
  });

  it('carries the year, and the title/authors the work was MATCHED on', () => {
    // ⚠️ The caller's `title`/`authors`, not the line's — `work_key` is derived
    // from them and joins ~870 audiobook reviews, so the value the key was
    // computed from is the value that must be stored.
    const body = workCreateFrom(resolvedLine(), 'Elantris', 'Brandon Sanderson');
    assert.equal(body.title, 'Elantris');
    assert.equal(body.authors, 'Brandon Sanderson');
    assert.equal(body.firstPublished, 2005);
  });

  it('sends undefined, not null, for what the lookup could not answer', () => {
    // `optionalText` in the create schema reads absent as "nobody recorded one",
    // which is a statement a scan is entitled to make. `null` is not.
    const body = workCreateFrom(
      resolvedLine({ coverUrl: null, publishedYear: null, description: null }),
      'Elantris',
      null,
    );
    assert.equal(body.coverUrl, undefined);
    assert.equal(body.firstPublished, undefined);
    assert.equal(body.description, undefined);
    assert.equal(body.authors, null, 'authorless is an explicit statement, and stays one');
  });

  it('handles a line written before the description field existed', () => {
    // Jobs persist as JSON in `scan_job.enriched`, so the key is genuinely
    // absent on rows written before 2026-08-25.
    const old = resolvedLine();
    delete old.description;
    assert.equal(workCreateFrom(old, 'Elantris', 'Brandon Sanderson').description, undefined);
  });
});
