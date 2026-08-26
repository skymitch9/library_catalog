import { useCallback, useEffect, useState } from 'react';
import {
  groupTbrEntries,
  outstandingTbrEntries,
  spentTbrEntries,
  type TbrEntry,
  type TbrGroup,
} from '@lc/core';
import { api, type Me, type TbrMatchView } from '../api.js';
import { BooksWithYou } from '../components/BooksWithYou.js';
import { Cover } from '../components/Cover.js';
import { TbrSpinner, type SpinnerRow } from '../components/TbrSpinner.js';
import { audiobookDetailUrl, resolveAudiobookCover } from '../lib/audiobook-site.js';
import { ebookShelfUrl } from '../lib/ebook-site.js';
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
 *
 * ## ⚠️ ONE CARD PER BOOK, NOT PER DOCUMENT — 2026-08-26
 *
 * Owner: *"for the tbr list, it's double counting if something is owned in
 * multiple media sources. So if a book is audio, physical and ebook or any
 * combination we need to have it single count with a link to all formats."*
 *
 * A book the household holds on paper and on audio is TWO `readingLists`
 * documents, because each catalog keys its own by a slug of its own spelling of
 * the title. They are folded here by `groupTbrEntries` — the same function the
 * Worker uses to key the fold, so the count it reports and the cards drawn here
 * have one implementation between them — and each group draws one card with a
 * FORMATS row linking to every shelf the book is actually on.
 *
 * ⚠️ **"Off the list" removes the WHOLE GROUP.** Deleting one document would
 * leave the other behind, and the sibling site's `✓ To Be Read` button would
 * still be lit for a book the person just cleared. They meant the book.
 */

/** One row: what Firestore holds, plus what the catalog said about it. */
type Row = TbrEntry & TbrMatchView;

/** One book: every document that named it, folded. */
type Group = TbrGroup<Row>;

export function TbrPage({ me }: { me: Me }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
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
        setGroups([]);
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

      // ⚠️ THE FOLD HAPPENS BEFORE THE CLEARING, and the order matters: a book
      // finished on audio and still listed on paper is ONE spent intention, and
      // both of its documents have to go. Clearing per document first would
      // delete the audio entry and leave the paperback one on the list, which
      // is the double-count wearing a different hat.
      const folded = groupTbrEntries(merged);

      // ⚠️ Deleted, not filtered. A finished book left in the collection would
      // still be on the audiobook site's list, which is the exact
      // cross-catalog staleness this feature exists to remove.
      const spent = spentTbrEntries(folded);
      for (const group of spent) {
        for (const docId of group.docIds) {
          try {
            await removeFromTbr(collection, docId);
          } catch {
            /* One failed delete must not lose the whole list; it retries on the
               next visit, because the read state that condemned it has not
               changed. */
          }
        }
      }
      // ⚠️ Counted in BOOKS, not documents — it is the sentence the person
      // reads ("took 2 books off the list"), and two documents for one book is
      // one book taken off.
      setCleared(spent.length);
      setGroups(outstandingTbrEntries(folded));
    } catch (err) {
      setError(describeError(err));
      setGroups([]);
    }
  }, [me]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * ⚠️ Removes EVERY document in the group. The person took the BOOK off their
   * list; leaving the sibling catalog's document behind would light its
   * `✓ To Be Read` button for a book they just cleared, which is the
   * cross-catalog staleness this feature exists to remove.
   */
  async function remove(group: Group) {
    setBusy(group.key);
    try {
      const { collection } = await api.tbrCollection();
      let failed = 0;
      for (const docId of group.docIds) {
        try {
          await removeFromTbr(collection, docId);
        } catch {
          failed++;
        }
      }
      if (failed > 0) {
        // ⚠️ Said out loud. A partial removal that looked like a success would
        // put the book back on the list at the next load with no explanation.
        setError(
          `Took ${group.title} off ${group.docIds.length - failed} of ${group.docIds.length} lists — ` +
            'the rest did not answer. Try again and it will finish the job.',
        );
      }
      setGroups((current) => (current ?? []).filter((g) => g.key !== group.key));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  if (error && groups === null) {
    return <main className="notice notice--bad">Could not load your TBR: {error}</main>;
  }
  if (groups === null) return <main className="muted">Loading…</main>;

  const here = groups.filter((g) => g.workId !== null);
  const elsewhere = groups.filter((g) => g.workId === null);
  /** How many books were on the list more than once — see the note below. */
  const foldedAway = groups.reduce((n, g) => n + (g.docIds.length - 1), 0);

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

      {groups.length === 0 ? (
        <p className="muted">
          Nothing on your list. A book page has an <em>Add to my TBR</em> button, and so
          does the audiobook site — it is the same list.
        </p>
      ) : (
        <>
          <p className="muted small">
            {groups.length} {groups.length === 1 ? 'book' : 'books'} to read. This is the same
            list as the audiobook site&rsquo;s, so a book you add there shows up here — and
            finishing it in any format takes it off both.
          </p>

          {/* ⚠️ Said out loud, because the number visibly dropped. The owner
              reported the double count; a silent fix would leave him wondering
              whether the list had lost books instead of stopped repeating
              them. Only rendered when a fold actually happened. */}
          {foldedAway > 0 && (
            <p className="muted small">
              {foldedAway === 1
                ? 'One book was on your list twice — in two formats.'
                : `${foldedAway} entries were repeats — the same book in another format.`}{' '}
              Each book is one card now, with a link to every format you have.
            </p>
          )}

          {/* Can't decide? Let the wheel decide. Picks from this whole list;
              its filters narrow to shelves or series position.
              ⚠️ One candidate per BOOK, not per document — otherwise a book
              held in three formats would be three times as likely to win. */}
          <TbrSpinner rows={groups.map(toSpinnerRow)} />

          {here.length > 0 && <TbrList groups={here} busy={busy} onRemove={remove} />}

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
              <TbrList groups={elsewhere} busy={busy} onRemove={remove} />
            </>
          )}
        </>
      )}

      {/* ⚠️ OUTSIDE the `groups.length === 0` branch, deliberately: a person can
          be holding three of this house's books and have an empty TBR, and
          hiding what they have behind a list they have not written would make
          it unfindable. It renders nothing at all when nothing is recorded
          against them, which is the ordinary case — see the component. */}
      <BooksWithYou />
    </main>
  );
}

