/**
 * How this person likes the collection shown, remembered between visits.
 *
 * View, sort, direction and page size only — nothing about *what* is being
 * looked at. A remembered search or series filter is the shape that makes an app
 * open on an empty screen with no visible reason, and this one is opened
 * standing in front of a shelf where "why is my library empty" is exactly the
 * wrong first thought.
 *
 * ⚠️ Every value is validated on read. localStorage is user-writable and
 * survives a version of this app that offered different options, so a stored
 * `pageSize: 500` from a future build must not become a request the server has
 * to refuse. The server re-checks anyway; this stops the UI showing a control in
 * a state the server will not honour.
 */

import { COLLECTION_PAGE_SIZE, COLLECTION_PAGE_SIZES } from '@lc/core';

export interface Prefs {
  view: 'grid' | 'list';
  sort: string;
  dir: 'asc' | 'desc';
  pageSize: number;
}

const KEY = 'lc_prefs_v1';

const SORTS = ['series', 'title', 'author', 'added'];

export const DEFAULT_PREFS: Prefs = {
  // A grid by default: the covers are the reason to look, and after the
  // 2026-08-10 backfill 114 of 115 works have one.
  view: 'grid',
  sort: 'series',
  dir: 'asc',
  pageSize: COLLECTION_PAGE_SIZE,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      view: p.view === 'list' ? 'list' : 'grid',
      sort: typeof p.sort === 'string' && SORTS.includes(p.sort) ? p.sort : DEFAULT_PREFS.sort,
      dir: p.dir === 'desc' ? 'desc' : 'asc',
      pageSize:
        typeof p.pageSize === 'number' && COLLECTION_PAGE_SIZES.includes(p.pageSize)
          ? p.pageSize
          : DEFAULT_PREFS.pageSize,
    };
  } catch {
    // A private-mode browser throws on localStorage. Defaults are a fine answer.
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* not worth telling anyone about */
  }
}
