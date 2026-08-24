import { useCallback, useEffect, useState } from 'react';
import { outstandingTbrEntries, spentTbrEntries, type TbrEntry } from '@lc/core';
import { api, type Me, type TbrMatchView } from '../api.js';
import { BooksWithYou } from '../components/BooksWithYou.js';
import { Cover } from '../components/Cover.js';
import { audiobookDetailUrl, resolveAudiobookCover } from '../lib/audiobook-site.js';
import { describeError } from '../lib/errors.js';
import { currentUid } from '../lib/firebase.js';
import { fetchMyTbr, removeFromTbr } from '../lib/tbr.js';
import { Link, workPath } from '../router.js';

/**
 * My TBR — what this person means to read next, from every catalog.
 *
 * ## ⚠️ This is the one screen in the app that is not a view of THIS catalog
 *
 * Every other list here answers "what do we own". This answers "what do I mean
 * to read", which is a fact about the person and not about the shelf — so it
 * comes from the shared `readingLists` collection (the audiobook site's own TBR
 * store, joined rather than duplicated: `packages/core/src/tbr.ts`), and the
 * catalog is asked only *afterwards* which of those books it holds.
 *
 * That order is why the second group exists. Most of anybody's list is
 * audiobooks this catalog has never heard of, and **hiding them would be the
 * feature failing quietly**: the owner asked for a TBR that spans catalogs, and
 * a list that showed only the print half would look complete while being a
 * fraction of it. They are shown, said to be elsewhere, and linked to the site
 * that does hold them.
 *
 * ## The list clears itself
 *
 * `POST /api/tbr/resolve` returns this person's read state for every entry it
 * could match, and anything already read is deleted here rather than merely
 * hidden — the intention is spent, and leaving the document would light the
 * audiobook site's `✓ To Be Read` button for a book they have finished. See
 * `spentTbrEntries` for why `dnf` is deliberately not included.
 *
 * ⚠️ A rating written on the audiobook site reaches this through TWO existing
 * steps, neither of them new: the collection page's sweep (`lib/read-sync.ts`)
 * marks the work read from that rating, and this screen then retires the entry
 * it settled. Nothing on the audiobook side had to change for that to work.
 */

/** One row: what Firestore holds, plus what the catalog said about it. */
type Row = TbrEntry & TbrMatchView;

