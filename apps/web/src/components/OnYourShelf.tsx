/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build — same story as
// `RungMedia.tsx` and `ContentNotes.tsx`: the test runner compiles from the
// repo root where no tsconfig sets `jsx`. Vite and tsc use the automatic runtime
// already, so the shipped bundle is byte-identical.
import type { WorkAudioEdition, WorkAudiobookHolding, WorkEbookHolding } from '../api.js';
import type { CopyView } from './Copies.js';
import type { EditionView } from './Editions.js';
import type { PeerHoldingView } from './PeerLibraries.js';
import { Cover } from './Cover.js';
import { editionKindLabel } from '../lib/formats.js';
import { STATUS_LABEL } from '../lib/statuses.js';
import { deriveShelfView, type ShelfCopy, type ShelfRow } from '../lib/shelf-view.js';

/**
 * ⚠️ `rowCatalogHref` is GONE, and its absence is the point.
 *
 * It used to decide here which rows open a sibling catalog. Since the
 * 2026-09-02 merge the derivation carries `row.href`, because an AUDIO row now
 * links whether or not it is owned — a stale match is still worth following —
 * and because a per-recording row must search for the RECORDING's title, which
 * this component never had. One place decides; see `shelf-view.ts`.
 */

/**
 * Where a shelf headline stops being a word and becomes a sentence, and so steps
 * down a size. Measured against production 2026-09-02: of the 129 printings that
 * carry an `edition_name`, the mean is 47 characters and 68 run past this — so
 * the long case is the MAJORITY of named editions, not an edge case.
 */
const LONG_LABEL = 34;

/**
 * Signed, shown EITHER WAY (owner 2026-09-02: *"and if its signed or not"*).
 *
 * ⚠️ A badge that only ever lights cannot answer "or not" — the reader cannot
 * tell an unsigned copy from one nobody has looked at. So an owned physical row
 * says which it is, and the negative wears a quiet dashed pill so a shelf of
 * ordinary paperbacks is not covered in decoration.
 *
 * ⚠️ **It reports the RECORD.** `copy.is_signed` is `NOT NULL DEFAULT 0`
 * (migration 0430), so "Not signed" means *nothing has marked this copy signed*,
 * which is what the tooltip says rather than claiming the object is unsigned.
 *
 * Local to this file on purpose — the same call `Copies.tsx` makes about its own
 * `SPECIAL_TOGGLES`: a second caller is the moment it moves somewhere shared.
 */
function SignedChip({ signed }: { signed: boolean }) {
  return (
    <span
      className={`special-badge special-badge--signed${signed ? '' : ' special-badge--off'}`}
      title={
        signed
          ? 'Recorded as a signed copy'
          : 'Nothing on this copy is marked signed — the record says so, which is not the same as having checked the book'
      }
    >
      {signed ? '✍ Signed' : 'Not signed'}
    </span>
  );
}

/**
 * The little emoji the mockup renders on each shelf thumbnail (owner: "the on
 * your shelf with the rendering and little emojis"). Chosen by the row's coarse
 * medium first, then the physical format word, so an Audiobook is 🎧, an ebook
 * 📱, a hardcover 📗 and a paperback 📖 — a glance tells the medium apart before
 * a word is read. Purely presentational: the derivation is untouched.
 */
function rowEmoji(row: ShelfRow): string {
  if (row.medium === 'audio') return '🎧';
  if (row.medium === 'ebook') return '📱';
  if (row.medium === 'physical') {
    const f = (row.format ?? '').toLowerCase();
    if (f.includes('hard')) return '📗';
    if (f.includes('paper') || f.includes('mass')) return '📖';
    return '📚';
  }
  return '📚';
}

