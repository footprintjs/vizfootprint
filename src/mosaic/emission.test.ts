import { describe, it, expect } from 'vitest';
import { Selection } from '@uwdata/mosaic-core';
import { SourceRegistry, causeOf, causeClauseFromEmission } from './index.js';
import type { ChartEmission } from './index.js';
import type { Cause } from '../cause/index.js';

const cause = (over: Partial<Cause> = {}): Cause => ({
  requestedBy: 'user',
  computedBy: 'user',
  ...over,
});

describe('causeClauseFromEmission — R3 symmetric emit (chart builds no clause)', () => {
  it('turns a point ChartEmission into a real cause-tagged clause', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const emission: ChartEmission = { rawValue: 'Data', encoding: { kind: 'point', field: 'category' } };

    const clause = causeClauseFromEmission(emission, { source: a, cause: cause({ intent: 'pick Data' }) });

    expect(clause.source).toBe(a);
    expect(String(clause.predicate)).toContain('category');
    expect(clause.value).toBe('Data');
    expect(causeOf(clause)).toEqual({ requestedBy: 'user', computedBy: 'user', intent: 'pick Data' });
  });

  it('turns an interval ChartEmission into a real cause-tagged clause', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'agent' });
    const emission: ChartEmission = { rawValue: [10, 20], encoding: { kind: 'interval', field: 'amount' } };

    const clause = causeClauseFromEmission(emission, { source: a, cause: cause({ computedBy: 'agent' }) });

    expect(String(clause.predicate)).toContain('amount');
    expect(clause.value).toEqual([10, 20]);
    expect(clause.meta.type).toBe('interval');
  });

  it('applies onto a real Selection identically to a hand-built causeClause (no chart-side shortcut)', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const sel = Selection.crossfilter();
    const emission: ChartEmission = { rawValue: [5, 9], encoding: { kind: 'interval', field: 'x' } };

    const clause = causeClauseFromEmission(emission, { source: a, cause: cause() });
    sel.update(clause);

    expect(sel.clauses[0]!.value).toEqual([5, 9]);
    expect(causeOf(sel.clauses[0]!)).toEqual(cause());
  });

  it('defaults clients to [source] just like causeClause (cross-filter self-exclusion still works)', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const emission: ChartEmission = { rawValue: 1, encoding: { kind: 'point', field: 'x' } };
    const clause = causeClauseFromEmission(emission, { source: a, cause: cause() });
    expect(clause.clients?.has(a)).toBe(true);
  });

  it('type-enforces the emission shape: an object carrying clause-building fields is rejected', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });

    // A chart cannot smuggle a `source`/`predicate`/`meta` into an emission —
    // excess-property checking on the object literal rejects it at compile
    // time (tsc --noEmit fails without the @ts-expect-error below).
    const badEmission: ChartEmission = {
      rawValue: 1,
      encoding: { kind: 'point', field: 'x' },
      // @ts-expect-error emissions may not carry a `source` — only rawValue+encoding
      source: a,
    };
    // still runtime-safe: extra keys are simply ignored by the builder.
    const clause = causeClauseFromEmission(badEmission, { source: a, cause: cause() });
    expect(clause.value).toBe(1);
  });

  it('type-enforces interval rawValue as DATA-space [lo,hi]|null, not an arbitrary value', () => {
    // @ts-expect-error an interval emission's rawValue must be [number,number]|null
    const bad: ChartEmission = { rawValue: 'not-an-interval', encoding: { kind: 'interval', field: 'x' } };
    void bad;
  });

  // ── D29: the compound CELL emission (one heatmap-cell gesture, TWO fields) ──

  it('turns a cell ChartEmission into ONE real cause-tagged compound clause (AND of both sides)', () => {
    const reg = new SourceRegistry();
    const h = reg.register('heatmap', { actor: 'user' });
    const emission: ChartEmission = {
      rawValue: [[100, 150], 'Formal'],
      encoding: { kind: 'cell', fields: ['price', 'category'] },
    };

    const clause = causeClauseFromEmission(emission, { source: h, cause: cause({ intent: 'click the 100–150 × Formal cell' }) });

    expect(clause.source).toBe(h);
    expect(clause.meta.type).toBe('cell');
    expect(clause.value).toEqual([[100, 150], 'Formal']);
    // the predicate is the AND of both sides — real Mosaic factory output composed with the real `and`
    expect(String(clause.predicate)).toBe(`(("price" BETWEEN 100 AND 150) AND ("category" IN ('Formal')))`);
    expect(causeOf(clause)).toEqual({ requestedBy: 'user', computedBy: 'user', intent: 'click the 100–150 × Formal cell' });
  });

  it('a cleared cell emission (rawValue null) builds a no-predicate clause, like a cleared interval', () => {
    const reg = new SourceRegistry();
    const h = reg.register('heatmap', { actor: 'user' });
    const emission: ChartEmission = { rawValue: null, encoding: { kind: 'cell', fields: ['price', 'category'] } };
    const clause = causeClauseFromEmission(emission, { source: h, cause: cause() });
    expect(clause.predicate).toBeNull();
    expect(String(clause.predicate)).toBe('null'); // the exact descriptor L1 records for a cleared clause
  });

  it('applies a cell clause onto a real Selection (the crossfilter carries the compound as one clause)', () => {
    const reg = new SourceRegistry();
    const h = reg.register('heatmap', { actor: 'user' });
    const sel = Selection.crossfilter();
    const clause = causeClauseFromEmission(
      { rawValue: [[5, 9], null], encoding: { kind: 'cell', fields: ['x', 'label'] } },
      { source: h, cause: cause() },
    );
    sel.update(clause);
    expect(sel.clauses.length).toBe(1); // ONE gesture = ONE clause, never two
    expect(sel.clauses[0]!.value).toEqual([[5, 9], null]);
    // a null POINT side is a real IS NULL constraint, not a cleared side
    expect(String(sel.clauses[0]!.predicate)).toBe(`(("x" BETWEEN 5 AND 9) AND ("label" IS NULL))`);
  });

  it('type-enforces the cell shape: exactly two fields, and no clause-building keys ride along', () => {
    // @ts-expect-error a cell encoding needs exactly TWO fields
    const oneField: ChartEmission = { rawValue: [[0, 1], 'a'], encoding: { kind: 'cell', fields: ['x'] } };
    void oneField;
    const okButSmuggling: ChartEmission = {
      rawValue: [[0, 1], 'a'],
      encoding: { kind: 'cell', fields: ['x', 'y'] },
      // @ts-expect-error emissions may not carry a `source` — only rawValue+encoding (R3, the cell arm too)
      source: {},
    };
    void okButSmuggling;
  });
});

