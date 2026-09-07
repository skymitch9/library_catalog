import { useState } from 'react';
import type { PreorderAnswer } from '@lc/core';
import { api } from '../api.js';
import { describeError } from '../lib/errors.js';
import { PreorderPrompt } from './PreorderPrompt.js';
import { preorderQuestionFor, type PreorderQuestion } from '../lib/preorders.js';
import { arrivedPatch } from '../lib/statuses.js';
import {
  DEFAULT_TYPED_INTENT,
  saveTypedWork,
  typedAddOutcome,
  type TypedIntent,
} from '../lib/typed-add.js';

/**
 * Add a book by hand, or by scanning an ISBN.
 *
 * The scan path fills the form and stops. It does **not** save, and that is the
 * whole design: phase 0 measured that a wrong ISBN returns a confident,
 * well-formed, wrong book — three of ten ISBNs typed from memory resolved to
 * entirely different titles, with covers and page counts. Nothing in the
 * response marks them. A person looking at the filled form is the only check
 * that exists.
 *
 * ## ⚠️ "We have it" asks one question first, and only ever one
 *
 * Saying **have it** about a book that already has a `preordered` copy raises the
 * same prompt the scan review screen raises, from the same component — see
 * `PreorderPrompt.tsx`, and `@lc/core/preorders.ts` for why guessing is not an
 * option. A received pre-order is a PATCH of the copy already on file; a second
 * copy is a new row and leaves the pre-order on its way.
 *
 * ⚠️ **The match this needs is deliberately NOT general de-duplication.** It runs
 * only for `intent === 'owned'`, and its only output is whether to ask. This form
 * has always created a work per save — `POST /api/works` does not dedupe, on
 * purpose, and migration 0001 says why — and quietly changing that here would be a
 * much larger behaviour change riding in on a prompt. Answering **a different
 * copy** therefore does exactly what pressing Save did yesterday.
 */
