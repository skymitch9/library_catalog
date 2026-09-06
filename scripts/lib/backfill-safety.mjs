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
 * 🔴 **Is this a crowdfunded / collector's printing the owner HOLDS?**
 * (Owner ruling 2026-09-05 18:29 Phoenix — see `docs/info/isbn-ladder.md` §7.6.)
 *
 * ⚠️ **This deliberately does what `declaresNoIsbn` above deliberately does NOT,
 * and the difference is an owner decision, not a change of mind.** That function
 * says of itself:
 *
 * > *Deliberately narrow: it matches a STATEMENT about an absent ISBN, not the
 * > mere words "Kickstarter" or "Collector's Edition". A crowdfunded printing may
 * > well have a real ISBN, and refusing every exclusive would turn one
 * > silent-wrong-fill into a silent-never-fill.*
 *
 * That reasoning was correct on **2026-09-05 at 13:00**, when nobody knew whether
 * these objects carry ISBNs. It stopped being correct at **18:29**, when the
 * owner answered the question about the physical objects, verbatim:
 *
 * > **"For the kickstarters we have in stock the ISBNs are recorded if they
 * > exist."**
 *
 * 🔴 **That converts the risk this function's sibling was avoiding into a
 * measurement.** On a crowdfunded printing the owner holds, `isbn13 IS NULL` is
 * not an unknown waiting to be filled — it is his ANSWER, recorded at entry: the
 * object has no ISBN, because if it had one he would have typed it. So the
 * "silent-never-fill" this widening costs is not a loss at all; there is nothing
 * to fill. Filling it is the loss, and it is exactly what happened on
 * 2026-08-20 to 13 rows.
 *
 * ⚠️ **The narrow guard is KEPT, not replaced.** `declaresNoIsbn` refuses a row
 * that states no ISBN exists — true of any printing, in anyone's hands. This one
 * refuses a row that is a crowdfunded/exclusive OBJECT, and it is sound only
 * because of a fact about THIS household's data-entry habit. Two different
 * claims, deliberately two functions, so a future session widening or narrowing
 * one does not silently move the other.
 *
 * Matches the campaign vocabulary in production `edition_name`s (every one of
 * these is a real value, not a guess): *Kickstarter · Indiegogo · BackerKit ·
 * crowdfunded · campaign · collector's · limited · numbered · exclusive · tier ·
 * Grimoire*. ⚠️ Word-boundary anchored on purpose — an unanchored `tier` matches
 * *Fron**tier***, and a guard that fires on a title is worse than no guard.
 *
 * ⚠️ It reads only what the row SAYS. A `NULL` `edition_name` with a `NULL` note
 * is not crowdfunded evidence and must not match — that is edition **#507** (*The
 * Book of Mormon*), the one ordinary printing among the 43 rows the 2026-08-20
 * run filled, and the reason it is excluded from the tier C repair.
 *
 * 🔴 **INSTANCE ASYMMETRY, stated rather than hidden.** The ruling is the OWNER's,
 * about the OWNER's stock. This function is instance-agnostic, so a `--friend`
 * run applies his habit to padhard, where nobody has asked. Measured 2026-09-05
 * on `library-catalog-2nd`: **6** rows match this vocabulary and all 6 already
 * CARRY an ISBN — five *"Bn exclusive"* and two *"Collector edition"* deluxe
 * limited printings — so none is a candidate today, and a retail exclusive
 * genuinely does get its own trade ISBN. It is left instance-agnostic on purpose:
 * the failure mode is a REFUSAL TO WRITE, it is printed with its reason on every
 * run, and refusing to invent an identifier in somebody else's catalogue is the
 * safe direction to be wrong in. Revisit if padhard ever grows a campaign row
 * with no ISBN that she wants filled.
 *
 * @param {string | null | undefined} editionName
 * @param {string | null | undefined} note
 * @returns {string | null} the phrase that refused it, or null to proceed
 */
export function isCrowdfundedPrinting(editionName, note) {
  const PATTERNS = [
    /\bkickstarter\b/i,
    /\bindiegogo\b/i,
    /\bbackerkit\b/i,
    /\bcrowdfund\w*/i,
    /\bcampaign\b/i,
    /\bcollector'?s?\b/i,
    /\blimited\b/i,
    /\bnumbered\b/i,
    /\bexclusive\b/i,
    /\btier\b/i,
    /\bgrimoire\b/i,
  ];
  for (const field of [editionName, note]) {
    if (!field) continue;
    const s = String(field);
    for (const re of PATTERNS) {
      const m = re.exec(s);
      if (m) return m[0].trim();
    }
  }
  return null;
}

