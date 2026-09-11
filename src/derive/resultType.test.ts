/**
 * WHAT TYPE DOES THIS LAND, read from the declaration alone.
 *
 * The reader is a door's evidence, so the tests are the door's cases: the six
 * reducers a measure is written with, the two ways `'args'` resolves, and the
 * four ways nobody can tell. Its whole contract is that the last group answers
 * `'unknown'` rather than a guess.
 */

import { describe, expect, it } from 'vitest';
import { resultTypeOf } from './resultType.js';
import { OP_NAMES, opOf } from './ops.js';
import { MAX_TREE_NODES } from './judge.js';
import type { ColumnType } from '../data/types.js';

const PARENT: Readonly<Record<string, ColumnType>> = Object.freeze({
  planet: 'string',
  radius: 'number',
  seen: 'date',
  lit: 'boolean',
  murky: 'unknown',
});

const over = (expr: unknown, types = PARENT): ColumnType => resultTypeOf(expr, types);
const reduce = (op: string, arg: unknown): unknown => ({ op, args: [arg] });

describe('a reducer over a declared column', () => {
  it('counts a number', () => {
    expect(over(reduce('count', { col: 'planet' }))).toBe('number');
    expect(over(reduce('countDistinct', { col: 'planet' }))).toBe('number');
  });

  it('totals and averages a number', () => {
    expect(over(reduce('sum', { col: 'radius' }))).toBe('number');
    expect(over(reduce('mean', { col: 'radius' }))).toBe('number');
  });

  it('yields the type it reduces for min and max', () => {
    expect(over(reduce('min', { col: 'radius' }))).toBe('number');
    expect(over(reduce('max', { col: 'radius' }))).toBe('number');
    expect(over(reduce('min', { col: 'seen' }))).toBe('date');
    expect(over(reduce('max', { col: 'planet' }))).toBe('string');
  });

  it('counts a column nobody declared, because count says number whatever it counts', () => {
    expect(over(reduce('count', { col: 'nobody' }))).toBe('number');
    expect(over(reduce('sum', { col: 'nobody' }))).toBe('number');
  });
});

describe('a tree the judge would refuse OUTRIGHT, whatever its type', () => {
  it('min or max over a column with no order (a boolean) is unknown, not a type that op can never produce', () => {
    expect(over(reduce('min', { col: 'flag' }), { ...PARENT, flag: 'boolean' })).toBe('unknown');
    expect(over(reduce('max', { col: 'flag' }), { ...PARENT, flag: 'boolean' })).toBe('unknown');
    // a boolean LITERAL under min/max is refused the same way — the law is about the type, not the source
    expect(over({ op: 'min', args: [{ lit: true }] })).toBe('unknown');
  });

  it('rowMin/rowMax over booleans are unknown for the same reason', () => {
    expect(over({ op: 'rowMin', args: [{ col: 'flag' }, { col: 'flag' }] }, { ...PARENT, flag: 'boolean' })).toBe('unknown');
  });

  it('a reducer nested inside another reducer’s own argument is unknown — it has no rows of its own to run over', () => {
    expect(over({ op: 'min', args: [{ op: 'count', args: [{ col: 'planet' }] }] })).toBe('unknown');
    expect(over({ op: 'min', args: [{ op: 'max', args: [{ col: 'radius' }] }] })).toBe('unknown');
  });

  it('a reducer beside a non-reducer sibling still resolves — folded is per-branch, not per-tree', () => {
    // the demo shape again, confirming the folded flag does not leak from one reducer's argument to its sibling
    expect(over({ op: 'sub', args: [reduce('max', { col: 'radius' }), reduce('min', { col: 'radius' })] })).toBe('number');
  });
});

