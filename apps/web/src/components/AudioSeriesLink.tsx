import { useEffect, useState } from 'react';
import { api, type AudioSeriesCandidates } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * "This series IS on audio" — the editor control that confirms a library series
 * is the same as an audiobook-catalog series, from the book page.
 *
 * ## Why it lives in the editor and not only on the series ladder
 *
 * The equivalence was previously confirmable ONLY on `/series/:name`. But the
 * owner meets the problem on a book page: work 507 ("Fourth Wing") is owned on
 * audio and reads as if it is not, because its junk title never title-matched
 * the per-work audiobook cache. The audiobook catalog files those recordings
 * under `audiobook_series_holding` keyed on `(series, volume)`, and one owner
 * confirmation folds the whole series — so the fix belongs where the owner is
 * standing when they notice.
 *
 * ## What confirming actually does — stated in the words the button uses
 *
 * `confirmAudioSeries` writes ONE `audiobook_series_link` row (migration 0110).
 * That row is then applied by the read path to EVERY work in the library series
 * and every gap rung — the fold. So the control says "this links all N books in
 * '<series>'", because that is the blast radius and the owner must see it before
 * committing. It is the owner's WORD, not evidence, so the ladder keeps saying
 * "you confirmed the series" rather than pretending a work corroborated it.
 *
 * ## The candidates are only ever what the confirm route will accept
 *
 * `GET /audio-candidates` returns the distinct `audiobook_series` among the LIVE
 * rungs filed under this series — exactly `confirmAudioSeries`'s guard — so the
 * control can never offer a choice that then 404s. The ordinary case is a single
 * candidate whose spelling equals ours ("The Empyrean" = "The Empyrean").
 */
export function AudioSeriesLink({
  series,
  canEdit,
  onChanged,
}: {
  /** The SAVED series on the work — the fold is keyed on this, not on an unsaved edit. */
  series: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<AudioSeriesCandidates | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    if (!series) {
      setData(null);
      return;
    }
    setLoading(true);
    void api
      .audioSeriesCandidates(series)
      .then(setData)
      .catch((err) => setMsg(describeError(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  if (!canEdit) return null;

  // Nothing to confirm against — say so plainly rather than rendering a dead box.
  if (!series) {
    return (
      <section className="panel audio-link">
        <h3>On audio</h3>
        <p className="muted small">
          Set and save a series above first — then, if the audiobook catalog holds it, you can
          confirm the match here.
        </p>
      </section>
    );
  }

  const confirm = async (audiobookSeries: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.confirmAudioSeries(series, { audiobookSeries });
      setMsg(`Linked. Every book in “${series}” now reads as owned on audio where the catalog has it.`);
      load();
      onChanged();
    } catch (err) {
      setMsg(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.unconfirmAudioSeries(series);
      setMsg('Unlinked. The audio match is withdrawn from every book in this series.');
      load();
      onChanged();
    } catch (err) {
      setMsg(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel audio-link">
      <h3>On audio</h3>

      {loading && !data && <p className="muted small">Checking the audiobook catalog…</p>}

      {data?.linked && (
        <div className="stack">
          <p className="audio-link__linked">
            Linked to the audiobook catalog’s <b>“{data.linked.audiobookSeries}”</b>.
          </p>
          <p className="muted small">
            All <b>{data.works}</b> {data.works === 1 ? 'book' : 'books'} in “{series}” are treated
            as owned on audio wherever the catalog has the recording. Confirmed{' '}
            {data.linked.confirmedAt.slice(0, 10)}.
          </p>
          <div className="controls">
            <button className="chip danger" disabled={busy} onClick={() => void unlink()}>
              {busy ? 'Working…' : 'Unlink'}
            </button>
          </div>
        </div>
      )}

      {data && !data.linked && data.candidates.length > 0 && (
        <div className="stack">
          <p className="muted small">
            The audiobook catalog has this series. Confirming links{' '}
            <b>
              all {data.works} {data.works === 1 ? 'book' : 'books'} in “{series}”
            </b>{' '}
            to it — each reads as owned on audio wherever the catalog has the recording.
          </p>
          {data.candidates.map((cand) => (
            <div key={cand.audiobookSeries} className="audio-link__cand">
              <div className="audio-link__cand-text">
                <span className="audio-link__eq">
                  “{series}” <span className="muted">=</span> audiobook “{cand.audiobookSeries}”
                </span>
                <span className="muted small">
                  {cand.rungs} {cand.rungs === 1 ? 'recording' : 'recordings'} in the catalog
                </span>
              </div>
              <button
                className="chip primary"
                disabled={busy}
                onClick={() => void confirm(cand.audiobookSeries)}
              >
                {busy ? 'Working…' : 'Confirm match'}
              </button>
            </div>
          ))}
        </div>
      )}

      {data && !data.linked && data.candidates.length === 0 && !loading && (
        <p className="muted small">
          No audiobook series in the catalog matches “{series}”. Nothing to confirm — if you own
          these on audio, the audiobook catalog may file them under a different name.
        </p>
      )}

      {msg && <p className="muted small">{msg}</p>}
    </section>
  );
}
