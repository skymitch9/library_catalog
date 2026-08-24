import type { z } from 'zod';

/**
 * SHADOW logging for the three CREATE schemas that are not yet `.strict()`
 * (KNOWN_ISSUES KI-6).
 *
 * ## The problem this measures, not the one it fixes
 *
 * `createCopySchema`, `createWorkSchema` and `createEditionSchema` accept a body
 * carrying an unknown key with a **201** and silently strip it, while every
 * `update*` counterpart is `.strict()` and answers **400** naming the key. The
 * split is deliberate today: flipping the creates to strict is an enforcement
 * change on a live write path, and the estate's rule is that those roll out
 * shadow-first — off → shadow → enforce — never as a side effect of a feature.
 *
 * This is the SHADOW rung. When a create body carries a key the schema does not
 * model, it logs one structured `would_reject` line naming the field, the route
 * and the schema — and then the request proceeds and 201s exactly as before.
 * Nothing is refused. The point is to measure, over real traffic, how many
 * bodies a later `.strict()` flip *would* start rejecting — the false-positive
 * count KI-6 says must be **0** before the flip. A count above 0 names the
 * caller to fix first (a stray key from the wishlist ask, the scan-approve flow,
 * or an importer under `scripts/`), rather than 400ing it by surprise.
 *
 * ## Where it runs
 *
 * Called AFTER `safeParse` succeeds — the only population a strict flip would
 * change. A body that already fails validation is a 400 with or without strict,
 * so it is not a would-reject; only a body that is accepted TODAY and carries an
 * extra key would flip to a refusal, and that is exactly what is logged.
 */

/** One structured shadow record — a body a `.strict()` flip would reject. */
export interface WouldReject {
  shadow: 'would_reject';
  /** The route the create came in on, e.g. `POST /api/copies`. */
  route: string;
  /** The schema that does not model the key, e.g. `createCopySchema`. */
  schema: string;
  /** The unmodelled key. */
  field: string;
}

/** The default sink: one `console.warn` line per would-reject, greppable by prefix. */
function warn(record: WouldReject): void {
  console.warn('[strict-shadow] would-reject', JSON.stringify(record));
}

/**
 * Log a `would_reject` line for every key in `body` that `schema` does not
 * model, then return them. Returns `[]` (and logs nothing) for a clean body,
 * and for a non-object body — a create whose body is not a JSON object never
 * parses, so it never reaches here with one.
 *
 * @param log injectable sink; defaults to `console.warn`. Tests pass a capture.
 */
export function shadowStrictCreate(
  schema: z.AnyZodObject,
  body: unknown,
  route: string,
  schemaName: string,
  log: (record: WouldReject) => void = warn,
): WouldReject[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];

  const known = new Set(Object.keys(schema.shape));
  const records: WouldReject[] = [];
  for (const field of Object.keys(body as Record<string, unknown>)) {
    if (known.has(field)) continue;
    const record: WouldReject = { shadow: 'would_reject', route, schema: schemaName, field };
    log(record);
    records.push(record);
  }
  return records;
}
