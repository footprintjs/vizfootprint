/**
 * predicate.test.ts — pins `resolvePredicateSQL`/`literalToSQL` against the
 * REAL Mosaic clause factories (not just the hand-derived comments in
 * predicate.ts), so a future `@uwdata/mosaic-core` upgrade that changes SQL
 * formatting fails THIS test before it silently desyncs the data seam from
 * L1/L2's own `predicateSQL`.
 */
import { describe, it, expect } from 'vitest';
import { clauseInterval, clausePoint } from '@uwdata/mosaic-core';
import { and, literal, not, or } from '@uwdata/mosaic-sql';
import { isClearedSQL, literalToSQL, matchesClause, mosaicDescriptorSQL, resolvePredicateSQL } from './predicate.js';
import type { CellClause, IntervalClause, MatchClause, PointClause, Row } from './types.js';

/** The exact SQL string a real Mosaic clause resolves to — the ground truth. */
function realClauseSQL(kind: 'point' | 'interval', field: string, value: unknown): string {
  const clause =
    kind === 'point'
      ? clausePoint(field, value, { source: {} })
      : clauseInterval(field, value as [number, number] | null, { source: {} });
  return String(clause.predicate);
}

describe('resolvePredicateSQL — byte-identical to real Mosaic clause factories', () => {
  it('point: string / number / boolean values', () => {
    const cases: Array<{ field: string; value: unknown }> = [
      { field: 'category', value: 'Data' },
      { field: 'n', value: 5 },
      { field: 'b', value: true },
    ];
    for (const { field, value } of cases) {
      const clause: PointClause = { kind: 'point', field, value };
      expect(resolvePredicateSQL(clause)).toBe(realClauseSQL('point', field, value));
    }
  });

  it('point: null value resolves to IS NULL (not "cleared")', () => {
    const clause: PointClause = { kind: 'point', field: 'x', value: null };
    expect(resolvePredicateSQL(clause)).toBe(realClauseSQL('point', 'x', null));
    expect(resolvePredicateSQL(clause)).toBe('("x" IS NULL)');
  });

  it('point: undefined value resolves to the cleared descriptor, matching String(null)', () => {
    const clause: PointClause = { kind: 'point', field: 'x', value: undefined };
    expect(resolvePredicateSQL(clause)).toBe(realClauseSQL('point', 'x', undefined));
    expect(isClearedSQL(resolvePredicateSQL(clause))).toBe(true);
  });

  it('interval: [lo, hi] resolves to BETWEEN', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [10, 20] };
    expect(resolvePredicateSQL(clause)).toBe(realClauseSQL('interval', 'amount', [10, 20]));
    expect(resolvePredicateSQL(clause)).toBe('("amount" BETWEEN 10 AND 20)');
  });

  it('interval: null value is cleared, matching String(null)', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: null };
    expect(resolvePredicateSQL(clause)).toBe(realClauseSQL('interval', 'amount', null));
    expect(isClearedSQL(resolvePredicateSQL(clause))).toBe(true);
  });

  it('null clause (no filter at all) is the same cleared descriptor', () => {
    expect(resolvePredicateSQL(null)).toBe('null');
    expect(isClearedSQL(resolvePredicateSQL(null))).toBe(true);
  });

  it('string literal escapes an embedded single quote by doubling it', () => {
    const clause: PointClause = { kind: 'point', field: 'name', value: "O'Brien" };
    expect(resolvePredicateSQL(clause)).toBe(realClauseSQL('point', 'name', "O'Brien"));
  });

  it('identifier with an embedded double quote is escaped by doubling', () => {
    const clause: PointClause = { kind: 'point', field: 'weird"field', value: 1 };
    expect(resolvePredicateSQL(clause)).toBe('("weird""field" IN (1))');
  });

  it('match: this layer\'s own trivial IN-list — NOT Mosaic\'s clauseMatch', () => {
    const clause: MatchClause = { kind: 'match', field: 'category', values: ['Data', 'Analytics'] };
    expect(resolvePredicateSQL(clause)).toBe('("category" IN (\'Data\', \'Analytics\'))');
  });

  it('match: an empty values list is a real FALSE predicate, not "cleared"', () => {
    const clause: MatchClause = { kind: 'match', field: 'category', values: [] };
    expect(resolvePredicateSQL(clause)).toBe('(FALSE)');
    expect(isClearedSQL(resolvePredicateSQL(clause))).toBe(false);
  });
});

