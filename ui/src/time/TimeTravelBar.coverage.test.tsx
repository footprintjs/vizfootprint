// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { TimeTravelBar } from './TimeTravelBar.js';

afterEach(cleanup);

// r → a → b (head); a → c (sibling leaf). 'a' carries an intent so the
// lineage-dot title's truthy arm gets exercised. bookmarks at r ("start")
// and b ("mid").
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'a', parent: 'r', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal', cause: { requestedBy: 'agent', intent: 'pick formal' } },
    { id: 'b', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user' } },
    { id: 'c', parent: 'a', viewId: 'scatter', kind: 'interval', field: 'price', value: [70, 90], cause: { requestedBy: 'agent' } },
  ],
  bookmarks: [
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
      <TimeTravelBar defaultMode="present" commits={S.commits} cursor="b" head="b" bookmarks={S.bookmarks} onModeChange={onModeChange} />,
    );
    expect(container.querySelector('[data-vzf="present"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Explore' }));
    expect(onModeChange).toHaveBeenCalledWith('explore');
    expect(container.querySelector('[data-vzf="timeline"]')).not.toBeNull();
  });

  it('a controlled mode prop ignores the internal toggle — the DOM stays put even after a tab click', () => {
    const onModeChange = vi.fn();
    const { container } = render(
      <TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" bookmarks={S.bookmarks} onModeChange={onModeChange} />,
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

  it('⚑ opens the bookmark modal, and an empty name submits the auto-numbered default', () => {
    const onNameBookmark = vi.fn();
    render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" bookmarks={S.bookmarks} onNameBookmark={onNameBookmark} />);
    fireEvent.click(screen.getByRole('button', { name: /Bookmark/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(onNameBookmark).toHaveBeenCalledWith('bookmark-3'); // bookmarks.length (2) + 1
  });

  it('Enter in the bookmark modal field submits; any other key does nothing', () => {
    const onNameBookmark = vi.fn();
    render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" onNameBookmark={onNameBookmark} />);
    fireEvent.click(screen.getByRole('button', { name: /Bookmark/ }));
    const input = screen.getByLabelText('bookmark name');
    fireEvent.change(input, { target: { value: 'bookmark A' } });
    fireEvent.keyDown(input, { key: 'a' });
    expect(onNameBookmark).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNameBookmark).toHaveBeenCalledWith('bookmark A');
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
    rerender(<TimeTravelBar mode="present" commits={S.commits} cursor="a" head="b" bookmarks={S.bookmarks} viewingPast onReturnToNow={onReturnToNow} />);
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
  it('with no bookmarks it shows the guided-tour placeholder', () => {
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor="b" head="b" bookmarks={[]} />);
    expect(container.querySelector('.vzf-present-empty')?.textContent).toMatch(/No bookmarks on this lineage yet/);
  });

  it('a cursor unreached by any bookmark clamps to bookmark 0 and flags "(nearest to cursor)"', () => {
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor={null} head="b" bookmarks={S.bookmarks} />);
    expect(container.querySelector('.vzf-bookmark-title')?.textContent).toBe('start');
    expect(container.querySelector('.vzf-bookmark-meta')?.textContent).toContain('(nearest to cursor)');
  });

  it('the next button walks forward to the following bookmark', () => {
    const onSeek = vi.fn();
    render(<TimeTravelBar mode="present" commits={S.commits} cursor="r" head="b" bookmarks={S.bookmarks} onSeek={onSeek} />);
    const next = screen.getByRole('button', { name: 'next bookmark' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(onSeek).toHaveBeenCalledWith('b');
  });

  it('a bookmark whose commitId is on no lineage (an empty string) is not a dot at all — bookmarks are ordered by lineage, never by arrival', () => {
    const onSeek = vi.fn();
    const withGhost = [...S.bookmarks, { label: 'ghost', commitId: '', ts: 30 }];
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor="b" head="b" bookmarks={withGhost} onSeek={onSeek} />);
    const dots = container.querySelectorAll('[data-bookmark-dot]');
    expect(dots).toHaveLength(2); // start, mid — the ghost names nothing on this lineage
    fireEvent.click(dots[1]!); // 'mid' → commitId 'b'
    expect(onSeek).toHaveBeenCalledWith('b');
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it('with no head, the presented lineage is the one that ends at the cursor', () => {
    const { container } = render(<TimeTravelBar mode="present" commits={S.commits} cursor="b" head={null} bookmarks={S.bookmarks} />);
    expect(container.querySelectorAll('[data-bookmark-dot]')).toHaveLength(2);
    expect(container.querySelector('.vzf-bookmark-title')?.textContent).toBe('mid');
  });
});
