// @vitest-environment jsdom
/**
 * THE FRAME's own laws, tested with FAKE layers — a layer arrives as a `render`
 * callback, so a stand-in svg proves the geometry and the handout without any
 * real chart's data in the way. What each real mark does with a domain is its
 * own suite's business (`sharedScales.test.tsx`).
 *
 * The load-bearing one is ONE MARGIN BOX: every layer's PLOT rectangle — its
 * own box, minus its own pad — is the SAME rectangle, which is the only reason
 * equal values land on equal pixels across two charts with different margins.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { VizFrame, FRAME_PADS, framePad, framePlotBox, frameLayerBox, isFrameChartKind, type VizFrameLayer, type FrameLayerDraw } from './VizFrame.js';

afterEach(cleanup);

/** A stand-in for one layer's chart: it draws nothing and reports exactly what the frame handed it. */
function fake(layerId: string, kind: VizFrameLayer['kind']): VizFrameLayer {
  return {
    layerId,
    kind,
    render: (draw: FrameLayerDraw) => (
      <svg className="vzf-chart" data-w={draw.width} data-h={draw.height} data-axes={String(draw.axes)} data-domain={JSON.stringify(draw.domain)} />
    ),
  };
}

/** Every layer's box, as the frame positioned it (px off the frame's own corner). */
const boxesOf = (container: Element): Record<string, { left: number; top: number; width: number; height: number }> => {
  const out: Record<string, { left: number; top: number; width: number; height: number }> = {};
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-layer]'))) {
    out[el.dataset['layer'] ?? ''] = { left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) };
  }
  return out;
};

const ticksOf = (container: Element): (string | null)[] => Array.from(container.querySelectorAll('.vzf-frame-guide text.vzf-tick')).map((t) => t.textContent);

describe('the framed kinds', () => {
  it('names the five 2D marks and nothing else — the same list the renderer refuses off', () => {
    expect(Object.keys(FRAME_PADS).sort()).toEqual(['bar', 'boxplot', 'histogram', 'line', 'point']);
    expect(isFrameChartKind('line')).toBe(true);
    expect(isFrameChartKind('heatmap')).toBe(false);
    expect(isFrameChartKind('toString')).toBe(false); // an own-property test, not a prototype walk
  });
});

describe('one margin box', () => {
  it('the frame takes the WIDEST margin on each side, and an empty stack keeps none', () => {
    expect(framePad(['line', 'bar'])).toEqual({ l: Math.max(FRAME_PADS.line.l, FRAME_PADS.bar.l), r: Math.max(FRAME_PADS.line.r, FRAME_PADS.bar.r), t: Math.max(FRAME_PADS.line.t, FRAME_PADS.bar.t), b: Math.max(FRAME_PADS.line.b, FRAME_PADS.bar.b) });
    expect(framePad([])).toEqual({ l: 0, r: 0, t: 0, b: 0 });
  });

  it('a cell pushed narrower than its own margins draws an empty box, never an inside-out one', () => {
    const pad = { l: 40, r: 20, t: 10, b: 30 };
    expect(framePlotBox(pad, 30, 20)).toEqual({ left: 40, top: 10, right: 40, bottom: 10 });
  });

  it('EVERY layer’s plot rectangle is the same rectangle — the promise, in numbers', () => {
    const { container } = render(<VizFrame layers={[fake('a', 'line'), fake('b', 'bar'), fake('c', 'point')]} width={400} height={300} />);
    const boxes = boxesOf(container);
    const pad = framePad(['line', 'bar', 'point']);
    const plot = framePlotBox(pad, 400, 300);
    for (const [layerId, kind] of [['a', 'line'], ['b', 'bar'], ['c', 'point']] as const) {
      const box = boxes[layerId]!;
      const own = FRAME_PADS[kind];
      // the chart's own plot box, expressed in the FRAME's coordinates
      expect({ left: box.left + own.l, top: box.top + own.t, right: box.left + box.width - own.r, bottom: box.top + box.height - own.b }).toEqual(plot);
    }
  });

  it('a layer is offset back by its own pad and sized to the frame’s plot plus that pad', () => {
    expect(frameLayerBox({ l: 10, r: 5, t: 4, b: 6 }, { left: 50, top: 20, right: 150, bottom: 120 })).toEqual({ left: 40, top: 16, width: 115, height: 110 });
  });
});

