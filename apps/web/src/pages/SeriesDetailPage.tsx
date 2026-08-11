import { useCallback, useEffect, useState } from 'react';
import { completenessSentence, gapEvidenceLabel } from '@lc/core';
import {
  api,
  type EditionRef,
  type OwnedTwice,
  type Me,
  type SeriesGap,
  type SeriesHoldings,
  type SeriesLadderEntry,
  type SeriesReport,
} from '../api.js';
import { Cover } from '../components/Cover.js';
import { formatLabel, mediumLabel } from '../lib/formats.js';

/**
 * One series as a ladder: every rung we hold, every rung we do not, in order.
 *
 * ## Why a ladder and not two lists
 *
 * "Owned" and "missing" as separate lists loses the one thing that makes a gap
 * legible — where it sits. *Beneath the Dragoneye Moons* reads 1 2 3 4 5 6 · 7
 * 8 · 9 10 · 11 · 12 13 · 14 15 16, and the shape of that line is the answer.
 * Two lists would say "you have ten and are missing six" and make you rebuild
 * the ordering in your head.
 *
 * ## Each missing rung says why it is believed missing
 *
 * Four verdicts, and the difference between them is the whole feature:
 *
 * | | |
 * |---|---|
 * | a hole between books you own | arithmetic, cannot be wrong |
 * | earlier than the lowest you own | arithmetic — a book 7 implies a book 1 |
 * | listed in the audiobook catalog | as good as that catalog |
 * | implied by a later volume on the list | as good as that catalog, one step further |
 *
 * The wording lives in `gapEvidenceLabel` in `@lc/core`, beside the arithmetic
 * that produces it, so the explanation and the rule cannot drift apart.
 *
 * ## What form we hold each rung in — and ⚠️ why it is not on every rung
 *
 * A rung can be held on paper, on a screen, on audio, or in several of those at
 * once, and the page shows it. It does **not** stamp every rung with a chip, and
 * that restraint is measured rather than tasteful. Against production
 * 2026-08-10: 156 editions, of which 39 are physical — and **every one of those
 * 39 is on a work with no series at all** (the children's board books). So every
 * series in the catalog today is uniformly ebook, and a chip on all 23 rungs of
 * *Blade Dance* saying EBOOK would be a label on the majority, which the sibling
 * Board Game Catalog states outright is a label nobody reads.
 *
 * So: `uniformMedia` below finds the case where every held rung has the same
 * answer, says it **once** in the summary, and leaves the rungs clean. The
 * moment one volume differs — the BackerKit import landing a hardback of book 3
 * — every rung starts carrying its chips and the odd one out is visible without
 * hunting. The page therefore says more as the shelf gets more interesting, not
 * less.
 */
