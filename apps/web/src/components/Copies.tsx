import { useEffect, useState } from 'react';
import {
  CONDITIONS,
  COPY_STATUSES,
  EDITION_FORMATS,
  PHYSICAL_FORMATS,
  printingCandidates,
} from '@lc/core';
import { api, type Member } from '../api.js';
import { describeError } from '../lib/errors.js';
import { formatLabel } from '../lib/formats.js';
import { printingLabel } from '../lib/rescans.js';
import { STATUS_LABEL, arrivedPatch } from '../lib/statuses.js';
import { type EditionView } from './Editions.js';
import { EditionPickerPrompt, type NewPrintingDetails } from './RescanPrompt.js';

/**
 * The copies of one book — and the only place `copy.status` has ever been
 * writable from this app.
 *
 * ## The distinction the panel exists to keep visible
 *
 * An **edition** is a printing that exists in the world; a **copy** is one we
 * have, want, lent or sold. The catalog holds 118 editions and, until this
 * panel, **zero copies of any status** — every book in it was known as a file
 * with nothing recorded about whether it is on a shelf.
 *
 * ⚠️ Recording a wish must therefore not require an edition, and it does not:
 * `copy.edition_id` is nullable precisely so a copy can exist before its exact
 * printing is known (migration 0001). Wanting *the hardcover of Cradle 1* when
 * no hardcover edition is catalogued is the ordinary case, not an edge one.
 *
 * ## Physical formats are first-class here
 *
 * Physical books are being added to this catalog shortly. The format select
 * offers the three physical formats first and creates an `edition` row when one
 * is chosen, because "I want it in hardcover" is a statement about a printing
 * and belongs on the printing. Choosing nothing is allowed and common: a wish
 * with no format is "I want this book, in whatever comes".
 */

export interface CopyView {
  id: number;
  status: string;
  location: string | null;
  condition: string | null;
  /** ⚠️ Deprecated by migration 0400 — read `person_name`. Never written from here any more. */
  lent_to: string | null;
  /**
   * WHO has it. ⚠️ **Both may be null because the server REDACTED them**, not
   * only because nobody was recorded — the two are indistinguishable here on
   * purpose (`apps/worker/src/lib/copy-person.ts`). A reader who may not see
   * the name sees the status word and nothing else, which is why this panel
   * never renders "nobody recorded" against a lent copy: it does not know.
   */
  person_user_id: number | null;
  /** Already resolved to the member's CURRENT display name when an id is linked. */
  person_name: string | null;
  is_signed: number;
  /** Special-edition attributes, first-class since migration 0430. 0/1. */
  sprayed_edges: number;
  leatherbound: number;
  slipcase: number;
  edition_id: number | null;
  notes: string | null;
  /** Null until it turns up. `arrivedPatch` fills it, and only when it is null. */
  acquired_on: string | null;
}

/**
 * The three statuses that can carry a person, and how each one reads.
 *
 * ⚠️ **Three sentences, not one with the name swapped in.** "Lent to Samantha"
 * and "Borrowed from Samantha" are opposite claims about who owns the book, and
 * a single "Person: Samantha" row would leave the reader to guess which. The
 * direction is the fact; the name is the detail.
 *
 * Mirrors `PERSON_STATUSES` in `packages/db/src/editions.ts`, which is the
 * enforcing copy — this one only decides wording.
 */
const PERSON_PHRASE: Record<string, { said: string; asks: string; hint: string }> = {
  lent: {
    said: 'Lent to',
    asks: 'Who has it?',
    hint: 'The person it went to',
  },
  borrowed: {
    said: 'Borrowed from',
    asks: 'Whose is it?',
    hint: 'The person it belongs to',
  },
  sold: {
    said: 'Sold to',
    asks: 'Who bought it?',
    hint: 'The person it went to',
  },
};

