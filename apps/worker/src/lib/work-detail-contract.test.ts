/**
 * The response CONTRACT test — the one that would have caught the 2026-08-24
 * outage. A refactor dropped `editions` from `GET /api/works/:id`; the work page
 * `.find()`s over it and every page went blank, and NOTHING failed because the
 * field was in no test.
 *
 * This asserts the worker's response builder (`work-detail-response.ts`) carries
 * EVERY field the frontend actually consumes — and it derives that list from the
 * frontend itself rather than hand-maintaining a copy that would drift. The
 * source of truth is `deriveWorkView` in `apps/web/src/lib/work-view.ts`: every
 * `detail.<field>` it reads is a field the response MUST supply.
 *
 * Present-but-null vs absent is the distinction that matters (a null that
 * travels is a legitimate value; a missing key is the outage), so the check is
 * `hasOwnProperty`, and the fixture deliberately sets some fields null.
 *
 * ⚠️ Proven to go RED: remove any required key from `buildWorkDetailResponse`
 * and this test fails naming that key. That proof is in the guards' commit /
 * the task report.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildWorkDetailResponse, type WorkDetailParts } from './work-detail-response.js';

// `fileURLToPath(import.meta.url)` takes the string form — avoids `new URL`,
// whose DOM type clashes with node:url under the worker's DOM lib.
const here = dirname(fileURLToPath(import.meta.url));
const workViewSrc = readFileSync(join(here, '../../../web/src/lib/work-view.ts'), 'utf8');
const catalogSrc = readFileSync(join(here, '../routes/catalog.ts'), 'utf8');

/**
 * The fields the work page reads out of the response, derived from the
 * `detail.<field>` accesses in `deriveWorkView`. This is the CONSUMER contract.
 */
function consumedFields(src: string): Set<string> {
  // Scan only the deriveWorkView function body — the one place `detail.` is read.
  const start = src.indexOf('export function deriveWorkView');
  assert.ok(start >= 0, 'deriveWorkView must exist — the derivation depends on it');
  const body = src.slice(start);
  const fields = new Set<string>();
  for (const m of body.matchAll(/\bdetail\.([a-zA-Z_]\w*)/g)) fields.add(m[1]!);
  return fields;
}

/** Fields the `WorkDetail` interface marks optional (`name?:`) — not required on the wire. */
function optionalFields(src: string): Set<string> {
  const fields = new Set<string>();
  for (const m of src.matchAll(/(\w+)\?:/g)) fields.add(m[1]!);
  return fields;
}

/** A full, real-shaped set of parts — some null, to prove null-present passes. */
function parts(): WorkDetailParts {
  return {
    work: { id: 1, title: 'X', series: null },
    editions: [],
    copies: [],
    reading: null, // present-but-null must satisfy the contract
    watches: [],
    audiobookHolding: null,
    audioEditions: [],
    audioEditionCount: 2,
    ebookHolding: null,
    peerHoldings: [],
    universe: null,
  };
}

describe('work-detail contract — the worker response carries every field the page reads', () => {
  const consumed = consumedFields(workViewSrc);
  const optional = optionalFields(workViewSrc);
  const required = [...consumed].filter((f) => !optional.has(f));

  it('the derivation is not vacuous — it found the fields the page is built on', () => {
    // A regex that silently matched nothing would make every assertion below
    // pass for the wrong reason. Pin the floor.
    for (const f of [
      'work',
      'editions',
      'copies',
      'reading',
      'watches',
      'peerHoldings',
      'universe',
      'ebookHolding',
      'audiobookHolding',
      'audioEditions',
    ]) {
      assert.ok(consumed.has(f), `deriveWorkView must read detail.${f}`);
    }
    assert.ok(consumed.size >= 10, `expected >= 10 consumed fields, found ${consumed.size}`);
    assert.ok(optional.has('audioEditionCount'), 'audioEditionCount is optional on the wire');
  });

  it('every REQUIRED field the page consumes is a key in the built response', () => {
    const response = buildWorkDetailResponse(parts());
    const missing = required.filter(
      (f) => !Object.prototype.hasOwnProperty.call(response, f),
    );
    assert.deepEqual(
      missing,
      [],
      `the /api/works/:id response is missing field(s) the work page requires: ${missing.join(', ')}. ` +
        `Add them to buildWorkDetailResponse — this is the 2026-08-24 outage class.`,
    );
  });

  it('a null-valued field still counts as present (present ≠ absent)', () => {
    const response = buildWorkDetailResponse(parts());
    assert.equal(response.reading, null);
    assert.ok(Object.prototype.hasOwnProperty.call(response, 'reading'));
    assert.ok(Object.prototype.hasOwnProperty.call(response, 'ebookHolding'));
  });

  /**
   * ⚠️ One level DOWN from the outage this file was written for, and added for
   * the same reason (owner 2026-09-02: *"we should also add being able to set
   * the covers for the alternate editions too"*).
   *
   * `editions` being present is no longer enough: the shelf reads
   * `edition.cover_url` off each row to paint a printing's own jacket, and its
   * identity ladder reads `edition_name` / `edition_kind` / `publisher` /
   * `published_year`. Dropping one of those COLUMNS from `EDITION_COLS` would
   * blank the feature with no error anywhere — the 2026-08-24 failure shape at
   * column granularity. There is no live-D1 harness in this repo, so the pin is
   * on the SELECT itself, which is the one place a column can be lost.
   */
  it('⚠️ EDITION_COLS still selects cover_url — the per-edition covers depend on it', () => {
    const editionsSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/db/src/editions.ts'),
      'utf8',
    );
    const cols = editionsSrc.match(/const EDITION_COLS = `([\s\S]*?)`/)?.[1] ?? '';
    assert.ok(cols, 'EDITION_COLS must still be a template literal this test can read');
    for (const col of [
      'cover_url',
      'edition_name',
      'edition_kind',
      'collects',
      'publisher',
      'published_year',
    ]) {
      assert.ok(
        new RegExp(`\\b${col}\\b`).test(cols),
        `EDITION_COLS must select ${col} — the shelf's edition identity and cover read it`,
      );
    }
  });

  it('the route builds its response THROUGH the builder — no inline literal to drift', () => {
    // If a future refactor inlines c.json({...}) again, the builder (and this
    // test) stop protecting the route. Pin that the handler still routes through it.
    assert.match(
      catalogSrc,
      /buildWorkDetailResponse\(/,
      'GET /api/works/:id must call buildWorkDetailResponse, not an inline object',
    );
  });
});