/**
 * 🔴 **Does this printing's own record NAME the ISBNs that apply to it?**
 * (`docs/TODO.md` #321, measured 2026-09-06 — the third narrow guard.)
 *
 * ⚠️ **The row that got past the other two, and why neither could catch it.**
 * Edition **#321**, work 220 *Words of Radiance* — the Dragonsteel leatherbound,
 * repaired as tier A on 2026-09-06 01:23:49Z — carries the `edition_name`:
 *
 * > *"Leatherbound (two-volume set: Vol 1 ISBN 9781938570308, Vol 2 ISBN
 * > 9781938570315)"*
 *
 *   - `declaresNoIsbn` misses it because the row does **not** state that no ISBN
 *     exists. It states the opposite: two of them, by number.
 *   - `isCrowdfundedPrinting` misses it because *"leatherbound"* is a **binding
 *     material, not campaign vocabulary** — and it was deliberately NOT added to
 *     that guard's word list, because whether a leatherbound is *"a kickstarter
 *     we have in stock"* is a question about a physical object and those belong
 *     to the owner.
 *
 * Measured in the 2026-09-06 01:44Z production dry run: with both other guards
 * in force the writer still proposed `9781399622073` (Orion, a UK trade
 * hardcover) for this row — the very ISBN the owner had nulled two hours
 * earlier. Without a third guard the repair had a half-life of one sweep.
 *
 * ## The claim this makes, which is narrower than either sibling
 *
 * **A row whose own `edition_name`/`note` names an ISBN has already stated which
 * identifiers apply to it.** It is not a statement that no ISBN exists
 * (`declaresNoIsbn`) and not a claim about the physical object
 * (`isCrowdfundedPrinting`) — it is the row *disagreeing with the proposal in
 * advance*. Whoever typed those numbers had the book in hand; a search result is
 * not better evidence than that, and `#321` is the case where the row and the
 * ladder contradict each other outright.
 *
 * ⚠️ **A third function, not a widening of either existing one.** Same reasoning
 * `isCrowdfundedPrinting` gives for not being folded into `declaresNoIsbn`: the
 * three rest on three different claims, and a future session must be able to
 * move one without silently moving the others.
 *
 * ## Deliberately narrow — the word AND a number, in the same field
 *
 * It fires only where the field literally contains the word *ISBN* **and** an
 * identifier-shaped run of digits directly after it. Neither half alone:
 *
 *   - *"ISBN unknown"* or *"check the ISBN"* names none → proceeds.
 *   - A bare number with no `ISBN` beside it — a year, a print run, a price,
 *     a Kickstarter tier number — is not a named identifier → proceeds.
 *
 * ⚠️ It does **not** verify a check digit, and that is on purpose: the claim is
 * *"this row has already stated its identifiers"*, which a mistyped ISBN states
 * just as loudly as a valid one. Checking the digit would import
 * `packages/core/src/isbn.ts` into a leaf `.mjs` that must keep running under
 * plain `node` (see `fix-foreign-isbns-2026-09-05.mjs`), and would buy a
 * refusal-to-refuse in exactly the case a person most needs to be told.
 *
 * ⚠️ **Overlap with `declaresNoIsbn` is expected and harmless.** The slipcase
 * wording — *"Volume of the slipcase set (set ISBN 9781368053099); no
 * per-volume ISBN recorded"* — matches BOTH. Guard 1 runs first, so those rows
 * keep being reported under their existing reason and the counts already in
 * `docs/info/isbn-ladder.md` §7 do not move.
 *
 * @param {string | null | undefined} editionName
 * @param {string | null | undefined} note
 * @returns {string | null} the named identifier that refused it, or null to proceed
 */
export function namesAnIsbn(editionName, note) {
  // `ISBN`, `ISBNs`, `ISBN-13`, `ISBN 10` — the word as anything writes it.
  const ISBN_WORD = /\bisbns?(?:[-\s]?1[03])?\b/gi;
  for (const field of [editionName, note]) {
    if (!field) continue;
    const s = String(field);
    ISBN_WORD.lastIndex = 0;
    let m;
    while ((m = ISBN_WORD.exec(s)) !== null) {
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 48);
      /*
       * Skip the punctuation — and the few words — an importer or a person puts
       * between the word and the number ("ISBN: 978…", "set ISBN is 978…"),
       * then take the leading run of digits, allowing the single spaces and
       * hyphens a printed ISBN is grouped with.
       *
       * ⚠️ The filler window is short and lazy, but it is NOT what keeps this
       * narrow — the **ten-digit minimum** is. A sentence that mentions an ISBN
       * and then a year, a print run or a price ("ISBN unknown, printed 2019,
       * 1 of 500") has no run of ten digits anywhere near the word, so it
       * proceeds to the ladder as it should.
       */
      const run = /^[^0-9]{0,24}?((?:\d[\s-]?){9,16}[\dXx])/.exec(after);
      if (!run) continue;
      const compact = run[1].replace(/[\s-]/g, '').toUpperCase();
      // 978/979 + 10 is an ISBN-13; nine digits and a check character is an
      // ISBN-10. Take the leading identifier only — two ISBNs separated by a
      // space would otherwise concatenate into one 26-digit non-answer.
      if (/^97[89]\d{10}/.test(compact)) return compact.slice(0, 13);
      if (/^\d{9}[\dX]/.test(compact)) return compact.slice(0, 10);
    }
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