/**
 * The special-edition attributes, first-class since migration 0430 — each an
 * independent boolean on ONE copy, editable at any time. A book comes home from
 * an event signed, sprayed or slipcased months after it was recorded, so all
 * four are toggles on an existing copy, not just checkboxes on the add form.
 *
 * ⚠️ **One list so the toggle chips and the summary line cannot drift**, and so
 * a fifth attribute is one row here rather than a fourth place to edit. `field`
 * is the `CopyView` column (snake_case, 0/1); `patch` is the write key the
 * schema models (camelCase, boolean).
 *
 * ⚠️ **Both directions are spelled out** (`mark` / `unmark`), per CoverPanel's
 * reason the signed button already followed: un-marking is the rarer press and
 * the one nobody would guess exists, so neither is a checkbox whose meaning
 * depends on which way it happens to be sitting.
 *
 * ⚠️ `leatherbound` implies the hardcover format (`LEATHER_IMPLIES_FORMAT`).
 * That is derived where format is read (the shelf hero, the collection filter),
 * not asserted here — the copy may have no edition linked to make hardcover.
 */
const SPECIAL_TOGGLES: {
  field: 'is_signed' | 'sprayed_edges' | 'leatherbound' | 'slipcase';
  patch: 'isSigned' | 'sprayedEdges' | 'leatherbound' | 'slipcase';
  mark: string;
  unmark: string;
}[] = [
  { field: 'is_signed', patch: 'isSigned', mark: 'Mark signed', unmark: 'Not signed' },
  {
    field: 'sprayed_edges',
    patch: 'sprayedEdges',
    mark: 'Mark sprayed edges',
    unmark: 'Remove sprayed edges',
  },
  {
    field: 'leatherbound',
    patch: 'leatherbound',
    mark: 'Mark leatherbound',
    unmark: 'Remove leatherbound',
  },
  { field: 'slipcase', patch: 'slipcase', mark: 'Mark slipcase', unmark: 'Remove slipcase' },
];

