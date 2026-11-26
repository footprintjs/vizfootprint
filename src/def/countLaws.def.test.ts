/**
 * THE DEFINITION DOOR REFUSES WHAT THE RENDERER REFUSES ABOUT A COUNT.
 *
 * A bar and a histogram bin are counts, drawn as a length from zero. The
 * renderer refuses three declarations about them, because each would draw a
 * picture that says something untrue. The door used to accept all three, so a
 * definition it passed could be refused when drawn. Each law now has one
 * predicate and one sentence (`../encoding/frame.ts`) that both doors ask.
 *
 * | the definition declares                                        | before   | now, at the door                      |
 * |----------------------------------------------------------------|----------|---------------------------------------|
 * | bounds [2, 20] on the y a bar or a histogram binds             | accepted | refused: a count is drawn from zero   |
 * | bounds [0, 0.5] on it (a ceiling below one)                    | accepted | refused                               |
 * | bounds [0, 20] on it                                           | accepted | accepted                              |
 * | bounds [2, 20] on a bar's y the bar does not bind              | accepted | accepted: nothing of the bar's is on it |
 * | bounds [2, 20] on a point's or a line's y                      | accepted | accepted: a position                  |
 * | `transform: 'log'` on the y a histogram binds                  | accepted | refused: its y is its count           |
 * | `transform: 'log'` on a histogram's y it does not bind, or its x | accepted | accepted                            |
 * | a bar layer that binds no y, beside a layer that binds y       | accepted | refused: the bar is not on that axis  |
 * | the same, the bar's y bound                                    | accepted | accepted                              |
 * | two bar layers, neither binds y                                | accepted | accepted: no y axis is drawn          |
 * | a line layer that binds no y, beside one that does             | accepted | accepted: it draws no length          |
 */
import { describe, it, expect } from 'vitest';
import { validateDashboardDef } from './index.js';
import type { DashboardDef } from './index.js';
import { makeNetworkDef } from './network.fixture.js';
import { COUNT_MARKS, boundsFitACount, countBoundsRefusal, countOffAxisRefusal, histogramCountLogRefusal } from '../encoding/index.js';

// `size` is a number column of the fixture's `nodes` table, `group` a category
const numbers: Partial<DashboardDef> = { data: { ...makeNetworkDef().data, nodes: { ...makeNetworkDef().data['nodes']!, columns: { id: { role: 'identifier' }, size: { role: 'measure', type: 'number' }, group: { role: 'dimension' } } } } } as Partial<DashboardDef>;
const layer = (layerId: string, chartKind: string, initial: Record<string, string>): unknown => ({ layerId, table: 'nodes', chartKind, channels: ['x', 'y'], initial });
const stack = (layers: readonly unknown[], frame?: unknown): string[] =>
  validateDashboardDef({ ...makeNetworkDef(undefined, numbers), encodings: [{ viewId: 'net', chartKind: 'network', channels: ['x', 'y'], layers, ...(frame === undefined ? {} : { frame }) }] } as unknown);
const plain = (chartKind: string, initial: Record<string, string>, frame: unknown): string[] =>
  validateDashboardDef({ ...makeNetworkDef(undefined, numbers), encodings: [{ viewId: 'net', chartKind, channels: ['x', 'y'], initial, frame }] } as unknown);

describe('bounds a count cannot stand on', () => {
  it('are refused on the y a bar or a histogram binds, alone or as a layer, in the renderer’s sentence', () => {
    expect(plain('bar', { x: 'group', y: 'size' }, { y: { bounds: [2, 20] } })).toEqual([`encodings[0].frame.y.bounds: ${countBoundsRefusal('view "net"', 'bar', [2, 20])}`]);
    expect(plain('histogram', { x: 'size', y: 'size' }, { y: { bounds: [2, 20] } })).toEqual([`encodings[0].frame.y.bounds: ${countBoundsRefusal('view "net"', 'histogram', [2, 20])}`]);
    expect(stack([layer('counts', 'bar', { x: 'group', y: 'size' })], { y: { mode: 'shared', bounds: [0, 0.5] } })).toEqual([`encodings[0].frame.y.bounds: ${countBoundsRefusal('layer "counts"', 'bar', [0, 0.5])}`]);
  });

  it('are accepted where a count can be drawn on them, where the count does not bind that y, and on a position', () => {
    expect(plain('bar', { x: 'group', y: 'size' }, { y: { bounds: [0, 20] } })).toEqual([]);
    expect(plain('bar', { x: 'group' }, { y: { bounds: [2, 20] } })).toEqual([]);
    expect(plain('point', { x: 'size', y: 'size' }, { y: { bounds: [2, 20] } })).toEqual([]);
    expect(stack([layer('trend', 'line', { x: 'group', y: 'size' })], { y: { mode: 'shared', bounds: [2, 20] } })).toEqual([]);
    // a bar's OTHER axis is a band, where bounds are refused for their own reason and not this one
    expect(plain('bar', { x: 'group', y: 'size' }, { y: { bounds: [0, 20] }, x: {} }).join(' ')).not.toContain('read from zero');
  });

  it('the predicate: from zero, to one or more, in either order', () => {
    expect([[0, 1], [0, 20], [20, 0]].map((pair) => boundsFitACount(pair as [number, number]))).toEqual([true, true, true]);
    expect([[2, 20], [0, 0.5], [-1, 20], [0, 0], [-0.5, 0]].map((pair) => boundsFitACount(pair as [number, number]))).toEqual([false, false, false, false, false]);
  });
});