/**
 * "On your shelf" — the redesign's answer to the first question a book page is
 * asked: *what do I have, and where else can I get it?*
 *
 * ## The owner's model (2026-08-24, corrected): the shelf is WHAT YOU HAVE
 *
 * There is no single "hero". The shelf is a **copy-driven** list — the formats
 * you own (from your held copies), plus the ebooks/audiobooks you hold — one row
 * each, and it is **never empty**. Every row is marked **Owned** (you hold a
 * copy, or it is a file you have) or **Wanted** (a wishlist copy wants it);
 * ⚠️ **an owned book is never Wanted** — the previous link-driven derivation made
 * exactly that mistake (work 493). Copies **nest under** the format they are a
 * copy of, so the common one-book-one-copy case is one clean row and a second
 * copy of the same format is a nested line, not a rival list. A book with
 * genuinely nothing shows one neutral "not on your shelf" slot — never a
 * fabricated Wanted. See `deriveShelfView` for the whole model.
 *
 * ## What the row LEADS with (owner, 2026-09-02)
 *
 * > "actually none of the edition stuff shows in the page anymore. i see we have
 * > it on the shelf but not what each edition is. lets have the editions listed
 * > in the on your shelf version with ebook and audio but instead of paperback
 * > replace that with the edition info and if its signed or not"
 *
 * A physical row now leads with the **edition** (`row.label`) and drops the
 * binding to the line below (`row.meta`) — but ⚠️ **only where a printing
 * actually resolves**; where none does, the format word keeps the headline. Both
 * strings are composed in `deriveShelfView`, so this component chooses no words
 * of its own and the test can pin what a row says. Signed is answered **either
 * way** on an owned physical row (`SignedChip`); the other three 0430 attributes
 * stay badges that light only when set. Ebook, audiobook and wanted rows are
 * untouched.
 *
 * ## THE list, in per-format sections (owner, 2026-09-02)
 *
 * > "on your shelf should be the main with other editions available under their
 * > given section. so if its a second physical there should be 2 under physical."
 *
 * The **"Other versions available"** panel is gone from the work page and its
 * contents live here, under **Physical / Ebook / Audio** headings. Three things
 * this component now renders that it did not:
 *
 *   1. **`available` rows** — a printing you neither own nor want, lighter and
 *      labelled, ⚠️ never mistakable for a holding: no Owned pill, no signed
 *      chip, a dashed ground, and a state pill that says which of *"Available"*
 *      or *"May be yours"* the catalog can honestly claim.
 *   2. **`row.notes`** — the narrator, the series-spelling disagreement, and
 *      ⚠️ the **provenance sentence** migration 0010 requires be shown and never
 *      hidden. It is the half of the retired panel that was NOT redundant, and
 *      losing it in the merge was the one failure to avoid.
 *   3. **`row.coverUrl`** — the printing's own jacket where it has one (owner:
 *      *"add being able to set the covers for the alternate editions too"*), or
 *      the audiobook catalog's. Absent, the emoji thumb stands exactly as before
 *      — the work cover is NOT borrowed onto a printing.
 *
 * ⚠️ **A SUMMARY, not a second source of truth.** The full editable record still
 * lives where it always did — `Editions` for the printings and `Copies` for what
 * you hold, under the edit box's ONE merged **Editions & copies** tab, plus
 * `EbookShadow` for the pool and `PeerLibraries` for peers. This panel is the
 * glance; those are the record. All of it derives from `deriveShelfView`, so the
 * shelf here and the tabs below it cannot come to disagree about what is held.
 */
