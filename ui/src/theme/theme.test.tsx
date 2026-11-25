// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { render } from '@testing-library/react';
import { TOKEN_VARS, tokensToCSSVars, mergeTokens, slateLight, slateDark, themePresets, accentColors, VizTheme, type ThemeTokens } from './index.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties one rule declares, found by the rule's exact selector text. */
function declared(selector: string): Record<string, string> {
  const at = CSS.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule: ${selector}`);
  const body = CSS.slice(CSS.indexOf('{', at) + 1, CSS.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--vzf-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const ROOT = ':is(.vzf, .vzf-theme)';
const LIGHT_RULE = `${ROOT}:not(${ROOT} *),\n${ROOT}[data-theme="light"]`;
const DARK_AUTO_RULE = `${ROOT}:not([data-theme="light"]):not(${ROOT} *)`;
const DARK_RULE = `${ROOT}[data-theme="dark"]`;

const tokenVars = Object.values(TOKEN_VARS).flatMap((group) => Object.values(group));

/** Every non-test source file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

/**
 * Properties the stylesheet or a component declares for itself and no theme
 * names yet. Each one is a value a consumer cannot reach through `ThemeTokens`.
 * The list only shrinks: a feature leaves it when its sizes become tokens.
 */
const COMPONENT_VARS = new Set([
  // set at run time from a measurement or a data binding — never a theme's to choose
  '--vzf-tick',
  '--vzf-scale-hue',
  '--vzf-aside-w',
  // the time-travel rail's own dials, declared on `.vzf-timeline`
  '--vzf-rail-w',
  '--vzf-tl-h',
  '--vzf-tl-slot',
  '--vzf-tl-pad',
  '--vzf-tl-bar',
  '--vzf-tl-bar-agent',
  '--vzf-tl-bar-ahead',
  '--vzf-tl-bar-head',
  '--vzf-tl-bar-cursor',
  '--vzf-tl-bar-line',
  // the sheet's scroll ceiling, declared on the sheet
  '--vzf-scroll-max',
]);

describe('the token table and the stylesheet agree', () => {
  it('names each CSS property once', () => {
    expect(new Set(tokenVars).size).toBe(tokenVars.length);
  });

  it('the stylesheet declares exactly the default preset on the theme root', () => {
    expect(declared(LIGHT_RULE)).toEqual(tokensToCSSVars(slateLight));
  });

  it('both dark rules declare exactly what the dark preset changes', () => {
    const light = tokensToCSSVars(slateLight);
    const dark = tokensToCSSVars(slateDark);
    const changed = Object.fromEntries(Object.entries(dark).filter(([name, value]) => light[name] !== value));
    expect(Object.keys(changed).length).toBeGreaterThan(0);
    expect(declared(DARK_AUTO_RULE)).toEqual(changed);
    expect(declared(DARK_RULE)).toEqual(changed);
  });

  it('every property the stylesheet or a component names is a token or a listed component property', () => {
    const text = CSS + sources(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
    const named = new Set([...text.matchAll(/--vzf-[a-z0-9-]*[a-z0-9]/g)].map((m) => m[0]));
    // `--vzf-seq-${n}` is written as a prefix in source; the ramp tokens are what it completes to
    named.delete('--vzf-seq');
    const known = new Set([...tokenVars, ...COMPONENT_VARS]);
    expect([...named].filter((name) => !known.has(name))).toEqual([]);
    // and nothing is listed that no file names any more
    expect([...known].filter((name) => !named.has(name))).toEqual([]);
  });

  it('every preset names every token', () => {
    for (const preset of Object.values(themePresets)) {
      expect(Object.keys(tokensToCSSVars(preset)).sort()).toEqual([...tokenVars].sort());
    }
  });
});

describe('tokensToCSSVars', () => {
  it('emits only what a partial theme names', () => {
    expect(tokensToCSSVars({ colors: { brand: '#0a7d5a' }, radii: { sm: '2px' } })).toEqual({ '--vzf-brand': '#0a7d5a', '--vzf-r-sm': '2px' });
  });

  it('treats no theme, an undefined group and an undefined field as omissions', () => {
    expect(tokensToCSSVars()).toEqual({});
    expect(tokensToCSSVars({ colors: undefined, radii: { sm: undefined, md: '4px' } } as ThemeTokens)).toEqual({ '--vzf-r-md': '4px' });
  });

  it.each([
    ['an unknown group', { colours: { brand: '#000' } }, 'unknown token group "colours"'],
    ['an inherited group name', { constructor: { brand: '#000' } }, 'unknown token group "constructor"'],
    ['a group that is not an object', { colors: '#000' }, 'token group "colors" must be an object'],
    ['a null group', { colors: null }, 'token group "colors" must be an object'],
    ['an array group', { colors: ['#000'] }, 'token group "colors" must be an object'],
    ['an unknown field', { colors: { brnad: '#000' } }, 'unknown token "colors.brnad"'],
    ['an inherited field name', { colors: { toString: '#000' } }, 'unknown token "colors.toString"'],
    ['a number', { typography: { scale: 1.2 } }, 'token "typography.scale" must be one non-empty CSS value'],
    ['an empty value', { colors: { brand: '  ' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['a value that ends its declaration', { colors: { brand: 'red; background: url(x)' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['a value that closes its rule', { fontFamily: { body: 'x } body { color: red' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
  ])('refuses %s, naming it', (_case, tokens, message) => {
    expect(() => tokensToCSSVars(tokens as unknown as ThemeTokens)).toThrow(message);
    expect(() => tokensToCSSVars(tokens as unknown as ThemeTokens)).toThrow(TypeError);
  });
});

describe('mergeTokens', () => {
  it('lays the second theme over the first, field by field', () => {
    const merged = mergeTokens({ colors: { brand: '#111', ink: '#222' } }, { colors: { brand: '#333' }, radii: { sm: '1px' } });
    expect(merged).toEqual({ colors: { brand: '#333', ink: '#222' }, radii: { sm: '1px' } });
  });

  it('an undefined field keeps the base value, and neither input is changed', () => {
    const base: ThemeTokens = { colors: { brand: '#111' } };
    const over = { colors: { brand: undefined } } as ThemeTokens;
    expect(mergeTokens(base, over)).toEqual({ colors: { brand: '#111' } });
    expect(base).toEqual({ colors: { brand: '#111' } });
  });

  it('the dark preset is the light one with a dark ground', () => {
    expect(slateDark.spacing).toEqual(slateLight.spacing);
    expect(slateDark.colors.brand).toBe(slateLight.colors.brand);
    expect(slateDark.colors.paper).not.toBe(slateLight.colors.paper);
  });
});

describe('accentColors', () => {
  it('derives the deep shade, the tint and the ink over the base', () => {
    expect(accentColors('brand', '#3366ff')).toEqual({ brand: '#3366ff', brandDeep: '#264bbd', brandTint: '#dee7ff', onBrand: '#ffffff' });
  });

  it('expands a three-digit hex', () => {
    expect(accentColors('ok', '#0f0').ok).toBe('#00ff00');
  });

  it('mixes the tint toward the dark ground in dark mode', () => {
    const light = accentColors('user', '#0055cc');
    const dark = accentColors('user', '#0055cc', 'dark');
    expect(dark.user).toBe(light.user);
    expect(dark.userTint).not.toBe(light.userTint);
  });

  it('puts dark ink over a light fill', () => {
    expect(accentColors('agent', '#ffee88').onAgent).toBe('#1b2430');
  });

  it('feeds the token emitter', () => {
    expect(tokensToCSSVars({ colors: accentColors('danger', '#cc0033') })['--vzf-on-danger']).toBe('#ffffff');
  });

  it.each(['red', 'rgb(1,2,3)', '#12', '#12345', '#1234567', '#12345678', '', 7])('refuses %s', (bad) => {
    expect(() => accentColors('brand', bad as string)).toThrow(TypeError);
  });
});

describe('<VizTheme>', () => {
  it('declares a partial theme on one wrapper and keeps its children', () => {
    const { container } = render(
      <VizTheme tokens={{ colors: { brand: '#0a7d5a' } }}>
        <span>inside</span>
      </VizTheme>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('vzf-theme');
    expect(root.style.getPropertyValue('--vzf-brand')).toBe('#0a7d5a');
    expect(root.style.getPropertyValue('--vzf-ink')).toBe('');
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.textContent).toBe('inside');
  });

  it('a whole preset declares every token', () => {
    const { container } = render(<VizTheme tokens={slateDark} />);
    const root = container.firstElementChild as HTMLElement;
    for (const name of tokenVars) expect(root.style.getPropertyValue(name)).not.toBe('');
    expect(root.style.getPropertyValue('--vzf-paper')).toBe(slateDark.colors.paper);
  });

  it('stamps a forced mode and keeps the host class', () => {
    const { container } = render(<VizTheme mode="dark" className="mine" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.className).toBe('vzf-theme mine');
    expect(root.getAttribute('style')).toBeNull();
  });

  it('an inner theme declares only what it names', () => {
    const { container } = render(
      <VizTheme tokens={{ colors: { brand: '#111111', ink: '#222222' } }}>
        <VizTheme tokens={{ colors: { brand: '#333333' } }} />
      </VizTheme>,
    );
    const inner = container.querySelectorAll('.vzf-theme')[1] as HTMLElement;
    expect(inner.style.getPropertyValue('--vzf-brand')).toBe('#333333');
    expect(inner.style.getPropertyValue('--vzf-ink')).toBe('');
  });
});
