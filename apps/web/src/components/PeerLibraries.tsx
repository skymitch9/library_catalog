/**
 * "In other libraries" — shows which peer catalogs also hold this book.
 *
 * Renders nothing when no peers hold it (the common case). When one or more
 * do, renders a compact section linking to each peer's copy. Same structural
 * pattern as `OtherVersions` (which shows the audiobook catalog holding).
 *
 * Data comes from the `peer_holding` table (migration 0370), populated by
 * the peer push mechanism (`lib/peer-push.ts`).
 */

export interface PeerHoldingView {
  peerId: string;
  peerLabel: string;
  detailUrl: string | null;
  formats: string | null;
}

export function PeerLibraries({ holdings }: { holdings?: PeerHoldingView[] }) {
  if (!holdings || holdings.length === 0) return null;

  return (
    <section className="section peer-libraries">
      <h3 className="section__title">In other libraries</h3>
      <ul className="peer-list">
        {holdings.map((ph) => (
          <li key={ph.peerId} className="peer-list__item">
            <span className="peer-list__icon">📚</span>
            {ph.detailUrl ? (
              <a href={ph.detailUrl} target="_blank" rel="noopener noreferrer" className="peer-list__link">
                {ph.peerLabel}
              </a>
            ) : (
              <span>{ph.peerLabel}</span>
            )}
            {ph.formats && (
              <span className="peer-list__format">
                ({ph.formats.split(',').join(' + ')})
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