describe('literalToSQL — non-finite numbers and Dates', () => {
  it('NaN and Infinity render as NULL, matching literalToSQL.js', () => {
    expect(literalToSQL(Number.NaN)).toBe('NULL');
    expect(literalToSQL(Number.POSITIVE_INFINITY)).toBe('NULL');
  });

  it('a UTC-midnight Date renders as a DATE literal; anything else as epoch_ms', () => {
    const dateOnly = new Date(Date.UTC(2026, 6, 9));
    expect(literalToSQL(dateOnly)).toBe("DATE '2026-7-9'");
    const withTime = new Date(Date.UTC(2026, 6, 9, 3, 30));
    expect(literalToSQL(withTime)).toBe(`epoch_ms(${+withTime})`);
  });

  it('an unsupported literal type throws honestly rather than fabricating SQL', () => {
    expect(() => literalToSQL({ nested: true })).toThrow(TypeError);
  });
});

describe('matchesClause — the actual in-process filter, kept consistent with resolvePredicateSQL', () => {
  const rows: Row[] = [
    { category: 'Data', amount: 15, tag: null },
    { category: 'Analytics', amount: 25, tag: 'x' },
    { category: 'Data', amount: 5, tag: undefined },
  ];

  it('point IN matches by strict equality', () => {
    const clause: PointClause = { kind: 'point', field: 'category', value: 'Data' };
    expect(rows.filter((r) => matchesClause(r, clause))).toHaveLength(2);
  });

  it('point IS NULL matches both null and undefined (SQL NULL has no undefined)', () => {
    const clause: PointClause = { kind: 'point', field: 'tag', value: null };
    expect(rows.filter((r) => matchesClause(r, clause))).toHaveLength(2);
  });

  it('point cleared (undefined) matches every row', () => {
    const clause: PointClause = { kind: 'point', field: 'category', value: undefined };
    expect(rows.filter((r) => matchesClause(r, clause))).toHaveLength(3);
  });

  it('interval BETWEEN is inclusive on both ends', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [5, 15] };
    expect(rows.filter((r) => matchesClause(r, clause))).toHaveLength(2);
  });

  it('interval cleared (null) matches every row', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: null };
    expect(rows.filter((r) => matchesClause(r, clause))).toHaveLength(3);
  });

  it('match IN-list matches any listed value; empty list matches none', () => {
    const some: MatchClause = { kind: 'match', field: 'category', values: ['Analytics'] };
    expect(rows.filter((r) => matchesClause(r, some))).toHaveLength(1);
    const none: MatchClause = { kind: 'match', field: 'category', values: [] };
    expect(rows.filter((r) => matchesClause(r, none))).toHaveLength(0);
  });

  it('null clause (no filter) matches every row', () => {
    expect(rows.filter((r) => matchesClause(r, null))).toHaveLength(3);
  });
});

describe('date intervals — ISO-8601 STRING bounds (the time-series brush emission)', () => {
  const rows: Row[] = [
    { id: 'a', date: '2026-04-01', amount: 10 },
    { id: 'b', date: '2026-04-15', amount: 20 },
    { id: 'c', date: '2026-05-20', amount: 30 },
    { id: 'd', date: null, amount: 40 },
  ];
  const clause: IntervalClause = { kind: 'interval', field: 'date', value: ['2026-04-01', '2026-04-30'] };

  it('matchesClause: string BETWEEN is lexicographic (== chronological for ISO-8601), inclusive both ends', () => {
    const hits = rows.filter((r) => matchesClause(r, clause)).map((r) => r['id']);
    expect(hits).toEqual(['a', 'b']); // a sits ON the lower bound; c is past the upper; d is null
  });

  it('matchesClause: a string interval never matches a NUMERIC row value (no cross-type coercion)', () => {
    const c: IntervalClause = { kind: 'interval', field: 'amount', value: ['10', '30'] };
    expect(rows.filter((r) => matchesClause(r, c))).toHaveLength(0);
  });

  it('matchesClause: a NUMERIC interval never matches a string row value (the pre-fix behavior, preserved)', () => {
    const c: IntervalClause = { kind: 'interval', field: 'date', value: [0, 99999999999999] };
    expect(rows.filter((r) => matchesClause(r, c))).toHaveLength(0);
  });

  it('resolvePredicateSQL: string bounds render as SQL string LITERALS — a documented, deliberate divergence from Mosaic', () => {
    // Real Mosaic maps interval extents through `asNode` (ast.js:16-17 —
    // `isString(value) ? column(value) : asLiteral(value)`) inside `isBetween`
    // (operators.js:219-221), so a string extent renders as a quoted COLUMN
    // IDENTIFIER: ("date" BETWEEN "2026-04-01" AND "2026-04-30") — a reference
    // to a nonexistent column, not a comparable value (Mosaic's extents are
    // meant to be numbers/Dates; strings fall outside its input domain).
    // Replicating that byte-for-byte would fabricate non-executable SQL, so
    // this seam renders honest single-quoted string literals instead.
    expect(realClauseSQL('interval', 'date', ['2026-04-01', '2026-04-30'])).toBe(
      '("date" BETWEEN "2026-04-01" AND "2026-04-30")', // the Mosaic column-ref rendering we deliberately do NOT copy
    );
    expect(resolvePredicateSQL(clause)).toBe(`("date" BETWEEN '2026-04-01' AND '2026-04-30')`);
  });

  it('a full-timestamp ISO interval evaluates the same way (uniform format, both sides)', () => {
    const tsRows: Row[] = [
      { id: 'x', at: '2026-04-01T08:30:00.000Z' },
      { id: 'y', at: '2026-04-01T18:00:00.000Z' },
    ];
    const c: IntervalClause = { kind: 'interval', field: 'at', value: ['2026-04-01T00:00:00.000Z', '2026-04-01T12:00:00.000Z'] };
    expect(tsRows.filter((r) => matchesClause(r, c)).map((r) => r['id'])).toEqual(['x']);
  });
});

