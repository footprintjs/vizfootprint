/**
 * THE FRAME'S FOLD — `frameDomains`: one domain per shared channel, over the
 * layers' own values. The union per scale kind, the zero policy and its one
 * owner, the basis echoed rather than decided, categories in declaration
 * order, and the shapes a frame refuses to invent a domain for (an empty
 * layer, an unreadable type, all-absent cells). The 4+ lint is a sentence, not
 * a refusal.
 */
import { describe, it, expect } from 'vitest';
import { frameDomains, frameLint, frameScaleOf, resolutionFor, zeroAnchorsChannel, zeroPolicyFor, FRAME_LAYER_LINT, ZERO_ANCHORED_KINDS, type FrameLayer } from './frame.js';
import type { ChannelResolution } from '../def/types.js';

/** One layer, spelled the short way: `layer('a', 'line', { y: ['number', [1, 2]] })`. */
const layer = (layerId: string, chartKind: string, channels: Record<string, [FrameLayer['channels'][string]['type'], unknown[]]>): FrameLayer => ({
  layerId,
  chartKind,
  channels: Object.fromEntries(Object.entries(channels).map(([channel, [type, values]]) => [channel, { type, values }])),
});

describe('frameDomains — the union, per scale kind', () => {
  it('QUANTITATIVE: [min, max] across every layer that binds the channel', () => {
    const frame = frameDomains([layer('a', 'line', { y: ['number', [3, 9]] }), layer('b', 'point', { y: ['number', [-4, 5]] })]);
    expect(frame['y']).toEqual({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [-4, 9] });
  });

  it('TEMPORAL: [earliest, latest] over the ISO strings — compared as strings, which for ISO-8601 IS chronological', () => {
    const frame = frameDomains([layer('a', 'line', { x: ['date', ['2026-03-01', '2026-01-04']] }), layer('b', 'bar', { x: ['date', ['2025-12-31', '2026-02-02']] })]);
    expect(frame['x']).toEqual({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'temporal', domain: ['2025-12-31', '2026-03-01'] });
  });

  it('TEMPORAL: a Date OBJECT counts, as its own ISO spelling — a dropped Date would leave a domain that excludes drawn rows', () => {
    const dates = frameDomains([layer('a', 'line', { x: ['date', [new Date('2026-03-01T00:00:00Z'), new Date('2026-01-04T00:00:00Z')]] })]);
    expect(dates['x']).toMatchObject({ scale: 'temporal', domain: ['2026-01-04T00:00:00.000Z', '2026-03-01T00:00:00.000Z'] });
    // mixed with strings, the Date still bounds the domain — it was the earliest row the frame is drawing
    const mixed = frameDomains([layer('a', 'line', { x: ['date', [new Date('2020-01-01T00:00:00Z'), '2026-03-01']] })]);
    expect(mixed['x']).toMatchObject({ domain: ['2020-01-01T00:00:00.000Z', '2026-03-01'] });
    // an INVALID Date is an absence like any other, never an epoch-zero floor
    expect(frameDomains([layer('a', 'line', { x: ['date', [new Date('nope'), '2026-03-01']] })])['x']).toMatchObject({ domain: ['2026-03-01', '2026-03-01'] });
  });

  it('CATEGORICAL: the union in first-seen order, walking the layers in DECLARATION order (the order they are painted in)', () => {
    const frame = frameDomains([
      layer('under', 'bar', { color: ['string', ['viral', 'viral', 'bacterial']] }),
      layer('over', 'line', { color: ['string', ['bacterial', 'fungal']] }),
    ]);
    expect(frame['color']).toEqual({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'categorical', domain: ['viral', 'bacterial', 'fungal'] });
    // …and the SAME two layers declared the other way round legend in the other order — declaration order is the order
    const flipped = frameDomains([
      layer('over', 'line', { color: ['string', ['bacterial', 'fungal']] }),
      layer('under', 'bar', { color: ['string', ['viral', 'viral', 'bacterial']] }),
    ]);
    expect(flipped['color']).toMatchObject({ domain: ['bacterial', 'fungal', 'viral'] });
  });

  it('a boolean column folds as two categories, and an absent cell is not the category "null"', () => {
    const frame = frameDomains([layer('a', 'point', { shape: ['boolean', [true, null, false, undefined, true]] })]);
    expect(frame['shape']).toMatchObject({ scale: 'categorical', domain: ['true', 'false'] });
  });

  it('a channel only ONE layer binds is still the frame’s — a stack of one is a frame', () => {
    const frame = frameDomains([layer('a', 'line', { y: ['number', [1, 4]] }), layer('b', 'point', { size: ['number', [7, 7]] })]);
    expect(frame['y']).toMatchObject({ domain: [1, 4] });
    expect(frame['size']).toMatchObject({ domain: [7, 7] });
  });

  it('an absent cell contributes nothing — a null, an undefined and a non-finite number are silences, never zeros', () => {
    const frame = frameDomains([layer('a', 'bar', { y: ['number', [5, null, undefined, NaN, Infinity, 8]] })]);
    // zero rides in because a bar is zero-anchored; the absences did NOT drag the floor to 0 by being read as numbers
    expect(frame['y']).toMatchObject({ domain: [0, 8] });
    const line = frameDomains([layer('a', 'line', { y: ['number', [5, null, 8]] })]);
    expect(line['y']).toMatchObject({ domain: [5, 8] });
  });
});

