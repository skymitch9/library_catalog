import { Hono } from 'hono';
import { classifyScannedCode } from '@lc/core';
import { findEditionByAsin, findEditionByIsbn13 } from '@lc/db';
import { resolveIsbn } from '@lc/isbn';
import type { AppBindings } from '../env.js';
import { requireCapability } from '../middleware/auth.js';

/**
 * Scan a code and say what it is.
 *
 * Three answers, in the order the scan loop wants them:
 *
 *   ignore   not a book identifier — the price add-on, a retail UPC, junk.
 *            The caller **keeps scanning**. Not an error, not a warning, and
 *            deliberately cheap: no lookup, no cache write, no log line. A back
 *            cover carries two or three barcodes and only one is the book.
 *   owned    already on our shelf. Answered from D1 with no network call at
 *            all — every successful scan writes `edition.isbn13` back, so the
 *            collection becomes its own barcode database.
 *   found    resolved from the ladder, as a *proposal*. Nothing is written.
 *
 * ⚠️ `found` is never "correct", only "what the databases said". A wrong ISBN
 * returns a confident, well-formed, wrong book — measured: three of ten ISBNs
 * typed from memory resolved to entirely different books, with covers. The
 * review step is not ceremony.
 */
export const isbnRoutes = new Hono<AppBindings>().get(
  '/:code',
  // Free, no vision call — `scanBarcode`, split from the old `scan` capability
  // 2026-08-16. See capabilities.ts's `scanPhoto` comment for the other half.
  requireCapability('scanBarcode'),
  async (c) => {
    const classified = classifyScannedCode(c.req.param('code'));

    if (classified.kind === 'ignore') {
      return c.json({ result: 'ignore', reason: classified.reason, raw: classified.raw });
    }

    if (classified.kind === 'asin') {
      const owned = await findEditionByAsin(c.env.DB, classified.asin);
      if (owned) return c.json({ result: 'owned', edition: owned });
      // No free database indexes ASINs. This is the Kindle path and it resolves
      // through the ebook importer, not here — see docs/info/isbn-ladder.md for
      // why that population is large.
      return c.json({ result: 'unresolvable', asin: classified.asin, reason: 'asin_not_indexed' });
    }

    const owned = await findEditionByIsbn13(c.env.DB, classified.isbn13);
    if (owned) return c.json({ result: 'owned', edition: owned });

    const { candidates, trace } = await resolveIsbn(classified.isbn13, {
      googleBooksKey: c.env.GOOGLE_BOOKS_API_KEY,
      userAgent: 'library_catalog (private household catalog)',
    });

    return c.json({
      result: candidates.length ? 'found' : 'not_found',
      isbn13: classified.isbn13,
      isbn10: classified.isbn10,
      candidates,
      // Returned to the client on purpose: when a scan comes back empty the only
      // useful question is *which rung* was empty, and a trace that lives only
      // in a Worker log cannot be read from a phone in front of a bookshelf.
      trace,
    });
  },
);
