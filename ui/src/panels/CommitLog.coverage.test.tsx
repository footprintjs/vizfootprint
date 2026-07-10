// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CommitLog } from './CommitLog.js';

afterEach(cleanup);

describe('CommitLog edges', () => {
  it('appends a supplied className', () => {
    const { container } = render(<CommitLog commits={[]} className="extra" />);
    expect(container.querySelector('.vzf-commitlog.extra')).not.toBeNull();
  });

  it('shows the built-in empty text when no emptyText prop is given', () => {
    const { container } = render(<CommitLog commits={[]} />);
    expect(container.querySelector('.vzf-empty')?.textContent).toMatch(/no commits yet/);
  });

  it('shows a caller-supplied emptyText instead of the default', () => {
    const { container } = render(<CommitLog commits={[]} emptyText="nothing recorded yet" />);
    expect(container.querySelector('.vzf-empty')?.textContent).toBe('nothing recorded yet');
  });
});
