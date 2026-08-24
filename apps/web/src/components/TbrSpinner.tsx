/**
 * "Spin the TBR" — pick one book to read next, with pizzazz.
 *
 * ## The choice is core's; this file is the theatre
 *
 * The book is chosen by `pickRandom` in `@lc/core` — pure, seeded and tested.
 * This component never decides *which* book; it decides how to REVEAL the one
 * core already chose. That split is what lets a wheel animate towards a known
 * result instead of choosing as it stops, and it is why a reroll is just a new
 * seed handed back to the same pure function.
 *
 * ## The theme system is a data registry, not a fork
 *
 * {@link SPINNER_STAGES} is an array of themes. Each supplies only its animated
 * *stage* — the wheel, later the dice, later the cards — while this shell owns
 * everything shared: the filters, the pick, the seed, the reroll, the
 * reduced-motion decision, the result card and the worded empty states. Adding
 * "dice-roll" or "card-shuffle" is adding one entry with a `Stage` component;
 * nothing here forks. `dice` and `cards` ship as clearly-marked STUBS (they
 * reveal the result without their own animation yet) so the seam is real and
 * exercised rather than hypothetical.
 *
 * ## Reduced motion is obeyed, not decorated
 *
 * `prefers-reduced-motion: reduce` skips the animation entirely: the pick is
 * revealed at once, no spin. That matches the estate's global rule (styles.css
 * kills the whole motion vocabulary under the same query) and every stage must
 * honour the `reduced` flag it is handed.
 *
 * ## What the live filters can and cannot do
 *
 * The core picker filters on format (audio/physical/ebook), hardcover,
 * series-position and owned/wishlist. This page can only populate the axes the
 * TBR **resolve** response actually carries: `workId` (→ owned vs. not on these
 * shelves) and `series` + `seriesIndexDisplay` (→ first vs. continuation). It
 * deliberately does NOT render format or hardcover toggles, because the resolve
 * endpoint returns no edition-medium split and no hardcover flag — surfacing a
 * control that cannot work would break the estate's "never show a control
 * someone can't use" rule. Those two axes are a noted follow-on that needs the
 * resolve route to return per-work edition data; the core support and its tests
 * are already in place for the day it does.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { eligibleItems, nextSeed, pickRandom, type PickableItem, type PickResult } from '@lc/core';
import { Cover } from './Cover.js';
import { audiobookDetailUrl, resolveAudiobookCover } from '../lib/audiobook-site.js';
import { currentUid } from '../lib/firebase.js';
import {
  loadPickerPrefs,
  savePickerPrefs,
  toPickFilters,
  type PickerPrefs,
  type SpinnerThemeId,
} from '../lib/tbr-picker-prefs.js';
import { Link, workPath } from '../router.js';

/** The only fields of a TBR row this component reads. `TbrPage`'s Row satisfies it. */
export interface SpinnerRow {
  docId: string;
  workId: number | null;
  readState: string | null;
  series: string | null;
  seriesIndexDisplay: string | null;
  workTitle: string | null;
  title: string;
  authors: string | null;
  workCoverUrl: string | null;
  coverUrl: string | null;
}

/** A row plus the mapping we built for the picker — the stage renders the row. */
interface Candidate extends PickableItem {
  row: SpinnerRow;
}

