// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { orderedCheckpoints, currentBeatIndex } from './presentBeat.js';
import { TimeTravelBar } from './TimeTravelBar.js';
import { BranchMap } from './BranchMap.js';

afterEach(cleanup);

// r → a → b (head); a → c (sibling leaf).  checkpoints at r ("start") and b ("mid").
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent' } },
    { id: 'b', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user' } },
    { id: 'c', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [70, 90], cause: { requestedBy: 'agent' } },
  ],
  checkpoints: [
    { label: 'start', commitId: 'r', ts: 10 },
    { label: 'mid', commitId: 'b', ts: 20 },
  ],
  branches: [{ tip: 'b', length: 3, actor: 'user', active: true }, { tip: 'c', length: 3, actor: 'agent', active: false }],
  cursor: 'b',
  head: 'b',
};
const S = mapPollState(RAW);

describe('presentBeat pure logic', () => {
  it('orders checkpoints by ts and drops null commitIds', () => {
    const ck = orderedCheckpoints([...S.checkpoints, { label: 'floating', commitId: null, ts: 5 }]);
    expect(ck.map((c) => c.label)).toEqual(['start', 'mid']);
  });
  it('finds the exact beat, else the nearest ancestor beat, else -1', () => {
    expect(currentBeatIndex(S.checkpoints, S.commits, 'b')).toBe(1); // exact = mid
    expect(currentBeatIndex(S.checkpoints, S.commits, 'r')).toBe(0); // exact = start
    expect(currentBeatIndex(S.checkpoints, S.commits, 'a')).toBe(0); // a's nearest ancestor beat = start(r)
    expect(currentBeatIndex([], S.commits, 'b')).toBe(-1);
  });
});

describe('TimeTravelBar — explore mode', () => {
  it('renders the active lineage as commit dots with the cursor marked', () => {
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} branches={S.branches} />);
    const dots = container.querySelectorAll('[data-vzf="timeline"] [data-commit]');
    expect(dots).toHaveLength(3); // r, a, b (NOT the off-branch c)
    expect(container.querySelector('.vzf-tl-dot.vzf-cursor')?.getAttribute('data-commit')).toBe('b');
  });

  // defect 4: seeking onto ANOTHER lane left the rail with no cursor mark at
  // all — `.vzf-tl-dot.vzf-cursor` matched nothing, so "where am I standing?"
  // had no answer on screen.
  it('when the cursor sits on another lane the rail follows it, and the mark is always drawn', () => {
    // head is 'b'; 'c' is the other child of 'a' — off the head's lineage
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="c" head="b" branches={S.branches} />);
    const dots = [...container.querySelectorAll('[data-vzf="timeline"] [data-commit]')].map((d) => d.getAttribute('data-commit'));
    expect(dots).toEqual(['r', 'a', 'c']); // the cursor's own lineage
    expect(container.querySelector('.vzf-tl-dot.vzf-cursor')?.getAttribute('data-commit')).toBe('c');
    // and the rail says which path it is drawing, how much of the story it is,
    // and where "now" went — no bar on this lane can carry the head mark
    expect(container.querySelector('[data-vzf="rail-scope"]')?.textContent).toBe('3 of 4 steps · this path of 2 · now is on another path');
    expect(container.querySelector('.vzf-tl-dot.vzf-head'), 'the head is not on these bars, and the sentence says so').toBeNull();
  });

  it('never prints the head path\'s NAME over another lane\'s bars', () => {
    // `pathName` names the path the HEAD is on; on another lane it would be a lie
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="c" head="b" branches={S.branches} pathName="main" />);
    const scope = container.querySelector('[data-vzf="rail-scope"]')?.textContent ?? '';
    expect(scope).not.toContain('main');
    expect(scope).toContain('this path');
  });

  it('names the path when the host knows it, and says nothing when the rail holds the whole story', () => {
    const { container, rerender } = render(
      <TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" branches={S.branches} pathName="work-2" />,
    );
    expect(container.querySelector('[data-vzf="rail-scope"]')?.textContent).toBe('3 of 4 steps · path “work-2” of 2');
    expect(container.querySelector('.vzf-tl-dot.vzf-head'), 'on the head\'s own lane, "now" is a mark on the rail').not.toBeNull();
    // one path, every step on the rail — no note
    rerender(<TimeTravelBar mode="explore" commits={S.commits.slice(0, 2)} cursor="a" head="a" branches={[{ tip: 'a', length: 2, actor: 'user', active: true }]} />);
    expect(container.querySelector('[data-vzf="rail-scope"]')).toBeNull();
  });

  it('step buttons: forward disabled at the leaf head, back enabled; both fire callbacks', () => {
    const onStepBack = vi.fn();
    const onStepForward = vi.fn();
    render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" onStepBack={onStepBack} onStepForward={onStepForward} />);
    const back = screen.getByRole('button', { name: '⟵' }) as HTMLButtonElement;
    const fwd = screen.getByRole('button', { name: '⟶' }) as HTMLButtonElement;
    expect(fwd.disabled).toBe(true); // b is a leaf
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(onStepBack).toHaveBeenCalled();
  });

  it('⚑ opens the checkpoint modal; naming there fires onCheckpoint with the typed label', () => {
    const onCheckpoint = vi.fn();
    render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" onCheckpoint={onCheckpoint} />);
    fireEvent.click(screen.getByRole('button', { name: /Checkpoint/ }));
    const input = screen.getByLabelText('checkpoint name');
    fireEvent.change(input, { target: { value: 'before cluster' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCheckpoint).toHaveBeenCalledWith('before cluster');
  });
});

