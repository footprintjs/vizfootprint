/**
 * vizfootprint-ui — theme engine.
 *
 * The default look is defined in `styles.css` on the `.vzf` root element (not
 * `:root`), with light/dark chosen by `prefers-color-scheme` plus a
 * `data-theme` override that wins in both directions. This module lets a
 * consumer OVERRIDE a subset of tokens programmatically: `resolveTheme` turns a
 * loose config into a concrete `{ '--vzf-…': value }` map, and `themeStyle`
 * returns that map as a React `style` object to spread onto the dashboard root
 * (`<div className="vzf" style={themeStyle(theme)} data-theme={mode}>`), so two
 * dashboards can wear different brands on one page and nothing leaks OUT.
 *
 * A colour override is a single hex (its `-deep`/`-tint` shades derived) or a
 * full `{ base, deep, tint }` triad. `mode: 'light' | 'dark' | 'auto'` selects
 * the neutral surface/ink palette; `'auto'` (default) leaves it to the OS.
 */

export type ColorInput = string | { readonly base: string; readonly deep?: string; readonly tint?: string };

export interface ThemeConfig {
  /** 'auto' (default) follows the OS; 'light'/'dark' force it via the data-theme override. */
  readonly mode?: 'light' | 'dark' | 'auto';
  /** Accent overrides — brand (provenance spine), user, agent, ok (discovery), danger (gap). */
  readonly colors?: {
    readonly brand?: ColorInput;
    readonly user?: ColorInput;
    readonly agent?: ColorInput;
    readonly ok?: ColorInput;
    readonly danger?: ColorInput;
  };
  readonly fonts?: { readonly display?: string; readonly body?: string; readonly mono?: string };
  /** Multiplies every text size so the dashboard matches the host's density. */
  readonly textScale?: number;
  readonly radii?: { readonly sm?: string; readonly md?: string; readonly lg?: string };
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

function hexToRgb(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function darken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}
function mix(hex: string, target: string, m: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(target);
  return toHex(r + (tr - r) * m, g + (tg - g) * m, b + (tb - b) * m);
}
/** Relative luminance → a readable foreground over a coloured fill. */
function readableOn(hex: string): string {
  const rgb = hexToRgb(hex);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return L > 0.6 ? '#1b2430' : '#ffffff';
}

/** A resolved accent triad + its on-colour, as CSS-var fragments. */
function accentVars(name: string, input: ColorInput | undefined, dark: boolean): Record<string, string> {
  if (input === undefined) return {};
  const base = isHex(input) ? input : input.base;
  const deep = (!isHex(input) && input.deep) || darken(base, 0.26);
  const tintBg = dark ? '#1a2231' : '#ffffff';
  const tint = (!isHex(input) && input.tint) || mix(base, tintBg, 0.84);
  const vars: Record<string, string> = {
    [`--vzf-${name}`]: base,
    [`--vzf-${name}-deep`]: deep,
    [`--vzf-${name}-tint`]: tint,
  };
  vars[`--vzf-on-${name}`] = readableOn(base);
  return vars;
}

/** Turn a loose {@link ThemeConfig} into a concrete CSS-variable override map. */
export function resolveTheme(config: ThemeConfig = {}): Record<string, string> {
  const dark = config.mode === 'dark';
  const c = config.colors ?? {};
  const vars: Record<string, string> = {
    ...accentVars('brand', c.brand, dark),
    ...accentVars('user', c.user, dark),
    ...accentVars('agent', c.agent, dark),
    ...accentVars('ok', c.ok, dark),
    ...accentVars('danger', c.danger, dark),
  };
  if (config.fonts?.display) vars['--vzf-font-display'] = config.fonts.display;
  if (config.fonts?.body) vars['--vzf-font-body'] = config.fonts.body;
  if (config.fonts?.mono) vars['--vzf-font-mono'] = config.fonts.mono;
  if (config.textScale != null) vars['--vzf-text-scale'] = String(config.textScale);
  if (config.radii?.sm) vars['--vzf-r-sm'] = config.radii.sm;
  if (config.radii?.md) vars['--vzf-r-md'] = config.radii.md;
  if (config.radii?.lg) vars['--vzf-r-lg'] = config.radii.lg;
  return vars;
}

/** The `data-theme` attribute value for a config, or undefined for 'auto'. */
export function themeAttr(config: ThemeConfig = {}): 'light' | 'dark' | undefined {
  return config.mode === 'light' || config.mode === 'dark' ? config.mode : undefined;
}

/** Resolved theme as a React `style` object (spread onto the `.vzf` root). */
export function themeStyle(config: ThemeConfig = {}): Record<string, string> {
  return resolveTheme(config);
}

/** Imperative escape hatch: write the resolved variables onto an element. */
export function applyTheme(el: HTMLElement, config: ThemeConfig = {}): void {
  const vars = resolveTheme(config);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  const attr = themeAttr(config);
  if (attr) el.setAttribute('data-theme', attr);
}
