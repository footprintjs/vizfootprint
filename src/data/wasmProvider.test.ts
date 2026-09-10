/**
 * wasmProvider.test.ts — THE ENGINE IS JUDGED BY THE SQL IT ASKS, AND BY WHEN
 * IT ASKS FOR A CONNECTION AT ALL.
 *
 * Every law here is pinned against a FAKE connection that records the
 * statements it was handed and answers canned rows — which is the point of the
 * `SqlConnection` port: the whole engine is testable without a WASM bundle, a
 * worker, or a network. Two obligations get most of the room:
 *
 *   - the statement asked is `resolvePredicateSQL`'s descriptor wrapped by
 *     `windowSQL`, computed HERE by calling those two functions rather than by
 *     re-typing their output — a test that spelled the SQL out would pass while
 *     the engines drifted apart;
 *   - `evaluate().sql` is that descriptor and not the statement, because the
 *     commit log's `predicateSQL` is the same string from every engine.
 */
import { describe, it, expect } from 'vitest';
import { wasmProvider, wasmConnectionRefusal } from './wasmProvider.js';
import { resolvePredicateSQL } from './predicate.js';
import { findSQL, windowSQL } from './sqlWindow.js';
import { isRejection, type DataProvider, type EvaluateOptions, type EvaluateResult, type FindOptions, type FindResult, type PredicateClause } from './types.js';
import type { SqlConnection } from './sqlConnection.js';
import { fakeSqlConnection as fake } from './sqlConnection.coverage.helpers.js';

// ── The fake: one connection, a log of what it was asked. ────────────────
//
// It lives in `sqlConnection.coverage.helpers.ts` because the BUILD door's suite
// needs a fake of the same port (`../def/wasmEngine.def.test.ts`), and two
// hand-written fakes of one port drift.

const TABLE = 'cases';
const declared: readonly string[] = [TABLE];
/** The fake's schema carries `__row` (`SCHEMA_ROWS`), so every rendered order ends in it — the tie-break `sqlWindow.ts` owns. */
const LOADED = { hasRowOrder: true } as const;
const over = (connection: SqlConnection): DataProvider => wasmProvider({ sources: declared, connection });

const describeSQL = `DESCRIBE "${TABLE}"`;

/** The answer, or the refusal quoted — a test that silently accepted a rejection would pin nothing. */
async function answered(
  provider: DataProvider,
  clause: PredicateClause | readonly PredicateClause[] | null,
  options?: EvaluateOptions,
): Promise<EvaluateResult> {
  const answer = await provider.evaluate(TABLE, clause, options);
  if (isRejection(answer)) throw new Error(`the engine refused: ${JSON.stringify(answer)}`);
  return answer;
}

async function refused(
  provider: DataProvider,
  table: string,
  clause: PredicateClause | readonly PredicateClause[] | null,
  options?: EvaluateOptions,
): Promise<{ readonly reason: string; readonly detail: string }> {
  const answer = await provider.evaluate(table, clause, options);
  if (!isRejection(answer)) throw new Error('the engine answered a read it should have refused');
  const rejection = answer as { readonly reason: string; readonly detail?: string };
  return { reason: rejection.reason, detail: rejection.detail ?? '(no detail)' };
}

// ── Construction is inert. ───────────────────────────────────────────────

