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

  it('names a repeated or blank CSV header once — the parser collapses it into one row key', () => {
    // A trailing comma is the everyday spreadsheet export: two header cells named ''. The rows hold
    // ONE key for them (last wins), so describing two columns would describe a key that is not there.
    const d = describeTable('a,,\n1,2,3\n');
    expect(d.columns.map((c) => c.name)).toEqual(['a', '']);
    expect(d.columns[1]).toMatchObject({ name: '', sample: [3] });
    expect(describeTable('a,a\n1,2\n').columns.map((c) => c.name)).toEqual(['a']);
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

  it('two equal DATES are one date — a description asks what a column holds, not which objects it holds', () => {
    // The fold's `distinct` keys by SameValueZero, so three rows of one day would be three values
    // under a sample showing that day three times: two fields contradicting each other in one row.
    const day = (text: string): Date => new Date(text);
    const d = describeTable([{ when: day('2020-01-01') }, { when: day('2020-01-01') }, { when: day('2020-01-02') }]);
    expect(d.columns[0]).toMatchObject({ name: 'when', type: 'date', distinct: 2, distinctCapped: false });
    expect(d.columns[0]!.sample).toEqual([day('2020-01-01'), day('2020-01-02')]);
    // A string that looks like a date's key cannot collide with one: they are counted apart.
    expect(describeTable([{ v: day('2020-01-01') }, { v: '1577836800000' }]).columns[0]!.distinct).toBe(2);
  });

  it('RETAINS only to the cap: the ceiling bounds the work, not just the number reported', () => {
    // A near-unique id column of a large file would otherwise hold every value it ever saw to
    // report a capped count — per column, all at once.
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` }));
    const d = describeTable(rows, { distinctCap: 4, sample: 10 });
    expect(d.columns[0]).toMatchObject({ distinct: 4, distinctCapped: true });
    // One past the cap is all `distinctCapped` needs, so that is all that is kept.
    expect(d.columns[0]!.sample).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
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

describe('describeTable — refusing a table that contradicts its own absence column', () => {
  const ABSENCE = { field: 'report_state', states: ['present', 'unavailable', 'unknown'] } as const;
  const kept: Row[] = [
    { region: 'north', report_state: 'present', cases: 7 },
    { region: 'south', report_state: 'unavailable', cases: null },
  ];
  const broken: Row[] = [kept[0]!, { ...kept[1]!, cases: 0 }];

  it('says nothing about absence when no vocabulary is given, and nothing when the table keeps its word', () => {
    expect(describeTable(broken)).not.toHaveProperty('refused');
    expect(describeTable(kept, { absence: ABSENCE })).not.toHaveProperty('refused');
  });

  it('refuses a silent row whose value column holds a number — the description still says what is there', () => {
    const d = describeTable(broken, { absence: ABSENCE });
    expect(d.columns.map((c) => c.name)).toEqual(['region', 'report_state', 'cases']);
    expect(d.refused).toBe('this table.rows[1]: report_state says "unavailable" — no value — and cases holds 0; a table cannot say both, so carry null in cases where the row reports nothing');
  });

  it('by default every number column is a value — the one guess this door makes, and why `values` exists', () => {
    const addressed: Row[] = kept.map((row) => ({ ...row, week_index: 1 }));
    // week_index is 1 on the silent row: an address, not a value, but the data alone cannot tell
    expect(describeTable(addressed, { absence: ABSENCE }).refused).toMatch(/week_index holds 1/);
    expect(describeTable(addressed, { absence: ABSENCE, values: ['cases'] })).not.toHaveProperty('refused');
    expect(describeTable(addressed, { absence: ABSENCE, values: ['week_index'] }).refused).toMatch(/week_index holds 1/);
  });

  it('refuses a declaration that names a column this table does not have — a name that misses judges NOTHING', () => {
    // Both of these used to answer a contradicting table with no `refused` at all: a clean bill of health.
    expect(describeTable(broken, { absence: { field: 'reportState', states: ['present', 'unavailable'] } }).refused).toBe(
      'this table: the absence law names "reportState", which is not a column of it — it has region, report_state, cases',
    );
    expect(describeTable(broken, { absence: ABSENCE, values: ['Cases'] }).refused).toBe(
      'this table: values names "Cases", which is not a column of it — it has region, report_state, cases',
    );
    // A table with no columns at all says so rather than listing nothing.
    expect(describeTable([] as Row[], { absence: ABSENCE }).refused).toBe('this table: the absence law names "report_state", which is not a column of it — that table has no columns');
    // And an empty `values` list judges no column, which is not the same as naming one that is not there.
    expect(describeTable(broken, { absence: ABSENCE, values: [] })).not.toHaveProperty('refused');
  });

  it('reads the vocabulary against CSV text too', () => {
    const csv = ['region,report_state,cases', 'north,present,7', 'south,unavailable,3'].join('\n');
    expect(describeTable(csv, { absence: ABSENCE }).refused).toMatch(/^this table\.rows\[1\]: report_state says "unavailable" — no value — and cases holds 3;/);
  });
});