export function OnYourShelf({
  title,
  copies,
  editions,
  audiobookHolding,
  audioEditions,
  audioEditionCount,
  ebookHolding,
  peerHoldings,
  ourSeries = null,
}: {
  /** The work's title — the search token for a sibling-catalog link. */
  title: string;
  copies: CopyView[];
  editions: EditionView[];
  audiobookHolding: WorkAudiobookHolding | null;
  audioEditions: WorkAudioEdition[];
  audioEditionCount: number | undefined;
  ebookHolding: WorkEbookHolding | null;
  peerHoldings: PeerHoldingView[];
  /**
   * This work's OWN series spelling — came across with the "Other versions
   * available" merge (owner 2026-09-02). An audio row says the two catalogs
   * disagree only when they actually do.
   */
  ourSeries?: string | null;
}) {
  const { sections, audioCountLine, availability } = deriveShelfView({
    title,
    copies,
    editions,
    audiobookHolding,
    audioEditions,
    audioEditionCount,
    ebookHolding,
    peerHoldings,
    ourSeries,
  });

  const hasAvailability = availability.peers.length > 0;

  return (
    <section className="panel shelf">
      <h3>On your shelf</h3>

      {/* One section per medium — the owner's "under their given section". A
          heading over a single card is deliberate: the point of the sections is
          that "is there a second physical?" is answerable without reading. */}
      {sections.map((section) => (
        <div className="shelf-section" key={section.key}>
          {section.title && <h4 className="shelf-section__head">{section.title}</h4>}
          {/* The owner's 2026-08-23 ask, SAY THE NUMBER — it followed the
              audiobook rows here from the panel that used to carry it. */}
          {section.key === 'audio' && audioCountLine && (
            <p className="muted small">{audioCountLine}</p>
          )}
          <ul className="plain shelf-rows">
            {section.rows.map((row) => (
              <li key={row.key}>
                <ShelfCard row={row} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* ⚠️ "Also available" is now PEERS ONLY. Your own audiobook/ebook holdings
          became Owned shelf rows above (owner model) — only OTHER people's
          libraries remain an "also available elsewhere" footnote. */}
      {hasAvailability && (
        <div className="bd-avail-row">
          <span className="bd-avail-label">Also available:</span>
          {availability.peers.map((ph: PeerHoldingView) => (
            <span
              key={ph.peerId}
              className="bd-avail"
              title={ph.formats ? `${ph.peerLabel} holds it as ${ph.formats}` : ph.peerLabel}
            >
              🏠{' '}
              {ph.detailUrl ? (
                <a href={ph.detailUrl} target="_blank" rel="noopener noreferrer">
                  {ph.peerLabel}
                  {ph.formats ? ` · ${ph.formats}` : ''}
                </a>
              ) : (
                <>
                  {ph.peerLabel}
                  {ph.formats ? ` · ${ph.formats}` : ''}
                </>
              )}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One card on the shelf — a holding, a wish, or a version that merely exists.
 *
 * Extracted from the render when the sections landed (2026-09-02): the same
 * markup now appears under three headings instead of once in a flat list, and a
 * card that is copy-pasted per section is a card that will drift per section.
 *
 * ⚠️ **An `available` card must never read as a holding.** Three things keep
 * them apart, and they are belt, braces and a third thing on purpose: a
 * different ground (`bd-hold--available`, a dashed rule), a state pill that says
 * *"Available"* or *"May be yours"* rather than *"Owned"*, and **no signed
 * chip** — signing is a fact about an object, and there is no object here.
 */
function ShelfCard({ row }: { row: ShelfRow }) {
  // Signed is rendered by `SignedChip` as a two-state answer, so the positive
  // badge the derivation also produces would say it twice.
  const badges = row.signed == null ? row.badges : row.badges.filter((b) => b.key !== 'signed');
  // The card body is the same whether or not the row links; only its wrapper
  // differs (an <a> to the sibling catalog, or a plain <div>).
  const cardInner = (
    <>
      {/* The row's OWN cover where it has one — a printing's jacket (owner
          2026-09-02) or the audiobook catalog's. ⚠️ Falls back to the emoji
          thumb, NEVER to the work cover: showing the work's art on a specific
          printing would claim that is what that printing looks like. */}
      {row.coverUrl ? (
        <div className="bd-hold__thumb bd-hold__thumb--art">
          <Cover src={row.coverUrl} title={row.label ?? ''} size="row" />
        </div>
      ) : (
        <div className="bd-hold__thumb" aria-hidden="true">
          {rowEmoji(row)}
        </div>
      )}
      <div className="bd-hold__main">
        <div className="bd-hold__fmt">
          {/* ⚠️ The EDITION leads, not the format word (owner 2026-09-02:
              "instead of paperback replace that with the edition info").
              `label` is the format word again wherever no printing resolves, so
              an unattributable copy still names its binding rather than being
              labelled with a guess.

              ⚠️ It steps DOWN in size when it is long rather than being cut.
              Measured in production 2026-09-02: 68 of the 129 named printings
              run past 34 characters and the longest is 99 — a shop's own words
              for a printing are a sentence, not a word. Truncating the identity
              would defeat the whole point of putting it here. */}
          <span
            className={`bd-hold__label${
              (row.label?.length ?? 0) > LONG_LABEL ? ' bd-hold__label--long' : ''
            }`}
          >
            {row.label ?? (row.neutral ? 'Not on your shelf' : 'Any format')}
          </span>
          {/* Recordings held, for an Audiobook row (e.g. two narrations). */}
          {row.count != null && row.count > 1 && (
            <span className="shelf-row__count"> ×{row.count}</span>
          )}
          {/* ⚠️ The word and its tooltip are BOTH composed in `deriveShelfView`
              — including the "Available" vs "May be yours" choice, which is a
              claim about ownership and therefore belongs where the evidence is,
              not in a component. */}
          <span className={`bd-hold__own bd-own--${row.state}`} title={row.stateTitle}>
            {row.stateLabel}
          </span>
          {/* The kind pill, unless the kind IS the headline — a printing nobody
              named leads with "Collector's edition" itself. */}
          {row.kind && row.labelSource !== 'edition-kind' && (
            <span className="bd-hold__kind">{editionKindLabel(row.kind)}</span>
          )}
          {/* An open-in-new-tab affordance, only on a row that links. */}
          {row.href && (
            <span className="bd-hold__open" aria-hidden="true">
              ↗
            </span>
          )}
        </div>

        {(badges.length > 0 || row.signed != null) && (
          <div className="bd-hold__badges">
            {/* Signed first: it is the one the owner asked to be answerable at a
                glance, and the one that is shown even when the answer is no. */}
            {row.signed != null && <SignedChip signed={row.signed} />}
            {badges.map((b) => (
              <span key={b.key} className={`special-badge special-badge--${b.key}`} title={b.title}>
                {b.key === 'signed' ? '✍ ' : ''}
                {b.label}
              </span>
            ))}
          </div>
        )}

        {/* The secondary line — the binding the headline gave up, the imprint,
            what it collects. ⚠️ Composed in `deriveShelfView`, not here, so one
            test pins what a row SAYS as well as what it is (and so the headline
            can never repeat a fact below it). */}
        {row.meta && <p className="bd-hold__meta">{row.meta}</p>}

        {/* ⚠️ The sentences that came across in the "Other versions available"
            merge — narrator, the series-spelling disagreement, the PROVENANCE
            (migration 0010: shown, never hidden), the staleness caveat. Muted
            but full size: a hedge in smaller print pretending to be a footnote
            is a hedge nobody reads. */}
        {row.notes.map((note) => (
          <p className="muted small bd-hold__note" key={note}>
            {note}
          </p>
        ))}

        {/* Copies nest UNDER the edition. One copy: its facts inline, no second
            bullet. More than one of the same printing: a short list, the only
            case where a copy earns its own line — and the one place a PER-COPY
            signed answer is needed, since the row's own chip speaks for the
            group. */}
        {row.copies.length === 1 && <CopyFacts copy={row.copies[0]!} />}
        {row.copies.length > 1 && (
          <ul className="plain shelf-row__copies">
            {row.copies.map((c) => (
              <li key={c.id}>
                <CopyFacts copy={c} withStatus showSigned={row.signed != null} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  const cardClass = `bd-hold${
    row.state === 'owned'
      ? ''
      : row.state === 'wanted'
        ? ' bd-hold--wanted'
        : row.state === 'available'
          ? ' bd-hold--available'
          : ' bd-hold--neutral'
  }${row.href ? ' bd-hold--link' : ''}`;

  // Each held format is a teal-wash holding card with its own thumb and the
  // identity big in Fraunces — the mockup's "On your shelf" rendering. Wanted,
  // available and neutral rows wear quieter grounds so the eye lands on what is
  // actually owned. A row with a sibling catalog behind it opens in a new tab.
  return row.href ? (
    <a
      className={cardClass}
      href={row.href}
      target="_blank"
      rel="noopener noreferrer"
      title={
        row.medium === 'audio'
          ? 'Open this book on the audiobook catalog (new tab)'
          : 'Open this book on the ebook shelf (new tab)'
      }
    >
      {cardInner}
    </a>
  ) : (
    <div className={cardClass}>{cardInner}</div>
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
function CopyFacts({
  copy,
  withStatus,
  showSigned,
}: {
  copy: ShelfCopy;
  withStatus?: boolean;
  /**
   * Answer signed for THIS copy, either way (owner 2026-09-02). Set only on an
   * owned physical row's multi-copy list — the case where the row's own chip
   * describes the group and cannot say which of the two is the signed one. Work
   * 220 is exactly that shape: a signed leatherbound and a slipcase volume,
   * nested under one Hardcover row.
   */
  showSigned?: boolean;
}) {
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
  // Signed is rendered as its own two-state chip when asked for, so it comes out
  // of the positive-only list to avoid saying it twice.
  const badges = showSigned ? copy.badges.filter((b) => b.key !== 'signed') : copy.badges;
  const showBadges = !!withStatus && (badges.length > 0 || !!showSigned);
  if (parts.length === 0 && !showBadges) return null;

  return (
    <p className="muted small shelf-row__copy">
      {parts.join(' · ')}
      {showBadges && (
        <span className="shelf-row__copy-badges">
          {showSigned && <SignedChip signed={copy.signed} />}
          {badges.map((b) => (
            <span key={b.key} className="special-badge" title={b.title}>
              {b.label}
            </span>
          ))}
        </span>
      )}
    </p>
  );
}
