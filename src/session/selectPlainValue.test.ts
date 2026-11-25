/**
 * A SELECTION COMPARES A COLUMN WITH PLAIN VALUES, AND THE DOOR SAYS SO.
 *
 * A point select used to accept anything as its value. An array was written
 * into the recorded SQL as its elements joined by commas, unquoted:
 * `value: ["1) OR (1=1"]` recorded `("category" IN (1) OR (1=1))`. The rows the
 * session kept were not the rows that SQL names, and a host that ran the
 * recorded SQL ran text an agent chose.
 *
 * | the act                                         | the answer                                  |
 * |-------------------------------------------------|---------------------------------------------|
 * | point value: a string, number, boolean          | lands, quoted or numeric in the SQL         |
 * | point value: a string holding SQL               | lands as ONE quoted literal                 |
 * | point value: null                               | clears, as before                           |
 * | point value: an array, a record, a nested array | refused `guard-failed`, nothing lands       |
 * | values: an entry that is an array or a record   | refused, nothing lands                      |
 * | cell: a side that is a record or a bad pair     | refused, nothing lands                      |
 * | filter: a bound that is an array or a record    | refused, nothing lands                      |
 * | the same through the agent tool                 | the same refusal, as the tool's answer      |
 */
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../def/index.js';
import { isPlainValue, notOnePlainValue } from '../data/index.js';
import { vizAsTools } from '../agent/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';

const cause = { requestedBy: 'agent', computedBy: 'system' } as const;
const fresh = () => buildDashboard(makeDashboardDef()).createSession({ as: 'agent' });
const INJECTED = '1) OR (1=1';

describe('a point selects one plain value', () => {
  it.each<[string, unknown, string]>([
    ['a string', 'Formal', `("category" IN ('Formal'))`],
    ['a string holding SQL', `x') OR ('1'='1`, `("category" IN ('x'') OR (''1''=''1'))`],
    ['a number', 3, '("category" IN (3))'],
    ['a boolean', true, '("category" IN (TRUE))'],
  ])('%s lands as one literal', async (_what, value, sql) => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value, cause });
    expect(res.ok).toBe(true);
    expect(s.log.records.at(-1)!.predicateSQL).toBe(sql);
  });

  it('null still clears', async () => {
    const s = fresh();
    await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause });
    expect((await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: null, cause })).ok).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ['an array holding SQL', [INJECTED], 'an array'],
    ['an array of numbers', [1, 2], 'an array'],
    ['a nested array', [[1], [2]], 'an array'],
    ['an empty array', [], 'an array'],
    ['a record', { id: 'x' }, 'a record'],
    ['a record with its own toString', { toString: () => INJECTED }, 'a record'],
    ['a function', () => 1, 'a function'],
    ['a bigint', 10n, 'a bigint'],
  ])('%s is refused, and nothing lands', async (_what, value, got) => {
    const s = fresh();
    const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value, cause });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.rejection.code).toBe('guard-failed');
    expect(res.rejection.detail).toContain('ONE plain value');
    expect(res.rejection.detail).toContain(`got ${got}`);
    expect(s.log.records).toHaveLength(0);
    expect(s.gaps().at(-1)).toMatchObject({ code: 'guard-failed', op: 'select', target: 'category' });
  });
});

