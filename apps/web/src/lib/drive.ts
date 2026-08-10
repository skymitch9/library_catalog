/**
 * Flipping out to Google Drive, the way the audiobook catalog does.
 *
 * ## Why this is a port and not an invention
 *
 * The ebook files in this catalog are the *same tree* the audiobook site
 * publishes: `edition.source_url` is a path under `OpenAudible/books`, and
 * `audiobook_catalog/scripts/sync_to_drive.py` uploads that tree to Drive,
 * one folder per author. So the map that site already builds
 * (`author_drive_map.json`, 508 folders as of 2026-08-09) answers this app's
 * question unchanged, and `npm run sync:drive-map` copies it in.
 *
 * The three links below are `_authorFolderHref`, `_authorSearchHref` and
 * `_bookSearchHref` from `app/web/templates/index.html`, ported behaviour for
 * behaviour — including the multi-author fallback, which splits on the same
 * `[;,/&]| and ` rule the rest of this project uses and tries each name, because
 * the primary author's folder holds the co-authored books too.
 *
 * ## ⚠️ Degrading, not failing
 *
 * A missing author is the *expected* case, not an error: the map is a snapshot,
 * and this catalog holds authors the audiobook one does not. Every book
 * therefore always gets a Drive **search** link, which needs no map at all, and
 * gets the direct folder link only when the map knows the name. A stale map
 * costs precision and never correctness — which is why nothing here throws and
 * nothing reports a failure to load.
 */

import { splitAuthors } from '@lc/core';

export type AuthorDriveMap = Record<string, string>;

let cache: Promise<AuthorDriveMap> | null = null;

/**
 * Fetch the map once per session.
 *
 * Deliberately not bundled: 50KB of folder ids that only a book page needs has
 * no business in the entry chunk, and keeping it a file means refreshing it is
 * `npm run sync:drive-map` rather than a rebuild.
 */
export function loadDriveMap(): Promise<AuthorDriveMap> {
  cache ??= fetch('/author-drive-map.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: unknown) => (d && typeof d === 'object' ? (d as AuthorDriveMap) : {}))
    .catch(() => ({}));
  return cache;
}

function lookup(map: AuthorDriveMap, name: string): string | null {
  if (!name) return null;
  if (map[name]) return map[name];
  // Case- and space-insensitive second pass. The map carries both "A. J. Pine"
  // and "A.j. Pine" because Drive does; the shelf spells names more ways still.
  const wanted = name.toLowerCase().trim();
  for (const key of Object.keys(map)) {
    if (key.toLowerCase().trim() === wanted) return map[key] as string;
  }
  return null;
}

/**
 * The Drive folder this book is actually in.
 *
 * ## ⚠️ The file's own directory is asked FIRST, and it is the strong rung
 *
 * The map is keyed on folder *name*, and `sync_to_drive.py` mirrors the local
 * tree — so the first path segment of `edition.source_url` is, literally, the
 * name of the folder in Drive. It is not an inference about who wrote the book;
 * it is where the file is.
 *
 * Measured against the 115 local rows on 2026-08-10:
 *
 * | Rung | Works with a direct folder link |
 * |---|---|
 * | the file's own directory | **81** |
 * | the author's name | 19 |
 * | neither — Drive search only | 15 |
 *
 * Only **9 of 23** distinct author strings are in the map at all, and the
 * fourteen misses include Ichiei Ishibumi (15 volumes) and Shimizu Yuu (22) —
 * because those light novels are not shelved under an author. They live in
 * "Highschool DXD" and "Seirei Tsukai no Blade Dance", which *are* in the map,
 * as folders. Asking "who wrote this" could never have found them; asking
 * "where is this file" does.
 *
 * The author rungs stay, for rows that have no file path — a hand-added
 * hardcover, a Kindle licence — where the author's folder is the best guess
 * available.
 */
export function folderHref(
  map: AuthorDriveMap,
  { sourceUrl, authors }: { sourceUrl: string | null; authors: string },
): string | null {
  if (sourceUrl) {
    const parts = sourceUrl.split(/[\\/]/).filter(Boolean);
    // Only a real parent directory. A flat filename's "directory" is the file.
    if (parts.length > 1) {
      const hit = lookup(map, parts[0] as string);
      if (hit) return normalise(hit);
    }
  }

  const direct = lookup(map, authors.trim());
  if (direct) return normalise(direct);

  // "Caroline Peckham, Susanne Valenti" is one folder under one of the two.
  for (const name of splitAuthors(authors)) {
    const hit = lookup(map, name);
    if (hit) return normalise(hit);
  }
  return null;
}

function normalise(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  // The map holds full URLs today; it held bare folder ids once. Accept both.
  return v.startsWith('http')
    ? v
    : `https://drive.google.com/drive/folders/${encodeURIComponent(v)}`;
}

/** Always available, map or no map. */
export function driveSearchHref(term: string): string | null {
  const clean = term.trim().replace(/^"|"$/g, '').trim();
  return clean ? `https://drive.google.com/drive/search?q=${encodeURIComponent(clean)}` : null;
}

/**
 * Search Drive for the file itself.
 *
 * Uses the file's own name from `edition.source_url` when there is one, because
 * that is literally what is in Drive — "Blackflame (Cradle Book 3) - Will
 * Wight.epub" — and it is a far better search term than the catalog's cleaned
 * title, which has had the series stripped out of it.
 */
export function fileSearchHref(sourceUrl: string | null, fallbackTitle: string): string | null {
  if (sourceUrl) {
    const base = sourceUrl.split(/[\\/]/).pop() ?? '';
    const stem = base.replace(/\.[a-z0-9]+$/i, '').trim();
    if (stem) return driveSearchHref(stem);
  }
  return driveSearchHref(fallbackTitle);
}
