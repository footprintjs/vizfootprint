// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { mapPollState, type RawPollState } from '../adapter/sessionView.js';
import { CheckpointModal } from './CheckpointModal.js';
import { TimeTravelBar } from './TimeTravelBar.js';

afterEach(cleanup);

describe('CheckpointModal — the small glass prompt', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<CheckpointModal open={false} commitId="b" onSave={() => {}} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('autofocuses the name field and shows which commit the flag will mark', () => {
    render(<CheckpointModal open commitId="b" commitLabel="price ∈ [40, 60]" onSave={() => {}} onClose={() => {}} />);
    const input = screen.getByLabelText('checkpoint name');
    expect(document.activeElement).toBe(input);
    const target = document.querySelector('.vzf-ckpt-target')!;
    expect(target.textContent).toContain('marks commit #b');
    expect(target.textContent).toContain('price ∈ [40, 60]');
  });

  it('omits the commit label when none is known, and falls back to plain wording with no cursor', () => {
    const { rerender } = render(<CheckpointModal open commitId="b" onSave={() => {}} onClose={() => {}} />);
    expect(document.querySelector('.vzf-ckpt-target')?.textContent).toBe('marks commit #b');
    rerender(<CheckpointModal open commitId={null} onSave={() => {}} onClose={() => {}} />);
    expect(document.querySelector('.vzf-ckpt-target')?.textContent).toBe('marks the latest commit');
  });

  it('Enter commits the trimmed name and closes', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<CheckpointModal open commitId="b" onSave={onSave} onClose={onClose} />);
    const input = screen.getByLabelText('checkpoint name');
    fireEvent.change(input, { target: { value: '  before cluster  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('before cluster');
    expect(onClose).toHaveBeenCalled();
  });

  it('other keys in the field do nothing; the Save button also commits', () => {
    const onSave = vi.fn();
    render(<CheckpointModal open commitId="b" defaultName="cp-3" onSave={onSave} onClose={() => {}} />);
    const input = screen.getByLabelText('checkpoint name');
    fireEvent.keyDown(input, { key: 'a' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'my beat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect(onSave).toHaveBeenCalledWith('my beat');
  });

  it('an empty name falls back to defaultName, and to "checkpoint" without one', () => {
    const onSave = vi.fn();
    const { rerender } = render(<CheckpointModal open commitId="b" defaultName="cp-3" onSave={onSave} onClose={() => {}} />);
    expect((screen.getByLabelText('checkpoint name') as HTMLInputElement).placeholder).toBe('cp-3');
    fireEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect(onSave).toHaveBeenLastCalledWith('cp-3');
    rerender(<CheckpointModal open commitId="b" onSave={onSave} onClose={() => {}} />);
    expect((screen.getByLabelText('checkpoint name') as HTMLInputElement).placeholder).toBe('name this point');
    fireEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect(onSave).toHaveBeenLastCalledWith('checkpoint');
  });

  it('Cancel closes without saving', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<CheckpointModal open commitId="b" onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reopening presents a FRESH field (a stale draft never leaks into the next prompt)', () => {
    const { rerender } = render(<CheckpointModal open commitId="b" onSave={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('checkpoint name'), { target: { value: 'draft' } });
    rerender(<CheckpointModal open={false} commitId="b" onSave={() => {}} onClose={() => {}} />);
    rerender(<CheckpointModal open commitId="b" onSave={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText('checkpoint name') as HTMLInputElement).value).toBe('');
  });
});

// ── the bar-level wiring: ⚑ opens the modal in 'modal' naming mode ────────────
const RAW: RawPollState = {
  records: [
    { id: 'r', parent: null, viewId: 'scatter', kind: 'interval', field: 'price', value: [0, 100], cause: { requestedBy: 'user' } },
    { id: 'b', parent: 'r', viewId: 'scatter', kind: 'interval', field: 'price', value: [40, 60], cause: { requestedBy: 'user' } },
  ],
  checkpoints: [{ label: 'start', commitId: 'r', ts: 10 }],
  branches: [{ tip: 'b', length: 2, actor: 'user', active: true }],
  cursor: 'b',
  head: 'b',
};
const S = mapPollState(RAW);

describe('TimeTravelBar — checkpoint naming always rides the modal', () => {
  it('there is no inline composer; ⚑ opens the glass prompt showing the cursor commit', () => {
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} />);
    expect(container.querySelector('.vzf-ckpt-input')).toBeNull(); // the inline field never existed here
    fireEvent.click(container.querySelector('[data-vzf="checkpoint-open"]')!);
    expect(document.querySelector('[data-vzf-modal="checkpoint"]')).not.toBeNull();
    expect(document.querySelector('.vzf-ckpt-target')?.textContent).toContain('#b');
  });

  it('naming through the modal fires onCheckpoint and closes; the default name is cp-N', () => {
    const onCheckpoint = vi.fn();
    const { container } = render(
      <TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} onCheckpoint={onCheckpoint} />,
    );
    fireEvent.click(container.querySelector('[data-vzf="checkpoint-open"]')!);
    const input = screen.getByLabelText('checkpoint name');
    expect((input as HTMLInputElement).placeholder).toBe('cp-2'); // 1 checkpoint exists
    fireEvent.change(input, { target: { value: 'zoomed in' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCheckpoint).toHaveBeenCalledWith('zoomed in');
    expect(document.querySelector('[data-vzf-modal="checkpoint"]')).toBeNull();
  });

  it('saving without an onCheckpoint handler is a safe no-op (still closes)', () => {
    const { container } = render(<TimeTravelBar mode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} />);
    fireEvent.click(container.querySelector('[data-vzf="checkpoint-open"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect(document.querySelector('[data-vzf-modal="checkpoint"]')).toBeNull();
  });

  it('compact folds the bar into the slim cockpit strip (class only — same controls)', () => {
    const { container } = render(<TimeTravelBar compact mode="explore" commits={S.commits} cursor="b" head="b" checkpoints={S.checkpoints} />);
    expect(container.querySelector('.vzf-timebar')?.classList.contains('vzf-compact')).toBe(true);
    expect(container.querySelector('[data-vzf="checkpoint-open"]')).not.toBeNull();
  });
});
