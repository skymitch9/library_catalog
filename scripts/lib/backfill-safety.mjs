/**
 * Small pure helpers shared by the backfill scripts, extracted so they can be
 * unit-tested (the scripts themselves run on import and cannot be imported by a
 * test). Each one guards a real 2026-08 audit finding.
 */

/**
 * Which Anthropic key a paid `--llm` rung must read, by INSTANCE (audit HIGH,
 * `scripts/backfill-missing-isbns.mjs:431`).
 *
 * ⚠️ Custody rule, not a convenience: a `--friend` run bills padhard's books to
 * padhard's own key (`ANTHROPIC_API_KEY_FRIEND_SAM`), never silently to the
 * OWNER's `ANTHROPIC_API_KEY`. The one sanctioned exception is
 * `--llm-key-from=main`, the owner's explicit "run these on MY key" — it names
 * the key loudly and only ever applies to a `--friend` run. Absent the flag the
 * rung reads the friend key and (if empty) refuses to fall back. Mirrors the
 * sibling cover script's `defaultKeyName`/`overridden` logic.
 *
 * @param {{ friend?: boolean, keyFrom?: string | null }} opts
 * @returns {{ keyName: string, overridden: boolean }}
 */
export function llmKeyName({ friend = false, keyFrom = null } = {}) {
  const defaultKeyName = friend ? 'ANTHROPIC_API_KEY_FRIEND_SAM' : 'ANTHROPIC_API_KEY';
  const overridden = friend && keyFrom === 'main';
  return { keyName: overridden ? 'ANTHROPIC_API_KEY' : defaultKeyName, overridden };
}

/**
 * Read `--llm-key-from=<value>` from an argv array. Returns the value or null.
 * @param {string[]} argv
 */
export function readLlmKeyFrom(argv) {
  for (const a of argv) {
    const m = /^--llm-key-from=(.+)$/.exec(a);
    if (m) return m[1];
  }
  return null;
}

/**
 * The edition `source` to write when a backfill fills an ISBN (audit HIGH,
 * `scripts/backfill-missing-isbns.mjs:517`).
 *
 * ⚠️ `'manual'` outranks everything and is NEVER overwritten automatically
 * (`packages/core` EDITION_SOURCES). The old write set `source` unconditionally
 * alongside `isbn13`, so a hand-created (`manual`) edition that gained an ISBN
 * from a free rung was silently demoted to `'openlibrary'`. This returns a SQL
 * expression that keeps `manual` and otherwise records the incoming source, so
 * the ISBN is still written but the provenance of a person's edition survives.
 *
 * The `'llm'` rung is recorded as `'research'` (the value the schema allows),
 * matching the script's existing mapping.
 *
 * @param {(v: unknown) => string} lit  the d1 `lit()` SQL-literal helper
 * @param {string} incomingSource       'openlibrary' | 'googlebooks' | 'llm' | …
 * @returns {string} a SQL fragment for the `source = …` assignment's RHS
 */
export function editionSourceWriteExpr(lit, incomingSource) {
  const mapped = incomingSource === 'llm' ? 'research' : incomingSource;
  // Never demote a person's 'manual' edition; write the incoming source only
  // over a non-manual (automated) provenance.
  return `CASE WHEN source = 'manual' THEN source ELSE ${lit(mapped)} END`;
}