export function SeriesDetailPage({
  name,
  me,
  onBack,
  backLabel = 'Series',
  onOpen,
}: {
  name: string;
  me: Me;
  onBack: () => void;
  /** Where back goes, named. A ladder reached from a book returns to the book. */
  backLabel?: string;
  onOpen: (workId: number) => void;
}) {
  const [report, setReport] = useState<SeriesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [declaring, setDeclaring] = useState(false);

  const canEdit = me.capabilities.includes('editCatalog');

  const load = useCallback(() => {
    setError(null);
    api
      .series(name)
      .then(setReport)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [name]);

  useEffect(load, [load]);

  if (error) return <main className="notice notice--bad">Could not load that series: {error}</main>;
  if (!report) return <main className="muted">Loading…</main>;

  const { completeness: c, ladder, unnumbered, holdings, ownedTwice } = report;

  // The rungs, in order: everything we hold, plus everything reported missing.
  //
  // ⚠️ Built from `ladder` (held only) and `gaps`, and NOT from every ladder
  // entry with a workId. A volume put on the wishlist gains a work row, so the
  // second version of this line drew it as owned the moment it was wished for —
  // the gap closed because you said you wanted it. Found in a browser; nothing
  // else would have caught it.
  const rungs = [
    ...ladder
      .filter((v) => v.workId != null && !v.wanted)
      .map((v) => ({ index: v.index, entry: v, gap: null })),
    ...c.gaps.map((g) => ({ index: g.index, entry: null, gap: g })),
  ].sort((a, b) => a.index - b.index);

  // The one answer every held rung gives, when they all give the same one. See
  // the header: this is what keeps a uniformly-ebook series from wearing the
  // same chip twenty-three times.
  const held = rungs.map((r) => r.entry).filter((e): e is SeriesLadderEntry => e != null);
  const uniformMedia = signatureShared(held);

  return (
    <main>
      <button className="back" onClick={onBack}>
        ← {backLabel}
      </button>

      <h2 className="page-title">{name}</h2>
      <p className="series-claim">{completenessSentence(c)}</p>

      <Holdings holdings={holdings} uniform={uniformMedia} heldCount={held.length} />

      <p className="muted small">
        {c.knownTotal != null ? (
          <>Length recorded by hand: {c.knownTotal} books, per {c.knownTotalSource}.</>
        ) : c.checkOutcome === 'not_found' ? (
          <>
            The audiobook catalog has never heard of this series, so everything below comes
            from the volume numbers on the books you own — nothing beyond your highest one can
            be claimed.
          </>
        ) : c.checked ? (
          <>Checked against the audiobook catalog, which listed {c.highestKnown ?? 0} as its highest volume.</>
        ) : (
          <>No source has been asked about this series yet.</>
        )}
      </p>

      <ol className="ladder">
        {rungs.map(({ index, entry, gap }) => (
          <li key={index} className={entry ? 'ladder__have' : `ladder__gap ladder__gap--${gap?.evidence}`}>
            <span className="ladder__no">{entry?.display ?? gap?.display ?? index}</span>
            {entry ? (
              <button className="ladder__book" onClick={() => entry.workId && onOpen(entry.workId)}>
                <Cover src={entry.coverUrl} title={entry.title ?? ''} size="row" />
                <span className="ladder__text">
                  <strong>{entry.title}</strong>
                  {entry.readState && entry.readState !== 'unread' && (
                    <span className="muted small"> · {entry.readState}</span>
                  )}
                  {/* Suppressed when every rung says the same thing; the summary
                      above has already said it once. See the header. */}
                  {!uniformMedia && <Media entry={entry} />}
                </span>
              </button>
            ) : (
              gap && (
                <MissingRung
                  gap={gap}
                  series={name}
                  canEdit={canEdit}
                  onChanged={load}
                  onOpen={onOpen}
                />
              )
            )}
          </li>
        ))}
      </ol>

      {rungs.length === 0 && (
        <p className="muted">Nothing in this series carries a volume number.</p>
      )}

      {ownedTwice.length > 0 && (
        <section className="panel">
          <h3>
            Owned more than once
            <span className="count"> {ownedTwice.length}</span>
          </h3>
          <p className="muted small">
            {/* ⚠️ **Copies, not editions**, since 2026-08-11. The old heading said
                "Bought more than once" over a rule that counted *printings of one
                medium*, and measured against production every book it named was a
                scan artifact: one board book recorded twice by two scan paths, and
                two books with two real ISBNs and zero copies. `copy` is the table
                that means "an object in this house".

                Still not an error to be cleaned up. A Target edition and a Barnes
                & Noble edition are two objects on the shelf, and the ladder above
                counts each of these once because it is one volume of the series. */}
            Two or more of these are on the shelf. An ebook and a hardcover of one book is
            not this — that is one book held two ways, and the chips above say so.
          </p>
          <ul className="plain">
            {ownedTwice.map((a) => (
              <OwnedTwiceRow key={a.workId} row={a} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}

      {unnumbered.length > 0 && (
        <section className="panel">
          <h3>In the series, off the number line</h3>
          <p className="muted small">
            {/* Real, and not an error: the six Blade Dance "Extra" side stories,
                the Divine Dungeon omnibus, and both White Sand volumes, whose
                three 160pp parts cannot be told apart from the file. They are
                excluded from the gap arithmetic on purpose. */}
            These are in the series but have no place on it, so they neither fill a gap nor
            create one.
          </p>
          <ul className="plain">
            {unnumbered.map((u) => (
              <li key={u.workId}>
                <button className="link" onClick={() => onOpen(u.workId)}>
                  {u.title}
                </button>
                {u.display && <span className="muted small"> · {u.display}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <section className="panel">
          <h3>What else exists</h3>
          <p className="muted small">
            Nothing here is guessed. If you know of a volume no source lists, record it with
            where you know it from — that is the only way it can ever appear above.
          </p>
          <div className="row-tight">
            <button onClick={() => setAdding(!adding)}>
              {adding ? 'Cancel' : 'Add a volume we know exists'}
            </button>
            <button onClick={() => setDeclaring(!declaring)}>
              {declaring ? 'Cancel' : c.knownTotal == null ? 'Say how long the series is' : 'Change the length'}
            </button>
          </div>

          {adding && (
            <AddVolume
              series={name}
              onSaved={(r) => {
                setReport(r);
                setAdding(false);
              }}
            />
          )}
          {declaring && (
            <DeclareTotal
              series={name}
              current={c.knownTotal}
              currentSource={c.knownTotalSource}
              onSaved={(r) => {
                setReport(r);
                setDeclaring(false);
              }}
            />
          )}

          {c.knownTotal != null && (
            <p className="muted small">
              Recorded as {c.knownTotal} books, per {c.knownTotalSource}.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

/* -- what form we hold it in ----------------------------------------------- */

/**
 * The media a rung covers, as one comparable string.
 *
 * `audio` joins `physical` and `ebook` here and only here — it is a display
 * concern. Nothing in `@lc/core` counts three media; see `MEDIUM_LABEL`.
 */
function signatureOf(entry: SeriesLadderEntry): string {
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
  const audio =
    entry.audiobook == null ? [] : [entry.audiobook.matchedVia === 'containment' ? 'audio?' : 'audio'];
  return [...entry.media, ...audio].join('+');
}

/** True when every held rung gives the same answer — and there is one to give. */
function signatureShared(held: SeriesLadderEntry[]): string | null {
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
function Media({ entry }: { entry: SeriesLadderEntry }) {
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
            (audio.matchedVia === 'containment' ? ' — matched on a partial title' : '')
          }
        >
          {mediumLabel('audio')}
          {/* A containment match is a weaker claim than an exact one and says so.
              `matching.ts` opens with three wrong matches the sibling project
              shipped, and containment is the rung that produced them. */}
          {audio.matchedVia === 'containment' && '?'}
        </span>
      )}
    </span>
  );
}

/** Mirrors `PHYSICAL_FORMATS`; used only to split a tooltip, never to count. */
const PHYSICAL = new Set(['hardcover', 'paperback', 'mass_market']);

/**
 * A medium as it reads in the middle of a sentence.
 *
 * ⚠️ Separate from `MEDIUM_LABEL`, which is the one-word form the chips wear.
 * Reusing the chip word gave "All 3 held ebook." — read in a browser and fixed
 * there, which is the only place it would ever have been noticed.
 */
function mediumPhrase(medium: string): string {
  if (medium === 'physical') return 'in print';
  if (medium === 'ebook') return 'as ebooks';
  if (medium === 'audio') return 'on audio';
  // The hedged form. A containment match is a guess at which audiobook row a
  // volume means, and the sentence has to say so rather than round it up.
  if (medium === 'audio?') return 'possibly on audio';
  return mediumLabel(medium);
}

/** "a", "a and b", "a, b and c" — no Oxford comma, matching the rest of the app. */
function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * What is on the shelf for this series, in one line.
 *
 * Counted in works rather than editions — see `SeriesHoldings` in `@lc/db`. A
 * zero is omitted rather than printed: "0 physical" invites the reader to work
 * out whether that is a fact or a gap in the data, and on this catalog it is
 * both at once.
 */
function Holdings({
  holdings: h,
  uniform,
  heldCount,
}: {
  holdings: SeriesHoldings;
  uniform: string | null;
  /**
   * ⚠️ How many works the `uniform` signature actually speaks for.
   *
   * It is NOT `h.works`. `uniform` is computed from the ladder rungs, which
   * exclude wishlist entries and works that sit off the number line, while
   * `h.works` counts the whole series. Saying "All 4" on the strength of three
   * agreeing rungs is how `/series/The Completionist Chronicles` came to read
   * "All 4 held as ebooks and on audio" while the series list said "3 on audio"
   * — the fourth being an off-ladder short story. Two screens, one truth,
   * different answers.
   */
  heldCount: number;
}) {
  if (h.works === 0) return null;

  const parts = [
    h.physical > 0 && `${h.physical} in print`,
    h.ebook > 0 && `${h.ebook} as ebooks`,
    h.audio > 0 && `${h.audio} on audio`,
  ].filter((p): p is string => Boolean(p));

  return (
    <p className="muted small">
      {/* When every rung is the same, this sentence is the only place the answer
          appears, so it has to be unambiguous rather than merely short. */}
      {uniform && h.works > 1 && heldCount === h.works
        ? `All ${h.works} held ${andList(uniform.split('+').map(mediumPhrase))}.`
        : parts.length > 0
          ? `Held: ${parts.join(' · ')}.`
          : null}
      {h.audio === 0 && h.works > 0 && (
        <>
          {' '}
          {/* Said out loud, because a silent absence and "we never asked" look
              identical — the same distinction `series_check` exists to draw. */}
          None of them are in the audiobook catalog.
        </>
      )}
    </p>
  );
}

/**
 * One volume we own several copies of.
 *
 * ⚠️ Lists the **copies**, not the printings, because the copies are what there
 * are two of. A copy that names its printing borrows that printing's format and
 * name — "Hardcover · Target exclusive" — and one that does not says where it is
 * instead, which is the fact a person on the landing needs. `copy.edition_id` is
 * nullable by design (migration 0001: "a copy can exist before its exact
 * printing is known"), so the un-named case is ordinary rather than broken.
 */
function OwnedTwiceRow({ row, onOpen }: { row: OwnedTwice; onOpen: (workId: number) => void }) {
  const editionById = new Map(row.editions.map((e) => [e.id, e]));

  return (
    <li>
      <button className="link" onClick={() => onOpen(row.workId)}>
        {row.title}
      </button>
      {row.display && <span className="muted small"> · {row.display}</span>}
      <span className="muted small"> · {row.copies.length} copies</span>
      <ul className="plain alt__editions">
        {row.copies.map((copy) => {
          const edition = copy.editionId === null ? undefined : editionById.get(copy.editionId);
          const facts = [
            copy.location,
            copy.vendor,
            copy.acquiredOn,
            copy.isSigned ? 'signed' : null,
            copy.editionNotes,
            copy.status === 'lent' ? 'lent out' : null,
          ].filter(Boolean);
          return (
            <li key={copy.id}>
              {edition ? (
                <>
                  <span className={`fmt fmt--${PHYSICAL.has(edition.format) ? 'physical' : 'ebook'}`}>
                    {formatLabel(edition.format)}
                  </span>{' '}
                  <EditionFacts edition={edition} />
                </>
              ) : (
                <span className="muted small">Printing not recorded</span>
              )}
              {facts.length > 0 && <span className="muted small"> · {facts.join(' · ')}</span>}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * What tells one printing from another.
 *
 * ⚠️ `edition_name` first and unabbreviated. It is the whole reason these two
 * rows are not one row — "Target exclusive" against "Barnes & Noble edition" —
 * and a printing with nothing to distinguish it says so rather than rendering as
 * a blank, which reads as a bug.
 */
function EditionFacts({ edition: e }: { edition: EditionRef }) {
  const facts = [e.editionName, e.publisher, e.publishedYear, e.isbn13].filter(Boolean);
  return (
    <span className="muted small">
      {facts.length > 0 ? facts.join(' · ') : 'nothing recorded to tell it apart'}
    </span>
  );
}

/**
 * A rung we do not have, with its evidence and — when a source named it — a way
 * to put it on the wishlist without typing it out.
 */
function MissingRung({
  gap,
  series,
  canEdit,
  onChanged,
  onOpen,
}: {
  gap: SeriesGap;
  series: string;
  canEdit: boolean;
  onChanged: () => void;
  onOpen: (workId: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /**
   * Put the missing volume on the wishlist.
   *
   * ⚠️ Asks `/api/works/match` first. `POST /api/works` deliberately does not
   * dedupe (migration 0001: `work_key` is not unique on purpose), so skipping
   * the check would let this mint a second row for a book already catalogued
   * under a slightly different title. The check is the same one the scanner
   * makes, for the same reason.
   */
  async function wishFor() {
    if (!gap.title || !gap.authors) return;
    setBusy(true);
    setNote(null);
    try {
      const { work } = await api.matchWork(gap.title, gap.authors);
      let workId = work?.id;
      if (!workId) {
        const created = await api.createWork({
          title: gap.title,
          authors: gap.authors,
          series,
          seriesIndexSort: gap.index,
          seriesIndexDisplay: gap.display ?? String(gap.index),
        });
        workId = created.work.id;
      }
      await api.createCopy({
        workId,
        status: 'wanted',
        notes: `Missing from ${series} — ${gapEvidenceLabel(gap)}`,
      });
      setNote(work ? 'Already catalogued; added to the wishlist.' : 'Added to the wishlist.');
      onChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ladder__missing">
      <div className="ladder__text">
        {gap.wanted && gap.workId != null ? (
          <button className="link" onClick={() => onOpen(gap.workId!)}>
            <strong>{gap.title ?? `Volume ${gap.index}`}</strong>
          </button>
        ) : (
          <strong>{gap.title ?? 'Not known by name'}</strong>
        )}
        <span className="muted small">
          {/* Still missing, and the evidence for that has not changed — a wish
              is not a book. Both facts are shown because both are true. */}
          {gap.wanted ? 'on the wishlist' : gapEvidenceLabel(gap)}
          {gap.wanted && gap.source ? ` · ${gapEvidenceLabel({ ...gap, evidence: 'attested' })}` : ''}
          {gap.staleAt && ' · the source has stopped listing it'}
          {gap.note && ` · ${gap.note}`}
        </span>
      </div>
      {canEdit && !gap.wanted && gap.title && gap.authors && (
        <button className="chip" onClick={() => void wishFor()} disabled={busy}>
          {busy ? '…' : 'Want it'}
        </button>
      )}
      {/* ⚠️ Only a hand-entered row can be withdrawn. An imported one is marked,
          never deleted (migration 0003): deleting it makes it reappear on the
          next import, and makes a row disappearing indistinguishable from the
          book having been bought. The server enforces this too. */}
      {canEdit && gap.source === 'manual' && gap.volumeId != null && (
        <button
          className="chip"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            api
              .deleteSeriesVolume(series, gap.volumeId!)
              .then(() => onChanged())
              .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          Withdraw
        </button>
      )}
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

/** Hand-enter a volume. Always stored `manual`; the server enforces that. */
function AddVolume({
  series,
  onSaved,
}: {
  series: string;
  onSaved: (r: SeriesReport) => void;
}) {
  const [index, setIndex] = useState('');
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number(index);
  const valid = index.trim() !== '' && Number.isFinite(n) && (note.trim() !== '' || sourceUrl.trim() !== '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.addSeriesVolume(series, {
          indexSort: n,
          title: title.trim() || null,
          authors: authors.trim() || null,
          source: 'manual',
          sourceUrl: sourceUrl.trim() || null,
          note: note.trim() || null,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <input
          value={index}
          onChange={(e) => setIndex(e.target.value)}
          placeholder="Volume number"
          inputMode="decimal"
          aria-label="Volume number"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title, if you know it"
          aria-label="Title"
        />
      </div>
      <input
        value={authors}
        onChange={(e) => setAuthors(e.target.value)}
        placeholder="Author, as printed"
        aria-label="Author"
      />
      <input
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        placeholder="Link to where it is listed"
        aria-label="Source link"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="or say how you know"
        aria-label="How you know"
      />
      {/* The client's half of the same rule the server enforces on a series
          total: a claim with nothing behind it is the thing this feature exists
          to refuse, so the button does not light up until there is something. */}
      {!valid && (
        <p className="muted small">A volume needs a number and either a link or a note saying how you know.</p>
      )}
      {error && <p className="notice notice--bad small">{error}</p>}
      <button className="primary" onClick={() => void save()} disabled={busy || !valid}>
        Record it
      </button>
    </div>
  );
}

/** ⚠️ The only place a series length can be asserted. The server refuses it sourceless. */
function DeclareTotal({
  series,
  current,
  currentSource,
  onSaved,
}: {
  series: string;
  current: number | null;
  currentSource: string | null;
  onSaved: (r: SeriesReport) => void;
}) {
  const [total, setTotal] = useState(current == null ? '' : String(current));
  const [source, setSource] = useState(currentSource ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.setSeriesTotal(series, {
          knownTotal: clear ? null : Number(total),
          knownTotalSource: clear ? null : source.trim(),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const valid = Number.isInteger(Number(total)) && Number(total) > 0 && source.trim() !== '';

  return (
    <div className="stack">
      <p className="muted small">
        With no length recorded the app says <em>“of at least N”</em>, which is all the
        evidence supports. Saying the number here lets it say the series is finished — so it
        needs a source, and the server will refuse it without one.
      </p>
      <div className="row">
        <input
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          placeholder="How many books"
          inputMode="numeric"
          aria-label="How many books"
        />
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Where that comes from"
          aria-label="Source"
        />
      </div>
      {error && <p className="notice notice--bad small">{error}</p>}
      <div className="row-tight">
        <button className="primary" onClick={() => void save()} disabled={busy || !valid}>
          Record it
        </button>
        {current != null && (
          <button onClick={() => void save(true)} disabled={busy}>
            Withdraw
          </button>
        )}
      </div>
    </div>
  );
}
