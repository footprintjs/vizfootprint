/**
 * The spec gate, branch by branch — every refusal is typed and worded; the
 * transforms path is ok:true (the HOST refuses at bind, specGate.ts header).
 */
import { describe, it, expect } from 'vitest';
import type { TopLevelSpec } from 'vega-lite';
import { validateVegaLiteSpec, VegaLiteSpecError } from './specGate.js';

/** A minimal valid single-view spec to mutate from. */
function base(overrides: Record<string, unknown> = {}): TopLevelSpec {
  return {
    mark: 'circle',
    params: [{ name: 'b', select: { type: 'interval', encodings: ['x'] } }],
    encoding: {
      x: { field: 'price', type: 'quantitative' },
      y: { field: 'rating', type: 'quantitative' },
    },
    ...overrides,
  } as unknown as TopLevelSpec;
}

function issuesOf(spec: TopLevelSpec): string[] {
  const res = validateVegaLiteSpec(spec);
  expect(res.ok).toBe(false);
  return res.ok ? [] : res.issues.map((i) => i.detail);
}

describe('multi-view composition and mark', () => {
  it.each(['facet', 'repeat', 'layer', 'concat', 'hconcat', 'vconcat', 'spec'])(
    'a %s spec is refused as unsupported-in-bridge-v1',
    (key) => {
      const res = validateVegaLiteSpec({ [key]: {}, mark: 'circle' } as unknown as TopLevelSpec);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues[0]!.code).toBe('unsupported-in-bridge-v1');
        expect(res.issues[0]!.detail).toContain(key);
        expect(res.issues[0]!.detail).toContain('multi-view');
      }
    },
  );

  it('a spec with no mark is refused', () => {
    expect(issuesOf({} as TopLevelSpec)[0]).toContain('no mark');
  });
});

