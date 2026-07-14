/**
 * The PURE chart-spec shape gate (RP-3 / D28) — the single detection both the
 * governed `proposeChart` pipeline and the Vega-Lite bridge consume. Every
 * fact + every gate arm, with NO Vega-Lite import (the whole point).
 */
import { describe, it, expect } from 'vitest';
import { analyzeSpecShape, gateChartSpec, CHART_COMPOSITION_KEYS } from './specShapeGate.js';

/** A minimal single-view spec that passes every gate. */
function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mark: 'point',
    encoding: {
      x: { field: 'price', type: 'quantitative' },
      y: { field: 'rating', type: 'quantitative' },
    },
    ...overrides,
  };
}

describe('analyzeSpecShape — facts', () => {
  it.each([null, undefined, 42, 'chart', [1, 2]])('a non-object spec (%s) is not an object, all facts empty', (bad) => {
    const facts = analyzeSpecShape(bad);
    expect(facts.isObject).toBe(false);
    expect(facts.hasMark).toBe(false);
    expect(facts.composition).toEqual([]);
    expect(facts.transforms).toEqual([]);
    expect(facts.encodedFields).toEqual([]);
    expect(facts.hasOpacityEncoding).toBe(false);
    expect(facts.hasInlineData).toBe(false);
  });

  it('a clean single-view spec has a mark, its encoded fields, and no transforms/composition', () => {
    const facts = analyzeSpecShape(base());
    expect(facts.isObject).toBe(true);
    expect(facts.hasMark).toBe(true);
    expect(facts.composition).toEqual([]);
    expect(facts.transforms).toEqual([]);
    expect(facts.encodedFields).toEqual(['price', 'rating']);
  });

  it.each([...CHART_COMPOSITION_KEYS])('composition key %s is detected', (key) => {
    expect(analyzeSpecShape({ [key]: {}, mark: 'point' }).composition).toEqual([key]);
  });

  it('a transform array is detected by op name; a non-record / unknown entry reports as "transform"', () => {
    const facts = analyzeSpecShape(base({ transform: [{ bin: true }, { mystery: 1 }, 'nope'] }));
    expect(facts.transforms).toEqual([{ op: 'bin' }, { op: 'transform' }, { op: 'transform' }]);
  });

  it('encoding-level bin/aggregate/timeUnit are transforms with a channel; bin:false is not', () => {
    const facts = analyzeSpecShape({
      mark: 'point',
      encoding: {
        x: { field: 'price', type: 'quantitative', bin: true },
        y: { field: 'price', type: 'quantitative', aggregate: 'mean' },
        color: { field: 'date', type: 'temporal', timeUnit: 'month' },
      },
    });
    expect(facts.transforms).toEqual([
      { op: 'bin', channel: 'x' },
      { op: 'aggregate', channel: 'y' },
      { op: 'timeUnit', channel: 'color' },
    ]);
    const clean = analyzeSpecShape(base({ encoding: { x: { field: 'price', type: 'quantitative', bin: false } } }));
    expect(clean.transforms).toEqual([]);
  });

  it('encodedFields dedupes and skips non-record / field-less channels', () => {
    const facts = analyzeSpecShape({
      mark: 'point',
      encoding: {
        x: { field: 'price', type: 'quantitative' },
        y: { field: 'price', type: 'quantitative' }, // duplicate field → deduped
        size: { value: 5 }, // no field
        color: 'nope', // non-record channel def → skipped
      },
    });
    expect(facts.encodedFields).toEqual(['price']);
  });

  it('opacity encoding and inline data are flagged; a non-record encoding is ignored', () => {
    expect(analyzeSpecShape(base({ encoding: { opacity: { value: 0.5 } } })).hasOpacityEncoding).toBe(true);
    expect(analyzeSpecShape(base()).hasOpacityEncoding).toBe(false);
    expect(analyzeSpecShape(base({ data: { values: [] } })).hasInlineData).toBe(true);
    expect(analyzeSpecShape({ mark: 'point', encoding: 'nope' }).encodedFields).toEqual([]);
  });
});

describe('gateChartSpec — the governed pipeline verdict', () => {
  it('a clean single-view spec passes and returns the facts', () => {
    const v = gateChartSpec(base());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.facts.encodedFields).toEqual(['price', 'rating']);
  });

  it('a non-object spec is invalid-spec', () => {
    const v = gateChartSpec(null);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('invalid-spec');
      expect(v.detail).toContain('plain JSON object');
    }
  });

  it('composition is refused as unsupported-composition (before the mark check)', () => {
    const v = gateChartSpec({ layer: [], mark: 'point' });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('unsupported-composition');
      expect(v.detail).toContain('layer');
    }
  });

  it('a spec with no mark is invalid-spec', () => {
    const v = gateChartSpec({ encoding: { x: { field: 'price', type: 'quantitative' } } });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('invalid-spec');
      expect(v.detail).toContain('no mark');
    }
  });

  it('a transform-carrying spec is transforms-not-owned, naming array + encoding ops', () => {
    const v = gateChartSpec(base({ transform: [{ aggregate: [] }], encoding: { x: { field: 'price', type: 'quantitative', bin: true } } }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('transforms-not-owned');
      expect(v.detail).toContain('aggregate'); // the transform-array op (no channel)
      expect(v.detail).toContain('bin(x)'); // the encoding-level op (with channel)
      expect(v.detail).toContain('host owns');
    }
  });
});
