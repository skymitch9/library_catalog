/**
 * The `hearts` theme, and the per-INSTANCE default that makes it padhard's.
 *
 * Four separate ways this feature can be silently broken, one group each:
 *
 *   1. **The theme is not registered.** `theme.js` validates a stored
 *      `hg_theme` against its own THEMES array, so a theme missing from the
 *      vendored switcher cannot be chosen and does not survive a reload —
 *      while the CSS still contains its tokens, so nothing else complains.
 *      ⚠️ These read the VENDORED copy under public/estate/, which `pretest`
 *      re-syncs from catalog-platform on every run: they therefore fail when
 *      the sibling checkout is stale, which is the actual failure mode (this
 *      repo cannot fix the asset itself — the canonical copy lives there).
 *   2. **The theme is unstyled or unreadable.** A theme that omits a token
 *      inherits apple's value for it and renders half-dressed; a pink theme
 *      that puts pink on pink renders unreadable. Both are checked by
 *      measurement, not by eye.
 *   3. **wrangler.toml and index.html drift.** The Worker does not read
 *      `DEFAULT_THEME` (both instances serve one bundle, so the default is
 *      resolved in the browser from `location.hostname`). The var is still
 *      the posture of record, so this file pins the two together — the same
 *      guard `details-sweep.test.ts` puts on the cron string.
 *   4. **The resolver runs too late.** It must execute BEFORE theme.js, or it
 *      changes an attribute nothing will read again.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

function repoFile(relative: string): string {
  // fileURLToPath, not a URL object — readFileSync(URL) does not typecheck
  // across this repo's two TS libs (details-sweep.test.ts hit the same).
  return readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url).href), 'utf8');
}

const INDEX_HTML = repoFile('apps/web/index.html');
const THEME_JS = repoFile('apps/web/public/estate/theme.js');
const THEME_CSS = repoFile('apps/web/public/estate/estate-theme.css');
const WRANGLER = repoFile('apps/worker/wrangler.toml');
const THEME_COG = repoFile('apps/web/src/components/ThemeCog.tsx');

/** The themes the vendored switcher will actually accept. */
function registeredThemes(): string[] {
  const match = THEME_JS.match(/var THEMES = \[([^\]]+)\]/);
  assert.ok(match, 'theme.js has no THEMES array — the vendored switcher is not what we think it is');
  return match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

/** The declarations inside one `:root[...] { … }` block, as a token → value map. */
function tokenBlock(selector: string): Map<string, string> {
  const start = THEME_CSS.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `estate-theme.css has no \`${selector}\` block`);
  const end = THEME_CSS.indexOf('\n}', start);
  const body = THEME_CSS.slice(start, end);
  const tokens = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/^\s*(--et-[a-z0-9-]+):\s*([^;]+);/gim)) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

/**
 * A TOML table's body — from its header to the next header. Comment lines are
 * skipped as terminators so a `# [something]` in prose cannot end a section
 * early.
 */
