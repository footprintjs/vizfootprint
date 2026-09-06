import { describe, expect, it } from 'vitest';
import { SourceRegistry, builtinSelection, causeClauseFromEmission, causeClauseSpecFromEmission, isRejection } from './index.js';
import type { CauseClause, ChartEmission } from './index.js';
import type { Cause } from '../cause/index.js';

const cause = (over: Partial<Cause> = {}): Cause => ({
  requestedBy: 'user',
  computedBy: 'user',
  ...over,
});

/** Mint on a fresh port and insist it minted — every emission below is a shape the port accepts. */
function minted(emission: ChartEmission, ctx: Parameters<typeof causeClauseFromEmission>[1]): CauseClause {
  const clause = causeClauseFromEmission(emission, ctx, builtinSelection());
  if (isRejection(clause)) throw new Error(`unexpected rejection: ${clause.reason}`);
  return clause;
}

describe('causeClauseSpecFromEmission — the ONE translation from {rawValue, encoding} to a spec', () => {
  it('reads each of the four encodings as its kind, carrying source, cause and clients through untouched', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const b = reg.register('B', { actor: 'agent' });
    const c = cause({ intent: 'x' });
    expect(causeClauseSpecFromEmission({ rawValue: 'Data', encoding: { kind: 'point', field: 'category' } }, { source: a, cause: c })).toEqual({
      kind: 'point', source: a, field: 'category', value: 'Data', cause: c, clients: undefined,
    });
    expect(causeClauseSpecFromEmission({ rawValue: [1, 2], encoding: { kind: 'interval', field: 'amount' } }, { source: a, cause: c, clients: [a, b] })).toEqual({
      kind: 'interval', source: a, field: 'amount', value: [1, 2], cause: c, clients: [a, b],
    });
    expect(causeClauseSpecFromEmission({ rawValue: [[1, 2], 'x'], encoding: { kind: 'cell', fields: ['u', 'v'] } }, { source: a, cause: c })).toEqual({
      kind: 'cell', source: a, fields: ['u', 'v'], value: [[1, 2], 'x'], cause: c, clients: undefined,
    });
    expect(causeClauseSpecFromEmission({ rawValue: { values: ['x'] }, encoding: { kind: 'match', field: 'f' } }, { source: a, cause: c })).toEqual({
      kind: 'match', source: a, field: 'f', value: { values: ['x'] }, cause: c, clients: undefined,
    });
  });
});

