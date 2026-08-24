/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build. The full explanation is at
// the top of `OtherVersions.tsx`, which needed it first and for the same reason:
// the test runner compiles from the repo root, where no tsconfig sets `jsx`.
// Vite and tsc both already use the automatic runtime, so the shipped bundle is
// byte-identical.
import type { AudiobookRef, SeriesGap, SeriesLadderEntry } from '../api.js';
import { formatLabel, mediumLabel } from '../lib/formats.js';

/**
 * **What form we hold a rung in** — the chips on the ladder, and the vocabulary
 * the summary sentence above it is built from.
 *
 * ## Why this is its own file (2026-08-23)
 *
 * Extracted from `SeriesDetailPage.tsx`, unchanged, when migration 0390's
 * recording count arrived and needed pinning by a test. `SeriesDetailPage`
 * imports `api` — a VALUE, which reaches `lib/firebase.ts` and `import.meta.env`
 * — so importing that page from `node --test` throws before a single assertion
 * runs. Everything here takes its types with `import type` (erased at runtime)
 * and its two helpers from `lib/formats`, so the file is importable outside a
 * browser and `apps/web/test/audio-edition-chip.test.ts` can exercise the real
 * chip rather than a restatement of it.
 *
 * It is also a real unit rather than a test-shaped one: the chip and the
 * sentence are two renderings of ONE vocabulary, and they must agree. Keeping
 * `signatureOf`, `mediumPhrase` and `Media` in one file is what makes a change
 * to that vocabulary a single edit.
 *
 * ⚠️ The page still owns the DECISION of which to show — `signatureShared`
 * feeding `{!uniformMedia && <Media …>}`. Only the vocabulary moved.
 */

/**
 * The media a rung covers, as one comparable string.
 *
 * `audio` joins `physical` and `ebook` here and only here — it is a display
 * concern. Nothing in `@lc/core` counts three media; see `MEDIUM_LABEL`.
 */
export function signatureOf(entry: SeriesLadderEntry): string {
  /*
   * ⚠️ An uncertain audiobook match must NOT read as a certain one.
   *
   * The per-rung chip already hedges a containment match with a `?`, but that
   * chip is suppressed when every rung agrees — and folding `matchedVia` away
   * here made every rung agree. The result was the flat claim this whole
   * feature was built to avoid: `/series/Tamer: King of Dinosaurs` read "All 5
   * held as ebooks and on audio" when in truth all five had matched the SAME
   * generic series-level row by containment, and book 11 probably has no
   * audiobook at all. Found in a browser; nothing else would have caught it,
   * because both the chip and the sentence are individually correct.
   */
  const audio = entry.audiobook == null ? [] : [audioToken(entry.audiobook)];
  return [...entry.media, ...audio].join('+');
}

/**
 * The audio half of a rung's signature — hedge and recording count in one token.
 *
 * ⚠️ **The COUNT has to be in the signature or it can never be seen.** The chips
 * are suppressed the moment every held rung agrees (`{!uniformMedia && <Media
 * …>}` on the ladder), and *Elantris* is the exact shape that breaks: one held
 * volume, so its own signature is trivially "shared", so its chips vanish — and
 * with them the "2" the owner asked for on 2026-08-23. Folding the count away
 * here is the same mistake folding `matchedVia` away was, one paragraph up, and
 * it fails the same way: silently, and only visible in a browser.
 *
 * ⚠️ **A count of RECORDINGS, not of rungs.** Nothing downstream of this
 * function measures the series — `Holdings`, `completeness.onAudio` and
 * `gapsCountingAudio` are each fed from `@lc/core` and from the per-work map,
 * both of which stay one entry per work. A volume owned in two recordings is
 * still one rung held on audio, and this token must never make it two.
 */
export function audioToken(audiobook: AudiobookRef): string {
  // The hedge comes first so the existing vocabulary ('audio', 'audio?') is
  // unchanged for every book in the catalog that owns one recording — which,
  // measured 2026-08-23, is every one of them.
  const base = audiobook.matchedVia === 'containment' ? 'audio?' : 'audio';
  return audiobook.editionCount > 1 ? `${base}×${audiobook.editionCount}` : base;
}

/** True when every held rung gives the same answer — and there is one to give. */
export function signatureShared(held: SeriesLadderEntry[]): string | null {
  if (held.length === 0) return null;
  const first = signatureOf(held[0]!);
  if (first === '') return null;
  return held.every((e) => signatureOf(e) === first) ? first : null;
}

/**
 * The chips on one rung.
 *
 * ⚠️ Deliberately NOT the `.mark` class. `.mark` is `position: absolute` because
 * its first home was the corner of a cover, and every inline use of it since has
 * had to undo that — styles.css carries the warning and three overrides proving
 * it. A new inline badge starts inline.
 */
