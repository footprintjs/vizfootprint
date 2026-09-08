/**
 * The arithmetic and the doors of `./bringOver.ts`, one at a time.
 *
 * The end-to-end claim — a layout act and a bringOver act putting a whole
 * node-link picture on the trace, replayed from the log alone — is
 * `../session/bringOverAct.test.ts`. This file is what that one rests on: the
 * fold, the counters, every refusal sentence, and the analysis itself.
 */

import { describe, expect, it } from 'vitest';
import {
  bringOverAnalysis,
  bringOverColumns,
  bringOverProblems,
  broughtColumnName,
  broughtColumnNames,
  BringOverError,
  COUNTS_SUFFIX,
  type BringOverJoin,
  type BringOverWork,
} from './bringOver.js';
import type { ColumnInfo, Row } from '../data/types.js';
import type { RelatedRows } from './types.js';

/** `edges.source → nodes.id` and `edges.target → nodes.id` — the two ties the demo declares. */
const ENDS: readonly BringOverJoin[] = [
  { column: 'source', key: 'id' },
  { column: 'target', key: 'id' },
];

const NODES: readonly Row[] = [
  { id: 'flu', x: 1, y: 2 },
  { id: 'cold', x: 3, y: 4 },
];
const EDGES: readonly Row[] = [{ source: 'flu', target: 'cold' }];

const work = (over: Partial<BringOverWork> = {}): BringOverWork => ({ joins: ENDS, columns: ['x', 'y'], rows: EDGES, related: NODES, ...over });

const columnsOf = (names: readonly string[]): ColumnInfo[] => names.map((name) => ({ name, type: 'string' }));

describe('the names a plan produces', () => {
  it('spells one name per join × column, in join-then-column order', () => {
    expect(broughtColumnName('source', 'x')).toBe('source_x');
    expect(broughtColumnNames(ENDS, ['x', 'y'])).toEqual(['source_x', 'source_y', 'target_x', 'target_y']);
  });

  it('produces nothing when there is no join to follow', () => {
    expect(broughtColumnNames([], ['x', 'y'])).toEqual([]);
  });
});

describe('the fold carries a cell across a tie, and counts what it could not', () => {
  it('brings every named column over, one value per row, per join', () => {
    const brought = bringOverColumns(work());
    expect(brought.values).toEqual({ source_x: [1], source_y: [2], target_x: [3], target_y: [4] });
    expect(brought.counts).toEqual({ source: { total: 1, counted: 1, skipped: 0 }, target: { total: 1, counted: 1, skipped: 0 } });
  });

  it('an endpoint naming no row is null and is COUNTED — never a silent gap', () => {
    const brought = bringOverColumns(work({ rows: [{ source: 'flu', target: 'ghost' }] }));
    expect(brought.values['target_x']).toEqual([null]);
    expect(brought.counts['target']).toEqual({ total: 1, counted: 0, skipped: 1 });
    expect(brought.counts['source']).toEqual({ total: 1, counted: 1, skipped: 0 });
  });

  it('an absent or null endpoint names no row, and no other value is coerced into naming one', () => {
    const brought = bringOverColumns(work({ rows: [{ source: null, target: undefined }, { source: 0, target: 'cold' }] }));
    expect(brought.values['source_x']).toEqual([null, null]);
    expect(brought.values['target_x']).toEqual([null, 3]);
    expect(brought.counts['source']).toEqual({ total: 2, counted: 0, skipped: 2 });
  });

  it('a key value that is not a string still names its row — the key is compared as written', () => {
    const brought = bringOverColumns({ joins: [{ column: 'node', key: 'id' }], columns: ['x'], rows: [{ node: 7 }], related: [{ id: 7, x: 9 }] });
    expect(brought.values['node_x']).toEqual([9]);
  });

  it('the FIRST row wins a repeated key, so the answer does not depend on a backend’s order', () => {
    const brought = bringOverColumns(work({ related: [...NODES, { id: 'flu', x: 99, y: 99 }] }));
    expect(brought.values['source_x']).toEqual([1]);
  });

  it('a related row whose key is absent is not indexed', () => {
    const brought = bringOverColumns(work({ related: [{ x: 5, y: 6 }, ...NODES] }));
    expect(brought.values['source_x']).toEqual([1]);
  });

  it('a fetched column a related row does not carry comes over as null, not as undefined', () => {
    const brought = bringOverColumns(work({ related: [{ id: 'flu', x: 1 }, ...NODES.slice(1)] }));
    expect(brought.values['source_y']).toEqual([null]);
  });

  it('an empty related table is honest emptiness: every row skipped, nothing invented', () => {
    const brought = bringOverColumns(work({ related: [] }));
    expect(brought.values).toEqual({ source_x: [null], source_y: [null], target_x: [null], target_y: [null] });
    expect(brought.counts['source']).toEqual({ total: 1, counted: 0, skipped: 1 });
  });

  it('two joins on ONE key column index that table once, and both read the same index', () => {
    const brought = bringOverColumns(work({ rows: [{ source: 'flu', target: 'flu' }] }));
    expect(brought.values['source_x']).toEqual(brought.values['target_x']);
  });
});

