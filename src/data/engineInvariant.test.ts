/**
 * engineInvariant.test.ts — THE D24 centerpiece (docs/RESEARCH_STATE.md):
 * "engine choice never changes commit semantics — cross-engine replay
 * byte-identical (acceptance test at L5/data-provider packet)."
 *
 * This is the strongest form of that claim this packet can prove without a
 * real backend in the room (`serverProvider.ts` is still a typed stub, and the
 * wasm engine's DuckDB is a browser away — it joins the last describe below
 * over a fake connection, which is exactly what its `SqlConnection` port is
 * for): it drives a REAL L1 (`src/log`) + L2 (`src/selection`)
 * cause-tagged commit session — the exact machinery a real dashboard uses —
 * serializes it, replays it onto a fresh port/registry, and then feeds
 * the (replayed) commit stream into THREE differently-shaped `memoryProvider`
 * instances (row-major array, column-major array, and CSV text — three
 * genuinely different internal representations, not a cosmetic flag) and
 * asserts every one resolves the SAME clauses to BYTE-IDENTICAL predicate
 * SQL and row results.
 *
 * The strongest cross-check available today: the provider's resolved
 * `sql` is compared not just provider-to-provider, but against
 * `CommitRecord.predicateSQL` itself — the string L1 recorded from the port's
 * clause (`src/log/log.ts`, `String(clause.predicateSQL)`), which is
 * `mosaicDescriptorSQL`'s byte and, pinned in predicate.test.ts, the REAL
 * Mosaic factories' byte. That ties the data seam's SQL resolution to the
 * actual upstream clause factories, not just to this package's own replica.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { CauseSelectionSession, causeHistogram, replayLog, serializeLog, type CommitInput, type CommitRecord } from '../log/index.js';
import { memoryProvider } from './memoryProvider.js';
import { wasmProvider } from './wasmProvider.js';
import { windowSQL } from './sqlWindow.js';
import { duckdbConnection, duckdbHostOf, hostFactsOf } from './duckdbConnection.js';
import { canLoad, type LoadingConnection } from './sqlConnection.js';
import { mosaicDescriptorSQL } from './predicate.js';
import { pointValueFromWire } from './clauseFromWire.js';
import { isRejection } from './types.js';
import type { CellClause, ColumnInfo, DataProvider, DataProviderRejection, EvaluateResult, FindOptions, FindResult, IntervalClause, PredicateClause, Row } from './types.js';

/** The HIT shape of a find — the arm that carries an ordinal, a source index and a row. */
type FindHit = Extract<FindResult, { readonly position: number }>;

// ── A realistic small cause-tagged session (mirrors src/log/log.test.ts's MAIN_LINE). ──
const SESSION_LOG: CommitInput[] = [
  {
    id: 'c1',
    parent: null,
    viewId: 'A',
    actorMeta: { actor: 'user', label: 'Category picker' },
    kind: 'point',
    field: 'category',
    value: 'Data',
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'click Data' },
  },
  {
    id: 'c2',
    parent: 'c1',
    viewId: 'B',
    actorMeta: { actor: 'agent', label: 'Amount brush' },
    kind: 'interval',
    field: 'amount',
    value: [10, 30],
    cause: { requestedBy: 'user', computedBy: 'agent', intent: 'agent brushes 10..30' },
  },
  {
    id: 'c3',
    parent: 'c2',
    viewId: 'A',
    actorMeta: { actor: 'user', label: 'Category picker' },
    kind: 'point',
    field: 'category',
    value: 'Analytics',
    cause: { requestedBy: 'agent', computedBy: 'agent', intent: 'agent refines to Analytics' },
  },
  {
    // Exercises the "cleared interval" edge (value: null) — a real, meaningful
    // state (R2/R5), not an error path.
    id: 'c4',
    parent: 'c3',
    viewId: 'B',
    actorMeta: { actor: 'agent', label: 'Amount brush' },
    kind: 'interval',
    field: 'amount',
    value: null,
    cause: { requestedBy: 'user', computedBy: 'agent', intent: 'clear the amount brush' },
  },
  {
    // D30: the compound CELL — one gesture, two fields, one commit whose
    // predicate is the AND of both sides. The invariant must hold for it too:
    // all three provider shapes resolve the same SQL and rows, and the SQL
    // matches L1's own descriptor from the REAL composed Mosaic clause.
    id: 'c5',
    parent: 'c4',
    viewId: 'H',
    actorMeta: { actor: 'user', label: 'Amount × category heatmap' },
    kind: 'cell',
    field: 'amount × category',
    fields: ['amount', 'category'],
    value: [[10, 30], 'Data'],
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'click the 10–30 × Data cell' },
  },
  {
    // A HALF-OPEN interval ("20 or more"): the shape on which the data seam's
    // honest SQL and the engine's persisted byte DIVERGE (predicate.ts,
    // resolveIntervalSQL) — so the byte the log persists is pinned here
    // against mosaicDescriptorSQL, not against the provider's sql.
    id: 'c6',
    parent: 'c5',
    viewId: 'B',
    actorMeta: { actor: 'agent', label: 'Amount brush' },
    kind: 'interval',
    field: 'amount',
    value: [20, null],
    cause: { requestedBy: 'user', computedBy: 'agent', intent: 'agent brushes 20 or more' },
  },
  {
    // packet 5: the NEIGHBOURHOOD — one gesture on a node, whose predicate
    // keeps an edge row when BOTH endpoints are in the walked set (the induced
    // ego subgraph). The invariant must hold for it too, and the persisted
    // byte must be the real `and(isIn, isIn)`.
    id: 'c8',
    parent: 'c7',
    viewId: 'N',
    actorMeta: { actor: 'user', label: 'Co-occurrence network' },
    kind: 'neighbourhood',
    field: 'source ↔ target',
    fields: ['source', 'target'],
    value: { seed: 'Data', derivation: 'ego', hops: 1, ids: ['Data', 'Analytics'] },
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'alt-click the Data node' },
  },
  {
    // A STRING (ISO-8601 date) interval — the other divergent shape: Mosaic
    // renders a string extent as a double-quoted column reference.
    id: 'c7',
    parent: 'c6',
    viewId: 'D',
    actorMeta: { actor: 'user', label: 'Date brush' },
    kind: 'interval',
    field: 'date',
    value: ['2026-04-01', '2026-04-30'],
    cause: { requestedBy: 'user', computedBy: 'user', intent: 'brush April' },
  },
];

/**
 * The DATA SEAM's honest SQL, per commit, where it differs from the engine's
 * persisted byte — exactly the two documented divergences (predicate.ts,
 * resolveIntervalSQL: a half-open pair and a string pair). Named per id so the
 * divergence is ASSERTED on both sides, never skipped; every other commit's
 * seam SQL is the persisted byte itself.
 */
const DATA_SEAM_SQL: Readonly<Record<string, string>> = {
  c6: '("amount" >= 20)',
  c7: `("date" BETWEEN '2026-04-01' AND '2026-04-30')`,
};
const seamSQLOf = (record: CommitRecord): string => DATA_SEAM_SQL[record.id] ?? record.predicateSQL;