describe('half-open intervals — one bound null (FILTER-1: "no upper/lower bound")', () => {
  const numRows: Row[] = [
    { id: 'a', amount: 100 },
    { id: 'b', amount: 150 },
    { id: 'c', amount: 200 },
    { id: 'd', amount: 'not-a-number' },
  ];
  const dateRows: Row[] = [
    { id: 'x', date: '2026-04-01' },
    { id: 'y', date: '2026-05-15' },
    { id: 'z', date: '2026-06-01' },
    { id: 'w', date: 999 }, // non-string row value — no cross-type coercion
  ];

  it('resolvePredicateSQL: [lo, null] renders a one-sided >= comparison, never a fabricated hi', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [150, null] };
    expect(resolvePredicateSQL(clause)).toBe('("amount" >= 150)');
  });

  it('resolvePredicateSQL: [null, hi] renders a one-sided <= comparison, never a fabricated lo', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [null, 150] };
    expect(resolvePredicateSQL(clause)).toBe('("amount" <= 150)');
  });

  it('resolvePredicateSQL: a half-open DATE bound renders the string literal, not a bare BETWEEN', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'date', value: [null, '2026-05-31'] };
    expect(resolvePredicateSQL(clause)).toBe(`("date" <= '2026-05-31')`);
  });

  it('matchesClause: [150, null] ("150 or more") matches every row >= 150, never fabricates a ceiling', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [150, null] };
    expect(numRows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['b', 'c']);
  });

  it('matchesClause: [null, 150] ("up to 150") matches every row <= 150, never fabricates a floor', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [null, 150] };
    expect(numRows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['a', 'b']);
  });

  it('matchesClause: a half-open interval still rejects a non-numeric row value', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [150, null] };
    expect(matchesClause({ amount: 'not-a-number' }, clause)).toBe(false);
  });

  it('matchesClause: a half-open DATE lower bound ("from May onward") — lexicographic == chronological', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'date', value: ['2026-05-01', null] };
    expect(dateRows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['y', 'z']);
  });

  it('matchesClause: a half-open DATE upper bound ("through May") never matches a non-string row value', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'date', value: [null, '2026-05-31'] };
    expect(dateRows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['x', 'y']);
  });
});

