/* @jsxRuntime automatic @jsxImportSource react */
// ⚠️ The pragma is for `npm test`, not the app build — see OtherVersions.tsx,
// which carries the same line and the same reason: tsx/esbuild runs the test
// files from the repo root, where no tsconfig sets `jsx`.
import { useEffect, useState } from 'react';
import {
  MAX_WARNING_LABEL,
  publishedWarningsFor,
  type PublishedWarning,
  type PublishedWarningEntry,
} from '@lc/core';
import { ApiError, api, type Me } from '../api.js';
import { describeError } from '../lib/errors.js';
import { describeStoreError } from '../lib/error-wording.js';
import { currentUid } from '../lib/firebase.js';
import { buildNoteRows, type NoteRow } from '../lib/note-rows.js';
import {
  fetchPublishedWarnings,
  fetchWarnings,
  removeWarning,
  writeWarning,
  type WarningView,
} from '../lib/warnings.js';

/**
 * "Content notes" — what is in this book, from both catalogs.
 *
 * The 2026-08-17 port of the audiobook site's content-warning feature (owner:
 * *"port content warning feature over to all physical book and the ebook
 * site"*). Two sources, kept visibly apart because they are different kinds of
 * claim:
 *
 * | Source | Where it comes from | Who wrote it |
 * |---|---|---|
 * | **Published** | `audiobooks.heygabi.ai/content_warnings.json` — StoryGraph, Hardcover and web sources, gathered by that repo's pipeline | nobody in this household; each carries a link to its source |
 * | **Reader notes** | Firestore `user_content_warnings`, the shared collection | a person, named beside their note |
 *
 * ## ⚠️ The whole feature is the key, and the key is not ours
 *
 * A note is filed under `bookId` — a slug of the title as the AUDIOBOOK
 * catalog spells it. This catalog spells 33 of its 92 matched books
 * differently, 27 of them differently enough to produce a different slug
 * (measured 2026-08-17), so a note keyed on `work.title` would be invisible on
 * that site AND blind to everything written there. The Worker derives the ids
 * from `audiobook_holding.title`; see `packages/core/src/warnings.ts`. Nothing
 * in this component may compute a key.
 *
 * ## ⚠️ Deletes are gated by firestore.rules, not by this page
 *
 * `canDeleteUserWarning()` in `audiobook_catalog/firestore.rules` allows the
 * document's own `authorUid` or an estate `site_roles` moderator/admin.
 * `moderateContent` here decides what to *draw*; the refusal, if the two ever
 * disagree, is worded by `describeStoreError` rather than surfacing as
 * "Missing or insufficient permissions."
 */

interface Keys {
  collection: string;
  bookIds: string[];
  publishedTitle: string | null;
  audiobookTitle?: string | null;
  held?: string;
}