describe('choosing the engine is not the same act as asking it something', () => {
  it('constructs without opening anything, and answers its declared tables without opening anything either', async () => {
    let opens = 0;
    const provider = wasmProvider({
      sources: declared,
      open: async () => {
        opens += 1;
        return fake();
      },
    });
    expect(opens).toBe(0);
    expect(await provider.tables()).toEqual([TABLE]);
    expect(opens).toBe(0); // the declared list is a fact about the DECLARATION — no worker is spawned to read it back
  });

  it('opens on the first read that needs a backend, and reuses that one connection for every read after it', async () => {
    let opens = 0;
    const connection = fake();
    const provider = wasmProvider({
      sources: declared,
      open: async () => {
        opens += 1;
        return connection;
      },
    });
    await answered(provider, null);
    expect(opens).toBe(1);
    await answered(provider, null);
    expect(opens).toBe(1);
  });

  it('asks the schema once per table — a schema is read by every clause and changes far less often', async () => {
    const connection = fake();
    const provider = over(connection);
    await answered(provider, null);
    await answered(provider, null);
    expect(connection.asked.filter((sql) => sql.startsWith('DESCRIBE'))).toEqual([describeSQL]);
  });

  it('constructing with no sources at all is legal and still touches nothing', async () => {
    const provider = wasmProvider();
    expect(await provider.tables()).toEqual([]);
    expect(provider.engine).toBe('wasm');
  });

  it('declares what it DOES: real SQL, a real ORDER BY, a find, and no write-back', () => {
    expect(wasmProvider().capabilities).toEqual({ canEvaluateSQL: true, canSort: true, canFind: true, canMaterialize: false });
  });
});

// ── The statement, per clause kind. ──────────────────────────────────────

describe('the statement asked is the resolved predicate, wrapped by the window', () => {
  const cases: readonly (readonly [string, PredicateClause | readonly PredicateClause[] | null])[] = [
    ['point', { kind: 'point', field: 'disease', value: 'Lyme' }],
    ['interval, half-open', { kind: 'interval', field: 'week', value: [10, null] }],
    ['interval, closed on both ends', { kind: 'interval', field: 'week', value: [10, 20] }],
    ['cell', { kind: 'cell', fields: ['week', 'disease'], value: [[10, 20], 'Lyme'] }],
    ['match', { kind: 'match', field: 'disease', values: ['Lyme', 'Zika'] }],
    ['match, excluding', { kind: 'match', field: 'disease', values: ['Lyme'], exclude: true }],
    ['neighbourhood', { kind: 'neighbourhood', fields: ['source', 'target'], ids: ['a', 'b'] }],
    ['a list of them — its AND', [
      { kind: 'point', field: 'disease', value: 'Lyme' },
      { kind: 'interval', field: 'week', value: [10, 20] },
    ]],
    ['cleared — no clause at all', null],
  ];

  for (const [name, clause] of cases) {
    it(`${name}: the window's rows, then the count of everything that matched`, async () => {
      const connection = fake();
      const answer = await answered(over(connection), clause);
      const predicate = resolvePredicateSQL(clause);
      expect(connection.asked).toEqual([describeSQL, windowSQL(TABLE, predicate), windowSQL(TABLE, predicate, { mode: 'count' })]);
      // the DESCRIPTOR is what the result reports — never the statement that ran
      expect(answer.sql).toBe(predicate);
      expect(answer.sql).not.toBe(connection.asked[1]);
    });
  }

  it('a cleared clause is no WHERE at all — the one thing a naive renderer gets backwards', async () => {
    const connection = fake();
    await answered(over(connection), null);
    expect(connection.asked[1]).toBe('SELECT * FROM "cases"');
  });

  it('count mode asks ONE statement and answers a number with no rows', async () => {
    const connection = fake({ count: [{ n: 7n }] });
    const clause: PredicateClause = { kind: 'point', field: 'disease', value: 'Lyme' };
    const answer = await answered(over(connection), clause, { mode: 'count' });
    expect(connection.asked).toEqual([describeSQL, windowSQL(TABLE, resolvePredicateSQL(clause), { mode: 'count' })]);
    expect(answer).toEqual({ sql: resolvePredicateSQL(clause), count: 7 });
  });

  it('the window travels whole: columns, sort, limit and offset all reach the statement', async () => {
    const connection = fake();
    const options: EvaluateOptions = {
      columns: ['week', 'disease'],
      sort: [{ field: 'week', dir: 'desc', absent: 'first' }],
      limit: 10,
      offset: 5,
    };
    const answer = await answered(over(connection), null, options);
    expect(connection.asked[1]).toBe(windowSQL(TABLE, resolvePredicateSQL(null), options, LOADED));
    // the asked-for key, and then the one the ENGINE owes every order it renders
    expect(connection.asked[1]).toContain('ORDER BY "week" DESC NULLS FIRST, "__row" ASC');
    expect(connection.asked[1]).toContain('LIMIT 10 OFFSET 5');
    // an offset answers where the window actually starts, clamped to what matched
    expect(answer.start).toBe(2);
  });

  it('a count is a JS number whether DuckDB sent a bigint or a double', async () => {
    expect((await answered(over(fake({ count: [{ n: 12 }] })), null)).count).toBe(12);
    expect((await answered(over(fake({ count: [{ n: 12n }] })), null)).count).toBe(12);
  });
});

