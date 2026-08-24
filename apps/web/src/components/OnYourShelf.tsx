/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build — same story as
// `OtherVersions.tsx` and `RungMedia.tsx`: the test runner compiles from the
// repo root where no tsconfig sets `jsx`. Vite and tsc use the automatic runtime
// already, so the shipped bundle is byte-identical.
import type { WorkAudioEdition, WorkAudiobookHolding, WorkEbookHolding } from '../api.js';
import type { CopyView } from './Copies.js';
import type { EditionView } from './Editions.js';
import type { PeerHoldingView } from './PeerLibraries.js';
import { STATUS_LABEL } from '../lib/statuses.js';
import { deriveShelfView } from '../lib/shelf-view.js';

/**
 * "On your shelf" — the redesign's answer to the first question a book page is
 * asked: *what do I have, and where else can I get it?* Hoisted near the top,
 * above the demoted detail, it leads with ONE hero holding (the format, big,
 * with the special-edition badges that make one printing different from
 * another) and then an availability row saying whether the same book is also in
 * the audio library, the ebook pool, or a peer's library.
 *
 * ⚠️ **A SUMMARY, not a second source of truth.** The detailed rows still live
 * where they always did — `Copies`/`Editions` for what you hold, `OtherVersions`
 * for the audiobook, `EbookShadow` for the pool, `PeerLibraries` for peers. This
 * panel is the glance; those are the record. It is the same summary/detail split
 * the series page already makes (a "N on audio" chip there, the full row here).
 * All of it derives from `deriveShelfView`, so the chip and the panel below it
 * cannot come to disagree about what is held.
 */
export function OnYourShelf({
  copies,
  editions,
  audiobookHolding,
  audioEditions,
  audioEditionCount,
  ebookHolding,
  peerHoldings,
}: {
  copies: CopyView[];
  editions: EditionView[];
  audiobookHolding: WorkAudiobookHolding | null;
  audioEditions: WorkAudioEdition[];
  audioEditionCount: number | undefined;
  ebookHolding: WorkEbookHolding | null;
  peerHoldings: PeerHoldingView[];
}) {
  const { hero, availability, hasAnything } = deriveShelfView({
    copies,
    editions,
    audiobookHolding,
    audioEditions,
    audioEditionCount,
    ebookHolding,
    peerHoldings,
  });

  // Nothing owned and nothing available anywhere — say nothing, the house rule.
  if (!hasAnything) return null;

  const hasAvailability =
    availability.audio !== null || availability.ebook || availability.peers.length > 0;

  return (
    <section className="panel shelf-hero">
      <h3>On your shelf</h3>

      {hero ? (
        <div className="shelf-hero__lead">
          <span className={`shelf-hero__format shelf-hero__format--${hero.medium ?? 'unknown'}`}>
            {hero.format ?? 'Recorded'}
          </span>
          <div className="shelf-hero__facts">
            {/* The status word, when a copy backs the hero — "On the shelf",
                "Lent out". Absent when the hero is inferred from a printing with
                no copy row, where a status would be an invention. */}
            {hero.status && (
              <span className="shelf-hero__status">{STATUS_LABEL[hero.status] ?? hero.status}</span>
            )}
            {hero.badges.length > 0 && (
              <span className="shelf-hero__badges">
                {hero.badges.map((b) => (
                  <span key={b.key} className="special-badge" title={b.title}>
                    {b.label}
                  </span>
                ))}
              </span>
            )}
            {(hero.location || hero.condition) && (
              <span className="muted small">
                {[hero.location, hero.condition].filter(Boolean).join(' · ')}
              </span>
            )}
            {hero.otherHeldCount > 0 && (
              <span className="muted small">
                and {hero.otherHeldCount} more cop{hero.otherHeldCount === 1 ? 'y' : 'ies'} — see below
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="muted small">Not recorded on your shelf yet.</p>
      )}

      {hasAvailability && (
        <div className="shelf-hero__avail">
          <span className="muted small shelf-hero__avail-label">Also available:</span>
          <span className="fmts">
            {availability.audio && (
              <span className="fmt fmt--audio" title="Held in the sibling audiobook library">
                Audio
                {availability.audio.count > 1 && (
                  <span className="fmt__count"> {availability.audio.count}</span>
                )}
              </span>
            )}
            {availability.ebook && (
              <span className="fmt fmt--ebook" title="Held in the shared ebook pool">
                Ebook
              </span>
            )}
            {availability.peers.map((ph: PeerHoldingView) => (
              <span
                key={ph.peerId}
                className="fmt fmt--peer"
                title={ph.formats ? `${ph.peerLabel} holds it as ${ph.formats}` : ph.peerLabel}
              >
                {ph.detailUrl ? (
                  <a href={ph.detailUrl} target="_blank" rel="noopener noreferrer">
                    {ph.peerLabel}
                  </a>
                ) : (
                  ph.peerLabel
                )}
              </span>
            ))}
          </span>
        </div>
      )}
    </section>
  );
}
