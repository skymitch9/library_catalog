# Scan metadata fill — direct-fill APIs before the paid LLM (research + strategy)

> **Audience:** Claude sessions + the owner. **Status:** TRACKED — RESEARCH +
> STRATEGY, no build yet.
> **Last verified: 2026-08-25.** Live-tested claims are marked ✅ (requests made
> against Open Library and Wikidata during the research); everything else is from
> the vendor's own API docs. Google Books was NOT live-tested (the research
> sandbox hit a pre-exhausted shared quota — not our key).

## The problem (owner, 2026-08-25)

Scanning a barcode ends up calling the paid Claude LLM for almost every book to
get the **description** and **series (+ volume)**. Those are the two fields that
consistently fall through. Book-metadata APIs exist — we should exhaust them
before the LLM. Current rungs (`packages/isbn/src/resolve.ts`): Open Library
(free, gappy) → Google Books (needs `GOOGLE_BOOKS_API_KEY`, else 429) → LLM.

## ⚠️ The biggest win costs nothing: we're asking Open Library the wrong question

✅ **Measured live.** Our rung 1 calls `openlibrary.org/api/books?jscmd=data`,
which returns **no `description` at all** — even when the book's *work* record
has a full synopsis. The fix is to change WHAT we ask, not add a vendor:

```
GET https://openlibrary.org/search.json?q=isbn:9780765326355&fields=key,title,series,description
→ "description": "Widely acclaimed for his work completing Robert Jordan's Wheel of Time saga…"
```
(Same from `/isbn/{isbn}.json` → `works[0].key` → `/works/{OLID}.json`.)

So before any new integration: resolve ISBN → work → read the work's
`description`. Likely cuts LLM-for-description calls on its own.

⚠️ Open Library's **series is a dead end for the volume number**: it appears only
as an unstructured `subjects` tag (`"series:Stormlight Archive"`), with
false-positive risk (Mistborn returned two competing tags) and **never** an
index. ✅ Coverage gap is real: *He Who Fights with Monsters* (LitRPG, self-pub
origin) returned zero results — our catalog skews exactly this way.

## Recommended rung order (before the LLM)

1. **Open Library — fixed** to read the WORK description (above). Free.
2. **Google Books** — already rung 2. ⚠️ **First confirm `GOOGLE_BOOKS_API_KEY`
   is actually set as a secret** (anonymous calls 429). Also read
   `volumeInfo.seriesInfo` off the response we already fetch — `bookDisplayNumber`
   (general) / `volumeSeries[].orderNumber` (Collection/Omnibus only). Free but
   series rarely populated.
3. ✅ **BUILT 2026-08-25** — `packages/isbn/src/wikidata.ts`, wired as the LAST free rung of `apps/worker/src/lib/free-details.ts`.
   **Wikidata SPARQL — the dedicated series/volume rung.** The only source with a
   structured, sourced, *ordinal-numbered* series field, CC0 (cleanest terms of
   anything), free, no key. Misses self-pub/indie — that's fine, the LLM stays
   for the residue.
4. ✅ **BUILT 2026-08-25** — `packages/isbn/src/hardcover.ts`, asked BEFORE the Wikidata rung (the genre/indie skew gets first crack); token on BOTH instances; live call verified once (Way of Kings). ⚠️ Hardcover also lists universes (The Cosmere) as `book_series` — see TODO for the universe filter.
   **Hardcover.app GraphQL — description + series + volume in ONE call.** Free
   API key, 5,000 req/day, community skew (ex-Goodreads genre/LitRPG readers) is
   the best available match for our content. Best single addition if we only add
   one vendor.
5. **LLM** — last resort, for the indie residue nothing above covers.

## Source specifics

**Wikidata** — `https://query.wikidata.org/sparql` (no key, CC0). ⚠️ The ISBN
resolves to an *edition* item, which does NOT carry the series; you must hop
`P629` ("edition or translation of") to the *work*, then read `P179` ("part of
the series") with the `P1545` ("series ordinal") **qualifier**. ✅ Verified
end-to-end on Way of Kings (ISBN `P212` → edition `Q126707688` → `P629` → work
`Q2136877` → `P179` "The Stormlight Archive", `P1545`="1"):
```sparql
SELECT ?seriesLabel ?ordinal WHERE {
  ?edition wdt:P212 "978-0-7653-2635-5" .
  ?edition wdt:P629 ?work .
  ?work p:P179 ?stmt . ?stmt ps:P179 ?series .
  OPTIONAL { ?stmt pq:P1545 ?ordinal }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
```
~60s query timeout, fair-use throttle, no daily cap. Not a description source.

**Hardcover.app** — `https://api.hardcover.app/v1/graphql`, `Bearer` (free
self-service key at `hardcover.app/account/api`). Series is a join table:
`editions(where:{isbn_13:{_eq:"…"}}){ book { description book_series { position series { name } } } }`.
`position` is a `float8` — handles `1.5` novellas. Free tier 5,000/day, 60/min.
Terms allow personal use + caching; only bars training public/commercial LLMs on
the data.

**Google Books** — `volumeInfo.seriesInfo` on the volume we already fetch. ⚠️
**ToS caching clause** ([developers.google.com/terms](https://developers.google.com/terms)):
no permanent copies / cache beyond the cache header. We already cache Google
Books in D1, so this is a **pre-existing** compliance question on rung 2 — logged
in [`KNOWN_ISSUES`](../KNOWN_ISSUES.md). Low enforcement risk for a private
non-commercial household catalog, but the clause is explicit.

## Dead ends — do NOT build against these

| Source | Why not |
|---|---|
| Goodreads API | Retired Dec 2020, keys revoked, no path back |
| LibraryThing (thingISBN / Common Knowledge) | API **disabled since ~2022**, still down Dec 2024, no ETA. Was CC-BY-SA and genuinely good for series — re-check periodically; revisit if it returns |
| ISBNdb | Paid; has `synopsis` but **no `series` field at all** — pays for the easy half, nothing on the hard one |
| OCLC/WorldCat Search API | Needs an institutional OCLC subscription — unobtainable for a household |
| Amazon PA API | Needs an Associates account with sustained sales; no dedicated series field |
| BookBrainz | Real CC0 series modelling, but API still on `api.test.bookbrainz.org` (beta) and dataset small/young — re-evaluate in ~a year |

## Best free source for SERIES specifically (the owner's actual question)

**Wikidata** (P179 + P1545 via the P629 edition→work hop) — the only free source
with a structured ordinal. If indie/LitRPG coverage matters more than provenance,
**Hardcover** is more practically useful (description + series in one call, community
skew matches our catalog), at the cost of a free key and one more HTTP call.

## If/when we build this

Rungs live in `packages/isbn/src/resolve.ts` (the ISBN ladder) and the details
sweep (`apps/worker` research routes) fills gaps. A build would: (1) fix the OL
work-description read; (2) confirm the Google Books key; (3) add a Wikidata rung
and a Hardcover rung as `resolve.ts` steps returning `{description, series,
seriesIndex}` before the LLM; (4) cache results per the existing pattern; (5)
respect each source's terms. **No work started — this is the map for it.**