// ── The rows that come back. ─────────────────────────────────────────────

describe('__row is this engine s bookkeeping, and never the caller s data', () => {
  it('is stripped from every row and answered as indices', async () => {
    const answer = await answered(over(fake()), null, { indices: true });
    expect(answer.rows).toEqual([
      { week: 1n, disease: 'Lyme', cases: 12 },
      { week: 2n, disease: 'Lyme', cases: 8 },
    ]);
    expect(answer.indices).toEqual([0, 3]); // the source-order index READ from the column, not the position in the answer
  });

  it('is stripped even when no indices were asked for — `SELECT *` carries it either way', async () => {
    const answer = await answered(over(fake()), null);
    expect(answer.rows?.every((row) => !Object.prototype.hasOwnProperty.call(row, '__row'))).toBe(true);
    expect(answer.indices).toBeUndefined();
  });

  it('a plain number index is taken as it is — an engine that hands back doubles is not wrong', async () => {
    const answer = await answered(over(fake({ rows: [{ week: 1n, __row: 4 }] })), null, { indices: true });
    expect(answer.indices).toEqual([4]);
  });

  it('columns() answers the table s columns, mapped onto this library s five types — without __row', async () => {
    const provider = over(fake());
    expect(await provider.columns(TABLE)).toEqual([
      { name: 'week', type: 'number' },
      { name: 'disease', type: 'string' },
      { name: 'cases', type: 'number' },
      { name: 'flag', type: 'boolean' },
      { name: 'at', type: 'date' },
      { name: 'shape', type: 'unknown' }, // a type this library does not speak is said to be unknown, never guessed
      { name: 'source', type: 'string' },
      { name: 'target', type: 'string' },
    ]);
  });
});

// ── The values that come back. ───────────────────────────────────────────

describe('a value comes back as this library s own, never as DuckDB s wire type', () => {
  /** A table whose day, instant, time and text columns are all declared — the four DuckDB answers with one `date`-ish type word. */
  const DATED = [
    { column_name: 'day', column_type: 'DATE' },
    { column_name: 'seen', column_type: 'TIMESTAMP WITH TIME ZONE' },
    { column_name: 'clock', column_type: 'TIME' },
    { column_name: 'label', column_type: 'VARCHAR' },
    { column_name: '__row', column_type: 'BIGINT' },
  ];

  it('a DATE is the ISO DAY the memory engine holds, and a TIMESTAMP the whole instant', async () => {
    // 2026-04-05 and 2026-04-05T10:20:30Z as DuckDB really sends them: epoch
    // milliseconds, measured against a real database (`duckdbConnection.ts`).
    const rows = [{ day: 1_775_347_200_000, seen: 1_775_384_430_000, label: 'a', __row: 0n }];
    const answer = await answered(over(fake({ schema: DATED, rows })), null);
    expect(answer.rows).toEqual([{ day: '2026-04-05', seen: '2026-04-05T10:20:30.000Z', label: 'a' }]);
  });

  it('a bigint or a Date is read the same way — the other two shapes a driver can hand a date over in', async () => {
    const rows = [{ day: 1_775_347_200_000n, seen: new Date('2026-04-05T10:20:30Z'), __row: 0n }];
    expect((await answered(over(fake({ schema: DATED, rows })), null)).rows).toEqual([{ day: '2026-04-05', seen: '2026-04-05T10:20:30.000Z' }]);
  });

  it('a date value in a shape this engine did not measure is answered UNTOUCHED — a converter that guessed would be worse than one that did not', async () => {
    const rows = [{ day: '2026-04-05', seen: null, clock: 3_723_000_000n, label: 'a', __row: 0n }];
    // the string is already the library's value; null is absence; a TIME is
    // microseconds, a shape this library has no value for and does not invent one for
    expect((await answered(over(fake({ schema: DATED, rows })), null)).rows).toEqual([{ day: '2026-04-05', seen: null, clock: 3_723_000_000n, label: 'a' }]);
  });

  it('a column the row does not carry is not invented — a projection that dropped a date leaves no key behind', async () => {
    const answer = await answered(over(fake({ schema: DATED, rows: [{ label: 'a', __row: 0n }] })), null, { columns: ['label'] });
    expect(answer.rows).toEqual([{ label: 'a' }]);
  });
});