/** The byte the builtin selection port renders for this commit — what the log must persist under every engine. */
const engineSQLOf = (record: CommitRecord): string =>
  record.kind === 'cell' || record.kind === 'neighbourhood'
    ? mosaicDescriptorSQL(record.kind, record.fields!, record.value)
    : mosaicDescriptorSQL(record.kind, record.field, record.kind === 'point' ? pointValueFromWire(record.value) : record.value);

// The dataset the commits above filter, expressed THREE structurally
// different ways — none derived from the others at the byte level.
// `source`/`target` are the two ENDS of the tie each row also carries — the
// shape a neighbourhood walks (c8), in every one of the three layouts.
const OBJECT_ROWS: Row[] = [
  { category: 'Data', amount: 15, date: '2026-04-05', source: 'Data', target: 'Analytics' },
  { category: 'Analytics', amount: 25, date: '2026-04-20', source: 'Analytics', target: 'Other' },
  { category: 'Data', amount: 5, date: '2026-05-02', source: 'Other', target: 'Data' },
  { category: 'Other', amount: 30, date: '2026-03-30', source: 'Other', target: 'Other' },
];
const CSV_TEXT =
  'category,amount,date,source,target\n' +
  'Data,15,2026-04-05,Data,Analytics\n' +
  'Analytics,25,2026-04-20,Analytics,Other\n' +
  'Data,5,2026-05-02,Other,Data\n' +
  'Other,30,2026-03-30,Other,Other\n';

function clauseFromCommit(record: {
  kind: CommitRecord['kind'];
  field: string;
  value: unknown;
  fields?: readonly [string, string];
}): PredicateClause {
  if (record.kind === 'cell') {
    // D30: a cell commit's authoritative pair rides `fields`; `field` is display-only.
    return { kind: 'cell', fields: record.fields!, value: record.value as CellClause['value'] };
  }
  if (record.kind === 'neighbourhood') {
    // packet 5: the walked ids are the predicate; the pair rides `fields`, and `field` is their joint label
    return { kind: 'neighbourhood', fields: record.fields!, ids: (record.value as { ids: readonly unknown[] }).ids };
  }
  if (record.kind === 'match') {
    const body = record.value as { values: readonly unknown[]; exclude?: boolean };
    return { kind: 'match', field: record.field, values: body.values, ...(body.exclude === true ? { exclude: true } : {}) };
  }
  return record.kind === 'point'
    ? { kind: 'point', field: record.field, value: record.value }
    : { kind: 'interval', field: record.field, value: record.value as IntervalClause['value'] };
}

describe('D24 invariant — replayed log resolves to byte-identical predicate SQL across THREE differently-laid-out memory providers', () => {
  it('the replayed clause stream + cause histogram are byte-identical to the live log (R2, re-asserted at the data seam)', () => {
    const live = new CauseSelectionSession();
    for (const c of SESSION_LOG) live.commit(c);
    const serialized = serializeLog(live.records);
    const replayed = replayLog(serialized);

    expect(replayed.records.map((r) => r.predicateSQL)).toEqual(live.records.map((r) => r.predicateSQL));
    expect(JSON.stringify(causeHistogram(replayed.records))).toBe(JSON.stringify(causeHistogram(live.records)));
    expect(replayed.records.every((r) => r.cause.replayed === true)).toBe(true);
  });

  it('Pin #0: every persisted predicateSQL — written from the REAL Mosaic clause — is the byte mosaicDescriptorSQL renders, half-open and string intervals included', () => {
    // WHY this pin: the builtin selection port renders the persisted byte through
    // mosaicDescriptorSQL and the Mosaic adapter through String(clause.predicate);
    // a log written by either must be byte-identical, and the fixture carries
    // the two shapes (c6, c7) on which the data seam's honest SQL differs.
    const live = new CauseSelectionSession();
    for (const c of SESSION_LOG) live.commit(c);
    const replayed = replayLog(serializeLog(live.records));
    for (const record of [...live.records, ...replayed.records]) {
      expect(record.predicateSQL, `commit ${record.id}`).toBe(engineSQLOf(record));
    }
    // and the divergent shapes really are the odd Mosaic renderings, by value
    expect(live.records.find((r) => r.id === 'c6')!.predicateSQL).toBe('("amount" BETWEEN 20 AND NULL)');
    expect(live.records.find((r) => r.id === 'c7')!.predicateSQL).toBe('("date" BETWEEN "2026-04-01" AND "2026-04-30")');
    // packet 5: the AND of two IN-lists, as the real `and(isIn, isIn)` renders it — the induced ego subgraph
    expect(live.records.find((r) => r.id === 'c8')!.predicateSQL).toBe(`(("source" IN ('Data', 'Analytics')) AND ("target" IN ('Data', 'Analytics')))`);
  });

  it('three structurally different memoryProvider instances agree on sql/count/rows for every replayed commit, AND match L1\'s own predicateSQL', async () => {
    const live = new CauseSelectionSession();
    for (const c of SESSION_LOG) live.commit(c);
    const replayed = replayLog(serializeLog(live.records));

    const providers: Record<string, DataProvider> = {
      rowMajor: memoryProvider(OBJECT_ROWS, { layout: 'row' }),
      columnMajor: memoryProvider(OBJECT_ROWS, { layout: 'column' }),
      fromCSV: memoryProvider(CSV_TEXT), // default layout: 'row', but parsed from an entirely different source shape
    };

    for (const record of replayed.records) {
      const clause = clauseFromCommit(record);
      const results = await Promise.all(
        Object.entries(providers).map(async ([name, provider]) => {
          const result = await provider.evaluate('data', clause);
          if (isRejection(result)) {
            throw new Error(`provider "${name}" rejected commit "${record.id}": ${result.reason}`);
          }
          return [name, result] as const;
        }),
      );

      const [, first] = results[0]!;
      // Pin #1: the DATA SEAM's own resolved SQL matches what L1 already
      // recorded from a REAL Mosaic clause object — the data layer did not
      // invent its own, divergent notion of "this commit's predicate" — except
      // on the two shapes where it deliberately does (DATA_SEAM_SQL), and
      // there the honest SQL is asserted by name.
      expect(first.sql).toBe(seamSQLOf(record));

      // Pin #2: every differently-laid-out provider instance agrees with
      // every other one, byte-for-byte, on sql/count/rows.
      for (const [name, result] of results) {
        expect(result.sql, `sql mismatch for ${name} on commit ${record.id}`).toBe(first.sql);
        expect(result.count, `count mismatch for ${name} on commit ${record.id}`).toBe(first.count);
        expect(result.rows, `rows mismatch for ${name} on commit ${record.id}`).toEqual(first.rows);
      }
    }
  });

  it('the SAME invariant holds against the LIVE (pre-replay) log too — replay is not doing hidden normalization work', async () => {
    const live = new CauseSelectionSession();
    for (const c of SESSION_LOG) live.commit(c);

    const rowMajor = memoryProvider(OBJECT_ROWS, { layout: 'row' });
    const columnMajor = memoryProvider(OBJECT_ROWS, { layout: 'column' });

    for (const record of live.records) {
      const clause = clauseFromCommit(record);
      const a = await rowMajor.evaluate('data', clause);
      const b = await columnMajor.evaluate('data', clause);
      if (isRejection(a) || isRejection(b)) throw new Error('unreachable');
      expect(a.sql).toBe(seamSQLOf(record));
      expect(a).toEqual(b);
    }
  });

  it('a materialized (R11-style) column re-enters identically across layouts, composed with a log-driven clause', async () => {
    const live = new CauseSelectionSession();
    for (const c of SESSION_LOG) live.commit(c);

    const rowMajor = memoryProvider(OBJECT_ROWS, { layout: 'row' });
    const columnMajor = memoryProvider(OBJECT_ROWS, { layout: 'column' });

    // A stand-in for an L3 analysis output (out of this packet's scope) —
    // e.g. a computed band label — materialized identically into both.
    const band = OBJECT_ROWS.map((r) => ((r.amount as number) >= 15 ? 'high' : 'low'));
    await rowMajor.materializeColumn('data', 'band', band);
    await columnMajor.materializeColumn('data', 'band', band);

    // c1 is a real committed clause (category = 'Data'); AND it with the
    // materialized column via two sequential evaluates (this packet's
    // evaluate() takes one clause at a time — composition is a caller
    // concern, proven here by intersecting two result row sets).
    const c1 = live.records.find((r) => r.id === 'c1')!;
    const [byCategoryRow, byCategoryCol] = await Promise.all([
      rowMajor.evaluate('data', clauseFromCommit(c1)),
      columnMajor.evaluate('data', clauseFromCommit(c1)),
    ]);
    if (isRejection(byCategoryRow) || isRejection(byCategoryCol)) throw new Error('unreachable');
    expect(byCategoryRow).toEqual(byCategoryCol);

    const [byBandRow, byBandCol] = await Promise.all([
      rowMajor.evaluate('data', { kind: 'point', field: 'band', value: 'low' }),
      columnMajor.evaluate('data', { kind: 'point', field: 'band', value: 'low' }),
    ]);
    if (isRejection(byBandRow) || isRejection(byBandCol)) throw new Error('unreachable');
    expect(byBandRow).toEqual(byBandCol);
    expect(byBandRow.sql).toBe('("band" IN (\'low\'))');
  });
});

