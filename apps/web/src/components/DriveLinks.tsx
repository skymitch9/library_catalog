/**
 * "Open it in Drive" — the audiobook catalog's flip-out, for ebooks.
 *
 * Three buttons, the same three that site offers on every book: the folder the
 * book is in, a Drive search for the file, and a Drive search for the author.
 * Only the first needs `author-drive-map.json`; the other two need nothing and
 * are always shown, which is what makes a stale or missing map cost precision
 * rather than function.
 *
 * The folder link resolves for 100 of the 115 works measured on 2026-08-10, and
 * mostly not through the author's name — see `folderHref` in `lib/drive.ts`.
 *
 * ⚠️ The item search uses the *file name* from `edition.source_url`, not the
 * catalog title. The file in Drive is called
 * "Blackflame (Cradle Book 3) - Will Wight.epub" and this catalog calls the book
 * "Blackflame", because the importer strips the series off before storing.
 * Searching Drive for the catalog title finds the right thing far less often.
 */

import { useEffect, useState } from 'react';
import {
  driveSearchHref,
  fileSearchHref,
  folderHref,
  loadDriveMap,
  type AuthorDriveMap,
} from '../lib/drive.js';

export function DriveLinks({
  title,
  authors,
  sourceUrl,
}: {
  title: string;
  authors: string;
  sourceUrl: string | null;
}) {
  const [map, setMap] = useState<AuthorDriveMap | null>(null);

  useEffect(() => {
    let live = true;
    void loadDriveMap().then((m) => live && setMap(m));
    return () => {
      live = false;
    };
  }, []);

  const folder = map ? folderHref(map, { sourceUrl, authors }) : null;
  const authorSearch = driveSearchHref(authors);
  const bookSearch = fileSearchHref(sourceUrl, title);

  return (
    <div className="drive-links">
      {folder && (
        <a className="chip-link" href={folder} target="_blank" rel="noopener noreferrer">
          Open in Drive ↗
        </a>
      )}
      {bookSearch && (
        <a className="chip-link" href={bookSearch} target="_blank" rel="noopener noreferrer">
          Find the file ↗
        </a>
      )}
      {authorSearch && (
        <a className="chip-link" href={authorSearch} target="_blank" rel="noopener noreferrer">
          Search author ↗
        </a>
      )}
    </div>
  );
}