export function ContentNotes({ workId, me }: { workId: number; me: Me }) {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [notes, setNotes] = useState<WarningView[] | null>(null);
  const [published, setPublished] = useState<{
    checked: boolean;
    warnings: PublishedWarning[];
  } | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdd = me.capabilities.includes('trackReading');
  const canModerate = me.capabilities.includes('moderateContent');
  const myName = me.reviewName ?? me.displayName ?? me.email;

  async function load() {
    try {
      const k = (await api.warningKeys(workId)) as Keys;
      setKeys(k);
      if (k.held || k.bookIds.length === 0) {
        setNotes([]);
        setPublished(null);
        return;
      }
      setNotes(await fetchWarnings(k.collection, k.bookIds));

      // ⚠️ Only asked for a book that HAS an audiobook holding — the file is
      // ~200 KB and keyed by that catalog's titles, so for the other 259 works
      // it could answer nothing anyway. See `fetchPublishedWarnings`.
      if (k.publishedTitle) {
        const file = (await fetchPublishedWarnings()) as Record<string, PublishedWarningEntry> | null;
        setPublished(publishedWarningsFor(file, k.publishedTitle));
      } else {
        setPublished(null);
      }
    } catch (err) {
      // The shared store being unreachable must not take the page down — the
      // book, its editions and its copies are all in D1 and still worth showing.
      setError(describeError(err));
      setNotes([]);
    }
  }

  useEffect(() => {
    setKeys(null);
    setNotes(null);
    setPublished(null);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  async function add() {
    const trimmed = label.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      // The Worker builds the id and the payload — including `authorUid` from
      // the verified token, which is what makes this note removable by its
      // author later. The browser does the write, with its own credentials.
      const draft = await api.warningDraft(workId, { label: trimmed });
      await writeWarning(draft.collection, draft.docId, draft.doc);
      setLabel('');
      await load();
    } catch (err) {
      // ⚠️ Two stores, two vocabularies. The draft call is the Worker (an
      // `ApiError` — role refusals, the authorless 409), the write is Firestore
      // (a `FirebaseError`). One `describeError` for both would print the SDK's
      // raw "Missing or insufficient permissions." as though it were a sentence.
      setError(err instanceof ApiError ? describeError(err) : describeStoreError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: NoteRow) {
    if (!keys) return;
    if (!row.canDelete) {
      setError(row.refusal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeWarning(keys.collection, row.id);
      await load();
    } catch (err) {
      // ⚠️ The one refusal worth naming precisely: this catalog's moderator
      // role and the estate's `site_roles` are different records, so a library
      // moderator with no estate role is refused BY FIRESTORE after being
      // offered the control. Saying which role is missing is the difference
      // between an actionable ask and a button that appears broken.
      setError(
        describeStoreError(err, row.asModerator ? { need: 'the estate-wide moderator role' } : undefined),
      );
    } finally {
      setBusy(false);
    }
  }

  const rows = buildNoteRows({
    warnings: notes ?? [],
    uid: currentUid(),
    displayName: myName,
    canModerate,
  });

  const nothingAtAll =
    notes !== null && rows.length === 0 && (!published || published.warnings.length === 0);

  return (
    <section className="panel">
      <h3>Content notes</h3>

      {keys?.held ? (
        // ⚠️ Held explanation ONLY — the "add the author" call-to-action lives in
        // exactly one place (the Ratings & reviews panel above). This panel used
        // to repeat it, so an authorless book showed the SAME "edit the author"
        // prompt twice (owner: "on edit author it pops up a SECOND prompt to edit
        // author"). One prompt now; this just says why the notes are empty.
        <p className="muted small">{keys.held}</p>
      ) : notes === null ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          {/* ⚠️ Published first, and labelled with WHOSE list it is and which
              title it was found under. Provenance shown, never hidden — the
              rule `OtherVersions` states — and it matters more here, because
              the audiobook catalog matches some books by containment and the
              entry may be the series' base volume rather than this one. */}
          {published?.warnings.length ? (
            <>
              <p className="muted small">
                From published sources for &ldquo;{keys?.publishedTitle}&rdquo; on the audiobook
                catalog:
              </p>
              <ul className="reviews">
                {published.warnings.map((w, i) => (
                  <li key={`${w.label}-${i}`}>
                    {w.source_url ? (
                      <a href={w.source_url} target="_blank" rel="noopener noreferrer">
                        {w.label}
                      </a>
                    ) : (
                      w.label
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : published?.checked ? (
            // ⚠️ "Looked and found none" is a different fact from "nobody
            // looked", and it is the more useful one. Never collapsed.
            <p className="muted small">
              Published sources have been checked for this book and listed none.
            </p>
          ) : null}

          {rows.length > 0 && (
            <ul className="reviews">
              {rows.map((row) => (
                <li key={row.id}>
                  <div className="row-tight">
                    <strong>{row.label}</strong>
                    <span className="muted small">added by {row.credit}</span>
                    {/* ⚠️ Not rendered at all for somebody who may not use it —
                        the estate rule prefers withholding a control to showing
                        one that refuses. The refusal sentence still exists, for
                        the case where the rules disagree with us. */}
                    {row.canDelete && (
                      <button
                        className="chip"
                        disabled={busy}
                        onClick={() => void remove(row)}
                        title={row.asModerator ? 'Remove as a moderator' : 'Remove your note'}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {nothingAtAll && (
            <p className="muted small">
              No content notes yet — on either site.
              {keys?.publishedTitle ? '' : ' Nobody has checked published sources for this book.'}
            </p>
          )}
        </>
      )}

      {canAdd && !keys?.held && (
        <>
          <div className="row-tight">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Animal cruelty"
              maxLength={MAX_WARNING_LABEL}
              aria-label="Add a content note"
            />
            <button
              className="primary"
              disabled={busy || !label.trim()}
              onClick={() => void add()}
            >
              {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
          <p className="muted small">
            {/* Said out loud for the same reason the review panel says it: this
                writes to the audiobook catalog's own record for this book, and
                a person should know where their words are going. */}
            {MAX_WARNING_LABEL} characters or fewer. This is written to the same place as the
            audiobook site&rsquo;s content warnings — it will show up on both sites
            {keys?.audiobookTitle ? `, under “${keys.audiobookTitle}”` : ''}. One note per topic;
            adding the same one again replaces it.
          </p>
        </>
      )}

      {error && <p className="muted small">{error}</p>}
    </section>
  );
}
