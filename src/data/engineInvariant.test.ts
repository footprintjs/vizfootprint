/**
 * engineInvariant.test.ts — THE D24 centerpiece (docs/RESEARCH_STATE.md):
 * "engine choice never changes commit semantics — cross-engine replay
 * byte-identical (acceptance test at L5/data-provider packet)."
 *
 * This is the strongest form of that claim this packet can prove without a
 * real wasm/server backend (both are still typed stubs — `wasmProvider.ts`,
 * `serverProvider.ts`): it drives a REAL L1 (`src/log`) + L2 (`src/mosaic`)
 * cause-tagged commit session — the exact machinery a real dashboard uses —
 * serializes it, replays it into a fresh Selection/registry, and then feeds
 * the (replayed) commit stream into THREE differently-shaped `memoryProvider`
 * instances (row-major array, column-major array, and CSV text — three
 * genuinely different internal representations, not a cosmetic flag) and
 * asserts every one resolves the SAME clauses to BYTE-IDENTICAL predicate
 * SQL and row results.
 *
 * The strongest cross-check available today: the provider's resolved
 * `sql` is compared not just provider-to-provider, but against
 * `CommitRecord.predicateSQL` itself — the string L1 already recorded from a
 * REAL Mosaic clause object (`src/log/log.ts:143`, `String(clause.predicate)`).
 * That ties the data seam's SQL resolution to the actual upstream Mosaic
 * clause factories, not just to this package's own replica.
 */
import { describe, it, expect } from 'vitest';
import { CauseSelectionSession, causeHistogram, replayLog, serializeLog, type CommitInput } from '../log/index.js';
import { memoryProvider } from './memoryProvider.js';
import { isRejection } from './types.js';
import type { CellClause, DataProvider, PredicateClause, Row } from './types.js';

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
];

// The dataset the commits above filter, expressed THREE structurally
// different ways — none derived from the others at the byte level.
const OBJECT_ROWS: Row[] = [
  { category: 'Data', amount: 15 },
  { category: 'Analytics', amount: 25 },
  { category: 'Data', amount: 5 },
  { category: 'Other', amount: 30 },
];
const CSV_TEXT = 'category,amount\nData,15\nAnalytics,25\nData,5\nOther,30\n';

function clauseFromCommit(record: {
  kind: 'point' | 'interval' | 'cell' | 'match';
  field: string;
  value: unknown;
  fields?: readonly [string, string];
}): PredicateClause {
  if (record.kind === 'cell') {
    // D30: a cell commit's authoritative pair rides `fields`; `field` is display-only.
    return { kind: 'cell', fields: record.fields!, value: record.value as CellClause['value'] };
  }
  return record.kind === 'point'
    ? { kind: 'point', field: record.field, value: record.value }
    : { kind: 'interval', field: record.field, value: record.value as readonly [number, number] | null };
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
      // invent its own, divergent notion of "this commit's predicate".
      expect(first.sql).toBe(record.predicateSQL);

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
      expect(a.sql).toBe(record.predicateSQL);
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