// ── The tie-break the engine owes every order. ───────────────────────────

describe('a sorted window is ordered TOTALLY, or two of its pages disagree', () => {
  it('every rendered ORDER BY ends in the source-order column, for a table this engine loaded', async () => {
    const connection = fake();
    await answered(over(connection), null, { sort: [{ field: 'cases', dir: 'desc' }], limit: 2, offset: 2 });
    expect(connection.asked[1]).toBe('SELECT * FROM "cases" ORDER BY "cases" DESC NULLS LAST, "__row" ASC LIMIT 2 OFFSET 2');
  });

  it('…and a table this engine did NOT load gets no such key — it has no such column to name', async () => {
    const foreign = [
      { column_name: 'cases', column_type: 'BIGINT' },
      { column_name: 'week', column_type: 'BIGINT' },
    ];
    const connection = fake({ schema: foreign, rows: [{ cases: 1n, week: 2n }] });
    await answered(over(connection), null, { sort: [{ field: 'cases', dir: 'desc' }] });
    expect(connection.asked[1]).toBe('SELECT * FROM "cases" ORDER BY "cases" DESC NULLS LAST');
  });

  it('a caller who ordered by it gets ONE key, not two', async () => {
    const connection = fake();
    await answered(over(connection), null, { sort: [{ field: '__row', dir: 'desc' }] });
    expect(connection.asked[1]).toBe('SELECT * FROM "cases" ORDER BY "__row" DESC NULLS LAST');
  });
});

// ── The refusals. ────────────────────────────────────────────────────────