describe('the door — every refusal, in the house voice', () => {
  it('says nothing about a plan it has nothing to say about', () => {
    expect(bringOverProblems('ends', 'edges', 'nodes', ENDS, ['x'], 'edges', columnsOf(['source', 'target']))).toEqual([]);
  });

  it('refuses an act declared on a table other than the one it writes, and stops there', () => {
    expect(bringOverProblems('ends', 'edges', 'nodes', ENDS, ['x'], 'cells', columnsOf(['a']))).toEqual([
      'analysis "ends" writes onto table "edges", but this act reads table "cells" — declare it on "edges"',
    ]);
  });

  it('refuses when no declared relation points that way, and names both tables', () => {
    expect(bringOverProblems('ends', 'edges', 'nodes', [], ['x', 'y'], 'edges', columnsOf(['source']))).toEqual([
      'analysis "ends" brings x, y over from "nodes", but no declared relation points from "edges" at "nodes" — declare the relation first',
    ]);
  });

  it('a plan that fetches nothing still says so rather than leaving a gap in the sentence', () => {
    expect(bringOverProblems('ends', 'edges', 'nodes', [], [], 'edges', columnsOf(['source']))[0]).toContain('brings none over from "nodes"');
  });

  it('refuses a join on a column this table does not have, and lists the ones it does', () => {
    expect(bringOverProblems('ends', 'edges', 'nodes', ENDS, ['x'], 'edges', columnsOf(['source', 'weight']))).toEqual([
      'analysis "ends" follows column "target", which table "edges" does not have — the columns are source, weight',
    ]);
  });

  it('a table with no columns at all is said as "none", never as an empty space', () => {
    expect(bringOverProblems('ends', 'edges', 'nodes', ENDS, ['x'], 'edges', [])[0]).toContain('the columns are none');
  });
});