export function Media({ entry }: { entry: SeriesLadderEntry }) {
  const audio = entry.audiobook;
  if (entry.media.length === 0 && !audio) return null;

  return (
    <span className="fmts">
      {entry.media.map((m) => (
        <span
          key={m}
          className={`fmt fmt--${m}`}
          // The coarse word is what fits; the exact formats are the tooltip, so
          // "Ebook" can still tell you it is an EPUB and a Kindle licence.
          title={entry.editions
            .filter((e) => (m === 'physical') === PHYSICAL.has(e.format))
            .map((e) => formatLabel(e.format))
            .join(' · ')}
        >
          {mediumLabel(m)}
        </span>
      ))}
      {audio && (
        <span
          className="fmt fmt--audio"
          title={
            `In the audiobook catalog as "${audio.title}"` +
            (audio.viaAlias ? `, matched through the alias "${audio.viaAlias}"` : '') +
            (audio.matchedVia === 'containment' ? ' — matched on a partial title' : '') +
            // ⚠️ The tooltip cannot name the recordings: the ladder loads one
            // row per work (the `audiobook_holding` view), and the titles and
            // narrators live in `audioEditions`, which only the WORK PAGE asks
            // for. Saying how many, and where to see which, beats either
            // guessing or making every series page N queries deeper.
            (audio.editionCount > 1
              ? ` — the household owns ${audio.editionCount} recordings of this; open the book to see which`
              : '')
          }
        >
          {mediumLabel('audio')}
          {/* A containment match is a weaker claim than an exact one and says so.
              `matching.ts` opens with three wrong matches the sibling project
              shipped, and containment is the rung that produced them. */}
          {audio.matchedVia === 'containment' && '?'}
          {/* The owner's ask, 2026-08-23: the NUMBER, not a bare mark. Silent at
              one, which is every book in the catalog today — a "1" on every
              chip is the label nobody reads. ⚠️ It reads as a count of
              RECORDINGS of this one volume, never of rungs; the summary line
              above the ladder is where series totals are said. */}
          {audio.editionCount > 1 && (
            <span className="fmt__count"> {audio.editionCount}</span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * `Media`'s counterpart for a rung we do NOT hold — the audio half only, since
 * a gap by definition has no printing or ebook here to badge.
 *
 * ⚠️ Two different `matchedVia` vocabularies feed the two functions, and they
 * are not interchangeable. `Media` reads `entry.audiobook.matchedVia` off
 * migration 0010's `audiobook_holding` — one title matched against one work,
 * hedged as `'containment'`. This reads `gap.audio.matchedVia` off migration
 * 0090/0110's series-level match — a rung with no work at all, hedged as
 * `'fold'`. Both hedges render the same `?`, because that is the one thing a
 * glance needs; `gapAudioLabel` below is where the two are told apart in
 * words.
 */
export function GapMedia({ gap }: { gap: SeriesGap }) {
  if (!gap.audio) return null;
  const hedged = gap.audio.matchedVia === 'fold';
  return (
    <span className="fmts">
      <span
        className="fmt fmt--audio"
        title={
          hedged
            ? `Filed under "${gap.audio.audiobookSeries}" in the audiobook catalog — only the series name connects the two catalogs`
            : `You own this on audio, as "${gap.audio.title}"`
        }
      >
        {mediumLabel('audio')}
        {hedged && '?'}
      </span>
    </span>
  );
}

/**
 * Mirrors `PHYSICAL_FORMATS`. Used to split a chip's tooltip here, and to pick
 * a chip class in the series page's "Owned more than once" panel — ⚠️ **never to
 * count.** Every number about the shelf comes from `@lc/core`.
 */
export const PHYSICAL = new Set(['hardcover', 'paperback', 'mass_market']);

/**
 * A medium as it reads in the middle of a sentence.
 *
 * ⚠️ Separate from `MEDIUM_LABEL`, which is the one-word form the chips wear.
 * Reusing the chip word gave "All 3 held ebook." — read in a browser and fixed
 * there, which is the only place it would ever have been noticed.
 */
export function mediumPhrase(medium: string): string {
  if (medium === 'physical') return 'in print';
  if (medium === 'ebook') return 'as ebooks';
  if (medium === 'audio') return 'on audio';
  // The hedged form. A containment match is a guess at which audiobook row a
  // volume means, and the sentence has to say so rather than round it up.
  if (medium === 'audio?') return 'possibly on audio';
  /*
   * The counted forms — `audioToken`'s `audio×2` / `audio?×2`.
   *
   * ⚠️ Reached only when EVERY held rung carries the same count, which is the
   * one case the summary line replaces the chips. "All 3 held as ebooks and on
   * audio (2 recordings each)" — *each*, because this sentence is speaking for
   * every rung at once, and dropping that word turns a per-volume fact into a
   * series total that would contradict the ladder above it.
   */
  const counted = /^(audio\??)×(\d+)$/.exec(medium);
  if (counted) {
    const hedge = counted[1] === 'audio?' ? 'possibly on audio' : 'on audio';
    return `${hedge} (${counted[2]} recordings each)`;
  }
  return mediumLabel(medium);
}

