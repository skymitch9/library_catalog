/**
 * `physicalFormatFrom` — Open Library's binding text, mapped or declined.
 *
 * Feeds the scan-time format toggle's confirmation (Kiro's ask, built
 * 2026-09-02): the row shows this beside the person's own one-tap choice and
 * says something only when the two disagree.
 *
 * ## ⚠️ MOST OF THIS FILE IS ABOUT WHAT IT REFUSES
 *
 * Because a confirmation that is sometimes nonsense is worse than no
 * confirmation — it trains somebody to stop reading the one thing on the row
 * that exists to be read. The mapped set is deliberately tiny and every string
 * in the declined set below is one that appears in real Open Library records.
 *
 * ⚠️ **The strings are real.** `"Mass Market Paperback"`, `"Hardback"`,
 * `"Trade Paperback"`, `"Kindle Edition"`, `"Unknown Binding"`, `"Library
 * Binding"` and `"Leather Bound"` are all values Open Library's
 * `physical_format` actually carries; they are not invented shapes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { physicalFormatFrom } from '../src/resolve.js';

describe('physicalFormatFrom — the bindings it will read', () => {
  it('reads the three plain ones', () => {
    assert.equal(physicalFormatFrom('Paperback'), 'paperback');
    assert.equal(physicalFormatFrom('Hardcover'), 'hardcover');
    assert.equal(physicalFormatFrom('Mass Market Paperback'), 'mass_market');
  });

  it('⚠️ MASS MARKET WINS OVER PAPERBACK — the order is the whole test', () => {
    // "Mass Market Paperback" contains "paperback". Test paperback first and
    // every mass market printing in the catalog reads as an ordinary one.
    assert.equal(physicalFormatFrom('mass market paperback'), 'mass_market');
    assert.equal(physicalFormatFrom('Mass-Market'), 'mass_market');
  });

  it('accepts "Hardback" and "Hard Cover" — the same object, two spellings', () => {
    assert.equal(physicalFormatFrom('Hardback'), 'hardcover');
    assert.equal(physicalFormatFrom('Hard Cover'), 'hardcover');
  });

  it('accepts the trade/softcover spellings of a paperback', () => {
    assert.equal(physicalFormatFrom('Trade Paperback'), 'paperback');
    assert.equal(physicalFormatFrom('Softcover'), 'paperback');
  });

  it('is case-insensitive, because the field is free text', () => {
    assert.equal(physicalFormatFrom('HARDCOVER'), 'hardcover');
    assert.equal(physicalFormatFrom('pAPERBACK'), 'paperback');
  });
});

describe('⚠️ physicalFormatFrom — the bindings it REFUSES, which is the point', () => {
  it('declines an absent, empty or whitespace value', () => {
    assert.equal(physicalFormatFrom(undefined), null);
    assert.equal(physicalFormatFrom(null), null);
    assert.equal(physicalFormatFrom(''), null);
    assert.equal(physicalFormatFrom('   '), null);
  });

  it('⚠️ NEVER answers "Kindle Edition" — a barcode is a physical object', () => {
    // `ebook_kindle` is a real EDITION_FORMATS value and is still refused here.
    // This function is reached from a barcode scan of a book in somebody's
    // hands; "this is a Kindle edition" there is confident and wrong.
    assert.equal(physicalFormatFrom('Kindle Edition'), null);
    assert.equal(physicalFormatFrom('ebook'), null);
    assert.equal(physicalFormatFrom('Audio CD'), null);
  });

  it('⚠️ declines "Leather Bound" rather than calling it hardcover', () => {
    // Defensible to map (leather ⊂ hardcover in the data, migration 0430) and
    // still declined: the output is shown as "the lookup says X", and saying
    // hardcover about a record that said Leather Bound puts words in its mouth.
    assert.equal(physicalFormatFrom('Leather Bound'), null);
    assert.equal(physicalFormatFrom('Leatherbound'), null);
  });

  it('declines the vague and the unknown rather than guessing', () => {
    assert.equal(physicalFormatFrom('Unknown Binding'), null);
    assert.equal(physicalFormatFrom('Library Binding'), null);
    assert.equal(physicalFormatFrom('Board book'), null);
    assert.equal(physicalFormatFrom('Spiral-bound'), null);
    assert.equal(physicalFormatFrom('Print book'), null);
  });
});
