/**
 * The LibraryThing thingTitle rung (backfill-missing-isbns.mjs rung 2.5,
 * 2026-08 audit HIGH).
 *
 * The parser is exercised against the REAL response shapes captured live
 * 2026-08-24, and the source-stamping is checked so a LibraryThing find records
 * its own provenance rather than masquerading as 'openlibrary'.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseThingTitleIsbns } from '../lib/librarything.mjs';
import { editionSourceWriteExpr } from '../lib/backfill-safety.mjs';

// A trimmed real hit — GET /api/<key>/thingTitle/Enders%20Game, 2026-08-24.
// The live response carried 187 <isbn> elements; six are enough to prove the
// shape, including the <title>/<link>/<license> siblings the parser must ignore.
const HIT_XML = `<?xml version="1.0" encoding="utf-8"?>
<idlist><title>Title omitted per vendor terms</title><link>https://www.librarything.com/work/825739</link><isbn>0812550706</isbn><isbn>0765342294</isbn><isbn>1904233023</isbn><isbn>1250773024</isbn><isbn>185723720X</isbn><isbn>142996393X</isbn><license>By using this service you agree to its license. See</license></idlist>`;

// A real miss — GET .../thingTitle/zzqxytnonexistenttitle12345, 2026-08-24.
const MISS_XML = `<?xml version="1.0" encoding="utf-8"?>
<idlist><unknownID/></idlist>`;

// The keyless thingISBN endpoint (and bot-flagged requests) get a Cloudflare
// challenge PAGE, not XML — measured HTTP 403 on 2026-08-24.
const CLOUDFLARE_HTML = `<!DOCTYPE html>
<html class="no-js" lang="en-US"><head><title>Attention Required! | Cloudflare</title></head>
<body><div id="cf-wrapper">... isbn 9999999999999 in prose ...</div></body></html>`;

describe('parseThingTitleIsbns — the real thingTitle shapes (audit HIGH :246)', () => {
  it('a HIT returns every <isbn>, in order, and nothing else', () => {
    assert.deepEqual(parseThingTitleIsbns(HIT_XML), [
      '0812550706',
      '0765342294',
      '1904233023',
      '1250773024',
      '185723720X',
      '142996393X',
    ]);
  });

  it('a MISS (<unknownID/>) yields no ISBNs — a clean no-op, not a throw', () => {
    assert.deepEqual(parseThingTitleIsbns(MISS_XML), []);
  });

  it('a Cloudflare challenge PAGE is not an <idlist> — no ISBNs scraped from markup', () => {
    // The 13-digit number in the prose must NOT be read as an answer.
    assert.deepEqual(parseThingTitleIsbns(CLOUDFLARE_HTML), []);
  });

  it('empty / malformed / non-string bodies are clean no-ops', () => {
    assert.deepEqual(parseThingTitleIsbns(''), []);
    assert.deepEqual(parseThingTitleIsbns('<idlist>'), []); // truncated, no isbns
    assert.deepEqual(parseThingTitleIsbns('not xml at all'), []);
    assert.deepEqual(parseThingTitleIsbns(null), []);
    assert.deepEqual(parseThingTitleIsbns(undefined), []);
    assert.deepEqual(parseThingTitleIsbns(42), []);
  });

  it('tolerates whitespace and an X check-digit in the isbn body', () => {
    assert.deepEqual(
      parseThingTitleIsbns('<idlist><isbn>  185723720X  </isbn></idlist>'),
      ['185723720X'],
    );
  });
});

describe('a LibraryThing find is stamped with its own source, not openlibrary', () => {
  const lit = (v) => `'${String(v)}'`;

  it("writes source='librarything' (honest provenance), preserving manual", () => {
    const expr = editionSourceWriteExpr(lit, 'librarything');
    assert.match(expr, /WHEN source = 'manual' THEN source/);
    assert.match(expr, /ELSE 'librarything' END/);
    // The pre-fix mislabel must be gone.
    assert.doesNotMatch(expr, /'openlibrary'/);
  });
});