describe('frameDomains — what it refuses to invent', () => {
  it('a layer that binds nothing carries no channels into the frame', () => {
    expect(frameDomains([layer('empty', 'line', {})])).toEqual({});
    // …and beside a layer that binds something, it simply adds nothing
    expect(frameDomains([layer('empty', 'line', {}), layer('a', 'line', { y: ['number', [2, 3]] })])).toEqual({
      y: { mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [2, 3] },
    });
  });

  it('no layers at all is an empty frame, not an invented one', () => {
    expect(frameDomains([])).toEqual({});
    expect(frameDomains([], { y: { mode: 'shared' } })).toEqual({});
  });

  it('a channel whose column type nothing folds from carries NO entry — no domain is more honest than [0, 1]', () => {
    expect(frameDomains([layer('a', 'line', { y: ['unknown', [1, 2, 3]] })])).toEqual({});
  });

  it('a channel every cell of which was absent carries NO entry, zero policy or not', () => {
    expect(frameDomains([layer('a', 'bar', { y: ['number', [null, undefined] as unknown[]] })])).toEqual({});
    expect(frameDomains([layer('a', 'line', { x: ['date', [null, ''] as unknown[]] })])).toEqual({});
    expect(frameDomains([layer('a', 'line', { color: ['string', [null, undefined] as unknown[]] })])).toEqual({});
  });

  it('the SCALE KIND is the first binding layer’s, and a later layer that does not read as it contributes nothing rather than bending the scale', () => {
    // a provider whose real types differ from the declared ones is what gets past the def door; the fold does not follow it
    const frame = frameDomains([layer('a', 'line', { x: ['number', [1, 5]] }), layer('b', 'line', { x: ['date', ['2026-01-01']] })]);
    expect(frame['x']).toMatchObject({ scale: 'quantitative', domain: [1, 5] });
  });

  it('a CATEGORICAL fold NAMES every cell it is given, so the two spellings of one disagreement answer differently — stated at `frameDomains`, not left to be discovered', () => {
    // string first: one category list over both layers, the number named as the category "7"
    const strFirst = frameDomains([layer('a', 'line', { c: ['string', ['x']] }), layer('b', 'line', { c: ['number', [7]] })]);
    expect(strFirst['c']).toMatchObject({ scale: 'categorical', domain: ['x', '7'] });
    // number first: a quantitative domain, and the string layer contributes nothing
    const numFirst = frameDomains([layer('a', 'line', { c: ['number', [7]] }), layer('b', 'line', { c: ['string', ['x']] })]);
    expect(numFirst['c']).toMatchObject({ scale: 'quantitative', domain: [7, 7] });
  });
});