describe('D24 invariant — a clause LIST (the whole live selection) resolves to the same descriptor and count across the three layouts', () => {
  it('AND of two clauses: byte-identical sql, identical count', async () => {
    const rows = [
      { price: 40, category: 'Casual' },
      { price: 160, category: 'Formal' },
      { price: 220, category: 'Formal' },
    ];
    const list = [
      { kind: 'interval' as const, field: 'price', value: [50, 200] as [number, number] },
      { kind: 'point' as const, field: 'category', value: 'Formal' },
    ];
    const answers = await Promise.all([
      memoryProvider(rows, { tableName: 't', layout: 'row' }).evaluate('t', list, { mode: 'count' }),
      memoryProvider(rows, { tableName: 't', layout: 'column' }).evaluate('t', list, { mode: 'count' }),
      memoryProvider({ t: rows }, { layout: 'row' }).evaluate('t', list, { mode: 'count' }),
    ]);
    const sqls = new Set(answers.map((a) => ('sql' in a ? a.sql : 'rejected')));
    const counts = new Set(answers.map((a) => ('count' in a ? a.count : -1)));
    expect(sqls.size).toBe(1);
    expect(counts).toEqual(new Set([1]));
  });
});

describe('D24 invariant — the engine that runs SQL reports the same descriptor as the engine that does not', () => {
  /** The wasm engine's backend, faked: a schema for the dataset above, and a count. What it RECORDS is the statement it was asked. */
  function connectionOverSchema(asked: string[]): { query(sql: string): Promise<readonly Record<string, unknown>[]> } {
    return {
      async query(sql: string): Promise<readonly Record<string, unknown>[]> {
        asked.push(sql);
        if (sql.startsWith('DESCRIBE')) {
          return Object.keys(OBJECT_ROWS[0]!).map((name) => ({ column_name: name, column_type: 'VARCHAR' }));
        }
        return [{ n: 0n }];
      },
    };
  }

  it('every logged commit resolves to the SAME `sql` under the wasm engine — and that descriptor is what its statement wraps', async () => {
    const live = new CauseSelectionSession();
    for (const c of SESSION_LOG) live.commit(c);

    const asked: string[] = [];
    const wasm = wasmProvider({ sources: ['data'], connection: connectionOverSchema(asked) });
    const memory = memoryProvider(OBJECT_ROWS, { layout: 'row' });

    for (const record of live.records) {
      const clause = clauseFromCommit(record);
      const [overSQL, inMemory] = await Promise.all([
        wasm.evaluate('data', clause, { mode: 'count' }),
        memory.evaluate('data', clause, { mode: 'count' }),
      ]);
      if (isRejection(overSQL) || isRejection(inMemory)) throw new Error(`an engine refused commit ${record.id}: ${JSON.stringify(overSQL)}`);
      // the descriptor the commit log rests on — one string, three engines
      expect(overSQL.sql, `sql mismatch on commit ${record.id}`).toBe(seamSQLOf(record));
      expect(overSQL.sql).toBe(inMemory.sql);
      // …and the STATEMENT that ran is that same descriptor, wrapped — never a second rendering of the clause
      expect(asked.at(-1)).toBe(windowSQL('data', seamSQLOf(record), { mode: 'count' }));
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// THE FOURTH LAYOUT: A REAL DUCKDB, OPENED IN NODE BY THE SHIPPED OPENER.
// ─────────────────────────────────────────────────────────────────────────────
//
// The three layouts above are three shapes of ONE engine, and the wasm layout
// below them is that engine's SQL against a fake backend. This one is the
// engine itself: `duckdbConnection()` opens the bundle DuckDB-WASM ships for
// node (no browser, no worker, no download — `duckdbConnection.ts`), the same
// four rows are LANDED through the same `load` a def's build uses, and every
// commit in the session is asked of a real database.
//
// WHY it is not gated behind a flag: `npm run typecheck` already resolves
// `@duckdb/duckdb-wasm` for its types, so a checkout that can typecheck this
// repo can open this database. A skipped proof would be a proof nobody notices
// losing.

/**
 * NO NORMALIZER. There used to be one here — bigint → number, a DATE's epoch
 * millis → the ISO day — and it was hiding the engine's own bug: `15n` where
 * `columns()` promised a number, a value `JSON.stringify` throws on and every
 * fold reads as absent. The engine owes this library's own values now (the
 * database is opened with `castBigIntToDouble`/`castDecimalToDouble` and dates
 * are read back as ISO text — `duckdbConnection.ts`, `wasmProvider.ts`), so the
 * two engines' rows are compared RAW. A test that normalized them would pass
 * again the day the fix is undone.
 *
 * WHY the rows are still paired with their indices below and not compared as
 * two arrays: that is about ORDER, not about values.
 */

/**
 * The rows of a result in SOURCE order, paired with the index each one carries.
 *
 * WHY the pairing and not the arrays as they came: a `SELECT` with no `ORDER BY`
 * may hand its rows back in any order at all (`sqlWindow.ts` — the reason `__row`
 * exists), so an unsorted window's rows agree between engines as a MAP from
 * source-order index to row, never as two parallel arrays. An asked-for order is
 * a different claim, and the sorted window below asserts it as one.
 */
function byIndex(result: EvaluateResult): readonly (readonly [number, Row])[] {
  const rows = result.rows ?? [];
  const indices = result.indices ?? [];
  return rows.map((row, i) => [indices[i] ?? -1, row] as const).sort((a, b) => a[0] - b[0]);
}

/** The engine's own answer, or a failure that says which commit and which engine. */
function answered(result: EvaluateResult | DataProviderRejection, where: string): EvaluateResult {
  if (isRejection(result)) throw new Error(`${where}: ${JSON.stringify(result)}`);
  return result;
}

describe('D24 invariant — the FOURTH layout: a REAL DuckDB, opened in node by the shipped opener', () => {
  const memory = memoryProvider(OBJECT_ROWS, { layout: 'row' });
  let connection: LoadingConnection;
  let live: DataProvider;

  beforeAll(async () => {
    const opened = await duckdbConnection()();
    // The shipped opener owes BOTH halves of the port: a def's build lands its
    // bytes through `load`, and a connection that could only read would refuse it.
    if (!canLoad(opened)) throw new Error('the shipped opener answered a connection that cannot land a table');
    connection = opened;
    await connection.load('data', { kind: 'rows', rows: OBJECT_ROWS });
    live = wasmProvider({ sources: ['data'], connection });
    const columns = await live.columns('data');
    if (isRejection(columns)) throw new Error(`the live engine refused DESCRIBE: ${JSON.stringify(columns)}`);
  });

  afterAll(async () => {
    await connection?.close?.();
  });

  it('the schema comes back through DESCRIBE as this library’s five types — and the bookkeeping column is not one of them', async () => {
    // Pinned against a REAL DuckDB's own type words (BIGINT, DATE, VARCHAR),
    // which is what `TYPE_WORDS` was written for and what a fake DESCRIBE cannot prove.
    expect(await live.columns('data')).toEqual([
      { name: 'category', type: 'string' },
      { name: 'amount', type: 'number' },
      { name: 'date', type: 'date' },
      { name: 'source', type: 'string' },
      { name: 'target', type: 'string' },
    ]);
  });

  it('the landed table carries its SOURCE order, and index 0 is the row that was written first', async () => {
    const all = answered(await live.evaluate('data', null, { indices: true }), 'live engine, whole table');
    expect(all.count).toBe(OBJECT_ROWS.length);
    expect(byIndex(all)).toEqual(OBJECT_ROWS.map((row, i) => [i, row]));
  });

  it('every logged commit — point, interval, cleared, cell, neighbourhood — resolves to the same sql, the same count and the same rows as the memory engine', async () => {
    const session = new CauseSelectionSession();
    for (const c of SESSION_LOG) session.commit(c);
    const replayed = replayLog(serializeLog(session.records));

    for (const record of replayed.records) {
      const clause = clauseFromCommit(record);
      const [overSQL, inMemory] = await Promise.all([
        live.evaluate('data', clause, { indices: true }),
        memory.evaluate('data', clause, { indices: true }),
      ]);
      const real = answered(overSQL, `live engine on commit ${record.id}`);
      const fold = answered(inMemory, `memory engine on commit ${record.id}`);

      // 1. the descriptor the commit log rests on — one string, both engines
      expect(real.sql, `sql mismatch on commit ${record.id}`).toBe(seamSQLOf(record));
      expect(real.sql).toBe(fold.sql);
      // 2. how many rows the selection keeps
      expect(real.count, `count mismatch on commit ${record.id} (${real.sql})`).toBe(fold.count);
      // 3. …and WHICH rows, by source-order index and by value
      expect(byIndex(real), `rows mismatch on commit ${record.id}`).toEqual(byIndex(fold));
    }
  });

  it('…and every one of them counts the same in count mode, where no row is projected at all', async () => {
    const session = new CauseSelectionSession();
    for (const c of SESSION_LOG) session.commit(c);
    for (const record of session.records) {
      const clause = clauseFromCommit(record);
      const [overSQL, inMemory] = await Promise.all([
        live.evaluate('data', clause, { mode: 'count' }),
        memory.evaluate('data', clause, { mode: 'count' }),
      ]);
      expect(answered(overSQL, `live count on ${record.id}`).count).toBe(answered(inMemory, `memory count on ${record.id}`).count);
    }
  });

  it('a SORTED window agrees row for row IN ORDER — the one claim an unsorted window never makes', async () => {
    const window = { sort: [{ field: 'amount' as const, dir: 'desc' as const }], limit: 2, indices: true };
    const clause: PredicateClause = { kind: 'interval', field: 'amount', value: [5, 30] };
    const [overSQL, inMemory] = await Promise.all([live.evaluate('data', clause, window), memory.evaluate('data', clause, window)]);
    const real = answered(overSQL, 'live sorted window');
    const fold = answered(inMemory, 'memory sorted window');

    expect(real.indices).toEqual(fold.indices);
    expect(real.rows).toEqual(fold.rows);
    expect(real.rows).toHaveLength(2);
    // the count is the SELECTION's, never the window's — the number a gap check reads
    expect(real.count).toBe(4);
    expect(real.count).toBe(fold.count);
  });

  it('the opener takes a NAMED host as an assertion — the judgement is what it overrides, not what it consults', async () => {
    // jsdom defines a `Worker`, so the judgement would send a jsdom suite to the
    // CDN arm; `host: 'node'` is that suite saying which host it really is.
    expect(duckdbHostOf(hostFactsOf({ Worker: class {}, process: globalThis.process }))).toBe('browser');
    const named = await duckdbConnection({ host: 'node' })();
    try {
      expect(await named.query('SELECT 1 AS n')).toEqual([{ n: 1 }]);
    } finally {
      await named.close?.();
    }
  });

  it('a window PAST the first page agrees too, and both engines say where it starts', async () => {
    const window = { sort: [{ field: 'amount' as const, dir: 'asc' as const }], limit: 2, offset: 2, indices: true };
    const [overSQL, inMemory] = await Promise.all([live.evaluate('data', null, window), memory.evaluate('data', null, window)]);
    const real = answered(overSQL, 'live second page');
    const fold = answered(inMemory, 'memory second page');
    expect(real.start).toBe(2);
    expect(real.start).toBe(fold.start);
    expect(real.indices).toEqual(fold.indices);
    expect(real.rows).toEqual(fold.rows);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// TIES, AND TWO PAGES OF ONE WINDOW.
// ─────────────────────────────────────────────────────────────────────────────
//
// A sorted window is asked once PER PAGE, so an order that is not TOTAL is two
// different orders. `ORDER BY "bucket" ASC` over 300,000 rows with three
// distinct buckets leaves every tie to whatever the scan produced, and DuckDB
// promises nothing about that between two runs of the same statement: measured
// before the fix, page 2 repeated rows page 1 had already served and never
// served others at all. The remedy is the source-order column as the last key
// (`sqlWindow.ts`), which also makes the order the one the memory engine keeps.
//
// WHY 300,000 rows and not twelve: at twelve DuckDB answers a single-threaded
// scan in source order and the bug does not appear — a test at that size would
// pass with the fix reverted. This is the size the defect was measured at.

describe('a paged sorted window over a TIED column serves every row exactly once', () => {
  const TIED: Row[] = Array.from({ length: 300_000 }, (_, i) => ({ bucket: i % 3, id: i }));
  const PAGE = 50;
  const SORTED = { sort: [{ field: 'bucket' as const, dir: 'asc' as const }], limit: PAGE, indices: true };
  let connection: LoadingConnection;
  let live: DataProvider;

  beforeAll(async () => {
    const opened = await duckdbConnection()();
    if (!canLoad(opened)) throw new Error('the shipped opener answered a connection that cannot land a table');
    connection = opened;
    await connection.load('ties', { kind: 'rows', rows: TIED });
    live = wasmProvider({ sources: ['ties'], connection });
  });

  afterAll(async () => {
    await connection?.close?.();
  });

  it('two pages hold 100 DIFFERENT rows — no row twice, none skipped between them', async () => {
    const first = answered(await live.evaluate('ties', null, SORTED), 'live page 1');
    const second = answered(await live.evaluate('ties', null, { ...SORTED, offset: PAGE }), 'live page 2');
    const ids = [...(first.rows ?? []), ...(second.rows ?? [])].map((row) => row['id']);
    expect(ids).toHaveLength(2 * PAGE);
    expect(new Set(ids).size).toBe(2 * PAGE);
    // the tie-break is the SOURCE order within the tie, so the two pages are the
    // first hundred `bucket: 0` rows, in the order they were landed in
    expect(ids).toEqual(TIED.filter((row) => row['bucket'] === 0).slice(0, 2 * PAGE).map((row) => row['id']));
    expect(second.start).toBe(PAGE);
  });

  it('…and they are the same two pages the memory engine serves, row for row, in order', async () => {
    const memory = memoryProvider(TIED, { layout: 'row', tableName: 'ties' });
    for (const offset of [0, PAGE]) {
      const window = { ...SORTED, offset };
      const [real, fold] = await Promise.all([live.evaluate('ties', null, window), memory.evaluate('ties', null, window)]);
      const page = answered(real, `live page at ${String(offset)}`);
      const held = answered(fold, `memory page at ${String(offset)}`);
      expect(page.indices, `indices mismatch at offset ${String(offset)}`).toEqual(held.indices);
      expect(page.rows).toEqual(held.rows);
      expect(page.count).toBe(TIED.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AND TWO PAGES OF A WINDOW THAT ASKED FOR NO ORDER AT ALL.
// ─────────────────────────────────────────────────────────────────────────────
//
// The same defect with the sort taken away, and it is the DEFAULT window: the
// sheet pages unsorted. An unsorted window is not a total order either — every
// row is tied with every other — and each page is its own scan of the table,
// which DuckDB promises nothing about. `sqlWindow.ts` renders `ORDER BY "__row"
// ASC` as the whole order of a PAGED unsorted window (a full unpaged read keeps
// no order: there is no boundary in it for a row to fall on the wrong side of).
//
// WHICH ASSERTION HOLDS THIS DOWN, honestly: the SQL one. With the clause taken
// back out, this file was run at 300,000 rows and the row-order assertion still
// PASSED — DuckDB's scan came back in source order that time. That is the whole
// defect: not that the order is wrong, but that it is not PROMISED, so it can
// change between two runs of one statement and take a page boundary with it. An
// output assertion cannot catch a broken promise that happens to be kept, so the
// connection is tapped below and the rendered statement is asserted directly —
// that is the assertion that fails the moment the ORDER BY is removed (measured:
// `expected 'SELECT * FROM "wide" LIMIT 50 OFFSET 0' to contain 'ORDER BY
// "__row" ASC'`). The 300,000 rows stay because the row-order check is worth
// having at the size the sorted defect was measured at, where a parallel scan is
// what answers.

describe('a paged UNSORTED window serves every row exactly once, in source order', () => {
  const WIDE: Row[] = Array.from({ length: 300_000 }, (_, i) => ({ bucket: i % 3, id: i }));
  const PAGE = 50;
  const PAGES = 4; // the first 200 rows, the sheet's own first screenfuls
  const UNSORTED = { limit: PAGE, indices: true } as const;
  let connection: LoadingConnection;
  let live: DataProvider;
  const asked: string[] = [];

  beforeAll(async () => {
    const opened = await duckdbConnection()();
    if (!canLoad(opened)) throw new Error('the shipped opener answered a connection that cannot land a table');
    connection = opened;
    await connection.load('wide', { kind: 'rows', rows: WIDE });
    // WHY the connection is tapped: the row-order assertion below DID pass with
    // the clause removed (see the note above), so the statement the engine
    // actually SENT is the assertion that holds this fix down.
    live = wasmProvider({
      sources: ['wide'],
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

  it('four pages of 50 hold 200 DIFFERENT rows, in the order they were landed', async () => {
    const served: unknown[] = [];
    for (let page = 0; page < PAGES; page += 1) {
      // WHY every page names its offset, page 0 included: `start` is the engine's
      // answer to an ASKED-for offset, and `OFFSET 0` is a whole number at or
      // above zero — a legal window, not a missing one.
      const window = { ...UNSORTED, offset: page * PAGE };
      const answer = answered(await live.evaluate('wide', null, window), `live unsorted page ${String(page)}`);
      expect(answer.start).toBe(page * PAGE);
      expect(answer.indices).toEqual(Array.from({ length: PAGE }, (_, i) => page * PAGE + i));
      served.push(...(answer.rows ?? []).map((row) => row['id']));
    }
    expect(served).toHaveLength(PAGES * PAGE);
    expect(new Set(served).size).toBe(PAGES * PAGE); // no row twice, none skipped
    expect(served).toEqual(WIDE.slice(0, PAGES * PAGE).map((row) => row['id'])); // and in SOURCE order
  });

  it('…because every one of those statements was rendered with the source-order clause', async () => {
    await live.evaluate('wide', null, UNSORTED);
    const windows = asked.filter((sql) => sql.includes('LIMIT') || sql.includes('OFFSET'));
    expect(windows.length).toBeGreaterThan(0);
    for (const sql of windows) expect(sql).toContain('ORDER BY "__row" ASC');
    // and it is the whole order, not a tie-break after some other key
    expect(windowSQL('wide', '', UNSORTED, { hasRowOrder: true })).toBe('SELECT * FROM "wide" ORDER BY "__row" ASC LIMIT 50');
  });

  it('a full read asks for no order — the boundary is what needed one', async () => {
    const before = asked.length;
    answered(await live.evaluate('wide', null, { columns: ['id'] }), 'live whole table');
    expect(asked.slice(before).some((sql) => sql.includes('ORDER BY'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AND THE SAME CLAIM FOR A FIND: ONE POSITION, WHICHEVER ENGINE ANSWERED.
// ─────────────────────────────────────────────────────────────────────────────
//
// A find's whole promise is that the POSITION it answers is the `offset` the
// next window opens at — so if the two engines disagreed about it, a person
// pressing "next" would be sent to a different row depending on how much data
// they happened to have. The two answers come from genuinely different
// machinery: a walk over a cached `Int32Array` permutation in JS, and
// `ROW_NUMBER()` over an `ORDER BY` inside a DuckDB CTE.
//
// AT 300,000 ROWS, and for the same reason the paged-window suites above are:
// that is the size where DuckDB answers with a parallel scan, so the tie-break
// that makes the order TOTAL is actually load-bearing.
//
// WHAT IS PINNED AS AGREEMENT: a string column and an INTEGER column, sorted
// and unsorted, forward and backward, filtered and unfiltered. Floats and
// timestamps are NOT — a cell's text form is the engine's own there (`3` vs
// `3.0`, an ISO instant vs a SQL timestamp), which is named as the known
// divergence in src/data/README.md rather than papered over here.

describe('a find answers the same position, ordinal and count in both engines', () => {
  const NAMES = ['apple', 'Apple pie', 'pear', 'fig', 'pineapple'] as const;
  const FRUIT: Row[] = Array.from({ length: 300_000 }, (_, i) => ({ name: NAMES[i % NAMES.length]!, n: i % 1000, id: i }));
  const TABLE = 'fruit';
  let connection: LoadingConnection;
  let live: DataProvider;
  const memory = memoryProvider(FRUIT, { layout: 'row', tableName: TABLE });

  beforeAll(async () => {
    const opened = await duckdbConnection()();
    if (!canLoad(opened)) throw new Error('the shipped opener answered a connection that cannot land a table');
    connection = opened;
    await connection.load(TABLE, { kind: 'rows', rows: FRUIT });
    live = wasmProvider({ sources: [TABLE], connection });
  });

  afterAll(async () => {
    await connection?.close?.();
  });

  /** Both engines' answers to one ask — or a failure naming which engine refused. */
  const both = async (clause: PredicateClause | null, options: FindOptions): Promise<readonly [FindResult, FindResult]> => {
    const [real, held] = await Promise.all([live.find!(TABLE, clause, options), memory.find!(TABLE, clause, options)]);
    if (isRejection(real)) throw new Error(`the wasm engine refused: ${JSON.stringify(real)}`);
    if (isRejection(held)) throw new Error(`the memory engine refused: ${JSON.stringify(held)}`);
    return [real, held];
  };

  /** The same pair, narrowed to the HIT shape — the only one that carries an ordinal, an index and a row. */
  const bothFound = async (clause: PredicateClause | null, options: FindOptions): Promise<readonly [FindHit, FindHit]> => {
    const [real, held] = await both(clause, options);
    if (real.position === null || held.position === null) throw new Error(`no match where one was expected: ${JSON.stringify([real, held])}`);
    return [real, held];
  };

  it('a STRING column, unsorted: the same position, ordinal, source index, row and count — forward and backward', async () => {
    const ask: FindOptions = { text: 'apple', columns: ['name'], from: 0, direction: 'forward' };
    for (const from of [0, 1, 2, 7, 299_999]) {
      const [real, held] = await both(null, { ...ask, from });
      expect(real, `forward from ${String(from)}`).toEqual(held);
      // 'apple', 'Apple pie' and 'pineapple' all hold it: three of every five rows
      expect(real.matches).toBe(180_000);
    }
    for (const from of [0, 3, 12, 299_999]) {
      const [real, held] = await both(null, { ...ask, from, direction: 'backward' });
      expect(real, `backward from ${String(from)}`).toEqual(held);
    }
  });

  it('an INTEGER column: the digits of a number are searchable, and both engines render them the same way', async () => {
    const ask: FindOptions = { text: '999', columns: ['n'], from: 0, direction: 'forward' };
    const [real, held] = await bothFound(null, ask);
    expect(real).toEqual(held);
    expect([real.matches, real.position, real.ordinal]).toEqual([300, 999, 1]); // n = 999 once per thousand rows
    const [backReal, backHeld] = await both(null, { ...ask, from: 250_000, direction: 'backward' });
    expect(backReal).toEqual(backHeld);
  });

  it('a SORTED find agrees position for position — the one claim an unsorted find never makes', async () => {
    const sort = [{ field: 'name' as const, dir: 'asc' as const }];
    const ask: FindOptions = { text: 'pine', columns: ['name'], sort, from: 0, direction: 'forward' };
    for (const from of [0, 1, 60_000, 240_000]) {
      const [real, held] = await both(null, { ...ask, from });
      expect(real, `sorted forward from ${String(from)}`).toEqual(held);
    }
    const [real, held] = await both(null, { ...ask, from: 299_999, direction: 'backward' });
    expect(real).toEqual(held);
    expect(real.matches).toBe(60_000); // 'pineapple' is one name in five
  });

  it('a FILTERED find agrees too — both engines count the position over the rows the filter kept', async () => {
    const clause: IntervalClause = { kind: 'interval', field: 'n', value: [10, 19] };
    const ask: FindOptions = { text: 'fig', columns: ['name'], from: 0, direction: 'forward' };
    const [real, held] = await both(clause, ask);
    expect(real).toEqual(held);
    expect(real.sql).toBe(held.sql); // and the descriptor is the VIEW's, the same string `evaluate` reports
    const [back, heldBack] = await both(clause, { ...ask, from: 1_000, direction: 'backward' });
    expect(back).toEqual(heldBack);
  });

  it('the position a find answers IS the offset the next window opens at — in both engines', async () => {
    const sort = [{ field: 'name' as const, dir: 'asc' as const }];
    const ask: FindOptions = { text: 'pear', columns: ['name'], sort, from: 100_000, direction: 'forward' };
    const [real, held] = await bothFound(null, ask);
    expect(real).toEqual(held);
    const window = { sort, offset: real.position, limit: 1, indices: true };
    const [fromLive, fromMemory] = await Promise.all([live.evaluate(TABLE, null, window), memory.evaluate(TABLE, null, window)]);
    const served = answered(fromLive, 'the wasm window at the found position');
    expect(served.rows).toEqual(answered(fromMemory, 'the memory window at the found position').rows);
    expect(served.indices).toEqual([real.index]); // the row the find named, and no other
    expect(served.rows?.[0]?.['name']).toBe('pear');
  });

  // ── the KNOWN divergence, measured rather than assumed ──
  //
  // Case-insensitivity is not one rule. JS `toLowerCase()` is full Unicode and
  // some of its folds CHANGE LENGTH — U+0130 (İ, the Turkish dotted capital I)
  // becomes `i` + U+0307 (a combining dot), two code points — while DuckDB's
  // `ILIKE` folds it to a plain `i`. So one string in a hundred thousand is
  // found by one engine and not the other, and it is pinned here so it stays a
  // KNOWN exception instead of becoming a surprise. Everything else probed
  // AGREES, including the pairs one would expect to break first: `Ä`/`ä` folds
  // in both, and `ß`/`SS` folds in neither.
  it('agrees about every case pair EXCEPT a fold that changes length — the one divergence, named and measured', async () => {
    const CASED = 'cased';
    const rows: Row[] = [{ t: 'İstanbul' }, { t: 'ÄPFEL' }, { t: 'straße' }, { t: 'plain' }];
    await connection.load(CASED, { kind: 'rows', rows });
    const sql = wasmProvider({ sources: [CASED], connection });
    const held = memoryProvider(rows, { layout: 'row', tableName: CASED });
    const counts = async (text: string): Promise<readonly [number, number]> => {
      const options: FindOptions = { text, columns: ['t'], from: 0, direction: 'forward' };
      const [a, b] = await Promise.all([sql.find!(CASED, null, options), held.find!(CASED, null, options)]);
      if (isRejection(a) || isRejection(b)) throw new Error(`refused: ${JSON.stringify([a, b])}`);
      return [a.matches, b.matches];
    };

    // AGREEMENT — the ordinary case pairs, ASCII and not
    expect(await counts('äpfel')).toEqual([1, 1]);
    expect(await counts('ÄPFEL')).toEqual([1, 1]);
    expect(await counts('Äp')).toEqual([1, 1]);
    expect(await counts('ß')).toEqual([1, 1]);
    expect(await counts('strasse')).toEqual([0, 0]); // NEITHER engine folds ß to SS
    expect(await counts('PLAIN')).toEqual([1, 1]);

    // DIVERGENCE — a fold that changes length. Written as two numbers, not as
    // one expectation with a comment, so a future engine that closes the gap
    // fails this test and the README is corrected with it.
    expect(await counts('istanbul')).toEqual([1, 0]); // DuckDB folds İ→i; JS folds it to i + a combining dot
    expect(await counts('İ')).toEqual([2, 1]); // …so the SQL needle matches every plain `i` as well
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//
// A REFRESH IS COMPUTED WHERE THE ROWS LIVE (src/data/README.md). The memory
// engine diffs two arrays in JavaScript (`deltaByKey`); the wasm engine lands a
// staging table and asks SQL (`sqlReland.ts`); NEITHER hands the other's rows
// over. This describe is the proof that the two strategies are ONE answer: the
// same rows before and after, through both engines, give the SAME
// `RefreshDelta` — counts AND samples — keyed and unkeyed, with a repeated key
// and a null key in the room, with a column added and one dropped, and with the
// new version empty; and a sorted window after the replace reads the same rows
// in the same order on both.

describe('a reland answers the SAME delta from both engines — the diff in JavaScript and the diff in SQL are one answer', () => {
  const LEDGER: Row[] = [
    { id: 1, name: 'ann', amount: 10, day: '2026-04-05', gone: 'x' },
    { id: 2, name: 'bob', amount: 20, day: '2026-04-06', gone: 'y' },
    { id: 3, name: 'cy', amount: 30, day: '2026-04-07', gone: 'z' },
    { id: 3, name: 'dup', amount: 31, day: '2026-04-07', gone: 'z' }, // a repeated key: the second is unkeyed
    { id: null, name: 'nokey', amount: 0, day: null, gone: 'w' }, // a null key: unkeyed
  ];
  let connection: LoadingConnection;
  let nth = 0;

  beforeAll(async () => {
    const opened = await duckdbConnection()();
    if (!canLoad(opened)) throw new Error('the shipped opener answered a connection that cannot land a table');
    connection = opened;
  });

  afterAll(async () => {
    await connection?.close?.();
  });

  /** The same LEDGER landed in both engines under a fresh name — one pair per case, so no case reads another's replace. */
  const both = async (): Promise<{ readonly table: string; readonly live: DataProvider; readonly held: DataProvider }> => {
    const table = `ledger_${String(++nth)}`;
    await connection.load(table, { kind: 'rows', rows: LEDGER });
    return { table, live: wasmProvider({ sources: [table], connection }), held: memoryProvider(LEDGER, { layout: 'row', tableName: table }) };
  };

  /**
   * The schema each engine answers after the replace, compared by NAME and, for
   * every column but a date, by type. WHY the date is the exception: DuckDB
   * infers DATE from an ISO day and the memory engine's tally calls the same
   * string a `string` — a difference the FOURTH layout above already pins, and
   * not one a reland makes or could unmake.
   */
  const sameSchema = (a: readonly ColumnInfo[], b: readonly ColumnInfo[]): void => {
    expect(a.map((c) => c.name)).toEqual(b.map((c) => c.name));
    expect(a.filter((c) => c.name !== 'day')).toEqual(b.filter((c) => c.name !== 'day'));
  };

  /** Both engines' answers to one reland, each checked to be an answer. */
  const relandBoth = async (rows: readonly Row[], key?: string) => {
    const { table, live, held } = await both();
    const options = key === undefined ? {} : { key };
    const [sql, js] = [await live.replaceRows!(table, rows, options), await held.replaceRows!(table, rows, options)];
    if (isRejection(sql)) throw new Error(`the wasm engine refused: ${JSON.stringify(sql)}`);
    if (isRejection(js)) throw new Error(`the memory engine refused: ${JSON.stringify(js)}`);
    return { table, live, held, sql, js };
  };

  it('keyed, same columns: added, updated, removed, the three samples in source order, and the unkeyed count — identical', async () => {
    const AFTER: Row[] = [
      { id: 1, name: 'ann', amount: 10, day: '2026-04-05', gone: 'x' },
      { id: 2, name: 'bob', amount: 25, day: '2026-04-06', gone: 'y' }, // amount moved
      { id: 4, name: 'dee', amount: 40, day: '2026-04-08', gone: 'v' }, // new
      { id: 4, name: 'dup', amount: 41, day: '2026-04-08', gone: 'v' }, // repeated: unkeyed
    ];
    const { sql, js } = await relandBoth(AFTER, 'id');
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: true, key: 'id', added: 1, updated: 1, removed: 1, sample: { added: ['4'], updated: ['2'], removed: ['3'] }, unkeyed: 3 });
    sameSchema(sql.columns, js.columns);
  });

  it('a row whose object keys arrived in a different order, bytes unchanged, is NOT updated on either engine — an object\'s key order is not a data fact', async () => {
    const AFTER: Row[] = [
      { day: '2026-04-05', id: 1, gone: 'x', amount: 10, name: 'ann' }, // same row, keys reordered
      { id: 2, name: 'bob', amount: 20, day: '2026-04-06', gone: 'y' },
      { id: 3, name: 'cy', amount: 30, day: '2026-04-07', gone: 'z' },
      { id: 3, name: 'dup', amount: 31, day: '2026-04-07', gone: 'z' },
      { id: null, name: 'nokey', amount: 0, day: null, gone: 'w' },
    ];
    const { sql, js } = await relandBoth(AFTER, 'id');
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: true, key: 'id', added: 0, updated: 0, removed: 0, sample: { added: [], updated: [], removed: [] }, unkeyed: 4 });
  });

  it('a column whose semantic type moved for every row is a change on every shared key, on both engines — a value that changed type HAS changed', async () => {
    const AFTER: Row[] = LEDGER.map((row) => ({ ...row, amount: String(row['amount']) }));
    const { sql, js } = await relandBoth(AFTER, 'id');
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: true, key: 'id', added: 0, updated: 3, removed: 0, sample: { added: [], updated: ['1', '2', '3'], removed: [] }, unkeyed: 4 });
  });

  it('a column dropped and a column added: the dropped one is stripped before the compare, the added one is a change to every shared key — identical', async () => {
    const AFTER: Row[] = [
      { id: 1, name: 'ann', amount: 10, day: '2026-04-05', flag: true },
      { id: 2, name: 'bob', amount: 20, day: '2026-04-06', flag: false },
    ];
    const { sql, js } = await relandBoth(AFTER, 'id');
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: true, key: 'id', added: 0, updated: 2, removed: 1, sample: { added: [], updated: ['1', '2'], removed: ['3'] }, unkeyed: 2 });
    sameSchema(sql.columns, js.columns);
    expect(sql.columns.map((c) => c.name)).toEqual(['id', 'name', 'amount', 'day', 'flag']);
  });

  it('a column dropped and nothing else: no row is "updated" for it, on either side', async () => {
    const AFTER: Row[] = LEDGER.slice(0, 3).map(({ gone: _gone, ...rest }) => rest);
    const { sql, js } = await relandBoth(AFTER, 'id');
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: true, key: 'id', added: 0, updated: 0, removed: 0, sample: { added: [], updated: [], removed: [] }, unkeyed: 2 });
  });

  it('a DATE key: the sample keys are the ISO day the memory engine holds, not the epoch number DuckDB sends', async () => {
    const AFTER: Row[] = [
      { id: 1, name: 'ann', amount: 10, day: '2026-04-05', gone: 'x' },
      { id: 9, name: 'new', amount: 90, day: '2026-04-09', gone: 'q' },
    ];
    const { sql, js } = await relandBoth(AFTER, 'day');
    expect(sql.delta).toEqual(js.delta);
    // old days: 05, 06, 07, 07 (repeat), null → three keyed, two unkeyed; new: 05 (same bytes), 09
    expect(sql.delta).toEqual({ keyed: true, key: 'day', added: 1, updated: 0, removed: 2, sample: { added: ['2026-04-09'], updated: [], removed: ['2026-04-06', '2026-04-07'] }, unkeyed: 2 });
  });

  it('unkeyed: the table is replaced, and how many rows did it is the one number both report', async () => {
    const { sql, js } = await relandBoth(LEDGER.slice(0, 2));
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: false, replaced: 2 });
  });

  it('a key the new rows lack: both say the delta cannot be exact, in the same shape', async () => {
    const { sql, js } = await relandBoth([{ name: 'zed', amount: 1, day: '2026-04-09' }], 'id');
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: false, replaced: 1, keyAbsent: 'id' });
  });

  it('the mirror: a key column the OLD rows never carried at all — every old row is unkeyed, and every new key is added, on both engines', async () => {
    const { sql, js } = await relandBoth(
      [
        { id: 1, name: 'ann', amount: 10, day: '2026-04-05', sku: 'a1' },
        { id: 2, name: 'bob', amount: 20, day: '2026-04-06', sku: 'a2' },
      ],
      'sku',
    );
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: true, key: 'sku', added: 2, updated: 0, removed: 0, sample: { added: ['a1', 'a2'], updated: [], removed: [] }, unkeyed: 5 });
  });

  it('an empty new version removes every key on both sides — the memory engine keeps its key though zero rows show it no schema, the wasm engine keeps the old schema', async () => {
    const { sql, js, live, held, table } = await relandBoth([], 'id');
    expect(sql.delta).toEqual(js.delta);
    expect(sql.delta).toEqual({ keyed: true, key: 'id', added: 0, updated: 0, removed: 3, sample: { added: [], updated: [], removed: ['1', '2', '3'] }, unkeyed: 2 });
    const [a, b] = await Promise.all([live.evaluate(table, null, { mode: 'count' }), held.evaluate(table, null, { mode: 'count' })]);
    expect([answered(a, 'wasm').count, answered(b, 'memory').count]).toEqual([0, 0]);
  });

  it('a SORTED window after the replace answers the same rows in the same order on both — the permutation the memory engine cached is gone, the schema the wasm engine remembered is re-read', async () => {
    const { table, live, held } = await both();
    const sort = [{ field: 'amount', dir: 'desc' as const }];
    const before = await Promise.all([live.evaluate(table, null, { sort, limit: 5, indices: true }), held.evaluate(table, null, { sort, limit: 5, indices: true })]);
    expect(answered(before[0], 'wasm').rows).toEqual(answered(before[1], 'memory').rows); // both cache something here
    // the same five ids, the amounts reversed, one column gone: the refresh a row-count check cannot see
    const AFTER: Row[] = LEDGER.map((row, i) => ({ id: row['id'], name: row['name'], amount: 50 - i * 10, day: row['day'] }));
    const [sql, js] = [await live.replaceRows!(table, AFTER, { key: 'id' }), await held.replaceRows!(table, AFTER, { key: 'id' })];
    if (isRejection(sql) || isRejection(js)) throw new Error(`refused: ${JSON.stringify([sql, js])}`);
    expect(sql.delta).toEqual(js.delta);
    const after = await Promise.all([live.evaluate(table, null, { sort, limit: 5, indices: true }), held.evaluate(table, null, { sort, limit: 5, indices: true })]);
    const [real, mem] = [answered(after[0], 'wasm'), answered(after[1], 'memory')];
    expect(real.rows).toEqual(mem.rows);
    expect(real.indices).toEqual(mem.indices);
    expect(real.rows?.map((r) => r['amount'])).toEqual([50, 40, 30, 20, 10]);
    expect(real.rows?.[0]).toEqual({ id: 1, name: 'ann', amount: 50, day: '2026-04-05' }); // `gone` is gone on the wasm side too: the schema was re-read
    const [cols, heldCols] = await Promise.all([live.columns(table), held.columns(table)]);
    if (isRejection(cols) || isRejection(heldCols)) throw new Error('columns refused after the replace');
    sameSchema(cols, heldCols);
    // An UNSORTED window reads the NEW rows too, in the new source order — the
    // replace's `SELECT * FROM staging` carries `__row` over unchanged.
    const unsorted = await Promise.all([live.evaluate(table, null, { limit: 5, indices: true }), held.evaluate(table, null, { limit: 5, indices: true })]);
    const [realUnsorted, memUnsorted] = [answered(unsorted[0], 'wasm'), answered(unsorted[1], 'memory')];
    expect(realUnsorted.rows).toEqual(memUnsorted.rows);
    expect(realUnsorted.rows?.map((r) => r['amount'])).toEqual([50, 40, 30, 20, 10]); // AFTER's own row order — the replace did not reshuffle it
    // The replace COPIES `__row` from staging into the table — never doubles or
    // shifts it: DESCRIBE names it exactly once.
    const described = await connection.query(`DESCRIBE "${table}"`);
    expect(described.filter((row) => row['column_name'] === '__row')).toHaveLength(1);
  });
});
