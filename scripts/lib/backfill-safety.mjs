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

/**
 * ⚠️ **Does this printing's own record already SAY it has no ISBN?**
 * (Incident 2026-08-20, measured 2026-09-05 — see
 * `docs/info/isbn-ladder.md` §7.)
 *
 * The ISBN backfill picks the OLDEST edition of a work with no ISBN anywhere and
 * fills it. On this catalogue that edition is almost always a **special
 * printing** — a Kickstarter exclusive, a leatherbound, a subscription-box
 * hardcover, a volume of a slipcase set — and several of those carry a
 * hand-written statement that no ISBN exists on the object. `isbn13 IS NULL` on
 * such a row is a **recorded fact**, not a gap to fill, and the guard the write
 * had (`AND isbn13 IS NULL`) cannot tell the two apart.
 *
 * Measured: **43 rows** were filled by the 2026-08-20 run and **42 of them** were
 * special printings; 20 of those said so in their own `edition_name` or `note`.
 *
 * The two wordings in production, both written by other tooling:
 *   - `"Volume of the slipcase set (set ISBN …); no per-volume ISBN recorded"`
 *     (`edition_name`)
 *   - `"no ISBN printed on this edition (owner-verified)"` /
 *     `"No barcode printed on this copy (owner-verified)"` (`note`, since
 *     migration 0460 split it out of the name)
 *
 * Deliberately narrow: it matches a STATEMENT about an absent ISBN, not the mere
 * words "Kickstarter" or "Collector's Edition". A crowdfunded printing may well
 * have a real ISBN, and refusing every exclusive would turn one silent-wrong-fill
 * into a silent-never-fill.
 *
 * @param {string | null | undefined} editionName
 * @param {string | null | undefined} note
 * @returns {string | null} the phrase that refused it, or null to proceed
 */
export function declaresNoIsbn(editionName, note) {
  for (const field of [editionName, note]) {
    if (!field) continue;
    const s = String(field);
    const m =
      /no per-volume ISBN recorded/i.exec(s) ??
      /no ISBN (?:is )?(?:printed|recorded|assigned)[^.;]*/i.exec(s) ??
      /no barcode (?:is )?printed[^.;]*/i.exec(s);
    if (m) return m[0].trim();
  }
  return null;
}

/**
 * 🔴 **Is this ISBN a printing of the book in the language the catalogue holds?**
 * (Incident 2026-08-20 — the reason this exists.)
 *
 * Rung 1 reads `doc.isbn` off an Open Library **work** search result, which is
 * *"an array of ALL isbns from all editions of this work"* — every printing in
 * every language — and the old `pickBestIsbn13` took the first one whose check
 * digit passed. The title gate is computed against the **work's** title and so
 * reports `sim 1.00` for a translation, because Open Library files a translation
 * under the English work. Measured: it filed *La mer des monstres* (Albin
 * Michel, French) on *The Sea of Monsters*, *Ostatni Olimpijczyk* (Jaguar,
 * Polish) on *The Last Olympian*, and a Korean printing on *Understanding the
 * Old Testament* — the last at `sim 1.00`.
 *
 * Two independent signals, and the ORDER matters: an attested language beats a
 * registration group, because the group only says who *registered* the prefix.
 * A `979-8` (KDP) or `978-1` self-published book is English; a `978-3` one is
 * not, whatever the record omits.
 *
 * @param {{ isbn13: string, languages?: readonly string[] | null, expected?: string }} opts
 *   `languages` are Open Library `/isbn/<isbn>.json` codes (`['fre']`) or a
 *   Google Books `volumeInfo.language` (`'en'`), in whatever form the rung has.
 * @returns {'ok' | 'foreign' | 'unknown'}
 */
export function isbnLanguageVerdict({ isbn13, languages = null, expected = 'eng' }) {
  const want = expected.slice(0, 2).toLowerCase();
  const codes = (languages ?? []).map((l) => String(l).toLowerCase().slice(0, 2)).filter(Boolean);
  if (codes.length > 0) return codes.includes(want) ? 'ok' : 'foreign';

  // No attested language. Fall back to the ISBN registration group, which is
  // decisive only in one direction: a non-English group is a refusal, an English
  // group is not a confirmation.
  const s = String(isbn13 ?? '');
  if (!/^97[89]\d{10}$/.test(s)) return 'unknown';
  const rest = s.slice(3);
  if (s.startsWith('979')) {
    // 979-8 is the US (KDP) block; 979-10 France, 979-11 Korea, 979-12 Italy.
    return rest.startsWith('8') ? 'unknown' : 'foreign';
  }
  // 978-0 and 978-1 are the English-language group; everything else is another
  // country's group and cannot be a printing of an English-language book.
  return /^[01]/.test(rest) ? 'unknown' : 'foreign';
}
