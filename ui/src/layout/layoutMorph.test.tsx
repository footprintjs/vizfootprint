// @vitest-environment jsdom
/**
 * LY-1 — `useLayoutMorph`: FLIP over transform ONLY. jsdom has no layout, no
 * WAAPI, and no matchMedia, so every rung of the progressive enhancement is
 * driven explicitly: rects via a prototype `getBoundingClientRect` stub keyed
 * by `data-chart` id, WAAPI via a prototype `animate` spy, reduced motion via
 * a `matchMedia` global stub.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useLayoutMorph } from './layoutMorph.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The mutable rect table the prototype stub reads (id → box). */
let RECTS: Record<string, Box> = {};
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });

function stubRects(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const id = this.getAttribute('data-chart');
    const b = (id !== null ? RECTS[id] : undefined) ?? box(0, 0, 0, 0);
    return { ...b, right: b.left + b.width, bottom: b.top + b.height, x: b.left, y: b.top, toJSON: () => b } as DOMRect;
  });
}

/** Install a WAAPI spy (jsdom ships no `Element.animate`). */
function stubAnimate(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = spy;
  return spy;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  RECTS = {};
});

function Harness(props: { sig: string; ids: readonly string[]; tick?: number }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutMorph(ref, props.sig);
  return (
    <div ref={ref} data-tick={props.tick ?? 0}>
      {props.ids.map((id) => (
        <div key={id} data-chart={id} />
      ))}
    </div>
  );
}

describe('useLayoutMorph — FLIP, transform only', () => {
  it('never animates on first mount, nor on a re-render with the SAME signature', () => {
    stubRects();
    const spy = stubAnimate();
    RECTS = { a: box(0, 0, 100, 100) };
    const r = render(<Harness sig="flow" ids={['a']} />);
    r.rerender(<Harness sig="flow" ids={['a']} tick={1} />); // same signature — snapshot refresh only
    expect(spy).not.toHaveBeenCalled();
  });

  it('a signature change inverts each moved cell and plays transform-only keyframes', () => {
    stubRects();
    const spy = stubAnimate();
    // phase A — the anchor snapshot
    RECTS = {
      moveX: box(0, 0, 100, 100),
      moveY: box(0, 0, 100, 100),
      scaleX: box(0, 0, 100, 100),
      scaleY: box(0, 0, 100, 100),
      still: box(300, 300, 100, 100),
      bornDead: box(0, 0, 0, 100), // zero WIDTH in the first snapshot → skipped
      diesLater: box(0, 0, 100, 100), // becomes zero HEIGHT after — skipped
    };
    const ids = ['moveX', 'moveY', 'scaleX', 'scaleY', 'still', 'bornDead', 'diesLater'];
    const r = render(<Harness sig="flow" ids={ids} />);

    // phase B — the new layout
    RECTS = {
      moveX: box(200, 0, 100, 100),
      moveY: box(0, 50, 100, 100),
      scaleX: box(0, 0, 50, 100),
      scaleY: box(0, 0, 100, 50),
      still: box(300, 300, 100, 100),
      bornDead: box(0, 0, 100, 100),
      diesLater: box(0, 0, 100, 0),
      fresh: box(9, 9, 10, 10), // mounts WITH the new signature — no anchor, skipped
    };
    r.rerender(<Harness sig="grid" ids={[...ids, 'fresh']} />);

    const byTransform = spy.mock.calls.map((c) => (c[0] as { transform: string }[])[0]!.transform);
    expect(byTransform).toEqual([
      'translate(-200px, 0px) scale(1, 1)',
      'translate(0px, -50px) scale(1, 1)',
      'translate(0px, 0px) scale(2, 1)',
      'translate(0px, 0px) scale(1, 2)',
    ]);
    // every animation lands on identity with the fixed timing (compositor-only frames)
    for (const call of spy.mock.calls) {
      expect((call[0] as { transform: string }[])[1]!.transform).toBe('none');
      expect(call[1]).toEqual({ duration: 260, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    }
    expect(spy).toHaveBeenCalledTimes(4); // still / bornDead / diesLater / fresh all skipped
  });

  it('prefers-reduced-motion disables the morph; matches:false keeps it', () => {
    stubRects();
    const spy = stubAnimate();
    RECTS = { a: box(0, 0, 100, 100) };
    const r = render(<Harness sig="flow" ids={['a']} />);

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    RECTS = { a: box(50, 0, 100, 100) };
    r.rerender(<Harness sig="grid" ids={['a']} />);
    expect(spy).not.toHaveBeenCalled(); // reduced motion — the layout just lands

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    RECTS = { a: box(100, 0, 100, 100) };
    r.rerender(<Harness sig="focus" ids={['a']} />);
    expect(spy).toHaveBeenCalledTimes(1); // motion allowed again
  });

  it('without the Web Animations API the layout lands instantly (no crash, no fake)', () => {
    stubRects(); // NOTE: no animate stub — jsdom's honest state
    RECTS = { a: box(0, 0, 100, 100) };
    const r = render(<Harness sig="flow" ids={['a']} />);
    RECTS = { a: box(70, 0, 100, 100) };
    expect(() => r.rerender(<Harness sig="grid" ids={['a']} />)).not.toThrow();
  });
});