describe('R5 (strengthened) — emissions are DATA-space, so clause-building is viewport-independent', () => {
  /**
   * A "viewport" here stands for whatever pixel<->data mapping a chart
   * happens to use while rendering (canvas width, zoom, DPI, a d3/Observable
   * Plot scale — vizfootprint depends on none of them). The chart resolves a
   * gesture to DATA space using its OWN viewport BEFORE it ever calls into
   * this layer; only the resolved `rawValue` crosses the boundary. Two
   * different viewports that happen to resolve to the same data value must
   * therefore produce byte-identical clauses — because nothing about the
   * viewport (pixel range, scale, domain) is representable in a
   * `ChartEmission` in the first place.
   */
  interface Viewport {
    readonly widthPx: number;
    readonly domain: readonly [number, number];
    toData(px: readonly [number, number]): [number, number];
  }
  const makeViewport = (widthPx: number, domain: readonly [number, number]): Viewport => ({
    widthPx,
    domain,
    toData([loPx, hiPx]) {
      const [dMin, dMax] = domain;
      const scale = (dMax - dMin) / widthPx;
      return [dMin + loPx * scale, dMin + hiPx * scale];
    },
  });

  it('two different viewports resolving to the same data value build byte-identical clauses', () => {
    const narrow = makeViewport(400, [0, 100]); // a 400px-wide chart
    const wide = makeViewport(800, [0, 100]); // the SAME chart, rendered 2x wider (e.g. a resize/zoom)

    const rawFromNarrow = narrow.toData([40, 80]); // drag pixels 40..80
    const rawFromWide = wide.toData([80, 160]); // DIFFERENT pixels, SAME data window

    expect(rawFromNarrow).toEqual([10, 20]);
    expect(rawFromWide).toEqual([10, 20]);

    const reg = new SourceRegistry();
    const a = reg.register('brush', { actor: 'user' });
    const c = cause({ intent: 'brush amount' });

    const clauseFromNarrow = causeClauseFromEmission(
      { rawValue: rawFromNarrow, encoding: { kind: 'interval', field: 'amount' } },
      { source: a, cause: c },
    );
    const clauseFromWide = causeClauseFromEmission(
      { rawValue: rawFromWide, encoding: { kind: 'interval', field: 'amount' } },
      { source: a, cause: c },
    );

    // identical resolved state — the viewport never reached the clause.
    expect(clauseFromNarrow.value).toEqual(clauseFromWide.value);
    expect(String(clauseFromNarrow.predicate)).toBe(String(clauseFromWide.predicate));
  });
});

describe('vizfootprint/mosaic barrel — "chart never builds clauses" (no raw factory leak)', () => {
  it('does not export Mosaic\'s own clause factories or a way to fabricate a clause without a cause', async () => {
    const barrel = await import('./index.js');
    const exportedNames = Object.keys(barrel).sort();
    // Only identity (SourceRegistry), the two clause builders (causeClause,
    // causeClauseFromEmission), and causeOf are runtime-reachable. In
    // particular `clausePoint`/`clauseInterval` (Mosaic's raw, cause-less
    // factories) are never re-exported here.
    expect(exportedNames).toEqual(
      ['SourceRegistry', 'SourceRegistryError', 'causeClause', 'causeClauseFromEmission', 'causeOf'].sort(),
    );
  });
});
