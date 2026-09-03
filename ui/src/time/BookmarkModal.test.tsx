// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { BookmarkModal } from './BookmarkModal.js';
import { TimeTravelBar } from './TimeTravelBar.js';

afterEach(cleanup);

describe('BookmarkModal — the small glass prompt', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<BookmarkModal open={false} commitId="b" onSave={() => {}} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('autofocuses the name field and shows which commit the flag will mark', () => {
    render(<BookmarkModal open commitId="b" commitLabel="price ∈ [40, 60]" onSave={() => {}} onClose={() => {}} />);
    const input = screen.getByLabelText('bookmark name');
    expect(document.activeElement).toBe(input);
    const target = document.querySelector('.vzf-bookmark-target')!;
    expect(target.textContent).toContain('marks commit #b');
    expect(target.textContent).toContain('price ∈ [40, 60]');
  });

  it('omits the commit label when none is known, and falls back to plain wording with no cursor', () => {
    const { rerender } = render(<BookmarkModal open commitId="b" onSave={() => {}} onClose={() => {}} />);
    expect(document.querySelector('.vzf-bookmark-target')?.textContent).toBe('marks commit #b');
    rerender(<BookmarkModal open commitId={null} onSave={() => {}} onClose={() => {}} />);
    expect(document.querySelector('.vzf-bookmark-target')?.textContent).toBe('marks the latest commit');
  });

  it('Enter commits the trimmed name and closes', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<BookmarkModal open commitId="b" onSave={onSave} onClose={onClose} />);
    const input = screen.getByLabelText('bookmark name');
    fireEvent.change(input, { target: { value: '  before cluster  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('before cluster');
    expect(onClose).toHaveBeenCalled();
  });

  it('other keys in the field do nothing; the Save button also commits', () => {
    const onSave = vi.fn();
    render(<BookmarkModal open commitId="b" defaultName="bookmark-3" onSave={onSave} onClose={() => {}} />);
    const input = screen.getByLabelText('bookmark name');
    fireEvent.keyDown(input, { key: 'a' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'my bookmark' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(onSave).toHaveBeenCalledWith('my bookmark');
  });

  it('an empty name falls back to defaultName, and to "bookmark" without one', () => {
    const onSave = vi.fn();
    const { rerender } = render(<BookmarkModal open commitId="b" defaultName="bookmark-3" onSave={onSave} onClose={() => {}} />);
    expect((screen.getByLabelText('bookmark name') as HTMLInputElement).placeholder).toBe('bookmark-3');
    fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(onSave).toHaveBeenLastCalledWith('bookmark-3');
    rerender(<BookmarkModal open commitId="b" onSave={onSave} onClose={() => {}} />);
    expect((screen.getByLabelText('bookmark name') as HTMLInputElement).placeholder).toBe('name this point');
    fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(onSave).toHaveBeenLastCalledWith('bookmark');
  });

  it('Cancel closes without saving', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<BookmarkModal open commitId="b" onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reopening presents a FRESH field (a stale draft never leaks into the next prompt)', () => {
    const { rerender } = render(<BookmarkModal open commitId="b" onSave={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('bookmark name'), { target: { value: 'draft' } });
    rerender(<BookmarkModal open={false} commitId="b" onSave={() => {}} onClose={() => {}} />);
    rerender(<BookmarkModal open commitId="b" onSave={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText('bookmark name') as HTMLInputElement).value).toBe('');
  });
});

// ── the bar-level wiring: ⚑ opens the modal in 'modal' naming mode ────────────
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'b', parent: 'r', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user' } },
  ],
  bookmarks: [{ label: 'start', commitId: 'r', ts: 10 }],
  branches: [{ tip: 'b', length: 2, actor: 'user', active: true }],
  cursor: 'b',
  head: 'b',
};
const S = mapPollState(RAW);

describe('TimeTravelBar — bookmark naming always rides the modal', () => {
  it('there is no inline composer; ⚑ opens the glass prompt showing the cursor commit', () => {
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" bookmarks={S.bookmarks} />);
    expect(container.querySelector('.vzf-bookmark-input')).toBeNull(); // the inline field never existed here
    fireEvent.click(container.querySelector('[data-vzf="bookmark-open"]')!);
    expect(document.querySelector('[data-vzf-modal="bookmark"]')).not.toBeNull();
    expect(document.querySelector('.vzf-bookmark-target')?.textContent).toContain('#b');
  });

  it('naming through the modal fires onNameBookmark and closes; the default name is cp-N', () => {
    const onNameBookmark = vi.fn();
    const { container } = render(
      <TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" bookmarks={S.bookmarks} onNameBookmark={onNameBookmark} />,
    );
    fireEvent.click(container.querySelector('[data-vzf="bookmark-open"]')!);
    const input = screen.getByLabelText('bookmark name');
    expect((input as HTMLInputElement).placeholder).toBe('bookmark-2'); // 1 bookmark exists
    fireEvent.change(input, { target: { value: 'zoomed in' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNameBookmark).toHaveBeenCalledWith('zoomed in');
    expect(document.querySelector('[data-vzf-modal="bookmark"]')).toBeNull();
  });

  it('saving without an onNameBookmark handler is a safe no-op (still closes)', () => {
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" bookmarks={S.bookmarks} />);
    fireEvent.click(container.querySelector('[data-vzf="bookmark-open"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(document.querySelector('[data-vzf-modal="bookmark"]')).toBeNull();
  });

  it('compact folds the bar into the slim cockpit strip (class only — same controls)', () => {
    const { container } = render(<TimeTravelBar compact mode="explore" commits={S.commits} cursor="b" head="b" bookmarks={S.bookmarks} />);
    expect(container.querySelector('.vzf-timebar')?.classList.contains('vzf-compact')).toBe(true);
    expect(container.querySelector('[data-vzf="bookmark-open"]')).not.toBeNull();
  });
});
