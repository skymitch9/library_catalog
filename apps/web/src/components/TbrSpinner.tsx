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
 * *stage* — the wheel, the dice, the cards — while this shell owns everything
 * shared: the filters, the pick, the seed, the reroll, the reduced-motion
 * decision, the result card and the worded empty states. Adding a theme is
 * adding one entry with a `Stage` component; nothing here forks. All three
 * animate: the wheel spins to the chosen wedge, the die tumbles to a
 * seed-derived face, the deck shuffles and one card is drawn and flipped — and
 * each lands on the book {@link pickRandom} already chose (see
 * `lib/tbr-stage-anim.ts` for the pure landing maths every stage shares).
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
 * Two controls, and each reads a field the TBR **resolve** response actually
 * carries: the group's **formats row** (`{ physical, audio, ebook }`, the media
 * fold — `docs/info/tbr.md` §9) and `series` + `seriesIndexDisplay`. Hardcover
 * is still NOT rendered: the resolve endpoint returns no hardcover flag, and
 * surfacing a control that cannot work would break the estate's "never show a
 * control someone can't use" rule. Core's support for it and its tests are in
 * place for the day the route carries it.
 *
 * ## ⚠️ The format boxes are applied HERE, not by core — 2026-08-26
 *
 * Owner: *"change the where drop down to be audio ebook physical and let them
 * be check boxes."* Three independent boxes, any combination, **none ticked =
 * no restriction** (said in words beside them). Core's `PickFilters.format`
 * takes ONE medium, so the set is applied by `heldInSelectedFormats` over the
 * rows before candidates are built — widening core's filter would be a second
 * definition of the same axis. ⚠️ Both the wheel's visible pool and the pick
 * read that same filtered array (`eligibleItems` and `pickRandom` are handed
 * the identical `candidates`), so what spins and what is chosen cannot diverge.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  eligibleItems,
  nextSeed,
  pickRandom,
  type PickableItem,
  type PickResult,
  type TbrGroupFormats,
} from '@lc/core';
import { Cover } from './Cover.js';
import { audiobookDetailUrl, resolveAudiobookCover } from '../lib/audiobook-site.js';
import { currentUid } from '../lib/firebase.js';
import {
  anyFormatSelected,
  heldInSelectedFormats,
  loadPickerPrefs,
  PICKER_FORMAT_LABELS,
  PICKER_FORMATS,
  savePickerPrefs,
  toPickFilters,
  type PickerPrefs,
  type SpinnerThemeId,
} from '../lib/tbr-picker-prefs.js';
import {
  cardDrawSlot,
  dieCubeRotation,
  dieFaceForSeed,
  dieTumbleTurns,
} from '../lib/tbr-stage-anim.js';
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
  /**
   * ⚠️ Which shelves this book is actually reachable on — the group's formats
   * row, straight from the media fold (`docs/info/tbr.md` §9). It is what the
   * three format checkboxes read; `null` is not expected from `TbrPage` (every
   * group carries one) but is tolerated, and fails every ticked box.
   */
  formats: TbrGroupFormats | null;
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
 *
 * ⚠️ `acquisition` is still recorded, but since 2026-08-26 **no control drives
 * it** — the retired `Where` dropdown was its only caller. It stays because it
 * is a true fact about the row that core's picker already understands; it is
 * not a dead option waiting to be re-rendered (see the prefs module on why
 * "wishlist only" has no checkbox equivalent).
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
const DICE_MS = 2200;
const CARDS_MS = 2400;
/** How many face-down cards fan out while the deck shuffles. */
const FAN_CARDS = 5;

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

/**
 * The dice stage: one 3D die tumbles and settles on a seed-derived face, then
 * the shell reveals the result card. The landing is deterministic — the same
 * seed always lands the same face — exactly as the wheel lands the same wedge;
 * see `lib/tbr-stage-anim.ts`. The face is cosmetic (a d6 cannot enumerate a
 * whole TBR), so it decides the theatre while `pickRandom` decides the book.
 *
 * Motion is driven like the wheel: a new seed sets the cube's resting rotation
 * plus whole extra turns, and the inline CSS transition tumbles from the
 * previous orientation to it over `DICE_MS`. Reduced motion contributes zero
 * turns and no transition, so the die snaps to its face at once.
 */