describe('the analysis', () => {
  const relatedNodes: RelatedRows = { nodes: NODES };

  it('takes the defaults a node-link wants, and declares what it reads', () => {
    const mod = bringOverAnalysis({ joins: ENDS });
    expect(mod.id).toBe('bring:edges:nodes');
    expect(mod.kind).toBe('transform');
    expect(mod.def.produces).toBe('columns');
    expect(mod.def.reads).toEqual(['nodes']);
    expect(mod.def.inputs).toEqual([
      { column: 'source', role: 'identifier' },
      { column: 'target', role: 'identifier' },
    ]);
  });

  it('with nothing said at all it still names itself, and follows no tie until one is declared', () => {
    const bare = bringOverAnalysis();
    expect(bare.id).toBe('bring:edges:nodes');
    expect(bare.def.inputs).toEqual([]);
    expect(bare.def.reads).toEqual(['nodes']);
  });

  it('a cell that is simply not there is null on both sides of the tie, never undefined', async () => {
    const mod = bringOverAnalysis({ joins: [{ column: 'source', key: 'id' }] });
    // the first edge row carries no `source` at all; the `flu` node carries no `y`
    const related: RelatedRows = { nodes: [{ id: 'flu', x: 1 }, { id: 'cold', x: 3, y: 4 }] };
    const run = await mod.run([{}, { source: 'flu' }] as never, { related });
    const state = run.snapshot!.sharedState as Record<string, unknown>;
    expect(state['source_x']).toEqual([null, 1]);
    expect(state['source_y']).toEqual([null, null]);
  });

  it('REFUSES a key that names two rows, quoting the value that does', async () => {
    const mod = bringOverAnalysis({ joins: [{ column: 'source', key: 'id' }] });
    const twice: RelatedRows = { nodes: [{ id: 'flu', x: 1, y: 2 }, ...NODES] };
    await expect(mod.run(EDGES as never, { related: twice })).rejects.toThrow(BringOverError);
    await expect(mod.run(EDGES as never, { related: twice })).rejects.toThrow(
      'analysis "bring:edges:nodes" brings columns over from "nodes" by its key "id", which is not unique — "flu" names 2 rows there; ' +
        'a key that names two rows names neither, so bring the columns over from a table that holds one row per "id"',
    );
  });

  it('an UNKEYED related row is not a repeat — it names no identity, so it is unreachable rather than ambiguous', async () => {
    const mod = bringOverAnalysis({ joins: [{ column: 'source', key: 'id' }] });
    const unkeyed: RelatedRows = { nodes: [{ id: null, x: 9, y: 9 }, { x: 8, y: 8 }, ...NODES] };
    const run = await mod.run(EDGES as never, { related: unkeyed });
    expect((run.snapshot!.sharedState as Record<string, unknown>)['source_x']).toEqual([1]);
  });

  it('every option is the record’s own, and the id can be named', () => {
    const mod = bringOverAnalysis({ table: 'sales', from: 'customers', columns: ['region'], joins: [{ column: 'customer', key: 'code' }], id: 'where' });
    expect(mod.id).toBe('where');
    expect(mod.def.reads).toEqual(['customers']);
  });

  it('lands one column per join × name, and the counters ride the same committed state', async () => {
    const mod = bringOverAnalysis({ joins: ENDS });
    const run = await mod.run(EDGES as never, { related: relatedNodes });
    expect(run.result.ok && run.result.output).toEqual({
      as: 'columns',
      table: 'edges',
      columns: { source_x: { type: 'float' }, source_y: { type: 'float' }, target_x: { type: 'float' }, target_y: { type: 'float' } },
    });
    const state = run.snapshot!.sharedState as Record<string, unknown>;
    expect(state['source_x']).toEqual([1]);
    expect(state[`source_x source_y target_x target_y${COUNTS_SUFFIX}`]).toEqual({
      source: { total: 1, counted: 1, skipped: 0 },
      target: { total: 1, counted: 1, skipped: 0 },
    });
  });

  it('a column of text is declared as text, and one of numbers-and-nulls as a number', async () => {
    const mod = bringOverAnalysis({ columns: ['group', 'x'], joins: [{ column: 'source', key: 'id' }] });
    const related: RelatedRows = { nodes: [{ id: 'flu', group: 'viral', x: 1 }] };
    const run = await mod.run([{ source: 'flu' }, { source: 'ghost' }] as never, { related });
    expect(run.result.ok && run.result.output.columns).toEqual({ source_group: { type: 'string' }, source_x: { type: 'float' } });
  });

  it('refuses at run time when the related table has no such column — before the act exists', async () => {
    const mod = bringOverAnalysis({ joins: ENDS });
    await expect(mod.run(EDGES as never, { related: { nodes: [{ id: 'flu', x: 1 }] } })).rejects.toThrow(
      new BringOverError('analysis "bring:edges:nodes" brings y over from "nodes", which has no such column — compute it there first'),
    );
  });

  it('an EMPTY related table is not that refusal: it is every row skipped', async () => {
    const mod = bringOverAnalysis({ joins: ENDS });
    const run = await mod.run(EDGES as never, { related: { nodes: [] } });
    expect((run.snapshot!.sharedState as Record<string, unknown>)['source_x']).toEqual([null]);
  });

  it('a run handed NO related rows at all is refused: that is not the same as an empty table', async () => {
    const mod = bringOverAnalysis({ joins: ENDS });
    await expect(mod.run(EDGES as never)).rejects.toThrow(
      'analysis "bring:edges:nodes" reads "nodes" beside its own table, and this run was handed no rows to read there',
    );
  });

  // WHY this calls `toRunInput` directly: `run` refuses an invocation that
  // brought no rows for a declared table, so the `?? []` arm is reachable only
  // by a caller holding the def itself — a public shape, so it gets a real test
  // rather than a coverage escape. Nothing over there means every row skipped.
  it('a def called with no rows for its related table brings nothing over, and says so in the counters', () => {
    const mod = bringOverAnalysis({ joins: ENDS });
    const payload = mod.def.toRunInput([{ source: 'a', target: 'b' }], {}) as Record<string, { related: readonly unknown[] }>;
    const work = Object.values(payload)[0]!;
    expect(work.related).toEqual([]);
  });

  it('judges the table it is about to write, through the def’s own hook', () => {
    const mod = bringOverAnalysis({ joins: ENDS });
    expect(mod.def.judgeTable!('edges', columnsOf(['source', 'target']))).toEqual([]);
    expect(mod.def.judgeTable!('nodes', columnsOf(['id']))).toEqual([
      'analysis "bring:edges:nodes" writes onto table "edges", but this act reads table "nodes" — declare it on "edges"',
    ]);
  });
});