/** The leading number of a series-index display (`"2"`, `"1.5"`, `"Book 3"`). */
function seriesIndexOf(display: string | null): number | null {
  if (!display) return null;
  const m = display.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Map a TBR row onto a {@link Candidate}. Only the axes the resolve response can
 * fill are set; `format` and `hardcover` are left absent on purpose (see the
 * module header), and `openable` is true because a book on a person's own
 * to-read list is by definition one they mean to open.
 */
function toCandidate(row: SpinnerRow): Candidate {
  return {
    id: row.docId,
    row,
    // Held here → owned; on the list but not on these shelves → aspirational.
    acquisition: row.workId !== null ? 'owned' : 'wishlist',
    series: row.series ?? null,
    seriesIndex: seriesIndexOf(row.seriesIndexDisplay),
    openable: true,
  };
}

/* ── the theme registry ──────────────────────────────────────────────────── */

interface StageProps {
  /** The candidates the spin could land on, in core's canonical order. */
  pool: Candidate[];
  /** The one core chose. */
  chosen: Candidate;
  /** The seed of this spin — a stage may use it for deterministic flourish. */
  seed: number;
  /** 'spinning' while the animation runs, 'done' once the result is settled. */
  phase: 'spinning' | 'done';
  /** True when the viewer asked for reduced motion — no animation, reveal at once. */
  reduced: boolean;
}

interface SpinnerTheme {
  id: SpinnerThemeId;
  label: string;
  blurb: string;
  /** A built theme animates; a stub reveals the result without its own motion. */
  ready: boolean;
  /** How long the shell keeps 'spinning' before flipping to 'done', ms. */
  durationMs: number;
  Stage: (props: StageProps) => ReactNode;
}

const WHEEL_MS = 3200;
const SEGMENT_CAP = 12;

/** The built one: a wheel that spins to the chosen book. */
function WheelStage({ pool, chosen, seed, phase, reduced }: StageProps) {
  // How many wedges — at most SEGMENT_CAP, and never fewer than what we have.
  const seg = Math.min(SEGMENT_CAP, Math.max(pool.length, 1));
  const segAngle = 360 / seg;
  const chosenSeg = ((seed % seg) + seg) % seg;

  // The wedges shown, with the chosen book placed at `chosenSeg` so the wheel
  // can land it under the pointer. The rest fill in around it, deterministically.
  const display = useMemo(() => {
    const others = pool.filter((c) => c.id !== chosen.id).slice(0, seg - 1);
    const out: Candidate[] = [];
    let oi = 0;
    for (let i = 0; i < seg; i++) out[i] = i === chosenSeg ? chosen : others[oi++]!;
    return out;
  }, [pool, chosen, seg, chosenSeg]);

  // Rotation accumulates forward across spins so the wheel always turns
  // clockwise; the landing offset brings `chosenSeg`'s centre to the top pointer.
  const [rotation, setRotation] = useState(0);
  const spins = useRef(0);
  const lastSeed = useRef<number | null>(null);
  useEffect(() => {
    if (seed === lastSeed.current) return;
    lastSeed.current = seed;
    spins.current += 1;
    const turns = reduced ? 0 : 4 + (Math.abs(seed) % 4);
    const landing = -(chosenSeg + 0.5) * segAngle;
    setRotation(spins.current * turns * 360 + landing);
  }, [seed, chosenSeg, segAngle, reduced]);

  const wedges = display
    .map((_, i) => {
      const c = i % 2 === 0 ? 'var(--et-accent)' : 'var(--et-accent-2)';
      return `${c} ${i * segAngle}deg ${(i + 1) * segAngle}deg`;
    })
    .join(', ');

  return (
    <div className="tbr-wheel" aria-hidden="true">
      <div className="tbr-wheel__pointer" />
      <div
        className="tbr-wheel__disc"
        style={{
          background: `conic-gradient(${wedges})`,
          transform: `rotate(${rotation}deg)`,
          transition: reduced ? 'none' : `transform ${WHEEL_MS}ms cubic-bezier(0.16, 0.84, 0.3, 1)`,
        }}
      >
        {display.map((c, i) => (
          <span
            key={c.id}
            className={`tbr-wheel__label${phase === 'done' && i === chosenSeg ? ' is-winner' : ''}`}
            style={{ transform: `rotate(${(i + 0.5) * segAngle}deg)` }}
          >
            <span className="tbr-wheel__label-text">{c.row.workTitle ?? c.row.title}</span>
          </span>
        ))}
      </div>
      <div className="tbr-wheel__hub" />
    </div>
  );
}

/** A stub stage: no themed animation yet, it simply presents the result. */
function StubStage({ label }: { label: string }) {
  return (
    <div className="tbr-stub" aria-hidden="true">
      <p className="muted small">
        The {label.toLowerCase()} animation is coming soon — the pick below is real; only its
        flourish is stubbed.
      </p>
    </div>
  );
}

/**
 * The registry. One entry per theme; the shell renders `active.Stage`. Add a
 * theme by adding a row here and giving it a `Stage` — nothing else forks.
 */
export const SPINNER_STAGES: readonly SpinnerTheme[] = [
  {
    id: 'wheel',
    label: 'Wheel',
    blurb: 'A prize wheel that spins to your next read.',
    ready: true,
    durationMs: WHEEL_MS,
    Stage: WheelStage,
  },
  {
    id: 'dice',
    label: 'Dice',
    blurb: 'Roll for it. (Coming soon.)',
    ready: false,
    durationMs: 0,
    Stage: () => <StubStage label="Dice" />,
  },
  {
    id: 'cards',
    label: 'Cards',
    blurb: 'Shuffle and cut. (Coming soon.)',
    ready: false,
    durationMs: 0,
    Stage: () => <StubStage label="Cards" />,
  },
];

/* ── the shared shell ────────────────────────────────────────────────────── */

/** Read the reduced-motion preference and keep it live. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const on = () => setReduced(mq.matches);
      mq.addEventListener('change', on);
      return () => mq.removeEventListener('change', on);
    } catch {
      return;
    }
  }, []);
  return reduced;
}

/** A time-derived starting seed. Not an RNG — just entropy for the first spin. */
function seedFromTime(): number {
  return Date.now() >>> 0;
}

export function TbrSpinner({ rows }: { rows: SpinnerRow[] }) {
  const [prefs, setPrefs] = useState<PickerPrefs>(loadPickerPrefs);
  const [seed, setSeed] = useState<number | null>(null);
  const [excludeId, setExcludeId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'done'>('idle');
  const reduced = usePrefersReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = SPINNER_STAGES.find((t) => t.id === prefs.theme) ?? SPINNER_STAGES[0]!;

  const candidates = useMemo(() => rows.map(toCandidate), [rows]);

  const filters = useMemo(() => {
    const f = toPickFilters(prefs);
    if (excludeId) f.excludeId = excludeId;
    return f;
  }, [prefs, excludeId]);

  // The eligible pool the wheel shows — the same set, in the same order, the
  // pick draws from (one implementation of "eligible", from core).
  const poolList = useMemo(() => eligibleItems(candidates, filters), [candidates, filters]);
  const pool = poolList.length;

  // The authoritative pick. Recomputed from the same pure inputs the wheel sees.
  const result: PickResult<Candidate> | null = useMemo(
    () => (seed == null ? null : pickRandom(candidates, filters, seed)),
    [candidates, filters, seed],
  );

  // Clean up a running spin timer on unmount.
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function update(next: Partial<PickerPrefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    savePickerPrefs(merged);
    // Changing the filters or theme invalidates a shown result — start fresh.
    setSeed(null);
    setExcludeId(null);
    setPhase('idle');
  }

  function spin(reroll: boolean) {
    if (timer.current) clearTimeout(timer.current);
    const exclude = reroll ? (result?.item?.id ?? null) : null;
    const nextS = seed == null || !reroll ? seedFromTime() : nextSeed(seed);
    setExcludeId(exclude);
    setSeed(nextS);
    if (reduced || !active.ready || active.durationMs === 0) {
      setPhase('done');
      return;
    }
    setPhase('spinning');
    timer.current = setTimeout(() => setPhase('done'), active.durationMs);
  }

  const revealing = phase === 'done' && result?.item != null;
  const spinning = phase === 'spinning';

  return (
    <section className="tbr-spinner" aria-label="Spin the TBR">
      <div className="tbr-spinner__controls">
        <label className="tbr-spinner__field">
          <span className="tbr-spinner__field-label">Theme</span>
          <select
            value={prefs.theme}
            onChange={(e) => update({ theme: e.target.value as SpinnerThemeId })}
          >
            {SPINNER_STAGES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.ready ? '' : ' (soon)'}
              </option>
            ))}
          </select>
        </label>

        <label className="tbr-spinner__field">
          <span className="tbr-spinner__field-label">Where</span>
          <select
            value={prefs.where}
            onChange={(e) => update({ where: e.target.value as PickerPrefs['where'] })}
          >
            <option value="any">Anywhere</option>
            <option value="owned">On these shelves</option>
            <option value="wishlist">Not on these shelves</option>
          </select>
        </label>

        <label className="tbr-spinner__field">
          <span className="tbr-spinner__field-label">Series</span>
          <select
            value={prefs.series}
            onChange={(e) => update({ series: e.target.value as PickerPrefs['series'] })}
          >
            <option value="any">Any position</option>
            <option value="first">Start a series</option>
            <option value="continuation">Continue a series</option>
          </select>
        </label>
      </div>

      <p className="muted small tbr-spinner__count">
        {pool === 0
          ? 'No book on your list matches these filters.'
          : `${pool} ${pool === 1 ? 'book' : 'books'} in the running.`}
      </p>

      {seed != null && result?.item != null && (
        <div className="tbr-spinner__stage">
          <active.Stage
            pool={poolList}
            chosen={result.item}
            seed={seed}
            phase={spinning ? 'spinning' : 'done'}
            reduced={reduced}
          />
        </div>
      )}

      {revealing && result?.item && <ResultCard candidate={result.item} spinning={false} />}

      {seed != null && result?.item == null && phase !== 'spinning' && (
        <p className="notice">
          Nothing matched — loosen a filter and spin again.
        </p>
      )}

      <div className="tbr-spinner__actions">
        <button className="primary" disabled={spinning || pool === 0} onClick={() => spin(false)}>
          {spinning ? 'Spinning…' : seed == null ? 'Spin the TBR' : 'Spin again'}
        </button>
        {revealing && (
          <button className="chip" disabled={spinning || pool <= 1} onClick={() => spin(true)}>
            Reroll (not this one)
          </button>
        )}
      </div>
    </section>
  );
}

