// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { ChartFrame } from './ChartFrame.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Point the frame's own getBoundingClientRect at a controllable box. */
function mockRect(width: number, height: number): { set: (w: number, h: number) => void } {
  const box = { width, height };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: box.width, height: box.height, top: 0, left: 0, right: box.width, bottom: box.height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  return {
    set: (w, h) => {
      box.width = w;
      box.height = h;
    },
  };
}

describe('ChartFrame — container measurement', () => {
  it('measures its box once and hands { width, height } to the render prop (floored)', () => {
    mockRect(512.7, 341.2);
    const seen: { width: number; height: number }[] = [];
    const { container } = render(
      <ChartFrame>
        {(size) => {
          seen.push(size);
          return <svg className="vzf-chart" data-w={size.width} data-h={size.height} />;
        }}
      </ChartFrame>,
    );
    expect(seen).toEqual([{ width: 512, height: 341 }]);
    expect(container.querySelector('[data-vzf="chart-frame"] svg')?.getAttribute('data-w')).toBe('512');
  });

  it('renders NOTHING while the box has no layout (0×0 — jsdom default, display:none)', () => {
    const child = vi.fn(() => <svg />);
    const { container } = render(<ChartFrame>{child}</ChartFrame>);
    expect(child).not.toHaveBeenCalled();
    expect(container.querySelector('[data-vzf="chart-frame"]')?.childNodes).toHaveLength(0);
  });

  it('re-renders at the new size when a ResizeObserver fires, and ignores a same-size echo', () => {
    const rect = mockRect(400, 300);
    let fire: (() => void) | undefined;
    class RO {
      constructor(cb: ResizeObserverCallback) {
        fire = () => cb([], this as unknown as ResizeObserver);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    const seen: { width: number; height: number }[] = [];
    render(<ChartFrame>{(s) => (seen.push(s), (<svg />))}</ChartFrame>);
    expect(seen).toEqual([{ width: 400, height: 300 }]);
    // a resize → new size flows through
    rect.set(600, 250);
    act(() => fire!());
    expect(seen.at(-1)).toEqual({ width: 600, height: 250 });
    // an echo at the SAME size → the state object is REUSED (React can bail out
    // on the identical reference; any extra render sees the very same object)
    const before = seen.at(-1)!;
    act(() => fire!());
    expect(seen.at(-1)).toBe(before);
  });

  it('disconnects its observer on unmount', () => {
    mockRect(400, 300);
    const disconnect = vi.fn();
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', RO);
    const { unmount } = render(<ChartFrame>{() => <svg />}</ChartFrame>);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('passes className through onto the frame', () => {
    const { container } = render(<ChartFrame className="cell-a">{() => <svg />}</ChartFrame>);
    expect(container.querySelector('.vzf-chart-frame')?.classList.contains('cell-a')).toBe(true);
  });
});
