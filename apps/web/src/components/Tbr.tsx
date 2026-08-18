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
    /** Read-only, and often absent. See heldId below. */
    legacyDocId?: string | null;
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

  /**
   * ⚠️ WHICH document holds this entry — which is not always where a new one
   * would go (2026-08-18, "Make tbr keyed to account").
   *
   * The write target is always the ACCOUNT id. But an entry recorded before the
   * migration reached it — and 53 documents it will never reach — lives under
   * the old `{displayNameLower}_{bookId}` id. Reading only the account id would
   * report "not on your list" for a book that is on it, and pressing Add would
   * then file a SECOND document beside the person's real entry. Deleting the
   * write target instead of the holder would be a silent no-op that left the
   * book on the list.
   *
   * So: read the account id first (it wins whenever both exist), fall back to
   * the legacy one, and remember which answered.
   */
  const [heldId, setHeldId] = useState<string | null>(null);

  useEffect(() => {
    if (!keys?.docId) return;
    const { collection, docId, legacyDocId } = keys;
    let live = true;

    void (async () => {
      try {
        let entry = await getTbrEntry(collection, docId);
        let holder = docId;
        if (!entry && legacyDocId && legacyDocId !== docId) {
          entry = await getTbrEntry(collection, legacyDocId);
          holder = legacyDocId;
        }
        if (!live) return;
        if (!entry) {
          setOn(false);
          setHeldId(null);
          return;
        }
        setHeldId(holder);
        // ⚠️ The clearing path. It runs on the read state as it stands, so it
        // catches a book that was marked read on a previous visit, or by the
        // whole-library sweep, or by a rating written on the audiobook site —
        // not only a press that happened while this component was mounted.
        if (readState === 'read') {
          await removeFromTbr(collection, holder);
          if (!live) return;
          setOn(false);
          setHeldId(null);
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
        // Remove the document that actually HOLDS it — see heldId.
        await removeFromTbr(keys.collection, heldId ?? keys.docId);
        setOn(false);
        setHeldId(null);
      } else {
        // ⚠️ Always the ACCOUNT id, never the legacy one. firestore.rules
        // refuses a legacy-shaped id carrying a uid, so this cannot silently
        // fall back into the display-name keying the migration removed.
        await addToTbr(keys.collection, keys.docId, keys.doc);
        setOn(true);
        setHeldId(keys.docId);
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
