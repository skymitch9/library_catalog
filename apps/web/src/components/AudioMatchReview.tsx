/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build — see `OnYourShelf.tsx`'s
// header, which carries it for the same reason.
import { useState } from 'react';
import { api, type AudioMatchVerdict, type WorkAudioEdition, type WorkAudiobookHolding } from '../api.js';
import { describeError } from '../lib/errors.js';
import { audiobookDetailUrl, resolveAudiobookCover } from '../lib/audiobook-site.js';
import { matchProvenance } from '../lib/shelf-view.js';
import { Link, seriesPath } from '../router.js';

/**
 * **"Yes, this is it" / "Not this one"** — the edit box's Audio tab, and the
 * place the ladder's old `?` was moved to.
 *
 * ## Why this exists (owner, 2026-09-03 ~14:37 Phoenix, verbatim)
 *
 *   > "Also I see a lot of books asking if this is the right audio, can we make
 *   >  all of those question ones show the audio even if not sure and then we
 *   >  can confirm if it's right in the edit menu later? Any dramatic misses
 *   >  ping me about"
 *
 * Approved as a pair the same afternoon (*"Yes do it"*, 15:03): the chips stop
 * asking (see `RungMedia`), and the question is asked ONCE, here, where it can
 * be answered for good. Migration 0450 stores the answer in its own table —
 * never in `matched_via`, which the three-times-a-day sync rewrites.
 *
 * ## ⚠️ What each verdict actually does, said in the buttons' own words
 *
 * | | effect |
 * |---|---|
 * | **Yes, this is it** | words only — the provenance sentence becomes "Confirmed by you as the right recording." Nothing is counted or uncounted. |
 * | **Not this one** | the recording leaves the shelf's Audio section, the series ladder's chip, the recording count, the audiobook filter and the machine export — the row itself is kept, and stays listed here so this is reversible. |
 *
 * ## ⚠️ The two grains, and why this tab does NOT confirm a series
 *
 * A recording matched to THIS book is settled here. A whole SERIES matched by
 * name only (migration 0090's `fold` rungs) is settled on the series page,
 * where migration 0110's control already lives and where the blast radius —
 * every book in the series — can be seen before it is committed. Two
 * mechanisms, two grains; the line at the foot of this tab is the pointer
 * between them, and building a second series control here would be a second
 * answer to one question.
 */
