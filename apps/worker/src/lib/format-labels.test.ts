/**
 * The four words this catalog uses for a printing when it talks to another
 * catalog — extracted from `routes/audiobook-mapping.ts` on 2026-08-19 when
 * `browse-works` became their second caller.
 *
 * ⚠️ **These strings are load-bearing in TWO OTHER REPOS.** The audiobook
 * catalog stores them verbatim in `catalog.csv`'s `library_formats` column, and
 * the Discord bot's `PHYSICAL_FORMAT_TOKENS` matches on the lower-cased parts.
 * A "tidy-up" that renamed `Mass market` to `Mass Market` would un-match rows
 * silently, in code nobody was editing. This file is what makes that noisy.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EDITION_FORMATS, PHYSICAL_FORMATS } from '@lc/core';
import {
  PHYSICAL_FORMAT_LABEL,
  crossCatalogFormatLabels,
  physicalFormatLabels,
} from './format-labels.js';

describe('crossCatalogFormatLabels — the wire spelling', () => {
  it('is these exact four words, in this exact order', () => {
    // ⚠️ Pinned as a whole rather than one at a time: the ORDER is part of the
    // contract too (shelf-likely first, Ebook last), because the audiobook
    // side joins them with a pipe and shows the result to a person.
    assert.deepEqual(crossCatalogFormatLabels([...EDITION_FORMATS]), [
      'Hardcover',
      'Paperback',
      'Mass market',
      'Ebook',
    ]);
  });

  it('folds every ebook variant to ONE Ebook — file and Kindle licence alike', () => {
    assert.deepEqual(
      crossCatalogFormatLabels(['ebook_epub', 'ebook_pdf', 'ebook_kindle']),
      ['Ebook'],
      '"do we also have this to read" is the honest granularity another catalog needs',
    );
  });

  it('de-duplicates, and does not care what order it was handed', () => {
    assert.deepEqual(crossCatalogFormatLabels(['paperback', 'hardcover', 'paperback']), [
      'Hardcover',
      'Paperback',
    ]);
  });

  it('empty in, empty out — never a placeholder word', () => {
    // An empty list means "no printing recorded", and inventing "Unknown" here
    // would put a fake format into another catalog's data file.
    assert.deepEqual(crossCatalogFormatLabels([]), []);
  });

  it('⚠️ a seventh format lands on the ebook side by NEGATION, not by a second list', () => {
    // `editionMedium` defines ebook as "not in PHYSICAL_FORMATS", so a format
    // added to the enum tomorrow is classified without anybody remembering to
    // widen an array here. The failure direction is deliberate: an unknown
    // format is treated as a file, so it can never send somebody to a shelf.
    assert.deepEqual(crossCatalogFormatLabels(['ebook_something_new']), ['Ebook']);
  });

  it('every physical format has a hand-written label — none falls through to its enum value', () => {
    for (const format of PHYSICAL_FORMATS) {
      const label = PHYSICAL_FORMAT_LABEL[format];
      assert.ok(label, `${format} needs a label a person can read`);
      assert.notEqual(label, format, 'a raw enum value is not a word for a person');
    }
  });
});

describe('physicalFormatLabels — what browse-works hands the suggestion lane', () => {
  it('drops Ebook and keeps everything with mass', () => {
    assert.deepEqual(crossCatalogFormatLabels(['hardcover', 'ebook_epub']), [
      'Hardcover',
      'Ebook',
    ]);
    assert.deepEqual(physicalFormatLabels(['hardcover', 'ebook_epub']), ['Hardcover']);
  });

  it('⚠️ never lets an Ebook reach a physical suggestion — that is an errand to a bookcase for a file', () => {
    assert.deepEqual(physicalFormatLabels(['ebook_epub', 'ebook_kindle', 'ebook_pdf']), []);
  });

  it('is a FILTER of the shared function, so the two can never drift apart', () => {
    // Pinned by property rather than by example: whatever the shared function
    // says, this is that minus Ebook — never a second table of words.
    const all = crossCatalogFormatLabels([...EDITION_FORMATS]);
    assert.deepEqual(
      physicalFormatLabels([...EDITION_FORMATS]),
      all.filter((l) => l !== 'Ebook'),
    );
  });
});
