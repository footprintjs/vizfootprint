/**
 * predicate.test.ts — pins `resolvePredicateSQL`/`literalToSQL` against the
 * REAL Mosaic clause factories (not just the hand-derived comments in
 * predicate.ts), so a future `@uwdata/mosaic-core` upgrade that changes SQL
 * formatting fails THIS test before it silently desyncs the data seam from
 * L1/L2's own `predicateSQL`.
 */
import { describe, it, expect } from 'vitest';
import { clauseInterval, clausePoint } from '@uwdata/mosaic-core';
import { isClearedSQL, literalToSQL, matchesClause, resolvePredicateSQL } from './predicate.js';
import type { IntervalClause, MatchClause, PointClause, Row } from './types.js';

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
