/**
 * Leaf module: the small judgements about a detail VALUE that two paths make.
 *
 * ⚠️ It exists because there are now two ways a value reaches `work`, and they
 * must agree about what a value MEANS:
 *
 * | Path | Where |
 * |---|---|
 * | a paid finding, auto-applied | `research-run.ts` → `applyFinding` |
 * | a free rung, written directly | `free-details.ts` → `writeFreeFindings` |
 *
 * `research-run.ts` owns the ladder's caller, so the ladder cannot import from
 * it without a cycle. Rather than let the second path grow its own copy of a
 * rule the first already had — which is exactly how `audiobook_catalog` ended up
 * splitting author strings four different ways (see `@lc/core`'s `titles.ts`) —
 * the rule moved down here, where both import it and neither owns it.
 *
 * No I/O, no D1, no `@lc/db`. Keep it that way: the moment this file needs a
 * database it stops being importable from both sides.
 */

/**
 * The printed designation a source QUOTED, or null if it just gave a number.
 *
 * ⚠️ The distinction the owner's 2026-08-19 rule turns on, and the reason
 * `series_index_display` is not simply derived from the sort value. `2` is a
 * position in a ladder; `Volume 07` is a claim about what is physically printed
 * on a particular printing. Only the second is worth recording, and only
 * because somebody found it written somewhere — this catalog never makes one
 * up. See `seriesIndexDisplayFrom` in `@lc/core`, which is the ingest route's
 * legacy default and explicitly NOT the semantics, and
 * `docs/info/volume-numbers.md`, which is the permanent answer.
 *
 * Two refusals, and they are different:
 *
 * - **A bare number, however written, is not a printed form.** `"2"`, `"2.5"`,
 *   `" 7 "` all return null — they are the sort value said out loud.
 * - **A string with no digit in it at all is not a volume designation**, and
 *   `parseVolumeNumber` would have refused it anyway.
 */
export function printedFormIn(raw: string | number | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  if (Number.isFinite(Number(text))) return null;
  return /\d/.test(text) ? text : null;
}

/**
 * The same question asked of a **source's own label**, where a position has
 * already been read out of it.
 *
 * ## ⚠️ These two functions are NOT interchangeable, and the difference is real
 *
 * They differ on exactly one case — `"Volume Five"`, `"Volume XI"` — and they
 * differ because the two paths read a number with **different parsers**:
 *
 * | | Reads the number with | Accepts |
 * |---|---|---|
 * | `printedFormIn` (paid findings) | `asIndex` in `research-run.ts` | digits only |
 * | `quotedDesignation` (free rungs) | `parseVolumeNumber` in `@lc/core` | digits, **words**, **Roman** |
 *
 * `printedFormIn` requires a digit because without one `asIndex` would have
 * refused the value anyway, so keeping the string would leave a printed form
 * beside an empty sort. `parseVolumeNumber` has no such limit: three spellings
 * are all in this household's own library — *"Book 10"*, *"Book One"* and
 * *"Volume XI"*, which is how *Rise of the Weakest Summoner* is printed — and
 * Hidden Gnome files *"Cradle, Volume Five"* in the subtitle on more editions
 * than it uses the `series` field at all (`covers-and-series.md` §3.1).
 * Demanding a digit here would throw away the printed designation on precisely
 * the books that carry one most reliably.
 *
 * ⚠️ **Call this only where the sort has already been established.** The caller
 * having a number is what stands in for the digit test; on its own this
 * function would happily return *"Prequel"*, which is a label with no position.
 *
 * The one rule both share, and the one that matters: **a bare number is not a
 * printed form.** `2` is the sort value said out loud, and writing it into
 * `series_index_display` would be this catalog inventing a designation — the
 * thing the owner's 2026-08-19 rule exists to stop.
 */
export function quotedDesignation(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  return Number.isFinite(Number(text)) ? null : text;
}