describe('the D30 compound cell — SQL descriptor + in-process evaluation', () => {
  const rows: Row[] = [
    { id: 'a', price: 120, category: 'Formal', date: '2026-05-10' },
    { id: 'b', price: 120, category: 'Casual', date: '2026-05-11' },
    { id: 'c', price: 200, category: 'Formal', date: '2026-06-01' },
    { id: 'd', price: 90, category: null, date: '2026-04-01' },
  ];

  it('resolvePredicateSQL: interval × point renders the AND of both sides, byte-identical to the REAL composed clause', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [[100, 150], 'Formal'] };
    // ground truth: the two real Mosaic factories composed with the real `and`
    // — exactly what the Mosaic adapter (src/mosaic/mosaicSelection.ts) builds
    // for a `CauseClauseSpec` (src/selection/types.ts) and L1 records
    const real = String(
      and(
        clauseInterval('price', [100, 150], { source: {} }).predicate!,
        clausePoint('category', 'Formal', { source: {} }).predicate!,
      ),
    );
    expect(resolvePredicateSQL(clause)).toBe(real);
    expect(resolvePredicateSQL(clause)).toBe(`(("price" BETWEEN 100 AND 150) AND ("category" IN ('Formal')))`);
  });

  it('resolvePredicateSQL: point × point and a null point side (IS NULL) match the real composed clause too', () => {
    const pp: CellClause = { kind: 'cell', fields: ['category', 'price'], value: ['Formal', 120] };
    expect(resolvePredicateSQL(pp)).toBe(
      String(and(clausePoint('category', 'Formal', { source: {} }).predicate!, clausePoint('price', 120, { source: {} }).predicate!)),
    );
    const withNull: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [[100, 150], null] };
    expect(resolvePredicateSQL(withNull)).toBe(`(("price" BETWEEN 100 AND 150) AND ("category" IS NULL))`);
  });

  it('resolvePredicateSQL: a HALF-OPEN side reuses the honest one-sided rendering (the documented divergence)', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [[150, null], 'Formal'] };
    expect(resolvePredicateSQL(clause)).toBe(`(("price" >= 150) AND ("category" IN ('Formal')))`);
  });

  it('resolvePredicateSQL: a cleared cell (value null) is the same "null" descriptor as every cleared clause', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: null };
    expect(resolvePredicateSQL(clause)).toBe('null');
    expect(isClearedSQL(resolvePredicateSQL(clause))).toBe(true);
  });

  it('matchesClause: interval × point keeps only rows satisfying BOTH sides (the AND)', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [[100, 150], 'Formal'] };
    expect(rows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['a']);
  });

  it('matchesClause: a cleared cell matches every row', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: null };
    expect(rows.filter((r) => matchesClause(r, clause)).length).toBe(rows.length);
  });

  it('matchesClause: a null point side means IS NULL (row value null/undefined), never "no constraint"', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [[0, 500], null] };
    expect(rows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['d']);
  });

  it('matchesClause: a date-string interval side rides the ISO rail (lexicographic == chronological), no coercion', () => {
    const clause: CellClause = { kind: 'cell', fields: ['date', 'category'], value: [['2026-05-01', '2026-05-31'], 'Casual'] };
    expect(rows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['b']);
  });

  it('matchesClause: a half-open interval side only tests the present bound', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [[150, null], 'Formal'] };
    expect(rows.filter((r) => matchesClause(r, clause)).map((r) => r['id'])).toEqual(['c']);
  });

  it('matchesClause: no cross-type coercion on either side (a numeric side never matches a string cell)', () => {
    const clause: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [[100, 150], 'Formal'] };
    expect(matchesClause({ price: '120', category: 'Formal' }, clause)).toBe(false);
  });
});

describe('match — exclude flips the IN-list to NOT IN (SET-1)', () => {
  const row: Row = { category: 'Data' };
  it('keep: a listed value matches, an unlisted one does not; an empty keep-list matches NOTHING', () => {
    expect(matchesClause(row, { kind: 'match', field: 'category', values: ['Data', 'Ops'] })).toBe(true);
    expect(matchesClause(row, { kind: 'match', field: 'category', values: ['Ops'] })).toBe(false);
    expect(matchesClause(row, { kind: 'match', field: 'category', values: [] })).toBe(false);
  });
  it('exclude: a listed value is dropped, an unlisted one kept; an empty exclude-list keeps EVERYTHING', () => {
    expect(matchesClause(row, { kind: 'match', field: 'category', values: ['Data'], exclude: true })).toBe(false);
    expect(matchesClause(row, { kind: 'match', field: 'category', values: ['Ops'], exclude: true })).toBe(true);
    expect(matchesClause(row, { kind: 'match', field: 'category', values: [], exclude: true })).toBe(true);
  });
  it('the SQL descriptor says NOT IN for exclude, and TRUE for an empty exclude-list', () => {
    expect(resolvePredicateSQL({ kind: 'match', field: 'category', values: ['Data', 'Ops'], exclude: true })).toBe(`("category" NOT IN ('Data', 'Ops'))`);
    expect(resolvePredicateSQL({ kind: 'match', field: 'category', values: [], exclude: true })).toBe('(TRUE)');
    expect(resolvePredicateSQL({ kind: 'match', field: 'category', values: [] })).toBe('(FALSE)');
  });
});

