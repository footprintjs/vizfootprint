// @vitest-environment jsdom
/**
 * A DATE AXIS FOLDED FROM THE ROWS HOLDS EVERY ROW THE CHART DRAWS.
 *
 * The fold used to compare dates as text and the chart places them as
 * instants. A column that mixes spellings (two time zones) then got a span
 * that left a row outside its own axis, and the chart said so about data that
 * was only spelled differently.
 *
 * | the x column                                   | before                              | now                    |
 * |------------------------------------------------|-------------------------------------|------------------------|
 * | three instants, one written at UTC−5           | the latest drawn past the axis end, and a sentence about it | every point on the axis, no sentence |
 * | one spelling throughout                        | every point on the axis             | unchanged              |
 */
import { describe, expect, it, vi } from 'vitest';
import { frameDomains } from 'vizfootprint/def';
import { lineRenderer } from './renderers.js';
import { emptySelection } from './selection.js';
import { RENDERER_PROTOCOL_VERSION, type RenderRow, type ResolvedChannel } from './types.js';

/** Fold x from the rows as the library does, with one declared word so a plain view takes the folded span, and draw the line. */
function drawn(rows: readonly RenderRow[]): HTMLElement {
  const folded = frameDomains([{ layerId: 'v', chartKind: 'line', channels: { x: { type: 'date', values: rows.map((row) => row['d']) } } }], { x: { mode: 'shared', transform: 'linear' } } as never);
  const el = document.createElement('div');
  lineRenderer()
    .mount(el, { protocolVersion: RENDERER_PROTOCOL_VERSION, viewId: 'v', callbacks: { emit: vi.fn(), hover: vi.fn(), reencodeRequest: vi.fn(), navigate: vi.fn() } })
    .update({ rows, encodings: { x: 'd', y: 'v' }, selection: emptySelection('v'), hover: null, theme: {}, size: { width: 400, height: 300 }, frame: folded as Readonly<Record<string, ResolvedChannel>> });
  return el;
}
const dotXs = (el: HTMLElement): number[] => [...el.querySelectorAll('circle.vzf-line-dot')].map((c) => Number(c.getAttribute('cx')));
const axisEnds = (el: HTMLElement): [number, number] => {
  const line = el.querySelector('[data-axis-orient="bottom"] line.vzf-axis')!;
  return [Number(line.getAttribute('x1')), Number(line.getAttribute('x2'))];
};

describe('a line over dates written in two time zones', () => {
  const MIXED: readonly RenderRow[] = [
    { d: '2026-04-01T20:00:00Z', v: 1 },
    { d: '2026-04-02T01:00:00Z', v: 2 },
    { d: '2026-04-01T23:00:00-05:00', v: 3 }, // 04:00Z on the 2nd: the latest, though its text sorts in the middle
  ];

  it('stands wholly on its own axis, the latest point on the axis’s end, and says nothing about a row outside', () => {
    const el = drawn(MIXED);
    const [left, right] = axisEnds(el);
    const xs = dotXs(el);
    expect(xs).toHaveLength(3);
    expect(Math.min(...xs)).toBe(left);
    expect(Math.max(...xs)).toBe(right);
    // the row written at UTC−5 is the one on the right end
    expect(xs[2]).toBe(right);
    expect(el.querySelector('text.vzf-outside-note')).toBeNull();
  });

  it('one spelling throughout is the picture it always was: first point on the left end, last on the right', () => {
    const el = drawn([{ d: '2026-04-01', v: 1 }, { d: '2026-04-02', v: 2 }, { d: '2026-04-03', v: 3 }]);
    const [left, right] = axisEnds(el);
    expect(dotXs(el)).toEqual([left, (left + right) / 2, right]);
    expect(el.querySelector('text.vzf-outside-note')).toBeNull();
  });
});
