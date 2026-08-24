/**
 * THE T2 CONFIRM CARD — the panel's inline restatement + confirm, built DARK.
 *
 * Renders the SAME four mandatory `Restatement` elements the Discord embed does
 * (design §5.1) — the subject and its instance, before→after per field, and the
 * borrowed-authority sentence — plus a Confirm/Cancel pair. The apply logic and
 * the client-side compare-and-set live in `../lib/gabi-confirm.ts`; this file is
 * only the surface.
 *
 * ⚠️ It is NOT a message edit and NOT ephemeral (design §5.3): the card stays in
 * the transcript with its outcome appended, so a reader can check afterwards
 * what was proposed. A mandatory Cancel is present — without it the only way to
 * decline is silence, indistinguishable from not having seen it.
 */

import { useState, type ReactElement } from 'react';
import type { ConfirmChangePending } from '@lc/gabi-conv';
import {
  applyPanelConfirm,
  buildPanelRestatement,
  type PanelConfirmDeps,
  type PanelConfirmOutcome,
} from '../lib/gabi-confirm.js';

export interface GabiConfirmCardProps {
  pending: ConfirmChangePending;
  /** What this instance is called in a sentence — "the main library". */
  instanceLabel: string;
  /** The DARK switch. When false the card renders nothing at all. */
  enabled: boolean;
  deps: PanelConfirmDeps;
  /** Told what happened, so the transcript can append her worded report. */
  onResolved?: (outcome: PanelConfirmOutcome) => void;
}

export function GabiConfirmCard({
  pending,
  instanceLabel,
  enabled,
  deps,
  onResolved,
}: GabiConfirmCardProps): ReactElement | null {
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [outcome, setOutcome] = useState<PanelConfirmOutcome | null>(null);

  // ⚠️ OFF means invisible — no card, exactly as the switch promises.
  if (!enabled) return null;

  const rest = buildPanelRestatement(pending, instanceLabel);

  const resolve = (o: PanelConfirmOutcome) => {
    setOutcome(o);
    setState('done');
    onResolved?.(o);
  };

  const onConfirm = async () => {
    if (state !== 'idle') return;
    setState('working');
    const o = await applyPanelConfirm(deps, pending, { enabled });
    resolve(o);
  };

  const onCancel = () => {
    if (state !== 'idle') return;
    resolve({ kind: 'refused', message: 'Cancelled — nothing was changed.' });
  };

  return (
    <div className="gabi-confirm-card" role="group" aria-label="Confirm a change">
      <div className="gabi-confirm-subject">
        <strong>{rest.subject.label}</strong> <span>on {rest.subject.instance}</span>
      </div>
      <ul className="gabi-confirm-changes">
        {rest.changes.map((c) => (
          <li key={c.field}>
            <span className="gabi-confirm-field">{c.label}</span>{' '}
            <span className="gabi-confirm-before">{c.before || '(none)'}</span>
            {' → '}
            <span className="gabi-confirm-after">
              <strong>{c.after || '(none)'}</strong>
            </span>
          </li>
        ))}
      </ul>
      <p className="gabi-confirm-authority">
        I&rsquo;ll do this <strong>as you</strong>, using your {rest.authority.capability} access on{' '}
        {rest.authority.instanceLabel} &mdash; I hold no permissions of my own.
      </p>

      {state !== 'done' ? (
        <div className="gabi-confirm-actions">
          <button type="button" onClick={onConfirm} disabled={state === 'working'}>
            {state === 'working' ? 'Making the change…' : 'Yes, make this change'}
          </button>
          <button type="button" onClick={onCancel} disabled={state === 'working'}>
            Cancel
          </button>
        </div>
      ) : (
        <p className="gabi-confirm-outcome">{outcome ? outcomeText(outcome) : ''}</p>
      )}
    </div>
  );
}

/** The worded outcome — every branch says whether anything changed. */
function outcomeText(o: PanelConfirmOutcome): string {
  switch (o.kind) {
    case 'applied':
      return "Done — I made that change as you. It's stamped and undoable from the book's Changes panel.";
    case 'expired':
      return 'That aged out before you pressed, so nothing was changed. Ask me again and I&rsquo;ll offer it fresh.';
    case 'changed':
      return `Someone changed the ${o.label} while we were talking — it now says «${o.nowIs || '(nothing)'}», not what I showed you. I haven't touched it.`;
    case 'refused':
      return o.message;
    case 'off':
    default:
      return 'Nothing was changed.';
  }
}