describe('every other form of a selection is held to the same rule', () => {
  it('values: an entry that is not plain', async () => {
    const s = fresh();
    for (const values of [['Formal', [INJECTED]], [{ id: 1 }], [['a', 'b']]]) {
      const res = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: values as never, cause });
      expect(res.ok === false && res.rejection.code).toBe('guard-failed');
      expect(res.ok === false && res.rejection.detail).toContain('each of the values is one plain value');
    }
    expect(s.log.records).toHaveLength(0);
    // …and plain entries land, each one quoted
    const ok = await s.dispatch({ verb: 'select', viewId: 'bar', field: 'category', values: ['Formal', INJECTED], cause });
    expect(ok.ok).toBe(true);
    expect(s.log.records.at(-1)!.predicateSQL).toBe(`(("category" IN ('Formal')) OR ("category" IN ('${INJECTED}')))`);
  });

  it('filter: a bound that is not plain', async () => {
    const s = fresh();
    for (const range of [[[INJECTED], 90], [50, { toString: () => INJECTED }], [[1, 2], [3, 4]]]) {
      const res = await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: range as never, cause });
      expect(res.ok === false && res.rejection.code).toBe('guard-failed');
      expect(res.ok === false && res.rejection.detail).toContain('each bound of a range');
    }
    expect(s.log.records).toHaveLength(0);
    expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [50, 90], cause })).ok).toBe(true);
    expect((await s.dispatch({ verb: 'filter', viewId: 'scatter', field: 'price', range: [50, null], cause })).ok).toBe(true);
  });
  it('cell: a side that is not plain and not a pair of plain bounds', async () => {
    const base = makeDashboardDef();
    const s = buildDashboard({
      ...base,
      actors: { ...base.actors, heatmap: { actor: 'user', label: 'Price by category' } },
      capabilities: [...(base.capabilities ?? []), { viewId: 'heatmap', canProbe: true, encodings: ['cell'] }],
    }).createSession({ as: 'agent' });
    for (const values of [[{ id: 1 }, 'Formal'], [[100, [INJECTED]], 'Formal'], [[100, 150], [INJECTED]]]) {
      const res = await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: ['price', 'category'], values: values as never, cause });
      expect(res.ok === false && res.rejection.code).toBe('guard-failed');
      expect(res.ok === false && res.rejection.detail).toContain('each side of a cell');
    }
    expect(s.log.records).toHaveLength(0);
    expect((await s.dispatch({ verb: 'select', viewId: 'heatmap', fields: ['price', 'category'], values: [[100, 150], 'Formal'], cause })).ok).toBe(true);
  });

  it('the agent tool gets the same refusal as its answer, and nothing lands', async () => {
    const s = fresh();
    const answer = await vizAsTools(s).call('viz.dispatch', { verb: 'select', viewId: 'bar', field: 'category', value: [INJECTED], intent: 'a pick' });
    expect(JSON.stringify(answer)).toContain('ONE plain value');
    expect(s.log.records).toHaveLength(0);
  });
});

describe('the rule itself', () => {
  it('a plain value is a string, a number, a boolean, null or a date', () => {
    for (const v of ['', 'a', 0, Number.NaN, true, false, null, new Date(0)]) expect(isPlainValue(v)).toBe(true);
    for (const v of [undefined, [], {}, () => 1, 1n, Symbol('s'), /a/, new Map()]) expect(isPlainValue(v)).toBe(false);
  });

  it.each<[Parameters<typeof notOnePlainValue>[0], unknown, string | null]>([
    ['point', null, null],
    ['point', 'a', null],
    ['point', undefined, 'got nothing'],
    ['point', Symbol('s'), 'got a symbol'],
    ['interval', [1, null], null],
    ['interval', 'not a pair', null], // the outer shape is another judge's to name
    ['interval', [1, [2]], 'got an array'],
    ['match', { values: ['a', 1, null] }, null],
    ['match', { values: 'not a list' }, null],
    ['match', undefined, null],
    ['match', { values: [1, {}] }, 'got a record'],
    ['cell', [1, 'a'], null],
    ['cell', [[1, 2], null], null],
    ['cell', 'not a pair', null],
    ['cell', [[1, 2, 3], 1], 'got an array'],
    ['cell', [1, undefined], 'got nothing'],
    ['cell', [[1, {}], 1], 'got an array'],
    ['cell', [{}, 1], 'got a record'],
  ])('%s %j', (kind, value, expected) => {
    const said = notOnePlainValue(kind, value);
    if (expected === null) expect(said).toBeNull();
    else expect(said).toContain(expected);
  });
});
