import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { describeError } from '../lib/errors.js';
import { addToTbr, getTbrEntry, removeFromTbr } from '../lib/tbr.js';

/**
 * "I mean to read this" — one book, on the work page.
 *
 * ## The list is not this catalog's, and that is the feature
 *
 * The entry is a document in the shared `readingLists` collection the audiobook
 * site has always written, so pressing this button also lights up that site's
 * own `✓ To Be Read` button for the same person, and vice versa. The owner's
 * ask was *"tbr like read should span all catalogs"*; one store is how reviews
 * span, and it is how this does (`packages/core/src/tbr.ts`,
 * `docs/info/identity-and-reviews.md` §3).
 *
 * ## ⚠️ Finishing the book clears the intention — here, and by re-render alone
 *
 * `readState` is a prop, so this component clears whenever the book becomes
 * read *however that happened*: somebody pressing the Read chip above, or the
 * `Reviews` panel deriving it from a rating written on the audiobook site. One
 * rule, one place, no duplicate in `WorkPage`.
 *
 * That is the whole "one intention regardless of format" requirement, seen from
 * one book: the household may hold this work as an audiobook, an EPUB and a
 * paperback, and there is exactly one document to delete because the key is the
 * work, not the copy.
 *
 * ⚠️ Only `'read'` clears. A `dnf` is a more specific truth than "done with
 * it", and a person who has genuinely given up presses the button. See
 * `spentTbrEntries`.
 */
export function Tbr({
  workId,
  /** This person's read state for the work — `null` when nobody has set one. */
  readState,
}: {
  workId: number;
  readState: string | null;
}) {
  const [keys, setKeys] = useState<{
    collection: string;
    docId: string | null;
    held?: string;
    doc: Record<string, unknown> | null;
  } | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  /** Set when the entry was removed BY the read state rather than by a press. */
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKeys(null);
    setOn(null);
    setCleared(false);
    api
      .tbrKeys(workId)
      .then(setKeys)
      .catch((err: unknown) => setError(describeError(err)));
  }, [workId]);

  useEffect(() => {
    if (!keys?.docId) return;
    const { collection, docId } = keys;
    let live = true;

    void (async () => {
      try {
        const entry = await getTbrEntry(collection, docId);
        if (!live) return;
        if (!entry) {
          setOn(false);
          return;
        }
        // ⚠️ The clearing path. It runs on the read state as it stands, so it
        // catches a book that was marked read on a previous visit, or by the
        // whole-library sweep, or by a rating written on the audiobook site —
        // not only a press that happened while this component was mounted.
        if (readState === 'read') {
          await removeFromTbr(collection, docId);
          if (!live) return;
          setOn(false);
          setCleared(true);
          return;
        }
        setOn(true);
      } catch (err) {
        if (live) setError(describeError(err));
      }
    })();

    return () => {
      live = false;
    };
  }, [keys, readState]);

  async function toggle() {
    if (!keys?.docId || !keys.doc) return;
    setBusy(true);
    setError(null);
    setCleared(false);
    try {
      if (on) {
        await removeFromTbr(keys.collection, keys.docId);
        setOn(false);
      } else {
        await addToTbr(keys.collection, keys.docId, keys.doc);
        setOn(true);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // The author guard, stated rather than hidden: a book with no author cannot
  // carry a key that survives the author arriving, so there is nothing safe to
  // write yet. Same refusal, same wording style, as the Reviews panel's.
  if (keys?.held) return <p className="muted small">{keys.held}</p>;

  return (
    <div className="tbr">
      <button
        className={on ? 'primary chip' : 'chip'}
        aria-pressed={on === true}
        disabled={busy || on === null}
        onClick={() => void toggle()}
      >
        {on ? '✓ On my TBR' : 'Add to my TBR'}
      </button>
      {/* ⚠️ Said out loud, for the reason the collection page says how many
          books a sweep marked read: an entry that vanished without explanation
          reads as the app losing it. */}
      {cleared && (
        <p className="muted small">
          Taken off your TBR — you have read it. Add it again above if you mean to re-read
          it.
        </p>
      )}
      {on && !cleared && (
        <p className="muted small">
          This is the same list as the audiobook site&rsquo;s — one entry for the book,
          whichever format you finish.
        </p>
      )}
      {error && <p className="muted small">Could not reach your reading list: {error}</p>}
    </div>
  );
}