export function AudioMatchReview({
  workId,
  holding,
  editions,
  series,
  canEdit,
  onChanged,
}: {
  workId: number;
  /** The row the `audiobook_holding` VIEW picked — what a one-recording book
   *  renders from. May be the series-link rung, which carries no reviewable
   *  recording identity. */
  holding: WorkAudiobookHolding | null;
  /** Every recording on record for this work (migration 0390), **including**
   *  stale and rejected ones — this tab is where those are seen and undone. */
  editions: WorkAudioEdition[];
  /** The work's own series, for the pointer to the series-level control. */
  series: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** Verdicts written in this session, so the list answers before a reload. */
  const [local, setLocal] = useState<Record<string, AudioMatchVerdict>>({});

  /*
   * The rows to offer, in the order the rest of the app already uses.
   *
   * ⚠️ `audioEditions` is the real list; the holding is a fallback for the
   * ordinary one-recording book, whose response may predate migration 0390 or
   * be a cached body without the array. Never both — `audioEditions[0]` IS the
   * holding (both orderings are identical by construction, see `@lc/db`), and
   * listing both would offer the same recording two buttons.
   */
  const rows: ReviewableRow[] =
    editions.length > 0
      ? editions.map((e) => ({
          audioKey: e.audioKey,
          title: e.title,
          narrator: e.narrator,
          series: e.series,
          indexDisplay: e.indexDisplay,
          coverHref: e.coverHref,
          matchedVia: e.matchedVia,
          titleSimilarity: e.titleSimilarity,
          staleAt: e.staleAt,
          review: e.review ?? null,
        }))
      : holding
        ? [
            {
              // ⚠️ `rawTitle` first, `title` only as the fallback — migration
              // 0390 derives the recording key as `COALESCE(raw_title, title)`
              // and this MUST agree with it or the verdict would be filed under
              // a key nothing reads. Null on the series-link rung, which is why
              // `reviewable` below refuses it rather than inventing a key.
              audioKey: holding.rawTitle ?? holding.title,
              title: holding.title,
              narrator: null,
              series: holding.series,
              indexDisplay: holding.indexDisplay,
              coverHref: holding.coverHref,
              matchedVia: holding.matchedVia,
              titleSimilarity: holding.titleSimilarity,
              staleAt: holding.staleAt,
              review: holding.review ?? null,
            },
          ]
        : [];

  async function decide(row: ReviewableRow, verdict: AudioMatchVerdict) {
    setBusyKey(row.audioKey);
    setMsg(null);
    try {
      await api.reviewAudioMatch(workId, { audioKey: row.audioKey, verdict });
      setLocal((prev) => ({ ...prev, [row.audioKey]: verdict }));
      setMsg(
        verdict === 'confirmed'
          ? `Confirmed “${row.title}” as the right recording. It stops being described as a partial match.`
          : `“${row.title}” is no longer shown as this book’s audiobook. Nothing was deleted — say “Yes, this is it” here to put it back.`,
      );
      onChanged();
    } catch (err) {
      setMsg(describeError(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="panel audio-review">
      <h3>Audio</h3>

      {/*
        ⚠️ A worded refusal, never a hidden control and never a bare status.
        The estate rule: say what happened, what it needs, and how to get it.
        The list itself still renders below, because reading which recording is
        matched is a `read` question and only DECIDING is an `editCatalog` one.
      */}
      {!canEdit && (
        <p className="muted small">
          You can see which recording is matched here, but confirming or rejecting it needs the{' '}
          <b>editor</b> role (the same one the rest of this box needs). Ask the library’s owner to
          raise your role if you need it.
        </p>
      )}

      {rows.length === 0 && (
        <p className="muted small">
          The audiobook catalog has no recording matched to this book. Nothing to confirm — if you
          own it on audio, that catalog may file it under a different title, and a series-wide match
          can be confirmed on the series page instead.
        </p>
      )}

      {rows.map((row) => {
        const verdict = local[row.audioKey] ?? row.review;
        // ⚠️ The series-link rung carries no recording identity to key a verdict
        // on (`@lc/db`'s `deriveAudiobookHoldingFromSeriesLink`: "rawTitle is
        // null here"). Saying so beats offering buttons that would 404.
        const reviewable = row.matchedVia !== 'series_link';
        return (
          <div key={row.audioKey} className="audio-review__row">
            {resolveAudiobookCover(row.coverHref) && (
              <img
                className="audio-review__cover"
                src={resolveAudiobookCover(row.coverHref) as string}
                alt=""
                /* Decorative: the title is right beside it in text. */
              />
            )}
            <div className="stack" style={{ gap: '0.25rem' }}>
              <p className="small">
                <a href={audiobookDetailUrl(row.title, row.audioKey)} target="_blank" rel="noreferrer">
                  <b>{row.title}</b>
                </a>
                {row.indexDisplay ? <span className="muted"> ({row.indexDisplay})</span> : null}
              </p>
              {row.narrator && <p className="muted small">Read by {row.narrator}</p>}
              {/* ⚠️ The SAME sentence the shelf prints — `matchProvenance` is
                  imported rather than restated, so the two surfaces cannot come
                  to describe one match in two ways. Migration 0010: shown,
                  never hidden. */}
              <p className="muted small">{matchProvenance({ ...row, review: verdict })}</p>
              {row.staleAt && (
                <p className="muted small">
                  May be out of date — the audiobook catalog no longer confirms this match.
                </p>
              )}

              {verdict === 'rejected' && (
                <p className="muted small">
                  <b>Marked as not this book.</b> It is hidden from the shelf, the series ladder and
                  the audiobook filter. The record was kept.
                </p>
              )}

              {!reviewable && (
                <p className="muted small">
                  This one comes from the series match you confirmed, not from a title match, so
                  there is no single recording to answer for here.
                </p>
              )}

              {canEdit && reviewable && (
                <div className="row-tight">
                  <button
                    className="chip primary"
                    disabled={busyKey === row.audioKey || verdict === 'confirmed'}
                    onClick={() => void decide(row, 'confirmed')}
                  >
                    {busyKey === row.audioKey ? '…' : 'Yes, this is it'}
                  </button>
                  <button
                    className="chip danger"
                    disabled={busyKey === row.audioKey || verdict === 'rejected'}
                    onClick={() => void decide(row, 'rejected')}
                  >
                    {busyKey === row.audioKey ? '…' : 'Not this one'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {msg && <p className="muted small">{msg}</p>}

      {/* The other grain — see the header. One question, one home. */}
      {series && (
        <p className="muted small">
          Series-level matches are confirmed on the series page:{' '}
          <Link to={seriesPath(series)}>{series}</Link>.
        </p>
      )}
    </section>
  );
}

/** One recording as this tab needs it — the union of what a holding and an
 *  edition each carry, with the verdict alongside. */
interface ReviewableRow {
  audioKey: string;
  title: string;
  narrator: string | null;
  series: string | null;
  indexDisplay: string | null;
  coverHref: string | null;
  matchedVia: string;
  titleSimilarity: number | null;
  staleAt: string | null;
  review: AudioMatchVerdict | null;
}