export function AddWork({
  onClose,
  onAdded,
  defaultIntent = DEFAULT_TYPED_INTENT,
}: {
  onClose: () => void;
  onAdded: () => void;
  /**
   * What the intent dropdown OPENS on — the scan page's Shelf/Wishlist switch,
   * threaded through so the one choice made at the top of a sweep reaches the
   * typing tab too (owner ask 2026-09-04).
   *
   * ⚠️ It defaults to `'owned'`, so every caller that predates the switch keeps
   * the behaviour the block below argues for. And it defaults the dropdown
   * rather than replacing it: *"just catalogue it — record no copy"* is a real
   * answer a two-state switch has no way to say.
   */
  defaultIntent?: 'owned' | 'wanted';
}) {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [series, setSeries] = useState('');
  const [isbn, setIsbn] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /**
   * What this book *is* to us, which the catalog previously had no way to say.
   *
   * ⚠️ **Defaults to `'owned'` since 2026-08-13, reversing the original rule.**
   * That rule was: *"`''` — catalogue it and record nothing — is the default and
   * stays the default. Every one of the 117 existing rows is exactly that…
   * making 'owned' the default would silently assert a shelf position for every
   * future hand-added row."*
   *
   * It was right for the catalog it was written against, where hand-adding was
   * rare and backfilled 117 rows had no copies. It is wrong for what this screen
   * has become: **the bulk-intake path during a scanning session, where the book
   * is physically in your hands.** There, "record no copy" is the one answer that
   * is never what you meant, and it fails silently — the book appears in the
   * catalog and simply is not owned. It produced *Who Goes Roar?* with
   * `copies = 0` on 2026-08-13, which is what prompted the change.
   *
   * ⚠️ The wanted/owned distinction is preserved by the dropdown still being
   * explicit and still offering "just catalogue it" — nothing is unsayable, the
   * common case is just no longer the one you have to remember.
   *
   * ⚠️ **Since 2026-09-04 the default is the CALLER's**, defaulting in turn to
   * `'owned'`. On the scan page it is the Shelf/Wishlist switch: somebody who
   * has said "everything I add right now is a want" and then falls back to
   * typing a book in by hand has not changed their mind, and making them say it
   * twice is exactly the kind of silent wrong default the paragraph above was
   * written about.
   */
  const [intent, setIntent] = useState<TypedIntent>(defaultIntent);
  /**
   * ⚠️ **The book is in the catalog and something beside it is NOT** — bug 3 of
   * 2026-08-13, made visible.
   *
   * Set only from `typedAddOutcome(...)` returning `partial`. While it holds
   * sentences the form is replaced by them, because the two things a person
   * needs at that moment are the words and a way out — and emphatically NOT the
   * Save button, whose second press would create a second work
   * (`POST /api/works` does not dedupe; migration 0001).
   *
   * It was previously a `setNote` on the line before `onAdded()`, which
   * unmounts this panel: the sentence was written to state that was thrown away
   * in the same tick, and a save that lost the ISBN looked exactly like a save
   * that did not.
   */
  const [partial, setPartial] = useState<string[] | null>(null);
  /** Raised by Save, answered by the prompt, then handed back to `save`. */
  const [preorder, setPreorder] = useState<PreorderQuestion | null>(null);
  /**
   * "Add without an author" was pressed — remembered so the pre-order prompt's
   * answer re-runs the same deliberate save rather than the ordinary one.
   * Never inferred from a blank field: authorless is a button, not a default
   * (design §3.4.4, migration 0120).
   */
  const [authorless, setAuthorless] = useState(false);

  async function lookup() {
    if (!isbn.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = (await api.scan(isbn.trim())) as {
        result: string;
        reason?: string;
        candidates?: { title: string; authors: string; publisher: string | null }[];
      };

      if (res.result === 'ignore') {
        // The price add-on and the retail UPC both land here. Saying so is more
        // useful than "not found", because the fix is "scan the other barcode".
        setNote(
          res.reason === 'price_addon'
            ? 'That is the price code beside the barcode — scan the longer one.'
            : 'That is not a book barcode. Look for the one starting 978 or 979.',
        );
        return;
      }
      if (res.result === 'owned') {
        setNote('You already own this one.');
        return;
      }
      const first = res.candidates?.[0];
      if (!first) {
        setNote('Nothing found for that ISBN. Type it in by hand — about half of this library is not in Open Library.');
        return;
      }
      setTitle(first.title);
      setAuthors(first.authors);
      setNote(`Found: ${first.title}${first.publisher ? ` (${first.publisher})` : ''}. Check it before saving.`);
    } catch (err) {
      setNote(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(answer?: PreorderAnswer, withoutAuthor = authorless) {
    setBusy(true);
    setNote(null);
    setAuthorless(withoutAuthor);
    try {
      /*
       * ⚠️ Ask before anything is written, exactly as `addLineToCatalog` does.
       *
       * Only `owned` can be a pre-order arriving: `wanted` is a wish about a book
       * that is already bought — a legitimate thing to record and never an
       * arrival — and the empty intent writes no copy at all. Matching for the
       * other two would spend a request to answer a question nobody asked.
       */
      if (intent === 'owned' && !answer) {
        // Null asks about the provisional key, so a second deliberate
        // authorless add of the same title attaches instead of duplicating.
        const match = await api.matchWork(title.trim(), withoutAuthor ? null : authors.trim());
        const question = match.work
          ? await preorderQuestionFor(match.work.id, match.work.title)
          : null;
        if (question) {
          setPreorder(question);
          return;
        }
      }

      /*
       * The pre-order arriving is the one path that creates **no work and no
       * second copy**: the book is already in the catalog — that is how it came
       * to have a pre-order — and the whole point of the answer is that this
       * object is the one already recorded. Creating a work here would leave a
       * duplicate row behind the correction.
       */
      if (answer?.kind === 'arrived') {
        await api.updateCopy(answer.copyId, arrivedPatch(answer.acquiredOn));
        onAdded();
        return;
      }

      /*
       * ⚠️ The whole write sequence — the work, the typed ISBN's edition, the
       * copy — lives in `lib/typed-add.ts`, not here. It was inline until
       * 2026-09-07, and being inline is why the three 2026-08-13 intake bugs
       * went a month without a re-test: this repo has no jsdom and this file
       * reaches `api.js` → `lib/firebase.ts`, which reads `import.meta.env` at
       * module scope and cannot be loaded by the node test runner at all.
       * `apps/web/test/typed-add.test.ts` now pins all three.
       *
       * ⚠️ **It does not throw once the work exists.** Every step that fails
       * after that comes back in `problems`, because the alternative — what
       * shipped — was a request error that never mentioned the book, followed
       * by a person pressing Save again and getting a second work.
       */
      const result = await saveTypedWork(
        {
          createWork: api.createWork as (b: unknown) => Promise<{ work: { id: number } }>,
          createEdition: api.createEdition,
          createCopy: api.createCopy,
          describeError,
        },
        {
          title,
          // ⚠️ Explicit null, never ''. The schema makes authorless a statement
          // (required-but-nullable), and the row gets the provisional key +
          // the Needs→Author flag — which is the null itself, stored nowhere
          // else.
          authors: withoutAuthor ? null : authors,
          series,
          isbn,
          intent,
        },
      );

      const outcome = typedAddOutcome(result);
      if (outcome.kind === 'partial') {
        // ⚠️ `onAdded()` is deliberately NOT called: it unmounts this panel, and
        // unmounting is exactly how the old code lost the sentence it had just
        // written. The person leaves through the Done button below, having read
        // what did not land.
        setPartial(outcome.sentences);
        return;
      }
      onAdded();
    } catch (err) {
      setNote(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  /*
   * ⚠️ The book IS in the catalog; part of what was typed is not. The form is
   * replaced rather than annotated, because the one control that must not be
   * available here is Save.
   *
   * A worded refusal with its way out — the estate rule, and untouchable by the
   * no-grey-paragraph rule: these are not helper prose, they are the only
   * record that anything went wrong.
   */
  if (partial) {
    return (
      <div className="panel">
        {partial.map((sentence) => (
          <p className="notice notice--bad" key={sentence}>
            {sentence}
          </p>
        ))}
        <div className="row">
          <button className="primary" onClick={onAdded}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="row">
        <input
          value={isbn}
          onChange={(e) => setIsbn(e.target.value)}
          placeholder="ISBN (978… or 979…)"
          inputMode="numeric"
        />
        <button onClick={() => void lookup()} disabled={busy}>
          Look up
        </button>
      </div>

      {/* ⚠️ Editing any of the three fields the question was asked about drops
          it. A prompt naming one book, answered after somebody retyped the form
          into a different one, would flip a pre-order that has nothing to do
          with what is on screen. Same rule as `unresolve` on a scan line: a new
          question invalidates the old answer. */}
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setPreorder(null);
        }}
        placeholder="Title"
      />
      <input
        value={authors}
        onChange={(e) => {
          setAuthors(e.target.value);
          setPreorder(null);
        }}
        placeholder="Author(s), as printed"
      />
      <input
        value={series}
        onChange={(e) => setSeries(e.target.value)}
        placeholder="Series (optional)"
      />

      <label className="field">
        <span className="field__label">And we…</span>
        <select
          value={intent}
          onChange={(e) => {
            setIntent(e.target.value as TypedIntent);
            setPreorder(null);
          }}
        >
          <option value="">just catalogue it — record no copy</option>
          <option value="owned">have it</option>
          <option value="wanted">want it — put it on the wishlist</option>
        </select>
      </label>

      {note && <p className="muted small">{note}</p>}

      {/* Nothing has been written when this appears, so Cancel below is still a
          complete way out — which is why the prompt itself offers no third
          answer. See `PreorderPrompt.tsx`. */}
      {preorder && (
        <PreorderPrompt question={preorder} busy={busy} onAnswer={(a) => void save(a)} />
      )}

      <div className="row">
        <button
          className="primary"
          onClick={() => void save(undefined, false)}
          disabled={busy || !title || !authors || preorder !== null}
        >
          Save
        </button>
        {/* ⚠️ The deliberate second action, shown only when it applies: a
            title with no author. It says on the button what it does, so
            authorless is never an accident of a blank field — the ordinary
            Save stays disabled without an author, exactly as before. */}
        {title.trim() !== '' && authors.trim() === '' && (
          <button
            onClick={() => void save(undefined, true)}
            disabled={busy || preorder !== null}
            title="The book is added now and flagged; add the author later from its page — always safe, reviews stay held until then"
          >
            Add without an author
          </button>
        )}
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
