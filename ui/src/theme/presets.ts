/**
 * THE SHIPPED THEMES — complete token sets a consumer can use, replace or start from.
 *
 * `slateLight` is the default: the stylesheet declares exactly these values on
 * the theme root. `slateDark` is the same set with the dark ground. Both are
 * COMPLETE, so passing one to `<VizTheme tokens>` replaces the theme as a whole
 * whatever the operating system prefers. `theme.test.ts` holds the stylesheet
 * and these objects to the same values.
 */
import { mergeTokens, type CompleteThemeTokens } from './tokens.js';

export const slateLight: CompleteThemeTokens = {
  colors: {
    paper: '#f5f7fa',
    surface: '#ffffff',
    surfaceRaised: '#eef2f7',
    surfaceSunken: '#e2e8f1',
    ink: '#101826',
    inkSoft: '#4a5768',
    inkFaint: '#8a97a8',
    line: '#dbe2ec',
    lineSoft: '#e9eef5',
    zero: 'var(--vzf-ink-faint)',
    brand: '#7c5cff',
    brandDeep: '#5b3fd6',
    brandTint: '#efecff',
    onBrand: '#ffffff',
    user: '#2f80f0',
    userDeep: '#1a5fca',
    userTint: '#e5effc',
    onUser: '#ffffff',
    agent: '#f2a02c',
    agentDeep: '#c67b0e',
    agentTint: '#fcf0da',
    onAgent: '#3a2600',
    ok: '#16a34a',
    okDeep: '#0f7a37',
    okTint: '#dcf3e4',
    onOk: '#ffffff',
    danger: '#f43f5e',
    dangerDeep: '#c81e3c',
    dangerTint: '#fde4e8',
    onDanger: '#ffffff',
    clay: '#b45309',
    clayTint: '#f7ecd9',
    rampLowest: '#c9e7e3',
    rampLow: '#9cd0cb',
    rampMiddle: '#6bb2ae',
    rampHigh: '#3d8b8a',
    rampHighest: '#1d5f63',
    mapEmpty: 'var(--vzf-surface-2)',
    scaleLeft: '#8a7a14',
    scaleRight: '#b03ad6',
    scrim: 'rgba(23, 32, 48, 0.38)',
    glass: 'rgba(255, 255, 255, 0.78)',
    glassLine: 'rgba(255, 255, 255, 0.55)',
  },
  fontFamily: {
    display: '"Space Grotesk", "Inter", system-ui, -apple-system, sans-serif',
    body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", "Menlo", monospace',
  },
  typography: {
    scale: '1',
  },
  spacing: {
    xxs: '4px',
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  radii: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    pill: '999px',
  },
  elevation: {
    sm: '0 1px 2px rgba(16, 24, 38, 0.06), 0 1px 3px rgba(16, 24, 38, 0.05)',
    md: '0 4px 14px rgba(16, 24, 38, 0.1), 0 1px 3px rgba(16, 24, 38, 0.07)',
    lg: '0 18px 46px rgba(16, 24, 38, 0.18), 0 4px 12px rgba(16, 24, 38, 0.1)',
    focus: '0 0 0 3px rgba(124, 92, 255, 0.4)',
  },
};

export const slateDark: CompleteThemeTokens = mergeTokens(slateLight, {
  colors: {
    paper: '#0b0f16',
    surface: '#131924',
    surfaceRaised: '#1a2231',
    surfaceSunken: '#232e3f',
    ink: '#e6edf6',
    inkSoft: '#9daabc',
    inkFaint: '#64717f',
    line: '#263140',
    lineSoft: '#1b2431',
    brandTint: '#241f3f',
    userTint: '#12233c',
    agentTint: '#33260f',
    agentDeep: '#f2a02c',
    onAgent: '#ffffff',
    okTint: '#10281a',
    dangerTint: '#331620',
    clay: '#e0913a',
    clayTint: '#2c2113',
    // the ramp's anchor flips on a dark ground: the highest magnitude is the brightest
    rampLowest: '#16383e',
    rampLow: '#1e565d',
    rampMiddle: '#2d7d81',
    rampHigh: '#4fa8a6',
    rampHighest: '#8ed5cd',
    scrim: 'rgba(2, 5, 10, 0.62)',
    glass: 'rgba(19, 25, 36, 0.84)',
    glassLine: 'rgba(125, 145, 175, 0.28)',
  },
  elevation: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.4)',
    md: '0 4px 14px rgba(0, 0, 0, 0.5)',
    lg: '0 18px 46px rgba(0, 0, 0, 0.6)',
  },
});

/** Every shipped theme, by name. */
export const themePresets = { slateLight, slateDark } as const;

export type ThemePresetName = keyof typeof themePresets;