describe('the four ways nobody can tell', () => {
  it('an undeclared column under min or max', () => {
    expect(over(reduce('min', { col: 'nobody' }))).toBe('unknown');
    expect(over(reduce('max', { col: 'nobody' }))).toBe('unknown');
  });

  it('a column the parent declares as unknown — it is not evidence, it is the absence of it', () => {
    expect(over(reduce('min', { col: 'murky' }))).toBe('unknown');
  });

  it('a parent that declares no columns at all', () => {
    expect(over(reduce('min', { col: 'radius' }), {})).toBe('unknown');
    expect(over({ col: 'radius' }, {})).toBe('unknown');
  });

  it('a tree the judge would refuse — an unknown op, a wrong arity, a non-tree', () => {
    expect(over(reduce('avg', { col: 'radius' }))).toBe('unknown');
    expect(over({ op: 'min', args: [] })).toBe('unknown');
    expect(over({ op: 'min' })).toBe('unknown');
    expect(over(null)).toBe('unknown');
    expect(over('radius')).toBe('unknown');
    expect(over({ col: 42 })).toBe('unknown');
    expect(over({ nothing: 'here' })).toBe('unknown'); // a record naming none of the three forms
    expect(over({ op: 42, args: [{ col: 'radius' }] })).toBe('unknown'); // an op named with something that is not a name
  });

  it('a literal that is not a value a column can hold', () => {
    expect(over({ lit: undefined })).toBe('unknown');
    expect(over({ lit: {} })).toBe('unknown');
    expect(over({ lit: Number.POSITIVE_INFINITY })).toBe('unknown'); // a column cannot hold it, and a log cannot carry it
  });

  it('two arms of one conditional that disagree', () => {
    expect(over({ op: 'min', args: [{ op: 'if', args: [{ op: 'gt', args: [{ col: 'radius' }, { lit: 1 }] }, { col: 'radius' }, { col: 'planet' }] }] })).toBe('unknown');
  });
});

describe('the row ops a measure is built out of', () => {
  it('reads a fixed yields off the row', () => {
    expect(over({ op: 'add', args: [{ col: 'radius' }, { lit: 1 }] })).toBe('number');
    expect(over({ op: 'gt', args: [{ col: 'radius' }, { lit: 1 }] })).toBe('boolean');
    expect(over({ op: 'upper', args: [{ col: 'planet' }] })).toBe('string');
    expect(over({ op: 'dateTrunc', args: [{ col: 'seen' }, { lit: 'month' }] })).toBe('date');
    expect(over({ op: 'year', args: [{ col: 'seen' }] })).toBe('number');
  });

  it('reads a cast target as the word it is written as, and refuses to guess a target that is not one', () => {
    expect(over({ op: 'cast', args: [{ col: 'planet' }, { lit: 'number' }] })).toBe('number');
    expect(over({ op: 'cast', args: [{ col: 'radius' }, { lit: 'string' }] })).toBe('string');
    expect(over({ op: 'cast', args: [{ col: 'radius' }, { lit: 'boolean' }] })).toBe('unknown');
    expect(over({ op: 'cast', args: [{ col: 'radius' }, { col: 'planet' }] })).toBe('unknown');
  });

  it('lets a written-down absence stand aside from the agreement, as the judge does', () => {
    expect(over({ op: 'coalesce', args: [{ col: 'radius' }, { lit: null }] })).toBe('number');
    expect(over({ op: 'coalesce', args: [{ lit: null }, { lit: null }] })).toBe('unknown');
  });

  it('reads a boolean literal as a boolean', () => {
    expect(over({ op: 'coalesce', args: [{ lit: true }, { lit: false }] })).toBe('boolean');
  });

  it('reads ISO text as a date and other text as a string, because there is no date literal form', () => {
    expect(over({ op: 'min', args: [{ lit: '2020-01-01' }] })).toBe('date');
    expect(over({ op: 'min', args: [{ lit: 'mercury' }] })).toBe('string');
  });

  it('the demo shape — a min/max spread over a declared number — is a number', () => {
    expect(over({ op: 'sub', args: [reduce('max', { col: 'radius' }), reduce('min', { col: 'radius' })] })).toBe('number');
  });
});

describe('total', () => {
  it('answers every op in the vocabulary without throwing', () => {
    for (const name of OP_NAMES) {
      const op = opOf(name)!;
      // the least legal arity, filled with a declared number — a shape many ops will refuse when they run,
      // which is the point: this reader answers with a type or `unknown`, never with an exception
      const args = Array.from({ length: Math.min(op.least, 8) }, () => ({ col: 'radius' }));
      expect(() => resultTypeOf({ op: name, args }, PARENT)).not.toThrow();
    }
  });

  it('answers a tree WIDER than the node ceiling with unknown — the depth bounds the shape, not the work', () => {
    const wide = { op: 'coalesce', args: Array.from({ length: MAX_TREE_NODES + 4 }, () => ({ col: 'radius' })) };
    expect(resultTypeOf(wide, PARENT)).toBe('unknown');
  });

  it('answers a tree nested past the ceiling with unknown rather than a stack overflow', () => {
    let deep: unknown = { col: 'radius' };
    for (let i = 0; i < 200; i += 1) deep = { op: 'coalesce', args: [deep, { lit: 1 }] };
    expect(resultTypeOf(deep, PARENT)).toBe('unknown');
  });
});