/**
 * One card's worth of a group, for the wheel.
 *
 * ⚠️ Keyed by the group's FIRST document id, which is unique across groups
 * because a document folds into exactly one — the spinner uses it as its
 * candidate id, and two candidates sharing one would let the same book be
 * excluded twice.
 */
function toSpinnerRow(group: Group): SpinnerRow {
  const matched = group.entries.find((e) => e.workId !== null);
  return {
    docId: group.docIds[0] ?? group.key,
    workId: group.workId,
    readState: group.readState,
    series: matched?.series ?? null,
    seriesIndexDisplay: matched?.seriesIndexDisplay ?? null,
    workTitle: matched?.workTitle ?? null,
    title: group.title,
    authors: group.authors,
    workCoverUrl: group.workCoverUrl,
    coverUrl: group.docCoverUrl,
  };
}

/**
 * Every shelf this book is actually on, each one a link.
 *
 * ⚠️ **Only the formats that EXIST.** The owner asked for *"a link to all
 * formats"* — the ones he has, not three buttons two of which say no. Nothing
 * renders when the catalog matched no work, because then there is no holding to
 * speak for and the card's own link already goes where it can.
 *
 * ⚠️ The two off-site links use the SIBLING catalogs' spelling of the title
 * (`audiobook_holding.title`, `ebook_holding.title`), not this one's: both sites'
 * only per-book link is a title search-hash, and searching them for this
 * catalog's spelling lands far less often. See `lib/audiobook-site.ts`.
 */
function Formats({ group }: { group: Group }) {
  const { physical, audio, ebook } = group.formats;
  const showPhysical = physical && group.workId !== null && physical.state !== 'none';
  if (!showPhysical && !audio && !ebook) return null;

  return (
    <div className="wish__formats">
      <span className="muted small">You have it:</span>
      {showPhysical && physical && (
        <Link to={workPath(physical.workId)} className="chip-link">
          {physical.state === 'owned' ? '📕 Physical' : '📕 Physical — wanted'}
        </Link>
      )}
      {audio && (
        <a
          className="chip-link"
          href={audiobookDetailUrl(audio.title)}
          target="_blank"
          rel="noreferrer"
        >
          🎧 Audiobook ↗
        </a>
      )}
      {ebook && (
        <a
          className="chip-link"
          href={ebookShelfUrl(ebook.title)}
          target="_blank"
          rel="noreferrer"
        >
          📖 Ebook ↗
        </a>
      )}
    </div>
  );
}

function TbrList({
  groups,
  busy,
  onRemove,
}: {
  groups: Group[];
  busy: string | null;
  onRemove: (group: Group) => void;
}) {
  return (
    <ul className="works">
      {groups.map((group) => {
        // The catalog's own title and cover win where there is one: it is the
        // book as this app knows it, and the entry's title may be the audiobook
        // packaging ("… - The Reckoners, Book 2"). `groupTbrEntries` already
        // applied that preference across the whole group.
        const title = group.title;
        const cover = group.workCoverUrl ?? resolveAudiobookCover(group.docCoverUrl);
        const matched = group.entries.find((e) => e.workId !== null);
        return (
          <li key={group.key}>
            <div className="wish">
              {group.workId !== null ? (
                <Link
                  to={workPath(group.workId)}
                  className="wish__book"
                  aria-label={`Open ${title}`}
                >
                  <Cover src={cover} title={title} size="row" />
                  <span className="row-open__text">
                    <span className="row-open__head">
                      <strong>{title}</strong>
                    </span>
                    {group.authors && <span className="muted small">{group.authors}</span>}
                    {matched?.series && (
                      <span className="series-tag">
                        {matched.series}
                        {matched.seriesIndexDisplay ? <b> {matched.seriesIndexDisplay}</b> : null}
                      </span>
                    )}
                    {group.readState === 'reading' && (
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
                <Formats group={group} />
                <button
                  className="chip"
                  disabled={busy === group.key}
                  onClick={() => onRemove(group)}
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
