import { useCallback, useEffect, useState } from 'react';
import { WORK_RELATIONS, type WorkRelation } from '@lc/core';
import { api, type RelatedWork, type WorkSummary } from '../api.js';
import { Cover } from '../components/Cover.js';

/**
 * Books that belong together without sharing a series.
 *
 * ## ⚠️ One relation, two sentences
 *
 * `contains` and `precedes` are directional, and a link stored once has to read
 * correctly from both ends. *The Divine Dungeon Complete Series* **contains**
 * *Dungeon Born*; opening *Dungeon Born* must say **part of**, not "contains".
 * That is what `outgoing` on the API response is for — the server says which end
 * of the stored row you are standing on, and this table turns that into words.
 *
 * The two symmetric relations read the same either way, which is why they are
 * symmetric and why `createWorkRelation` in `@lc/db` sorts *their* ids and not
 * the other two's.
 *
 * ## Everything here is typed by a person, on purpose
 *
 * No source knows the connections this catalog actually needs: nine Sanderson
 * novellas share the Cosmere and carry no series between them; *Invent Short
 * Story* is a sampler of Completionist Chronicles book 7; *Firstborn / Defending
 * Elysium* is a bind-up whose two halves belong in different places. Half this
 * library is absent from Open Library altogether (isbn-ladder.md §4.2), so a
 * feature that waited for an API would never have fired once.
 */

/** [what an outgoing link says, what the same link says from the other end]. */
const RELATION_LABEL: Record<WorkRelation, [string, string]> = {
  same_universe: ['Same universe', 'Same universe'],
  companion: ['Companion', 'Companion'],
  contains: ['Contains', 'Part of'],
  precedes: ['Read before', 'Read after'],
};

/** What the dropdown offers, phrased from the page you are standing on. */
const RELATION_OPTION: Record<WorkRelation, string> = {
  same_universe: 'Same universe — no reading order',
  companion: 'Companion — a guide, sampler or side story',
  contains: 'Contains it — this is the omnibus or bind-up',
  precedes: 'Read before it — this comes first',
};

function label(r: RelatedWork): string {
  const pair = RELATION_LABEL[r.relation];
  return r.outgoing ? pair[0] : pair[1];
}

/**
 * ⚠️ What a `contains` link does NOT mean: a second copy.
 *
 * The owner set the counting rule on 2026-08-12, and it splits in two directions
 * that look similar and are opposites:
 *
 * - Own a book three times → it counts three times. Three objects are three
 *   things you could give away, which is the stated reason the count exists.
 *   That rule lives in `ownedMoreThanOnce`/`heldCopies` and renders as the ×N
 *   mark on the collection.
 * - An omnibus holding five books is still **one object**. It counts once, as
 *   its own line, and the five volumes inside it do not each earn a count. The
 *   owner's words: *"count an Omnibus as its own line item but leave a non
 *   counted addition in each book the omnibus overlaps with."*
 *
 * This sentence is that "non counted addition". Without it the panel shows a
 * bare "Part of" chip, which reads as *another thing on the shelf* — the exact
 * misreading the rule exists to prevent. Saying it in the UI beats leaving it in
 * a note field, because a hand-typed note is only as good as whoever typed it.
 */
function countingNote(r: RelatedWork): string | null {
  if (r.relation !== 'contains') return null;
  return r.outgoing
    ? 'One object on the shelf, counted once — the books it collects are not counted again.'
    : 'The text is inside that book. A cross-reference, not a second copy, so it is not counted.';
}

