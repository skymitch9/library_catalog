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

/**
 * ⚠️ **Wikidata's policy requires a contact in the User-Agent**, and this string
 * had none (F14, 2026-08-25) — nor did the one the free ladder passes in.
 * WDQS blocks by UA when it throttles, and a block surfaces here as a thrown
 * `wikidata 403`: a rung that is permanently skipped and reported as one line
 * in `skipped`, which is a slow, quiet way to lose a source.
 *
 * Same spelling as `scripts/backfill-openlibrary-ids.mjs` — one identity for
 * this catalog across every free API it asks, not a second one invented here.
 */
export const WIKIDATA_UA =
  'library_catalog/1.0 (private household catalog; nbaslamking@gmail.com)';

/** Same order of magnitude as the measured 4.6s, with margin; the free ladder
 * runs under `waitUntil`'s ~30s, so this cannot starve it. */
export const WIKIDATA_TIMEOUT_MS = 12_000;

export interface WikidataSeries {
  /** The series NAME, resolved to an English label. */
  series: string;
  /** The `P1545` ordinal as a number, or null when the statement has no qualifier. */
  ordinal: number | null;
}

interface SparqlBinding {
  seriesLabel?: { value?: string };
  ordinal?: { value?: string };
}

interface SparqlResults {
  results?: { bindings?: SparqlBinding[] };
}

/**
 * How many `P179` statements are read before one is chosen.
 *
 * ⚠️ **It used to be `LIMIT 1` with no `ORDER BY`, which is an arbitrary pick**
 * (F8, 2026-08-25). SPARQL result order is unspecified without one, and a great
 * many books in this catalogue's shape carry two `P179` statements — the series
 * and a wider publication sequence. The `OPTIONAL { ?st pq:P1545 ?ordinal }`
 * compounds it: the statement that won could be the one WITHOUT the ordinal
 * while another had both, and `writeFreeValues` only ever writes into a blank —
 * so the first arbitrary answer is permanent.
 *
 * Ten is enough for any real book and still one small response.
 */
const MAX_SERIES_STATEMENTS = 10;

/** A machine id is not a series name — see the reject below. */
const BARE_Q_ID = /^Q\d+$/;

/** The `P1545` value as a number, or null when there is no usable qualifier. */
function ordinalOf(binding: SparqlBinding): number | null {
  const raw = binding.ordinal?.value;
  return raw != null && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}

/**
 * The statement to believe, out of everything Wikidata returned.
 *
 * ⚠️ **Prefer the one that HAS an ordinal.** A series plus a volume number is
 * strictly more than a series alone, and where a book belongs to both a series
 * and a broader sequence it is the series that carries the ordinal — the
 * sequence usually does not. Ties go to the first, which the query has already
 * ordered deterministically.
 *
 * Bindings whose label is empty or a bare Q-id are dropped rather than being
 * allowed to win: the label service failing must not name a shelf `Q7766706`,
 * and with several statements in hand there may well be a good one behind it.
 */
export function pickSeriesStatement(bindings: readonly SparqlBinding[]): WikidataSeries | null {
  const usable = bindings
    .map((b) => ({ series: (b.seriesLabel?.value ?? '').trim(), ordinal: ordinalOf(b) }))
    .filter((b) => b.series !== '' && !BARE_Q_ID.test(b.series));
  if (usable.length === 0) return null;
  return usable.find((b) => b.ordinal !== null) ?? usable[0]!;
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
    // ⚠️ ORDERED, and it did not used to be (F8): statements that HAVE an
    // ordinal first, then by the series entity so the pick is stable between
    // runs. `?series` and not `?seriesLabel` — the label comes from the SERVICE
    // and is not a sound sort key. The real choosing is `pickSeriesStatement`;
    // this only makes the WINDOW deterministic.
    ' } ORDER BY DESC(BOUND(?ordinal)) ?series' +
    ` LIMIT ${MAX_SERIES_STATEMENTS}`;

  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  const res = await doFetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      // ⚠️ Wikidata's policy REQUIRES a descriptive UA WITH A CONTACT — a
      // generic one gets blocked, and the block would arrive here as a thrown
      // `wikidata 403`: a rung permanently skipped, reported as one line in
      // `skipped`. The address is the one the backfill scripts already
      // identify this catalog with (`scripts/backfill-openlibrary-ids.mjs`);
      // one spelling, not two.
      'User-Agent': opts.userAgent ?? WIKIDATA_UA,
    },
    signal: AbortSignal.timeout(WIKIDATA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);

  const data = (await res.json()) as SparqlResults;
  return pickSeriesStatement(data.results?.bindings ?? []);
}