function tomlTable(header: string): string {
  const lines = WRANGLER.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  assert.notEqual(start, -1, `wrangler.toml has no ${header} table`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim().startsWith('#') && /^\s*\[/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

function tomlString(body: string, key: string): string {
  const match = body.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
  assert.ok(match, `expected ${key} in that wrangler.toml table`);
  return match[1];
}

/** WCAG 2.x relative luminance / contrast, for `#rrggbb` only. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('hearts is a real theme, not just a stylesheet block', () => {
  it('the vendored switcher accepts it — without this it cannot be chosen or persisted', () => {
    assert.ok(
      registeredThemes().includes('hearts'),
      'theme.js THEMES has no `hearts`: the cog would offer it and the choice would vanish on reload. ' +
        'The registry is catalog-platform/sites/heygabi-home/public/assets/theme.js — pull it.',
    );
  });

  it('it is defined in BOTH modes — mode and theme compose, always', () => {
    assert.ok(tokenBlock(':root[data-theme="hearts"]').size > 0);
    assert.ok(tokenBlock(':root[data-theme="hearts"][data-mode="dark"]').size > 0);
  });

  it('it restates every token retro does — a missing one silently inherits apple', () => {
    const retro = [...tokenBlock(':root[data-theme="retro"]').keys()];
    const hearts = tokenBlock(':root[data-theme="hearts"]');
    const missing = retro.filter((token) => !hearts.has(token));
    assert.deepEqual(missing, [], `hearts is missing tokens the contract expects: ${missing.join(', ')}`);
  });

  it('carries the pixel-heart motif as its texture, with no external asset', () => {
    const texture = tokenBlock(':root[data-theme="hearts"]').get('--et-bg-texture') ?? '';
    assert.match(texture, /data:image\/svg\+xml/, 'the heart tile must be inline, not a file a consumer can forget to copy');
    assert.match(texture, /crispEdges/, 'without crispEdges the 8-bit heart antialiases into a blob');
  });

  it('every theme the switcher offers has a human label — IN THE SWITCHER', () => {
    // Moved 2026-08-17 (owner: "when a theme is added all sites get it"). This
    // used to assert a THEME_LABELS map in ThemeCog.tsx, which meant a theme
    // added upstream landed in the dropdown wearing its raw id until somebody
    // typed a name in THIS repo — a smaller bug than a hidden theme, but the
    // same shape, and this test would have gone red for a change made
    // correctly elsewhere. Names now live beside the ids they name, in
    // canonical's LABELS, and arrive with the sync.
    for (const theme of registeredThemes()) {
      assert.match(
        THEME_JS,
        new RegExp(`^\\s*${theme}:\\s*'`, 'm'),
        `theme.js's LABELS has no entry for \`${theme}\` — every cog on the estate would show ` +
          'its raw id. The registry and its names are both in ' +
          'catalog-platform/sites/heygabi-home/public/assets/theme.js.',
      );
    }
  });

  it('the cog keeps NO theme list and NO label map of its own', () => {
    // The invariant that replaces the map: this repo may not hold a second
    // registry in any form. Both halves come from window.estateTheme.
    assert.match(
      THEME_COG,
      /api\.themes\.map/,
      'ThemeCog no longer renders api.themes — if it has grown its own list, that list will go stale',
    );
    assert.match(
      THEME_COG,
      /themeLabel\(/,
      'ThemeCog no longer asks themeLabel() for names — a local label map goes stale the same way',
    );
    assert.doesNotMatch(
      THEME_COG,
      /^\s*(classic|apple|cyberpunk|retro|hearts):\s*'/m,
      'ThemeCog has grown a per-theme map again. Names belong in canonical theme.js, beside the ids.',
    );
  });

  it('the switcher exposes those labels to consumers that render their own control', () => {
    // The library, games and audiobook cogs are all React/JS rather than the
    // apex's markup contract, so the API is how they get names at all.
    assert.match(THEME_JS, /label:\s*labelFor/, 'window.estateTheme.label() is missing from the vendored switcher');
    assert.match(THEME_JS, /labels:\s*\(function/, 'window.estateTheme.labels is missing from the vendored switcher');
  });
});

describe('hearts is legible — pink on white, never pink on pink', () => {
  const light = tokenBlock(':root[data-theme="hearts"]');
  const dark = tokenBlock(':root[data-theme="hearts"][data-mode="dark"]');

  it('light: body text, muted text and both accent voices clear 4.5:1 on the card face', () => {
    const face = light.get('--et-surface')!;
    assert.ok(contrast(light.get('--et-fg')!, face) >= 7, 'body text should clear AAA on white');
    for (const token of ['--et-muted', '--et-accent', '--et-accent-2'] as const) {
      const ratio = contrast(light.get(token)!, face);
      assert.ok(ratio >= 4.5, `${token} is ${ratio.toFixed(2)}:1 on the card face — under 4.5:1`);
    }
  });

  it('light: button text clears 4.5:1 on the button ground', () => {
    const ratio = contrast(light.get('--et-btn-fg')!, light.get('--et-accent')!);
    assert.ok(ratio >= 4.5, `button label is ${ratio.toFixed(2)}:1 on its own ground`);
  });

  it('dark: the same three roles clear 4.5:1 on the dark surface', () => {
    const face = dark.get('--et-surface')!;
    assert.ok(contrast(dark.get('--et-fg')!, face) >= 7);
    for (const token of ['--et-muted', '--et-accent', '--et-accent-2'] as const) {
      const ratio = contrast(dark.get(token)!, face);
      assert.ok(ratio >= 4.5, `${token} is ${ratio.toFixed(2)}:1 on the dark card face`);
    }
  });
});

describe('the per-instance default: wrangler.toml is the posture, index.html renders it', () => {
  it('the main instance still defaults to what wrangler.toml says (unchanged: apple)', () => {
    const declared = INDEX_HTML.match(/data-default-theme="([^"]+)"/);
    assert.ok(declared, 'index.html lost its data-default-theme attribute');
    assert.equal(
      declared[1],
      tomlString(tomlTable('[vars]'), 'DEFAULT_THEME'),
      'index.html and the main [vars] DEFAULT_THEME disagree about this site’s identity',
    );
  });

  it('the friend instance’s hostname maps to the theme its own [env.friend.vars] declares', () => {
    const raw = INDEX_HTML.match(/data-default-theme-by-host='([^']+)'/);
    assert.ok(raw, 'index.html lost its per-host default map — padhard would boot apple');
    const byHost = JSON.parse(raw[1]) as Record<string, string>;

    const host = tomlString(tomlTable('[[env.friend.routes]]'), 'pattern');
    const theme = tomlString(tomlTable('[env.friend.vars]'), 'DEFAULT_THEME');

    assert.equal(
      byHost[host],
      theme,
      `wrangler.toml says ${host} defaults to ${theme}, index.html says ${byHost[host] ?? 'nothing'}`,
    );
    assert.ok(registeredThemes().includes(theme), `${theme} is not a theme the switcher knows`);
  });

  it('the map only ever names hosts this repo actually serves', () => {
    const raw = INDEX_HTML.match(/data-default-theme-by-host='([^']+)'/)!;
    const hosts = Object.keys(JSON.parse(raw[1]) as Record<string, string>);
    for (const host of hosts) {
      assert.match(
        WRANGLER,
        new RegExp(`pattern = "${host.replace(/\./g, '\\.')}"`),
        `index.html defaults ${host}, but no route in wrangler.toml claims it`,
      );
    }
  });

  it('the resolver runs BEFORE theme.js — after it, the attribute is already read', () => {
    const resolver = INDEX_HTML.indexOf('data-default-theme-by-host');
    const inline = INDEX_HTML.indexOf('byHost[location.hostname]');
    const switcher = INDEX_HTML.indexOf('/estate/theme.js');
    assert.ok(inline > 0, 'the inline hostname resolver is gone');
    assert.ok(resolver < switcher && inline < switcher, 'the resolver must precede theme.js in <head>');
  });

  it('a person’s own choice still wins — the resolver only moves the FALLBACK', () => {
    // The one line that would break this: writing hg_theme from the resolver.
    // theme.js owns that key (src/lib/estate-theme.ts header), and index.html
    // must never touch storage.
    assert.doesNotMatch(INDEX_HTML, /localStorage/, 'index.html must not touch hg_theme — theme.js owns it');
    assert.match(THEME_JS, /THEMES\.indexOf\(storedTheme\) >= 0 \? storedTheme : DEFAULT_THEME/);
  });
});
