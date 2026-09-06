/**
 * THE T2 CONFIRM LANE — the panel's apply logic. Exercises the panel's own
 * wiring — the flag, the client-side compare-and-set, and the outcome
 * mapping. The grammar itself is pinned in the shared package's tests.
 * Moved into apps/web/test/ 2026-09-05 so it gates `npm test` — its old home
 * in src/lib/ sat outside that glob and had never gated a deploy.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildConfirmProposal, type ConfirmChangePending } from '@lc/gabi-conv';
import {
  applyPanelConfirm,
  buildPanelRestatement,
  panelConfirmOn,
  type PanelConfirmDeps,
} from '../src/lib/gabi-confirm.js';

const NOW = 1_700_000_000_000;

function pendingOf(over: Partial<ConfirmChangePending> = {}): ConfirmChangePending {
  const r = buildConfirmProposal({
    askerId: 'user-9',
    instance: 'library',
    subject: { entity: 'work', id: '4711', label: 'The Way of Kings by Brandon Sanderson' },
    fields: [{ field: 'series', before: 'Stormlight', after: 'The Stormlight Archive' }],
    nonce: 'abc123',
    now: NOW,
  });
  if (!r.ok) throw new Error('unreachable');
  return { ...r.pending, ...over };
}

function deps(over: Partial<PanelConfirmDeps> & { current?: Record<string, unknown> } = {}): {
  d: PanelConfirmDeps;
  patched: { id: number; fields: Record<string, unknown> }[];
} {
  const patched: { id: number; fields: Record<string, unknown> }[] = [];
  const d: PanelConfirmDeps = {
    work: over.work ?? (async () => over.current ?? { series: 'Stormlight' }),
    setBookDetails:
      over.setBookDetails ??
      (async (id, fields) => {
        patched.push({ id, fields });
        return { ok: true };
      }),
  };
  return { d, patched };
}

describe('panelConfirmOn — affirmative-only, ships OFF', () => {
  it('only "on" or literal true', () => {
    assert.equal(panelConfirmOn('on'), true);
    assert.equal(panelConfirmOn(true), true);
    for (const v of [undefined, '', 'true', '1', 'yes', false, 'off']) assert.equal(panelConfirmOn(v), false);
  });
});

describe('buildPanelRestatement — the shared four elements', () => {
  it('carries subject+instance, before→after, and borrowed authority', () => {
    const rest = buildPanelRestatement(pendingOf(), 'the main library');
    assert.equal(rest.subject.instance, 'the main library');
    assert.equal(rest.authority.capability, 'editCatalog');
    assert.equal(rest.changes[0]!.before, 'Stormlight');
    assert.equal(rest.changes[0]!.after, 'The Stormlight Archive');
  });
});

describe('applyPanelConfirm — client-side compare-and-set, then the authed PATCH', () => {
  it('OFF is invisible and never touches the network', async () => {
    const { d, patched } = deps();
    const o = await applyPanelConfirm(d, pendingOf(), { enabled: false, now: NOW + 1000 });
    assert.equal(o.kind, 'off');
    assert.equal(patched.length, 0);
  });

  it('applies when the live value still matches the before', async () => {
    const { d, patched } = deps({ current: { series: 'Stormlight' } });
    const o = await applyPanelConfirm(d, pendingOf(), { enabled: true, now: NOW + 1000 });
    assert.equal(o.kind, 'applied');
    assert.deepEqual(patched, [{ id: 4711, fields: { series: 'The Stormlight Archive' } }]);
  });

  it('⚠️ refuses the WHOLE apply when the field changed underneath — no PATCH', async () => {
    const { d, patched } = deps({ current: { series: 'The Stormlight Archive' } });
    const o = await applyPanelConfirm(d, pendingOf(), { enabled: true, now: NOW + 1000 });
    assert.equal(o.kind, 'changed');
    if (o.kind !== 'changed') return;
    assert.equal(o.field, 'series');
    assert.equal(o.nowIs, 'The Stormlight Archive');
    assert.equal(patched.length, 0, 'nothing was written');
  });

  it('an expired proposal changes nothing and never re-reads', async () => {
    let read = 0;
    const { d, patched } = deps({ work: async () => (read++, { series: 'Stormlight' }) });
    const o = await applyPanelConfirm(d, pendingOf(), { enabled: true, now: NOW + 10 * 60 * 1000 + 1 });
    assert.equal(o.kind, 'expired');
    assert.equal(read, 0);
    assert.equal(patched.length, 0);
  });

  it('a PATCH that throws (capability lost) is a worded refusal, never a bare status', async () => {
    const { d } = deps({
      current: { series: 'Stormlight' },
      setBookDetails: async () => {
        throw new Error('Your account is reader, and editing needs editCatalog.');
      },
    });
    const o = await applyPanelConfirm(d, pendingOf(), { enabled: true, now: NOW + 1000 });
    assert.equal(o.kind, 'refused');
    if (o.kind !== 'refused') return;
    assert.match(o.message, /needs editCatalog/);
  });
});
