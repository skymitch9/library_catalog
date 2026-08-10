import { useCallback, useEffect, useState } from 'react';
import { completenessSentence, gapEvidenceLabel } from '@lc/core';
import { api, type Me, type SeriesGap, type SeriesReport } from '../api.js';
import { Cover } from '../components/Cover.js';

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
 */
export function SeriesDetailPage({
  name,
  me,
  onBack,
  onOpen,
}: {
  name: string;
  me: Me;
  onBack: () => void;
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

  const { completeness: c, ladder, unnumbered } = report;

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

  return (
    <main>
      <button className="back" onClick={onBack}>
        ← Series
      </button>

      <h2 className="page-title">{name}</h2>
      <p className="series-claim">{completenessSentence(c)}</p>

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
