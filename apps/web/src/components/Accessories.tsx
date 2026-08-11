import { useCallback, useEffect, useState } from 'react';
import { ACCESSORY_KINDS, type AccessoryKind } from '@lc/core';
import { api, type Accessory } from '../api.js';
import type { CopyView } from './Copies.js';

/**
 * The things that came with this book and are not books.
 *
 * *"We can add a section for accessories for stuff that came with a kickstarter
 * or a book … Some books have plushies or pins. Make sure they can all be
 * editted, deleted, and more accessories can be added."* — the owner, 2026-08-10.
 *
 * ## ⚠️ This panel is the ONLY place accessories appear
 *
 * The same sentence continues: *"we don't need ti publish that count on the main
 * page, just keep it each book."* Nothing on the collection screen, in the stat
 * strip or in `/api/collection` knows this table exists, and the API has no
 * collection-wide read to make it possible — see `routes/accessories.ts`.
 *
 * ## Why the copy picker is here and usually empty
 *
 * An accessory really belongs to the **copy**: two backers of one campaign at two
 * tiers get different piles, and a retail paperback next to a Kickstarter deluxe
 * of the same novel does not have the pin. But this catalog holds 120 works and
 * **4 copies**, so requiring one would make the feature fire on four books.
 * `copy_id` is therefore nullable and offered whenever the book has copies —
 * migration 0011 carries the full reasoning. The server refuses a copy belonging
 * to a different book.
 *
 * ⚠️ The measured case that settles it: the purchase scan found a **dust jacket
 * delivered by a later campaign for a book bought in an earlier one** ("V2 or V3
 * Bundle w/ V1 Jacket"). Only separate `copy_id` and `pledge_id` can say that —
 * the jacket belongs to a copy that predates the pledge that sent it.
 *
 * ## Delete arms before it fires
 *
 * Two clicks, ported from the sibling Board Game Catalog's `ConfirmButton`, which
 * says why it is not `window.confirm`: a native dialog blocks the page and reads
 * as heavier than the action deserves. Written with this app's own `.chip`
 * vocabulary rather than importing that project's `.btn` classes, which do not
 * exist in this stylesheet.
 */

const KIND_LABEL: Record<AccessoryKind, string> = {
  plush: 'Plush',
  pin: 'Pin',
  art_print: 'Art print',
  bookmark: 'Bookmark',
  sticker: 'Sticker',
  poster: 'Poster',
  map: 'Map',
  card: 'Card',
  dice: 'Dice',
  coin: 'Coin',
  patch: 'Patch',
  apparel: 'Apparel',
  bag: 'Bag',
  sleeve: 'Sleeve',
  slipcase: 'Slipcase',
  /** Measured: a V1 dust jacket delivered as a reward of a LATER campaign. */
  dust_jacket: 'Dust jacket',
  standee: 'Standee',
  /** An STL or a figure. The scan found a 3D print file among the rewards. */
  model: 'Model',
  signed_plate: 'Signed plate',
  audio: 'Audio',
  other: 'Other',
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind as AccessoryKind] ?? kind;
}

interface FormState {
  name: string;
  kind: AccessoryKind;
  isDigital: boolean;
  quantity: string;
  copyId: string;
  pledgeId: string;
  location: string;
  notes: string;
}

function toForm(existing?: Accessory): FormState {
  return {
    name: existing?.name ?? '',
    kind: (existing?.kind as AccessoryKind) ?? 'other',
    isDigital: existing?.isDigital ?? false,
    quantity: String(existing?.quantity ?? 1),
    copyId: existing?.copyId != null ? String(existing.copyId) : '',
    pledgeId: existing?.pledgeId != null ? String(existing.pledgeId) : '',
    location: existing?.location ?? '',
    notes: existing?.notes ?? '',
  };
}

