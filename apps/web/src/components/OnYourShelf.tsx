/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build — same story as
// `RungMedia.tsx` and `ContentNotes.tsx`: the test runner compiles from the
// repo root where no tsconfig sets `jsx`. Vite and tsc use the automatic runtime
// already, so the shipped bundle is byte-identical.
import { useRef, useState, type KeyboardEvent } from 'react';
import type { WorkAudioEdition, WorkAudiobookHolding, WorkEbookHolding } from '../api.js';
import type { CopyView } from './Copies.js';
import type { EditionView } from './Editions.js';
import type { PeerHoldingView } from './PeerLibraries.js';
import { Cover } from './Cover.js';
import { editionKindLabel } from '../lib/formats.js';
import { STATUS_LABEL } from '../lib/statuses.js';
import {
  deriveShelfView,
  type ShelfCardView,
  type ShelfCopy,
  type ShelfRow,
  type ShelfTab,
} from '../lib/shelf-view.js';

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
 * ⚠️ **`SignedChip` is GONE — deleted in round 3 (2026-09-03), and the absence
 * is deliberate.** It rendered signing either way, including a dashed *"Not
 * signed"* pill, which round 2 had already stopped printing anywhere a person
 * could see: the tab header said what every copy shared, the copy lines said
 * only the differences, and *"the absence of the word IS the plain case"* is the
 * owner's own rule from the same afternoon. With round 3 turning every owned
 * copy into a card of its own, the last place a two-state chip could have lived
 * became a card whose chips are only what DISTINGUISHES it — so a positive
 * *"Signed"* is an ordinary badge chip (`SIGNED_BADGE`, minted once in
 * `shelf-view.ts`) and there is no negative to render at all.
 *
 * The negative is not lost, only unprinted: the card's `title` still answers
 * signing both ways, which is where round 2 narrowed the 2026-09-02 *"say it
 * either way"* rule to.
 */

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
 * ## Each fact appears ONCE on a card (owner, 2026-09-03)
 *
 * > "This has double information, let's normalize this."
 *
 * Said of a three-copy Hardcover card that printed *Not signed* four times and
 * *Sprayed edges* twice. **The component filters nothing to fix this** — the
 * derivation now hands it two disjoint lists, `row.badges` for the card and
 * `copy.badges` for each copy, and `row.signed` / `row.signedVaries` for which
 * level the signed chip belongs to. See `shelf-view.ts`.
 *
 * ## THE list, in per-format TABS (owner, 2026-09-02, reshaped 2026-09-03)
 *
 * > "on your shelf should be the main with other editions available under their
 * > given section. so if its a second physical there should be 2 under physical."
 *
 * The **"Other versions available"** panel is gone from the work page and its
 * contents live here. ⚠️ **Round 2 (2026-09-03) turned the three medium headings
 * into FORMAT TABS**, after the owner looked at round 1 and said *"Better but
 * still duplicate, the hard cover section has info and the stuff underneath has
 * information"*:
 *
 * > "I want to see hardcover paperback cover audio ebook as the tabs and the
 * > editions owned of each under … So hardcover / Collectors edition - sprayed
 * > edges signed / Standard edition / Standard edition - signed - lent out"
 *
 * ⚠️ **Round 3 (2026-09-03 17:21) then collapsed the two lists into one.** Of
 * round 2 live, he said:
 *
 * > "Closer but still 3 list, the book icons below should be all that remains.
 * > Add the hard cover, sprayed edges lent out tabs to the iconed ones below"
 *
 * So a tab renders exactly one list — `tab.cards` — where an owned COPY is a
 * card like any other and its distinguishing facts ride on it as chips (his
 * *"tabs"*). `tab.lines` and `tab.rows` are gone from the derivation, not hidden
 * behind a flag. The tab strip is the edit box's strip: the same `.chip`
 * treatment through one shared rule in `styles.css`, never a second tab look.
 *
 * Three things this component renders that it did not before the merge:
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
  const { tabs, looseCards, audioCountLine, availability } = deriveShelfView({
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

      <ShelfTabs tabs={tabs} audioCountLine={audioCountLine} />

      {/* ⚠️ The rows that belong under NO format — the formatless "any format"
          want and the never-empty "not on your shelf" slot. They sit beside the
          tabs rather than inside one, because they name themselves and a tab
          called "Other" would be a category invented to hold two edge cases.
          When there are no tabs at all, this is the whole shelf. */}
      {looseCards.length > 0 && (
        <ul className="plain shelf-rows">
          {looseCards.map((card) => (
            <li key={card.key}>
              <ShelfCard card={card} />
            </li>
          ))}
        </ul>
      )}

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
 * The format tab strip and the panel under it — the owner's *"hardcover
 * paperback cover audio ebook as the tabs and the editions owned of each
 * under"* (2026-09-03).
 *
 * ⚠️ **It chooses no words and does no grouping.** Which tabs exist, their
 * order, the header line and every copy line are `deriveShelfView`'s, so one
 * test pins what the shelf SAYS. This is the tab strip, the keyboard, and
 * nothing else.
 *
 * ⚠️ **The selection is plain state and is NOT persisted** — no localStorage, no
 * URL. A tab is where you are in one glance at one book, not a preference.
 *
 * ⚠️ **`picked` is a wish, not the answer.** The tab set changes when the page
 * reloads its data (a copy is added, a recording is rejected), and a `picked`
 * key that no longer exists must not blank the panel — so the render always
 * resolves through `tabs` and falls back to the default. That is why there is no
 * `useEffect` here resetting state: there is nothing to reset.
 */
function ShelfTabs({
  tabs,
  audioCountLine,
}: {
  tabs: ShelfTab[];
  /** *"You own 2 audiobooks of this book."* — the owner's 2026-08-23 SAY THE NUMBER ask. */
  audioCountLine: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  if (tabs.length === 0) return null;

  // The first tab that holds something you OWN, else simply the first. A book
  // whose only hardcover is a "May be yours" printing should open on the format
  // it actually has, not on the one it might.
  const fallback = tabs.find((t) => t.owned) ?? tabs[0]!;
  const active = tabs.find((t) => t.key === picked) ?? fallback;
  const index = tabs.indexOf(active);

  function move(to: number) {
    const next = tabs[(to + tabs.length) % tabs.length]!;
    setPicked(next.key);
    buttons.current[tabs.indexOf(next)]?.focus();
  }

  // Arrows move the tab (and the focus with it); Home/End jump to the ends.
  // Enter and Space need no handler — these are real <button>s and fire their
  // own onClick, which is the whole reason they are buttons and not divs.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') move(index + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp') move(index - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(tabs.length - 1);
    else return;
    e.preventDefault();
  }

  return (
    <>
      <div
        className="shelf-tabs"
        role="tablist"
        aria-label="Formats on your shelf"
        onKeyDown={onKeyDown}
      >
        {tabs.map((t, i) => (
          <button
            key={t.key}
            id={`shelf-tab-${t.key}`}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={t === active}
            aria-controls={`shelf-panel-${t.key}`}
            /* Roving tabindex: one stop for the whole strip, then the arrows.
               A strip of six tabs that costs six tab stops to walk past is the
               thing this pattern exists to avoid. */
            tabIndex={t === active ? 0 : -1}
            className={`chip${t === active ? ' primary' : ''}`}
            onClick={() => setPicked(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="shelf-tab"
        id={`shelf-panel-${active.key}`}
        role="tabpanel"
        aria-labelledby={`shelf-tab-${active.key}`}
        tabIndex={0}
      >
        {/* ⚠️ The header carries the facts EVERY copy under this tab shares —
            "Hardcover · all signed" — and they appear on no line below. Round
            1's rule, lifted from the printing to the format. */}
        <h4 className="shelf-tab__head">{active.header}</h4>

        {active.key === 'audio' && audioCountLine && <p className="muted small">{audioCountLine}</p>}

        {/* ⚠️ ONE LIST — owner, round 3: "the book icons below should be all
            that remains". One card per owned copy, then the recordings, files,
            wishes and MAY BE YOURS printings, all the same card. There is no
            second list here and there must not be one: two lists under one tab
            is the "still 3 list" he rejected. */}
        {active.cards.length > 0 && (
          <ul className="plain shelf-rows">
            {active.cards.map((card) => (
              <li key={card.key}>
                <ShelfCard card={card} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * One card on the shelf — ⚠️ after round 3 (2026-09-03) that is **one owned
 * COPY**, or a whole row that is not a copy you hold (a wish, a printing that
 * merely exists, an ebook file, an audiobook recording).
 *
 * Extracted from the render when the sections landed (2026-09-02): the same
 * markup now appears under every tab instead of once in a flat list, and a card
 * that is copy-pasted per section is a card that will drift per section.
 *
 * ⚠️ **It renders `card.chips` VERBATIM and composes nothing.** The derivation
 * decides what distinguishes this card — the badges the tab header did not take,
 * the status when the object is not on the shelf, the location, a condition
 * worth saying — so one test pins what the shelf SAYS. The component picks the
 * colour and nothing else.
 *
 * ⚠️ **An `available` card must never read as a holding.** Two things keep them
 * apart and they are belt and braces on purpose: a different ground
 * (`bd-hold--available`, a dashed rule) and a state pill that says *"Available"*
 * or *"May be yours"* rather than *"Owned"*. ⚠️ The third — "no signed chip" —
 * is now structural rather than a rule to remember: a printing nobody holds has
 * no copy, so it has no copy chips at all.
 */
function ShelfCard({ card }: { card: ShelfCardView }) {
  const row = card.row;
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
          <Cover src={row.coverUrl} title={card.label} size="row" />
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
              card.label.length > LONG_LABEL ? ' bd-hold__label--long' : ''
            }`}
          >
            {card.label}
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

        {/* ⚠️ THE CHIPS — the owner's *"add the hard cover, sprayed edges lent
            out tabs to the iconed ones below"* (round 3). Every word of them is
            the derivation's; the class is the only decision made here, and the
            signed chip keeps the pen it has always worn. */}
        {card.chips.length > 0 && (
          <div className="bd-hold__badges">
            {card.chips.map((chip) => (
              <span
                key={chip.key}
                className={`special-badge special-badge--${chip.kind === 'badge' ? chip.key.replace(/^badge-/, '') : chip.kind}`}
                title={chip.title}
              >
                {chip.key === 'badge-signed' ? '✍ ' : ''}
                {chip.label}
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

        {/* ⚠️ Only a WISH still nests its copies, and only because a wish is not
            an object: round 3 gives every copy you HOLD a card of its own, so a
            held row never reaches this branch (`card.copy` is set on those, and
            an owned row is exploded before it gets here). Rendering both would
            print each fact twice — the failure the whole 2026-09-03 sequence
            exists to remove. */}
        {card.copy === null && row.copies.length === 1 && <CopyFacts copy={row.copies[0]!} />}
        {card.copy === null && row.copies.length > 1 && (
          <ul className="plain shelf-row__copies">
            {row.copies.map((c) => (
              <li key={c.id}>
                <CopyFacts copy={c} withStatus />
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
    // ⚠️ `title` only where the derivation composed one — a copy card, whose
    // hover carries what the chips leave out on purpose (the facts the tab
    // header took, signing either way, the plain status, the condition).
    // `undefined`, never `''`: an empty title attribute is a tooltip that
    // flashes an empty box.
    <div className={cardClass} title={card.title ?? undefined}>
      {cardInner}
    </div>
  );
}

/**
 * The facts about one nested copy — status (when it is not a plain on-shelf
 * copy), who has it, where it lives, its condition. Rendered as one muted line
 * so a copy stays visually subordinate to the edition it hangs off.
 *
 * ⚠️ **Only a WISH reaches this since round 3.** A copy you HOLD is a card of
 * its own now, with its facts as chips; this is what is left for a wishlist copy
 * hanging off a Wanted card, which is not an object and cannot be one.
 *
 * ⚠️ The person is shown only when the server sent a name (`personName`): a
 * redacted or unrecorded person both arrive null, and the panel cannot tell them
 * apart, so it says nothing rather than "nobody has it" — the same rule
 * `Copies.tsx` documents at length.
 *
 * ⚠️ **`showSigned` is gone with `SignedChip`.** A wish is never asked whether
 * it is signed (no object, no signature — `deriveShelfView` keeps `signed` null
 * and `signedVaries` false on every wanted row), so the prop could only ever
 * have rendered the *"Not signed"* the owner asked to stop seeing.
 */
function CopyFacts({
  copy,
  withStatus,
}: {
  copy: ShelfCopy;
  withStatus?: boolean;
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

  // ⚠️ `copy.badges` is rendered VERBATIM — since 2026-09-03 the derivation has
  // already reduced it to what THIS copy alone should print: the badges the
  // group does not share, minus `signed` where the chip below is about to say
  // it. This used to be the copy's whole attribute list with a filter here, and
  // a badge the card was also showing appeared on both.
  // Still gated on `withStatus` — the single-copy case has an empty list anyway
  // (one copy always agrees with itself), and the row above says it all.
  const showBadges = !!withStatus && copy.badges.length > 0;
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
