// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { resolveTheme, applyTheme } from './theme.js';

describe('theme engine edges', () => {
  it('expands a 3-char shorthand hex before deriving -deep/-tint', () => {
    const vars = resolveTheme({ colors: { brand: '#0f0' } });
    expect(vars['--vzf-brand']).toBe('#0f0'); // the raw override rides through unexpanded
    expect(vars['--vzf-brand-deep']).toBe('#00bd00'); // darken(#00ff00, 0.26)
    expect(vars['--vzf-brand-tint']).toBe('#d6ffd6'); // mix(#00ff00 → white, 0.84)
  });

  it('emits font.display and font.body independently of font.mono', () => {
    const vars = resolveTheme({ fonts: { display: 'Inter', body: 'Georgia' } });
    expect(vars['--vzf-font-display']).toBe('Inter');
    expect(vars['--vzf-font-body']).toBe('Georgia');
    expect(vars['--vzf-font-mono']).toBeUndefined();
  });

  it('emits sm/md/lg radius overrides', () => {
    const vars = resolveTheme({ radii: { sm: '2px', md: '4px', lg: '8px' } });
    expect(vars['--vzf-r-sm']).toBe('2px');
    expect(vars['--vzf-r-md']).toBe('4px');
    expect(vars['--vzf-r-lg']).toBe('8px');
  });

  it('applyTheme leaves data-theme unset for mode "auto" while still writing CSS vars', () => {
    const el = document.createElement('div');
    applyTheme(el, { mode: 'auto', colors: { brand: '#123456' } });
    expect(el.hasAttribute('data-theme')).toBe(false);
    expect(el.style.getPropertyValue('--vzf-brand')).toBe('#123456');
  });
});