function DiceStage({ chosen, seed, phase, reduced }: StageProps) {
  const face = dieFaceForSeed(seed);
  const rest = dieCubeRotation(face);

  const [rot, setRot] = useState(rest);
  const spins = useRef(0);
  const lastSeed = useRef<number | null>(null);
  useEffect(() => {
    if (seed === lastSeed.current) return;
    lastSeed.current = seed;
    spins.current += 1;
    const turns = dieTumbleTurns(seed, reduced);
    // Add equal whole turns on both axes so the die tumbles rather than spins
    // flat; a multiple of 360° leaves the resting face pointing at the viewer.
    setRot({ x: rest.x + spins.current * turns * 360, y: rest.y + spins.current * turns * 360 });
  }, [seed, rest.x, rest.y, reduced]);

  const settled = phase === 'done';
  const title = chosen.row.workTitle ?? chosen.row.title;

  return (
    <div className={`tbr-dice${settled ? ' is-settled' : ''}`} aria-hidden="true">
      <div className="tbr-dice__scene">
        <div
          className="tbr-dice__cube"
          style={{
            transform: `translateZ(-52px) rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
            transition: reduced ? 'none' : `transform ${DICE_MS}ms cubic-bezier(0.18, 0.9, 0.3, 1)`,
          }}
        >
          {([1, 2, 3, 4, 5, 6] as const).map((f) => (
            <div key={f} className={`tbr-dice__face tbr-dice__face--${f}`}>
              {Array.from({ length: f }, (_, i) => (
                <span key={i} className="tbr-dice__pip" />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="tbr-dice__caption muted small" aria-hidden="true">
        {settled ? `Rolled a ${face} — ${title}` : 'Rolling…'}
      </p>
    </div>
  );
}

/**
 * The cards stage: a face-down deck fans and riffles (CSS keyframes while the
 * shell is `spinning`), then one card — the seed's `cardDrawSlot` of the fan —
 * lifts to the centre and flips to reveal the chosen book. The reveal is the
 * pick; the deck is theatre. The flip is driven by `phase`: React re-renders
 * `done` and the card's transform transitions from face-down to face-up. Reduced
 * motion has the shell go straight to `done`, so the card shows face-up at once
 * (the CSS transition is additionally killed under the media query).
 */
function CardsStage({ chosen, seed, phase, reduced }: StageProps) {
  const drawn = cardDrawSlot(seed, FAN_CARDS);
  const revealed = phase === 'done';
  const title = chosen.row.workTitle ?? chosen.row.title;
  const cover = chosen.row.workCoverUrl ?? resolveAudiobookCover(chosen.row.coverUrl);

  return (
    <div
      className={`tbr-cards${revealed ? ' is-revealed' : ''}${reduced ? ' is-reduced' : ''}`}
      aria-hidden="true"
    >
      {/* The shuffling deck — hidden once a card is drawn. */}
      <div className="tbr-cards__deck">
        {Array.from({ length: FAN_CARDS }, (_, i) => (
          <span
            key={i}
            className={`tbr-cards__deck-card${i === drawn ? ' is-drawn' : ''}`}
            style={{ '--i': i - (FAN_CARDS - 1) / 2 } as CSSProperties}
          />
        ))}
      </div>

      {/* The drawn card, flipping to reveal the pick. */}
      <div className="tbr-cards__hero">
        <div className="tbr-cards__flip">
          <span className="tbr-cards__face tbr-cards__face--back" />
          <span className="tbr-cards__face tbr-cards__face--front">
            <Cover src={cover} title={title} size="row" />
          </span>
        </div>
      </div>
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
    blurb: 'Roll for your next read.',
    ready: true,
    durationMs: DICE_MS,
    Stage: DiceStage,
  },
  {
    id: 'cards',
    label: 'Cards',
    blurb: 'Shuffle the deck and cut to a book.',
    ready: true,
    durationMs: CARDS_MS,
    Stage: CardsStage,
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

  // ⚠️ The format boxes narrow the ROWS, before candidates exist — so the
  // wheel's pool, the count under it and the pick are all the same set (see the
  // module header). Nothing ticked leaves the array untouched.
  const candidates = useMemo(
    () =>
      rows.filter((r) => heldInSelectedFormats(r.formats, prefs.formats)).map(toCandidate),
    [rows, prefs.formats],
  );

  const formatFilterOn = anyFormatSelected(prefs.formats);

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

        {/* ⚠️ Three INDEPENDENT boxes, any combination, and none ticked is a
            real answer — never a dead control. The sentence under them says
            which it is in words, because an all-unticked group of checkboxes
            otherwise reads as a filter that has been forgotten. */}
        <div
          className="tbr-spinner__field"
          role="group"
          aria-labelledby="tbr-spinner-formats-label"
        >
          <span className="tbr-spinner__field-label" id="tbr-spinner-formats-label">
            Format
          </span>
          <div className="tbr-spinner__checks">
            {PICKER_FORMATS.map((id) => (
              <label key={id} className="tbr-spinner__check">
                <input
                  type="checkbox"
                  checked={prefs.formats[id]}
                  onChange={(e) =>
                    update({ formats: { ...prefs.formats, [id]: e.target.checked } })
                  }
                />
                <span>{PICKER_FORMAT_LABELS[id]}</span>
              </label>
            ))}
          </div>
          <span className="muted small tbr-spinner__hint">
            {formatFilterOn
              ? 'Books you have in at least one ticked format.'
              : 'Any format — nothing is filtered out.'}
          </span>
        </div>

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

      {/* ⚠️ An empty pool gets a SENTENCE, and when the format boxes are the
          only thing narrowing it, one that names them — "no matches" over a
          filter the person just ticked reads as the wheel being broken. */}
      <p className="muted small tbr-spinner__count">
        {pool === 0
          ? formatFilterOn && prefs.series === 'any'
            ? 'No book on your list is one you have in a ticked format.'
            : 'No book on your list matches these filters.'
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
