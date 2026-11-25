/**
 * ONE BRAND COLOUR IN, ITS FOUR TOKENS OUT.
 *
 * Each accent is drawn four ways: the base, a deeper shade, a tint for fills
 * and the ink placed over the base. `accentColors` derives the other three from
 * one hex, so a consumer with a single brand colour does not have to pick them.
 * A consumer who has all four writes them into `colors` directly.
 */
import type { ThemeTokens } from './tokens.js';

/** The accents a theme carries. */
export type AccentRole = 'brand' | 'user' | 'agent' | 'ok' | 'danger';

/** The ground the tint is mixed toward. */
export type ThemeMode = 'light' | 'dark';

type Rgb = readonly [number, number, number];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEEPEN = 0.26;
const TINT = 0.84;
const TINT_GROUND: Readonly<Record<ThemeMode, Rgb>> = { light: [255, 255, 255], dark: [26, 34, 49] };
const ROLES: readonly AccentRole[] = ['brand', 'user', 'agent', 'ok', 'danger'];
/** The two inks a fill may carry; the one with the higher contrast against the fill is chosen. */
const INKS = ['#ffffff', '#1b2430'] as const;

function rgbOf(hex: string): Rgb {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexOf(rgb: Rgb): string {
  return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 (none) to 21 (black on white). */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const capital = (role: AccentRole): string => role.charAt(0).toUpperCase() + role.slice(1);

/**
 * The four colour tokens of one accent, derived from its base.
 *
 * `base` is a three- or six-digit hex. Anything else is refused with a
 * `TypeError`: a named colour or an `rgb()` string cannot be shaded here, and
 * guessing would paint a colour the consumer never chose. The ink over the
 * base is whichever of white and the dark ink has the higher WCAG contrast
 * against it. That is the better of two, not a promise of 4.5:1 — a mid-tone
 * base may reach neither, and then the consumer should name `on…` themselves.
 */
export function accentColors(role: AccentRole, base: string, mode: ThemeMode = 'light'): NonNullable<ThemeTokens['colors']> {
  if (!ROLES.includes(role)) throw new TypeError(`vizfootprint-ui theme: accentColors has no role "${String(role)}"`);
  if (mode !== 'light' && mode !== 'dark') throw new TypeError(`vizfootprint-ui theme: accentColors("${role}") mode must be "light" or "dark"`);
  if (typeof base !== 'string' || !HEX.test(base)) {
    throw new TypeError(`vizfootprint-ui theme: accentColors("${role}") needs a #rgb or #rrggbb colour`);
  }
  const rgb = rgbOf(base);
  const ground = TINT_GROUND[mode];
  const deep = rgb.map((c) => c * (1 - DEEPEN)) as unknown as Rgb;
  const tint = rgb.map((c, i) => c + (ground[i]! - c) * TINT) as unknown as Rgb;
  return {
    [role]: hexOf(rgb),
    [`${role}Deep`]: hexOf(deep),
    [`${role}Tint`]: hexOf(tint),
    [`on${capital(role)}`]: contrast(rgb, rgbOf(INKS[0])) >= contrast(rgb, rgbOf(INKS[1])) ? INKS[0] : INKS[1],
  };
}