// ── mosaicDescriptorSQL — PARITY with the real factories, every kind × shape a CauseClauseSpec carries ──
//
// The builtin selection port renders `CommitRecord.predicateSQL` through this
// function; the Mosaic adapter renders it as `String(clause.predicate)` of the
// REAL clause. The two logs must be byte-identical, so every shape below is
// built BOTH ways and compared — the real side composed exactly as the adapter
// composes it (the factories, then `and` / `or` / `not` / `literal(false)`).
describe('mosaicDescriptorSQL — byte-identical to the real Mosaic clause for every kind × shape', () => {
  const src = { source: {} };
  const realPoint = (field: string, value: unknown) => String(clausePoint(field, value, src).predicate);
  const realInterval = (field: string, value: unknown) => String(clauseInterval(field, value as never, src).predicate);
  const realSide = (field: string, side: unknown) =>
    (Array.isArray(side) ? clauseInterval(field, side as never, src) : clausePoint(field, side, src)).predicate!;
  const realCell = (fields: readonly [string, string], value: readonly [unknown, unknown] | null) =>
    value === null ? String(null) : String(and(realSide(fields[0], value[0]), realSide(fields[1], value[1])));
  const realMatch = (field: string, value: { values: unknown[]; exclude?: boolean } | null) => {
    if (value === null) return String(null);
    const arms = value.values.map((v) => clausePoint(field, v, src).predicate!);
    const inList = arms.length === 0 ? literal(false) : arms.length === 1 ? arms[0]! : or(...arms);
    return String(value.exclude === true ? not(inList) : inList);
  };

  it('point: string / quoted string / number / both booleans / null (IS NULL) / undefined (cleared) / Date / timestamp / NaN / quoted and dotted identifiers / the coerced literals', () => {
    const shapes: Array<[string, unknown]> = [
      ['category', 'Data'],
      ['name', "O'Brien"],
      ['n', 5],
      ['b', true],
      ['b', false],
      ['x', null],
      ['x', undefined],
      ['d', new Date(Date.UTC(2026, 3, 1))],
      ['d', new Date(Date.UTC(2026, 3, 1, 5))],
      ['d', new Date(Number.NaN)],
      ['n', Number.NaN],
      ['weird"field', 1],
      ['a.b', 1],
      // Mosaic's string-coercion fallback — the byte the analysis / chart lanes have always persisted
      ['pValue', { id: 'a1', table: 'data', pValue: 0.03 }],
      ['x', [1, 2]],
      ['x', 10n],
      ['x', /a+/],
      ['x', new Map([[1, 2]])],
    ];
    for (const [field, value] of shapes) {
      expect(mosaicDescriptorSQL('point', field, value), `point ${field} = ${String(value)}`).toBe(realPoint(field, value));
    }
    expect(mosaicDescriptorSQL('point', 'pValue', { id: 'a1' })).toBe('("pValue" IN ([object Object]))');
  });

  it('interval: closed / half-open both ways / string / half-open string both ways / Date / cleared by null AND by undefined', () => {
    const shapes: Array<[string, unknown]> = [
      ['amount', [10, 20]],
      ['amount', [150, null]],
      ['amount', [null, 150]],
      ['date', ['2026-04-01', '2026-04-30']],
      ['date', ['2026-04-01', null]],
      ['date', [null, '2026-04-30']],
      ['d', [new Date(Date.UTC(2026, 3, 1)), new Date(Date.UTC(2026, 3, 30))]],
      ['amount', null],
      ['amount', undefined],
    ];
    for (const [field, value] of shapes) {
      expect(mosaicDescriptorSQL('interval', field, value), `interval ${field} = ${JSON.stringify(value)}`).toBe(realInterval(field, value));
    }
  });

  it('the odd renderings are ALSO pinned by value, so a Mosaic upgrade that changes them fails here by name', () => {
    expect(mosaicDescriptorSQL('interval', 'amount', [150, null])).toBe('("amount" BETWEEN 150 AND NULL)');
    expect(mosaicDescriptorSQL('interval', 'amount', [null, 150])).toBe('("amount" BETWEEN NULL AND 150)');
    expect(mosaicDescriptorSQL('interval', 'date', ['2026-04-01', '2026-04-30'])).toBe('("date" BETWEEN "2026-04-01" AND "2026-04-30")');
    expect(mosaicDescriptorSQL('interval', 'date', ['2026-04-01', null])).toBe('("date" BETWEEN "2026-04-01" AND NULL)');
  });

  it('cell: interval × point / point × point / interval × interval / half-open side / string-interval side / null point side / boolean side / cleared', () => {
    const shapes: Array<[readonly [string, string], readonly [unknown, unknown] | null]> = [
      [['price', 'category'], [[100, 150], 'Formal']],
      [['a', 'b'], ['x', 7]],
      [['u', 'v'], [[1, 2], [3, 4]]],
      [['price', 'category'], [[150, null], 'Formal']],
      [['date', 'category'], [['2026-05-01', '2026-05-31'], 'Casual']],
      [['price', 'region'], [[10, 20], null]],
      [['flag', 'n'], [true, 1]],
      [['price', 'category'], null],
    ];
    for (const [fields, value] of shapes) {
      expect(mosaicDescriptorSQL('cell', fields, value), `cell ${fields.join('×')} = ${JSON.stringify(value)}`).toBe(realCell(fields, value));
    }
  });

  it('match: one / two / three values, a null entry (IS NULL), NaN, empty keep, empty exclude, exclude one / two, cleared', () => {
    const shapes: Array<{ values: unknown[]; exclude?: boolean } | null> = [
      { values: ['Formal'] },
      { values: ['Formal', 'Party'] },
      { values: ['Formal', 'Party', 'Casual'] },
      { values: ['Formal', null] },
      { values: [Number.NaN] },
      { values: [] },
      { values: [], exclude: true },
      { values: ['Formal'], exclude: true },
      { values: ['Formal', 'Party'], exclude: true },
      null,
    ];
    for (const value of shapes) {
      expect(mosaicDescriptorSQL('match', 'category', value), `match ${JSON.stringify(value)}`).toBe(realMatch('category', value));
    }
  });

  it('a cleared clause of any kind is the one "null" descriptor isClearedSQL recognises', () => {
    expect(isClearedSQL(mosaicDescriptorSQL('point', 'x', undefined))).toBe(true);
    expect(isClearedSQL(mosaicDescriptorSQL('interval', 'x', null))).toBe(true);
    expect(isClearedSQL(mosaicDescriptorSQL('cell', ['x', 'y'], null))).toBe(true);
    expect(isClearedSQL(mosaicDescriptorSQL('match', 'x', null))).toBe(true);
  });

  it('refuses with a TypeError the shapes the real builders refuse — never a fabricated byte', () => {
    // a value INSIDE a compound that would render "cleared" — the builders refuse a half-empty AND / OR
    expect(() => mosaicDescriptorSQL('cell', ['price', 'category'], [[10, 20], undefined])).toThrow(/cell side must be concrete/);
    expect(() => mosaicDescriptorSQL('match', 'category', { values: [undefined] })).toThrow(/match value must be concrete/);
    // not a pair: the real `isBetween` would call `.map` on a number and the cell composer would index into a string
    expect(() => mosaicDescriptorSQL('interval', 'amount', 42)).toThrow(TypeError);
    expect(() => mosaicDescriptorSQL('interval', 'amount', [1, 2, 3])).toThrow(/must be a \[lo, hi\] pair/);
    expect(() => mosaicDescriptorSQL('cell', ['x', 'y'], 'not-a-pair')).toThrow(/\[x side, y side\] pair/);
    expect(() => mosaicDescriptorSQL('cell', ['x', 'y'], [1, 2, 3])).toThrow(TypeError);
    // a match body without a list, and a body that is not an object at all
    expect(() => mosaicDescriptorSQL('match', 'category', {})).toThrow(/\{ values, exclude\? \}/);
    expect(() => mosaicDescriptorSQL('match', 'category', 'Formal')).toThrow(TypeError);
    // a value string coercion refuses — the real factory throws the same TypeError, so the refusal is Mosaic's own
    expect(() => realPoint('x', Symbol('s'))).toThrow(TypeError);
    expect(() => mosaicDescriptorSQL('point', 'x', Symbol('s'))).toThrow(TypeError);
    // and an interval bound goes through the same coercion (asNode → literal), objects included
    expect(mosaicDescriptorSQL('interval', 'x', [{ lo: 1 }, 2])).toBe(realInterval('x', [{ lo: 1 }, 2]));
  });
});
