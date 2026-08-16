import { useCallback, useEffect, useState } from 'react';
import {
  completenessSentence,
  gapAudioLabel,
  gapEvidenceLabel,
  gapSkipLabel,
  gapsCountingAudio,
  gapsInPrint,
} from '@lc/core';
import {
  api,
  type AudioSeriesLink,
  type EditionRef,
  type OwnedTwice,
  type Me,
  type SeriesCompleteness,
  type SeriesGap,
  type SeriesHoldings,
  type SeriesLadderEntry,
  type SeriesReport,
  type SeriesScanResponse,
} from '../api.js';
import { describeError } from '../lib/errors.js';
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
 * ## ⚠️ A missing rung may be a book the owner already has — on audio
 *
 * Added 2026-08-11, and it is a bug fix rather than a feature. A book owned only
 * on audio has no `work` row here — migration 0010's `audiobook_holding` is
 * keyed on one — so it could not be represented and the ladder drew it as a
 * hole. `/series/The Stormlight Archive` read *"1 book of at least 5 — 6
 * missing"* while the household owned all seven of them. Migration 0090 caches
 * the answer on `(series, index)`, which is all a gap rung has, and the rungs
 * below now say so.
 *
 * ⚠️ **The rung stays on the missing side of the ladder**, and that is
 * deliberate: it genuinely is absent from *this* catalog, and "buy the
 * paperback" is still a decision somebody might make. What changes is the word
 * *missing* and the counts behind it.
 *
 * ⚠️ **A match that rests only on a folded series name renders AUDIO?**, the
 * same hedge a containment match already wears — see `signatureOf` below for the
 * flat claim that hedge exists to prevent.
 *
 * ⚠️ **…and since 2026-08-12 the owner can settle it** — `AudioLink` below, and
 * migration 0110. Not a loosening of the rail: the hedge exists because nothing
 * had corroborated the mapping, and for a series whose volumes the two catalogs
 * do not share *nothing ever can*, so the alternative was a permanent hedge on
 * books the owner had verified by hand. The rung then reads `'owner'` rather than
 * `'work_match'`, and says which.
 *
 * ## ⚠️ A rung can also be one the owner has decided never to own
 *
 * The three Patreon-era Completionist Chronicles shorts are not sold, so that
 * series read incomplete for ever. `completeness.skipped` holds those rungs;
 * they are drawn greyed, with the owner's reason and an undo, and they are out
 * of `gaps` so nothing counts them as missing. Migration 0100.
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
  // `suggestWishlist` (2026-08-16 split) — lets a `member` put a missing rung
  // on the wishlist (`MissingRung`'s "Want it") without needing `editCatalog`
  // for "Never buying it" / manual-volume actions, which stay canEdit-only.
  const canSuggest = me.capabilities.includes('suggestWishlist');
  // Same gate as `POST /works/:id/run` — a scan spends money, same as any other
  // research run, and `runResearch` is the capability that already means that.
  const canScan = me.capabilities.includes('runResearch');

  const load = useCallback(() => {
    setError(null);
    api
      .series(name)
      .then(setReport)
      .catch((err: unknown) => setError(describeError(err)));
  }, [name]);

  useEffect(load, [load]);

  if (error) return <main className="notice notice--bad">Could not load that series: {error}</main>;
  if (!report) return <main className="muted">Loading…</main>;

  const { completeness: c, ladder, unnumbered, holdings, ownedTwice } = report;

  // The rungs, in order: everything we hold, plus everything reported missing,
  // plus the ones deliberately skipped.
  //
  // ⚠️ Built from `ladder` (held only), `gaps` and `skipped`, and NOT from every
  // ladder entry with a workId. A volume put on the wishlist gains a work row,
  // so the second version of this line drew it as owned the moment it was wished
  // for — the gap closed because you said you wanted it. Found in a browser;
  // nothing else would have caught it.
  //
  // ⚠️ `c.skipped` is a THIRD source and not a filter over `c.gaps`. The two
  // arrays are disjoint by construction in `@lc/core`, which is what keeps every
  // count there — and both chips on the series list — from seeing a skipped
  // rung. Reconstituting them here with a flag would put that rule in two
  // places.
  const rungs = [
    ...ladder
      .filter((v) => v.workId != null && !v.wanted)
      .map((v) => ({ index: v.index, entry: v, gap: null })),
    ...c.gaps.map((g) => ({ index: g.index, entry: null, gap: g })),
    ...c.skipped.map((g) => ({ index: g.index, entry: null, gap: g })),
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
      <ByFormatHeadline c={c} />

      <Holdings
        holdings={holdings}
        uniform={uniformMedia}
        heldCount={held.length}
        audioGaps={c.onAudio + c.maybeOnAudio}
      />

      <AudioLink
        series={name}
        gaps={c.gaps}
        link={report.audioLink}
        canEdit={canEdit}
        onChanged={load}
      />

      <p className="muted small">
        {c.knownTotal != null ? (
          <>Length recorded by hand: {c.knownTotal} books, per {c.knownTotalSource}.</>
        ) : c.checkOutcome === 'not_found' ? (
          c.checkSource === 'claude_research' ? (
            <>
              A scan could not confidently identify this series, so everything below comes
              from the volume numbers on the books you own — nothing beyond your highest one
              can be claimed.{c.checkNote && ` ${c.checkNote}`}
            </>
          ) : (
            <>
              The audiobook catalog has never heard of this series, so everything below comes
              from the volume numbers on the books you own — nothing beyond your highest one can
              be claimed.
            </>
          )
        ) : c.checked ? (
          <>
            Checked against {c.checkSource === 'claude_research' ? 'a Claude research scan' : 'the audiobook catalog'},
            which listed {c.highestKnown ?? 0} as its highest volume.
            {/* ⚠️ Said plainly rather than forced into agreement — the whole
                reason a scan carries a note at all. See `checkNote`'s header in
                `@lc/core`: it is prose for a person, never evidence for a gap. */}
            {c.checkNote && ` ${c.checkNote}`}
            {c.checkSource === 'claude_research' && c.checkedAt && ` Last scanned ${c.checkedAt.slice(0, 10)}.`}
          </>
        ) : (
          <>No source has been asked about this series yet.</>
        )}
      </p>

      <ScanControl series={name} checked={c.checked} configured={report.configured} canScan={canScan} onScanned={setReport} />

      <ol className="ladder">
        {rungs.map(({ index, entry, gap }) => (
          <li
            key={index}
            className={
              entry
                ? 'ladder__have'
                : gap?.skipped
                  ? 'ladder__gap ladder__gap--skipped'
                  : // A rung we own on audio is still a gap, but it must not
                    // wear the same red as one nobody in the house has.
                    //
                    // ⚠️ "not the hedge", matching `held()` in `@lc/core`. A rung
                    // the arithmetic has stopped counting as missing while the
                    // ladder still paints it red is the two disagreeing on
                    // screen, and this is the branch that would drift: migration
                    // 0110 added `'owner'`, and an equality test here would have
                    // silently kept every confirmed rung red.
                    gap?.audio != null && gap.audio.matchedVia !== 'fold'
                    ? 'ladder__gap ladder__gap--audio'
                    : `ladder__gap ladder__gap--${gap?.evidence}`
            }
          >
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
                  canSuggest={canSuggest}
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

/* -- is it the same series? ------------------------------------------------- */

/**
 * The one question the two catalogs cannot answer between themselves, asked of
 * the only person who can — and the undo for the answer. Migration 0110.
 *
 * ## ⚠️ Why a person is being asked at all
 *
 * A rung reads *"possibly on audio"* when `series_matched_via` is `'fold'`: the
 * two catalogs' series names fold onto one key and **nothing else** connects
 * them. The grade that removes the hedge, `'work_match'`, needs one volume
 * present in *both* catalogs, matched by title and author, agreeing on its
 * number.
 *
 * ⚠️ **For the series that need it most that grade is unreachable, and not by
 * accident.** The entire purpose of `audiobook_series_holding` is the volumes the
 * two catalogs do *not* share, so a series with an empty overlap can never
 * corroborate itself. Measured 2026-08-12, both hedged series were exactly that:
 * this catalog holds *Arcane Pathfinder* 5 against audiobooks 1–4, and *Legion*
 * 1–2 against an audiobook 4. No number of `backfill:audiobooks` runs would have
 * moved either. The owner had checked both by hand and been right every time —
 * which is a source, and this is where it goes.
 *
 * ## ⚠️ What the button must NOT look like
 *
 * It says *"the same series"*, never *"I own these"*. The books' presence in the
 * house is not in question — `audiobook_series_holding` read it out of the
 * sibling catalog's curated `series`/`series_index_sort` columns. The only thing
 * in doubt is whether that catalog's series is this one, and asking the broader
 * question would collect an answer to something the person was not shown.
 *
 * Both spellings are printed for the same reason. An eyeball on the pair is the
 * whole of the evidence, so hiding either half would make the confirmation a
 * blind click — and *"Dark Healer"* / *"The Dark Healer"* in that catalog is the
 * standing proof that two spellings can be one series and two series can nearly
 * share a spelling.
 *
 * ⚠️ **One button per distinct audiobook spelling.** The rungs of one series can
 * carry more than one — the fold is what merged them — and the confirmation is
 * keyed on the exact string, so a single button would silently unhedge one
 * spelling's rungs and leave the other's. Ordinarily there is exactly one.
 */
function AudioLink({
  series,
  gaps,
  link,
  canEdit,
  onChanged,
}: {
  series: string;
  gaps: SeriesGap[];
  link: AudioSeriesLink | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Their spelling -> the rungs still hedged under it.
  const hedged = new Map<string, SeriesGap[]>();
  for (const g of gaps) {
    if (g.audio?.matchedVia !== 'fold') continue;
    const list = hedged.get(g.audio.audiobookSeries);
    if (list) list.push(g);
    else hedged.set(g.audio.audiobookSeries, [g]);
  }
  // What the standing confirmation is currently holding up. ⚠️ Counted from the
  // rungs and not from `completeness.onAudio`, which also counts rungs a work
  // corroborated — those would survive the undo, so naming them here would
  // overstate what the button takes away.
  const upheld = gaps.filter((g) => g.audio?.matchedVia === 'owner').length;

  if (hedged.size === 0 && link == null) return null;

  function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    action()
      .then(() => onChanged())
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setBusy(false));
  }

  return (
    <section className="panel">
      <h3>The audiobook catalog</h3>

      {[...hedged].map(([audiobookSeries, rungs]) => (
        <div key={audiobookSeries} className="stack">
          <p className="muted small">
            {rungs.length === 1 ? 'One volume' : `${rungs.length} volumes`} filed under{' '}
            <strong>“{audiobookSeries}”</strong> in the audiobook catalog{' '}
            {rungs.length === 1 ? 'lines up' : 'line up'} with{' '}
            {rungs.length === 1 ? 'a rung' : 'rungs'} below — {rungs.map((r) => r.index).join(', ')}.
            {/* The state of the evidence, said plainly, because the person is
                being asked to supply what is missing from it. */}{' '}
            Nothing but the series name connects it to <strong>“{series}”</strong> here: you hold no
            volume of this series that the audiobook catalog also has, so nothing can corroborate the
            match on its own. Until you say otherwise {rungs.length === 1 ? 'it stays' : 'they stay'}{' '}
            counted as missing.
          </p>
          {canEdit && (
            <div className="row-tight">
              <button
                className="primary"
                disabled={busy}
                onClick={() => run(() => api.confirmAudioSeries(series, { audiobookSeries }))}
              >
                {busy ? '…' : 'Same series — I own these'}
              </button>
            </div>
          )}
        </div>
      ))}

      {link && (
        <div className="stack">
          <p className="muted small">
            You confirmed that <strong>“{link.audiobookSeries}”</strong> there is this series
            {link.confirmedAt && ` on ${link.confirmedAt.slice(0, 10)}`}
            {upheld > 0 && (
              <>
                {' '}
                — {upheld} {upheld === 1 ? 'rung is' : 'rungs are'} no longer counted as missing
                because of it
              </>
            )}
            .{link.note && ` ${link.note}`}
            {/* ⚠️ Said out loud when the confirmation has stopped applying. It is
                not a fault: the read path only upgrades a rung while this
                spelling still matches the live row, so a rename in that catalog
                correctly reverts the rungs and asks again. Silence here would
                leave a confirmation that visibly does nothing. */}
            {upheld === 0 && (
              <>
                {' '}
                ⚠️ It is holding nothing up at present — either those volumes are now catalogued
                here, or that catalog has refiled them under another name.
              </>
            )}
          </p>
          {canEdit && (
            <div className="row-tight">
              <button disabled={busy} onClick={() => run(() => api.unconfirmAudioSeries(series))}>
                {busy ? '…' : 'Take that back'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="notice notice--bad">{error}</p>}
    </section>
  );
}

/* -- finding what is missing, by name --------------------------------------- */

/**
 * "Scan for missing books" — a Claude web-search pass over this one series,
 * written down as `series_volume`/`series_check` rows the ladder above already
 * knows how to render. See `apps/worker/src/lib/series-scan.ts` for the whole
 * argument; the short version is that this writes exactly the kind of row the
 * audiobook-catalog import already writes, just from a fourth source.
 *
 * ⚠️ No polling, no run table, no "already running" guard from the server —
 * `busy` disabling the button for the duration of the request is the whole
 * guard, the same one `AudioLink` and `MissingRung` already rely on for every
 * other write on this page. A double-click costs at most a duplicate scan, not
 * a duplicate anything written to the catalog: `upsertSeriesVolume` is an
 * upsert either way.
 */
function ScanControl({
  series,
  checked,
  configured,
  canScan,
  onScanned,
}: {
  series: string;
  /** Whether this series has ever been checked against anything — decides "Scan" vs "Re-scan". */
  checked: boolean;
  /** `false` means the Worker has no `ANTHROPIC_API_KEY` — told up front, not discovered by a failed click. */
  configured: boolean;
  canScan: boolean;
  onScanned: (report: SeriesReport) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeriesScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canScan) return null;

  function scan() {
    setBusy(true);
    setError(null);
    setResult(null);
    api
      .scanSeries(series)
      .then((res) => {
        setResult(res);
        if (res.report) onScanned(res.report);
      })
      .catch((err: unknown) => setError(describeError(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="stack">
      {configured ? (
        <div className="row-tight">
          <button disabled={busy} onClick={scan}>
            {busy ? 'Scanning…' : checked ? 'Re-scan for missing books' : 'Scan for missing books'}
          </button>
        </div>
      ) : (
        <p className="muted small">
          No Anthropic API key is configured, so a scan cannot run. Put <code>ANTHROPIC_API_KEY</code>{' '}
          in <code>apps/worker/.dev.vars</code> and run <code>npm run secrets:push</code>.
        </p>
      )}
      {result && (
        <p className="muted small">
          {result.identified
            ? `Found ${result.volumesWritten} ${result.volumesWritten === 1 ? 'volume' : 'volumes'} on this series.`
            : 'Could not confidently identify this series.'}
          {result.note && ` ${result.note}`}
        </p>
      )}
      {error && <p className="notice notice--bad small">{error}</p>}
    </div>
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
function GapMedia({ gap }: { gap: SeriesGap }) {
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
 * "What would complete this series — in print, and in any format."
 *
 * ⚠️ Both numbers come straight from `gapsInPrint` / `gapsCountingAudio` in
 * `@lc/core`, on purpose: `completenessSentence` above already prints
 * `certainGaps` and `attestedGaps` split apart by *how sure* the app is,
 * which is the right split for deciding what to chase next. This line asks a
 * different question — *does owning it on audio already count?* — and the two
 * headers must not silently disagree about what "missing" means, so the
 * arithmetic is imported rather than re-added here.
 *
 * Suppressed once there is nothing left to complete, matching every other
 * zero-omission on this page. The two numbers are printed even when they are
 * EQUAL — that equality is itself the honest answer ("audio has not actually
 * confirmed anything for this series"), not a bug to hide.
 */
function ByFormatHeadline({ c }: { c: SeriesCompleteness }) {
  const inPrint = gapsInPrint(c);
  if (inPrint === 0) return null;
  const countingAudio = gapsCountingAudio(c);
  return (
    <p className="muted small">
      {inPrint} {inPrint === 1 ? 'gap' : 'gaps'} in print, {countingAudio} counting audio.
    </p>
  );
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
  audioGaps,
}: {
  holdings: SeriesHoldings;
  uniform: string | null;
  /**
   * ⚠️ Rungs held on audio that are NOT works here — migration 0090.
   *
   * `SeriesHoldings` counts works in this catalog and cannot see them, which is
   * the whole bug. Without this the line below said "None of them are in the
   * audiobook catalog" over a ladder whose every gap rung said the opposite.
   */
  audioGaps: number;
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
      {audioGaps > 0 && (
        <>
          {' '}
          {/* The books that are in the house but not in this catalog. Said here
              as well as on the rungs, because the summary is the only line
              somebody scanning the series list will read. */}
          {audioGaps} more of this series {audioGaps === 1 ? 'is' : 'are'} on audio only.
        </>
      )}
      {h.audio === 0 && audioGaps === 0 && h.works > 0 && (
        <>
          {' '}
          {/* Said out loud, because a silent absence and "we never asked" look
              identical — the same distinction `series_check` exists to draw.
              ⚠️ Suppressed once any rung is held on audio: it was flatly
              contradicting the ladder underneath it. */}
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
  canSuggest,
  onChanged,
  onOpen,
}: {
  gap: SeriesGap;
  series: string;
  canEdit: boolean;
  /** `suggestWishlist` — gates "Want it" alone; every other action here stays `canEdit`. */
  canSuggest: boolean;
  onChanged: () => void;
  onOpen: (workId: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

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
      setNote(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  /** Skip it, or take the skip back. Both re-render the whole report. */
  function decide(run: () => Promise<unknown>) {
    setBusy(true);
    setNote(null);
    run()
      .then(() => onChanged())
      .catch((err: unknown) => setNote(describeError(err)))
      .finally(() => setBusy(false));
  }

  const audioNote = gapAudioLabel(gap);
  const skipNote = gapSkipLabel(gap);

  return (
    <div className="ladder__missing">
      <div className="ladder__text">
        {gap.wanted && gap.workId != null ? (
          <button className="link" onClick={() => onOpen(gap.workId!)}>
            <strong>{gap.title ?? `Volume ${gap.index}`}</strong>
            {gap.year && <span className="muted small"> ({gap.year})</span>}
          </button>
        ) : (
          <>
            <strong>{gap.title ?? 'Not known by name'}</strong>
            {gap.year && <span className="muted small"> ({gap.year})</span>}
          </>
        )}
        {/* The same `.fmt` badge an owned rung wears, so the strip reads the
            same way down the whole ladder — a gap rung just has nothing filled
            in beside it. `audioNote` below still carries the sentence, for
            whose word it is and (on a hedge) what was actually compared; the
            badge is only the at-a-glance answer. */}
        <GapMedia gap={gap} />
        {/* ⚠️ The audio answer comes FIRST, before the evidence for the gap.
            "you own this on audio" is the fact that changes what somebody does
            next; "earlier than the lowest you own" is why the rung is drawn at
            all, and reading it first is what made the page feel like a
            reproach for books already in the house. */}
        {audioNote && (
          // Muted only while it is still a guess — the same "not the hedge" test
          // as the rung's colour and as `held()` in `@lc/core`.
          <span className={gap.audio?.matchedVia !== 'fold' ? 'small' : 'muted small'}>
            {audioNote}
          </span>
        )}
        <span className="muted small">
          {/* Still missing, and the evidence for that has not changed — a wish
              is not a book. Both facts are shown because both are true. */}
          {skipNote ?? (gap.wanted ? 'on the wishlist' : gapEvidenceLabel(gap))}
          {gap.wanted && gap.source ? ` · ${gapEvidenceLabel({ ...gap, evidence: 'attested' })}` : ''}
          {gap.staleAt && ' · the source has stopped listing it'}
          {gap.note && ` · ${gap.note}`}
          {gap.skipped?.note && ` · ${gap.skipped.note}`}
        </span>
      </div>
      {/* ⚠️ No "Want it" on a skipped rung, and no "Want it" on one we already
          own on audio without the reason being visible first — the button is
          the one action that costs money. A skipped rung offers only the undo. */}
      {canSuggest && !gap.skipped && !gap.wanted && gap.title && gap.authors && (
        <button className="chip" onClick={() => void wishFor()} disabled={busy}>
          {busy ? '…' : 'Want it'}
        </button>
      )}
      {canEdit && !gap.skipped && !skipping && (
        <button className="chip" onClick={() => setSkipping(true)} disabled={busy}>
          Never buying it
        </button>
      )}
      {canEdit && gap.skipped && (
        <button
          className="chip"
          disabled={busy}
          onClick={() => decide(() => api.unskipSeriesGap(series, gap.index))}
        >
          Put it back
        </button>
      )}
      {skipping && (
        <SkipReason
          busy={busy}
          onCancel={() => setSkipping(false)}
          onSave={(reason) =>
            decide(() =>
              api.skipSeriesGap(series, { indexSort: gap.index, reason }).then(() => {
                setSkipping(false);
              }),
            )
          }
        />
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
              .catch((err: unknown) => setNote(describeError(err)))
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

/**
 * Why this one is never being bought.
 *
 * ⚠️ Required, and the button stays dark until it is filled in — the same shape
 * `AddVolume` uses for its source. The job here is different, though: this is
 * not evidence, because a preference cannot be wrong. It is the answer to "why
 * is 11.5 greyed out" six months from now, and without it a skipped rung and a
 * misfiled one look identical. See migration 0100.
 */
function SkipReason({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 2;

  return (
    <div className="stack">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why not — “Patreon-only short, never sold”"
        aria-label="Why you are not buying it"
        autoFocus
      />
      <div className="row-tight">
        <button className="primary" disabled={busy || !valid} onClick={() => onSave(reason.trim())}>
          Skip it
        </button>
        <button onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
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
      setError(describeError(err));
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
      setError(describeError(err));
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