describe('frameDomains — the resolution is obeyed, never re-decided', () => {
  it('an INDEPENDENT channel carries no domain: each layer keeps its own scale and draws its own guide', () => {
    const frame = frameDomains([layer('a', 'line', { y: ['number', [1, 2]] }), layer('b', 'point', { y: ['number', [90, 99]] })], { y: { mode: 'independent' } });
    expect(frame['y']).toEqual({ mode: 'independent', guide: 'per-layer' });
  });

  it('a channel the frame does not name is shared / union / table / merged — Wickham’s default, spelled once in `resolutionFor`', () => {
    expect(resolutionFor('y')).toEqual({ mode: 'shared', domain: 'union', basis: 'table', guide: 'merged' });
    expect(resolutionFor('y', { x: { mode: 'independent' } })).toEqual({ mode: 'shared', domain: 'union', basis: 'table', guide: 'merged' });
    // …and a DECLARED one comes back filled in, so no reader defaults anything a second time
    expect(resolutionFor('y', { y: { mode: 'shared', basis: 'rows' } })).toEqual({ mode: 'shared', domain: 'union', basis: 'rows', guide: 'merged' });
    expect(resolutionFor('y', { y: { mode: 'shared', guide: 'per-layer', zero: false } })).toEqual({ mode: 'shared', domain: 'union', basis: 'table', guide: 'per-layer', zero: false });
    // `zero` alone stays absent where it was not declared: only the MARKS can decide it (`zeroPolicyFor`)
    expect(resolutionFor('color', { color: { mode: 'independent' } })).toEqual({ mode: 'independent', guide: 'per-layer' });
  });

  it('BASIS is echoed, never decided here: the same values under `table` and under `rows` fold to the same numbers and say which read they came from', () => {
    const layers = [layer('a', 'line', { y: ['number', [1, 4]] })];
    const table = frameDomains(layers, { y: { mode: 'shared', basis: 'table' } });
    const rows = frameDomains(layers, { y: { mode: 'shared', basis: 'rows' } });
    expect(table['y']).toEqual({ mode: 'shared', basis: 'table', guide: 'merged', scale: 'quantitative', domain: [1, 4] });
    expect(rows['y']).toEqual({ mode: 'shared', basis: 'rows', guide: 'merged', scale: 'quantitative', domain: [1, 4] });
    // WHICH rows those were is the caller's act — the adapter reads a narrower window for `rows`, and the fold cannot tell
    const narrower = frameDomains([layer('a', 'line', { y: ['number', [2, 3]] })], { y: { mode: 'shared', basis: 'rows' } });
    expect(narrower['y']).toMatchObject({ basis: 'rows', domain: [2, 3] });
  });

  it('a per-layer guide folds ONE domain and still lets each layer draw its own axis', () => {
    const frame = frameDomains([layer('a', 'line', { y: ['number', [1, 4]] }), layer('b', 'point', { y: ['number', [0, 9]] })], { y: { mode: 'shared', guide: 'per-layer' } });
    expect(frame['y']).toEqual({ mode: 'shared', basis: 'table', guide: 'per-layer', scale: 'quantitative', domain: [0, 9] });
  });
});