describe('causeClauseFromEmission — R3 symmetric emit (chart builds no clause)', () => {
  it('turns a point ChartEmission into a cause-tagged clause on the given port', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const emission: ChartEmission = { rawValue: 'Data', encoding: { kind: 'point', field: 'category' } };

    const clause = minted(emission, { source: a, cause: cause({ intent: 'pick Data' }) });

    expect(clause.source).toBe(a);
    expect(clause.predicateSQL).toBe(`("category" IN ('Data'))`);
    expect(clause.value).toBe('Data');
    expect(clause.meta.cause).toEqual({ requestedBy: 'user', computedBy: 'user', intent: 'pick Data' });
  });

  it('turns an interval ChartEmission into a cause-tagged clause', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'agent' });
    const emission: ChartEmission = { rawValue: [10, 20], encoding: { kind: 'interval', field: 'amount' } };

    const clause = minted(emission, { source: a, cause: cause({ computedBy: 'agent' }) });

    expect(clause.predicateSQL).toBe('("amount" BETWEEN 10 AND 20)');
    expect(clause.value).toEqual([10, 20]);
    expect(clause.meta.type).toBe('interval');
  });

  it('applies onto the port identically to a hand-built spec (no chart-side shortcut)', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const port = builtinSelection();
    const emission: ChartEmission = { rawValue: [5, 9], encoding: { kind: 'interval', field: 'x' } };

    const clause = causeClauseFromEmission(emission, { source: a, cause: cause() }, port);
    if (isRejection(clause)) throw new Error('unreachable');
    port.update(clause);

    expect(port.clauses()[0]!.value).toEqual([5, 9]);
    expect(port.clauses()[0]!.meta.cause).toEqual(cause());
    const byHand = port.clause({ kind: 'interval', source: a, field: 'x', value: [5, 9], cause: cause() });
    if (isRejection(byHand)) throw new Error('unreachable');
    expect(byHand.predicateSQL).toBe(clause.predicateSQL);
  });

  it('a rejection from the port comes back as the rejection, never a throw', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const emission: ChartEmission = { rawValue: Symbol('not a literal'), encoding: { kind: 'point', field: 'x' } };
    const answer = causeClauseFromEmission(emission, { source: a, cause: cause() }, builtinSelection());
    expect(isRejection(answer)).toBe(true);
    expect(isRejection(answer) && answer.reason).toBe('unsupported-shape');
  });

  it('defaults clients to [source] (cross-filter self-exclusion still works)', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const emission: ChartEmission = { rawValue: 1, encoding: { kind: 'point', field: 'x' } };
    const clause = minted(emission, { source: a, cause: cause() });
    expect(clause.clients.has(a)).toBe(true);
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
    // still runtime-safe: extra keys are simply ignored by the translation.
    const clause = minted(badEmission, { source: a, cause: cause() });
    expect(clause.value).toBe(1);
  });

  it('type-enforces interval rawValue as DATA-space [lo,hi]|null, not an arbitrary value', () => {
    // @ts-expect-error an interval emission's rawValue must be [number,number]|null
    const bad: ChartEmission = { rawValue: 'not-an-interval', encoding: { kind: 'interval', field: 'x' } };
    void bad;
  });

  // ── D30: the compound CELL emission (one heatmap-cell gesture, TWO fields) ──

  it('turns a cell ChartEmission into ONE cause-tagged compound clause (AND of both sides)', () => {
    const reg = new SourceRegistry();
    const h = reg.register('heatmap', { actor: 'user' });
    const emission: ChartEmission = {
      rawValue: [[100, 150], 'Formal'],
      encoding: { kind: 'cell', fields: ['price', 'category'] },
    };

    const clause = minted(emission, { source: h, cause: cause({ intent: 'click the 100–150 × Formal cell' }) });

    expect(clause.source).toBe(h);
    expect(clause.meta.type).toBe('cell');
    expect(clause.value).toEqual([[100, 150], 'Formal']);
    expect(clause.predicateSQL).toBe(`(("price" BETWEEN 100 AND 150) AND ("category" IN ('Formal')))`);
    expect(clause.meta.cause).toEqual({ requestedBy: 'user', computedBy: 'user', intent: 'click the 100–150 × Formal cell' });
  });

  it('a cleared cell emission (rawValue null) builds a no-predicate clause, like a cleared interval', () => {
    const reg = new SourceRegistry();
    const h = reg.register('heatmap', { actor: 'user' });
    const emission: ChartEmission = { rawValue: null, encoding: { kind: 'cell', fields: ['price', 'category'] } };
    const clause = minted(emission, { source: h, cause: cause() });
    expect(clause.predicateSQL).toBeNull();
    expect(String(clause.predicateSQL)).toBe('null'); // the exact descriptor L1 records for a cleared clause
  });

  it('applies a cell clause onto the port (the crossfilter carries the compound as one clause)', () => {
    const reg = new SourceRegistry();
    const h = reg.register('heatmap', { actor: 'user' });
    const port = builtinSelection();
    const clause = causeClauseFromEmission(
      { rawValue: [[5, 9], null], encoding: { kind: 'cell', fields: ['x', 'label'] } },
      { source: h, cause: cause() },
      port,
    );
    if (isRejection(clause)) throw new Error('unreachable');
    port.update(clause);
    expect(port.clauses().length).toBe(1); // ONE gesture = ONE clause, never two
    expect(port.clauses()[0]!.value).toEqual([[5, 9], null]);
    // a null POINT side is a real IS NULL constraint, not a cleared side
    expect(port.clauses()[0]!.predicateSQL).toBe(`(("x" BETWEEN 5 AND 9) AND ("label" IS NULL))`);
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

    const clauseFromNarrow = minted({ rawValue: rawFromNarrow, encoding: { kind: 'interval', field: 'amount' } }, { source: a, cause: c });
    const clauseFromWide = minted({ rawValue: rawFromWide, encoding: { kind: 'interval', field: 'amount' } }, { source: a, cause: c });

    // identical resolved state — the viewport never reached the clause.
    expect(clauseFromNarrow.value).toEqual(clauseFromWide.value);
    expect(clauseFromNarrow.predicateSQL).toBe(clauseFromWide.predicateSQL);
  });
});

describe('match emission (SET-1) — many values on one field, or null to clear', () => {
  it('lands a clause of type match whose predicate names every value; polarity rides the value', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const emission: ChartEmission = { rawValue: { values: ['Data', 'Ops'] }, encoding: { kind: 'match', field: 'category' } };
    const clause = minted(emission, { source: a, cause: cause({ intent: 'two categories' }) });
    expect(clause.meta.type).toBe('match');
    expect(clause.meta.cause.intent).toBe('two categories');
    expect(clause.predicateSQL).toBe(`(("category" IN ('Data')) OR ("category" IN ('Ops')))`);
    const excluded = minted({ rawValue: { values: ['Data'], exclude: true }, encoding: { kind: 'match', field: 'category' } }, { source: a, cause: cause() });
    expect(excluded.predicateSQL).toBe(`(NOT ("category" IN ('Data')))`);
  });
  it('a null rawValue is the cleared match — no predicate', () => {
    const reg = new SourceRegistry();
    const a = reg.register('A', { actor: 'user' });
    const clause = minted({ rawValue: null, encoding: { kind: 'match', field: 'category' } }, { source: a, cause: cause() });
    expect(clause.predicateSQL).toBeNull();
    expect(clause.meta.type).toBe('match');
  });
});