/** The revealed book: this catalog's copy links to it; an audiobook links out. */
function ResultCard({ candidate, spinning }: { candidate: Candidate; spinning: boolean }) {
  const row = candidate.row;
  const title = row.workTitle ?? row.title;
  const cover = row.workCoverUrl ?? resolveAudiobookCover(row.coverUrl);
  return (
    <div className={`tbr-result${spinning ? ' is-spinning' : ''}`} role="status">
      <div className="tbr-result__inner">
        {row.workId !== null ? (
          <Link to={workPath(row.workId)} className="tbr-result__book" aria-label={`Open ${title}`}>
            <Cover src={cover} title={title} size="large" />
            <span className="tbr-result__text">
              <strong>{title}</strong>
              {row.authors && <span className="muted small">{row.authors}</span>}
              {row.series && (
                <span className="series-tag">
                  {row.series}
                  {row.seriesIndexDisplay ? <b> {row.seriesIndexDisplay}</b> : null}
                </span>
              )}
              <span className="tbr-result__cta">Read this next →</span>
            </span>
          </Link>
        ) : (
          <a
            className="tbr-result__book"
            href={audiobookDetailUrl(title)}
            target="_blank"
            rel="noreferrer"
          >
            <Cover src={cover} title={title} size="large" />
            <span className="tbr-result__text">
              <strong>{title}</strong>
              <span className="muted small">Find it on the audiobook site →</span>
            </span>
          </a>
        )}
      </div>
    </div>
  );
}