describe('every failure is a typed refusal that quotes what it saw', () => {
  it('a table nobody declared: the reason, and the list that WAS declared', async () => {
    const rejection = await refused(over(fake()), 'ghosts', null);
    expect(rejection.reason).toBe('unknown-table');
    expect(rejection.detail).toBe('no such table "ghosts" — this provider was declared with "cases"');
    // …and a provider declared with nothing says that instead of an empty list
    expect((await refused(wasmProvider({ connection: fake() }), 'ghosts', null)).detail).toContain('no tables at all');
  });

  it('columns() files the same unknown table under its own operation', async () => {
    const answer = await over(fake()).columns('ghosts');
    expect(answer).toMatchObject({ operation: 'columns', reason: 'unknown-table' });
    expect(isRejection(answer) && (answer as { detail: string }).detail).toContain('no such table "ghosts"');
  });

  it('a backend that answers the rows and then fails the COUNT is refused — a window without its total is not an answer', async () => {
    const connection = fake({ fail: (sql) => (sql.startsWith('SELECT COUNT(*)') ? 'Out of Memory Error' : undefined) });
    const rejection = await refused(over(connection), TABLE, null);
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toContain('Out of Memory Error');
    expect(connection.asked).toHaveLength(3); // schema, rows, count — the count is where it broke
  });

  it('…and the same failure in count mode, where that statement is the whole answer', async () => {
    const rejection = await refused(over(fake({ fail: (sql) => (sql.startsWith('SELECT COUNT(*)') ? 'Out of Memory Error' : undefined) })), TABLE, null, { mode: 'count' });
    expect(rejection).toMatchObject({ reason: 'no-backend-connection' });
    expect(rejection.detail).toContain('Out of Memory Error');
  });

  it('a table is judged before a connection is asked for — an unknown name never spawns a backend', async () => {
    let opens = 0;
    const provider = wasmProvider({
      sources: declared,
      open: async () => {
        opens += 1;
        return fake();
      },
    });
    expect((await refused(provider, 'ghosts', null)).reason).toBe('unknown-table');
    expect(opens).toBe(0);
  });

  it('a clause on a column the table does not have — in the memory engine s words, so one fact reads one way', async () => {
    const rejection = await refused(over(fake()), TABLE, { kind: 'point', field: 'nope', value: 1 });
    expect(rejection).toEqual({ reason: 'unknown-column', detail: 'table "cases" has no column "nope"' });
  });

  it('…including a column only one side of a cell reads', async () => {
    const rejection = await refused(over(fake()), TABLE, { kind: 'cell', fields: ['week', 'nope'], value: [1, 2] });
    expect(rejection.detail).toBe('table "cases" has no column "nope"');
  });

  it('a sort key the table does not have says so in the same words, plus what it was for', async () => {
    const rejection = await refused(over(fake()), TABLE, null, { sort: [{ field: 'nope', dir: 'asc' }] });
    expect(rejection).toEqual({ reason: 'unknown-column', detail: 'table "cases" has no column "nope" to sort by' });
  });

  it('a malformed window is refused before anything is asked of the backend', async () => {
    const connection = fake();
    const rejection = await refused(over(connection), TABLE, null, { limit: -2 });
    expect(rejection).toEqual({ reason: 'bad-window', detail: 'limit must be a whole number at or above zero (got -2)' });
    expect(connection.asked).toEqual([describeSQL]); // the schema, and nothing more
  });

  it('a projection naming a column the table does not have is refused BEFORE any statement runs — the same law the memory engine keeps', async () => {
    const connection = fake();
    const rejection = await refused(over(connection), TABLE, null, { columns: ['disease', 'nope'] });
    expect(rejection).toEqual({ reason: 'unknown-column', detail: 'table "cases" has no column "nope" to return' });
    expect(connection.asked).toEqual([describeSQL]); // …and DuckDB never got the Binder Error to file under a missing connection
  });

  it('…in count mode too, where the projection is ignored: an unknown column is a mistake in the ask, whichever mode asks it', async () => {
    expect((await refused(over(fake()), TABLE, null, { columns: ['nope'], mode: 'count' })).reason).toBe('unknown-column');
  });

  it('…and `__row` is NOT one of them: the table really carries it, and a caller who names it gets it', async () => {
    const answer = await answered(over(fake()), null, { columns: ['week', '__row'] });
    expect(answer.rows).toEqual([
      { week: 1n, disease: 'Lyme', cases: 12 },
      { week: 2n, disease: 'Lyme', cases: 8 },
    ]); // the fake answers its canned rows whatever is projected; what is pinned is that the ask was not refused
  });

  it('a backend that says no: its own words and the statement it refused, both quoted', async () => {
    const connection = fake({ fail: (sql) => (sql.startsWith('SELECT *') ? 'Binder Error: no such column' : undefined) });
    const rejection = await refused(over(connection), TABLE, null);
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toContain('Binder Error: no such column');
    expect(rejection.detail).toContain('the statement was: SELECT * FROM "cases"');
  });

  it('…and so is a backend that cannot describe the table at all', async () => {
    const rejection = await refused(over(fake({ fail: (sql) => (sql.startsWith('DESCRIBE') ? 'Catalog Error: Table "cases" does not exist' : undefined) })), TABLE, null);
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toContain('Catalog Error');
  });

  it('a thrown thing that is not an Error is still quoted, never swallowed', async () => {
    const connection: SqlConnection = {
      async query(): Promise<readonly Record<string, unknown>[]> {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'the worker went away';
      },
    };
    const rejection = await refused(wasmProvider({ sources: declared, connection }), TABLE, null);
    expect(rejection.detail).toContain('the worker went away');
  });

  it('a count that comes back without a number is refused, not read as zero', async () => {
    const rejection = await refused(over(fake({ count: [] })), TABLE, null);
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toContain('counting "cases" came back without a number');
    // and in count mode, where that number is the whole answer
    const counted = await refused(over(fake({ count: [{ n: 'lots' }] })), TABLE, null, { mode: 'count' });
    expect(counted.detail).toContain('came back without a number');
  });

  it('…and the row it DID answer is quoted even when it holds a bigint — a refusal that threw would hide what it was refusing', async () => {
    const rejection = await refused(over(fake({ count: [{ total: 5n }] })), TABLE, null, { mode: 'count' });
    expect(rejection.detail).toContain('the backend answered [{"total":"5n"}]');
  });

  it('indices asked of a table that carries no __row is refused — an index this engine did not assign is not an index', async () => {
    const rejection = await refused(over(fake({ rows: [{ week: 1n }] })), TABLE, null, { indices: true });
    expect(rejection.reason).toBe('unknown-column');
    expect(rejection.detail).toContain('this engine\'s tables carry a source-order column assigned at load');
  });

  it('the same table without indices still answers — the refusal is about the request, not the table', async () => {
    expect((await answered(over(fake({ rows: [{ week: 1n }] })), null)).rows).toEqual([{ week: 1n }]);
  });
});

