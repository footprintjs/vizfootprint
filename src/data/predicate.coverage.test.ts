/**
 * predicate.coverage.test.ts — closes the remaining `literalToSQL`/`matchesClause`
 * gaps predicate.test.ts leaves: `literalToSQL(null)`/`literalToSQL(undefined)`
 * (reached in production via a `match` clause's `values` list, which — unlike
 * a point/interval clause — has no null-safety pre-check before hitting the
 * shared literal renderer), an invalid Date, `literalToSQL(false)`, and an
 * interval clause matched against a non-numeric / NaN row value.
 */

import { describe, it, expect } from 'vitest';
import { literalToSQL, matchesClause, resolvePredicateSQL } from './predicate.js';
import type { IntervalClause, MatchClause, Row } from './types.js';

describe('literalToSQL — null / undefined (direct)', () => {
  it('null renders as NULL', () => {
    expect(literalToSQL(null)).toBe('NULL');
  });

  it('undefined ALSO renders as NULL (the `default` case, not the point/interval "cleared" spelling)', () => {
    expect(literalToSQL(undefined)).toBe('NULL');
  });
});

describe('literalToSQL — false (the boolean ternary\'s other arm)', () => {
  it('renders as FALSE', () => {
    expect(literalToSQL(false)).toBe('FALSE');
  });
});

describe('literalToSQL — an invalid Date', () => {
  it('renders as NULL (Number.isNaN(ts) guard), not a NaN-poisoned literal', () => {
    expect(literalToSQL(new Date('not-a-real-date'))).toBe('NULL');
  });
});

describe('a match clause with a null VALUE inside its list — the real production path to literalToSQL(null)', () => {
  it('resolves the null entry to NULL inside the IN-list', () => {
    const clause: MatchClause = { kind: 'match', field: 'tag', values: ['x', null] };
    expect(resolvePredicateSQL(clause)).toBe(`("tag" IN ('x', NULL))`);
  });
});

describe('matchesClause — interval against a non-numeric / NaN row value', () => {
  const clause: IntervalClause = { kind: 'interval', field: 'amount', value: [5, 15] };

  it('a string value never matches an interval (typeof guard)', () => {
    const row: Row = { amount: 'not-a-number' };
    expect(matchesClause(row, clause)).toBe(false);
  });

  it('a NaN value never matches an interval (Number.isNaN guard)', () => {
    const row: Row = { amount: Number.NaN };
    expect(matchesClause(row, clause)).toBe(false);
  });

  it('a missing field (undefined) never matches an interval either', () => {
    const row: Row = {};
    expect(matchesClause(row, clause)).toBe(false);
  });
});
