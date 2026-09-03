// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { BranchMap } from './BranchMap.js';

afterEach(cleanup);

// r → a → b (head); a → c (sibling leaf). 'a' carries an intent so the
// per-node <title> truthy arm gets exercised.
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent', intent: 'pick formal' } },
    { id: 'b', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user' } },
    { id: 'c', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [70, 90], cause: { requestedBy: 'agent' } },
  ],
  bookmarks: [{ label: 'start', commitId: 'r', ts: 10 }],
  cursor: 'b',
  head: 'b',
};
const S = mapPollState(RAW);

describe('BranchMap — className + intent title', () => {
  it('appends a supplied className onto the wrapper', () => {
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" className="custom-wrap" />);
    expect(container.querySelector('.vzf-branchmap-wrap.custom-wrap')).not.toBeNull();
  });

  it('the intent-carrying commit gets the ": <intent>" title suffix; others do not', () => {
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" />);
    const aTitle = container.querySelector('[data-commit="a"] title');
    expect(aTitle?.textContent).toBe('#a category (agent): pick formal');
    const rTitle = container.querySelector('[data-commit="r"] title');
    expect(rTitle?.textContent).toBe('#r price (user)');
  });
});

describe('BranchMap — keyboard activation', () => {
  it('Enter and Space seek; any other key is a no-op', () => {
    const onSeek = vi.fn();
    const { container } = render(<BranchMap commits={S.commits} cursor="b" head="b" onSeek={onSeek} />);
    const node = container.querySelector('[data-commit="c"]')!;

    fireEvent.keyDown(node, { key: 'x' });
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.keyDown(node, { key: 'Enter' });
    expect(onSeek).toHaveBeenCalledWith('c');

    fireEvent.keyDown(node, { key: ' ' });
    expect(onSeek).toHaveBeenCalledTimes(2);
    expect(onSeek).toHaveBeenLastCalledWith('c');
  });
});
