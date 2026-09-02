// @vitest-environment jsdom
/** Commit families in the log: chips per family present, a chip hides its family, the badge names each commit's family. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommitLog } from './CommitLog.js';
import type { CommitView } from '../adapter/types.js';

afterEach(cleanup);
const c = (id: string, viewId: string, family: CommitView['family']): CommitView => ({ id, parent: null, viewId, kind: 'point', field: 'f', value: 'v', actor: 'user', label: 'l', onBranch: true, isCursor: false, isHead: false, family });

describe('commit families', () => {
  it('shows a chip per family present with its count; toggling hides that family; an empty result says so', () => {
    const onSeek = vi.fn();
    render(<CommitLog commits={[c('1', 'bar', 'interaction'), c('2', 'prose:map', 'design'), c('3', 'encoding:bar', 'design')]} onSeek={onSeek} />);
    const group = screen.getByRole('group', { name: 'commit families' });
    expect(group.textContent).toContain('interaction 1');
    expect(group.textContent).toContain('design 2');
    expect(screen.getAllByText('design', { selector: '.vzf-family' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^design/ }));
    expect(document.querySelectorAll('[data-commit]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^interaction/ }));
    expect(screen.getByText('every commit here is hidden by the family chips')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^design/ }));
    expect(document.querySelectorAll('[data-commit]')).toHaveLength(2);
  });
  it('no chips for a single family, an absent family reads as interaction, and families={false} hides the chips', () => {
    render(<CommitLog commits={[c('1', 'bar', undefined), c('2', 'bar', 'interaction')]} />);
    expect(screen.queryByRole('group', { name: 'commit families' })).toBeNull();
    expect(screen.getAllByText('interaction', { selector: '.vzf-family' })).toHaveLength(2);
    cleanup();
    render(<CommitLog commits={[c('1', 'bar', 'interaction'), c('2', 'prose:map', 'design')]} families={false} />);
    expect(screen.queryByRole('group', { name: 'commit families' })).toBeNull();
  });
});
