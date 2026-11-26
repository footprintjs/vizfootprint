/**
 * THE DEFINITION DOOR REFUSES WHAT THE RENDERER REFUSES ABOUT A COUNT.
 *
 * A bar and a histogram bin are counts, drawn as a length from zero. The
 * renderer refuses three declarations about them, because each would draw a
 * picture that says something untrue. The door used to accept all three, so a
 * definition it passed could be refused when drawn. Each law now has one
 * predicate and one sentence (`../encoding/frame.ts`) that both doors ask.
 *
 * | the definition declares                                          | before   | now, at the door                        |
 * |------------------------------------------------------------------|----------|-----------------------------------------|
 * | bounds [2, 20] on the y a bar or a histogram may bind            | accepted | refused: a count is drawn from zero     |
 * | bounds [0, 0.5] on it (a ceiling below one)                      | accepted | refused                                 |
 * | bounds [0, 20] on it                                             | accepted | accepted                                |
 * | the same bounds, a line binding that y too                       | accepted | refused, saying whose y it is           |
 * | bounds [2, 20] on a y a bar LAYER does not bind                  | accepted | accepted: a layer cannot be re-encoded  |
 * | bounds [2, 20] on a plain bar's y it does not bind YET           | accepted | refused: a view can be re-encoded onto it |
 * | bounds [2, 20] on a point's or a line's y, or a histogram's x    | accepted | accepted: a position                    |
 * | `transform: 'log'` on the y a histogram may bind                 | accepted | refused: its y is its count             |
 * | `transform: 'log'` on a histogram's x, or a layer's unbound y    | accepted | accepted                                |
 * | a bar layer that binds no y, beside a layer that binds y         | accepted | refused: the bar is not on that axis    |
 * | the same, the bar's y bound                                      | accepted | accepted                                |
 * | two bar layers, neither binds y                                  | accepted | accepted: no y axis is drawn            |
 * | a line layer that binds no y, beside one that does               | accepted | accepted: it draws no length            |
 *
 * WHAT "MAY BIND" MEANS. A layer cannot be re-encoded after the build, so it
 * is judged by what its `initial` binds. A plain view can (the `reencode`
 * verb binds any channel it declares), so it is judged by its `channels`: a
 * definition that passes must not reach the refused picture by one ordinary
 * act.
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

  it('are accepted where a count can be drawn on them, and on a position', () => {
    expect(plain('bar', { x: 'group', y: 'size' }, { y: { bounds: [0, 20] } })).toEqual([]);
    expect(plain('point', { x: 'size', y: 'size' }, { y: { bounds: [2, 20] } })).toEqual([]);
    expect(stack([layer('trend', 'line', { x: 'group', y: 'size' })], { y: { mode: 'shared', bounds: [2, 20] } })).toEqual([]);
    // a histogram's x is its bin axis, a position: bounds there are not a count's
    expect(plain('histogram', { x: 'size', y: 'size' }, { x: { bounds: [2, 20] } })).toEqual([]);
    expect(stack([layer('bins', 'histogram', { x: 'size', y: 'size' })], { x: { mode: 'shared', bounds: [2, 20] } })).toEqual([]);
  });

  it('a layer is judged by what it binds, a plain view by what it may come to bind', () => {
    // a layer cannot be re-encoded: a bar layer that binds no y has nothing on that axis, now or later
    expect(stack([layer('counts', 'bar', { x: 'group' })], { y: { mode: 'shared', bounds: [2, 20] } })).toEqual([]);
    // a plain view can: one `reencode` onto y would draw the refused picture, so it is refused at the door
    expect(plain('bar', { x: 'group' }, { y: { bounds: [2, 20] } })).toEqual([`encodings[0].frame.y.bounds: ${countBoundsRefusal('view "net"', 'bar', [2, 20])}`]);
    expect(plain('histogram', { x: 'size' }, { y: { bounds: [2, 20] } })).toEqual([`encodings[0].frame.y.bounds: ${countBoundsRefusal('view "net"', 'histogram', [2, 20])}`]);
  });

  it('beside a line or a point that binds the same y, the sentence says whose y it is', () => {
    const layers = [layer('counts', 'bar', { x: 'group', y: 'size' }), layer('trend', 'line', { x: 'group', y: 'size' })];
    const said = countBoundsRefusal('layer "counts"', 'bar', [2, 20], 'layer "trend"');
    expect(said).toBe('layer "counts" is a bar, read from zero, and the y it shares with layer "trend" declares bounds [2, 20]: a length from zero cannot be drawn on them as declared. Declare bounds that start at zero and reach one or more, or declare none.');
    expect(stack(layers, { y: { mode: 'shared', bounds: [2, 20] } })).toEqual([`encodings[0].frame.y.bounds: ${said}`]);
    // two counts, each named once
    const two = stack([layer('a', 'bar', { x: 'group', y: 'size' }), layer('b', 'histogram', { x: 'size', y: 'size' })], { y: { mode: 'shared', bounds: [2, 20] } });
    expect(two.filter((line) => line.includes('read from zero'))).toEqual([`encodings[0].frame.y.bounds: ${countBoundsRefusal('layer "a"', 'bar', [2, 20])}`, `encodings[0].frame.y.bounds: ${countBoundsRefusal('layer "b"', 'histogram', [2, 20])}`]);
  });

  it('the predicate: from zero, to one or more, in either order', () => {
    expect([[0, 1], [0, 20], [20, 0]].map((pair) => boundsFitACount(pair as [number, number]))).toEqual([true, true, true]);
    expect([[2, 20], [0, 0.5], [-1, 20], [0, 0], [-0.5, 0]].map((pair) => boundsFitACount(pair as [number, number]))).toEqual([false, false, false, false, false]);
    // a bound that is not a finite number is no bound to draw on (a frame folded by hand can hold one)
    expect([[Infinity, 0], [0, Infinity], [0, Number.NaN], [-Infinity, 5]].map((pair) => boundsFitACount(pair as [number, number]))).toEqual([false, false, false, false]);
    expect(boundsFitACount([-0, 5])).toBe(true);
  });
});

describe('a logarithm on a histogram’s count', () => {
  it('is refused where the histogram binds y, alone or as a layer, in the renderer’s sentence', () => {
    expect(plain('histogram', { x: 'size', y: 'size' }, { y: { transform: 'log' } })).toEqual([`encodings[0].frame.y: ${histogramCountLogRefusal('view "net"')}`]);
    expect(stack([layer('bins', 'histogram', { x: 'size', y: 'size' })], { y: { mode: 'shared', transform: 'log' } })).toEqual([`encodings[0].frame.y: ${histogramCountLogRefusal('layer "bins"')}`]);
  });

  it('is accepted on its bin axis, and on a y a histogram LAYER does not bind', () => {
    expect(plain('histogram', { x: 'size', y: 'size' }, { x: { transform: 'log' } })).toEqual([]);
    expect(stack([layer('bins', 'histogram', { x: 'size' })], { y: { mode: 'shared', transform: 'log' } })).toEqual([]);
  });

  it('is refused on a plain histogram that declares y and does not bind it yet: one re-encode would bind it', () => {
    expect(plain('histogram', { x: 'size' }, { y: { transform: 'log' } })).toEqual([`encodings[0].frame.y: ${histogramCountLogRefusal('view "net"')}`]);
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
    // …a layer that binds y but is malformed (no usable id; an unknown table is still a well-formed shape) is not the layer with the axis
    const nameless = stack([layer('counts', 'bar', { x: 'group' }), { layerId: '', table: 'nodes', chartKind: 'line', channels: ['x', 'y'], initial: { x: 'group', y: 'size' } }]);
    expect(nameless.some((line) => line.includes('binds no y'))).toBe(false);
    // …and a count whose `channels` is not a list is refused for that, once
    const shapeless = stack([{ layerId: 'counts', table: 'nodes', chartKind: 'bar', channels: 'y' }, layer('trend', 'line', { x: 'group', y: 'size' })]);
    expect(shapeless.some((line) => line.includes('binds no y'))).toBe(false);
    expect(shapeless.length).toBeGreaterThan(0);
  });
});

describe('the marks these laws are about', () => {
  it('are the bar and the histogram', () => {
    expect([...COUNT_MARKS]).toEqual(['bar', 'histogram']);
  });
});
