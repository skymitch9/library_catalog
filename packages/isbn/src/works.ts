/**
 * Open Library at the *work* level — the two endpoints `search.json` cannot
 * answer, and the reason `work.openlibrary_work_id` is worth filling at all.
 *
 * ## ⚠️ Why `search.json` is not enough, measured twice
 *
 * **1. It hides the series.** `docs/info/covers-and-series.md` §3.1: the search
 * index returned `series: null` for all 37 works it was asked about, *including*
 * `Unsouled`, whose first edition record says `series: ["Cradle, Volume 1"]` in
 * as many words. Twelve of the 24 series that backfill recovered came from the
 * editions endpoint and from nowhere else. Anything concluding "Open Library
 * does not know" from the search index alone is reading the wrong endpoint.
 *
 * **2. It cannot be corroborated.** `docs/info/isbn-ladder.md` §4.4: a search for
 * "Firefight" + "Brandon Sanderson" returns a *different* 2001 novel called
 * Firefight, scoring **1.0 on title and 1.0 on author**. No similarity threshold
 * separates that from the truth, because there is nothing textual to separate.
 * Only the publisher and the year did. `search.json` gives one publisher and one
 * year for the whole work; `editions.json` gives every printing's, which is what
 * a discriminator has to be checked against.
 *
 * So: `editionsOfWork` exists to fetch the evidence, and `workKeyForIsbn` exists
 * because a checksum-valid ISBN read out of the file we hold is the one piece of
 * evidence that is not a search result at all.
 */

/** One edition record, reduced to the fields that discriminate. */
export interface OlEdition {
  key: string | null;
  title: string | null;
  subtitle: string | null;
  /** Open Library's own `series` array — populated here, empty in the index. */
  series: string[];
  publishers: string[];
  publishDate: string | null;
  /** Four-digit year parsed out of `publishDate`, or null. */
  year: number | null;
  isbn13: string[];
  languages: string[];
  pages: number | null;
}

export interface OlFetchOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Editions to ask for. 50 is the whole printing history of anything here. */
  limit?: number;
}

const DEFAULT_UA = 'library_catalog (+private household catalog)';

function yearOf(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(s);
  return m ? Number(m[1]) : null;
}

