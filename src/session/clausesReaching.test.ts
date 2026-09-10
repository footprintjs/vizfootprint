/**
 * Law 2's ONE owner (`./clausesReaching.ts`), tested directly and not only
 * through a session: `unjudgeableColumn` is total over every clause kind, and
 * `narrowToJudgeable` keeps the list's order and length while marking the
 * ones a table cannot judge. The PAIR kinds (`cell`, `neighbourhood`) are the
 * interesting case — `clauseFields` gives them TWO names, and a table missing
 * EITHER one cannot judge the clause at all (a review finding: this was
 * exercised only through single-field `point` clauses before).
 */
import { describe, expect, it } from 'vitest';
import { narrowToJudgeable, unjudgeableColumn, unjudgeableWords } from './clausesReaching.js';
import type { ReachingClause } from './types.js';
import type { CellClause, PredicateClause } from '../data/index.js';

const POINT = (field: string, value: unknown): PredicateClause => ({ kind: 'point', field, value });
const CELL = (fields: readonly [string, string]): CellClause => ({ kind: 'cell', fields, value: [1, 'x'] });

describe('unjudgeableColumn — the column a table cannot judge, or none', () => {
  it('a single-field clause: judged when the column is there, unjudgeable by that name when it is not', () => {
    expect(unjudgeableColumn(POINT('price', 40), new Set(['price', 'category']))).toBeUndefined();
    expect(unjudgeableColumn(POINT('radii', 4.5), new Set(['planet', 'radius']))).toBe('radii');
  });
  it('a PAIR clause (cell/neighbourhood): unjudgeable when EITHER of its two fields is missing, whichever one it is', () => {
    expect(unjudgeableColumn(CELL(['price', 'rating']), new Set(['price', 'rating', 'category']))).toBeUndefined();
    // the SECOND field missing — the pair as a whole is still unjudgeable, named by the one that is missing
    expect(unjudgeableColumn(CELL(['price', 'radii']), new Set(['price', 'rating', 'category']))).toBe('radii');
    // the FIRST field missing — `clauseFields` reads both, in order, so this is not a one-sided check
    expect(unjudgeableColumn(CELL(['radii', 'price']), new Set(['price', 'rating', 'category']))).toBe('radii');
    // both missing: the first one `clauseFields` names
    expect(unjudgeableColumn(CELL(['radii', 'bucket']), new Set(['price']))).toBe('radii');
  });
});

describe('narrowToJudgeable — order and length are PINNED; only judgeability changes a clause', () => {
  const columns = new Set(['price', 'rating']);
  it('keeps every clause, in order, narrowing only the ones the table cannot judge — a pair clause included', () => {
    const clauses: ReachingClause[] = [
      { from: 'a', response: 'filter', clause: POINT('price', 40) },
      { from: 'b', response: 'filter', clause: POINT('radii', 4.5) },
      { from: 'c', response: 'highlight', clause: CELL(['price', 'rating']) },
      { from: 'd', response: 'filter', clause: CELL(['price', 'radii']) },
    ];
    const judged = narrowToJudgeable(clauses, 'measurements', columns);
    expect(judged.map((c) => c.from)).toEqual(['a', 'b', 'c', 'd']); // order pinned
    expect(judged).toHaveLength(clauses.length); // length pinned — law 3 lists a narrowed clause, never drops it
    expect(judged[0]!.narrowed).toBeUndefined();
    expect(judged[1]!.narrowed).toEqual({ column: 'radii', reason: unjudgeableWords('measurements', 'radii') });
    expect(judged[2]!.narrowed).toBeUndefined(); // the pair the table CAN judge, untouched
    expect(judged[3]!.narrowed).toEqual({ column: 'radii', reason: unjudgeableWords('measurements', 'radii') }); // one bad field narrows the whole pair
  });
  it('is a pure read: the input array and its clause objects are untouched', () => {
    const original: ReachingClause = { from: 'a', response: 'filter', clause: POINT('radii', 4.5) };
    const clauses = [original];
    const judged = narrowToJudgeable(clauses, 'measurements', columns);
    expect(clauses[0]).toBe(original); // the input is not mutated in place
    expect(original.narrowed).toBeUndefined(); // the ORIGINAL object never grows the field
    expect(judged[0]).not.toBe(original); // a narrowed clause is a NEW object, not the live one edited
  });
});
