import { describe, expect, it } from 'vitest';
import { DESCRIBE_DISTINCT_CAP, DESCRIBE_SAMPLE, describeTable, memoryProvider, parseCSVTyped } from './index.js';
import type { Row } from './index.js';

const CSV = ['disease,cases,jurisdiction,unreported', 'Lyme,12,Texas,', 'Zika,3,Ohio,', 'Lyme,7,Texas,'].join('\n');

describe('describeTable — what is in this table, before there is a dashboard', () => {
  it('describes a CSV: the header order, the sniffed types, a sample, the distinct count, the extent', () => {
    expect(describeTable(CSV)).toEqual({
      rows: 3,
      columns: [
        { name: 'disease', type: 'string', sample: ['Lyme', 'Zika'], distinct: 2, distinctCapped: false },
        { name: 'cases', type: 'number', sample: [12, 3, 7], distinct: 3, distinctCapped: false, extent: [3, 12] },
        { name: 'jurisdiction', type: 'string', sample: ['Texas', 'Ohio'], distinct: 2, distinctCapped: false },
        // every cell empty: the column is there, and nothing is claimed about it
        { name: 'unreported', type: 'unknown', sample: [null], distinct: 1, distinctCapped: false },
      ],
    });
  });

  it('reads a non-default delimiter', () => {
    expect(describeTable('a;b\n1;x\n', { delimiter: ';' }).columns.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('describes rows, taking the column set from the first row (the memory engine\'s own rule)', () => {
    const rows: Row[] = [
      { id: 'a', n: 4, when: new Date('2020-06-01') },
      { id: 'b', n: 1, when: new Date('2020-01-01') },
      { id: 'c', n: 9, when: new Date('2020-12-01') },
    ];
    const d = describeTable(rows);
    expect(d.rows).toBe(3);
    expect(d.columns.map((c) => c.name)).toEqual(['id', 'n', 'when']);
    expect(d.columns[1]).toEqual({ name: 'n', type: 'number', sample: [4, 1, 9], distinct: 3, distinctCapped: false, extent: [1, 9] });
    // a date column gets a date extent — `extent` reads numbers, so a description asks its own question
    expect(d.columns[2]!.type).toBe('date');
    expect(d.columns[2]!.extent).toEqual([new Date('2020-01-01'), new Date('2020-12-01')]);
  });

  it('an empty table has no columns and no rows', () => {
    expect(describeTable([])).toEqual({ rows: 0, columns: [] });
    // a header with no rows still names its columns, and claims nothing about them
    expect(describeTable('a,b\n')).toEqual({
      rows: 0,
      columns: [
        { name: 'a', type: 'unknown', sample: [], distinct: 0, distinctCapped: false },
        { name: 'b', type: 'unknown', sample: [], distinct: 0, distinctCapped: false },
      ],
    });
  });

  it('claims no extent when the type has one but the column carried none', () => {
    // NaN is a number and an invalid date is a date — both are types with nothing to span
    const d = describeTable([{ n: Number.NaN, when: new Date('nope') }]);
    expect(d.columns[0]).toEqual({ name: 'n', type: 'number', sample: [Number.NaN], distinct: 1, distinctCapped: false });
    expect(d.columns[1]!.type).toBe('date');
    expect(d.columns[1]!.extent).toBeUndefined();
  });

  it('caps the distinct count and SAYS it capped it', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
    expect(describeTable(rows, { distinctCap: 4 }).columns[0]).toMatchObject({ distinct: 4, distinctCapped: true });
    expect(describeTable(rows, { distinctCap: 10 }).columns[0]).toMatchObject({ distinct: 10, distinctCapped: false });
  });

  it('samples as many values as asked for, and defaults to a few', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
    expect(describeTable(rows, { sample: 2 }).columns[0]!.sample).toEqual(['r0', 'r1']);
    expect(describeTable(rows).columns[0]!.sample).toHaveLength(DESCRIBE_SAMPLE);
    expect(DESCRIBE_DISTINCT_CAP).toBe(1000);
  });

  it('null and undefined are one absence, listed once (the fold\'s own rule)', () => {
    const d = describeTable([{ a: null }, { a: undefined }, { a: 'x' }]);
    expect(d.columns[0]).toEqual({ name: 'a', type: 'string', sample: [null, 'x'], distinct: 2, distinctCapped: false });
  });

  it('is ONE walk: the same recorders a fold would bring, brought once', () => {
    let steps = 0;
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ n: i }));
    const counted = rows.map((r) => new Proxy(r, { get: (t, k) => { steps += 1; return t[k as string]; } }));
    describeTable(counted);
    // three recorders per column (distinct, extent, date extent) plus the type tally: one read each, per row
    expect(steps).toBe(rows.length * 4);
  });

  it('says the same type the PROVIDER will say — one rule, not two', async () => {
    const rows: Row[] = [
      { s: 'a', n: 1, b: true, d: new Date('2020-01-01'), nothing: null },
      { s: 'b', n: 2, b: false, d: new Date('2020-02-01'), nothing: null },
    ];
    const provider = memoryProvider({ t: rows });
    const cols = await provider.columns('t');
    if ('ok' in cols) return expect.unreachable('the memory provider lists its columns');
    expect(describeTable(rows).columns.map((c) => ({ name: c.name, type: c.type }))).toEqual([...cols]);
    // and over CSV text, the same types the CSV parser's own sniff arrived at
    const typed = parseCSVTyped(CSV);
    expect(Object.fromEntries(describeTable(CSV).columns.map((c) => [c.name, c.type]))).toEqual(typed.columnTypes);
  });
});
