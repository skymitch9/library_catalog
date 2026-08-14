/**
 * The settings cog: theme dropdown + light/dark/auto, in the top bar.
 *
 * This is this app's settings surface for the estate theme system. It drives
 * `window.estateTheme` (the vendored switcher) and never touches storage or
 * `<html>` itself — the semantics live in ONE place, theme.js, shared with the
 * apex. See src/lib/estate-theme.ts for why the API can be absent.
 *
 * ⚠️ Deliberately NOT the apex's `#hg-cog` markup-contract ids. theme.js wires
 * those at DOMContentLoaded, and this cog is rendered by React whenever the
 * signed-in shell mounts — sometimes before that event, sometimes long after.
 * Half the time the automatic wiring would land and the other half it would
 * not, and the landing half would double-toggle against React's own handlers.
 * The adoption guide's other integration path — call the API from the site's
 * own settings UI — is the one that cannot race.
 *
 * The panel is a popover: Escape closes and refocuses the cog, a pointer-down
 * anywhere else closes it (same behaviours theme.js gives the apex's cog).
 */

import { useEffect, useRef, useState } from 'react';
import {
  estateTheme,
  onEstateChange,
  type EstateMode,
  type EstateState,
  type EstateThemeName,
} from '../lib/estate-theme.js';

const THEME_LABELS: Record<EstateThemeName, string> = {
  classic: 'Classic',
  apple: 'Apple',
  cyberpunk: 'Cyberpunk',
  retro: 'Retro',
};

const MODE_LABELS: Record<EstateMode, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

export function ThemeCog() {
  const api = estateTheme();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EstateState | null>(() => (api ? api.get() : null));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => onEstateChange(setState), []);

  // Popover manners, only while open — a tap elsewhere or Escape dismisses.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // No switcher script, no control — the page is already in the apple
  // fallback and a dropdown that silently did nothing would be worse.
  if (!api || !state) return null;

  return (
    <div className="cog" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="cog__button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Theme and appearance"
        title="Theme"
        onClick={() => setOpen((o) => !o)}
      >
        {/* The gear, drawn inline so it inherits currentColor in every theme. */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Zm7.4-3.5a5.9 5.9 0 0 0-.1-1.1l2-1.5-2-3.4-2.3 1a7.4 7.4 0 0 0-1.9-1.1L14.7 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.9 1.1l-2.3-1-2 3.4 2 1.5a5.9 5.9 0 0 0 0 2.2l-2 1.5 2 3.4 2.3-1a7.4 7.4 0 0 0 1.9 1.1l.4 2.9h4l.4-2.9a7.4 7.4 0 0 0 1.9-1.1l2.3 1 2-3.4-2-1.5c.07-.36.1-.73.1-1.1Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="cog__panel" role="group" aria-label="Appearance">
          <div className="cog__row">
            <label className="field__label" htmlFor="theme-select">
              Theme
            </label>
            <select
              id="theme-select"
              value={state.theme}
              onChange={(e) => api.setTheme(e.currentTarget.value)}
            >
              {api.themes.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t] ?? t}
                </option>
              ))}
            </select>
            {/* v2 per-page affordances (estate-themes.md §2a): picking above
                applied to THIS page; this quiet lever makes it the site's. */}
            {state.scope === 'page' && (
              <p className="cog__scope muted small">This page keeps its own theme.</p>
            )}
            <button type="button" className="cog__applyall" onClick={() => api.setSiteTheme(state.theme)}>
              Apply to all pages
            </button>
          </div>
          <div className="cog__row">
            <span className="field__label" id="mode-label">
              Mode
            </span>
            <div className="cog__modes" role="group" aria-labelledby="mode-label">
              {api.modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={state.mode === m}
                  onClick={() => api.setMode(m)}
                >
                  {MODE_LABELS[m] ?? m}
                </button>
              ))}
            </div>
          </div>
          <p className="cog__note muted small">
            Themes apply to this page; mode applies everywhere. Remembered on this site only.
          </p>
        </div>
      )}
    </div>
  );
}
