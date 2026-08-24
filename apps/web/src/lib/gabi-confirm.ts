/**
 * THE T2 CONFIRM LANE — **the panel's half.** Built **DARK** (`GABI_CONFIRM_T2`).
 *
 * Design of record:
 * `catalog-platform/docs/info/gabi-confirm-lanes-design.md`. The panel renders
 * the SAME `Restatement` the Discord surface does and applies through the SAME
 * compare-and-set — because both come from `@lc/gabi-conv`, the canonical
 * substrate materialised from catalog-platform. *"An upgrade to how she confirms
 * now lands once."*
 *
 * ## What is the panel's, and what is shared
 *
 *  - **Shared** (`@lc/gabi-conv`): the `ConfirmChangePending` shape, the
 *    `Restatement` structure, `buildRestatement`, the field allowlist and
 *    `compareAndSet`. The panel imports the type rather than reimplementing it —
 *    §5.3's surface-neutral/surface-specific split.
 *  - **The panel's** (here): the borrow is the SIGNED-IN USER, not the estate
 *    token, so the apply rides `PATCH /api/works/:id` — the exact authenticated
 *    edit path the UI's own forms use, which enforces the person's `editCatalog`
 *    capability and writes the audit trail. No new write door.
 *
 * ## ⚠️ The compare-and-set is CLIENT-side here, and that is the design
 *
 * The Discord surface's compare-and-set lives at the destination `fix-field`
 * verb; the panel's lives here, in the browser (design §5.2's *"client side —
 * the live check"*): before applying, it RE-READS the work and refuses if any
 * `before` no longer matches — the same `compareAndSet` the server verb uses, so
 * the two surfaces cannot disagree about what "still true" means. The PATCH it
 * then sends is capability-enforced and audited server-side regardless.
 *
 * ⚠️ **OFF means invisible.** With `GABI_CONFIRM_T2` off, no card is rendered and
 * `applyPanelConfirm` refuses without touching the network.
 */

import {
  buildRestatement,
  compareAndSet,
  isConfirmableField,
  type ConfirmChangePending,
  type Restatement,
} from '@lc/gabi-conv';

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

/** Affirmative-only, the estate idiom — `"on"` (or a literal `true`) and nothing
 * else. The panel receives the flag from the worker's config booleans; a typo is
 * OFF, and OFF means the lane does not exist for a viewer. */
export function panelConfirmOn(flag: unknown): boolean {
  if (flag === true) return true;
  return typeof flag === 'string' && flag.trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The restatement — shared structure, the panel's instance label
// ---------------------------------------------------------------------------

/** Build the structure the card renders — the four mandatory elements — reusing
 * the shared builder so the panel and Discord say the same thing. */
export function buildPanelRestatement(
  pending: ConfirmChangePending,
  instanceLabel: string,
): Restatement {
  return buildRestatement(pending, { capability: 'editCatalog', instanceLabel });
}

// ---------------------------------------------------------------------------
// Apply — client-side compare-and-set, then the authenticated PATCH
// ---------------------------------------------------------------------------

/** The two authenticated calls the apply needs, injected so the logic is pure
 * and testable with no React and no fetch. These are the panel's existing
 * `GabiReadApi.work` and `GabiWriteApi.setBookDetails`. */
export interface PanelConfirmDeps {
  /** `GET /api/works/:id` — the live current values, capability `read`. */
  work: (workId: number) => Promise<unknown>;
  /** `PATCH /api/works/:id` — the authenticated, audited edit path. */
  setBookDetails: (workId: number, fields: Record<string, unknown>) => Promise<unknown>;
}

export type PanelConfirmOutcome =
  | { kind: 'applied' }
  | { kind: 'expired' }
  /** design §4.2's 409, client-side — a field changed under the proposal. */
  | { kind: 'changed'; field: string; label: string; nowIs: string }
  /** the PATCH refused (capability lost) or failed — the person is told, never
   *  a bare status. `message` is the server's own words when it gave any. */
  | { kind: 'refused'; message: string }
  | { kind: 'off' };

/** The current value of one confirmable field on the work JSON, as a string
 * ('' for null/absent) — the compare-and-set material. ⚠️ Default-deny: a field
 * the shared allowlist does not name reads as ''. */
function currentValue(work: Record<string, unknown>, field: string): string {
  if (!isConfirmableField(field)) return '';
  const v = work[field];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/**
 * Apply a confirmed change on the signed-in person's own authority.
 *
 * ⚠️ Re-reads the work FIRST and runs the shared `compareAndSet`: if any `before`
 * no longer matches, it refuses the WHOLE apply (`changed`) rather than
 * clobbering somebody else's edit — exactly the server verb's behaviour, made in
 * the browser. Only then does it PATCH, which is itself capability-checked and
 * audited server-side.
 */
export async function applyPanelConfirm(
  deps: PanelConfirmDeps,
  pending: ConfirmChangePending,
  opts: { enabled: boolean; now?: number } = { enabled: true },
): Promise<PanelConfirmOutcome> {
  if (!opts.enabled) return { kind: 'off' };
  const now = opts.now ?? Date.now();
  if (pending.expiresAt <= now) return { kind: 'expired' };

  const workId = Number(pending.subject.id);

  // The live check — re-read, then compare the whole proposed state.
  let fresh: Record<string, string> = {};
  try {
    const work = (await deps.work(workId)) as Record<string, unknown>;
    for (const c of pending.changes) fresh[c.field] = currentValue(work, c.field);
  } catch (err) {
    return { kind: 'refused', message: refusalText(err) };
  }

  const cmp = compareAndSet(pending.changes, fresh);
  if (!cmp.ok) {
    const label = pending.changes.find((c) => c.field === cmp.field)?.label ?? cmp.field;
    return { kind: 'changed', field: cmp.field, label, nowIs: cmp.nowIs };
  }

  // Apply — the authenticated, audited PATCH. Only the allow-listed fields.
  const patch: Record<string, string> = {};
  for (const c of pending.changes) patch[c.field] = c.after;
  try {
    await deps.setBookDetails(workId, patch);
    return { kind: 'applied' };
  } catch (err) {
    return { kind: 'refused', message: refusalText(err) };
  }
}

/** The server's own words if it gave any, else a plain sentence — never a bare
 * status (the no-bare-status rule). */
function refusalText(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return raw.trim().length > 0
    ? raw.trim()
    : "That didn't go through — you may no longer have permission to edit this book, or the site " +
        'was briefly unreachable. Nothing here tells me it changed. Try the edit form on the book page.';
}
