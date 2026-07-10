// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { resolveTheme, themeStyle, themeAttr, applyTheme } from './theme.js';

describe('theme engine', () => {
  it('derives -deep and -tint from a single-hex accent override', () => {
    const vars = resolveTheme({ colors: { brand: '#3366ff' } });
    expect(vars['--vzf-brand']).toBe('#3366ff');
    expect(vars['--vzf-brand-deep']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--vzf-brand-tint']).toMatch(/^#[0-9a-f]{6}$/);
    // tint is a pale mix toward white → brighter than the base
    expect(vars['--vzf-brand-tint']!.toLowerCase()).not.toBe('#3366ff');
  });

  it('honours an explicit triad and computes a readable on-colour', () => {
    const vars = resolveTheme({ colors: { agent: { base: '#f2d02c', deep: '#a08000', tint: '#fff8d0' } } });
    expect(vars['--vzf-agent-deep']).toBe('#a08000');
    expect(vars['--vzf-agent-tint']).toBe('#fff8d0');
    // a light yellow fill gets dark ink, not white
    expect(vars['--vzf-on-agent']).toBe('#1b2430');
  });

  it('emits font, text-scale and radius overrides only when provided', () => {
    const vars = resolveTheme({ textScale: 1.2, fonts: { mono: 'Fira Code' } });
    expect(vars['--vzf-text-scale']).toBe('1.2');
    expect(vars['--vzf-font-mono']).toBe('Fira Code');
    expect(vars['--vzf-font-body']).toBeUndefined();
  });

  it('maps mode to a data-theme attribute, auto → undefined', () => {
    expect(themeAttr({ mode: 'dark' })).toBe('dark');
    expect(themeAttr({ mode: 'light' })).toBe('light');
    expect(themeAttr({ mode: 'auto' })).toBeUndefined();
    expect(themeAttr({})).toBeUndefined();
  });

  it('themeStyle is spreadable and applyTheme writes onto an element', () => {
    const style = themeStyle({ colors: { user: '#0055cc' } });
    expect(style['--vzf-user']).toBe('#0055cc');
    const el = document.createElement('div');
    applyTheme(el, { mode: 'dark', colors: { brand: '#123456' } });
    expect(el.style.getPropertyValue('--vzf-brand')).toBe('#123456');
    expect(el.getAttribute('data-theme')).toBe('dark');
  });
});