export function Accessories({
  workId,
  copies,
  canEdit,
}: {
  workId: number;
  copies: CopyView[];
  canEdit: boolean;
}) {
  const [accessories, setAccessories] = useState<Accessory[] | null>(null);
  const [pledges, setPledges] = useState<{ id: number; label: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .accessories(workId)
      .then((r) => setAccessories(r.accessories))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [workId]);

  useEffect(load, [load]);

  // ⚠️ Owner-only, and a 403 here is not an error worth showing. A reader can see
  // that a pin came from a campaign; only an owner may file a new one against a
  // pledge, so the picker is simply absent for everyone else.
  useEffect(() => {
    if (!canEdit) return;
    api
      .pledgeOptions()
      .then((r) => setPledges(r.pledges))
      .catch(() => setPledges([]));
  }, [canEdit]);

  // Nothing recorded and nothing you may record: stay off 120 book pages, the
  // same rule the Related and Aliases panels follow.
  if (!canEdit && (!accessories || accessories.length === 0)) return null;

  return (
    <section className="panel">
      <h3>Came with it</h3>

      {accessories && accessories.length > 0 ? (
        <ul className="plain">
          {accessories.map((a) =>
            editing === a.id ? (
              <li key={a.id}>
                <AccessoryForm
                  workId={workId}
                  existing={a}
                  copies={copies}
                  pledges={pledges}
                  onSaved={(next) => {
                    setAccessories(next);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={a.id}>
                <AccessoryRow
                  workId={workId}
                  accessory={a}
                  canEdit={canEdit}
                  onEdit={() => {
                    setAdding(false);
                    setEditing(a.id);
                  }}
                  onChanged={setAccessories}
                  onError={setError}
                />
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="muted small">
          Nothing recorded. This is for what arrived beside the book — a plushie, an enamel pin,
          an art print, a slipcase. It is kept on this page only and never counted on the
          collection.
        </p>
      )}

      {error && <p className="notice notice--bad small">{error}</p>}

      {canEdit && (
        <>
          <button
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
          >
            {adding ? 'Cancel' : 'Add an extra'}
          </button>
          {adding && (
            <AccessoryForm
              workId={workId}
              copies={copies}
              pledges={pledges}
              onSaved={(next) => {
                setAccessories(next);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
        </>
      )}
    </section>
  );
}

/** One accessory, and the two buttons that change it. */
function AccessoryRow({
  workId,
  accessory,
  canEdit,
  onEdit,
  onChanged,
  onError,
}: {
  workId: number;
  accessory: Accessory;
  canEdit: boolean;
  onEdit: () => void;
  onChanged: (next: Accessory[]) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  // ⚠️ Two-click delete. See the panel header for why it is not `window.confirm`.
  const [armed, setArmed] = useState(false);

  async function remove() {
    setBusy(true);
    onError(null);
    try {
      onChanged((await api.deleteAccessory(workId, accessory.id)).accessories);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  const facts = [
    accessory.quantity > 1 ? `× ${accessory.quantity}` : null,
    accessory.location,
    accessory.campaignName
      ? `from the ${accessory.campaignName} ${accessory.campaignPlatform ?? ''}`.trim()
      : null,
  ].filter(Boolean);

  return (
    <div className="row-tight">
      <span className="mark mark--accessory">{kindLabel(accessory.kind)}</span>
      <strong>{accessory.name}</strong>
      {/* A wallpaper pack and a plushie are both rewards and only one of them is
          on a shelf. The tag is the same axis the audit counts. */}
      {accessory.isDigital && <span className="mark mark--digital">digital</span>}
      {facts.length > 0 && <span className="muted small">{facts.join(' · ')}</span>}
      {accessory.notes && <span className="muted small">{accessory.notes}</span>}
      {canEdit && (
        <>
          <button className="chip" disabled={busy} onClick={onEdit}>
            Edit
          </button>
          {armed ? (
            <>
              <button className="chip" disabled={busy} onClick={() => void remove()}>
                Really delete?
              </button>
              <button className="chip" disabled={busy} onClick={() => setArmed(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="chip"
              disabled={busy}
              onClick={() => setArmed(true)}
              aria-label={`Delete ${accessory.name}`}
            >
              Delete
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Add one, or change one.
 *
 * One form for both, decided by `existing` — the sibling project's `CopyForm`
 * does the same, and for the same reason: two forms would be two places to fix
 * the copy-belongs-to-this-work rule.
 */
function AccessoryForm({
  workId,
  existing,
  copies,
  pledges,
  onSaved,
  onCancel,
}: {
  workId: number;
  existing?: Accessory;
  copies: CopyView[];
  pledges: { id: number; label: string }[];
  onSaved: (next: Accessory[]) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    const name = form.name.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        kind: form.kind,
        isDigital: form.isDigital,
        quantity: Math.max(1, Number(form.quantity) || 1),
        copyId: form.copyId ? Number(form.copyId) : null,
        pledgeId: form.pledgeId ? Number(form.pledgeId) : null,
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
      };
      const r = existing
        ? await api.updateAccessory(workId, existing.id, body)
        : await api.addAccessory(workId, body);
      onSaved(r.accessories);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <input
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder="What is it — “Princess Donut enamel pin”"
        aria-label="What it is"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
      />

      <div className="row-tight">
        <label className="field">
          <span className="field__label">Kind</span>
          <select value={form.kind} onChange={(e) => set('kind', e.target.value as AccessoryKind)}>
            {ACCESSORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">How many</span>
          <input
            type="number"
            min="1"
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
          />
        </label>
      </div>

      {/* ⚠️ The axis the owner warned about, asked plainly. A crowdfunding tier
          routinely delivers a wallpaper pack or a PDF art book beside the pin,
          and calling both "an extra" with no distinction is how the audit stops
          being able to say what is actually in the house. */}
      <label className="row-tight">
        <input
          type="checkbox"
          checked={form.isDigital}
          onChange={(e) => set('isDigital', e.target.checked)}
        />
        <span>Digital — a file or a licence, not a thing on a shelf</span>
      </label>

      {copies.length > 0 && (
        <label className="field">
          <span className="field__label">Which copy it came with</span>
          <select value={form.copyId} onChange={(e) => set('copyId', e.target.value)}>
            <option value="">Not recorded</option>
            {copies.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.status, c.location].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        </label>
      )}

      {pledges.length > 0 && (
        <label className="field">
          <span className="field__label">Which pledge delivered it</span>
          <select value={form.pledgeId} onChange={(e) => set('pledgeId', e.target.value)}>
            <option value="">Not from a campaign</option>
            {pledges.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {!form.isDigital && (
        <input
          value={form.location}
          onChange={(e) => set('location', e.target.value)}
          placeholder="Where it lives — “desk shelf”"
          aria-label="Location"
        />
      )}

      <input
        value={form.notes}
        onChange={(e) => set('notes', e.target.value)}
        placeholder="Notes"
        aria-label="Notes"
      />

      {error && <p className="notice notice--bad small">{error}</p>}

      <div className="row-tight">
        <button className="primary" disabled={busy || !form.name.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : existing ? 'Save it' : 'Add it'}
        </button>
        <button disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
