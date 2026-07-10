// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VizDashboard } from './VizDashboard.js';

afterEach(cleanup);

describe('VizDashboard — className passthrough', () => {
  it('appends a supplied className alongside the .vzf.vzf-root scoping classes', () => {
    const { container } = render(<VizDashboard className="brand-shell" main={<div>M</div>} />);
    const root = container.querySelector('.vzf-root')!;
    expect(root.classList.contains('brand-shell')).toBe(true);
    expect(root.classList.contains('vzf')).toBe(true);
  });
});