// ── The connection itself. ───────────────────────────────────────────────

describe('the connection is asked for once, and its absence is a sentence a caller can act on', () => {
  it('no connection and no open: the constructor is where this is fixed, and the refusal says so', async () => {
    const rejection = await refused(wasmProvider({ sources: declared }), TABLE, null);
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toBe(wasmConnectionRefusal(TABLE));
    expect(rejection.detail).toContain('pass { connection }');
    expect(rejection.detail).toContain('{ open }');
  });

  it('…and columns() files it under its own operation', async () => {
    const answer = await wasmProvider({ sources: declared }).columns(TABLE);
    expect(answer).toMatchObject({ operation: 'columns', reason: 'no-backend-connection', engine: 'wasm' });
  });

  it('an open that throws is asked ONCE: every later read hears the same cause, and no second attempt is made', async () => {
    let opens = 0;
    const provider = wasmProvider({
      sources: declared,
      open: async () => {
        opens += 1;
        throw new Error('WASM bundle 404');
      },
    });
    const first = await refused(provider, TABLE, null);
    const second = await refused(provider, TABLE, null);
    expect(opens).toBe(1);
    expect(first.reason).toBe('no-backend-connection');
    expect(first.detail).toContain('WASM bundle 404');
    expect(first.detail).toContain('the open function is asked ONCE per provider');
    expect(second).toEqual(first);
  });

  it('the remembered failure names the table that asked, not the one that failed first', async () => {
    const provider = wasmProvider({
      sources: ['cases', 'weeks'],
      open: async () => {
        throw new Error('no worker here');
      },
    });
    await refused(provider, 'cases', null);
    expect((await refused(provider, 'weeks', null)).detail).toContain('opening a connection for "weeks" failed');
  });

  it('two reads that start together join the SAME open — never two databases', async () => {
    let opens = 0;
    const connection = fake();
    const provider = wasmProvider({
      sources: declared,
      open: async () => {
        opens += 1;
        return connection;
      },
    });
    await Promise.all([answered(provider, null), answered(provider, null)]);
    expect(opens).toBe(1);
  });
});

