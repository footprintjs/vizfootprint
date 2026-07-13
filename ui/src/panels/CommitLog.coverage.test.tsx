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

describe('CommitLog — BR-1 provenance tags (bring-over / undo / conflicts)', () => {
  const base = {
    parent: null,
    viewId: 'scatter',
    kind: 'interval' as const,
    field: 'price',
    value: [1, 2],
    actor: 'user' as const,
    label: 'price',
    onBranch: true,
    isCursor: false,
    isHead: false,
  };

  it('a replayedFrom commit wears the ↷ tag; revertOf wears ⎌; conflicts wear ⚠ with the ids in the title', () => {
    const { container } = render(
      <CommitLog
        commits={[
          { ...base, id: 'p1' }, // plain — no tags at all
          { ...base, id: 'p2', replayedFrom: '5', conflicts: ['3', '4'] },
          { ...base, id: 'p3', revertOf: 'p2' },
          { ...base, id: 'p4', conflicts: [] }, // an empty conflicts list is honestly silent
        ]}
      />,
    );
    expect(container.querySelector('[data-commit="p1"] .vzf-replay')).toBeNull();
    const replay = container.querySelector('[data-commit="p2"] .vzf-replay')!;
    expect(replay.textContent).toContain('brought over from #5');
    expect(replay.getAttribute('data-replayed-from')).toBe('5');
    const conflict = container.querySelector('[data-commit="p2"] .vzf-conflict')!;
    expect(conflict.textContent).toContain('2 overridden');
    expect(conflict.getAttribute('title')).toBe('overrode: #3, #4');
    const revert = container.querySelector('[data-commit="p3"] .vzf-revert')!;
    expect(revert.textContent).toContain('undoes #p2');
    expect(revert.getAttribute('data-revert-of')).toBe('p2');
    expect(container.querySelector('[data-commit="p4"] .vzf-conflict')).toBeNull();
  });
});
