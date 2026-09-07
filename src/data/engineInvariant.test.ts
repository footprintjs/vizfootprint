/**
 * engineInvariant.test.ts — THE D24 centerpiece (docs/RESEARCH_STATE.md):
 * "engine choice never changes commit semantics — cross-engine replay
 * byte-identical (acceptance test at L5/data-provider packet)."
 *
 * This is the strongest form of that claim this packet can prove without a
 * real wasm/server backend (both are still typed stubs — `wasmProvider.ts`,
 * `serverProvider.ts`): it drives a REAL L1 (`src/log`) + L2 (`src/selection`)
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
import { describe, it, expect } from 'vitest';
import { CauseSelectionSession, causeHistogram, replayLog, serializeLog, type CommitInput, type CommitRecord } from '../log/index.js';
import { memoryProvider } from './memoryProvider.js';
import { mosaicDescriptorSQL } from './predicate.js';
import { pointValueFromWire } from './clauseFromWire.js';
import { isRejection } from './types.js';
import type { CellClause, DataProvider, IntervalClause, PredicateClause, Row } from './types.js';

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