// ── The door this engine keeps shut. ─────────────────────────────────────

describe('materializeColumn is refused by a declared capability, not by a missing wire', () => {
  it('says which capability, and where the column CAN land', async () => {
    const answer = await over(fake()).materializeColumn(TABLE, 'cluster_id', [1, 2]);
    expect(answer).toMatchObject({ ok: false, engine: 'wasm', operation: 'materializeColumn', reason: 'not-implemented' });
    expect(isRejection(answer) && (answer as { detail: string }).detail).toContain('(canMaterialize: false)');
  });

  it('is refused with a live connection in hand — the door is closed by the capability either way', async () => {
    const connection = fake();
    await over(connection).materializeColumn(TABLE, 'cluster_id', []);
    expect(connection.asked).toEqual([]); // nothing was asked of the backend to find that out
  });
});

// ── FIND: where is the next match, in SQL. ───────────────────────────────
//
// Judged the same way every other statement here is: by calling `findSQL` to
// compute what SHOULD have been asked rather than by re-typing it, so this suite
// cannot pass while the builder and the engine drift apart.

const FIND: FindOptions = { text: 'lyme', columns: ['disease'], from: 0, direction: 'forward' };
/** A hit row as DuckDB hands it back: the two bookkeeping numbers the statement added, `__row`, and the row's own columns. */
const HIT_ROWS: readonly Record<string, unknown>[] = [{ __ordinal: 2n, __pos: 5n, week: 2n, disease: 'Lyme', cases: 8, at: 0, __row: 3n }];

async function refusedFind(provider: DataProvider, table: string, options: FindOptions, clause: PredicateClause | readonly PredicateClause[] | null = null): Promise<{ readonly reason: string; readonly detail: string }> {
  const answer = await provider.find!(table, clause, options);
  if (!isRejection(answer)) throw new Error('the engine answered a find it should have refused');
  const rejection = answer as { readonly reason: string; readonly detail?: string; readonly operation: string };
  expect(rejection.operation).toBe('find');
  return { reason: rejection.reason, detail: rejection.detail ?? '(no detail)' };
}

describe('find asks the two statements the builder renders, and answers a POSITION', () => {
  it('declares it can find, asks the count then the hit, and reads the position, the ordinal and the source index off the answer', async () => {
    const connection = fake({ rows: HIT_ROWS, count: [{ n: 3n }] });
    const provider = over(connection);
    expect(provider.capabilities.canFind).toBe(true);
    const answer = (await provider.find!(TABLE, null, FIND)) as Extract<FindResult, { readonly position: number }>;
    const expected = findSQL(TABLE, resolvePredicateSQL(null), FIND);
    expect(connection.asked).toEqual([describeSQL, expected.matches, expected.hit]);
    expect(answer.sql).toBe(resolvePredicateSQL(null)); // the DESCRIPTOR, not the statement — the same string the memory engine reports
    expect([answer.matches, answer.position, answer.ordinal, answer.index]).toEqual([3, 5, 2, 3]);
    // the row is the caller's own: the three bookkeeping columns gone, the date read as this library's ISO text
    expect(answer.row).toEqual({ week: 2n, disease: 'Lyme', cases: 8, at: '1970-01-01T00:00:00.000Z' });
  });

  it('the filter rides into BOTH statements — a find sees the view, never the table', async () => {
    const clause: PredicateClause = { kind: 'point', field: 'disease', value: 'Lyme' };
    const connection = fake({ rows: HIT_ROWS });
    await over(connection).find!(TABLE, clause, FIND);
    const expected = findSQL(TABLE, resolvePredicateSQL(clause), FIND);
    expect(connection.asked.slice(1)).toEqual([expected.matches, expected.hit]);
  });

  it('no row in that direction is `position: null` with the matches still counted — the count is a second statement for exactly this', async () => {
    const connection = fake({ rows: [], count: [{ n: 12n }] });
    const answer = (await over(connection).find!(TABLE, null, { ...FIND, from: 900 })) as FindResult;
    expect(answer).toEqual({ sql: resolvePredicateSQL(null), matches: 12, position: null });
  });
});