export function Copies({
  workId,
  copies,
  editions,
  canEdit,
  canSuggest,
  canListMembers,
  onChanged,
}: {
  workId: number;
  copies: CopyView[];
  /** The full rows — the picker's labels need name, kind and ISBN to tell printings apart. */
  editions: EditionView[];
  /** `editCatalog`/`manageWishlist` — recording a real copy, and every action on an existing one. */
  canEdit: boolean;
  /**
   * `suggestWishlist` (2026-08-16 split) — "Want this" alone, so a `member`
   * who cannot record a copy or touch an existing one can still ask for a
   * book. `POST /copies` on the server permits exactly this: `editCatalog`'s
   * role set is a subset of `suggestWishlist`'s, so `canEdit` members always
   * satisfy this too — the prop exists to WIDEN who sees the button, never to
   * narrow it further than `canEdit` already does.
   */
  canSuggest: boolean;
  /**
   * Whether this person may LIST the estate's members, and so whether the name
   * box can autocomplete. Now `editCatalog` — the same capability the person
   * field itself requires — so every editor who can record who has a book also
   * gets the picker.
   *
   * ⚠️ **It reads the NARROW `GET /api/members` (id + displayName only), never
   * the admin `GET /api/users`.** OR-1 first shipped this admin-only because the
   * only roster then was `manageUsers`-gated and handed out email, photo and
   * role; the owner then asked for the picker to work for every editor, so a
   * second endpoint answering only what a datalist needs was added beside
   * `/users` rather than widening it. The prop stays because the picker still
   * degrades to a plain typed box if the roster ever fails to load.
   */
  canListMembers: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState<null | 'owned' | 'wanted'>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The copy whose "which printing is this?" question is open, if any. */
  const [linking, setLinking] = useState<number | null>(null);
  /** The copy whose "who has it?" box is open, if any. */
  const [naming, setNaming] = useState<number | null>(null);
  /**
   * The estate's members, fetched ONCE and only when a name box is actually
   * opened — the ordinary book page has no lent copy and must not spend a
   * request on this. `null` means not asked yet; `[]` means asked and there is
   * nothing to offer, which is a different thing and is said differently.
   */
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersFailed, setMembersFailed] = useState(false);

  useEffect(() => {
    if (naming === null || !canListMembers || members !== null || membersFailed) return;
    let live = true;
    void api
      .members()
      .then((r) => {
        if (live) setMembers(r.members);
      })
      .catch(() => {
        // ⚠️ Not surfaced as an error banner: the box still works, it just
        // cannot suggest. `membersFailed` makes the field say that in words
        // rather than sitting there looking like an empty roster.
        if (live) setMembersFailed(true);
      });
    return () => {
      live = false;
    };
  }, [naming, canListMembers, members, membersFailed]);

  /**
   * ⚠️ Answers whether the write LANDED, and the refusal is shown either way.
   * A form that closes itself on a 400 has thrown away what the person typed
   * and told them it was refused in the same motion — the person field stays
   * open on a refusal so the wording is beside the box it is about.
   */
  async function change(copyId: number, body: Record<string, unknown>): Promise<boolean> {
    setBusy(copyId);
    setError(null);
    try {
      await api.updateCopy(copyId, body);
      setLinking(null);
      onChanged();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * The picker's "a different printing" answer for an EXISTING copy: create
   * the described edition, then link. Two writes, create first — if the link
   * then fails, the printing row is real and the copy is still honestly
   * unlinked, which the panel shows; the reverse order could not exist (there
   * is nothing to link to yet).
   */
  async function createAndLink(copyId: number, details: NewPrintingDetails) {
    setBusy(copyId);
    setError(null);
    try {
      const created = await api.createEdition({
        workId,
        format: details.format,
        editionName: details.editionName,
        // Migration 0460 — the "no barcode" observation, which used to ride
        // inside `editionName` and now has a column of its own.
        note: details.note,
        publisher: details.publisher,
        publishedYear: details.publishedYear,
        source: 'manual',
      });
      await api.updateCopy(copyId, { editionId: created.edition.id });
      setLinking(null);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(copyId: number) {
    setBusy(copyId);
    setError(null);
    try {
      await api.deleteCopy(copyId);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  const wanted = copies.filter((c) => c.status === 'wanted' || c.status === 'preordered');

  return (
    <section className="panel">
      <h3>Copies</h3>

      {copies.length === 0 ? (
        <p className="muted small">
          Nothing recorded. An edition existing is not the same as a copy on the shelf — and
          nor is it the same as wanting one.
        </p>
      ) : (
        <ul className="plain">
          {copies.map((c) => (
            <li key={c.id}>
              <div className="copy">
                <div className="copy__text">
                  <strong>{STATUS_LABEL[c.status] ?? c.status}</strong>
                  <span className="muted small">
                    {[
                      c.edition_id
                        ? formatLabel(editions.find((e) => e.id === c.edition_id)?.format ?? '')
                        : null,
                      c.location,
                      c.condition,
                      c.is_signed ? 'signed' : null,
                      c.sprayed_edges ? 'sprayed edges' : null,
                      c.leatherbound ? 'leatherbound' : null,
                      c.slipcase ? 'slipcase' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {/* ⚠️ Rendered only when the server actually sent a name.
                      Both person fields arrive null both when nobody was
                      recorded AND when the reader may not see who it is
                      (`lib/copy-person.ts`), and this panel cannot tell those
                      apart — so it says nothing rather than "nobody has it",
                      which would be a claim it has no evidence for. The status
                      word above is what such a reader gets, and it is enough:
                      "Lent out" is true whether or not you may know to whom. */}
                  {PERSON_PHRASE[c.status] && c.person_name && (
                    <span className="muted small">
                      {PERSON_PHRASE[c.status]?.said} {c.person_name}
                      {c.person_user_id !== null && (
                        // The one visible difference between a linked person
                        // and a typed one. It matters because a linked name
                        // follows their account and a typed one does not.
                        <span title="Linked to their account here"> · linked</span>
                      )}
                    </span>
                  )}
                  {c.notes && <span className="muted small">{c.notes}</span>}
                </div>
                {canEdit && (
                  <div className="copy__actions">
                    {/* ⚠️ Offered only on a copy that is actually on its way, and
                        it is not a shortcut for the select beside it: the select
                        writes `status` alone, where arriving also dates the copy.
                        The wishlist's checklist is where a whole parcel is
                        settled; this is for meeting one book on its own page. */}
                    {c.status === 'preordered' && (
                      <button
                        className="chip primary"
                        disabled={busy === c.id}
                        onClick={() => void change(c.id, arrivedPatch(c.acquired_on))}
                      >
                        It arrived
                      </button>
                    )}
                    {/* ⚠️ Signing is a fact about a COPY, learned at any time —
                        a book comes home from an event signed months after it
                        was recorded. Until 2026-08-22 the only Signed control
                        was the checkbox on the AddCopy form below, so the fact
                        could be captured while first recording a copy and never
                        afterwards; the owner reported it as a control that had
                        gone missing. `PATCH /api/copies/:id` already accepted
                        `isSigned` (updateCopySchema is createCopySchema
                        .partial(), so a one-key patch resets nothing) — only
                        the button was absent.

                        Both directions, spelled out, for CoverPanel’s reason:
                        un-marking is the rarer press and the one nobody would
                        guess exists, so neither is a checkbox whose meaning
                        depends on which way it happens to be sitting.

                        Since 0430 the same treatment covers sprayed edges,
                        leatherbound and slipcase — driven off SPECIAL_TOGGLES so
                        the four cannot drift from the summary line above. */}
                    {SPECIAL_TOGGLES.map((t) => (
                      <button
                        key={t.field}
                        className={`chip${c[t.field] ? ' primary' : ''}`}
                        disabled={busy === c.id}
                        onClick={() => void change(c.id, { [t.patch]: !c[t.field] })}
                      >
                        {c[t.field] ? t.unmark : t.mark}
                      </button>
                    ))}
                    <label className="field">
                      <span className="field__label">Status</span>
                      <select
                        value={c.status}
                        disabled={busy === c.id}
                        onChange={(e) => void change(c.id, { status: e.target.value })}
                      >
                        {COPY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s] ?? s}
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* ⚠️ "Which printing do I own?" — the question 172 copies
                        could not answer (67% of production copies carried a
                        NULL edition_id when the rescan flow started closing
                        it). A barcode scan answers it for books that have
                        one; this is the only route for the Kickstarter and
                        Illumicrate printings that never did. Same question,
                        same vocabulary: the picker is the rescan prompt's
                        sibling, not a third protocol. */}
                    <button
                      className="chip"
                      disabled={busy === c.id}
                      onClick={() => setLinking(linking === c.id ? null : c.id)}
                    >
                      {linking === c.id
                        ? 'Cancel'
                        : c.edition_id
                          ? 'Change printing'
                          : 'Which printing?'}
                    </button>
                    {/* ⚠️ Offered only on the three statuses that can carry a
                        person. The server refuses the rest in words, and a
                        control that exists only to be refused is worse than no
                        control — so the order is: set the status, then say who
                        has it, which is also the order the events happen in. */}
                    {PERSON_PHRASE[c.status] && (
                      <button
                        className="chip"
                        disabled={busy === c.id}
                        onClick={() => setNaming(naming === c.id ? null : c.id)}
                      >
                        {naming === c.id
                          ? 'Cancel'
                          : c.person_name
                            ? 'Change person'
                            : (PERSON_PHRASE[c.status]?.asks ?? 'Who has it?')}
                      </button>
                    )}
                    <button className="chip" disabled={busy === c.id} onClick={() => void remove(c.id)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
              {naming === c.id && (
                <PersonField
                  copyId={c.id}
                  status={c.status}
                  personName={c.person_name}
                  personUserId={c.person_user_id}
                  members={canListMembers ? members : null}
                  membersUnavailable={!canListMembers || membersFailed}
                  busy={busy === c.id}
                  onSave={(patch) => {
                    void change(c.id, patch).then((ok) => {
                      if (ok) setNaming(null);
                    });
                  }}
                  onCancel={() => setNaming(null)}
                />
              )}
              {linking === c.id && (
                <EditionPickerPrompt
                  candidates={printingCandidates(editions, null).map((e) => ({
                    editionId: e.id,
                    label: printingLabel(e),
                  }))}
                  editions={editions}
                  fixedFormat={null}
                  allowUnlinked={false}
                  busy={busy === c.id}
                  onPick={(editionId) => void change(c.id, { editionId })}
                  onNewPrinting={(details) => void createAndLink(c.id, details)}
                  onDismiss={() => setLinking(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      {(canEdit || canSuggest) && (
        <>
          <div className="row-tight">
            {canEdit && (
              <button onClick={() => setAdding(adding === 'owned' ? null : 'owned')}>
                {adding === 'owned' ? 'Cancel' : 'Record a copy'}
              </button>
            )}
            {/* Offered even when a copy is already recorded: wanting a second
                form of a book you own is the normal case here, not an error.
                Gated on `canSuggest` (`suggestWishlist`), not `canEdit` — a
                member who cannot record a copy can still ask for one. */}
            {canSuggest && (
              <button
                className={wanted.length ? '' : 'primary'}
                onClick={() => setAdding(adding === 'wanted' ? null : 'wanted')}
              >
                {adding === 'wanted' ? 'Cancel' : 'Want this'}
              </button>
            )}
          </div>

          {adding && (
            <AddCopy
              workId={workId}
              intent={adding}
              editions={editions}
              onSaved={() => {
                setAdding(null);
                onChanged();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * WHO has the book — a themed text box that saves, with autocomplete over the
 * estate's members when the person filling it in may see the roster.
 *
 * Owner request OR-1, verbatim: *"if i loaned out a book to Samantha I should
 * be able to put her name in a text box that matches the theme and saves. if
 * Samantha is a user in the estate i should be able to autofill to her user
 * profile so its linked to her."* Both halves, and the free-text half is the
 * floor: most people you lend a book to have never signed into this catalog.
 *
 * ## Why a `<datalist>` and not a picker of its own
 *
 * It is one control that is both halves at once — type any name, or take one
 * that is offered — which is exactly the ask. A select plus a text box would
 * make the person choose *which kind of person* Samantha is before typing her
 * name. It is also native, so it behaves on a 360px phone, the argument the
 * collection's filter row already makes for using selects there.
 *
 * ## ⚠️ How a typed name becomes a LINK
 *
 * On save, the typed text is matched against the offered display names, folded
 * for case. **Exactly one match links; zero or several do not**, and the
 * several-case says so rather than picking. Two members called Sam are
 * indistinguishable by the only thing this box holds, and guessing would file
 * a book against the wrong person's page — the failure the whole
 * `person_user_id` column exists to prevent.
 *
 * The pair is always sent TOGETHER (`personUserId` + `personName`), so a
 * correction cannot half-land: editing "Sam" to "Samantha Ellis" clears the old
 * link in the same request that writes the new name.
 */
function PersonField({
  copyId,
  status,
  personName,
  personUserId,
  members,
  membersUnavailable,
  busy,
  onSave,
  onCancel,
}: {
  copyId: number;
  status: string;
  personName: string | null;
  personUserId: number | null;
  /** Null when they have not loaded, or when this person may not list them. */
  members: Member[] | null;
  /** True when no autocomplete is coming — say so, do not show an empty list. */
  membersUnavailable: boolean;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState(personName ?? '');
  const phrase = PERSON_PHRASE[status];
  const listId = `members-${copyId}`;

  /** Members with a usable name, and only their name — nothing else is read here. */
  const named = (members ?? []).filter(
    (m): m is Member & { displayName: string } => Boolean(m.displayName),
  );
  const fold = (s: string) => s.trim().toLowerCase();
  const matches = named.filter((m) => fold(m.displayName) === fold(typed));
  const willLink = typed.trim() !== '' && matches.length === 1 ? matches[0] : null;
  const ambiguous = matches.length > 1;

  function save() {
    const name = typed.trim();
    if (name === '') {
      // Clearing the box clears the record — both halves, so an emptied name
      // cannot leave a link behind pointing at somebody the card no longer says.
      onSave({ personUserId: null, personName: null });
      return;
    }
    onSave({ personUserId: willLink?.id ?? null, personName: name });
  }

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">{phrase?.asks ?? 'Who has it?'}</span>
        <input
          value={typed}
          list={named.length > 0 ? listId : undefined}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={phrase?.hint ?? 'Their name'}
          aria-label={phrase?.asks ?? 'Who has it?'}
          disabled={busy}
        />
      </label>
      {named.length > 0 && (
        <datalist id={listId}>
          {named.map((m) => (
            <option key={m.id} value={m.displayName} />
          ))}
        </datalist>
      )}

      {/* ⚠️ Every one of these is a SENTENCE, not a badge. What a person needs
          to know here is whether the record will follow an account or sit as
          text, and those have different consequences a year from now. */}
      {willLink && (
        <p className="muted small">
          Linked to {willLink.displayName}’s account — the card will follow their
          name if they change it.
        </p>
      )}
      {ambiguous && (
        <p className="notice notice--bad small">
          More than one member here is called “{typed.trim()}”, so this cannot be
          linked to an account without guessing which. The name will be saved as
          typed — which is a complete record, just not a linked one.
        </p>
      )}
      {!willLink && !ambiguous && typed.trim() !== '' && (
        <p className="muted small">
          Saved as typed. {named.length > 0 ? 'No member here goes by that name' : 'Not linked to an account'} — which is
          the ordinary case for somebody outside the estate.
        </p>
      )}
      {membersUnavailable && (
        <p className="muted small">
          {/* ⚠️ A capability said in words, never a silently missing feature.
              The name box works for everyone who may edit the catalog; only
              the suggestions need the Members permission. */}
          Names of estate members are not suggested here — that needs the Members
          permission. Typing the name still records it in full.
        </p>
      )}

      <div className="row-tight">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={busy}>
          Never mind
        </button>
        {(personName !== null || personUserId !== null) && (
          <button
            onClick={() => onSave({ personUserId: null, personName: null })}
            disabled={busy}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Record a copy — owned, or wanted.
 *
 * One form for both, because they differ only in the status it starts on and in
 * which fields are worth asking for. Two forms would be two places to fix the
 * "create the edition first" step below.
 *
 * ## ⚠️ EXPORTED since 2026-09-04, and the export is the whole point
 *
 * The work page's first-class *Want this* button (`WorkPage.tsx`, under ON YOUR
 * SHELF) opens **this component**, with `intent='wanted'`. It is the same ask
 * the button inside ✎ Edit → Editions & copies makes, reached from where a
 * phone can actually find it — the owner, 2026-09-04: *"We currently can't add
 * to wishlist at all."*
 *
 * ⚠️ There is no second form and there must not be one. A copied field list
 * would drift from the wish rules argued inside `save` below — that a wish
 * mints no edition, and that the chosen format is recorded on the COPY as
 * `wanted as …` instead. Those are the rules the wishlist reads.
 */
/** The person's answer to "which printing is this?", carried into the save. */
type PrintingAnswer =
  | { kind: 'existing'; editionId: number }
  | { kind: 'new'; details: NewPrintingDetails }
  | { kind: 'unlinked' };

export function AddCopy({
  workId,
  intent,
  editions,
  onSaved,
}: {
  workId: number;
  intent: 'owned' | 'wanted';
  editions: EditionView[];
  onSaved: () => void;
}) {
  const [format, setFormat] = useState('');
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [vendor, setVendor] = useState('');
  const [notes, setNotes] = useState('');
  const [signed, setSigned] = useState(false);
  // The other three special-edition attributes (0430), keyed by their write key
  // so the create body below is one spread rather than four fields to forget.
  const [special, setSpecial] = useState({
    sprayedEdges: false,
    leatherbound: false,
    slipcase: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** "Record it" stopped and asked which printing — the rescan contract, no barcode. */
  const [asking, setAsking] = useState(false);

  async function save(answer?: PrintingAnswer) {
    setBusy(true);
    setError(null);
    try {
      // ⚠️ A format names a *printing*, so an owned copy has to point at an
      // `edition` row.
      //
      // ⚠️ **This used to reuse any existing edition of the same format
      // silently** — which made "a second, different printing of the same
      // format" literally unsayable and is what forced #341 (two different
      // hardcovers of one book) into raw SQL. Now it stops and ASKS, the
      // rescan prompt's contract with no barcode in hand: nothing is written
      // until a button that names its writes is pressed, and "not sure"
      // records the copy honestly unlinked. The 83-duplicate-editions lesson
      // (`findEditionBySourceUrl` in `@lc/db`) still holds — only a person
      // choosing may create a same-format sibling, and the server refuses a
      // sibling carrying nothing to tell it apart.
      //
      // ⚠️ **A wish creates no edition**, and that is load-bearing rather than
      // lazy. `reportFor` in `@lc/db` decides whether a work is held or merely
      // wished for by asking whether it has any edition at all — the only signal
      // available while `copy` is an empty table. Minting an edition for a wish
      // would make a brand-new wished-for book read as owned the moment somebody
      // said which format they wanted. The format is recorded on the copy
      // instead, which is where a fact about one specific copy belongs.
      let editionId: number | null = null;
      if (format && intent === 'owned') {
        const candidates = printingCandidates(editions, format);
        if (candidates.length > 0 && !answer) {
          // Asked BEFORE the first write, exactly as the rescan prompt is:
          // an unanswered question leaves the catalog untouched.
          setBusy(false);
          setAsking(true);
          return;
        }
        if (answer?.kind === 'existing') {
          editionId = answer.editionId;
        } else if (answer?.kind === 'new') {
          editionId = (
            await api.createEdition({
              workId,
              format: answer.details.format,
              editionName: answer.details.editionName,
              note: answer.details.note,
              publisher: answer.details.publisher,
              publishedYear: answer.details.publishedYear,
              source: 'manual',
            })
          ).edition.id;
        } else if (answer?.kind !== 'unlinked') {
          // First printing of this format — nothing to confuse it with, so
          // it is created without a question, as it always was.
          editionId = (await api.createEdition({ workId, format, source: 'manual' })).edition.id;
        }
      }

      await api.createCopy({
        workId,
        editionId,
        status: intent,
        location: location.trim() || null,
        condition: condition || null,
        vendor: vendor.trim() || null,
        isSigned: signed,
        ...special,
        editionNotes: format && intent === 'wanted' ? `wanted as ${formatLabel(format)}` : null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">Format</span>
        {/* Changing the format retracts an open printing question — its
            candidates belonged to the old format. */}
        <select
          value={format}
          onChange={(e) => {
            setFormat(e.target.value);
            setAsking(false);
          }}
        >
          <option value="">
            {intent === 'wanted' ? 'Any — whatever comes' : 'Not recorded'}
          </option>
          {/* Physical first, because that is what a copy on a shelf is, and
              because the physical half of this collection is about to arrive. */}
          <optgroup label="Physical">
            {PHYSICAL_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatLabel(f)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Files and licences">
            {EDITION_FORMATS.filter((f) => !PHYSICAL_FORMATS.includes(f)).map((f) => (
              <option key={f} value={f}>
                {formatLabel(f)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      {intent === 'owned' && (
        <>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Where it lives — “living room shelf 3”"
            aria-label="Location"
          />
          <label className="field">
            <span className="field__label">Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Not recorded</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="row-tight">
            <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
            <span>Signed</span>
          </label>
          {/* The other three special-edition attributes (0430). Same checkbox
              grammar as Signed; each is an independent fact about this copy, and
              leatherbound implies hardcover where the format is later derived. */}
          {(
            [
              ['sprayedEdges', 'Sprayed edges'],
              ['leatherbound', 'Leatherbound'],
              ['slipcase', 'Slipcase'],
            ] as const
          ).map(([key, label]) => (
            <label className="row-tight" key={key}>
              <input
                type="checkbox"
                checked={special[key]}
                onChange={(e) => setSpecial((s) => ({ ...s, [key]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </>
      )}

      <input
        value={vendor}
        onChange={(e) => setVendor(e.target.value)}
        placeholder={intent === 'wanted' ? 'Where to get it' : 'Where it came from'}
        aria-label="Vendor"
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        aria-label="Notes"
      />

      {error && <p className="notice notice--bad small">{error}</p>}

      {asking ? (
        /* "Record it" stopped here: a printing of this format is already on
           file, and which one this copy is cannot be guessed — guessing is
           how a second Target hardcover used to be erased into the trade
           row. Every button names its writes; "never mind" returns to the
           form with nothing written. */
        <EditionPickerPrompt
          candidates={printingCandidates(editions, format).map((e) => ({
            editionId: e.id,
            label: printingLabel(e),
          }))}
          editions={editions}
          fixedFormat={format}
          allowUnlinked
          busy={busy}
          onPick={(editionId) => void save({ kind: 'existing', editionId })}
          onNewPrinting={(details) => void save({ kind: 'new', details })}
          onUnlinked={() => void save({ kind: 'unlinked' })}
          onDismiss={() => setAsking(false)}
        />
      ) : (
        <button className="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : intent === 'wanted' ? 'Add to the wishlist' : 'Record it'}
        </button>
      )}
    </div>
  );
}
