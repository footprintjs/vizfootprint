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
import { fakeSqlBackend, fakeSqlConnection as fake } from './sqlConnection.coverage.helpers.js';
import { RELAND_KEY_COLUMN, dropStagingSQL, emptyStagingSQL, relandSQL, stagingTableOf } from './sqlReland.js';

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

  it('declares what it DOES: real SQL, a real ORDER BY, a find, a reland, and no write-back', () => {
    expect(wasmProvider().capabilities).toEqual({ canEvaluateSQL: true, canSort: true, canFind: true, canMaterialize: false, canReland: true });
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

// ── RELAND: a refresh computed where the rows live. ──────────────────────
//
// The keyed delta is real SQL and is judged against a real DuckDB
// (`engineInvariant.test.ts`). What is judged HERE is everything around it:
// the order of the refusals, that no row is read out of the backend to be
// diffed, that the old rows stay on every refusal, and that the no-key act —
// land, replace, drop, re-DESCRIBE — runs through the one connection in that
// order and leaves the SAME provider answering the new rows.

const NEW_ROWS: readonly Record<string, unknown>[] = [
  { week: 1, disease: 'Lyme', cases: 12 },
  { week: 2, disease: 'Lyme', cases: 9 },
];
const STAGING = stagingTableOf(TABLE);

async function refusedReland(provider: DataProvider, table: string, rows: readonly Record<string, unknown>[], key?: string): Promise<{ readonly reason: string; readonly detail: string }> {
  const answer = await provider.replaceRows!(table, rows, key === undefined ? {} : { key });
  if (!isRejection(answer)) throw new Error('the engine answered a reland it should have refused');
  const rejection = answer as { readonly reason: string; readonly detail?: string; readonly operation: string };
  expect(rejection.operation).toBe('replaceRows');
  return { reason: rejection.reason, detail: rejection.detail ?? '(no detail)' };
}

describe('replaceRows — the refusals, in the order a caller meets them', () => {
  it('a table nobody declared is refused before any connection is asked for', async () => {
    let opens = 0;
    const provider = wasmProvider({ sources: declared, open: async () => { opens += 1; return fake(); } });
    expect(await refusedReland(provider, 'ghosts', NEW_ROWS, 'week')).toEqual({ reason: 'unknown-table', detail: 'no such table "ghosts" — this provider was declared with "cases"' });
    expect(opens).toBe(0);
  });

  it('no connection at all is the constructor s own sentence', async () => {
    expect((await refusedReland(wasmProvider({ sources: declared }), TABLE, NEW_ROWS)).detail).toBe(wasmConnectionRefusal(TABLE));
  });

  it('a connection that answers queries only cannot re-land: refused after the schema is read, and nothing is landed', async () => {
    const connection = fake();
    const rejection = await refusedReland(over(connection), TABLE, NEW_ROWS, 'week');
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toBe('the SQL connection this engine reads through cannot re-land "cases": it answers queries only (no load) — pass an opener that can (openSqlConnection: duckdbConnection())');
    expect(connection.asked).toEqual([describeSQL]);
  });

  it('a table this engine did not load has no source order to compare first rows in — refused in the words find refuses it in', async () => {
    const connection = { ...fake({ schema: [{ column_name: 'week', column_type: 'BIGINT' }] }), load: async () => {} };
    const rejection = await refusedReland(over(connection), TABLE, NEW_ROWS, 'week');
    expect(rejection.reason).toBe('unknown-column');
    expect(rejection.detail).toBe('table "cases" has no column "__row" — a reland compares each key\'s first row in source order, and this engine\'s tables carry a source-order column assigned at load, so this table was not loaded by it');
  });

  it('a landing the backend refuses moves nothing: the cause is quoted, the old rows are still served', async () => {
    const backend = fakeSqlBackend({ refuseLoad: (table) => (table === STAGING ? 'disk full' : undefined) });
    await backend.load(TABLE, { kind: 'rows', rows: NEW_ROWS.slice(0, 1) });
    const provider = over(backend);
    const rejection = await refusedReland(provider, TABLE, NEW_ROWS, 'week');
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toBe('re-landing "cases" failed before any row moved: disk full — the table still holds its previous rows');
    expect((await answered(provider, null, { mode: 'count' })).count).toBe(1);
  });

  it('a delta the backend answers without numbers is refused, the staging table is dropped, and the old rows are still served', async () => {
    const backend = fakeSqlBackend(); // not a SQL engine: it answers a WITH statement with rows, never with the five numbers
    await backend.load(TABLE, { kind: 'rows', rows: NEW_ROWS.slice(0, 1) });
    const provider = over(backend);
    const rejection = await refusedReland(provider, TABLE, NEW_ROWS, 'week');
    expect(rejection.reason).toBe('no-backend-connection');
    expect(rejection.detail).toContain('the reland delta for "cases" came back without a number for added — the backend answered');
    expect(backend.asked.at(-1)).toBe(dropStagingSQL(STAGING));
    expect(backend.landed.map((l) => l.table)).toEqual([TABLE, STAGING]); // landed, and never replaced
    expect((await answered(provider, null, { mode: 'count' })).count).toBe(1);
  });
});

// The canned fake with a loader spliced on: DESCRIBE answers the canned schema
// (which carries `__row`), every other statement answers the canned rows — so
// the KEYED act can be walked statement by statement and refused at any chosen
// one. The numbers it answers are canned, which is the point: what is judged is
// the ORDER of the statements, which one each refusal names, and that the old
// rows and the staging table are handled the same way whichever statement broke.
const loading = (options: Parameters<typeof fake>[0] = {}) => ({ ...fake(options), load: async () => {} });
/** One row that answers the counts statement AND every sample statement — five numbers, and the raw key each sample reads. */
const COUNTED: readonly Record<string, unknown>[] = [{ added: 1n, updated: 1, removed: 1, unkeyed: 0, keyed: 2, [RELAND_KEY_COLUMN]: 7 }];

/** The statements a keyed reland of the canned schema renders — computed, never re-typed, so this suite cannot pass while the renderer and the engine drift apart. */
async function keyedStatements(provider: DataProvider) {
  const columns = await provider.columns(TABLE);
  if (isRejection(columns)) throw new Error('the canned schema was refused');
  return relandSQL(TABLE, STAGING, 'week', { old: columns, new: columns });
}

describe('replaceRows — the keyed act asks the renderer s statements in order, and reads the five numbers and three samples off the answers', () => {
  it('DESCRIBE the staging table, counts, the three samples, replace, drop, re-DESCRIBE — and the delta is what the numbers said', async () => {
    const connection = loading({ rows: COUNTED });
    const provider = over(connection);
    const statements = await keyedStatements(provider);
    const before = connection.asked.length;
    const answer = await provider.replaceRows!(TABLE, NEW_ROWS, { key: 'week' });
    expect(answer).toMatchObject({ ok: true, delta: { keyed: true, key: 'week', added: 1, updated: 1, removed: 1, sample: { added: ['7'], updated: ['7'], removed: ['7'] }, unkeyed: 0 } });
    expect(connection.asked.slice(before)).toEqual([
      `DESCRIBE "${STAGING}"`,
      statements.delta!.counts,
      statements.delta!.samples.added,
      statements.delta!.samples.updated,
      statements.delta!.samples.removed,
      statements.replace,
      statements.drop,
      describeSQL,
    ]);
  });

  it('keyed 0 with rows in hand is keyAbsent — deltaByKey s own test — and no sample is asked for', async () => {
    const connection = loading({ rows: [{ added: 0, updated: 0, removed: 3, unkeyed: 2, keyed: 0 }] });
    const provider = over(connection);
    const statements = await keyedStatements(provider);
    const answer = await provider.replaceRows!(TABLE, NEW_ROWS, { key: 'week' });
    expect(answer).toMatchObject({ ok: true, delta: { keyed: false, replaced: 2, keyAbsent: 'week' } });
    expect(connection.asked).not.toContain(statements.delta!.samples.added);
    expect(connection.asked.at(-2)).toBe(statements.drop);
  });

  it('a refusal BEFORE the replace — the staging DESCRIBE, the counts, any sample, the replace itself — drops the staging table and leaves the old rows', async () => {
    const statements = await keyedStatements(over(loading({ rows: COUNTED })));
    const breakable = [`DESCRIBE "${STAGING}"`, statements.delta!.counts, statements.delta!.samples.added, statements.delta!.samples.updated, statements.delta!.samples.removed, statements.replace];
    for (const broken of breakable) {
      const connection = loading({ rows: COUNTED, fail: (sql) => (sql === broken ? 'Out of Memory Error' : undefined) });
      const provider = over(connection);
      const rejection = await refusedReland(provider, TABLE, NEW_ROWS, 'week');
      expect(rejection.reason).toBe('no-backend-connection');
      expect(rejection.detail).toContain('Out of Memory Error');
      expect(connection.asked.at(-1)).toBe(dropStagingSQL(STAGING));
      expect(connection.asked.includes(statements.replace)).toBe(broken === statements.replace); // the replace was asked only when IT was the one that broke
      expect(connection.asked.filter((sql) => sql === describeSQL)).toHaveLength(1); // the schema was never re-read: the old one still stands
    }
  });

  it('a drop that fails AFTER the replace leaks the staging table but still answers ok — the rows already moved, and a refusal here would break RefreshOutcome\'s law that a refusal means nothing moved; the columns come from the staging table\'s own schema, read a moment before the replace, and the remembered schema is forgotten either way, so the next read re-DESCRIBEs the REAL table, never the leaked staging one', async () => {
    const statements = await keyedStatements(over(loading({ rows: COUNTED })));
    const connection = loading({ rows: COUNTED, fail: (sql) => (sql === statements.drop ? 'lock held' : undefined) });
    const provider = over(connection);
    const answer = await provider.replaceRows!(TABLE, NEW_ROWS, { key: 'week' });
    expect(answer).toMatchObject({ ok: true, delta: { keyed: true, key: 'week', added: 1, updated: 1, removed: 1, sample: { added: ['7'], updated: ['7'], removed: ['7'] }, unkeyed: 0 } });
    const before = connection.asked.length;
    await provider.columns(TABLE);
    expect(connection.asked.slice(before)).toEqual([describeSQL]);
  });

  it('a re-DESCRIBE that fails after the rows moved still answers ok, from the staging table\'s own schema read a moment before the replace — a refusal here would claim nothing moved when it did', async () => {
    let described = 0;
    const connection = loading({ rows: COUNTED, fail: (sql) => (sql === describeSQL && ++described === 2 ? 'catalog gone' : undefined) });
    const answer = await over(connection).replaceRows!(TABLE, NEW_ROWS, { key: 'week' });
    expect(answer).toMatchObject({ ok: true, delta: { keyed: true, key: 'week', added: 1, updated: 1, removed: 1, sample: { added: ['7'], updated: ['7'], removed: ['7'] }, unkeyed: 0 } });
  });

  it('a counts row without a number names the number it lacks — and no row at all lacks the first', async () => {
    const connection = loading({ rows: [{ added: 1, updated: 'many' }] });
    const rejection = await refusedReland(over(connection), TABLE, NEW_ROWS, 'week');
    expect(rejection.detail).toContain('came back without a number for updated');
    expect((await refusedReland(over(loading({ rows: [] })), TABLE, NEW_ROWS, 'week')).detail).toContain('came back without a number for added — the backend answered []');
  });

  it('zero rows whose empty copy the backend refuses: the cause is quoted as a landing that failed', async () => {
    const connection = loading({ rows: COUNTED, fail: (sql) => (sql === emptyStagingSQL(TABLE, STAGING) ? 'read only' : undefined) });
    const rejection = await refusedReland(over(connection), TABLE, [], 'week');
    expect(rejection.detail).toMatch(/^re-landing "cases" failed before any row moved: .*read only.* — the table still holds its previous rows$/);
  });
});

describe('replaceRows — the no-key act runs through the one connection, in order, and the same provider answers the new rows', () => {
  it('land, DESCRIBE the staging table, replace, drop, re-DESCRIBE — and the delta is "replaced" by the count the caller handed over', async () => {
    const backend = fakeSqlBackend();
    await backend.load(TABLE, { kind: 'rows', rows: [{ week: 1, disease: 'Lyme' }] });
    const provider = over(backend);
    expect((await provider.columns(TABLE)) as unknown).toEqual([{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }]);
    const before = backend.asked.length;
    const answer = await provider.replaceRows!(TABLE, NEW_ROWS);
    expect(answer).toEqual({ ok: true, delta: { keyed: false, replaced: 2 }, columns: [{ name: 'week', type: 'number' }, { name: 'disease', type: 'string' }, { name: 'cases', type: 'number' }] });
    const statements = relandSQL(TABLE, STAGING, undefined, { old: [], new: [] });
    expect(backend.asked.slice(before)).toEqual([`DESCRIBE "${STAGING}"`, statements.replace, statements.drop, describeSQL]);
    expect(backend.landed.at(-1)).toEqual({ table: STAGING, data: { kind: 'rows', rows: NEW_ROWS } });
    // the SAME object now answers the new rows: the schema was re-read, not remembered
    expect((await answered(provider, null, { mode: 'count' })).count).toBe(2);
    expect((await provider.columns(TABLE)) as unknown).toEqual(answer.ok ? answer.columns : []);
  });

  it('zero new rows are an EMPTY copy of the old table, so the schema is kept and nothing is landed through the loader', async () => {
    const backend = fakeSqlBackend();
    await backend.load(TABLE, { kind: 'rows', rows: NEW_ROWS });
    const provider = over(backend);
    await provider.columns(TABLE); // the schema is read once, here, so the reland's first statement is its own
    const before = backend.asked.length;
    const answer = await provider.replaceRows!(TABLE, []);
    expect(answer).toMatchObject({ ok: true, delta: { keyed: false, replaced: 0 } });
    expect(backend.asked[before]).toBe(emptyStagingSQL(TABLE, STAGING));
    expect(backend.landed.map((l) => l.table)).toEqual([TABLE]);
    expect((await answered(provider, null, { mode: 'count' })).count).toBe(0);
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