/** `/works/OL123W` and `OL123W` are the same thing said two ways. */
export function bareWorkKey(key: string): string {
  return key.replace(/^\/+/, '').replace(/^works\//, '');
}

interface RawEdition {
  key?: string;
  title?: string;
  subtitle?: string;
  series?: string[];
  publishers?: string[];
  publish_date?: string;
  isbn_13?: string[];
  languages?: { key?: string }[];
  number_of_pages?: number;
}

function toEdition(e: RawEdition): OlEdition {
  return {
    key: e.key ?? null,
    title: e.title ?? null,
    subtitle: e.subtitle ?? null,
    // ⚠️ `subtitle` matters as much as `series`. Hidden Gnome files the volume
    // number there — `"Ghostwater" :: "Cradle, Volume Five"` — on more editions
    // than it uses the `series` field at all (covers-and-series.md §3.1).
    series: e.series ?? [],
    publishers: e.publishers ?? [],
    publishDate: e.publish_date ?? null,
    year: yearOf(e.publish_date),
    isbn13: e.isbn_13 ?? [],
    languages: (e.languages ?? []).map((l) => (l.key ?? '').replace('/languages/', '')).filter(Boolean),
    pages: e.number_of_pages ?? null,
  };
}

/**
 * Every printing Open Library holds for one work.
 *
 * Returns `[]` for a work with no editions, and throws only on a transport or
 * HTTP error — "no editions" is a real answer and not an exception.
 */
export async function editionsOfWork(
  workKey: string,
  opts: OlFetchOptions = {},
): Promise<OlEdition[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const key = bareWorkKey(workKey);
  const url = `https://openlibrary.org/works/${key}/editions.json?limit=${opts.limit ?? 50}`;
  const res = await doFetch(url, {
    headers: { 'User-Agent': opts.userAgent ?? DEFAULT_UA },
  });
  if (!res.ok) throw new Error(`openlibrary editions ${res.status}`);
  const body = (await res.json()) as { entries?: RawEdition[] };
  // ⚠️ One-barcode-one-edition guard, defensive half: an entry keyed under
  // /works/ is a work-level record and may never be an edition source
  // (matching-thresholds.md §6 tier 1). The editions endpoint should only
  // ever return /books/ keys; if OL ever slips a work record in, dropping it
  // here is what keeps every consumer of this function honest at once.
  return (body.entries ?? [])
    .filter((e) => !/^\/?works\//.test((e.key ?? '').replace(/^\/+/, '')))
    .map(toEdition);
}

/**
 * The work record's own description — the one field `editions.json` cannot give.
 *
 * ⚠️ **`description` is two shapes in one field**, and a reader that assumes
 * either one is wrong about half of Open Library. Older records store a plain
 * string; newer ones store `{ type: '/type/text', value: '…' }`. Both are
 * ordinary, both are returned by the same endpoint, and the object form
 * stringifies to `[object Object]` — which would land in a catalog column and
 * look exactly like a description until somebody read it.
 *
 * Returns null for a 404 (a real answer — Open Library has no such work) and
 * for a record that simply carries no description. Throws only on transport or
 * an unexpected HTTP status, so a caller can trace a rung that could not be
 * ASKED separately from one that answered nothing — the distinction
 * `covers-and-series.md` §0 records costing real time on the cover sweep.
 */
export async function workDescription(
  workKey: string,
  opts: OlFetchOptions = {},
): Promise<string | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const key = bareWorkKey(workKey);
  const res = await doFetch(`https://openlibrary.org/works/${key}.json`, {
    headers: { 'User-Agent': opts.userAgent ?? DEFAULT_UA },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`openlibrary work ${res.status}`);

  const rec = (await res.json()) as { description?: string | { value?: string } };
  const raw =
    typeof rec.description === 'string' ? rec.description : (rec.description?.value ?? null);
  const text = (raw ?? '').trim();
  return text === '' ? null : text;
}

/** What an ISBN resolved to, at the work level. */
export interface OlIsbnWork {
  /** Bare work key, e.g. `OL27448W`. Null when the edition names no work. */
  workKey: string | null;
  /** The *edition* key, e.g. `OL28126666M`. */
  editionKey: string | null;
  edition: OlEdition | null;
  /** Author keys as given, e.g. `OL23919A`. Names need a second call. */
  authorKeys: string[];
}

/**
 * ISBN-13 to Open Library work key, via the edition record.
 *
 * ⚠️ **Not `/api/books`.** That endpoint is the one `resolve.ts` uses and it is
 * the better one for *metadata* — but it returns an **edition** identifier and
 * never the work, which is exactly the field this exists to get.
 *
 * ⚠️ **A resolved ISBN is not a verified book.** `isbn-ladder.md` §2 records
 * three ISBNs typed from memory that all resolved, all with full metadata and
 * correct covers, all to entirely different books — *Circe*, *Cloud Cuckoo
 * Land*, *One Piece Vol. 93*. Nothing in the response marks them, because the
 * database answered honestly and the question was wrong. The defence is that the
 * ISBN must come from somewhere trustworthy and the answer must still be checked
 * against what we already hold. An ISBN read out of the EPUB's own
 * `<dc:identifier>` is the file naming itself, which is the strongest provenance
 * available here — but it is still checked.
 *
 * Returns `null` for a 404, which is a real answer: Open Library does not have
 * that printing.
 */
export async function workKeyForIsbn(
  isbn13: string,
  opts: OlFetchOptions = {},
): Promise<OlIsbnWork | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`https://openlibrary.org/isbn/${isbn13}.json`, {
    headers: { 'User-Agent': opts.userAgent ?? DEFAULT_UA },
    redirect: 'follow',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`openlibrary isbn ${res.status}`);

  const rec = (await res.json()) as RawEdition & {
    works?: { key?: string }[];
    authors?: { key?: string }[];
  };
  const authorKeys = (rec.authors ?? [])
    .map((a) => (a.key ?? '').replace('/authors/', ''))
    .filter(Boolean);

  /*
   * ⚠️ One-barcode-one-edition guard: `redirect: 'follow'` means this request
   * can land on a WORK record when Open Library has filed the ISBN against the
   * work rather than a printing — the exact shape that minted a phantom
   * *Space Knight* with six editions from scanned barcodes on 2026-08-13. A
   * /works/ record may never be an edition source (matching-thresholds.md §6
   * tier 1), so the work key — the one thing such a record legitimately knows —
   * is returned, and `edition`/`editionKey` stay null rather than dressing an
   * aggregate up as a printing.
   */
  if (rec.key && /^works\//.test(rec.key.replace(/^\/+/, ''))) {
    return {
      workKey: bareWorkKey(rec.key),
      editionKey: null,
      edition: null,
      authorKeys,
    };
  }

  const work = rec.works?.[0]?.key ?? null;
  return {
    workKey: work ? bareWorkKey(work) : null,
    editionKey: rec.key ? bareWorkKey(rec.key).replace(/^books\//, '') : null,
    edition: toEdition(rec),
    authorKeys,
  };
}
