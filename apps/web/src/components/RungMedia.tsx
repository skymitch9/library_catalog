/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build. The full explanation is at
// the top of `OnYourShelf.tsx`, which carries it for the same reason:
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
   * ⚠️ **HISTORY, kept because the mechanism it describes is still live.**
   *
   * This token used to carry the hedge, and the reason was a real bug: the
   * chips are suppressed when every rung agrees, so folding `matchedVia` away
   * here made every rung agree and `/series/Tamer: King of Dinosaurs` read
   * "All 5 held as ebooks and on audio" when all five had matched the SAME
   * generic series-level row by containment. Found in a browser; nothing else
   * would have caught it, because both the chip and the sentence were
   * individually correct.
   *
   * ⚠️ **The hedge came OUT of the vocabulary on 2026-09-03** (owner: *"make
   * all of those question ones show the audio even if not sure … we can confirm
   * if it's right in the edit menu later"*, approved 15:03) — see `audioToken`.
   * The suppression mechanism this comment warns about is unchanged, so the
   * lesson holds for the NEXT thing anyone is tempted to fold away here: a
   * distinction dropped from the signature is a distinction that disappears
   * from the page the moment a series is uniform, silently, and only in a
   * browser. The *Tamer* row itself is stale today and is shown lighter for
   * that reason.
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
  /*
   * ⚠️ **A containment match now reads `audio`, not `audio?`** — owner ask
   * 2026-09-03, approved 15:03 (*"can we make all of those question ones show
   * the audio even if not sure and then we can confirm if it's right in the
   * edit menu later"*).
   *
   * ⚠️ **The hedge did not disappear, it MOVED**, and migration 0010's rule
   * ("shown, never hidden") is what makes that distinction load-bearing. It now
   * lives in the chip's tooltip, in the work page's provenance sentence, and —
   * the part that makes the change honest — in a place where it can be SETTLED:
   * the edit box's Audio tab writes a verdict to `audiobook_match_review`
   * (migration 0450). A hedge nobody can act on is a question the app asks
   * forever; measured the same day, all 8 of MAIN's containment matches were
   * right and the one wrong match was already stale.
   *
   * The COUNT stays in the signature for the reason the header gives — nothing
   * about that changed.
   */
  const base = 'audio';
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
            // ⚠️ The hedge, in the ONE place it still lives on a ladder — and it
            // now names the way out. Owner 2026-09-03: the chip shows the audio
            // flatly, and the doubt is settled in the edit box (migration 0450)
            // rather than printed on every rung for ever.
            (audio.matchedVia === 'containment'
              ? ' — matched on a partial title; confirm it in ✎ Edit this book'
              : '') +
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
          {/* ⚠️ No `?` since 2026-09-03. A containment match IS a weaker claim
              than an exact one — `matching.ts` opens with three wrong matches
              the sibling project shipped, and containment is the rung that
              produced them — but the owner asked for the recording to be shown
              anyway and the doubt to be settled once, in the edit box
              (migration 0450), rather than re-asked on every rung for ever.
              The weakness is still SAID: it is in this chip's `title` above. */}
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
 * `'fold'`. `gapAudioLabel` is where the two are told apart in words.
 *
 * ⚠️ **Neither renders a `?` any more** (owner, 2026-09-03). The tooltip still
 * says what connects the two catalogs, and the caption under the rung still
 * hedges in words — but a `fold` rung's doubt is settled on the SERIES page
 * (migration 0110's "Same series — I own these"), not here and not in the book's
 * edit box, because a gap rung has no work to hang a per-recording verdict on.
 * That is why this half of the change touches display only.
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
            ? `Filed under "${gap.audio.audiobookSeries}" in the audiobook catalog — only the series name connects the two catalogs; confirm it on this series' page`
            : `You own this on audio, as "${gap.audio.title}"`
        }
      >
        {mediumLabel('audio')}
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
  // ⚠️ ONE wording for both tokens since 2026-09-03. `audioToken` no longer
  // emits `'audio?'`, but the branch is KEPT rather than deleted: `mediumPhrase`
  // is exported and takes a plain string, so a caller holding an old token must
  // get the current words rather than falling through to `mediumLabel` and
  // printing "audio?" in the middle of a sentence. The hedge did not vanish —
  // it moved to the chip tooltip and to the edit box's Audio tab, where it can
  // actually be settled (migration 0450).
  if (medium === 'audio' || medium === 'audio?') return 'on audio';
  /*
   * The counted forms — `audioToken`'s `audio×2` (and the retired `audio?×2`).
   *
   * ⚠️ Reached only when EVERY held rung carries the same count, which is the
   * one case the summary line replaces the chips. "All 3 held as ebooks and on
   * audio (2 recordings each)" — *each*, because this sentence is speaking for
   * every rung at once, and dropping that word turns a per-volume fact into a
   * series total that would contradict the ladder above it.
   */
  const counted = /^audio\??×(\d+)$/.exec(medium);
  if (counted) {
    return `on audio (${counted[1]} recordings each)`;
  }
  return mediumLabel(medium);
}