describe('TimeTravelBar — present mode', () => {
  it('hides ordinary commits, shows ONLY checkpoint beats with the current title large', () => {
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} />);
    // the explore timeline is gone; the present beat surface is shown
    expect(container.querySelector('[data-vzf="timeline"]')).toBeNull();
    expect(container.querySelector('[data-vzf="present"]')).not.toBeNull();
    // exactly one beat dot per checkpoint (2), NOT one per commit (4)
    expect(container.querySelectorAll('[data-beat-dot]')).toHaveLength(2);
    // current beat title is the cursor's checkpoint (mid)
    expect(container.querySelector('.vzf-beat-title')?.textContent).toBe('mid');
    // no checkpoint composer in read-only present mode
    expect(container.querySelector('.vzf-ckpt-input')).toBeNull();
  });

  it('prev/next walk the beats and seek to their commit ids; reports readOnly up', () => {
    const onSeek = vi.fn();
    const onReadOnlyChange = vi.fn();
    render(<TimeTravelBar mode="present" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} onSeek={onSeek} onReadOnlyChange={onReadOnlyChange} />);
    expect(onReadOnlyChange).toHaveBeenCalledWith(true);
    // at 'mid' (index 1); prev → seek to 'start' (commit r)
    fireEvent.click(screen.getByRole('button', { name: 'previous beat' }));
    expect(onSeek).toHaveBeenCalledWith('r');
  });

  it('the mode toggle switches modes (uncontrolled) and fires onModeChange', () => {
    const onModeChange = vi.fn();
    const { container } = render(<TimeTravelBar defaultMode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} onModeChange={onModeChange} />);
    expect(container.querySelector('[data-vzf="timeline"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Present' }));
    expect(onModeChange).toHaveBeenCalledWith('present');
    expect(container.querySelector('[data-vzf="present"]')).not.toBeNull();
  });
});

describe('BranchMap', () => {
  it('renders a node per commit, rings the cursor + head, and seeks on click', () => {
    const onSeek = vi.fn();
    const { container } = render(<BranchMap commits={S.commits} cursor="a" head="b" checkpoints={S.checkpoints} onSeek={onSeek} />);
    expect(container.querySelectorAll('.vzf-bm-node')).toHaveLength(4);
    expect(container.querySelector('.vzf-bm-dot.vzf-cursor')).not.toBeNull();
    expect(container.querySelector('.vzf-bm-dot.vzf-head')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-commit="c"]')!);
    expect(onSeek).toHaveBeenCalledWith('c');
  });

  it('shows an empty note when there are no commits', () => {
    const { container } = render(<BranchMap commits={[]} cursor={null} head={null} />);
    expect(container.querySelector('.vzf-bm-empty')).not.toBeNull();
  });
});