export function TbrPage({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cleared, setCleared] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { collection } = await api.tbrCollection();
      // ⚠️ THE ACCOUNT COMES FROM THE LIVE FIREBASE SESSION, not from `me`.
      // Since 2026-08-18 ("Make tbr keyed to account") an entry is attributed
      // by uid, and `currentUid()` is the same value `firestore.rules` compares
      // against — so what this list shows and what the store would let this
      // person delete can never disagree. `/api/me` carries no uid, and adding
      // one there would be a second source for a fact the session already has.
      //
      // Null for a session with no live Firebase user: the list then falls back
      // to the legacy uid-less entries only, which is the honest answer — those
      // are the only ones such a session could have written.
      const entries = await fetchMyTbr(collection, { ...me, uid: currentUid() });
      if (entries.length === 0) {
        setRows([]);
        return;
      }

      const { entries: matched } = await api.tbrResolve(
        entries.map((e) => ({ docId: e.docId, bookId: e.bookId, workKey: e.workKey })),
      );
      const byDocId = new Map(matched.map((m) => [m.docId, m]));
      const merged: Row[] = entries.flatMap((e) => {
        const match = byDocId.get(e.docId);
        // Cannot happen — the ids came back from a request built out of these
        // very entries — but a row with no match would be rendered as "not on
        // these shelves", which is a claim rather than a gap.
        return match ? [{ ...e, ...match }] : [];
      });

      // ⚠️ Deleted, not filtered. A finished book left in the collection would
      // still be on the audiobook site's list, which is the exact
      // cross-catalog staleness this feature exists to remove.
      const spent = spentTbrEntries(merged);
      for (const row of spent) {
        try {
          await removeFromTbr(collection, row.docId);
        } catch {
          /* One failed delete must not lose the whole list; it retries on the
             next visit, because the read state that condemned it has not
             changed. */
        }
      }
      setCleared(spent.length);
      setRows(outstandingTbrEntries(merged));
    } catch (err) {
      setError(describeError(err));
      setRows([]);
    }
  }, [me]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Row) {
    setBusy(row.docId);
    try {
      const { collection } = await api.tbrCollection();
      await removeFromTbr(collection, row.docId);
      setRows((current) => (current ?? []).filter((r) => r.docId !== row.docId));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  if (error && rows === null) {
    return <main className="notice notice--bad">Could not load your TBR: {error}</main>;
  }
  if (rows === null) return <main className="muted">Loading…</main>;

  const here = rows.filter((r) => r.workId !== null);
  const elsewhere = rows.filter((r) => r.workId === null);

  return (
    <main>
      <h2 className="page-title">My TBR</h2>

      {/* ⚠️ Said out loud and only when something actually happened — the same
          rule the collection page's sweep note follows. A list that silently
          shrank would read as the app losing things. */}
      {cleared > 0 && (
        <p className="muted small">
          Took {cleared} {cleared === 1 ? 'book' : 'books'} off the list — you have read{' '}
          {cleared === 1 ? 'it' : 'them'}. Finishing a book in any format clears it
          everywhere.
        </p>
      )}

      {error && <p className="notice notice--bad">{error}</p>}

      {rows.length === 0 ? (
        <p className="muted">
          Nothing on your list. A book page has an <em>Add to my TBR</em> button, and so
          does the audiobook site — it is the same list.
        </p>
      ) : (
        <>
          <p className="muted small">
            {rows.length} {rows.length === 1 ? 'book' : 'books'} to read. This is the same
            list as the audiobook site&rsquo;s, so a book you add there shows up here — and
            finishing it in any format takes it off both.
          </p>

          {here.length > 0 && <TbrList rows={here} busy={busy} onRemove={remove} />}

          {elsewhere.length > 0 && (
            <>
              <h3>Not on these shelves</h3>
              {/* ⚠️ Not a gap and not a worklist. These are books somebody put
                  on their list from the audiobook site; this catalog holding no
                  copy is the ordinary case (the household owns roughly 1,075
                  audiobooks against a few hundred works here), and the same
                  reasoning as the collection page's "most books belong to no
                  universe" note applies: an absence stated as a shortfall
                  invents a job nobody asked for. */}
              <p className="muted small">
                On your list, but this catalog holds no copy — they will be audiobooks, or
                books spelled differently on the two sites.
              </p>
              <TbrList rows={elsewhere} busy={busy} onRemove={remove} />
            </>
          )}
        </>
      )}

      {/* ⚠️ OUTSIDE the `rows.length === 0` branch, deliberately: a person can
          be holding three of this house's books and have an empty TBR, and
          hiding what they have behind a list they have not written would make
          it unfindable. It renders nothing at all when nothing is recorded
          against them, which is the ordinary case — see the component. */}
      <BooksWithYou />
    </main>
  );
}

function TbrList({
  rows,
  busy,
  onRemove,
}: {
  rows: Row[];
  busy: string | null;
  onRemove: (row: Row) => void;
}) {
  return (
    <ul className="works">
      {rows.map((row) => {
        // The catalog's own title and cover win where there is one: it is the
        // book as this app knows it, and the entry's title may be the audiobook
        // packaging ("… - The Reckoners, Book 2").
        const title = row.workTitle ?? row.title;
        const cover = row.workCoverUrl ?? resolveAudiobookCover(row.coverUrl);
        return (
          <li key={row.docId}>
            <div className="wish">
              {row.workId !== null ? (
                <Link to={workPath(row.workId)} className="wish__book" aria-label={`Open ${title}`}>
                  <Cover src={cover} title={title} size="row" />
                  <span className="row-open__text">
                    <span className="row-open__head">
                      <strong>{title}</strong>
                    </span>
                    {row.authors && <span className="muted small">{row.authors}</span>}
                    {row.series && (
                      <span className="series-tag">
                        {row.series}
                        {row.seriesIndexDisplay ? <b> {row.seriesIndexDisplay}</b> : null}
                      </span>
                    )}
                    {row.readState === 'reading' && (
                      <span className="muted small">You are reading this</span>
                    )}
                  </span>
                </Link>
              ) : (
                // A real anchor to the audiobook site's own search, which is
                // the only book link that site has — see `audiobookDetailUrl`.
                <a
                  className="wish__book"
                  href={audiobookDetailUrl(title)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Cover src={cover} title={title} size="row" />
                  <span className="row-open__text">
                    <span className="row-open__head">
                      <strong>{title}</strong>
                    </span>
                    <span className="muted small">Look for it on the audiobook site →</span>
                  </span>
                </a>
              )}

              <div className="wish__actions">
                <button
                  className="chip"
                  disabled={busy === row.docId}
                  onClick={() => onRemove(row)}
                >
                  Off the list
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
