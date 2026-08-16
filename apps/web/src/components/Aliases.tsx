import { useCallback, useEffect, useState } from 'react';
import { WORK_ALIAS_KINDS, type WorkAliasKind } from '@lc/core';
import { api, type WorkAlias } from '../api.js';
import { describeError } from '../lib/errors.js';

/**
 * Other names this book answers to.
 *
 * ## ⚠️ Why this is not an edit box for the title and the author
 *
 * Because those two columns derive `work_key`, and `work_key` is the join to the
 * reviews the audiobook catalog already holds. Correcting *He Who Fights with
 * Monsters* from "Travis Deverell" to "Shirtaloon" would silently move five
 * review keys and orphan whatever is filed under the old ones. An alias is an
 * **addition** — the book keeps its name here and gains another one that lookups
 * may use.
 *
 * ## What each kind actually does
 *
 * The two are not cosmetic variants and the form says so, because picking the
 * wrong one is silent:
 *
 * - **Another title** widens the check that *finds* this book. *Northern Lights*
 *   and *The Golden Compass* are one novel and no similarity score can connect
 *   them, because there is nothing in the two strings to connect.
 * - **Another author** widens the check that *refuses* a wrong book. That check
 *   is load-bearing — it is why five wrong Open Library records did not enter
 *   this catalog — so it opens only for a name somebody has asserted.
 *
 * The measured case: on 2026-08-10 the Open Library backfill missed five *He Who
 * Fights with Monsters* works because Open Library files the series under the pen
 * name Shirtaloon and the author gate refused every candidate, correctly.
 * `docs/info/openlibrary-ids.md` §5 named an author alias as the fix and there
 * was no way to enter one.
 */

const KIND_LABEL: Record<WorkAliasKind, string> = {
  title: 'Another title',
  author: 'Another author',
};

const KIND_BLURB: Record<WorkAliasKind, string> = {
  title:
    'A name this book is printed under somewhere else. “Northern Lights” and “The Golden Compass” are one novel.',
  author:
    'A name its author is filed under somewhere else — a pen name, or a credit this catalog spells differently.',
};

/** What a saved alias is doing, phrased as an effect rather than a category. */
const KIND_EFFECT: Record<WorkAliasKind, string> = {
  title: 'searched for as a title',
  author: 'accepted as this book’s author',
};

export function Aliases({ workId, canEdit }: { workId: number; canEdit: boolean }) {
  const [aliases, setAliases] = useState<WorkAlias[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [alias, setAlias] = useState('');
  // ⚠️ `null` until somebody picks, and Save stays disabled until they do. The
  // schema refuses a request with no `kind` on purpose — the two widen different
  // checks and the wrong one is silent — so a pre-ticked radio here would be the
  // same guess, made by the form instead of the server.
  const [kind, setKind] = useState<WorkAliasKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'new' | null>(null);

  const load = useCallback(() => {
    api
      .aliases(workId)
      .then((r) => setAliases(r.aliases))
      .catch((err: unknown) => setError(describeError(err)));
  }, [workId]);

  useEffect(load, [load]);

  async function save() {
    const value = alias.trim();
    if (value.length < 2 || kind == null) return;
    setBusy('new');
    setError(null);
    try {
      const r = await api.addAlias(workId, { alias: value, kind });
      setAliases(r.aliases);
      setAlias('');
      setAdding(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(aliasId: number) {
    setBusy(aliasId);
    setError(null);
    try {
      setAliases((await api.deleteAlias(workId, aliasId)).aliases);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  // Nothing recorded and nothing you may record: stay off 117 book pages, the
  // same rule the Related panel follows.
  if (!canEdit && (!aliases || aliases.length === 0)) return null;

  return (
    <section className="panel">
      <h3>Also known as</h3>

      {aliases && aliases.length > 0 ? (
        <ul className="plain">
          {aliases.map((a) => (
            <li key={a.id}>
              <div className="row-tight">
                <span className={`mark mark--alias mark--alias-${a.kind}`}>
                  {a.kind === 'title' ? 'Title' : 'Author'}
                </span>
                <strong>{a.alias}</strong>
                <span className="muted small">
                  {KIND_EFFECT[a.kind]}
                  {a.source === 'openlibrary' ? ' · from Open Library' : ''}
                </span>
                {canEdit && (
                  <button
                    className="chip"
                    disabled={busy === a.id}
                    onClick={() => void remove(a.id)}
                    aria-label={`Remove ${a.alias}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          No other names recorded. This is for a book printed under a second title, or an author
          filed elsewhere under a pen name — the two cases no similarity score can work out for
          itself.
        </p>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      {canEdit && (
        <>
          <button onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add a name'}</button>
          {adding && (
            <div className="stack">
              {/* ⚠️ Radio buttons and not a select with a default. The two kinds
                  widen two different checks and the wrong one is silent — the
                  schema refuses a request with no `kind` for the same reason, so
                  the form must not quietly supply one either. */}
              <fieldset className="kind-choice">
                <legend className="field__label">What kind of name</legend>
                {WORK_ALIAS_KINDS.map((k) => (
                  <label key={k} className="kind-choice__option">
                    <input
                      type="radio"
                      name="alias-kind"
                      value={k}
                      checked={kind === k}
                      onChange={() => setKind(k)}
                    />
                    <span>
                      <strong>{KIND_LABEL[k]}</strong>
                      <span className="muted small"> {KIND_BLURB[k]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder={
                  kind === 'author'
                    ? 'e.g. Shirtaloon'
                    : kind === 'title'
                      ? 'e.g. The Golden Compass'
                      : 'The other name'
                }
                aria-label="The other name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
              />
              <p className="muted small">
                The book keeps the title and author it has here. This adds a name lookups may
                use — it never rewrites the ones the reviews are filed under.
              </p>
              <button
                className="primary"
                disabled={busy === 'new' || kind == null || alias.trim().length < 2}
                onClick={() => void save()}
              >
                {busy === 'new'
                  ? 'Saving…'
                  : kind == null
                    ? 'Pick a kind first'
                    : `Save this ${kind === 'author' ? 'author' : 'title'}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
