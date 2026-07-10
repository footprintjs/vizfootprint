// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { TimeTravelBar } from './TimeTravelBar.js';

afterEach(cleanup);

// r → a → b (head); a → c (sibling leaf). 'a' carries an intent so the
// lineage-dot title's truthy arm gets exercised. checkpoints at r ("start")
// and b ("mid").
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent', intent: 'pick formal' } },
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

describe('TimeTravelBar — mode toggle', () => {
  it('clicking the Explore tab switches back (uncontrolled) and fires onModeChange', () => {
    const onModeChange = vi.fn();
    const { container } = render(
      <TimeTravelBar defaultMode="present" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} onModeChange={onModeChange} />,
    );
    expect(container.querySelector('[data-vzf="present"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Explore' }));
    expect(onModeChange).toHaveBeenCalledWith('explore');
    expect(container.querySelector('[data-vzf="timeline"]')).not.toBeNull();
  });

  it('a controlled mode prop ignores the internal toggle — the DOM stays put even after a tab click', () => {
    const onModeChange = vi.fn();
    const { container } = render(
      <TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} onModeChange={onModeChange} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Present' }));
    expect(onModeChange).toHaveBeenCalledWith('present');
    // parent never fed the new mode back in — still explore because internal state was never touched
    expect(container.querySelector('[data-vzf="timeline"]')).not.toBeNull();
    expect(container.querySelector('[data-vzf="present"]')).toBeNull();
  });
});

describe('TimeTravelBar — explore mode edges', () => {
  it('clicking a lineage dot seeks, and an intent-carrying commit gets the ": <intent>" title suffix', () => {
    const onSeek = vi.fn();
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" onSeek={onSeek} />);
    fireEvent.click(container.querySelector('[data-commit="a"]')!);
    expect(onSeek).toHaveBeenCalledWith('a');
    expect(container.querySelector('[data-commit="a"]')?.getAttribute('title')).toBe('#a category (agent): pick formal');
    // 'r' carries no intent — the title has no ": <intent>" suffix
    expect(container.querySelector('[data-commit="r"]')?.getAttribute('title')).toBe('#r price (user)');
  });

  it('the forward step fires onStepForward when the cursor sits behind the head', () => {
    const onStepForward = vi.fn();
    render(<TimeTravelBar mode="explore" commits={S.commits} cursor="a" head="b" onStepForward={onStepForward} />);
    const fwd = screen.getByRole('button', { name: '⟶' }) as HTMLButtonElement;
    expect(fwd.disabled).toBe(false);
    fireEvent.click(fwd);
    expect(onStepForward).toHaveBeenCalled();
  });

  it('an empty ckptLabel submits the auto-numbered default name', () => {
    const onCheckpoint = vi.fn();
    render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} onCheckpoint={onCheckpoint} />);
    fireEvent.click(screen.getByRole('button', { name: /Checkpoint/ }));
    expect(onCheckpoint).toHaveBeenCalledWith('cp-3'); // checkpoints.length (2) + 1
  });

  it('Enter in the checkpoint input submits; any other key does nothing', () => {
    const onCheckpoint = vi.fn();
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" onCheckpoint={onCheckpoint} />);
    const input = container.querySelector('.vzf-ckpt-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'checkpoint A' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCheckpoint).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCheckpoint).toHaveBeenCalledWith('checkpoint A');
  });

  it('the past banner shows only outside read-only, and "Return to now" fires onReturnToNow', () => {
    const onReturnToNow = vi.fn();
    const { container, rerender } = render(
      <TimeTravelBar mode="explore" commits={S.commits} cursor="a" head="b" viewingPast onReturnToNow={onReturnToNow} />,
    );
    expect(container.querySelector('.vzf-past-banner')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-vzf="return-now"]')!);
    expect(onReturnToNow).toHaveBeenCalled();

    // present mode is read-only — the banner is suppressed even though viewingPast is still true
    rerender(<TimeTravelBar mode="present" commits={S.commits} cursor="a" head="b" checkpoints={S.checkpoints} viewingPast onReturnToNow={onReturnToNow} />);
    expect(container.querySelector('.vzf-past-banner')).toBeNull();
  });

  it('an empty tree shows the "no commits yet" guidance, a lone branch reads singular, and a null cursor shows a dash', () => {
    const { container } = render(
      <TimeTravelBar mode="explore" commits={[]} cursor={null} head={null} branches={[{ tip: 'x', length: 1, actor: 'user', active: true }]} />,
    );
    expect(container.querySelector('.vzf-tl-empty')?.textContent).toMatch(/no commits yet/);
    const muted = container.querySelector('.vzf-time-controls .vzf-muted');
    expect(muted?.textContent).toBe('1 branch · cursor —');
  });
});

describe('TimeTravelBar — present mode edges', () => {
  it('with no checkpoints it shows the guided-tour placeholder', () => {
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor="b" head="b" checkpoints={[]} />);
    expect(container.querySelector('.vzf-present-empty')?.textContent).toMatch(/No story beats yet/);
  });

  it('a cursor unreached by any checkpoint clamps to beat 0 and flags "(nearest to cursor)"', () => {
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor={null} head="b" checkpoints={S.checkpoints} />);
    expect(container.querySelector('.vzf-beat-title')?.textContent).toBe('start');
    expect(container.querySelector('.vzf-beat-meta')?.textContent).toContain('(nearest to cursor)');
  });

  it('the next button walks forward to the following beat', () => {
    const onSeek = vi.fn();
    render(<TimeTravelBar mode="present" commits={S.commits} cursor="r" head="b" checkpoints={S.checkpoints} onSeek={onSeek} />);
    const next = screen.getByRole('button', { name: 'next beat' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(onSeek).toHaveBeenCalledWith('b');
  });

  it('a beat dot whose checkpoint carries an empty-string commitId is skipped silently (falsy, not null)', () => {
    const onSeek = vi.fn();
    const withGhost = [...S.checkpoints, { label: 'ghost', commitId: '', ts: 30 }];
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor="b" head="b" checkpoints={withGhost} onSeek={onSeek} />);
    const dots = container.querySelectorAll('[data-beat-dot]');
    expect(dots).toHaveLength(3);
    fireEvent.click(dots[1]!); // 'mid' → commitId 'b'
    expect(onSeek).toHaveBeenCalledWith('b');
    fireEvent.click(dots[2]!); // 'ghost' → commitId '' (falsy) → no-op
    expect(onSeek).toHaveBeenCalledTimes(1);
  });
});