describe('paint order and the pointer', () => {
  it('DOM order is DECLARATION order (first = bottom), and only the first layer keeps the pointer over its whole box', () => {
    const { container } = render(<VizFrame layers={[fake('under', 'bar'), fake('over', 'line')]} width={400} height={300} />);
    expect(Array.from(container.querySelectorAll('[data-layer]')).map((el) => el.getAttribute('data-layer'))).toEqual(['under', 'over']);
    expect(container.querySelector('[data-layer="under"]')?.className).toContain('vzf-frame-base');
    expect(container.querySelector('[data-layer="over"]')?.className).toContain('vzf-frame-over');
    // the guide is painted BENEATH the marks: it comes first in the one box
    expect(container.querySelector('.vzf-frame')?.firstElementChild?.classList.contains('vzf-frame-guide')).toBe(true);
  });
});

describe('one guide, or one per layer', () => {
  it('merged (the default): the FRAME draws the axes once and every layer is told axes={false}', () => {
    const { container } = render(
      <VizFrame layers={[fake('a', 'line'), fake('b', 'point')]} domain={{ x: [0, 100], y: [0, 10] }} x={{ scale: 'quantitative', label: 'price' }} y={{ scale: 'quantitative', label: 'rating' }} width={400} height={300} />,
    );
    expect(container.querySelectorAll('.vzf-frame-guide')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-axes]')).map((el) => el.getAttribute('data-axes'))).toEqual(['false', 'false']);
    // 3 steps = 4 labels per axis, plus the two axis labels
    expect(ticksOf(container)).toEqual(['0', '33.3', '66.7', '100', '0', '3.3', '6.7', '10', 'price', 'rating']);
    expect(container.querySelectorAll('.vzf-frame-guide line.vzf-axis')).toHaveLength(2 + 4 + 4); // two axis lines + one stroke per tick
  });

  it('per-layer: the frame draws NO guide and every layer draws its own', () => {
    const { container } = render(<VizFrame layers={[fake('a', 'line'), fake('b', 'bar')]} guide="per-layer" domain={{ x: [0, 100] }} x={{ scale: 'quantitative' }} width={400} height={300} />);
    expect(container.querySelectorAll('.vzf-frame-guide')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll('[data-axes]')).map((el) => el.getAttribute('data-axes'))).toEqual(['true', 'true']);
  });

  it('an axis the frame was not given is not drawn — and neither is a tick of an unreadable span', () => {
    const { container } = render(<VizFrame layers={[fake('a', 'line')]} domain={{ y: [Number.NaN, 3] }} y={{ scale: 'quantitative' }} width={400} height={300} />);
    // the y axis LINE is drawn (the frame was given a y axis); its ticks are not (the span is not two finite numbers)
    expect(container.querySelectorAll('.vzf-frame-guide line.vzf-axis')).toHaveLength(1);
    expect(ticksOf(container)).toEqual([]);
  });

  it('a temporal axis spells its ticks as DAYS, off the epoch milliseconds the charts position dates on', () => {
    const { container } = render(
      <VizFrame layers={[fake('a', 'line')]} domain={{ x: [Date.parse('2026-01-01T00:00:00.000Z'), Date.parse('2026-01-04T00:00:00.000Z')] }} x={{ scale: 'temporal' }} width={400} height={300} />,
    );
    expect(ticksOf(container)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });
});

