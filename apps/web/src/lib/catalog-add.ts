import type { ScanLine } from '@lc/core';
import { api } from '../api.js';

/**
 * Turning one reviewed line into catalog rows.
 *
 * Extracted from `ScanPage` when the shelf photo arrived, because a spine and a
 * barcode now reach the same "Add" button and there must be exactly one thing
 * behind it. The alternative — a second copy in the photo path — is how one of
 * them quietly stops attaching to existing works.
 */

export interface AddedWork {
  workId: number;
  /** The title of the work we attached to, when we attached rather than created. */
  attachedTo: string | null;
}

/**
 * Add a reviewed line to the catalog.
 *
 * ⚠️ **Match before creating.** `POST /api/works` deliberately does not dedupe
 * — migration 0001 explains why the database stays permissive — so it is the
 * caller's job to ask. This catalog already holds 117 works imported from
 * ebooks, which makes scanning the paperback of one the *ordinary* case: skip
 * the check and every sweep quietly grows a second row for a book already on
 * the shelf, which is the "filed under already-yours, where it is lost" failure
 * the matcher exists to prevent, arriving through the front door.
 */
export async function addLineToCatalog(line: ScanLine): Promise<AddedWork> {
  const title = line.resolvedTitle ?? line.text;
  const authors = line.resolvedAuthors ?? line.author;
  if (!title || !authors) {
    throw new Error('A book needs a title and an author before it can be added.');
  }

  const existing = await api.matchWork(title, authors);
  const work = existing.work ?? (await api.createWork({ title, authors })).work;

  /*
   * An edition, but only when there is something to say about one.
   *
   * A barcode gives an ISBN and a printing, so it earns a paperback edition. A
   * spine read gives neither: the format is a guess from the shape of the book
   * and the ISBN is unknown. Writing `format: 'paperback'` anyway would put an
   * invented fact in the column that `PHYSICAL_FORMATS` filters on — so a spine
   * with no resolved ISBN adds the work and the copy, and leaves the edition to
   * whoever later scans its barcode.
   */
  if (line.isbn13) {
    await api.createEdition({
      workId: work.id,
      isbn13: line.isbn13,
      format: 'paperback',
      publisher: line.publisher ?? null,
      publishedYear: line.publishedYear ?? null,
      coverUrl: line.coverUrl ?? null,
      source: 'openlibrary',
    });
  }

  // A copy, because a person scanning a barcode or photographing a shelf is
  // looking at the book. This is the one place that inference is safe — unlike
  // the ebook importer, where a file existing says nothing about a shelf.
  await api.createCopy({ workId: work.id, status: 'owned' });

  return { workId: work.id, attachedTo: existing.work ? work.title : null };
}
