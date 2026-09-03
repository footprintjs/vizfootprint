/**
 * The derived-column grammar, on its own: a slot per act, a resolution at a
 * position, and the two renames that carry logical names across the engine
 * boundary. The behaviour a PERSON sees is tested from the session's side, in
 * `src/session/derivedColumns.session.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  DerivedColumnStore,
  derivedColumnName,
  renameClauseFields,
  renameRowSlots,
  resolveDerived,
  type DerivedColumn,
} from './derivedColumns.js';
import type { CellClause, IntervalClause, MatchClause, PointClause } from './types.js';

const col = (name: string, commitId: string, table = 'data'): DerivedColumn => ({
  table,
  name,
  physical: derivedColumnName(name, commitId),
  commitId,
});

describe('derivedColumnName — one slot per act, never one per name', () => {
  it('carries the commit that made it', () => {
    expect(derivedColumnName('risk', 's7')).toBe('risk@s7');
  });

  it('two acts computing the same name get two different slots — the whole point', () => {
    expect(derivedColumnName('risk', 's3')).not.toBe(derivedColumnName('risk', 's7'));
  });

  it('a name that already contains the marker still gets its own slot', () => {
    // nothing PARSES a physical name, so a logical name carrying `@` is not a
    // problem to be refused — it is simply data
    expect(derivedColumnName('risk@2024', 's7')).toBe('risk@2024@s7');
  });
});

describe('DerivedColumnStore — which slots are the trace’s', () => {
  it('an unknown table has no derived columns, so every column of it is declared', () => {
    const store = new DerivedColumnStore();
    expect(store.forTable('nope')).toEqual([]);
    expect(store.physicalNames('nope').size).toBe(0);
    expect(store.logicalByPhysical('nope').size).toBe(0);
  });

  it('records per table and never mixes two tables', () => {
    const store = new DerivedColumnStore();
    store.record(col('risk', 's1'));
    store.record(col('risk', 's2'));
    store.record(col('score', 's3', 'other'));

    expect(store.forTable('data').map((c) => c.physical)).toEqual(['risk@s1', 'risk@s2']);
    expect(store.forTable('other').map((c) => c.physical)).toEqual(['score@s3']);
    expect([...store.physicalNames('data')]).toEqual(['risk@s1', 'risk@s2']);
    expect(store.logicalByPhysical('data').get('risk@s2')).toBe('risk');
  });

  it('clear() drops one table’s slots and leaves every other table alone', () => {
    const store = new DerivedColumnStore();
    store.record(col('risk', 's1'));
    store.record(col('band', 's2'));
    store.record(col('score', 's9', 'other'));

    store.clear('data');
    expect(store.forTable('data')).toEqual([]);
    expect(store.physicalNames('data').size).toBe(0);
    expect(store.forTable('other')).toHaveLength(1);
  });

  it('clearing a table that has none is not an error', () => {
    expect(() => new DerivedColumnStore().clear('data')).not.toThrow();
  });
});

describe('resolveDerived — a name means whatever the branch says it means', () => {
  const a = col('risk', 's2');
  const b = col('risk', 's5');

  it('two branches computing one name resolve to two different slots', () => {
    const entries = [a, b];
    expect(resolveDerived(entries, ['s1', 's2'])!.get('risk')).toBe(a);
    expect(resolveDerived(entries, ['s1', 's5'])!.get('risk')).toBe(b);
  });

  it('a name computed on no branch on this path has no answer at all', () => {
    expect(resolveDerived([a, b], ['s1', 's9']).size).toBe(0);
  });

  it('a re-run on the SAME path supersedes rather than shadows — the later act wins', () => {
    // the path is root→cursor, so the last matching commit is the nearest one
    expect(resolveDerived([a, b], ['s1', 's2', 's5']).get('risk')).toBe(b);
  });

  it('one act producing several columns lands all of them', () => {
    const both = [col('risk', 's2'), col('band', 's2')];
    const out = resolveDerived(both, ['s2']);
    expect([...out.keys()].sort()).toEqual(['band', 'risk']);
  });

  it('an empty path resolves nothing', () => {
    expect(resolveDerived([a], []).size).toBe(0);
  });
});

describe('renameClauseFields — logical names become slots on the way to an engine', () => {
  const slot = (f: string) => (f === 'risk' ? 'risk@s2' : f);

  it('rewrites a point clause’s field', () => {
    const clause: PointClause = { kind: 'point', field: 'risk', value: 1 };
    expect(renameClauseFields(clause, slot)).toEqual({ kind: 'point', field: 'risk@s2', value: 1 });
  });

  it('rewrites an interval clause’s field and keeps the bounds', () => {
    const clause: IntervalClause = { kind: 'interval', field: 'risk', value: [1, 3] };
    expect(renameClauseFields(clause, slot)).toEqual({ kind: 'interval', field: 'risk@s2', value: [1, 3] });
  });

  it('rewrites a match clause’s field and keeps its polarity', () => {
    const clause: MatchClause = { kind: 'match', field: 'risk', values: [1, 2], exclude: true };
    expect(renameClauseFields(clause, slot)).toEqual({ kind: 'match', field: 'risk@s2', values: [1, 2], exclude: true });
  });

  it('rewrites BOTH sides of a cell', () => {
    const two = (f: string) => `${f}@s2`;
    const clause: CellClause = { kind: 'cell', fields: ['risk', 'band'], value: [1, 2] };
    expect(renameClauseFields(clause, two)).toEqual({ kind: 'cell', fields: ['risk@s2', 'band@s2'], value: [1, 2] });
  });

  it('rewrites ONE side of a cell when only one side is derived', () => {
    const clause: CellClause = { kind: 'cell', fields: ['risk', 'price'], value: [1, [10, 20]] };
    expect(renameClauseFields(clause, slot)).toEqual({ kind: 'cell', fields: ['risk@s2', 'price'], value: [1, [10, 20]] });
  });

  it('hands back the SAME clause when nothing moved — no allocation for the common case', () => {
    const point: PointClause = { kind: 'point', field: 'price', value: 50 };
    const cell: CellClause = { kind: 'cell', fields: ['price', 'category'], value: [50, 'Formal'] };
    expect(renameClauseFields(point, slot)).toBe(point);
    expect(renameClauseFields(cell, slot)).toBe(cell);
  });
});

describe('renameRowSlots — rows come back wearing the names the caller asked for', () => {
  const back = new Map([['risk@s2', 'risk']]);

  it('renames the slot and leaves every other column alone', () => {
    expect(renameRowSlots({ id: 'd1', price: 50, 'risk@s2': 3 }, back)).toEqual({ id: 'd1', price: 50, risk: 3 });
  });

  it('hands back the SAME row when it carries no derived slot', () => {
    const row = { id: 'd1', price: 50 };
    expect(renameRowSlots(row, back)).toBe(row);
  });

  it('an empty back-map is the same-row path', () => {
    const row = { id: 'd1', 'risk@s2': 3 };
    expect(renameRowSlots(row, new Map())).toBe(row);
  });

  it('renames several slots in one row', () => {
    const two = new Map([['risk@s2', 'risk'], ['band@s2', 'band']]);
    expect(renameRowSlots({ 'risk@s2': 1, 'band@s2': 'hi', id: 'd1' }, two)).toEqual({ risk: 1, band: 'hi', id: 'd1' });
  });
});