export function Related({
  workId,
  workTitle,
  canEdit,
  onOpen,
}: {
  workId: number;
  workTitle: string;
  canEdit: boolean;
  onOpen: (id: number) => void;
}) {
  const [related, setRelated] = useState<RelatedWork[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .relations(workId)
      .then((r) => setRelated(r.related))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [workId]);

  useEffect(load, [load]);

  async function unlink(relationId: number) {
    setBusy(relationId);
    try {
      await api.deleteRelation(relationId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Nothing linked and nothing to link with: stay quiet rather than showing an
  // empty section on 117 book pages.
  if (!canEdit && (!related || related.length === 0)) return null;

  return (
    <section className="panel">
      <h3>Related books</h3>

      {related && related.length > 0 ? (
        <ul className="plain">
          {related.map((r) => (
            <li key={r.relationId}>
              <div className="related">
                <button className="related__book" onClick={() => onOpen(r.workId)}>
                  <Cover src={r.coverUrl} title={r.title} size="row" />
                  <span className="row-open__text">
                    <span className="row-open__head">
                      <span className="mark mark--relation">{label(r)}</span>
                      <strong>{r.title}</strong>
                    </span>
                    <span className="muted small">{r.authors}</span>
                    {r.series && (
                      <span className="series-tag">
                        {r.series}
                        {r.seriesIndexDisplay ? <b> {r.seriesIndexDisplay}</b> : null}
                      </span>
                    )}
                    {r.note && <span className="muted small">{r.note}</span>}
                    {countingNote(r) && (
                      <span className="muted small">{countingNote(r)}</span>
                    )}
                  </span>
                </button>
                {canEdit && (
                  <button
                    className="chip"
                    disabled={busy === r.relationId}
                    onClick={() => void unlink(r.relationId)}
                  >
                    Unlink
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          Nothing linked. This is for connections a series column cannot hold — the same
          universe, an omnibus and its parts, a companion volume, or reading order across two
          series.
        </p>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      {canEdit && (
        <>
          <button onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Link a book'}</button>
          {adding && (
            <AddRelation
              workId={workId}
              workTitle={workTitle}
              existing={related ?? []}
              onSaved={(next) => {
                setRelated(next);
                setAdding(false);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * Pick another book from the catalog and say how it is connected.
 *
 * ⚠️ It searches the catalog rather than accepting a typed name. A relation is
 * between two rows; a typed name would need creating a work to point at, and
 * `POST /api/works` deliberately does not dedupe, so a typo would mint a second
 * copy of a book already on the shelf. The sibling project's `AddRelated` panel
 * does accept typed names — it has a `lookup` rung that can propose a real
 * product; this app has none for books, so the honest thing is to require that
 * the other book already be catalogued.
 */
function AddRelation({
  workId,
  workTitle,
  existing,
  onSaved,
}: {
  workId: number;
  workTitle: string;
  existing: RelatedWork[];
  onSaved: (next: RelatedWork[]) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<WorkSummary[]>([]);
  const [picked, setPicked] = useState<WorkSummary | null>(null);
  const [relation, setRelation] = useState<WorkRelation>('same_universe');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    // Debounced against the same endpoint the collection uses, so the search
    // that finds a book here is the search that finds it everywhere.
    const t = setTimeout(() => {
      api
        .collection({ q, pageSize: 10 })
        .then((r) => setHits(r.rows.filter((w) => w.id !== workId)))
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q, workId]);

  const alreadyLinked = picked ? existing.find((r) => r.workId === picked.id) : null;

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const { related } = await api.addRelation(workId, {
        toWorkId: picked.id,
        relation,
        note: note.trim() || null,
      });
      onSaved(related);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPicked(null);
        }}
        placeholder="Which book? Title, author or series…"
        aria-label="Search the catalog"
        autoFocus
      />

      {!picked && hits.length > 0 && (
        <ul className="picker">
          {hits.map((w) => (
            <li key={w.id}>
              <button className="picker__hit" onClick={() => setPicked(w)}>
                <strong>{w.title}</strong>
                <span className="muted small">{w.authors}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!picked && q.trim().length >= 2 && hits.length === 0 && (
        <p className="muted small">
          Nothing in the catalog answers to that. A book has to be catalogued before it can be
          linked — otherwise a typo makes a second row for a book you already have.
        </p>
      )}

      {picked && (
        <>
          <p className="muted small">
            Linking <strong>{workTitle}</strong> to <strong>{picked.title}</strong>.
          </p>
          <label className="field">
            <span className="field__label">How</span>
            <select value={relation} onChange={(e) => setRelation(e.target.value as WorkRelation)}>
              {WORK_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {RELATION_OPTION[r]}
                </option>
              ))}
            </select>
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why, in your words (optional)"
            aria-label="Note"
          />
          {alreadyLinked && (
            <p className="muted small">
              These two are already linked — {label(alreadyLinked).toLowerCase()}. Saving adds a
              second kind of link rather than replacing it.
            </p>
          )}
          {error && <p className="notice notice--bad small">{error}</p>}
          <button className="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Linking…' : 'Link them'}
          </button>
        </>
      )}
    </div>
  );
}
