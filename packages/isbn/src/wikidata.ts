/**
 * Wikidata as a free, keyless source of STRUCTURED series + volume — the one
 * field the ISBN rungs and the title-parse rungs cannot carry (owner, 2026-08-25:
 * "we keep missing basics like description and series").
 *
 * ## Why this exists when Open Library and Google Books are already asked
 *
 * Open Library files series only as an unstructured `subjects` tag ("Elantris (1)")
 * and never a real volume number; Google Books rarely populates `seriesInfo`.
 * Wikidata models it properly — `P179` "part of the series", with a `P1545`
 * "series ordinal" QUALIFIER — and it is CC0 (no attribution, no caching limit)
 * and needs no API key. Verified live 2026-08-25: ISBN 9780765326355 (The Way of
 * Kings) → "The Stormlight Archive", ordinal 1, in ~4.6s.
 *
 * ## ⚠️ The two hops that make the ISBN reach the series
 *
 * 1. **The ISBN resolves to an EDITION item, not the work.** `P212` (ISBN-13) is
 *    on the edition; the series (`P179`) is on the WORK. So the query follows
 *    `P629` "edition or translation of" from the edition to the work, and reads
 *    the series there. A query that looked for `P179` on the edition finds nothing.
 * 2. **Wikidata stores `P212` HYPHENATED** ("978-0-7653-2635-5"); we hold the bare
 *    13 digits. Hyphenation needs the ISBN range tables, which we do not carry, so
 *    the query matches on `REPLACE(?isbn, "-", "")` instead — measured at ~4.6s,
 *    well inside the async free-details budget. A bare-digit exact match returns
 *    nothing (confirmed), which is why the FILTER is not optional.
 *
 * Not a description source — Wikidata carries no synopsis worth using.
 */

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

/** Same order of magnitude as the measured 4.6s, with margin; the free ladder
 * runs under `waitUntil`'s ~30s, so this cannot starve it. */
export const WIKIDATA_TIMEOUT_MS = 12_000;

export interface WikidataSeries {
  /** The series NAME, resolved to an English label. */
  series: string;
  /** The `P1545` ordinal as a number, or null when the statement has no qualifier. */
  ordinal: number | null;
}

interface SparqlResults {
  results?: { bindings?: Array<{ seriesLabel?: { value?: string }; ordinal?: { value?: string } }> };
}

/**
 * Ask Wikidata for a book's series + volume by ISBN-13. Returns null for no
 * match (the common case for self-published / webnovel titles that never crossed
 * a notability bar — that is what the paid LLM rung is still for). Throws only on
 * a transport/HTTP failure, which the free ladder catches and treats as a skip.
 */
export async function lookupWikidataSeries(
  isbn13: string,
  opts: { fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<WikidataSeries | null> {
  // Only bare digits ever reach the query — no caller text is interpolated, so
  // the SPARQL below cannot be injected.
  const digits = (isbn13 ?? '').replace(/[^0-9]/g, '');
  if (digits.length !== 13) return null;

  const doFetch = opts.fetchImpl ?? fetch;
  const query =
    'SELECT ?seriesLabel ?ordinal WHERE {' +
    ` ?ed wdt:P212 ?isbn . FILTER(REPLACE(?isbn, "-", "") = "${digits}") .` +
    ' ?ed wdt:P629 ?w . ?w p:P179 ?st . ?st ps:P179 ?series .' +
    ' OPTIONAL { ?st pq:P1545 ?ordinal }' +
    ' SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }' +
    ' } LIMIT 1';

  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  const res = await doFetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      // Wikidata's policy REQUIRES a descriptive UA with contact — a generic one
      // gets blocked.
      'User-Agent': opts.userAgent ?? 'library_catalog/1.0 (household book catalog)',
    },
    signal: AbortSignal.timeout(WIKIDATA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);

  const data = (await res.json()) as SparqlResults;
  const b = data.results?.bindings?.[0];
  const series = (b?.seriesLabel?.value ?? '').trim();
  if (!series) return null;
  // ⚠️ If the label service failed the name comes back as a bare Q-id
  // ("Q7766706") — a machine id is not a series name, so reject rather than file
  // a shelf named after one.
  if (/^Q\d+$/.test(series)) return null;

  const raw = b?.ordinal?.value;
  const ordinal = raw != null && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
  return { series, ordinal };
}