describe('a categorical axis is a band', () => {
  it('one tick per category, at its band centre, in the frame’s order', () => {
    const { container } = render(<VizFrame layers={[fake('a', 'bar')]} domain={{ categories: ['Casual', 'Formal'] }} x={{ scale: 'categorical' }} width={400} height={300} />);
    expect(ticksOf(container)).toEqual(['Casual', 'Formal']);
    const plot = framePlotBox(framePad(['bar']), 400, 300);
    const band = (plot.right - plot.left) / 2;
    expect(Array.from(container.querySelectorAll('.vzf-frame-guide text.vzf-tick')).map((t) => t.getAttribute('x'))).toEqual([String(plot.left + band / 2), String(plot.left + band * 1.5)]);
  });

  it('a label wider than its band slants and is CLIPPED, with the whole name in a title (fitTick — one owner)', () => {
    const many = ['Extraordinarily Long Name One', 'Extraordinarily Long Name Two', 'Extraordinarily Long Name Three', 'Extraordinarily Long Name Four'];
    const { container } = render(<VizFrame layers={[fake('a', 'bar')]} domain={{ categories: many }} x={{ scale: 'categorical', label: 'shelf' }} width={300} height={220} />);
    const slanted = Array.from(container.querySelectorAll('.vzf-frame-guide text.vzf-tick')).filter((t) => t.getAttribute('transform') !== null);
    expect(slanted).toHaveLength(4);
    expect(slanted[0]?.querySelector('title')?.textContent).toBe(many[0]);
    expect(slanted[0]?.textContent).not.toBe(many[0]); // clipped to the room the frame has
  });

  it('a label that slants but FITS the slant keeps its whole text, and carries no title (nothing was clipped)', () => {
    const names = ['ShelfNo01', 'ShelfNo02', 'ShelfNo03', 'ShelfNo04', 'ShelfNo05', 'ShelfNo06', 'ShelfNo07', 'ShelfNo08'];
    const { container } = render(<VizFrame layers={[fake('a', 'bar')]} domain={{ categories: names }} x={{ scale: 'categorical' }} width={400} height={300} />);
    const drawn = Array.from(container.querySelectorAll('.vzf-frame-guide text.vzf-tick'));
    expect(drawn.map((t) => t.getAttribute('transform') === null)).toEqual(names.map(() => false)); // every one slanted
    expect(drawn.map((t) => t.textContent)).toEqual(names); // …and every one whole
    expect(container.querySelectorAll('.vzf-frame-guide title')).toHaveLength(0);
  });

  it('a categorical Y draws its line and no ticks — the band order is the X’s by definition, and the x’s names down the side would be a lie', () => {
    const { container } = render(<VizFrame layers={[fake('a', 'boxplot')]} domain={{ categories: ['Casual', 'Formal'] }} x={{ scale: 'categorical' }} y={{ scale: 'categorical' }} width={400} height={300} />);
    // two axis lines, and only the X carries the bands
    expect(container.querySelectorAll('.vzf-frame-guide line.vzf-axis')).toHaveLength(2 + 2);
    expect(ticksOf(container)).toEqual(['Casual', 'Formal']);
  });

  it('a categorical axis with no list folded draws its line and no ticks — no invented bands', () => {
    const { container } = render(<VizFrame layers={[fake('a', 'bar')]} x={{ scale: 'categorical' }} width={400} height={300} />);
    expect(ticksOf(container)).toEqual([]);
    expect(container.querySelectorAll('.vzf-frame-guide line.vzf-axis')).toHaveLength(1);
  });
});

describe('what a layer is handed', () => {
  it('the frame’s domain and the box it sized, and a stack says how many layers it is', () => {
    const { container } = render(<VizFrame layers={[fake('a', 'bar')]} domain={{ y: [0, 40] }} width={400} height={300} className="mine" ariaLabel="counts and their spread" />);
    const layer = container.querySelector('[data-layer="a"] svg');
    expect(JSON.parse(layer?.getAttribute('data-domain') ?? '{}')).toEqual({ y: [0, 40] });
    const box = boxesOf(container)['a']!;
    expect([layer?.getAttribute('data-w'), layer?.getAttribute('data-h')]).toEqual([String(box.width), String(box.height)]);
    expect(container.querySelector('.vzf-frame')?.className).toBe('vzf-frame mine');
    expect(container.querySelector('.vzf-frame')?.getAttribute('aria-label')).toBe('counts and their spread');
  });

  it('a frame with no layers, and no domain, is drawn as an empty box rather than refused here (the RENDERER says the words)', () => {
    const { container } = render(<VizFrame layers={[]} />);
    expect(container.querySelectorAll('[data-layer]')).toHaveLength(0);
    expect(container.querySelector('.vzf-frame')?.getAttribute('aria-label')).toBe('0 layers on one frame');
  });
});
