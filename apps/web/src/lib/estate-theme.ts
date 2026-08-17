/**
 * Typed access to the estate theme switcher (`/estate/theme.js`).
 *
 * The switcher is NOT part of the React bundle, on purpose: it must run as a
 * classic script in <head> so the persisted `hg_theme` / `hg_mode` land on
 * <html> before first paint (catalog-platform docs/info/estate-themes.md §4).
 * By the time any module here executes, `window.estateTheme` exists and the
 * document is already stamped — this file only *reads and drives* it.
 *
 * ⚠️ Everything is written to survive the script being absent (blocked, or a
 * botched sync): the app renders in the apple no-JS fallback and the cog
 * simply does not appear. A theme control that throws on a missing global
 * would take the whole shell down to save a dropdown.
 *
 * Storage (`hg_theme`, `hg_mode`) belongs to theme.js alone — nothing in this
 * app touches those keys directly, so the semantics can never fork from the
 * apex's. This is the "integrate via window.estateTheme" path the adoption
 * guide names for sites with their own settings surface. Theme choice is
 * SITE-WIDE — one look per site (owner clarification, 2026-08-14; a per-page
 * variant was built and reverted the same day, estate-themes.md §2a).
 */

export type EstateThemeName = 'classic' | 'apple' | 'cyberpunk' | 'retro' | 'hearts';
export type EstateMode = 'auto' | 'light' | 'dark';

export interface EstateState {
  theme: EstateThemeName;
  mode: EstateMode;
  resolvedMode: 'light' | 'dark';
}

interface EstateThemeApi {
  themes: EstateThemeName[];
  modes: EstateMode[];
  get(): EstateState;
  setTheme(theme: string): void;
  setMode(mode: string): void;
}

declare global {
  interface Window {
    estateTheme?: EstateThemeApi;
  }
}

/** The switcher, or null when its script never ran. */
export function estateTheme(): EstateThemeApi | null {
  return typeof window !== 'undefined' && window.estateTheme ? window.estateTheme : null;
}

/**
 * Subscribe to theme/mode changes (including the OS flipping while mode is
 * `auto` — theme.js re-fires on that too). Returns the unsubscribe, in the
 * shape a `useEffect` wants to return.
 */
export function onEstateChange(listener: (state: EstateState) => void): () => void {
  const handler = () => {
    const api = estateTheme();
    if (api) listener(api.get());
  };
  document.addEventListener('hg-themechange', handler);
  return () => document.removeEventListener('hg-themechange', handler);
}

/**
 * Keep `<meta name="theme-color">` in step with the active `--et-bg` — the
 * browser chrome and the iOS status bar area should wear the theme too
 * (adoption guide §4.5; the games app does the same job from its theme.ts).
 * Reads the COMPUTED token rather than duplicating any palette value here.
 */
export function startThemeColorSync(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const apply = () => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--et-bg').trim();
    if (bg) meta.content = bg;
  };
  document.addEventListener('hg-themechange', apply);
  apply();
}
