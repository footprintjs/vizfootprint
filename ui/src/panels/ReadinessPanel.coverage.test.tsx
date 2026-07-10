// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ReadinessPanel } from './ReadinessPanel.js';

afterEach(cleanup);

describe('ReadinessPanel edges', () => {
  it('shows "no analyses declared" when the list is empty', () => {
    const { container } = render(<ReadinessPanel analyses={[]} />);
    expect(container.textContent).toContain('no analyses declared');
  });

  it('a blocked row with neither blockedBy nor missingColumns renders just the "blocked:" prefix', () => {
    const { container } = render(
      <ReadinessPanel analyses={[{ id: 'x', kind: 'test', produces: 'evidence', ready: false }]} />,
    );
    const blocked = container.querySelector('[data-analysis="x"] .vzf-blocked');
    expect(blocked?.textContent).toBe('blocked: ');
  });
});