describe('every find failure is a typed refusal that quotes what it saw', () => {
  it('an undeclared table, a column to look in the table lacks, a sort key it lacks, and a clause column it lacks', async () => {
    const provider = over(fake({ rows: HIT_ROWS }));
    expect(await refusedFind(provider, 'nope', FIND)).toMatchObject({ reason: 'unknown-table' });
    expect(await refusedFind(provider, TABLE, { ...FIND, columns: ['ghost'] })).toEqual({ reason: 'unknown-column', detail: 'table "cases" has no column "ghost" to look in' });
    expect(await refusedFind(provider, TABLE, { ...FIND, sort: [{ field: 'ghost', dir: 'asc' }] })).toEqual({ reason: 'unknown-column', detail: 'table "cases" has no column "ghost" to sort by' });
    expect(await refusedFind(provider, TABLE, FIND, { kind: 'point', field: 'ghost', value: 1 })).toEqual({ reason: 'unknown-column', detail: 'table "cases" has no column "ghost"' });
  });

  it('a malformed ask is `bad-find` — the builder judges it, the engine says it, and nothing reaches the backend', async () => {
    const connection = fake({ rows: HIT_ROWS });
    const said = await refusedFind(over(connection), TABLE, { ...FIND, text: ' ' });
    expect(said).toEqual({ reason: 'bad-find', detail: 'a find needs something to look for — the text was empty' });
    expect(connection.asked).toEqual([describeSQL]); // the schema, and then nothing
  });

  it('a table this engine did not LOAD has no source-order column, so it has no honest position to answer', async () => {
    const foreign = fake({ rows: HIT_ROWS, schema: [{ column_name: 'disease', column_type: 'VARCHAR' }] });
    const said = await refusedFind(over(foreign), TABLE, FIND);
    expect(said.reason).toBe('unknown-column');
    expect(said.detail).toContain('has no column "__row" — a find answers a POSITION');
    expect(foreign.asked).toEqual([describeSQL]);
  });

  it('a backend that refuses either statement is `no-backend-connection`, quoting the statement and its own words', async () => {
    const expected = findSQL(TABLE, resolvePredicateSQL(null), FIND);
    const noCount = await refusedFind(over(fake({ rows: HIT_ROWS, fail: (sql) => (sql === expected.matches ? 'Out of Memory' : undefined) })), TABLE, FIND);
    expect(noCount).toMatchObject({ reason: 'no-backend-connection' });
    expect(noCount.detail).toContain('Out of Memory');
    const noHit = await refusedFind(over(fake({ rows: HIT_ROWS, fail: (sql) => (sql === expected.hit ? 'Interrupted' : undefined) })), TABLE, FIND);
    expect(noHit).toMatchObject({ reason: 'no-backend-connection' });
    expect(noHit.detail).toContain('Interrupted');
  });

  it('a hit row without the numbers the statement named is a backend that broke its own answer, and it is quoted', async () => {
    const said = await refusedFind(over(fake({ rows: [{ disease: 'Lyme' }] })), TABLE, FIND);
    expect(said.reason).toBe('no-backend-connection');
    expect(said.detail).toContain('came back without a position');
    expect(said.detail).toContain('"disease":"Lyme"');
  });

  it('no connection at all is the constructor sentence, before any statement is built', async () => {
    const said = await refusedFind(wasmProvider({ sources: declared }), TABLE, FIND);
    expect(said).toEqual({ reason: 'no-backend-connection', detail: wasmConnectionRefusal(TABLE) });
  });
});
