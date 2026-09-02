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

describe('CommitLog — a match commit (SET-1) reads as its field and list', () => {
  it('"category in {A, B}" for a keep-set, "not in" for an exclude-set, "(cleared)" for a cleared match', () => {
    const base = { parent: null, viewId: 'bar', kind: 'match' as const, field: 'category', actor: 'user' as const, label: 'category', onBranch: true, isCursor: false, isHead: false };
    const { container } = render(
      <CommitLog
        commits={[
          { ...base, id: 'm1', value: { values: ['A', 'B'] } },
          { ...base, id: 'm2', value: { values: ['A'], exclude: true } },
          { ...base, id: 'm3', value: null },
        ]}
      />,
    );
    const bodies = [...container.querySelectorAll('.vzf-chip-body')].map((el) => el.textContent);
    expect(bodies).toEqual(['category in {A, B}', 'category not in {A}', 'category (cleared)']);
  });
});

describe('CommitLog — a link commit reads as its edge', () => {
  it('shows "map point → bar: highlight" without a field prefix', () => {
    const { container } = render(
      <CommitLog
        commits={[{ id: 'l1', parent: null, viewId: 'link:map:point→bar', kind: 'point', field: 'response', value: { source: 'map', kind: 'point', target: 'bar', response: 'highlight' }, actor: 'user', label: 'link', onBranch: true, isCursor: false, isHead: false }]}
      />,
    );
    expect(container.querySelector('.vzf-chip-body')?.textContent).toBe('map point → bar: highlight');
  });
});

describe('a commit true of data that has moved', () => {
  it('shows a "data moved" mark naming the versions it was true of; a current commit shows none', () => {
    const base = { parent: null, viewId: 'bar', kind: 'point' as const, field: 'category', actor: 'user' as const, label: 'category', onBranch: true, isCursor: false, isHead: false };
    const { container } = render(
      <CommitLog
        commits={[
          { ...base, id: 'c1', value: 'Formal', data: { cells: 'mtime:1;size:2' }, dataMoved: true, moved: [{ table: 'cells', from: 'mtime:1;size:2', to: 'mtime:3;size:4' }] },
          { ...base, id: 'c2', value: 'Work', data: { cells: 'mtime:3;size:4' }, dataMoved: false },
        ]}
      />,
    );
    const marks = container.querySelectorAll('.vzf-data-moved');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('data moved');
    expect(marks[0]!.getAttribute('title')).toBe('the data has moved since: cells was mtime:1;size:2, now mtime:3;size:4');
  });
});
