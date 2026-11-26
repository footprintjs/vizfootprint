/**
 * A FILTER'S BOUND KEEPS THE ROW IT WAS TAKEN FROM, ON EVERY ENGINE.
 *
 * Found in review: the SQL engine was handed a bound as plain decimal text.
 * DuckDB reads that as a fixed-point DECIMAL, and its conversion to the DOUBLE
 * the column holds is not exact, so a filter whose bound is a value in the data
 * could leave that row out. The memory engine compares doubles exactly, so the
 * two engines disagreed (a reviewer: 21 of 400 intervals one row short).
 *
 * | the value in a clause             | the descriptor (reported, recorded) | the statement an engine runs |
 * |-----------------------------------|-------------------------------------|------------------------------|
 * | a number with a fraction          | plain decimal: 107.33333333333333   | exponent: 1.0733333333333333e+2 |
 * | a whole number                    | plain: 42                           | the same: 42                 |
 * | a number JS already writes with e | 1e+21, 1e-7                         | the same value, exponent form |
 * | a string, a boolean, a date, null | as before                           | the same text                |
 * | not a finite number               | NULL                                | NULL                         |
 * | a cleared clause; an empty list   | as before                           | the same text                |
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDashboardAsync, type DashboardDef } from '../def/index.js';
import { memoryProvider } from './memoryProvider.js';
import { wasmProvider } from './wasmProvider.js';
import { canLoad, type LoadingConnection } from './sqlConnection.js';
import { isRejection, type DataProvider } from './types.js';
import { duckdbConnection, exactLiteralSQL, executablePredicateSQL, literalToSQL, resolvePredicateSQL, type PredicateClause } from './index.js';

describe('exactLiteralSQL — a literal an engine reads as the number it was written from', () => {
  it('writes a number with a fraction in exponent form, and it reads back as the same number', () => {
    expect(exactLiteralSQL(107.33333333333333)).toBe('1.0733333333333333e+2');
    expect(exactLiteralSQL(0.1)).toBe('1e-1');
    expect(exactLiteralSQL(-0.0031321296344298606)).toBe('-3.1321296344298606e-3');
    expect(exactLiteralSQL(1e-7)).toBe('1e-7');
    for (const v of [107.33333333333333, 0.1, -0.0031321296344298606, 0.0023572243311385794, 1e-7, 5e-324, 1.5e300]) {
      expect(Number(exactLiteralSQL(v))).toBe(v);
    }
  });

  it('leaves a whole number plain: an engine reads it as an integer and compares it exactly', () => {
    expect(exactLiteralSQL(42)).toBe('42');
    expect(exactLiteralSQL(-7)).toBe('-7');
    expect(exactLiteralSQL(0)).toBe('0');
    expect(exactLiteralSQL(-0)).toBe('0');
    expect(exactLiteralSQL(9007199254740992)).toBe('9007199254740992');
    expect(exactLiteralSQL(1e21)).toBe('1e+21');
  });

  it('is literalToSQL for everything that is not a number with a fraction', () => {
    const day = new Date(Date.UTC(2026, 3, 1));
    for (const value of ['a', "it's", true, false, null, undefined, Number.NaN, Infinity, -Infinity, day, new Date(1770000000123)]) {
      expect(exactLiteralSQL(value)).toBe(literalToSQL(value));
    }
    expect(() => exactLiteralSQL({})).toThrow(TypeError);
  });
});

describe('executablePredicateSQL — the same predicate, with exact numbers', () => {
  const same: readonly (PredicateClause | readonly PredicateClause[] | null)[] = [
    null,
    [],
    { kind: 'point', field: 'n', value: 1 },
    { kind: 'point', field: 'n', value: null },
    { kind: 'point', field: 'n', value: undefined },
    { kind: 'point', field: 'c', value: 'Formal' },
    { kind: 'interval', field: 'price', value: [10, 20] },
    { kind: 'interval', field: 'price', value: [10, null] },
    { kind: 'interval', field: 'price', value: null },
    { kind: 'interval', field: 'day', value: ['2026-04-01', '2026-04-30'] as unknown as [number, number] },
    { kind: 'match', field: 'n', values: [1, 2, null] },
    { kind: 'match', field: 'n', values: [] },
    { kind: 'match', field: 'n', values: [3], exclude: true },
    { kind: 'cell', fields: ['price', 'category'], value: [[100, 150], 'Formal'] },
    { kind: 'cell', fields: ['price', 'category'], value: null },
    { kind: 'neighbourhood', fields: ['source', 'target'], ids: [1, 2, 3] },
    { kind: 'neighbourhood', fields: ['source', 'target'], ids: [] },
    [{ kind: 'point', field: 'n', value: 1 }, { kind: 'interval', field: 'price', value: [10, 20] }],
  ];

  it('is the descriptor, byte for byte, wherever no number has a fraction', () => {
    for (const clause of same) expect(executablePredicateSQL(clause), JSON.stringify(clause)).toBe(resolvePredicateSQL(clause));
  });

  it('differs only in how a number with a fraction is written, in every kind of clause', () => {
    const cases: readonly (readonly [PredicateClause | readonly PredicateClause[], string, string])[] = [
      [{ kind: 'interval', field: 'v', value: [0.1, 107.33333333333333] }, '("v" BETWEEN 0.1 AND 107.33333333333333)', '("v" BETWEEN 1e-1 AND 1.0733333333333333e+2)'],
      [{ kind: 'interval', field: 'v', value: [0.5, null] }, '("v" >= 0.5)', '("v" >= 5e-1)'],
      [{ kind: 'interval', field: 'v', value: [null, 2.25] }, '("v" <= 2.25)', '("v" <= 2.25e+0)'],
      [{ kind: 'point', field: 'v', value: 0.25 }, '("v" IN (0.25))', '("v" IN (2.5e-1))'],
      [{ kind: 'match', field: 'v', values: [0.25, 3, null] }, '("v" IN (0.25, 3, NULL))', '("v" IN (2.5e-1, 3, NULL))'],
      [{ kind: 'match', field: 'v', values: [0.25], exclude: true }, '("v" NOT IN (0.25))', '("v" NOT IN (2.5e-1))'],
      [{ kind: 'cell', fields: ['v', 'c'], value: [[0.5, 1.5], 'Formal'] }, `(("v" BETWEEN 0.5 AND 1.5) AND ("c" IN ('Formal')))`, `(("v" BETWEEN 5e-1 AND 1.5e+0) AND ("c" IN ('Formal')))`],
      [{ kind: 'neighbourhood', fields: ['a', 'b'], ids: [0.5, 2] }, '(("a" IN (0.5, 2)) AND ("b" IN (0.5, 2)))', '(("a" IN (5e-1, 2)) AND ("b" IN (5e-1, 2)))'],
      [[{ kind: 'point', field: 'v', value: 0.25 }, { kind: 'point', field: 'n', value: 1 }], '(("v" IN (0.25))) AND (("n" IN (1)))', '(("v" IN (2.5e-1))) AND (("n" IN (1)))'],
    ];
    for (const [clause, descriptor, statement] of cases) {
      const reported = resolvePredicateSQL(clause);
      const run = executablePredicateSQL(clause);
      expect(reported, JSON.stringify(clause)).toBe(descriptor);
      expect(run, JSON.stringify(clause)).toBe(statement);
      // the two say the same thing: put each number back in plain form and they are one text. (A check
      // for THESE cases only: the pattern would also rewrite such text inside a quoted string.)
      expect(run.replace(/-?\d+(?:\.\d+)?e[+-]\d+/g, (text) => String(Number(text))), JSON.stringify(clause)).toBe(reported);
    }
  });
});

describe('the two engines keep the same rows for a filter whose bounds are values in the data', () => {
  // 240 doubles with fractions, the kind DuckDB reads inexactly from plain text, plus a reviewer's examples
  let seed = 17;
  const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const values = [107.33333333333333, 0.1, 0.0023572243311385794, 0.10101532520520405, 0.000011176088566602751, -0.0031321296344298606];
  while (values.length < 240) values.push((next() < 0.5 ? -1 : 1) * 10 ** (next() * 14 - 7) * (1 + next()));
  const sorted = [...values].sort((a, b) => a - b);
  const rows = values.map((v, i) => ({ id: `r${String(i)}`, v }));
  const cause = { requestedBy: 'user', computedBy: 'user', intent: 'filter by a value in the data' } as const;
  const definition = (engine: 'memory' | 'wasm'): DashboardDef =>
    ({
      meta: { title: 'Exact numbers' },
      data: { t: { engine, key: 'id', rows, columns: { id: { role: 'identifier' }, v: { role: 'measure' } } } },
      actors: { view: { actor: 'user' } },
      defaultTable: 't',
    }) as DashboardDef;

  /** For each interval, the ids the engine keeps, and beside them the number of rows it says match. */
  async function kept(engine: 'memory' | 'wasm', intervals: readonly (readonly [number, number])[]): Promise<{ ids: string[]; count: number }[]> {
    const dashboard = await buildDashboardAsync(definition(engine), { openSqlConnection: duckdbConnection({ host: 'node' }) });
    try {
      const out: { ids: string[]; count: number }[] = [];
      for (const range of intervals) {
        const session = dashboard.createSession();
        const done = await session.dispatch({ verb: 'filter', viewId: 'view', field: 'v', range: [range[0], range[1]], cause });
        expect(done.ok).toBe(true);
        const answer = await session.viewQuery({ table: 't' });
        expect(answer.ok).toBe(true);
        out.push(answer.ok ? { ids: answer.rows.map((row) => String(row['id'])).sort(), count: answer.count } : { ids: [], count: -1 });
      }
      return out;
    } finally {
      await dashboard.close();
    }
  }

  it('60 intervals, each from one value in the data to the third value above it: four rows, on both engines', async () => {
    const intervals = Array.from({ length: 60 }, (_, i) => [sorted[i * 3]!, sorted[i * 3 + 3]!] as const);
    // the count is its own statement on the SQL engine, so it is checked beside the rows: a count that
    // ran the plain text would say 3 beside four rows
    const expected = intervals.map(([lo, hi]) => ({ ids: rows.filter((row) => row.v >= lo && row.v <= hi).map((row) => row.id).sort(), count: 4 }));
    for (const one of expected) expect(one.ids).toHaveLength(4);
    expect(await kept('memory', intervals)).toEqual(expected);
    expect(await kept('wasm', intervals)).toEqual(expected);
  }, 120_000);

  it('an interval from a value to itself keeps exactly that row, for every one of the reviewer’s examples', async () => {
    const own = values.slice(0, 6).map((v) => [v, v] as const);
    const expected = own.map(([v]) => ({ ids: rows.filter((row) => row.v === v).map((row) => row.id), count: 1 }));
    expect(await kept('wasm', own)).toEqual(expected);
    expect(await kept('memory', own)).toEqual(expected);
  }, 120_000);

  describe('every statement the SQL engine runs for one call carries the exact numbers', () => {
    const TABLE = 'data';
    const own = values.slice(0, 6);
    const asked: string[] = [];
    let connection: LoadingConnection;
    let live: DataProvider;
    const memory = memoryProvider(rows, { layout: 'row' });

    beforeAll(async () => {
      const opened = await duckdbConnection({ host: 'node' })();
      if (!canLoad(opened)) throw new Error('the shipped opener answered a connection that cannot land a table');
      connection = opened;
      await connection.load(TABLE, { kind: 'rows', rows });
      live = wasmProvider({
        sources: [TABLE],
        connection: {
          query: async (sql: string) => {
            asked.push(sql);
            return connection.query(sql);
          },
        },
      });
    });

    afterAll(async () => {
      await connection?.close?.();
    });

    /** The statements one call asked that name the column: each must carry the exact text and never the plain one. */
    function expectExact(from: number, v: number, statements: number): void {
      const mine = asked.slice(from).filter((sql) => sql.includes('"v"') && !sql.startsWith('DESCRIBE'));
      expect(mine, `statements for ${String(v)}`).toHaveLength(statements);
      for (const sql of mine) {
        expect(sql, sql).toContain(v.toExponential());
        expect(sql, sql).not.toContain(String(v));
      }
    }

    it('evaluate: the rows AND the count of an interval from a value to itself are that one row, and the descriptor stays plain', async () => {
      for (const v of own) {
        const clause: PredicateClause = { kind: 'interval', field: 'v', value: [v, v] };
        const from = asked.length;
        const answer = await live.evaluate(TABLE, clause);
        if (isRejection(answer)) throw new Error(JSON.stringify(answer));
        expect(answer.rows?.map((row) => row['v']), String(v)).toEqual([v]);
        // the count is a second statement: it is the one that still ran the plain text
        expect(answer.count, String(v)).toBe(1);
        expect(answer.sql).toBe(`("v" BETWEEN ${String(v)} AND ${String(v)})`);
        const inMemory = await memory.evaluate(TABLE, clause);
        if (isRejection(inMemory)) throw new Error(JSON.stringify(inMemory));
        expect({ sql: answer.sql, count: answer.count }).toEqual({ sql: inMemory.sql, count: inMemory.count });
        expectExact(from, v, 2);
      }
    }, 120_000);

    it('evaluate asked only to count says one', async () => {
      for (const v of own) {
        const from = asked.length;
        const answer = await live.evaluate(TABLE, { kind: 'interval', field: 'v', value: [v, v] }, { mode: 'count' });
        if (isRejection(answer)) throw new Error(JSON.stringify(answer));
        expect(answer.count, String(v)).toBe(1);
        expectExact(from, v, 1);
      }
    }, 120_000);

    it('find: the row is found inside the view its own value bounds, as the memory engine finds it', async () => {
      for (const v of own) {
        const clause: PredicateClause = { kind: 'interval', field: 'v', value: [v, v] };
        const id = rows.find((row) => row.v === v)!.id;
        const options = { text: id, columns: ['id'], from: 0, direction: 'forward' } as const;
        const from = asked.length;
        const found = await live.find!(TABLE, clause, options);
        if (isRejection(found)) throw new Error(JSON.stringify(found));
        const inMemory = await memory.find!(TABLE, clause, options);
        if (isRejection(inMemory)) throw new Error(JSON.stringify(inMemory));
        expect(found.matches, String(v)).toBe(1);
        expect(found.position, String(v)).toBe(0);
        expect({ sql: found.sql, matches: found.matches, position: found.position }).toEqual({ sql: inMemory.sql, matches: inMemory.matches, position: inMemory.position });
        expect(found.sql).toBe(`("v" BETWEEN ${String(v)} AND ${String(v)})`);
        expectExact(from, v, 2);
      }
    }, 120_000);
  });
});