describe('internal transforms — recorded for the hello, never silently stripped', () => {
  it('a transform array is collected by op name (unknown entries report as "transform")', () => {
    const res = validateVegaLiteSpec(
      base({ transform: [{ bin: true, field: 'price', as: 'b' }, { mystery: 1 }] }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.gated.internalTransforms).toEqual(['bin', 'transform']);
      expect(res.gated.brush).toBeNull(); // the transforms path resolves nothing else
    }
  });

  it('encoding-level bin/aggregate/timeUnit are transforms; bin:false is not', () => {
    const res = validateVegaLiteSpec(
      base({
        encoding: {
          x: { field: 'price', type: 'quantitative', bin: true },
          y: { field: 'price', type: 'quantitative', aggregate: 'mean' },
          color: { field: 'date', type: 'temporal', timeUnit: 'month' },
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.gated.internalTransforms).toEqual(['bin(x)', 'aggregate(y)', 'timeUnit(color)']);

    const clean = validateVegaLiteSpec(
      base({
        encoding: {
          x: { field: 'price', type: 'quantitative', bin: false },
          y: { field: 'rating', type: 'quantitative' },
        },
      }),
    );
    expect(clean.ok).toBe(true);
    if (clean.ok) expect(clean.gated.internalTransforms).toEqual([]);
  });
});

describe('the opacity channel is bridge-owned', () => {
  it('an opacity encoding is refused (the crossfilter highlight rides it)', () => {
    const spec = base();
    (spec as unknown as { encoding: Record<string, unknown> }).encoding['opacity'] = { value: 0.5 };
    expect(issuesOf(spec).some((d) => d.includes('opacity'))).toBe(true);
  });
});

describe('interval (brush) params', () => {
  it('the happy path resolves param, axis, field, and temporality', () => {
    const res = validateVegaLiteSpec(base());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.gated.brush).toEqual({ param: 'b', channel: 'x', field: 'price', temporal: false });
      expect(res.gated.point).toBeNull();
      expect(res.gated.navigate).toBeNull();
      expect(res.gated.notes).toEqual([]);
    }
  });

  it('a temporal axis marks the brush temporal (y works too)', () => {
    const res = validateVegaLiteSpec(
      base({
        params: [{ name: 'b', select: { type: 'interval', encodings: ['y'] } }],
        encoding: {
          x: { field: 'price', type: 'quantitative' },
          y: { field: 'date', type: 'temporal' },
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.gated.brush).toEqual({ param: 'b', channel: 'y', field: 'date', temporal: true });
  });

  it("the string shorthand select: 'interval' (a 2-axis default) is refused", () => {
    expect(issuesOf(base({ params: [{ name: 'b', select: 'interval' }] }))[0]).toContain("encodings: ['x'] or ['y']");
  });

  it("encodings: ['x','y'] (a 2-axis brush) is refused — not one clause", () => {
    expect(
      issuesOf(base({ params: [{ name: 'b', select: { type: 'interval', encodings: ['x', 'y'] } }] }))[0],
    ).toContain('2-axis');
  });

  it('a brushed axis with no field encoding is refused', () => {
    expect(
      issuesOf(
        base({ encoding: { x: { value: 3 }, y: { field: 'rating', type: 'quantitative' } } }),
      )[0],
    ).toContain('no field encoding');
  });

  it('a nominal brushed axis is refused (quantitative or temporal only)', () => {
    expect(
      issuesOf(
        base({ encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'rating', type: 'quantitative' } } }),
      )[0],
    ).toContain('nominal');
  });

  it('two interval params are refused (one live clause per view)', () => {
    const issues = issuesOf(
      base({
        params: [
          { name: 'b1', select: { type: 'interval', encodings: ['x'] } },
          { name: 'b2', select: { type: 'interval', encodings: ['y'] } },
        ],
      }),
    );
    expect(issues[0]).toContain('more than one interval param');
    expect(issues[0]).toContain('b1');
    expect(issues[0]).toContain('b2');
  });
});

describe('point params', () => {
  it("fields: ['category'] resolves the field", () => {
    const res = validateVegaLiteSpec(base({ params: [{ name: 'p', select: { type: 'point', fields: ['category'] } }] }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.gated.point).toEqual({ param: 'p', field: 'category' });
  });

  it("encodings: ['color'] resolves through the channel's field", () => {
    const res = validateVegaLiteSpec(
      base({
        params: [{ name: 'p', select: { type: 'point', encodings: ['color'] } }],
        encoding: {
          x: { field: 'price', type: 'quantitative' },
          color: { field: 'category', type: 'nominal' },
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.gated.point).toEqual({ param: 'p', field: 'category' });
  });

  it.each([
    ['the string shorthand (datum-key selection)', { name: 'p', select: 'point' }],
    ['no fields/encodings at all', { name: 'p', select: { type: 'point' } }],
    ['two fields (not one clause)', { name: 'p', select: { type: 'point', fields: ['a', 'b'] } }],
    ['an empty fields list', { name: 'p', select: { type: 'point', fields: [] } }],
    ['an encoded channel with no field', { name: 'p', select: { type: 'point', encodings: ['color'] } }],
  ])('%s is refused', (_label, param) => {
    expect(issuesOf(base({ params: [param] }))[0]).toContain('must name exactly one field');
  });

  it('two point params are refused', () => {
    expect(
      issuesOf(
        base({
          params: [
            { name: 'p1', select: { type: 'point', fields: ['category'] } },
            { name: 'p2', select: { type: 'point', fields: ['region'] } },
          ],
        }),
      )[0],
    ).toContain('more than one point param');
  });
});

describe("bind: 'scales' (pan/zoom → navigate) params", () => {
  it('resolves every positional field channel', () => {
    const res = validateVegaLiteSpec(
      base({
        params: [
          { name: 'b', select: { type: 'interval', encodings: ['x'] } },
          { name: 'grid', select: 'interval', bind: 'scales' },
        ],
        encoding: {
          x: { field: 'price', type: 'quantitative' },
          y: { field: 'date', type: 'temporal' },
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.gated.navigate).toEqual({
        param: 'grid',
        channels: [
          { channel: 'x', field: 'price', temporal: false },
          { channel: 'y', field: 'date', temporal: true },
        ],
      });
    }
  });

  it('two scales params are refused; one with no positional field is refused', () => {
    expect(
      issuesOf(
        base({
          params: [
            { name: 'g1', select: 'interval', bind: 'scales' },
            { name: 'g2', select: 'interval', bind: 'scales' },
          ],
        }),
      ).some((d) => d.includes("more than one bind:'scales'")),
    ).toBe(true);
    expect(
      issuesOf(
        base({ params: [{ name: 'g', select: 'interval', bind: 'scales' }], encoding: { color: { field: 'c', type: 'nominal' } } }),
      ).some((d) => d.includes('no positional field')),
    ).toBe(true);
  });
});

describe('the remaining honesty arms', () => {
  it('a variable param (no select) is inert and allowed', () => {
    const res = validateVegaLiteSpec(base({ params: [{ name: 'k', value: 5 }, { name: 'b', select: { type: 'interval', encodings: ['x'] } }] }));
    expect(res.ok).toBe(true);
  });

  it('an unknown select type is refused by name', () => {
    expect(issuesOf(base({ params: [{ name: 'w', select: { type: 'lasso' } }] }))[0]).toContain('lasso');
  });

  it('a param with no name at all resolves to an empty name, used verbatim (not "undefined")', () => {
    expect(issuesOf(base({ params: [{ select: { type: 'lasso' } }] }))[0]).toContain('the param ""');
  });

  it('a mute spec (no selection param) is refused — a mute chart is not a view', () => {
    expect(issuesOf(base({ params: [] }))[0]).toContain('mute chart');
    expect(issuesOf(base({ params: undefined }))[0]).toContain('mute chart');
  });

  it('inline data is noted (replaced by host rows), never silent', () => {
    const res = validateVegaLiteSpec(base({ data: { values: [{ price: 1 }] } }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.gated.notes[0]).toContain('replaced by host rows');
  });

  it('VegaLiteSpecError carries the typed issues and a joined message', () => {
    const res = validateVegaLiteSpec({ layer: [] } as unknown as TopLevelSpec);
    if (res.ok) throw new Error('unreachable');
    const err = new VegaLiteSpecError(res.issues);
    expect(err.name).toBe('VegaLiteSpecError');
    expect(err.issues).toEqual(res.issues);
    expect(err.message).toContain('multi-view');
  });
});
