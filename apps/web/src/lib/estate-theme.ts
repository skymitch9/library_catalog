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
  /**
   * Human names for the themes, added to canonical 2026-08-17 so a new theme
   * arrives with its LABEL and not just its id (owner order: "when a theme is
   * added all sites get it"). Optional because a stale vendored theme.js will
   * not have them — `themeLabel()` below is the one place that decides what to
   * do about that.
   */
  labels?: Record<string, string>;
  label?: (theme: string) => string;
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
 * The human name for a theme id.
 *
 * ⚠️ There is deliberately no label map in this repo. The switcher owns the
 * names beside the ids it owns, so theme #6 arrives in this cog fully dressed
 * on the next sync — it used to arrive wearing its raw id until someone typed a
 * name here, which is a smaller bug than a hidden theme but still a bug the
 * owner's 2026-08-17 order rules out ("when a theme is added all sites get
 * it"). The capitalise is only for a vendored theme.js older than that day.
 */
export function themeLabel(theme: string): string {
  const api = estateTheme();
  if (api && typeof api.label === 'function') return api.label(theme);
  return theme ? theme.charAt(0).toUpperCase() + theme.slice(1) : theme;
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
