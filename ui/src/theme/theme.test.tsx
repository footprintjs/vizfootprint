// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { render } from '@testing-library/react';
import { TOKEN_VARS, FOLLOWING_TOKENS, tokensToCSSVars, mergeTokens, slateLight, slateDark, themePresets, accentColors, VizTheme, type ThemeTokens } from './index.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  readonly selector: string;
  /** The at-rule the rule sits inside, or '' at the top level. */
  readonly media: string;
  readonly declares: Readonly<Record<string, string>>;
}

/** Every style rule of the stylesheet, with the custom properties it declares. One level of at-rule nesting is read. */
function rulesOf(css: string, media = ''): Rule[] {
  const rules: Rule[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open < 0) break;
    const prelude = css.slice(at, open).trim();
    let depth = 1;
    let close = open + 1;
    while (depth > 0) {
      if (css[close] === '{') depth += 1;
      if (css[close] === '}') depth -= 1;
      close += 1;
    }
    const body = css.slice(open + 1, close - 1);
    if (prelude.startsWith('@')) {
      if (media === '' && /^@(media|supports|container)/.test(prelude)) rules.push(...rulesOf(body, prelude));
    } else {
      const declares: Record<string, string> = {};
      for (const m of body.matchAll(/(--vzf-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) declares[m[1]!] = m[2]!.trim();
      rules.push({ selector: prelude.replace(/\s+/g, ' '), media, declares });
    }
    at = close;
  }
  return rules;
}

const RULES = rulesOf(CSS);
const W = ':where(.vzf, .vzf-theme)';
const ROOT_RULE = `${W}:not(${W} *)`;
const DARK_AUTO_RULE = `${W}:where(:not([data-theme="light"])):not(${W} *)`;
const DARK_RULE = `${W}:where([data-theme="dark"])`;
const LIGHT_RULE = `${W}:where([data-theme="light"])`;
const DARK_PREFERENCE = '@media (prefers-color-scheme: dark)';

function declared(selector: string, media = ''): Readonly<Record<string, string>> {
  const found = RULES.filter((r) => r.selector === selector && r.media === media);
  if (found.length !== 1) throw new Error(`expected one rule "${selector}"${media && ` in ${media}`}, found ${found.length}`);
  return found[0]!.declares;
}

const tokenVars: string[] = Object.values(TOKEN_VARS).flatMap((group) => Object.values(group));

/** Every non-test source file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

/**
 * Properties a component declares or reads for itself and no theme names yet. Each one is a value a consumer cannot reach through `ThemeTokens`.
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
  // a scroll box's height ceiling: declared nowhere, read by `.vzf-scroll-y` with a 320px fallback, for a host to set
  '--vzf-scroll-max',
]);

describe('the token table and the stylesheet agree', () => {
  it('names each CSS property once', () => {
    expect(new Set(tokenVars).size).toBe(tokenVars.length);
  });

  const light = tokensToCSSVars(slateLight);
  const dark = tokensToCSSVars(slateDark);
  /** What the dark preset changes, and the light values of the same tokens. */
  const darkChanges = Object.fromEntries(Object.entries(dark).filter(([name, value]) => light[name] !== value));
  const lightOfThose = Object.fromEntries(Object.keys(darkChanges).map((name) => [name, light[name]]));

  it('the stylesheet declares exactly the default preset on the outermost theme root', () => {
    expect(declared(ROOT_RULE)).toEqual(light);
  });

  it('the two dark rules declare exactly what the dark preset changes, and the automatic one only under a dark preference', () => {
    expect(Object.keys(darkChanges).length).toBeGreaterThan(0);
    expect(declared(DARK_AUTO_RULE, DARK_PREFERENCE)).toEqual(darkChanges);
    expect(declared(DARK_RULE)).toEqual(darkChanges);
  });

  it('a forced light element re-declares the same tokens at their light values, and no others', () => {
    expect(declared(LIGHT_RULE)).toEqual(lightOfThose);
  });

  it('a token is declared in the four theme rules and nowhere else in the stylesheet', () => {
    // counted over the WHOLE stylesheet, not over the rules the parser recognised: a declaration
    // inside `@layer`, a nested at-rule, `@keyframes`, or a copy of a theme rule in another
    // at-rule would reset an ancestor's theme, and none of them is one of the four rules below
    const everywhere = [...CSS.matchAll(/(--vzf-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!).filter((name) => tokenVars.includes(name));
    const inThemeRules = [declared(ROOT_RULE), declared(DARK_AUTO_RULE, DARK_PREFERENCE), declared(DARK_RULE), declared(LIGHT_RULE)].flatMap((rule) => Object.keys(rule));
    expect(everywhere.sort()).toEqual(inThemeRules.sort());
  });

  it('the theme rules have zero specificity: every part of each selector sits in :where', () => {
    const outsideWhere = (selector: string): string => {
      let rest = selector;
      for (let before = ''; before !== rest; ) {
        before = rest;
        rest = rest.replace(/:where\([^()]*(\([^()]*\)[^()]*)*\)/g, '');
      }
      return rest;
    };
    for (const selector of [ROOT_RULE, DARK_AUTO_RULE, DARK_RULE, LIGHT_RULE]) {
      expect(outsideWhere(selector)).toMatch(/^(:not\( \*\))?$/);
    }
  });

  it('a theme wrapper takes no box, and only one rule says so', () => {
    const wrapperRules = RULES.filter((r) => /(^|[^-\w])\.vzf-theme(?![-\w])/.test(r.selector.replaceAll(W, '')));
    expect(wrapperRules.map((r) => [r.selector, r.media])).toEqual([['.vzf-theme', '']]);
    expect(CSS.replace(/\s+/g, ' ')).toContain('.vzf-theme { display: contents; }');
  });

  it('a token that follows another has no declaration and carries its fallback at every read', () => {
    const text = CSS + sources(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const [name, source] of Object.entries(FOLLOWING_TOKENS)) {
      expect(RULES.filter((r) => name in r.declares)).toEqual([]);
      const reads = [...text.matchAll(new RegExp(`var\\(${name}[^a-z0-9-][^)]*\\)?\\)`, 'g'))].map((m) => m[0]);
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) expect(read).toBe(`var(${name}, var(${source}))`);
      expect(Object.keys(light)).not.toContain(name);
    }
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

  it('every preset names every token that has a value of its own, and is frozen', () => {
    const ownValue = tokenVars.filter((name) => !(name in FOLLOWING_TOKENS)).sort();
    for (const preset of Object.values(themePresets)) {
      expect(Object.keys(tokensToCSSVars(preset)).sort()).toEqual(ownValue);
      expect(Object.isFrozen(preset) && Object.values(preset).every((group) => Object.isFrozen(group))).toBe(true);
    }
  });
});

describe('tokensToCSSVars', () => {
  it('emits only what a partial theme names', () => {
    expect(tokensToCSSVars({ colors: { brand: '#0a7d5a' }, radii: { sm: '2px' } })).toEqual({ '--vzf-brand': '#0a7d5a', '--vzf-r-sm': '2px' });
  });

  it('treats no theme, an undefined group and an undefined field as omissions', () => {
    expect(tokensToCSSVars()).toEqual({});
    expect(tokensToCSSVars(null)).toEqual({});
    expect(tokensToCSSVars({ colors: undefined, fontFamily: null, radii: { sm: undefined, lg: null, md: '4px' } } as unknown as ThemeTokens)).toEqual({ '--vzf-r-md': '4px' });
    expect(tokensToCSSVars(Object.assign(Object.create(null) as object, { radii: { md: '4px' } }))).toEqual({ '--vzf-r-md': '4px' });
  });

  it.each([
    ['an unknown group', { colours: { brand: '#000' } }, 'unknown token group "colours"'],
    ['an inherited group name', { constructor: { brand: '#000' } }, 'unknown token group "constructor"'],
    ['a theme that is not a plain object', new Map([['colors', {}]]), 'a theme must be a plain object'],
    ['an array as the theme', [{ colors: {} }], 'a theme must be a plain object'],
    ['a string as the theme', 'dark', 'a theme must be a plain object'],
    ['a group that is not an object', { colors: '#000' }, 'token group "colors" must be a plain object'],
    ['an array group', { colors: ['#000'] }, 'token group "colors" must be a plain object'],
    ['a class instance as a group', { colors: new Date(0) }, 'token group "colors" must be a plain object'],
    ['an own __proto__ group', JSON.parse('{"__proto__":{"brand":"#000"}}'), 'unknown token group "__proto__"'],
    ['a separator inside a quote', { fontFamily: { body: '"A;B"' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
    ['an unclosed comment', { colors: { brand: 'red/*' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['a comment close', { colors: { brand: 'red*/' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['an escape that spells url(', { colors: { brand: 'u\\72l(a")") x' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['an escaped quote', { fontFamily: { body: '"a\\"b"' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
    ['an open square bracket', { colors: { brand: 'x [' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['a stray closing square bracket', { colors: { brand: 'x ]' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['brackets closed out of order', { colors: { brand: 'a(b[c)d]' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['an unquoted url', { colors: { brand: 'url(a")") x' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['a carriage return inside a quote', { fontFamily: { body: '"a\rb"' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
    ['a form feed inside a quote', { fontFamily: { body: '"a\fb"' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
    ['a tab', { fontFamily: { body: 'a\tb' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
    ['a comment inside a function', { colors: { brand: 'rgb(1 2 3 /* x */)' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['an open quote', { fontFamily: { body: '"Inter' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
    ['a newline inside a quote', { fontFamily: { body: '"In\nter"' } }, 'token "fontFamily.body" must be one non-empty CSS value'],
    ['an open bracket', { colors: { brand: 'rgb(1, 2, 3' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['a stray closing bracket', { colors: { brand: 'red)' } }, 'token "colors.brand" must be one non-empty CSS value'],
    ['a trailing backslash', { colors: { brand: 'red\\' } }, 'token "colors.brand" must be one non-empty CSS value'],
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

describe('one CSS value', () => {
  it.each([
    ['a font stack with quotes', { fontFamily: { body: '"Inter", \'Segoe UI\', sans-serif' } }],
    ['nested functions', { colors: { brand: 'color-mix(in srgb, var(--x, rgb(1 2 3)) 40%, white)' } }],
    ['a bracket inside a quote', { fontFamily: { body: '"a(b"' } }],
    ['a quoted url', { colors: { brand: 'url( "a.png")' } }],
    ['square brackets', { spacing: { md: 'calc(1px * [x])' } }],
    ['an alpha slash', { colors: { brand: 'rgb(1 2 3 / 50%)' } }],
  ])('accepts %s', (_case, tokens) => {
    expect(Object.keys(tokensToCSSVars(tokens as ThemeTokens))).toHaveLength(1);
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

  it('refuses what the emitter refuses, in either argument', () => {
    expect(() => mergeTokens({ colours: {} } as unknown as ThemeTokens, {})).toThrow('unknown token group "colours"');
    expect(() => mergeTokens({}, { colors: { brand: 'a;b' } })).toThrow('token "colors.brand"');
    expect(mergeTokens({}, null as unknown as ThemeTokens)).toEqual({});
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

  it.each([
    ['#ffee88', '#1b2430'],
    ['#33ccff', '#1b2430'],
    ['#ff8800', '#1b2430'],
    ['#c8c8c8', '#1b2430'],
    ['#f2a02c', '#1b2430'],
    ['#7c5cff', '#ffffff'],
    ['#101826', '#ffffff'],
  ])('over %s the ink with the higher contrast is %s', (base, ink) => {
    expect(accentColors('agent', base).onAgent).toBe(ink);
  });

  it('refuses a role or a mode it does not have', () => {
    expect(() => accentColors('bogus' as 'brand', '#000')).toThrow('no role "bogus"');
    expect(() => accentColors('brand', '#000', 'auto' as 'dark')).toThrow('mode must be "light" or "dark"');
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

  it('a whole preset declares every token that has a value of its own', () => {
    const { container } = render(<VizTheme tokens={slateDark} />);
    const root = container.firstElementChild as HTMLElement;
    for (const name of tokenVars) expect(root.style.getPropertyValue(name) === '').toBe(name in FOLLOWING_TOKENS);
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
