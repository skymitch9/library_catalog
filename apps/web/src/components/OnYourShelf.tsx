/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build — same story as
// `OtherVersions.tsx` and `RungMedia.tsx`: the test runner compiles from the
// repo root where no tsconfig sets `jsx`. Vite and tsc use the automatic runtime
// already, so the shipped bundle is byte-identical.
import type { WorkAudioEdition, WorkAudiobookHolding, WorkEbookHolding } from '../api.js';
import type { CopyView } from './Copies.js';
import type { EditionView } from './Editions.js';
import type { PeerHoldingView } from './PeerLibraries.js';
import { editionKindLabel } from '../lib/formats.js';
import { STATUS_LABEL } from '../lib/statuses.js';
import { deriveShelfView, type ShelfCopy } from '../lib/shelf-view.js';

/**
 * "On your shelf" — the redesign's answer to the first question a book page is
 * asked: *what do I have, and where else can I get it?*
 *
 * ## The owner's model (2026-08-24): the EDITION LIST *is* the shelf
 *
 * There is no single "hero" any more. The shelf is a list of **editions** — the
 * versions of the book that exist — one row each, and it is **never empty**.
 * Every row is marked **Owned** (you hold a copy, or it is a file you have) or
 * **Wanted** (it exists, you have no copy); a book you own nothing of still shows
 * its primary version as Wanted. Copies **nest under** the edition they are a
 * copy of, so the common one-book-one-printing case is exactly one clean row and
 * a second physical copy of the same printing is a nested line, not a rival list.
 *
 * ⚠️ **A SUMMARY, not a second source of truth.** The full editable record still
 * lives where it always did — `Editions` for the printings, `Copies` for what you
 * hold, `OtherVersions` for the audiobook, `EbookShadow` for the pool,
 * `PeerLibraries` for peers — now split across the edit box's **Editions** and
 * **Copies** tabs. This panel is the glance; those are the record. All of it
 * derives from `deriveShelfView`, so the shelf here and the tabs below it cannot
 * come to disagree about what is held.
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
  const { rows, availability } = deriveShelfView({
    copies,
    editions,
    audiobookHolding,
    audioEditions,
    audioEditionCount,
    ebookHolding,
    peerHoldings,
  });

  const hasAvailability =
    availability.audio !== null || availability.ebook || availability.peers.length > 0;

  return (
    <section className="panel shelf">
      <h3>On your shelf</h3>

      <ul className="plain shelf-rows">
        {rows.map((row) => (
          <li key={row.key}>
            <div className="shelf-row">
              {/* The version, as a format pill — the one-glance "what is this".
                  Filled accent when you own it; a quiet outline when it is only
                  wanted, so the eye lands on what is actually on the shelf. */}
              <span
                className={`shelf-row__format shelf-row__format--${row.medium ?? 'unknown'}${
                  row.owned ? '' : ' shelf-row__format--wanted'
                }`}
              >
                {row.format ?? 'This book'}
              </span>
              <span
                className={`shelf-row__own shelf-row__own--${row.owned ? 'owned' : 'wanted'}`}
                title={
                  row.owned
                    ? 'A copy is on your shelf, or it is a file you hold'
                    : 'This version exists; you have no copy of it yet'
                }
              >
                {row.owned ? 'Owned' : 'Wanted'}
              </span>
              {row.kind && <span className="shelf-row__kind">{editionKindLabel(row.kind)}</span>}
              {row.badges.length > 0 && (
                <span className="shelf-row__badges">
                  {row.badges.map((b) => (
                    <span key={b.key} className="special-badge" title={b.title}>
                      {b.label}
                    </span>
                  ))}
                </span>
              )}
            </div>

            {/* The vendor's own name for the printing, and what it binds — the
                two things that tell one format's two printings apart. */}
            {(row.editionName || row.collects) && (
              <p className="muted small shelf-row__meta">
                {[row.editionName, row.collects ? `contains ${row.collects}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}

            {/* Copies nest UNDER the edition. One copy: its facts inline, no
                second bullet. More than one of the same printing: a short list,
                which is the only case where a copy earns its own line. */}
            {row.copies.length === 1 && <CopyFacts copy={row.copies[0]!} />}
            {row.copies.length > 1 && (
              <ul className="plain shelf-row__copies">
                {row.copies.map((c) => (
                  <li key={c.id}>
                    <CopyFacts copy={c} withStatus />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

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

/**
 * The facts about one nested copy — status (when it is not a plain on-shelf
 * copy), who has it, where it lives, its condition. Rendered as one muted line
 * so a copy stays visually subordinate to the edition it hangs off.
 *
 * ⚠️ The person is shown only when the server sent a name (`personName`): a
 * redacted or unrecorded person both arrive null, and the panel cannot tell them
 * apart, so it says nothing rather than "nobody has it" — the same rule
 * `Copies.tsx` documents at length.
 */
function CopyFacts({ copy, withStatus }: { copy: ShelfCopy; withStatus?: boolean }) {
  const person =
    copy.personName && copy.status === 'lent'
      ? `Lent to ${copy.personName}`
      : copy.personName && copy.status === 'borrowed'
        ? `Borrowed from ${copy.personName}`
        : copy.personName && copy.status === 'sold'
          ? `Sold to ${copy.personName}`
          : null;

  const parts = [
    // A single owned copy needs no "On the shelf" — the Owned pill already said
    // it. A lent/borrowed one always names its state, because that is the point.
    withStatus || copy.status !== 'owned' ? (STATUS_LABEL[copy.status] ?? copy.status) : null,
    person,
    copy.location,
    copy.condition,
  ].filter(Boolean);

  // Per-copy badges appear only in the multi-copy list (`withStatus`), where they
  // say WHICH copy is signed; the single-copy case already shows them on the row
  // above, so repeating them here would be noise.
  const showBadges = withStatus && copy.badges.length > 0;
  if (parts.length === 0 && !showBadges) return null;

  return (
    <p className="muted small shelf-row__copy">
      {parts.join(' · ')}
      {showBadges && (
        <span className="shelf-row__copy-badges">
          {copy.badges.map((b) => (
            <span key={b.key} className="special-badge" title={b.title}>
              {b.label}
            </span>
          ))}
        </span>
      )}
    </p>
  );
}