describe('a logarithm on a histogram’s count', () => {
  it('is refused where the histogram binds y, alone or as a layer, in the renderer’s sentence', () => {
    expect(plain('histogram', { x: 'size', y: 'size' }, { y: { transform: 'log' } })).toEqual([`encodings[0].frame.y: ${histogramCountLogRefusal('view "net"')}`]);
    expect(stack([layer('bins', 'histogram', { x: 'size', y: 'size' })], { y: { mode: 'shared', transform: 'log' } })).toEqual([`encodings[0].frame.y: ${histogramCountLogRefusal('layer "bins"')}`]);
  });

  it('is accepted on its bin axis, and on a y it does not bind', () => {
    expect(plain('histogram', { x: 'size', y: 'size' }, { x: { transform: 'log' } })).toEqual([]);
    expect(plain('histogram', { x: 'size' }, { y: { transform: 'log' } })).toEqual([]);
  });
});

describe('a count that binds no y, beside a layer that does', () => {
  it('is refused, with or without a declared frame, naming both layers, in the renderer’s sentence', () => {
    const layers = [layer('counts', 'bar', { x: 'group' }), layer('trend', 'line', { x: 'group', y: 'size' })];
    const said = [`encodings[0].layers[0]: ${countOffAxisRefusal('layer "counts"', 'bar', 'layer "trend"')}`];
    expect(stack(layers)).toEqual(said);
    expect(stack(layers, { y: { mode: 'shared' } })).toEqual(said);
    expect(stack(layers, { y: { mode: 'independent' } })).toEqual(said);
  });

  it('names every such count, wherever it is declared, and a histogram as one', () => {
    const problems = stack([layer('trend', 'line', { x: 'size', y: 'size' }), layer('bins', 'histogram', { x: 'size' }), layer('more', 'histogram', { x: 'size' })]);
    expect(problems).toEqual([
      `encodings[0].layers[1]: ${countOffAxisRefusal('layer "bins"', 'histogram', 'layer "trend"')}`,
      `encodings[0].layers[2]: ${countOffAxisRefusal('layer "more"', 'histogram', 'layer "trend"')}`,
    ]);
  });

  it('is accepted with its y bound, where no layer binds y, and for a layer that is not a count', () => {
    expect(stack([layer('counts', 'bar', { x: 'group', y: 'size' }), layer('trend', 'line', { x: 'group', y: 'size' })])).toEqual([]);
    expect(stack([layer('a', 'bar', { x: 'group' }), layer('b', 'bar', { x: 'group' })])).toEqual([]);
    expect(stack([layer('a', 'line', { x: 'group' }), layer('b', 'line', { x: 'group', y: 'size' })])).toEqual([]);
  });

  it('a malformed layer is refused on its own line and never judged again here', () => {
    const problems = stack(['nope', { layerId: 7, table: 'nodes', chartKind: 'bar', channels: ['x'] }, { layerId: 'kindless', table: 'nodes', channels: ['x'] }, layer('trend', 'line', { x: 'group', y: 'size' })]);
    expect(problems.some((line) => line.includes('binds no y'))).toBe(false);
    expect(problems.length).toBeGreaterThan(0);
    // …and a layer that binds y but has no usable id names nobody, so no count is judged against it
    const nameless = stack([layer('counts', 'bar', { x: 'group' }), { layerId: '', table: 'nodes', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'group', y: 'size' } }]);
    expect(nameless.some((line) => line.includes('binds no y'))).toBe(false);
  });
});

describe('the marks these laws are about', () => {
  it('are the bar and the histogram', () => {
    expect([...COUNT_MARKS]).toEqual(['bar', 'histogram']);
  });
});