describe('the zero policy has ONE owner', () => {
  it('the marks whose extent IS the quantity are the zero-anchored ones', () => {
    expect(ZERO_ANCHORED_KINDS).toEqual(['bar', 'histogram', 'boxplot']);
  });

  it('undeclared, the MARKS decide: a bar-like layer anchors the whole channel at zero; a line/point stack takes the data’s own union', () => {
    expect(zeroPolicyFor(['line', 'point'])).toBe(false);
    expect(zeroPolicyFor(['line', 'bar'])).toBe(true);
    expect(zeroPolicyFor(['histogram'])).toBe(true);
    expect(zeroPolicyFor(['boxplot'])).toBe(true);
    expect(zeroPolicyFor([undefined])).toBe(false);
    // one stack, one baseline: a bar under a line pulls the line's floor to zero too
    const frame = frameDomains([layer('bars', 'bar', { y: ['number', [40, 90]] }), layer('trend', 'line', { y: ['number', [55, 70]] })]);
    expect(frame['y']).toMatchObject({ domain: [0, 90] });
  });

  it('a mark’s extent is read on its MAGNITUDE channel only — a bar drags no zero onto its own colour ramp', () => {
    expect(zeroAnchorsChannel('bar', 'y')).toBe(true);
    expect(zeroAnchorsChannel('bar', 'x')).toBe(true); // a horizontal bar's extent is its x — the COLUMN decides which, never a declaration
    expect(zeroAnchorsChannel('boxplot', 'size')).toBe(true);
    expect(zeroAnchorsChannel('bar', 'color')).toBe(false);
    expect(zeroAnchorsChannel('line', 'y')).toBe(false);
    expect(zeroAnchorsChannel(undefined, 'y')).toBe(false);
    // every kind the predicate answers for is one of the zero-anchored marks — the two lists cannot drift
    for (const kind of ['bar', 'boxplot']) expect(ZERO_ANCHORED_KINDS).toContain(kind);
    // a numeric colour ramp on a bar stack takes the data's own union, not a floor at zero
    expect(frameDomains([layer('bars', 'bar', { y: ['number', [40, 90]], color: ['number', [40, 90]] })])).toMatchObject({
      y: { domain: [0, 90] },
      color: { domain: [40, 90] },
    });
  });

  it('a HISTOGRAM anchors NO bound channel: the axis its bins sit on is a POSITION, and its count axis is counted, never bound', () => {
    // ages 30..80 on one histogram layer: the frame says [30, 80], not [0, 80] with a third of the plot empty
    expect(frameDomains([layer('ages', 'histogram', { x: ['number', [30, 80]] })])['x']).toMatchObject({ domain: [30, 80] });
    expect(zeroAnchorsChannel('histogram', 'x')).toBe(false);
    // …and a BAR beside it still anchors the channel they share, because a bar's extent IS on it
    expect(frameDomains([layer('ages', 'histogram', { x: ['number', [30, 80]] }), layer('bars', 'bar', { x: ['number', [50, 60]] })])['x']).toMatchObject({ domain: [0, 80] });
    // a declared zero is still the answer for a histogram — the marks decide only what nobody declared
    expect(frameDomains([layer('ages', 'histogram', { x: ['number', [30, 80]] })], { x: { mode: 'shared', zero: true } })['x']).toMatchObject({ domain: [0, 80] });
  });

  it('a declared policy IS the answer — for both words', () => {
    expect(zeroPolicyFor(['bar'], false)).toBe(false);
    expect(zeroPolicyFor(['line'], true)).toBe(true);
    // declared true on a line stack: the floor drops to zero
    expect(frameDomains([layer('a', 'line', { y: ['number', [40, 90]] })], { y: { mode: 'shared', zero: true } })['y']).toMatchObject({ domain: [0, 90] });
    // declared false on a line stack whose values straddle zero: the union already holds it, and nothing is widened
    expect(frameDomains([layer('a', 'line', { y: ['number', [-3, 8]] })], { y: { mode: 'shared', zero: false } })['y']).toMatchObject({ domain: [-3, 8] });
    // a zero policy never NARROWS: [40, 90] with zero reaches down, never up
    expect(frameDomains([layer('a', 'line', { y: ['number', [-90, -40]] })], { y: { mode: 'shared', zero: true } })['y']).toMatchObject({ domain: [-90, 0] });
  });

  it('the zero policy is quantitative only — a category order and a date range have no zero to reach for', () => {
    const frame = frameDomains([layer('a', 'bar', { x: ['date', ['2026-01-01']] , color: ['string', ['viral']] })]);
    expect(frame['x']).toMatchObject({ scale: 'temporal', domain: ['2026-01-01', '2026-01-01'] });
    expect(frame['color']).toMatchObject({ scale: 'categorical', domain: ['viral'] });
  });
});

describe('the layer-count lint is a sentence, never a refusal', () => {
  it('four layers on one frame draws; the fifth earns the lint, naming what to move', () => {
    const kinds = (n: number): FrameLayer[] => Array.from({ length: n }, (_, i) => layer(`l${i}`, 'line', { y: ['number', [i, i + 1]] }));
    expect(FRAME_LAYER_LINT).toBe(4);
    expect(frameLint(kinds(4))).toEqual([]);
    expect(frameLint(kinds(6))).toEqual(['6 layers on one frame — past 4 a reader cannot tell the marks apart; consider a frame of its own for "l4", "l5"']);
    // and the fold still ANSWERS for six: a lint says a picture is hard to read, never that it may not exist
    expect(frameDomains(kinds(6))['y']).toMatchObject({ domain: [0, 6] });
  });
});

describe('frameScaleOf — the type each scale kind folds from', () => {
  it('number → quantitative, date → temporal, string/boolean → categorical, unknown → nothing', () => {
    expect(frameScaleOf('number')).toBe('quantitative');
    expect(frameScaleOf('date')).toBe('temporal');
    expect(frameScaleOf('string')).toBe('categorical');
    expect(frameScaleOf('boolean')).toBe('categorical');
    expect(frameScaleOf('unknown')).toBeUndefined();
  });

  it('the declaration type is inert data — a resolution round-trips through JSON unchanged', () => {
    const declared: Readonly<Record<string, ChannelResolution>> = { y: { mode: 'shared', domain: 'union', basis: 'rows', guide: 'merged', zero: true }, color: { mode: 'independent', guide: 'per-layer' } };
    expect(JSON.parse(JSON.stringify(declared))).toEqual(declared);
  });
});
