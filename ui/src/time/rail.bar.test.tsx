// @vitest-environment jsdom
/**
 * The timeline bar carries the rail law: step buttons side by side, ticks
 * sized by a CSS variable the rail sets from its own width, ids hidden when
 * dense, and a Play door in Present mode when the host brought one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { TimeTravelBar } from './TimeTravelBar.js';
import type { CommitView, CheckpointView } from '../adapter/types.js';

afterEach(cleanup);

const commit = (id: string, parent: string | null): CommitView => ({ id, parent, viewId: 'bar', kind: 'point', field: 'category', value: id, actor: 'user', label: `select ${id}`, onBranch: true, isCursor: false, isHead: false });
const MANY: CommitView[] = Array.from({ length: 40 }, (_, i) => commit(`c${i}`, i === 0 ? null : `c${i - 1}`));
const BEATS: CheckpointView[] = [
  { label: 'Start', commitId: 'c5', at: 'c4', ts: 5 },
  { label: 'Middle', commitId: 'c20', at: 'c19', ts: 20 },
];

describe('the rail in the bar', () => {
  it('explore: the two step buttons sit in one group before the rail; the rail carries the tick variable and every commit as a dot', () => {
    const { container } = render(<TimeTravelBar compact commits={MANY} cursor="c39" head="c39" checkpoints={BEATS} />);
    const row = container.querySelector('.vzf-timeline-row')!;
    const group = row.firstElementChild!;
    expect(group.classList.contains('vzf-step-group')).toBe(true);
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(group.querySelector('[data-step="back"]')).not.toBeNull();
    expect(group.querySelector('[data-step="forward"]')).not.toBeNull();
    const rail = row.querySelector('.vzf-timeline') as HTMLElement;
    expect(rail.style.getPropertyValue('--vzf-tick')).toMatch(/^\d+px$/);
    expect(rail.querySelectorAll('.vzf-tl-dot')).toHaveLength(40); // never a tick dropped
    // jsdom lays nothing out (width 0) ⇒ comfortable ticks with ids, not dense
    expect(rail.getAttribute('data-dense')).toBeNull();
    expect(rail.querySelectorAll('.vzf-tl-cid')).toHaveLength(40);
    expect(rail.querySelector('[data-commit="c4"]')!.getAttribute('aria-label')).toBe('#c4 select c4');
  });

  it('each bar says where it stands: the cursor, the head, and everything AHEAD of the cursor — and only a beat carries a flag', () => {
    const { container } = render(<TimeTravelBar compact commits={MANY} cursor="c10" head="c39" checkpoints={BEATS} viewingPast />);
    const rail = container.querySelector('[data-vzf="timeline"]')!;
    expect(rail.querySelector('.vzf-tl-dot.vzf-cursor')!.getAttribute('data-commit')).toBe('c10'); // where one stands
    expect(rail.querySelectorAll('.vzf-tl-dot.vzf-head')).toHaveLength(1);
    expect(rail.querySelector('.vzf-tl-dot.vzf-head')!.getAttribute('data-commit')).toBe('c39'); // now, the tip of this lineage
    expect(rail.querySelector('[data-commit="c11"]')!.classList.contains('vzf-ahead')).toBe(true); // the future one is looking back from
    expect(rail.querySelector('[data-commit="c9"]')!.classList.contains('vzf-ahead')).toBe(false); // already lived through
    expect(rail.querySelector('[data-commit="c10"]')!.classList.contains('vzf-ahead')).toBe(false); // the cursor is not ahead of itself
    expect(rail.querySelectorAll('.vzf-tl-dot.vzf-ahead')).toHaveLength(29); // c11 … c39
    // the flag slot: a beat shows ⚑, every other bar keeps the same empty box, so no bar sits lower than its neighbour
    expect(rail.querySelectorAll('.vzf-tl-flag')).toHaveLength(2);
    expect(rail.querySelectorAll('.vzf-tl-flagslot')).toHaveLength(38);
  });

  it('a cursor that is on no bar of this lineage leaves nothing "ahead" — and the head is still marked', () => {
    const { container } = render(<TimeTravelBar compact commits={MANY} cursor={null} head="c39" checkpoints={BEATS} />);
    const rail = container.querySelector('[data-vzf="timeline"]')!;
    expect(rail.querySelectorAll('.vzf-tl-dot.vzf-cursor')).toHaveLength(0);
    expect(rail.querySelectorAll('.vzf-tl-dot.vzf-ahead')).toHaveLength(0);
    expect(rail.querySelector('.vzf-tl-dot.vzf-head')!.getAttribute('data-commit')).toBe('c39');
  });

  it('present: beats on a rail of their own, the step group first, and Play only when the host brought it', () => {
    const onPlay = vi.fn();
    const { container, rerender } = render(<TimeTravelBar compact mode="present" commits={MANY} cursor="c39" head="c39" checkpoints={BEATS} onPlay={onPlay} />);
    const row = container.querySelector('[data-vzf="present"] .vzf-timeline-row')!;
    expect(row.firstElementChild!.classList.contains('vzf-step-group')).toBe(true);
    const rail = row.querySelector('[data-vzf="beat-rail"]') as HTMLElement;
    expect(rail.querySelectorAll('.vzf-tl-dot')).toHaveLength(2);
    expect(rail.style.getPropertyValue('--vzf-tick')).toMatch(/^\d+px$/);
    fireEvent.click(row.querySelector('[data-vzf="play"]')!);
    expect(onPlay).toHaveBeenCalledTimes(1);
    rerender(<TimeTravelBar compact mode="present" commits={MANY} cursor="c39" head="c39" checkpoints={BEATS} />);
    expect(container.querySelector('[data-vzf="play"]')).toBeNull();
  });
});

describe('the rail under pressure', () => {
  it('a narrow rail turns dense: ids hide, flags and dots stay; a resize observer re-measures; the past is a mark in the compact strip and a banner in the full one', () => {
    // jsdom lays nothing out, so give every element a narrow width and a resize observer that fires on observe
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 });
    let fired = 0;
    class FakeResizeObserver {
      private readonly cb: (entries: { contentRect: { width: number } }[]) => void;
      constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
        this.cb = cb;
      }
      observe(): void {
        fired++;
        this.cb([{ contentRect: { width: 100 } }]); // the CONTENT box, as a real observer reports it
      }
      disconnect(): void {
        fired += 100;
      }
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    try {
      const { container, unmount } = render(<TimeTravelBar compact commits={MANY} cursor="c39" head="c39" checkpoints={BEATS} viewingPast />);
      const rail = container.querySelector('[data-vzf="timeline"]') as HTMLElement;
      expect(rail.getAttribute('data-dense')).toBe('true');
      expect(rail.style.getPropertyValue('--vzf-tick')).toBe('6px'); // (100 - 39*4) / 40 < the minimum ⇒ the minimum, the rail scrolls
      expect(rail.querySelectorAll('.vzf-tl-cid')).toHaveLength(0); // ids hide first
      expect(rail.querySelectorAll('.vzf-tl-dot')).toHaveLength(40); // never a tick dropped
      expect(rail.querySelectorAll('.vzf-tl-flag')).toHaveLength(2); // the beats keep their flags
      expect(container.querySelector('[data-vzf="past-mark"]')).not.toBeNull(); // compact: a mark with the sentence, never a banner
      expect(container.querySelector('.vzf-past-banner')).toBeNull();
      expect(fired).toBe(1);
      unmount();
      expect(fired).toBe(101); // disconnected on unmount
      const full = render(<TimeTravelBar commits={MANY} cursor="c39" head="c39" checkpoints={BEATS} viewingPast />).container;
      expect(full.querySelector('.vzf-past-banner')).not.toBeNull();
      expect(full.querySelector('[data-vzf="past-mark"]')).toBeNull();
      const present = render(<TimeTravelBar compact mode="present" commits={MANY} cursor="c39" head="c39" checkpoints={BEATS} />).container;
      expect(present.querySelector('[data-vzf="beat-rail"]')!.getAttribute('data-dense')).toBe(null); // two beats fit even a narrow rail
      const manyBeats: CheckpointView[] = MANY.slice(1).map((c, i) => ({ label: `beat ${i}`, commitId: c.id, at: MANY[i]!.id, ts: i }));
      const crowded = render(<TimeTravelBar compact mode="present" commits={MANY} cursor="c39" head="c39" checkpoints={manyBeats} />).container;
      expect(crowded.querySelector('[data-vzf="beat-rail"]')!.getAttribute('data-dense')).toBe('true'); // thirty-nine beats on a narrow rail: labels hide, flags stay
      expect(crowded.querySelectorAll('[data-vzf="beat-rail"] .vzf-tl-cid')).toHaveLength(0);
      // a rail that mounts LATER (present mode with no beats, then beats named) is measured when it appears
      const late = render(<TimeTravelBar compact mode="present" commits={MANY} cursor="c39" head="c39" checkpoints={[]} />);
      expect(late.container.querySelector('[data-vzf="beat-rail"]')).toBeNull();
      late.rerender(<TimeTravelBar compact mode="present" commits={MANY} cursor="c39" head="c39" checkpoints={manyBeats} />);
      expect(late.container.querySelector('[data-vzf="beat-rail"]')!.getAttribute('data-dense')).toBe('true');
      // the past mark carries its sentence for assistive tech, the glyph is decoration
      const mark = render(<TimeTravelBar compact commits={MANY} cursor="c39" head="c39" checkpoints={BEATS} viewingPast />).container.querySelector('[data-vzf="past-mark"]')!;
      expect(mark.querySelector('.vzf-sr-only')!.textContent).toBe('Viewing the past — act now (or step forward) to branch here.');
      expect(mark.querySelector('[aria-hidden="true"]')!.textContent).toBe('⏱');
    } finally {
      delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
      if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
    }
  });
});
